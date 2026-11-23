"""Semantic check for rendered sounds: what does it sound like, and does it match a text prompt?

  AudioSet labels  - MIT/ast-finetuned-audioset (527 classes, sigmoid probabilities)
  CLAP text match  - laion/larger_clap_general; the prompt is ranked against a set of
                     common SFX categories (or --alt labels), softmax over the candidates.

Usage: uv run --project judge python judge/judge.py FILE... [--prompt TEXT] [--alt TEXT ...] [--top N] [--json]
Deterministic: no sampling; clips longer than 10 s are cut to the first 10 s.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import warnings

os.environ.setdefault("TRANSFORMERS_VERBOSITY", "error")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
warnings.filterwarnings("ignore")

import numpy as np  # noqa: E402
import soundfile as sf  # noqa: E402
import soxr  # noqa: E402
import torch  # noqa: E402

AST_ID = "MIT/ast-finetuned-audioset-10-10-0.4593"
CLAP_ID = "laion/larger_clap_general"
MAX_S = 10.0
SYNONYM_COS = 0.85

# Broad game/UI sound-effect vocabulary the prompt competes against.
DEFAULT_LABELS = [
    "an explosion", "a gunshot", "a laser blast", "a sword clash", "a metal impact", "a heavy thud",
    "a punch", "a wooden knock", "glass breaking", "a whoosh", "wind", "a water splash", "rain",
    "fire crackling", "an electric zap", "thunder", "a bell ringing", "a chime", "a coin pickup",
    "a power-up jingle", "a magic spell", "a UI click", "a button beep", "a notification ping",
    "an error buzzer", "a footstep", "a door slam", "a creaky door", "a car engine", "a jet engine",
    "a spaceship hum", "a monster growl", "a human scream", "a dog bark", "a bird chirp",
    "a synth tone", "a bass drop", "a drum hit", "a cymbal crash", "white noise", "static hiss",
    "a riser", "a rumble", "paper rustling", "a zipper", "a mechanical clank", "a robot servo",
]


def template(label: str) -> str:
    low = label.lower()
    return label if low.startswith(("the sound of", "a sound of", "sound of")) else f"the sound of {label}"


def load_mono(path: str) -> tuple[np.ndarray, int]:
    try:
        data, sr = sf.read(path, dtype="float32", always_2d=True)
    except Exception:
        import subprocess

        raw = subprocess.run(
            ["ffmpeg", "-v", "error", "-i", path, "-f", "f32le", "-ac", "1", "-ar", "48000", "-"],
            capture_output=True, check=True,
        ).stdout
        return np.frombuffer(raw, dtype=np.float32).copy(), 48000
    return data.mean(axis=1), sr


def resample(x: np.ndarray, sr: int, target: int) -> np.ndarray:
    return x if sr == target else soxr.resample(x, sr, target).astype(np.float32)


class Judge:
    def __init__(self) -> None:
        from transformers import ASTFeatureExtractor, ASTForAudioClassification, ClapModel, ClapProcessor

        torch.set_grad_enabled(False)
        self.ast_fx = ASTFeatureExtractor.from_pretrained(AST_ID)
        self.ast = ASTForAudioClassification.from_pretrained(AST_ID).eval()
        self.clap_proc = ClapProcessor.from_pretrained(CLAP_ID)
        self.clap = ClapModel.from_pretrained(CLAP_ID).eval()
        self._text_cache: dict[str, torch.Tensor] = {}

    def audioset(self, x16: np.ndarray, top: int) -> list[dict]:
        feats = self.ast_fx(x16, sampling_rate=16000, return_tensors="pt")
        probs = torch.sigmoid(self.ast(**feats).logits[0])
        idx = torch.argsort(probs, descending=True)[:top]
        return [{"label": self.ast.config.id2label[int(i)], "p": round(float(probs[i]), 3)} for i in idx]

    def text_emb(self, texts: list[str]) -> torch.Tensor:
        missing = [t for t in texts if t not in self._text_cache]
        if missing:
            inp = self.clap_proc(text=missing, return_tensors="pt", padding=True)
            embs = torch.nn.functional.normalize(self.clap.get_text_features(**inp), dim=-1)
            self._text_cache.update(zip(missing, embs))
        return torch.stack([self._text_cache[t] for t in texts])

    def clap_match(self, x48: np.ndarray, prompt: str | None, labels: list[str], top: int) -> dict:
        inp = self.clap_proc(audios=[x48], sampling_rate=48000, return_tensors="pt")
        a = torch.nn.functional.normalize(self.clap.get_audio_features(**inp), dim=-1)[0]
        if prompt:
            # Labels that mean the same as the prompt would split its probability; drop them.
            sims = self.text_emb([template(l) for l in labels]) @ self.text_emb([template(prompt)])[0]
            labels = [l for l, s in zip(labels, sims.tolist()) if s < SYNONYM_COS]
        cands = list(dict.fromkeys(([prompt] if prompt else []) + labels))
        cos = self.text_emb([template(c) for c in cands]) @ a
        probs = torch.softmax(cos * self.clap.logit_scale_a.exp(), dim=0)
        order = torch.argsort(probs, descending=True).tolist()
        out: dict = {"top": [{"label": cands[i], "p": round(float(probs[i]), 3), "cos": round(float(cos[i]), 3)} for i in order[:top]]}
        if prompt:
            rank = order.index(0) + 1
            out.update(prompt=prompt, prompt_cos=round(float(cos[0]), 3), prompt_p=round(float(probs[0]), 3), prompt_rank=rank, of=len(cands))
            out["verdict"] = "match" if rank == 1 else "ambiguous" if rank <= 3 else "mismatch"
        return out

    def run(self, path: str, prompt: str | None, labels: list[str], top: int) -> dict:
        x, sr = load_mono(path)
        x = x[: int(MAX_S * sr)]
        if not np.any(np.abs(x) > 1e-4):
            return {"file": path, "error": "silent"}
        return {
            "file": path,
            "audioset": self.audioset(resample(x, sr, 16000), top),
            "clap": self.clap_match(resample(x, sr, 48000), prompt, labels, top),
        }


def to_text(r: dict) -> str:
    if "error" in r:
        return f"{r['file']}: {r['error']}"
    lines = [r["file"]]
    lines.append("  AudioSet hears: " + ", ".join(f"{t['label']} {t['p']:.2f}" for t in r["audioset"]))
    c = r["clap"]
    lines.append("  CLAP closest:   " + ", ".join(f"{t['label']} {t['p']:.2f}" for t in c["top"]))
    if "prompt" in c:
        lines.append(
            f"  Prompt \"{c['prompt']}\": rank {c['prompt_rank']} of {c['of']}, p {c['prompt_p']:.2f}, cos {c['prompt_cos']:.2f} -> {c['verdict'].upper()}"
        )
    return "\n".join(lines)


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("files", nargs="*")
    ap.add_argument("--serve", action="store_true", help="Keep models loaded; read JSON requests {files, prompt?, alt?, top?} per line on stdin, answer one JSON line each.")
    ap.add_argument("--prompt", help="What the sound should be, e.g. 'a sword hitting a shield'.")
    ap.add_argument("--alt", nargs="*", help="Competing labels instead of the default SFX vocabulary.")
    ap.add_argument("--top", type=int, default=5)
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    if not args.files and not args.serve:
        ap.error("give audio files or --serve")
    judge = Judge()
    if args.serve:
        print(json.dumps({"ready": True}), flush=True)
        for line in sys.stdin:
            if not line.strip():
                continue
            try:
                req = json.loads(line)
                labels = req.get("alt") or DEFAULT_LABELS
                res = [judge.run(f, req.get("prompt"), labels, int(req.get("top", 5))) for f in req["files"]]
                print(json.dumps({"results": res}), flush=True)
            except Exception as e:  # keep serving after a bad request
                print(json.dumps({"error": f"{type(e).__name__}: {e}"}), flush=True)
        return
    labels = args.alt if args.alt else DEFAULT_LABELS
    results = [judge.run(f, args.prompt, labels, args.top) for f in args.files]
    if args.json:
        print(json.dumps({"results": results}, indent=2))
    else:
        print("\n\n".join(to_text(r) for r in results))


if __name__ == "__main__":
    main()
