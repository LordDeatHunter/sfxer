#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  analyze,
  compare,
  compareText,
  describeNode,
  docsMarkdown,
  expandRecipe,
  jsonSchema,
  NODE_NAMES,
  nodeMarkdown,
  parsePatch,
  PatchError,
  RECIPES,
  renderText,
  reportText,
  spectrogram,
  vary,
} from '@sfxer/core';
import { encodePng, judgeSync, judgeText, loadAudio, readPatchFile, renderToFile, UserError, writeSpectrogram } from './lib.js';

const HELP = `sfx - layered sound-effect synthesis

Workflow: pick a recipe -> render -> read the report -> edit the patch JSON -> render again.

  sfx recipes                                   list recipes and their parameters
  sfx recipe <name> [-p key=value ...] [-o patch.json] [--seed n]
                                                expand a recipe into an editable patch
  sfx render <patch.json> [-o out.wav] [--png] [--bits 16|24|32] [--prompt "what it should be"]
                                                render; -o may end in .ogg/.mp3/.flac (needs ffmpeg);
                                                --prompt also runs the judge on the result
  sfx analyze <audio> [--png]                   measure any audio file
  sfx compare <a> <b>                           describe how b differs from a
  sfx judge <audio...> [--prompt "..."] [--alt label ...] [--top 5]
                                                what it sounds like (AudioSet labels) and whether it
                                                matches the prompt (CLAP); needs the Python judge
  sfx vary <patch.json> [-n 6] [--amount 0.3] [-o dir] [--render]
                                                make variations (footsteps, repeated hits)
  sfx validate <patch.json>                     check a patch without rendering
  sfx docs [node]                               reference for everything, or one source/effect/recipe
  sfx schema [node]                             JSON Schema
  sfx audition <dir|files...> [-o page.html] [--serve] [--port 5180]
                                                build a listening page for a human; --serve hosts it
                                                with thumbs up/down + notes saved to ratings.json

Every command accepts --json for machine-readable output.`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: 'string', short: 'o' },
    param: { type: 'string', short: 'p', multiple: true },
    seed: { type: 'string' },
    png: { type: 'boolean' },
    bits: { type: 'string' },
    json: { type: 'boolean' },
    count: { type: 'string', short: 'n' },
    amount: { type: 'string' },
    render: { type: 'boolean' },
    prompt: { type: 'string' },
    alt: { type: 'string', multiple: true },
    top: { type: 'string' },
    serve: { type: 'boolean' },
    port: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  },
});

const print = (text: string, data: unknown): void => {
  process.stdout.write(`${values.json ? JSON.stringify(data, null, 2) : text}\n`);
};

const need = (index: number, what: string): string => {
  const v = positionals[index];
  if (!v) throw new UserError(`Missing ${what}. Run "sfx --help" for usage.`);
  return v;
};

const numberOpt = (name: 'seed' | 'count' | 'amount' | 'bits' | 'top' | 'port', fallback: number): number => {
  const raw = values[name];
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new UserError(`--${name} must be a number, got "${raw}".`);
  return n;
};

function parseParams(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const item of values.param ?? []) {
    const eq = item.indexOf('=');
    if (eq < 1) throw new UserError(`Parameters look like -p key=value, got "${item}".`);
    const raw = item.slice(eq + 1);
    const n = Number(raw);
    out[item.slice(0, eq)] = raw !== '' && Number.isFinite(n) ? n : raw === 'true' ? true : raw === 'false' ? false : raw;
  }
  return out;
}

const withExt = (path: string, ext: string): string => `${path.slice(0, path.length - extname(path).length)}${ext}`;

function cmdRender(): void {
  const file = need(1, 'patch file');
  const patch = readPatchFile(file);
  const out = values.out ?? withExt(file, '.wav');
  const bits = numberOpt('bits', 16);
  if (bits !== 16 && bits !== 24 && bits !== 32) throw new UserError('--bits must be 16, 24 or 32.');
  const w = renderToFile(patch, dirname(resolve(file)), out, { bits, ...(values.png ? { png: withExt(out, '.png') } : {}) });
  const judged = values.prompt ? judgeSync([w.wav], { prompt: values.prompt, alt: values.alt })[0] : undefined;
  print(
    [`wrote ${w.exported ?? w.wav}${w.exported ? ` (and ${w.wav})` : ''}${w.png ? `\nspectrogram ${w.png}` : ''}`, renderText(w.result), reportText(w.report), ...(judged ? [`judge:\n${judgeText([judged])}`] : [])].join('\n'),
    { file: w.exported ?? w.wav, wav: w.wav, spectrogram: w.png, layers: w.result.layers, render_warnings: w.result.warnings, normalize_gain_db: w.result.normalizeGainDb, report: w.report, ...(judged ? { judge: judged } : {}) },
  );
}

function cmdAnalyze(): void {
  const file = need(1, 'audio file');
  const a = loadAudio(file);
  const report = analyze(a.channels, a.sampleRate);
  let png: string | undefined;
  if (values.png) {
    png = values.out ?? withExt(file, '.png');
    writeSpectrogram(a.channels, a.sampleRate, png);
  }
  print(`${file}\n${png ? `spectrogram ${png}\n` : ''}${reportText(report)}`, { file, spectrogram: png, report });
}

function cmdCompare(): void {
  const a = loadAudio(need(1, 'first audio file'));
  const b = loadAudio(need(2, 'second audio file'));
  const c = compare(a.channels, a.sampleRate, b.channels, b.sampleRate);
  print(`A = ${positionals[1]}\nB = ${positionals[2]}\n${compareText(c)}`, c);
}

function cmdJudge(): void {
  need(1, 'audio file');
  const results = judgeSync(positionals.slice(1), { prompt: values.prompt, alt: values.alt, top: numberOpt('top', 5) });
  print(judgeText(results), { results });
}

function cmdRecipes(): void {
  const list = Object.values(RECIPES).map((r) => describeNode(r.name)!);
  print(
    list.map((d) => `${d.name}: ${d.description}\n${d.fields.map((f) => `    ${f.name}${f.options ? ` = ${f.options.join(' | ')}` : f.min !== undefined ? ` = ${f.min}..${f.max}` : ''} (default ${JSON.stringify(f.default)})`).join('\n')}`).join('\n\n'),
    list,
  );
}

function cmdRecipe(): void {
  const name = need(1, 'recipe name');
  const patch = expandRecipe(name, parseParams(), numberOpt('seed', 1));
  parsePatch(patch); // a recipe must never emit an invalid patch
  const text = JSON.stringify(patch, null, 2);
  if (values.out) {
    mkdirSync(dirname(resolve(values.out)), { recursive: true });
    writeFileSync(values.out, `${text}\n`);
    print(`wrote ${values.out} (${patch.layers.length} layers: ${patch.layers.map((l) => l.id).join(', ')})`, { file: values.out, patch });
  } else {
    process.stdout.write(`${text}\n`);
  }
}

function cmdVary(): void {
  const file = need(1, 'patch file');
  const patch = readPatchFile(file);
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  const dir = values.out ?? join(dirname(file), `${basename(file, extname(file))}_variations`);
  mkdirSync(dir, { recursive: true });
  const variants = vary(raw, { count: numberOpt('count', 6), amount: numberOpt('amount', 0.3), seed: numberOpt('seed', patch.seed) });
  const files = variants.map((v, i) => {
    const p = join(dir, `${basename(file, extname(file))}_v${i + 1}.json`);
    writeFileSync(p, `${JSON.stringify(v, null, 2)}\n`);
    if (!values.render) return { patch: p };
    const w = renderToFile(parsePatch(v), dirname(resolve(file)), withExt(p, '.wav'));
    return { patch: p, wav: w.wav, duration_ms: w.report.duration_ms, lufs: w.report.level.lufs, centroid_hz: w.report.spectrum.centroid_hz, warnings: [...w.result.warnings, ...w.report.warnings] };
  });
  print(files.map((f) => ('wav' in f ? `${f.wav}  ${f.duration_ms} ms, ${f.lufs} LUFS, centroid ${f.centroid_hz} Hz${f.warnings?.length ? `  ! ${f.warnings.join(' | ')}` : ''}` : f.patch)).join('\n'), { variations: files });
}

function cmdValidate(): void {
  const file = need(1, 'patch file');
  const patch = readPatchFile(file);
  print(`${file} is valid (${patch.layers.length} layers).`, { ok: true, layers: patch.layers.length });
}

function cmdDocs(): void {
  const name = positionals[1];
  if (!name) return print(docsMarkdown(), { nodes: NODE_NAMES().map((n) => describeNode(n)) });
  const doc = describeNode(name);
  if (!doc) throw new UserError(`Nothing called "${name}". Available: ${NODE_NAMES().join(', ')}`);
  print(nodeMarkdown(doc), doc);
}

function cmdSchema(): void {
  const schema = jsonSchema(positionals[1]);
  if (!schema) throw new UserError(`Nothing called "${positionals[1]}". Available: source, fx, ${NODE_NAMES().join(', ')}`);
  process.stdout.write(`${JSON.stringify(schema, null, 2)}\n`);
}

/** A self-contained page so a human can listen through a batch of renders. */
function cmdAudition(): void {
  const inputs = positionals.slice(1);
  if (!inputs.length) throw new UserError('Give a directory or a list of audio files.');
  const files = inputs.flatMap((p) =>
    statSync(p).isDirectory()
      ? readdirSync(p).filter((f) => /\.(wav|ogg|mp3|flac)$/i.test(f)).sort().map((f) => join(p, f))
      : [p],
  );
  if (!files.length) throw new UserError('No audio files found.');
  const out = values.out ?? 'audition.html';
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  const cards = files.map((f) => {
    const a = loadAudio(f);
    const r = analyze(a.channels, a.sampleRate);
    const mono = a.channels[0]!;
    const png = encodePng(spectrogram(mono, a.sampleRate)).toString('base64');
    const src = relative(dirname(resolve(out)), resolve(f)).replace(/\\/g, '/');
    return `<section data-file="${esc(src)}"><h2>${esc(basename(f))}</h2><audio controls preload="none" src="${esc(src)}"></audio>
<img alt="spectrogram" src="data:image/png;base64,${png}">
<p>${r.duration_ms} ms &middot; ${r.level.lufs} LUFS &middot; centroid ${r.spectrum.centroid_hz} Hz</p>
${r.warnings.map((w) => `<p class="warn">${esc(w)}</p>`).join('')}
<div class="rate"><button data-r="1" title="Good">&#128077;</button><button data-r="-1" title="Bad">&#128078;</button>
<input placeholder="What's off? (e.g. too clicky, reads as a laser, tail too long)"><span class="state"></span></div></section>`;
  });
  writeFileSync(
    out,
    `<!doctype html><meta charset="utf-8"><title>sfxer audition</title>
<style>body{font:14px system-ui;background:#14141c;color:#ddd;max-width:960px;margin:2rem auto;padding:0 1rem}
section{margin:0 0 2rem;padding:1rem;background:#1d1d29;border-radius:8px}h2{margin:0 0 .5rem;font-size:1rem}
audio{width:100%}img{width:100%;margin-top:.5rem;border-radius:4px}.warn{color:#f0b060;margin:.2rem 0}
.rate{display:flex;gap:.5rem;align-items:center;margin-top:.5rem}.rate button{font-size:1.1rem;background:#2a2a3a;border:2px solid transparent;border-radius:6px;padding:.2rem .6rem;cursor:pointer}
.rate button.on[data-r="1"]{border-color:#5c5}.rate button.on[data-r="-1"]{border-color:#e55}.rate input{flex:1;background:#14141c;color:#ddd;border:1px solid #333;border-radius:6px;padding:.4rem}
.state{color:#888;font-size:12px;min-width:5rem}.hint{color:#f0b060}</style>
<h1>sfxer audition (${files.length} sounds)</h1><p class="hint" id="hint" hidden>Opened as a file: ratings are not saved. Run <code>sfx audition ... --serve</code> to rate.</p>
${cards.join('\n')}
<script>
const api = location.protocol.startsWith('http');
if (!api) document.getElementById('hint').hidden = false;
const save = async (sec, patch) => {
  const st = sec.querySelector('.state');
  if (!api) { st.textContent = 'not saved'; return; }
  const r = await fetch('/rate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ file: sec.dataset.file, ...patch }) });
  st.textContent = r.ok ? 'saved' : 'error';
};
const show = (sec, rating) => sec.querySelectorAll('button').forEach((b) => b.classList.toggle('on', Number(b.dataset.r) === rating));
document.querySelectorAll('section[data-file]').forEach((sec) => {
  sec.querySelectorAll('button').forEach((b) => b.onclick = () => {
    const cur = sec.querySelector('button.on');
    const rating = cur === b ? 0 : Number(b.dataset.r);
    show(sec, rating); save(sec, { rating });
  });
  const inp = sec.querySelector('input');
  inp.onchange = () => save(sec, { note: inp.value });
});
if (api) fetch('/ratings').then((r) => r.json()).then((all) => {
  document.querySelectorAll('section[data-file]').forEach((sec) => {
    const x = all[sec.dataset.file]; if (!x) return;
    show(sec, x.rating); sec.querySelector('input').value = x.note || '';
    sec.querySelector('.state').textContent = x.stale ? 'rated an older render' : 'rated';
  });
});
</script>`,
  );
  print(`wrote ${out} (${files.length} sounds)`, { file: out, count: files.length });
  if (values.serve) serveAudition(out, files);
}

interface Rating {
  rating: number;
  note: string;
  at: string;
  /** mtime of the audio when rated; differs from the file's current mtime once it is re-rendered. */
  mtime_ms: number;
}

/** Serve the audition page and its audio, and record ratings to ratings.json next to the page. */
function serveAudition(page: string, files: string[]): void {
  const root = dirname(resolve(page));
  const store = join(root, 'ratings.json');
  const audio = new Map(files.map((f) => [relative(root, resolve(f)).replace(/\\/g, '/'), resolve(f)]));
  const load = (): Record<string, Rating> => (existsSync(store) ? (JSON.parse(readFileSync(store, 'utf8')) as Record<string, Rating>) : {});
  const types: Record<string, string> = { '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.flac': 'audio/flac' };
  const port = numberOpt('port', 5180);
  createServer((req, res) => {
    const url = decodeURIComponent((req.url ?? '/').split('?')[0]!);
    const json = (code: number, body: unknown) => res.writeHead(code, { 'content-type': 'application/json' }).end(JSON.stringify(body));
    if (req.method === 'GET' && url === '/') return res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(readFileSync(page));
    if (req.method === 'GET' && url === '/ratings') {
      const all = load();
      const view = Object.fromEntries(Object.entries(all).map(([k, v]) => [k, { ...v, stale: audio.has(k) && statSync(audio.get(k)!).mtimeMs !== v.mtime_ms }]));
      return json(200, view);
    }
    if (req.method === 'POST' && url === '/rate') {
      let body = '';
      req.on('data', (c: Buffer) => (body += c.toString()));
      req.on('end', () => {
        try {
          const msg = JSON.parse(body) as { file: string; rating?: number; note?: string };
          const path = audio.get(msg.file);
          if (!path) return json(404, { error: 'unknown file' });
          const all = load();
          const prev = all[msg.file] ?? { rating: 0, note: '' };
          all[msg.file] = { rating: msg.rating ?? prev.rating, note: msg.note ?? prev.note, at: new Date().toISOString(), mtime_ms: statSync(path).mtimeMs };
          writeFileSync(store, `${JSON.stringify(all, null, 2)}\n`);
          json(200, { ok: true });
        } catch (e) {
          json(400, { error: (e as Error).message });
        }
      });
      return;
    }
    const file = audio.get(url.slice(1));
    if (req.method === 'GET' && file) return res.writeHead(200, { 'content-type': types[extname(file).toLowerCase()] ?? 'application/octet-stream' }).end(readFileSync(file));
    json(404, { error: 'not found' });
  }).listen(port, '127.0.0.1', () => process.stdout.write(`listening on http://localhost:${port}  (ratings -> ${store}, Ctrl+C to stop)\n`));
}

const commands: Record<string, () => void> = {
  render: cmdRender,
  analyze: cmdAnalyze,
  compare: cmdCompare,
  judge: cmdJudge,
  recipes: cmdRecipes,
  recipe: cmdRecipe,
  vary: cmdVary,
  validate: cmdValidate,
  docs: cmdDocs,
  schema: cmdSchema,
  audition: cmdAudition,
};

try {
  const name = positionals[0];
  if (values.help || !name) {
    process.stdout.write(`${HELP}\n`);
  } else {
    const cmd = commands[name];
    if (!cmd) throw new UserError(`Unknown command "${name}". Commands: ${Object.keys(commands).join(', ')}`);
    cmd();
  }
} catch (e) {
  const err = e as Error;
  const known = err instanceof PatchError || err instanceof UserError || err.name === 'UnknownRecipeError' || err.name === 'MissingAssetError';
  if (values.json) {
    process.stdout.write(`${JSON.stringify({ error: { type: err.name, message: err.message, ...(err instanceof PatchError ? { issues: err.issues } : {}) } }, null, 2)}\n`);
  } else {
    process.stderr.write(`${known ? err.message : (err.stack ?? err.message)}\n`);
  }
  process.exitCode = 1;
}
