import { integratedLufs } from './analyze/loudness.js';
import { OnePole } from './dsp/filters.js';
import { limiter } from './fx/dynamics.js';
import { applyFx, fxTailMs } from './fx/index.js';
import { envEndMs, envEndsSilent, resolveParam } from './mod.js';
import type { Fx, Layer, Param, Patch } from './schema/index.js';
import { renderSource, sourceLengthMs, type Assets } from './sources/index.js';
import { panGains } from './sources/particles.js';
import { dbToGain, gainToDb, hash32, msToSamples, peakOf, Rng, round, sigAt, type Stereo } from './util.js';

export const SAMPLE_RATE = 48000;
const MAX_MS = 60000;
const FALLBACK_MS = 1000;

export interface LayerStat {
  id: string;
  source: string;
  /** Level of this layer's contribution before the master chain. */
  peak_db: number;
  rms_db: number;
  start_ms: number;
  end_ms: number;
}

export interface RenderResult {
  sampleRate: number;
  channels: Stereo;
  durationMs: number;
  layers: LayerStat[];
  /** Gain applied by loudness normalisation, dB. */
  normalizeGainDb: number;
  warnings: string[];
}

export interface RenderOptions {
  assets?: Assets;
  /** Render only these layers (by index); used for solo in the editor. */
  solo?: number[];
}

const subRng = (seed: number, a: number, b: number): Rng => new Rng(hash32(seed ^ hash32(a * 7919 + b * 104729 + 1)));

function paramMin(p: Param): number {
  if (typeof p === 'number') return p;
  if ('env' in p) return Math.min(...p.env.map((e) => e[1]));
  if ('lfo' in p) return p.base - Math.abs(p.lfo.depth);
  return p.base - Math.abs(p.random.depth);
}

function tailMs(fx: Fx[]): number {
  return fx.reduce((sum, f) => sum + fxTailMs(f), 0);
}

function layerBodyMs(layer: Layer, index: number, patch: Patch, assets: Assets, warnings: string[], extraMs: number): number {
  const natural = sourceLengthMs(layer.source, subRng(patch.seed, index, 0), SAMPLE_RATE, assets);
  const env = envEndsSilent(layer.amp) ? envEndMs(layer.amp) : undefined;
  let body: number;
  if (natural !== undefined && env !== undefined) body = Math.min(natural, env);
  else if (natural !== undefined) body = natural;
  else if (env !== undefined) body = env;
  else if (typeof patch.duration === 'number') body = Math.max(0, patch.duration + extraMs - layer.start_ms);
  else {
    body = FALLBACK_MS;
    warnings.push(
      `Layer "${layer.id ?? index}" (${layer.source.type}) never ends on its own; rendered ${FALLBACK_MS} ms. Give its "amp" an envelope that ends at 0, or set a numeric "duration".`,
    );
  }
  // Slowing playback with a pitch effect stretches the layer.
  for (const fx of layer.fx) {
    if (fx.type === 'pitch') {
      const lowest = paramMin(fx.semitones);
      if (lowest < 0) body *= Math.pow(2, -lowest / 12);
    }
  }
  return body;
}

export function render(patch: Patch, options: RenderOptions = {}): RenderResult {
  const sr = SAMPLE_RATE;
  const assets = options.assets ?? {};
  const warnings: string[] = [];
  const active = patch.layers
    .map((layer, index) => ({ layer, index }))
    .filter(({ layer, index }) => !layer.mute && (!options.solo || options.solo.includes(index)));

  // A loop renders a little extra, which is later crossfaded back onto the start.
  const loopXfMs = patch.master.loop && typeof patch.duration === 'number' ? Math.min(patch.duration / 4, 500) : 0;
  const spans = active.map(({ layer, index }) => {
    const body = layerBodyMs(layer, index, patch, assets, warnings, loopXfMs);
    return { body, end: layer.start_ms + body + tailMs(layer.fx) };
  });

  let totalMs =
    typeof patch.duration === 'number'
      ? patch.duration + loopXfMs
      : Math.max(10, ...spans.map((s) => s.end)) + tailMs(patch.master.fx) + 20;
  if (totalMs > MAX_MS) {
    warnings.push(`Sound would be ${Math.round(totalMs)} ms; capped at ${MAX_MS} ms.`);
    totalMs = MAX_MS;
  }
  const n = msToSamples(totalMs, sr);
  const mix: Stereo = [new Float32Array(n), new Float32Array(n)];
  const stats: LayerStat[] = [];

  active.forEach(({ layer, index }, a) => {
    const start = msToSamples(layer.start_ms, sr);
    const ln = n - start;
    if (ln <= 0) {
      warnings.push(`Layer "${layer.id ?? index}" starts after the sound ends and was skipped.`);
      return;
    }
    const ctx = { sr, n: ln, rng: subRng(patch.seed, index, 0), assets };
    const src = renderSource(layer.source, ctx);
    const buf: Stereo = src instanceof Float32Array ? [src, src.slice()] : src;

    const amp = resolveParam(layer.amp, ln, sr, subRng(patch.seed, index, 1), 0, 4);
    const anti = msToSamples(2, sr);
    // Sources that run forever are stopped at the end of the layer body.
    const bodyEnd = msToSamples(spans[a]!.body, sr);
    const gateFade = msToSamples(8, sr);
    for (const ch of buf) {
      for (let i = Math.max(0, bodyEnd - gateFade); i < ln; i++) {
        ch[i] = i >= bodyEnd ? 0 : ch[i]! * ((bodyEnd - i) / gateFade);
      }
      if (typeof amp === 'number') {
        if (amp !== 1) for (let i = 0; i < ln; i++) ch[i] = ch[i]! * amp;
      } else {
        for (let i = 0; i < ln; i++) ch[i] = ch[i]! * amp[i]!;
      }
      // A source that begins at full level would click; ease the first 2 ms unless an envelope already shapes it.
      if (typeof layer.amp === 'number' && (layer.source.type === 'osc' || layer.source.type === 'fm' || layer.source.type === 'noise')) {
        for (let i = 0; i < anti && i < ln; i++) ch[i] = ch[i]! * (i / anti);
      }
    }

    layer.fx.forEach((fx, j) => applyFx(buf, fx, { sr, n: ln, rng: subRng(patch.seed, index, 2 + j) }));

    const pan = resolveParam(layer.pan, ln, sr, subRng(patch.seed, index, 99), -1, 1);
    const g = dbToGain(layer.gain_db);
    let peak = 0;
    let sq = 0;
    const fixed = typeof pan === 'number' ? panGains(pan) : undefined;
    for (let i = 0; i < ln; i++) {
      const [gl, gr] = fixed ?? panGains(sigAt(pan, i));
      const l = buf[0][i]! * g * gl;
      const r = buf[1][i]! * g * gr;
      mix[0][start + i] = mix[0][start + i]! + l;
      mix[1][start + i] = mix[1][start + i]! + r;
      const p = Math.max(Math.abs(l), Math.abs(r));
      if (p > peak) peak = p;
      sq += 0.5 * (l * l + r * r);
    }
    const span = spans[a]!;
    const activeSamples = Math.max(1, Math.min(ln, msToSamples(span.end - layer.start_ms, sr)));
    stats.push({
      id: layer.id ?? `layer${index}`,
      source: layer.source.type,
      peak_db: round(gainToDb(peak), 1),
      rms_db: round(gainToDb(Math.sqrt(sq / activeSamples)), 1),
      start_ms: round(layer.start_ms, 1),
      end_ms: round(Math.min(span.end, totalMs), 1),
    });
    if (peak < 1e-5) warnings.push(`Layer "${layer.id ?? index}" is silent.`);
  });

  patch.master.fx.forEach((fx, j) => applyFx(mix, fx, { sr, n, rng: subRng(patch.seed, 1000, j) }));

  let out: Stereo = mix;
  // Remove any DC offset (combs and asymmetric distortion create it) and guard against bad numbers.
  for (const ch of out) {
    const dc = new OnePole(sr, 12);
    for (let i = 0; i < n; i++) ch[i] = Number.isFinite(ch[i]!) ? dc.hp(ch[i]!) : 0;
  }

  if (patch.master.mono) {
    for (let i = 0; i < n; i++) {
      const m = 0.5 * (out[0][i]! + out[1][i]!);
      out[0][i] = m;
      out[1][i] = m;
    }
  }

  if (loopXfMs > 0) {
    // Fold the overhang back onto the start with an equal-power crossfade.
    const len = msToSamples(patch.duration as number, sr);
    const xf = n - len;
    out = out.map((ch) => {
      const res = ch.slice(0, len);
      for (let i = 0; i < xf; i++) {
        const t = (i + 0.5) / xf;
        res[i] = ch[i]! * Math.sin((t * Math.PI) / 2) + ch[len + i]! * Math.cos((t * Math.PI) / 2);
      }
      return res;
    }) as Stereo;
  } else if (typeof patch.duration === 'number') {
    fadeOut(out, msToSamples(4, sr));
  } else if (patch.master.trim) {
    out = trimTail(out, sr);
  }

  let normalizeGainDb = 0;
  const peak = Math.max(peakOf(out[0]), peakOf(out[1]));
  if (peak < 1e-6) {
    warnings.push('The rendered sound is silent.');
  } else if (patch.master.normalize) {
    const { lufs, peak_db } = patch.master.normalize;
    normalizeGainDb = lufs - integratedLufs(out, sr);
    const over = normalizeGainDb - (peak_db - gainToDb(peak));
    // Peaks may be limited by up to 9 dB to reach the target; past that the sound would be audibly squashed.
    const MAX_LIMIT_DB = 9;
    if (over > MAX_LIMIT_DB) normalizeGainDb -= over - MAX_LIMIT_DB;
    const g = dbToGain(normalizeGainDb);
    for (const ch of out) for (let i = 0; i < ch.length; i++) ch[i] = ch[i]! * g;
    if (over > 0) {
      limiter(out, { type: 'limiter', ceiling_db: peak_db, release_ms: 60 }, { sr, n: out[0].length, rng: new Rng(1) });
      const reached = integratedLufs(out, sr);
      if (reached < lufs - 2) {
        warnings.push(
          `Loudness target ${lufs} LUFS not reached (got ${round(reached, 1)} LUFS): the sound is too peaky. Soften the transient, add body/sustain, or add a compressor or shaper on the master.`,
        );
      }
    }
  } else if (peak > 1) {
    warnings.push(`Output peaks at ${round(gainToDb(peak), 1)} dBFS and will clip. Enable master.normalize or add a limiter.`);
  }

  return {
    sampleRate: sr,
    channels: out,
    durationMs: round((out[0].length / sr) * 1000, 1),
    layers: stats,
    normalizeGainDb: round(normalizeGainDb, 2),
    warnings,
  };
}

function fadeOut(buf: Stereo, len: number): void {
  for (const ch of buf) {
    const n = ch.length;
    const m = Math.min(len, n);
    for (let i = 0; i < m; i++) ch[n - m + i] = ch[n - m + i]! * (1 - (i + 1) / m);
  }
}

/** Cut trailing audio below -66 dB relative to the peak, then fade the new end. */
function trimTail(buf: Stereo, sr: number): Stereo {
  const peak = Math.max(peakOf(buf[0]), peakOf(buf[1]));
  if (peak === 0) return buf;
  const floor = peak * 5e-4;
  let end = buf[0].length - 1;
  while (end > 0 && Math.abs(buf[0][end]!) < floor && Math.abs(buf[1][end]!) < floor) end--;
  const keep = Math.min(buf[0].length, end + 1 + msToSamples(12, sr));
  const out: Stereo = [buf[0].slice(0, keep), buf[1].slice(0, keep)];
  fadeOut(out, msToSamples(12, sr));
  return out;
}
