---
name: sfxer
description: Design sound effects (impacts, whooshes, explosions, UI sounds, footsteps, pickups, magic, sci-fi, mechanisms, ambience loops, wet/gore/slime) as layered JSON patches and render them to WAV with the `sfx` CLI or the sfxer MCP tools. Use whenever a project needs a sound effect made, improved or varied.
---

# sfxer: making sound effects that do not sound like chiptune beeps

You cannot hear. sfxer makes up for that: every render returns a measured report with plain-language warnings, and an optional spectrogram image. **Never ship a sound whose report you have not read.**

## The loop

1. **Start from a recipe.** `sfx recipes` lists them with parameters.
   `sfx recipe impact -p material=metal -p size=0.3 -o hit.json`
2. **Render and read.** `sfx render hit.json --png --prompt "a sword hitting a shield"` writes `hit.wav` and `hit.png`, prints the report, and runs the judge (see below).
3. **Edit the patch JSON**, not the recipe call, once you need anything specific. Render again.
4. **Stop when** the warnings are gone (or you can justify each one), the numbers match the intent, and the judge says MATCH.
5. Need several takes (footsteps, repeated hits)? `sfx vary hit.json -n 6 --amount 0.3 --render`.

Other commands: `sfx analyze file.wav`, `sfx compare a.wav b.wav`, `sfx judge a.wav [--prompt ...] [--alt ...]`, `sfx validate patch.json`, `sfx docs [name]` (full reference, or one source/effect/recipe), `sfx schema [name]`. Add `--json` to any command for machine-readable output.

With MCP the same steps are tools: `list_recipes`, `expand_recipe`, `render` (takes `prompt`), `judge`, `analyze`, `compare`, `vary`, `describe`.

## Patch shape

```json
{
  "name": "metal_latch",
  "seed": 1,
  "duration": "auto",
  "layers": [
    { "id": "body", "source": { "type": "modal", "material": "metal", "size": 0.3 },
      "gain_db": 0, "fx": [ { "type": "eq", "high_db": 3 } ] },
    { "id": "tick", "source": { "type": "noise" },
      "amp": { "env": [[0, 1], [5, 0]], "curve": "exp" }, "gain_db": -8,
      "fx": [ { "type": "filter", "mode": "bandpass", "hz": 4000 } ] }
  ],
  "master": { "fx": [ { "type": "reverb", "size": 0.3, "mix": 0.12 } ], "normalize": { "lufs": -18 } }
}
```

- Units are in the key names: `hz`, `_ms`, `_db`, `semitones`. Anything else is 0..1.
- Any field the docs mark `mod` takes a number **or** `{ "env": [[ms, value], ...], "curve": "exp" }`, `{ "lfo": { "hz", "depth" }, "base" }`, or `{ "random": { "rate_hz", "depth" }, "base" }`.
- Envelope times are ms from the start of that layer. A layer with an endless source (`osc`, `fm`, `noise`, `particles`, `granular`) needs an `amp` envelope that ends at 0.
- `duration: "auto"` fits the layers plus reverb tails. Loudness is normalised for you; do not chase level with `gain_db`, use it only to balance layers against each other.
- Same patch + same `seed` = identical audio. Change `seed` for a free variation.
- Each layer gets its own random stream, so two identical `modal` layers still differ in pitch. For repeated hits on one object (knocks, steps), give the layers the same layer-level `seed` and vary them with strike, gain or filter instead.
- Validation errors name the JSON path and suggest the fix. Out-of-range values are errors, never silently clamped.

Sources: `modal` (struck objects: the workhorse), `particles` (many tiny events: debris, crackle, rain, sparkle; `kind: "bubble"` with `chirp_semitones` for liquid), `noise`, `osc`, `fm`, `pluck`, `impulse`, `sample` and `granular` (user WAV files).
Effects: `filter`, `eq`, `comb`, `formant`, `shaper`, `crush`, `chorus`, `delay`, `reverb`, `convolve`, `transient`, `compressor`, `limiter`, `width`, `pitch`, `gain`, `distance`.
Run `sfx docs <name>` before using one you have not used yet.

## What makes a sound effect sound real

1. **Layer it.** Most good effects are 3-5 layers with different jobs:
   - *transient*: the first 2-20 ms that says "something happened" (short filtered noise, an impulse, a hard modal strike)
   - *body*: the identity of the sound (modal object, filtered noise sweep, tonal element)
   - *weight*: low thump, a sine dropping in pitch over 20-60 ms, lightly saturated
   - *tail / detail*: debris, rattle, sparkle, air (`particles`), and the room
2. **Never leave an oscillator bare.** A lone `osc` with an envelope is the retro beep. Use `unison` with detune, run it through a moving `filter`, add `shaper`, or replace it with `modal` or `fm`.
3. **Move things.** Static sounds read as synthetic. Sweep filter `hz` with an `exp` envelope, let FM `index` fall over time, use `random` modulation for anything organic.
4. **Shape noise.** Noise is only useful after a `filter`, and the filter should usually move. Bandpass for whooshes and air, lowpass falling over time for blasts.
5. **Things in the world are struck, not switched on.** Use `modal` with the right `material`, `size`, `strike.hardness` and `damping` instead of tuning oscillators by hand.
6. **Small random events add life.** A quiet `particles` layer after an impact (debris), over a tone (sparkle) or under a step (grit) does more than any amount of EQ.
7. **Put it in a space.** Reverb `mix` 0.08-0.2 removes the "generated in a vacuum" feel; `convolve` with `box` or `tube` puts a sound inside an object; `distance` pushes it away.
8. **No swept sines under hits.** A sine dropping in pitch under a hit is a kick drum: it turns explosions, footsteps and knocks into drums. Use low-passed brown noise for weight instead. Likewise, a smoothly gliding buzz through a `formant` filter reads as a voice (kazoo, frog, groan).
9. **Excite bodies.** The `resonator` effect rings a material body (same model as `modal`) with any input: friction, scraping, rolling. `particles` with `regularity` near 1 makes an evenly spaced tick train whose `rate_hz` acts like a pitch (ratchets, engines, hinges).
10. **Wet sounds** (the `gore` recipe: squish, splat, squelch, slime, stab, crunch, gib, drip): liquid is `bubble` particles (a blip that rises in pitch, `chirp_semitones` 4-10); a squelch is a jittering pink-noise bandpass with fast irregular level flutter (`gain` with `random` at ~70 Hz) plus a dense film of tiny high bubbles, under a *swell*, not a hit. Loud tonal bubbles read as "magic spell", a steady dense crackle as "electric zap", a smooth narrow noise band as a whoosh; skip master saturation on soft wet sounds.
11. **Finish it.** A touch of `shaper` (3-6 dB) on the master glues layers; `transient` adds punch; leave `normalize` on.

## Reading the report

| You see | It means | Try |
|---|---|---|
| `one pure tone` warning | It is a beep | Add noise/modal layers, unison, filter movement, saturation |
| `Almost no energy above 4 kHz` | Dull, no definition | Add a bright transient, raise `strike.hardness`, `eq` `high_db` |
| Most energy below 120 Hz | Inaudible on phones and laptops | Add a mid layer, saturate the low layer so it has harmonics |
| Energy mostly above 8 kHz | Thin, harsh | Add body below 1 kHz, lowpass the hiss |
| `attack_ms` large on an impact | Soft, late | Shorten envelope attack, add a transient layer, `transient` fx |
| `ends abruptly` | Tail was cut | Let envelopes reach 0, lengthen `duration`, add reverb |
| `Loudness target not reached` | Too peaky to be loud | Lower the target for tiny clicks, or add body, `compressor`, `shaper` |
| `centroid_over_time` flat on a long sound | Static timbre | Envelope or `random` on a filter |
| Low `crest_db` (< 6) | Squashed | Less drive, less limiting |
| `layers` list shows a layer 30+ dB below the others | It is inaudible | Raise its `gain_db` or remove it |

Loudness guide: -16 LUFS for foreground game effects, -18 to -20 for common ones (pickups, steps), -22 to -26 for UI and ambience.

## The judge: does it sound like what you meant?

The report says whether a sound is technically healthy; it cannot say whether a "sword clash" actually reads as a sword clash. The judge does that with two pretrained audio models:

- **AudioSet hears**: the top labels from a 527-class classifier. This is roughly what a listener would name it. Generic labels ("Sound effect", "Music") mean it is not clearly anything.
- **CLAP**: your prompt is ranked against ~47 common SFX categories (or your own `--alt` labels). Rank 1 = MATCH, 2-3 = AMBIGUOUS, lower = MISMATCH, and it names what it reads as instead.

Use `--alt` to ask a narrow question: `sfx judge hit.wav --prompt metal --alt wood glass stone` checks the material only.

Treat it as one strong opinion, not ground truth: the models were trained on recorded audio, so they are harsh on stylised or retro sounds that are intentionally synthetic. A MISMATCH on a realistic target is a real problem; on a deliberately 8-bit coin it may not be. Short sounds (< 100 ms) are harder for both models. Needs `uv sync --project judge` once (~1.5 GB of models, CPU).

A human verdict beats both: `sfx audition dir --serve` hosts a page where the user rates each sound; read `ratings.json` next to the page (`rating` 1/-1, `note`, and `mtime_ms` to tell whether it rated the current render).

## Reference recordings (CC0 only)

To learn how a real sound is built, fetch reference recordings with `bun run freesound search|fetch|get` (see `.claude/skills/cc0-references/SKILL.md`). **Only CC0 (public domain) sounds, ever**; the fetcher enforces it. Use them to measure and compare (`sfx analyze --png`, `sfx compare`, `sfx judge` to calibrate a prompt), never as `sample`/`granular` sources in shipped patches.

If you can view images, open the PNG: a good effect shows a clear vertical edge at the start, energy across the spectrum, and visible movement over time. A horizontal line or two on a black background is a beep.
