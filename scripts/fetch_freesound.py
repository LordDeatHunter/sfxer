"""Fetch public-domain (CC0) sounds from freesound.org into sounds/cc0/.

Stdlib only. Needs FREESOUND_API_KEY in the repo-root .env (see .env.example).
Every result is filtered to CC0 by the API and checked again before download.

  python scripts/fetch_freesound.py search "door knock" -n 10 --max-dur 3
  python scripts/fetch_freesound.py fetch "door knock" -n 5 --max-dur 3
  python scripts/fetch_freesound.py get 12345 67890
  python scripts/fetch_freesound.py sync          # re-download files listed in the manifest
  python scripts/fetch_freesound.py auth          # one-time OAuth2 login, only for --original

By default it downloads the HQ preview (~128 kbps ogg). --original downloads the uploaded
file (wav/flac/...), which Freesound only allows with OAuth2 (run `auth` first).

Writes only inside sounds/cc0/ and to .freesound_token.json at the repo root.
"""
import argparse
import json
import pathlib
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "sounds" / "cc0"
MANIFEST = OUT / "manifest.json"
TOKEN_FILE = ROOT / ".freesound_token.json"
API = "https://freesound.org/apiv2"
CC0_FILTER = 'license:"Creative Commons 0"'
FIELDS = "id,name,username,license,tags,description,duration,samplerate,channels,type,filesize,previews,url"


def load_env() -> dict[str, str]:
    env: dict[str, str] = {}
    path = ROOT / ".env"
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    import os
    for k in ("FREESOUND_API_KEY", "FREESOUND_CLIENT_ID"):
        if os.environ.get(k):
            env[k] = os.environ[k]
    return env


ENV = load_env()


def die(msg: str) -> None:
    print(f"error: {msg}", file=sys.stderr)
    sys.exit(1)


def api_key() -> str:
    key = ENV.get("FREESOUND_API_KEY")
    if not key:
        die("FREESOUND_API_KEY missing. Get one at https://freesound.org/apiv2/apply and put it in .env")
    return key


def request(url: str, *, headers: dict[str, str] | None = None, data: dict[str, str] | None = None) -> bytes:
    body = urllib.parse.urlencode(data).encode() if data is not None else None
    req = urllib.request.Request(url, data=body, headers={"User-Agent": "sfxer-fetcher", **(headers or {})})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < 3:  # throttled: 60 req/min, 2000/day on token auth
                time.sleep(15 * (attempt + 1))
                continue
            detail = e.read().decode(errors="replace")[:300]
            die(f"HTTP {e.code} for {url.split('?')[0]}: {detail}")
    raise AssertionError


def get_json(path: str, params: dict[str, str | int] | None = None) -> dict:
    params = {**(params or {}), "token": api_key()}
    return json.loads(request(f"{API}{path}?{urllib.parse.urlencode(params)}"))


def is_cc0(sound: dict) -> bool:
    return "publicdomain/zero" in sound.get("license", "")


def slug(name: str) -> str:
    s = re.sub(r"\.[A-Za-z0-9]{2,4}$", "", name)
    s = re.sub(r"[^A-Za-z0-9]+", "_", s).strip("_").lower()
    return s[:60] or "sound"


def load_manifest() -> dict[str, dict]:
    return json.loads(MANIFEST.read_text(encoding="utf-8")) if MANIFEST.exists() else {}


def save_manifest(m: dict[str, dict]) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    ordered = dict(sorted(m.items(), key=lambda kv: int(kv[0])))
    MANIFEST.write_text(json.dumps(ordered, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


# ---- OAuth2 (only needed for original files) ----

def save_token(tok: dict) -> None:
    tok["expires_at"] = time.time() + int(tok.get("expires_in", 86400)) - 60
    TOKEN_FILE.write_text(json.dumps(tok, indent=2), encoding="utf-8")


def token_request(data: dict[str, str]) -> dict:
    client_id = ENV.get("FREESOUND_CLIENT_ID") or die("FREESOUND_CLIENT_ID missing in .env (needed for --original)")
    return json.loads(request(f"{API}/oauth2/access_token/", data={"client_id": client_id, "client_secret": api_key(), **data}))


def access_token() -> str:
    if not TOKEN_FILE.exists():
        die("no OAuth token. Run: python scripts/fetch_freesound.py auth")
    tok = json.loads(TOKEN_FILE.read_text(encoding="utf-8"))
    if time.time() > tok.get("expires_at", 0):
        tok = token_request({"grant_type": "refresh_token", "refresh_token": tok["refresh_token"]})
        save_token(tok)
    return tok["access_token"]


def cmd_auth(_: argparse.Namespace) -> None:
    client_id = ENV.get("FREESOUND_CLIENT_ID") or die("FREESOUND_CLIENT_ID missing in .env")
    print("Open this URL, log in and authorize the app:\n")
    print(f"  {API}/oauth2/authorize/?client_id={client_id}&response_type=code\n")
    code = input("Paste the authorization code shown afterwards: ").strip()
    if not code:
        die("no code given")
    save_token(token_request({"grant_type": "authorization_code", "code": code}))
    print(f"saved {TOKEN_FILE.name} (refreshes itself; codes expire after 10 minutes, tokens after 24 h)")


# ---- search / download ----

def search(args: argparse.Namespace) -> list[dict]:
    filt = [CC0_FILTER]
    if args.min_dur is not None or args.max_dur is not None:
        lo = args.min_dur if args.min_dur is not None else 0
        hi = args.max_dur if args.max_dur is not None else "*"
        filt.append(f"duration:[{lo} TO {hi}]")
    if args.filter:
        filt.append(args.filter)
    res = get_json("/search/text/", {
        "query": args.query, "filter": " ".join(filt), "sort": args.sort,
        "fields": FIELDS, "page_size": min(args.n, 150),
    })
    sounds = [s for s in res.get("results", []) if is_cc0(s)]
    print(f"{res.get('count', 0)} CC0 matches for {args.query!r}, showing {len(sounds)}", file=sys.stderr)
    return sounds


def describe(s: dict) -> str:
    return f"{s['id']:>8}  {s['duration']:6.2f}s  {s.get('type', '?'):4}  {s['name'][:50]:50}  by {s['username']}"


def download(s: dict, original: bool, manifest: dict[str, dict]) -> None:
    if not is_cc0(s):
        print(f"skip {s['id']}: not CC0 ({s.get('license')})", file=sys.stderr)
        return
    if original:
        ext, url = s.get("type") or "wav", f"{API}/sounds/{s['id']}/download/"
        headers = {"Authorization": f"Bearer {access_token()}"}
    else:
        ext, url, headers = "ogg", s["previews"]["preview-hq-ogg"], {}
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"{s['id']}_{slug(s['name'])}.{ext}"
    if not path.exists():
        path.write_bytes(request(url, headers=headers))
        print(f"saved {path.relative_to(ROOT)}")
    else:
        print(f"have  {path.relative_to(ROOT)}")
    manifest[str(s["id"])] = {
        "file": path.name, "quality": "original" if original else "preview",
        "name": s["name"], "author": s["username"], "url": s["url"], "license": s["license"],
        "duration": s["duration"], "tags": s.get("tags", []),
        "description": (s.get("description") or "")[:500],
    }


def cmd_search(args: argparse.Namespace) -> None:
    sounds = search(args)
    if args.json:
        print(json.dumps(sounds, indent=2))
    else:
        for s in sounds:
            print(describe(s))


def cmd_fetch(args: argparse.Namespace) -> None:
    manifest = load_manifest()
    for s in search(args):
        download(s, args.original, manifest)
        save_manifest(manifest)


def cmd_get(args: argparse.Namespace) -> None:
    manifest = load_manifest()
    for sid in args.ids:
        download(get_json(f"/sounds/{int(sid)}/", {"fields": FIELDS}), args.original, manifest)
        save_manifest(manifest)


def cmd_sync(_: argparse.Namespace) -> None:
    manifest = load_manifest()
    missing = [sid for sid, e in manifest.items() if not (OUT / e["file"]).exists()]
    print(f"{len(manifest)} in manifest, {len(missing)} missing", file=sys.stderr)
    for sid in missing:
        s = get_json(f"/sounds/{int(sid)}/", {"fields": FIELDS})
        download(s, manifest[sid].get("quality") == "original", manifest)
        save_manifest(manifest)


def main() -> None:
    p = argparse.ArgumentParser(description="Fetch CC0 sounds from freesound.org into sounds/cc0/")
    sub = p.add_subparsers(dest="cmd", required=True)

    def search_opts(sp: argparse.ArgumentParser) -> None:
        sp.add_argument("query")
        sp.add_argument("-n", type=int, default=10, help="number of results (max 150)")
        sp.add_argument("--min-dur", type=float, help="minimum duration in seconds")
        sp.add_argument("--max-dur", type=float, help="maximum duration in seconds")
        sp.add_argument("--sort", default="score", choices=["score", "downloads_desc", "rating_desc", "duration_asc", "duration_desc", "created_desc"])
        sp.add_argument("--filter", help='extra Solr filter, e.g. \'tag:foley samplerate:48000\'')

    sp = sub.add_parser("search", help="list CC0 matches without downloading")
    search_opts(sp)
    sp.add_argument("--json", action="store_true")
    sp.set_defaults(func=cmd_search)

    sp = sub.add_parser("fetch", help="search and download the top matches")
    search_opts(sp)
    sp.add_argument("--original", action="store_true", help="download the original file (needs `auth`)")
    sp.set_defaults(func=cmd_fetch)

    sp = sub.add_parser("get", help="download specific sound ids")
    sp.add_argument("ids", nargs="+")
    sp.add_argument("--original", action="store_true")
    sp.set_defaults(func=cmd_get)

    sub.add_parser("sync", help="re-download files listed in manifest.json").set_defaults(func=cmd_sync)
    sub.add_parser("auth", help="OAuth2 login for original-quality downloads").set_defaults(func=cmd_auth)

    args = p.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
