# CC0 sounds

Public-domain (Creative Commons 0) reference sounds from [freesound.org](https://freesound.org),
fetched with `scripts/fetch_freesound.py` (or `bun run freesound ...`).

- `manifest.json` (committed) lists every sound: id, author, source URL, license, tags, file name.
- The audio files themselves are gitignored. `bun run freesound sync` downloads them again from the manifest.
- Only CC0 sounds are fetched: the search is filtered to CC0 and each result's license is checked again before download.
  CC0 needs no attribution, but the manifest keeps author and URL anyway.

```
bun run freesound search "door knock" -n 10 --max-dur 3
bun run freesound fetch "door knock" -n 5 --max-dur 3
bun run freesound get 12345
bun run freesound sync
```

Files are HQ previews (ogg, ~128 kbps) unless fetched with `--original`, which needs a one-time
`bun run freesound auth` (OAuth2) and `FREESOUND_CLIENT_ID` in `.env`.
