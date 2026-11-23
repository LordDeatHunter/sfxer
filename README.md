# sfxer

A layered sound-effect engine built to be driven by AI agents, with a web app for humans.

Bfxr-style tools sound retro because every sound is one basic oscillator with one envelope. sfxer builds sounds the way a sound designer does: several layers (transient, body, weight, detail), physically-informed sources (struck objects, sprays of small events), moving filters, space, and mastering. Because an agent cannot hear, every render comes back with a measured report, plain-language warnings and a spectrogram.

## Setup

```
bun install
bun dev              # web app at http://localhost:5173 (no build needed)
bun run build        # core, CLI and MCP server
bun run test         # engine tests (vitest)
bun run check        # everything: build, tests, type-check, web build, examples
bun start            # production build of the web app, served locally
```

## For agents

Give the agent `skill/SKILL.md`. It explains the loop: recipe → render → read the report → edit the patch → render again.

**CLI**

```
bun sfx recipes
bun sfx recipe impact -p material=metal -p size=0.3 -o hit.json
bun sfx render hit.json --png
bun sfx vary hit.json -n 6 --render
bun sfx docs modal
```

Every command takes `--json`. `sfx audition <dir>` builds an HTML page for listening through a batch of renders.

**MCP server** (stdio): `bun packages/mcp/dist/main.js`, tools `list_recipes`, `expand_recipe`, `render`, `validate`, `analyze`, `compare`, `vary`, `describe`.

```json
{ "mcpServers": { "sfxer": { "command": "bun", "args": ["<repo>/packages/mcp/dist/main.js"] } } }
```

## For humans

```
bun dev              # http://localhost:5173
```

- **Library**: audition recipes and their parameters.
- **Editor**: layers, sources, effects, envelope curves, and the raw patch JSON (the same file agents use).
- **Variations**: several takes of the current sound.
- **Match**: drop in an existing sound and get an editable patch that approximates it. Measurement only, no AI; the same file always gives the same patch. This feature is deliberately not exposed to agents.

## Layout

| Path | What |
|---|---|
| `packages/core` | The engine: schemas, DSP, sources, effects, render, analysis, recipes, Match. Pure TypeScript, runs in Node and the browser. |
| `packages/cli` | The `sfx` command. |
| `packages/mcp` | MCP server over the same library. |
| `packages/web` | Svelte 5 + Tailwind v4 app. Markup uses semantic class names only; every class is defined with `@apply` in a `.css` file. |
| `skill/SKILL.md` | Agent guide. |
| `examples/` | One patch per recipe. |

The patch format is defined once, in `packages/core/src/schema/index.ts`. Validation, types, JSON Schema, `sfx docs` and the editor's controls are all generated from it.
