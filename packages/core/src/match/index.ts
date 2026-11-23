import { spectralDistance } from '../analyze/compare.js';
import { integratedLufs } from '../analyze/loudness.js';
import { stft, type Stft } from '../dsp/fft.js';
import { resample } from '../dsp/filters.js';
import { render, SAMPLE_RATE } from '../render.js';
import type { LayerInput, PatchInput } from '../schema/index.js';
import { parsePatch } from '../schema/validate.js';
import { clamp, peakOf, round, toMono } from '../util.js';

/**
 * Match: approximate an existing sound with a patch, by measurement only.
 * No machine learning and no randomness: the same file always gives the same patch.
 *
 * The sound is split into what the engine can express:
 *   - steady resonances      -> a `modal` layer with an explicit mode list
 *   - a dominant moving tone -> an `osc` layer with pitch and level envelopes
 *   - everything else        -> `noise` layers, one per octave band, each with its own envelope
 * Layer levels are then calibrated against the original and refined by a small search.
 */

export interface MatchResult {
  patch: PatchInput;
  /** 0-100; see `compare`. */
  similarity: number;
  spectral_distance_db: number;
  /** What was detected and how far to trust it. */
  notes: string[];
}

export interface MatchOptions {
  /** Called with 0..1 as the work proceeds. */
  onProgress?: (fraction: number, stage: string) => void;
  /** Skip the refinement search (much faster, slightly worse). */
  quick?: boolean;
}

const SIZE = 1024;
const HOP = 128;
const BAND_CENTRES = [90, 180, 360, 720, 1440, 2880, 5760, 11520];
const MAX_MS = 15000;

type Pt = [number, number];

/** Reduce a curve to its most important points (Ramer-Douglas-Peucker). */
function simplify(points: Pt[], tolerance: number, maxPoints: number): Pt[] {
  if (points.length <= 2) return points;
  let tol = tolerance;
  for (;;) {
    const keep = new Uint8Array(points.length);
    keep[0] = 1;
    keep[points.length - 1] = 1;
    const stack: [number, number][] = [[0, points.length - 1]];
    while (stack.length) {
      const [a, b] = stack.pop()!;
      const [x0, y0] = points[a]!;
      const [x1, y1] = points[b]!;
      let worst = 0;
      let idx = -1;
      for (let i = a + 1; i < b; i++) {
        const [x, y] = points[i]!;
        const d = Math.abs(y - (y0 + ((y1 - y0) * (x - x0)) / (x1 - x0 || 1)));
        if (d > worst) {
          worst = d;
          idx = i;
        }
      }
      if (idx >= 0 && worst > tol) {
        keep[idx] = 1;
        stack.push([a, idx], [idx, b]);
      }
    }
    const out = points.filter((_, i) => keep[i]);
    if (out.length <= maxPoints) return out;
    tol *= 1.5;
  }
}

const frameMs = (f: number): number => (f * HOP * 1000) / SAMPLE_RATE;

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s[s.length >> 1] ?? 0;
}

interface Peak {
  bin: number;
  hz: number;
  db: number;
  decay_ms: number;
}

/** Find resonances that hold a steady frequency, and how fast each one dies away. */
function findModes(S: Stft, maxModes: number): Peak[] {
  const bins = SIZE / 2 + 1;
  const hold = new Float32Array(bins);
  const at = new Int32Array(bins);
  S.frames.forEach((fr, f) => {
    for (let k = 0; k < bins; k++) {
      if (fr[k]! > hold[k]!) {
        hold[k] = fr[k]!;
        at[k] = f;
      }
    }
  });
  const top = peakOf(hold);
  const cands: { k: number; m: number }[] = [];
  for (let k = 2; k < bins - 2; k++) {
    const m = hold[k]!;
    if (m < top * 0.004 || m <= hold[k - 1]! || m < hold[k + 1]! || m <= hold[k - 2]! || m < hold[k + 2]!) continue;
    const around: number[] = [];
    for (let j = Math.max(1, k - 14); j <= Math.min(bins - 1, k + 14); j++) if (Math.abs(j - k) > 2) around.push(hold[j]!);
    if (m > 3 * median(around)) cands.push({ k, m });
  }
  cands.sort((a, b) => b.m - a.m);
  const peaks: Peak[] = [];
  for (const c of cands.slice(0, maxModes)) {
    // Refine the frequency by parabolic interpolation at the loudest frame.
    const fr = S.frames[at[c.k]!]!;
    const a = Math.log(fr[c.k - 1]! + 1e-12);
    const b = Math.log(fr[c.k]! + 1e-12);
    const d = Math.log(fr[c.k + 1]! + 1e-12);
    const denom = a - 2 * b + d;
    const hz = ((c.k + (denom !== 0 ? (0.5 * (a - d)) / denom : 0)) * SAMPLE_RATE) / SIZE;
    // Fit a straight line to the level in dB after the loudest frame: its slope is the decay rate.
    const xs: number[] = [];
    const ys: number[] = [];
    for (let f = at[c.k]! + 2; f < S.frames.length; f++) {
      const m = Math.max(S.frames[f]![c.k - 1]!, S.frames[f]![c.k]!, S.frames[f]![c.k + 1]!);
      const dbv = 20 * Math.log10(m / c.m + 1e-9);
      if (dbv < -45) break;
      xs.push(frameMs(f - at[c.k]!));
      ys.push(dbv);
    }
    let decay_ms = 40;
    if (xs.length >= 3) {
      const mx = xs.reduce((s, v) => s + v, 0) / xs.length;
      const my = ys.reduce((s, v) => s + v, 0) / ys.length;
      let num = 0;
      let den = 0;
      for (let i = 0; i < xs.length; i++) {
        num += (xs[i]! - mx) * (ys[i]! - my);
        den += (xs[i]! - mx) ** 2;
      }
      const slope = den > 0 ? num / den : -1;
      decay_ms = slope < -1e-4 ? clamp(-60 / slope, 8, 20000) : 20000;
    }
    if (hz >= 25 && hz < SAMPLE_RATE * 0.42) peaks.push({ bin: c.k, hz, db: 20 * Math.log10(c.m / top), decay_ms });
  }
  return peaks;
}

interface Tone {
  hz: Pt[];
  amp: Pt[];
  /** Level of the 2nd and 3rd harmonics relative to the fundamental, dB. */
  harmonics_db: number;
  mask: Int32Array;
}

/** Detect a single dominant tone whose pitch may move (sweeps, chirps, sustained notes). */
function findTone(S: Stft): Tone | undefined {
  const bins = SIZE / 2 + 1;
  const loud = Math.max(...S.frames.map((fr) => peakOf(fr)));
  const mask = new Int32Array(S.frames.length).fill(-1);
  const track: { f: number; hz: number; mag: number }[] = [];
  let active = 0;
  let harm = 0;
  let fund = 0;
  S.frames.forEach((fr, f) => {
    let k = 1;
    let total = 0;
    for (let j = 1; j < bins; j++) {
      total += fr[j]! * fr[j]!;
      if (fr[j]! > fr[k]!) k = j;
    }
    if (fr[k]! < loud * 0.03) return;
    active++;
    let own = 0;
    for (let j = Math.max(1, k - 2); j <= Math.min(bins - 1, k + 2); j++) own += fr[j]! * fr[j]!;
    // Count harmonics as part of the same tone.
    let series = own;
    for (const h of [2, 3, 4]) for (let j = h * k - 2; j <= h * k + 2 && j < bins; j++) series += fr[j]! * fr[j]!;
    if (series / total < 0.75 || k < 2 || k >= bins - 2) return;
    const a = Math.log(fr[k - 1]! + 1e-12);
    const b = Math.log(fr[k]! + 1e-12);
    const d = Math.log(fr[k + 1]! + 1e-12);
    const denom = a - 2 * b + d;
    track.push({ f, hz: ((k + (denom !== 0 ? (0.5 * (a - d)) / denom : 0)) * SAMPLE_RATE) / SIZE, mag: fr[k]! });
    mask[f] = k;
    fund += own;
    harm += series - own;
  });
  if (active < 4 || track.length < active * 0.6) return undefined;
  // A struck object also has one loudest partial per frame, but it hops between partials or stays put.
  // Only call it a tone when the pitch glides smoothly and actually goes somewhere.
  let jumps = 0;
  for (let i = 1; i < track.length; i++) {
    const r = track[i]!.hz / track[i - 1]!.hz;
    if (r > 1.12 || r < 0.89) jumps++;
  }
  const lowest = Math.min(...track.map((t) => t.hz));
  const highest = Math.max(...track.map((t) => t.hz));
  if (jumps > Math.max(2, track.length * 0.05) || highest / lowest < 1.06) return undefined;
  const top = Math.max(...track.map((t) => t.mag));
  const end = frameMs(S.frames.length);
  const hz = simplify(track.map((t): Pt => [frameMs(t.f), Math.log2(t.hz)]), 0.04, 12).map(([t, v]): Pt => [round(t, 1), round(clamp(Math.pow(2, v), 20, 18000), 1)]);
  const ampRaw: Pt[] = [[0, 0], ...track.map((t): Pt => [frameMs(t.f) + 2, t.mag / top]), [end, 0]];
  const amp = simplify(ampRaw, 0.04, 14).map(([t, v]): Pt => [round(t, 1), round(v, 3)]);
  return { hz, amp, harmonics_db: 10 * Math.log10(harm / fund + 1e-9), mask };
}

/** Energy of each octave band over time, ignoring bins claimed by tonal components. */
function bandEnvelopes(S: Stft, skipBins: Set<number>, toneMask?: Int32Array): Float32Array[] {
  const bins = SIZE / 2 + 1;
  const hzPerBin = SAMPLE_RATE / SIZE;
  return BAND_CENTRES.map((c) => {
    const lo = Math.max(1, Math.floor(c / Math.SQRT2 / hzPerBin));
    const hi = Math.min(bins - 1, Math.ceil((c * Math.SQRT2) / hzPerBin));
    const env = new Float32Array(S.frames.length);
    S.frames.forEach((fr, f) => {
      let e = 0;
      const t = toneMask ? toneMask[f]! : -1;
      for (let k = lo; k <= hi; k++) {
        if (skipBins.has(k)) continue;
        if (t > 0 && [1, 2, 3, 4].some((h) => Math.abs(k - h * t) <= 3)) continue;
        e += fr[k]! * fr[k]!;
      }
      env[f] = Math.sqrt(e);
    });
    return env;
  });
}

const sumSq = (env: Float32Array): number => {
  let e = 0;
  for (let i = 0; i < env.length; i++) e += env[i]! * env[i]!;
  return e;
};

function regionEnergy(x: Float32Array, lo: number, hi: number, bins?: Set<number>): number {
  const S = stft(x, SAMPLE_RATE, SIZE, HOP * 2);
  const hzPerBin = SAMPLE_RATE / SIZE;
  let e = 0;
  for (const fr of S.frames) {
    if (bins) for (const k of bins) e += fr[k]! * fr[k]!;
    else for (let k = Math.max(1, Math.floor(lo / hzPerBin)); k <= Math.min(SIZE / 2, Math.ceil(hi / hzPerBin)); k++) e += fr[k]! * fr[k]!;
  }
  return e;
}

export function match(channels: Float32Array[], sampleRate: number, options: MatchOptions = {}): MatchResult {
  const progress = options.onProgress ?? (() => {});
  const notes: string[] = [];
  if (!channels[0] || channels[0].length === 0) throw new Error('The audio file is empty.');

  // ---- prepare: mono, engine sample rate, trimmed, peak-normalised
  progress(0, 'reading');
  let x = channels.length >= 2 ? toMono([channels[0], channels[1]!]) : channels[0].slice();
  if (sampleRate !== SAMPLE_RATE) x = resample(x, SAMPLE_RATE / sampleRate);
  const lufs = clamp(integratedLufs([x], SAMPLE_RATE), -40, -6);
  const peak = peakOf(x);
  if (peak < 1e-5) throw new Error('The audio file is silent.');
  let start = 0;
  while (start < x.length && Math.abs(x[start]!) < peak * 0.01) start++;
  let end = x.length;
  while (end > start && Math.abs(x[end - 1]!) < peak * 0.001) end--;
  start = Math.max(0, start - 48);
  if ((end - start) / SAMPLE_RATE > MAX_MS / 1000) {
    end = start + (MAX_MS / 1000) * SAMPLE_RATE;
    notes.push(`Only the first ${MAX_MS / 1000} seconds were matched.`);
  }
  x = x.slice(start, end);
  for (let i = 0; i < x.length; i++) x[i] = x[i]! / peak;
  const durationMs = Math.max(20, Math.round((x.length / SAMPLE_RATE) * 1000));

  // ---- analyse
  progress(0.1, 'analysing');
  const S = stft(x, SAMPLE_RATE, SIZE, HOP);
  const tone = findTone(S);
  const modes = tone ? [] : findModes(S, 40);
  const modeBins = new Set<number>();
  for (const m of modes) for (let k = m.bin - 2; k <= m.bin + 2; k++) modeBins.add(k);
  const bands = bandEnvelopes(S, modeBins, tone?.mask);

  const layers: LayerInput[] = [];
  const regions: ({ lo: number; hi: number; bins?: Set<number>; band?: number } | undefined)[] = [];

  if (tone) {
    const shape = tone.harmonics_db < -22 ? 'sine' : tone.harmonics_db < -10 ? 'triangle' : 'saw';
    layers.push({ id: 'tone', source: { type: 'osc', shape, hz: { env: tone.hz, curve: 'exp' } }, amp: { env: tone.amp, curve: 'linear' } });
    const lo = Math.min(...tone.hz.map((p) => p[1]));
    const hi = Math.max(...tone.hz.map((p) => p[1]));
    regions.push({ lo: lo * 0.9, hi: hi * (shape === 'sine' ? 1.1 : 4.4) });
    notes.push(`Found one dominant ${shape === 'sine' ? 'pure' : 'harmonic'} tone moving between ${Math.round(lo)} and ${Math.round(hi)} Hz.`);
  } else if (modes.length) {
    layers.push({
      id: 'resonances',
      source: { type: 'modal', modes: modes.map((m) => ({ hz: round(m.hz, 1), gain_db: round(Math.max(-60, m.db), 1), decay_ms: Math.round(m.decay_ms) })) },
    });
    regions.push({ lo: 0, hi: 0, bins: modeBins });
    notes.push(`Found ${modes.length} steady resonances (${Math.round(Math.min(...modes.map((m) => m.hz)))}-${Math.round(Math.max(...modes.map((m) => m.hz)))} Hz).`);
  }

  const bandPeak = Math.max(...bands.map((b) => peakOf(b)), 1e-9);
  let noiseBands = 0;
  bands.forEach((envl, i) => {
    const p = peakOf(envl);
    if (p < bandPeak * 0.02) return;
    const pts: Pt[] = [[0, envl[0]! / p]];
    for (let f = 1; f < envl.length; f++) pts.push([frameMs(f), envl[f]! / p]);
    pts.push([Math.max(frameMs(envl.length), durationMs), 0]);
    const envPts = simplify(pts, 0.035, 14).map(([t, v]): Pt => [round(t, 1), round(clamp(v, 0, 1), 3)]);
    const c = BAND_CENTRES[i]!;
    layers.push({
      id: `noise_${c}hz`,
      source: { type: 'noise', color: 'white' },
      amp: { env: envPts, curve: 'linear' },
      fx: [{ type: 'filter', mode: 'bandpass', hz: c, q: 1.4, slope: 24 }],
    });
    regions.push({ lo: c / Math.SQRT2, hi: c * Math.SQRT2, band: i });
    noiseBands++;
  });
  if (noiseBands) notes.push(`Modelled the non-tonal part as ${noiseBands} bands of shaped noise.`);
  if (!layers.length) throw new Error('Nothing measurable was found in this file.');

  const patch: PatchInput = {
    name: 'matched',
    seed: 1,
    duration: durationMs,
    layers,
    master: { fx: [], normalize: { lufs: round(lufs, 1), peak_db: -1 }, trim: false },
  };

  // ---- calibrate each layer's level against the same region of the original
  progress(0.3, 'calibrating levels');
  const renderMono = (p: PatchInput, solo?: number[]): Float32Array => {
    const r = render(parsePatch({ ...p, master: { ...p.master, normalize: false } }), solo ? { solo } : {});
    return toMono(r.channels);
  };
  const gains: number[] = [];
  layers.forEach((_layer, i) => {
    const region = regions[i]!;
    const own = renderMono(patch, [i]);
    let target: number;
    let got: number;
    if (region.band !== undefined) {
      // Compare like with like: the same band, with the same tonal bins left out on both sides.
      target = sumSq(bands[region.band]!);
      got = sumSq(bandEnvelopes(stft(own, SAMPLE_RATE, SIZE, HOP), modeBins, tone?.mask)[region.band]!);
    } else if (region.bins) {
      target = regionEnergy(x, 0, 0, region.bins);
      got = regionEnergy(own, 0, 0, region.bins);
    } else {
      target = regionEnergy(x, region.lo, region.hi);
      got = regionEnergy(own, region.lo, region.hi);
    }
    gains.push(10 * Math.log10((target + 1e-12) / (got + 1e-12)));
  });
  // Layer gains are only meaningful relative to each other; put the loudest at 0 dB.
  const ref = Math.max(...gains);
  layers.forEach((l, i) => (l.gain_db = round(clamp(gains[i]! - ref, -80, 0), 1)));

  // Correct each resonance individually: short decays read low in a windowed spectrum.
  const modalIdx = layers.findIndex((l) => l.source.type === 'modal');
  if (modalIdx >= 0) {
    const src = layers[modalIdx]!.source as { modes: { hz: number; gain_db: number; decay_ms: number }[] };
    for (let pass = 0; pass < 2; pass++) {
      const own = renderMono(patch, [modalIdx]);
      src.modes.forEach((m, j) => {
        const bins = new Set([modes[j]!.bin - 1, modes[j]!.bin, modes[j]!.bin + 1]);
        const d = 10 * Math.log10((regionEnergy(x, 0, 0, bins) + 1e-12) / (regionEnergy(own, 0, 0, bins) + 1e-12));
        m.gain_db = round(clamp(m.gain_db + clamp(d, -12, 12) * 0.7, -80, 12), 1);
      });
    }
  }

  // ---- refine by a small deterministic search over layer levels
  const score = (p: PatchInput): number => spectralDistance(x, renderMono(p), SAMPLE_RATE);
  let best = score(patch);
  if (!options.quick) {
    const steps = [3, 1.5];
    const total = steps.length * layers.length;
    let done = 0;
    for (const step of steps) {
      for (const layer of layers) {
        progress(0.45 + (0.5 * done++) / total, 'refining');
        const base = layer.gain_db ?? 0;
        for (const delta of [step, -step]) {
          layer.gain_db = round(clamp(base + delta, -80, 24), 1);
          const s = score(patch);
          if (s < best - 0.005) {
            best = s;
            break;
          }
          layer.gain_db = base;
        }
      }
    }
  }

  // Drop layers that ended up inaudible; they only clutter the patch.
  const loudest = Math.max(...layers.map((l) => l.gain_db ?? 0));
  patch.layers = layers.filter((l) => (l.gain_db ?? 0) > loudest - 45);

  const similarity = Math.round(100 * Math.exp(-best / 12));
  if (similarity < 45) {
    notes.push('The match is rough. Voices, animals, water and dense recordings are beyond what resonances and shaped noise can express; consider using the file as a `sample` layer instead.');
  } else if (similarity < 65) {
    notes.push('The overall shape and tone are captured, but fine detail is not. Treat this as a starting point.');
  }
  notes.push('Reverb is not separated from the source: any room sound is folded into the decays.');
  progress(1, 'done');
  return { patch, similarity, spectral_distance_db: round(best, 2), notes };
}
