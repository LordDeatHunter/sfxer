#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  analyze,
  compare,
  compareText,
  describeNode,
  docsMarkdown,
  expandRecipe,
  NODE_NAMES,
  nodeMarkdown,
  parsePatch,
  RECIPES,
  renderText,
  reportText,
  spectrogram,
  toMono,
  vary,
  type Patch,
  type PatchInput,
} from '@sfxer/core';
import { encodePng, JudgeServer, judgeText, loadAudio, renderToFile, UserError } from '@sfxer/cli';
import { z } from 'zod';

type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };
type Result = { content: Content[]; isError?: boolean };

const text = (t: string): Content => ({ type: 'text', text: t });

/** Every tool reports failures as readable text so the agent can fix its input and retry. */
const safe = <A>(fn: (args: A) => Result | Promise<Result>) => async (args: A): Promise<Result> => {
  try {
    return await fn(args);
  } catch (e) {
    return { content: [text((e as Error).message)], isError: true };
  }
};

const patchArgs = {
  patch: z.record(z.string(), z.unknown()).optional().describe('The patch as a JSON object.'),
  patch_file: z.string().optional().describe('Path to a patch JSON file, instead of `patch`.'),
};

function resolvePatch(args: { patch?: Record<string, unknown> | undefined; patch_file?: string | undefined }): { patch: Patch; raw: PatchInput; baseDir: string; stem: string } {
  if (args.patch_file) {
    let raw: PatchInput;
    try {
      raw = JSON.parse(readFileSync(args.patch_file, 'utf8')) as PatchInput;
    } catch (e) {
      throw new UserError(`Cannot read patch file "${args.patch_file}": ${(e as Error).message}`);
    }
    return { patch: parsePatch(raw), raw, baseDir: dirname(resolve(args.patch_file)), stem: basename(args.patch_file, extname(args.patch_file)) };
  }
  if (!args.patch) throw new UserError('Give either `patch` (a JSON object) or `patch_file` (a path).');
  const patch = parsePatch(args.patch);
  return { patch, raw: args.patch as PatchInput, baseDir: process.cwd(), stem: patch.name.replace(/[^\w-]+/g, '_') };
}

const pngOf = (channels: Float32Array[], sr: number): Content => {
  const mono = channels.length >= 2 ? toMono([channels[0]!, channels[1]!]) : channels[0]!;
  return { type: 'image', data: encodePng(spectrogram(mono, sr)).toString('base64'), mimeType: 'image/png' };
};

/** Started on first use; keeps the CLAP/AudioSet models loaded between calls. */
const judge = new JudgeServer();

const server = new McpServer(
  { name: 'sfxer', version: '0.1.0' },
  {
    instructions:
      'Sound-effect design. Loop: list_recipes -> expand_recipe -> render (pass `prompt` describing the target sound) -> read the report, warnings and judge verdict -> edit the patch JSON -> render again. Call describe before using a source or effect for the first time. Never deliver a sound whose report you have not read; a judge MISMATCH means it most likely reads as something else.',
  },
);

server.registerTool(
  'list_recipes',
  { description: 'List the recipes (starting points) and their parameters.', inputSchema: {} },
  safe(() => ({ content: [text(Object.keys(RECIPES).map((n) => nodeMarkdown(describeNode(n)!)).join('\n\n'))] })),
);

server.registerTool(
  'expand_recipe',
  {
    description: 'Turn a recipe plus parameters into a full, editable patch. Returns the patch JSON; optionally writes it to a file.',
    inputSchema: {
      name: z.string().describe('Recipe name, e.g. "impact".'),
      params: z.record(z.string(), z.unknown()).optional().describe('Recipe parameters; omitted ones use defaults.'),
      seed: z.number().int().min(0).optional().describe('Random seed; change for a different take.'),
      out: z.string().optional().describe('Write the patch to this .json path.'),
    },
  },
  safe(({ name, params, seed, out }) => {
    const patch = expandRecipe(name, params ?? {}, seed ?? 1);
    parsePatch(patch);
    const json = JSON.stringify(patch, null, 2);
    if (out) {
      mkdirSync(dirname(resolve(out)), { recursive: true });
      writeFileSync(out, `${json}\n`);
    }
    return { content: [text(`${out ? `Wrote ${out}\n` : ''}${json}`)] };
  }),
);

server.registerTool(
  'render',
  {
    description:
      'Render a patch to a WAV file. Returns per-layer levels, the measured report with warnings, and a spectrogram image. Use an .ogg/.mp3/.flac extension on `out` for a compressed copy (needs ffmpeg).',
    inputSchema: {
      ...patchArgs,
      out: z.string().optional().describe('Output audio path. Defaults to <patch name>.wav in the working directory.'),
      spectrogram: z.boolean().optional().describe('Include the spectrogram image (default true).'),
      prompt: z
        .string()
        .optional()
        .describe('What the sound should be, e.g. "a sword hitting a shield". Also runs the judge: AudioSet labels and whether CLAP ranks the prompt first among common SFX categories.'),
    },
  },
  safe(async (args) => {
    const { patch, baseDir, stem } = resolvePatch(args);
    const w = renderToFile(patch, baseDir, args.out ?? `${stem}.wav`);
    const parts = [`Wrote ${w.exported ?? w.wav}`, renderText(w.result), reportText(w.report)];
    if (args.prompt) parts.push(`judge:\n${judgeText(await judge.judge([w.wav], { prompt: args.prompt }))}`);
    const content: Content[] = [text(parts.join('\n'))];
    if (args.spectrogram !== false) content.push(pngOf(w.result.channels, w.result.sampleRate));
    return { content };
  }),
);

server.registerTool(
  'validate',
  { description: 'Check a patch without rendering it.', inputSchema: patchArgs },
  safe((args) => {
    const { patch } = resolvePatch(args);
    return { content: [text(`Valid: ${patch.layers.length} layers (${patch.layers.map((l, i) => l.id ?? `layer${i}`).join(', ')}).`)] };
  }),
);

server.registerTool(
  'analyze',
  {
    description: 'Measure any audio file: level, loudness, envelope, spectrum, stereo, plus plain-language warnings and a spectrogram.',
    inputSchema: { file: z.string().describe('Audio file path.'), spectrogram: z.boolean().optional().describe('Include the spectrogram image (default true).') },
  },
  safe(({ file, spectrogram: wantPng }) => {
    const a = loadAudio(file);
    const content: Content[] = [text(reportText(analyze(a.channels, a.sampleRate)))];
    if (wantPng !== false) content.push(pngOf(a.channels, a.sampleRate));
    return { content };
  }),
);

server.registerTool(
  'judge',
  {
    description:
      'Semantic check, since you cannot listen: what a classifier hears (AudioSet labels) and whether the sound matches a text prompt (CLAP, ranked against common SFX categories or your own `alt` labels). Verdict MATCH / AMBIGUOUS / MISMATCH. The first call loads the models (~15 s).',
    inputSchema: {
      files: z.array(z.string()).min(1).describe('Audio files to judge.'),
      prompt: z.string().optional().describe('What the sound should be, e.g. "glass shattering".'),
      alt: z.array(z.string()).optional().describe('Competing labels instead of the built-in SFX vocabulary, e.g. ["metal", "wood", "glass"].'),
      top: z.number().int().min(1).max(20).optional().describe('How many labels to list (default 5).'),
    },
  },
  safe(async ({ files, prompt, alt, top }) => ({ content: [text(judgeText(await judge.judge(files, { prompt, alt, top })))] })),
);

server.registerTool(
  'compare',
  {
    description: 'Describe how audio file B differs from A (length, loudness, brightness, attack, decay, band balance) with a similarity score.',
    inputSchema: { a: z.string().describe('First audio file.'), b: z.string().describe('Second audio file.') },
  },
  safe(({ a, b }) => {
    const x = loadAudio(a);
    const y = loadAudio(b);
    return { content: [text(compareText(compare(x.channels, x.sampleRate, y.channels, y.sampleRate)))] };
  }),
);

server.registerTool(
  'vary',
  {
    description: 'Make several related takes of a patch (for footsteps, repeated hits). Writes patch files, and WAVs when `render` is true.',
    inputSchema: {
      ...patchArgs,
      count: z.number().int().min(1).max(32).optional().describe('How many takes (default 6).'),
      amount: z.number().min(0).max(1).optional().describe('0 = only the seed changes, 1 = clearly different (default 0.3).'),
      out_dir: z.string().optional().describe('Directory for the results (default <name>_variations).'),
      render: z.boolean().optional().describe('Also render each take to WAV (default true).'),
    },
  },
  safe((args) => {
    const { raw, patch, baseDir, stem } = resolvePatch(args);
    const dir = args.out_dir ?? `${stem}_variations`;
    mkdirSync(dir, { recursive: true });
    const lines = vary(raw, { count: args.count ?? 6, amount: args.amount ?? 0.3, seed: patch.seed }).map((v, i) => {
      const p = join(dir, `${stem}_v${i + 1}.json`);
      writeFileSync(p, `${JSON.stringify(v, null, 2)}\n`);
      if (args.render === false) return p;
      const w = renderToFile(parsePatch(v), baseDir, p.replace(/\.json$/, '.wav'));
      const warnings = [...w.result.warnings, ...w.report.warnings];
      return `${w.wav}: ${w.report.duration_ms} ms, ${w.report.level.lufs} LUFS, centroid ${w.report.spectrum.centroid_hz} Hz${warnings.length ? ` ! ${warnings.join(' | ')}` : ''}`;
    });
    return { content: [text(lines.join('\n'))] };
  }),
);

server.registerTool(
  'describe',
  {
    description: 'Reference for one source, effect, recipe or structure ("patch", "layer", "master"). With no name, returns the whole reference.',
    inputSchema: { name: z.string().optional().describe('e.g. "modal", "reverb", "impact", "layer".') },
  },
  safe(({ name }) => {
    if (!name) return { content: [text(docsMarkdown())] };
    const doc = describeNode(name);
    if (!doc) throw new UserError(`Nothing called "${name}". Available: ${NODE_NAMES().join(', ')}`);
    return { content: [text(nodeMarkdown(doc))] };
  }),
);

await server.connect(new StdioServerTransport());
