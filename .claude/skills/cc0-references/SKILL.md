---
name: cc0-references
description: Fetch real reference recordings from freesound.org to study how a kind of sound is built before designing it in sfxer. CC0 (public domain) sounds ONLY. Use when designing a new sound category or recipe, when a sound does not read as what it should, or when the user asks to use Freesound / reference sounds.
---

# CC0 reference sounds from Freesound

## The rule: CC0 only, references only

- **Only Creative Commons 0 (public domain) sounds.** Never fetch, keep or use sounds under any other licence (Attribution, NonCommercial, Sampling+, ...), not even "just to listen". `scripts/fetch_freesound.py` filters the search to CC0 and checks every result's licence again before downloading; do not bypass it, edit that check, or download from Freesound any other way.
- **Use them as references, not material.** Analyse, compare and judge them to learn the components; then build the sound from sfxer's own sources. Do not put them in a patch as `sample` or `granular` sources, ship them, or commit the audio (`sounds/cc0/*` is gitignored; only `manifest.json` and `README.md` are tracked).
- **API only, small and targeted.** Freesound's API terms forbid scraping, masking identity and bulk copying. Fetch a handful of sounds per topic (roughly 10-20), not whole categories. Never write a scraper or fake a user agent.

## Setup

`FREESOUND_API_KEY` (and optionally `FREESOUND_CLIENT_ID`) in the repo-root `.env`; see `.env.example`. If it is missing, ask the user; never ask them to paste the key into the chat.

## Workflow

```
bun run freesound search "squelch" -n 8 --max-dur 4 --sort rating_desc   # look first, no download
bun run freesound get 148974 433832 ...                                   # download chosen ids
bun sfx analyze sounds/cc0/<file>.ogg --png                               # after bun run build
```

1. **Search a few phrasings** of the target ("squish", "squelch", "slime", "gore splat") and pick sounds that are short, clean and on-topic.
2. **Analyse each** with `sfx analyze --png` and look at the spectrogram: envelope shape (swell vs hit), where the energy sits, tonal vs noisy, discrete events vs a stream, pitch movement.
3. **Calibrate the judge** on the references: `sfx judge ref.ogg --prompt "..."`. If the real recordings do not MATCH a prompt, that prompt is not a fair target; pick one they do match. Note the AudioSet labels they get ("crunch", "tearing", ...); those are the qualities to reproduce.
4. **Break the sound into components** and build them from sfxer sources. Add an engine feature if a component cannot be made (e.g. the `bubble` particle kind came from this). A/B small variants side by side and judge them across several seeds, not just one.
5. **Compare** your render against a reference with `sfx compare ref.ogg mine.wav` for measured differences (resample first if the sample rates differ).
6. Write what you learned (what each component is, and what misleads the judge) into the recipe's comments and `skill/SKILL.md`.
