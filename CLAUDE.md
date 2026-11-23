# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

sfxer is a layered sound-effect engine meant to be driven by AI agents (CLI + MCP server), with a Svelte web app for humans. Every render returns a measured report, warnings and a spectrogram, because agents can't listen.

## Commands

Package manager is **bun** (not npm; `package-lock.json` is stale).

```
bun install
bun dev                  # web app on http://localhost:5173 — imports core from source, no build needed
bun start                # production web build + vite preview
bun run build            # tsc -b for core, cli, mcp (emits packages/*/dist)
bun run test             # vitest (all tests live in packages/core/test/engine.test.ts)
bun x vitest run -t "fft round-trips"   # single test by name
bun run check            # python scripts/check_all.py: build, tests, svelte-check, web build, regenerate examples, utility-class lint
bun sfx <cmd>            # CLI from packages/cli/dist (needs `bun run build` first)
bun run mcp              # MCP server (stdio) from packages/mcp/dist
```

Web type-check alone: `bun x svelte-check --tsconfig ./tsconfig.json` from `packages/web`.

The CLI and MCP server run from `dist/`, so rebuild after changing core before using them. `.mcp.json` registers the MCP server (`sfxer`) for Claude Code; after a rebuild it needs `/mcp` reconnect to pick up changes. The web app aliases `@sfxer/core` to `packages/core/src/index.ts` in `vite.config.ts`, so core edits hot-reload there.

`bun run freesound <search|fetch|get|sync|auth>` (`scripts/fetch_freesound.py`, stdlib Python) pulls CC0-only sounds from freesound.org into `sounds/cc0/` as reference material; needs `FREESOUND_API_KEY` in `.env` (see `.env.example`). Audio is gitignored, `sounds/cc0/manifest.json` is committed and `sync` restores the files. **CC0 only, and only as references to analyse, never as patch material**; the workflow is the `cc0-references` skill (`.claude/skills/cc0-references/SKILL.md`).

`scripts/make_examples.py` regenerates `examples/*.json` (one per recipe/kind) through the built CLI. `scripts/make_audition.py [--serve]` produces the audition page; with `--serve` (or `sfx audition ... --serve`) it is hosted on localhost:5180 with thumbs up/down and notes saved to `ratings.json` next to the page (`out/audition/ratings.json`). Read that file for the user's verdicts; `mtime_ms` that no longer matches the WAV means the rating is for an older render. `out/` is scratch output and is gitignored.

## Architecture

Bun workspaces: `core` ← `cli` ← `mcp`, and `core` ← `web`.

**The schema is the single source of truth.** `packages/core/src/schema/index.ts` defines the patch format with zod 4 (`Patch` → `master` + `layers[]`, each layer has a `source` and an `fx[]` chain; `Source` and `Fx` are discriminated unions on `type`). Validation (`schema/validate.ts`), TS types (`Patch` vs `PatchInput`), JSON Schema and `sfx docs` (`docs.ts`), and the web editor's controls are all derived from it via `.meta({ description, ... })`. Field descriptions are user/agent-facing docs, so write them carefully.

- Modulatable numbers use the `param()` helper: a plain number, or `{env, curve}`, `{lfo, base}`, or `{random, base}`. They are resolved to per-sample arrays in `mod.ts` (`resolveParam`).
- Adding a source or effect means: schema entry in the union → DSP implementation in `sources/` or `fx/` → a case in the `renderSource` / `applyFx` switch (and `sourceLengthMs` / `fxTailMs` if it has a natural length or tail) → minimal defaults in `packages/web/src/lib/nodes.ts` if it has required fields (and `ENDLESS` if it never stops on its own).

**Render pipeline** (`render.ts`, fixed 48 kHz): each layer's length is worked out from the source's natural length, its amp envelope or the patch duration (warning plus 1 s fallback if nothing ends it). Then source → layer fx → pan/gain → mix → master fx → DC removal → optional loop crossfade → loudness normalisation (limited to about 9 dB of peak limiting) → trim. Randomness is deterministic: everything derives from `patch.seed` via `Rng`/`hash32` with per-layer sub-seeds, so the same patch always renders identically. Keep that property.

**Analysis** (`analyze/`): `analyze` builds the report (bands, LUFS, etc.), `reportText`/`renderText` turn it into plain-language text for agents, `compare` diffs two sounds, `spectrogram` produces the image.

**Recipes** (`recipes/`): named builders (`impact`, `whoosh`, `ui`, …) with their own zod param schema that expand into a full editable `PatchInput`; the output is clamped back into schema ranges. Register new ones in `recipes/index.ts`. `vary.ts` makes seeded variations of a patch.

**Judge** (`judge/`, Python via `uv`, separate from the TS packages): `judge.py` runs AudioSet (AST) labels and a CLAP prompt match on audio files, one-shot or `--serve` (JSON lines). `packages/cli/src/judge.ts` bridges it: `judgeSync` for `sfx judge` / `render --prompt`, `JudgeServer` (persistent process) for the MCP `judge` tool and `render`'s `prompt`. Setup: `uv sync --project judge`; models download on first use (~1.5 GB, CPU).

**Match** (`match/`): approximates an uploaded sound as an editable patch by measurement only (deterministic). It is deliberately exposed **only in the web app**, never through the CLI or MCP.

**CLI** (`packages/cli`): `main.ts` is arg parsing/commands; `lib.ts` handles file IO (WAV/PNG, ffmpeg for other formats, patch files with sample paths relative to the patch). Every command supports `--json`. **MCP** (`packages/mcp/src/main.ts`) registers tools over the same core and CLI lib functions.

**Web** (`packages/web`, Svelte 5 runes + Tailwind v4): all engine work runs in a Web Worker (`lib/engine.worker.ts`), called through a typed request/response protocol (`lib/protocol.ts`, `lib/engine.ts`, with progress messages for Match). App state is in `lib/state.svelte.ts`.

## Conventions

- **Web styling rule (enforced by `bun run check`):** Svelte markup uses semantic class names only. Every class is defined in a sibling `.css` file using `@apply`. Tailwind utility classes in `class="..."` fail the check.
- TS is strict, with `exactOptionalPropertyTypes` and `verbatimModuleSyntax` (use `import type`, and `.js` extensions in relative imports in core/cli/mcp). `noUncheckedIndexedAccess` is turned off only in core, for DSP loops.
- `skill/SKILL.md` is the guide for agents using sfxer (recipe → render → read report → edit patch → re-render). Update it when the CLI, MCP tools or patch format change.
