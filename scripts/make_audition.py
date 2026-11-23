"""Render every patch in examples/ to out/audition/ and build a listening page.
Only writes inside out/audition/. Run: python scripts/make_audition.py [--serve]
--serve hosts the page with thumbs up/down + notes, saved to out/audition/ratings.json."""
import pathlib
import subprocess
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
root = pathlib.Path(__file__).resolve().parent.parent
cli = str(root / "packages" / "cli" / "dist" / "main.js")
dest = root / "out" / "audition"
dest.mkdir(parents=True, exist_ok=True)

warned = 0
for patch in sorted((root / "examples").glob("*.json")):
    r = subprocess.run(["bun", cli, "render", str(patch), "-o", str(dest / f"{patch.stem}.wav")], capture_output=True, text=True, encoding="utf-8")
    if r.returncode != 0:
        print("FAILED", patch.name, r.stderr.strip())
        continue
    notes = [l.strip() for l in r.stdout.splitlines() if l.strip().startswith("!")]
    warned += bool(notes)
    for n in notes:
        print(f"{patch.stem}: {n}")

page = dest / "audition.html"
r = subprocess.run(["bun", cli, "audition", str(dest), "-o", str(page)], capture_output=True, text=True, encoding="utf-8")
print(r.stdout.strip() or r.stderr.strip())
print(f"{warned} of the sounds carry warnings (listed above)")

if "--serve" in sys.argv:
    # Host the page with rating buttons; ratings are kept in out/audition/ratings.json across rebuilds.
    subprocess.run(["bun", cli, "audition", str(dest), "-o", str(page), "--serve"])
