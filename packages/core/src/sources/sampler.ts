import { resample } from '../dsp/filters.js';
import { resolveParam } from '../mod.js';
import type { SourceOf } from '../schema/index.js';
import { msToSamples, sigAt, type Mono, type Stereo } from '../util.js';
import type { Asset, Ctx } from './index.js';
import { panGains } from './particles.js';

export class MissingAssetError extends Error {
  constructor(public readonly file: string) {
    super(`Sample file "${file}" was not provided. Load it and pass it in "assets", keyed by the same path used in the patch.`);
    this.name = 'MissingAssetError';
  }
}

function asset(ctx: Ctx, file: string): Asset {
  const a = ctx.assets[file];
  if (!a || a.channels.length === 0) throw new MissingAssetError(file);
  return a;
}

function sliceAsset(s: SourceOf<'sample'>, a: Asset): Float32Array[] {
  const from = Math.min(a.channels[0]!.length, msToSamples(s.start_ms, a.sr));
  const to = s.end_ms === undefined ? a.channels[0]!.length : Math.min(a.channels[0]!.length, msToSamples(s.end_ms, a.sr));
  return a.channels.slice(0, 2).map((c) => {
    const part = c.slice(from, Math.max(from, to));
    if (s.reverse) part.reverse();
    return part;
  });
}

export function sampleLengthMs(s: SourceOf<'sample'>, a: Asset | undefined): number | undefined {
  if (!a || !a.channels[0]) return undefined;
  const len = sliceAsset(s, a)[0]!.length;
  return ((len / a.sr) * 1000) / Math.pow(2, s.pitch_semitones / 12);
}

export function sample(s: SourceOf<'sample'>, ctx: Ctx): Mono | Stereo {
  const a = asset(ctx, s.file);
  const ratio = ctx.sr / a.sr / Math.pow(2, s.pitch_semitones / 12);
  const chans = sliceAsset(s, a).map((c) => {
    const r = resample(c, ratio);
    const out = new Float32Array(ctx.n);
    out.set(r.subarray(0, Math.min(r.length, ctx.n)));
    return out;
  });
  return chans.length >= 2 ? [chans[0]!, chans[1]!] : chans[0]!;
}

export function granular(s: SourceOf<'granular'>, ctx: Ctx): Stereo {
  const { n, sr, rng } = ctx;
  const a = asset(ctx, s.file);
  const src = a.channels[0]!;
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  const grainMs = resolveParam(s.grain_ms, n, sr, rng, 5, 500);
  const density = resolveParam(s.density_hz, n, sr, rng, 1, 400);
  const position = resolveParam(s.position, n, sr, rng, 0, 1);
  const pitch = resolveParam(s.pitch_semitones, n, sr, rng, -36, 36);
  let t = 0;
  while (t < n) {
    const i0 = Math.floor(t);
    const len = Math.min(n - i0, msToSamples(sigAt(grainMs, i0), sr));
    const rate = (a.sr / sr) * Math.pow(2, (sigAt(pitch, i0) + rng.bi() * s.pitch_jitter) / 12);
    const centre = (sigAt(position, i0) + rng.bi() * s.position_jitter) * (src.length - 1);
    const [gl, gr] = panGains(rng.bi() * s.spread);
    // Overlapping Hann grains sum to roughly density * grain length / 2; keep level steady.
    const overlap = Math.max(1, (sigAt(density, i0) * sigAt(grainMs, i0)) / 2000);
    const g = 1 / Math.sqrt(overlap);
    for (let i = 0; i < len; i++) {
      const pos = centre + (i - len / 2) * rate;
      if (pos < 0 || pos >= src.length - 1) continue;
      const p0 = Math.floor(pos);
      const y = (src[p0]! + (src[p0 + 1]! - src[p0]!) * (pos - p0)) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / len)) * g;
      L[i0 + i] = L[i0 + i]! + y * gl;
      R[i0 + i] = R[i0 + i]! + y * gr;
    }
    t += (sr / sigAt(density, i0)) * (0.5 + rng.next());
  }
  return [L, R];
}
