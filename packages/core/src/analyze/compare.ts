import { stft } from '../dsp/fft.js';
import { resample } from '../dsp/filters.js';
import { round, toMono, type Stereo } from '../util.js';
import { analyze, BANDS, type Report } from './report.js';

/**
 * Log-magnitude spectral distance at several resolutions, in dB (0 = identical).
 * Both signals are level-matched first, so this measures shape and timbre, not volume.
 */
export function spectralDistance(a: Float32Array, b: Float32Array, sr: number): number {
  const n = Math.max(a.length, b.length);
  const pad = (x: Float32Array) => {
    const out = new Float32Array(n);
    out.set(x);
    let e = 0;
    for (let i = 0; i < x.length; i++) e += x[i]! * x[i]!;
    const g = e > 0 ? 1 / Math.sqrt(e / n) : 0;
    for (let i = 0; i < n; i++) out[i] = out[i]! * g;
    return out;
  };
  const x = pad(a);
  const y = pad(b);
  let total = 0;
  let count = 0;
  for (const size of [256, 1024, 4096]) {
    const A = stft(x, sr, size, size >> 2);
    const B = stft(y, sr, size, size >> 2);
    // Pool bins into third-octave-like bands so tiny pitch offsets are not over-punished.
    const edges: number[] = [];
    for (let k = 1; k < size / 2; k = Math.max(k + 1, Math.round(k * 1.26))) edges.push(k);
    edges.push(size / 2);
    for (let f = 0; f < A.frames.length; f++) {
      const fa = A.frames[f]!;
      const fb = B.frames[f]!;
      for (let e = 0; e < edges.length - 1; e++) {
        let pa = 0;
        let pb = 0;
        for (let k = edges[e]!; k < edges[e + 1]!; k++) {
          pa += fa[k]! * fa[k]!;
          pb += fb[k]! * fb[k]!;
        }
        // Floor 40 dB below the normalised level: differences nobody can hear do not count.
        const da = 10 * Math.log10(pa + 1e-4);
        const db = 10 * Math.log10(pb + 1e-4);
        total += Math.abs(da - db);
        count++;
      }
    }
  }
  return count ? total / count : 0;
}

export interface Comparison {
  a: Report;
  b: Report;
  /** b minus a for the headline numbers. */
  delta: {
    duration_ms: number;
    lufs: number;
    peak_db: number;
    attack_ms: number;
    decay_ms: number;
    centroid_hz: number;
    noisiness: number;
    width: number;
    bands_pct: Record<string, number>;
  };
  /** 0 = identical timbre and shape; above ~12 the sounds are clearly different. */
  spectral_distance_db: number;
  /** 0-100, derived from the spectral distance. */
  similarity: number;
  summary: string[];
}

export function compare(a: Stereo | Float32Array[], srA: number, bIn: Stereo | Float32Array[], srB: number): Comparison {
  // Bring B to A's rate so recordings (often 44.1 or 96 kHz) can be compared with renders (48 kHz).
  const b = srA === srB ? bIn : bIn.map((c) => resample(c, srA / srB));
  srB = srA;
  const ra = analyze(a, srA);
  const rb = analyze(b, srB);
  const monoOf = (c: Float32Array[]) => (c.length >= 2 ? toMono([c[0]!, c[1]!]) : c[0]!);
  const dist = spectralDistance(monoOf(a), monoOf(b), srA);
  const bands: Record<string, number> = {};
  for (const [name] of BANDS) bands[name] = round(rb.spectrum.bands_pct[name] - ra.spectrum.bands_pct[name], 1);
  const delta = {
    duration_ms: round(rb.duration_ms - ra.duration_ms, 1),
    lufs: round(rb.level.lufs - ra.level.lufs, 2),
    peak_db: round(rb.level.peak_db - ra.level.peak_db, 2),
    attack_ms: rb.shape.attack_ms - ra.shape.attack_ms,
    decay_ms: rb.shape.decay_ms - ra.shape.decay_ms,
    centroid_hz: rb.spectrum.centroid_hz - ra.spectrum.centroid_hz,
    noisiness: round(rb.spectrum.noisiness - ra.spectrum.noisiness, 3),
    width: round(rb.stereo.width - ra.stereo.width, 3),
    bands_pct: bands,
  };
  const summary: string[] = [];
  const say = (cond: boolean, text: string) => cond && summary.push(text);
  say(Math.abs(delta.duration_ms) > Math.max(20, ra.duration_ms * 0.1), `B is ${Math.abs(delta.duration_ms)} ms ${delta.duration_ms > 0 ? 'longer' : 'shorter'}.`);
  say(Math.abs(delta.lufs) > 1, `B is ${Math.abs(delta.lufs)} LU ${delta.lufs > 0 ? 'louder' : 'quieter'}.`);
  const cr = rb.spectrum.centroid_hz / Math.max(1, ra.spectrum.centroid_hz);
  say(cr > 1.2 || cr < 0.83, `B is ${cr > 1 ? 'brighter' : 'darker'} (centroid ${rb.spectrum.centroid_hz} Hz vs ${ra.spectrum.centroid_hz} Hz).`);
  say(Math.abs(delta.attack_ms) > 6, `B has a ${delta.attack_ms > 0 ? 'slower' : 'faster'} attack (${rb.shape.attack_ms} ms vs ${ra.shape.attack_ms} ms).`);
  say(Math.abs(delta.decay_ms) > Math.max(30, ra.shape.decay_ms * 0.2), `B decays ${delta.decay_ms > 0 ? 'more slowly' : 'faster'} (${rb.shape.decay_ms} ms vs ${ra.shape.decay_ms} ms).`);
  say(Math.abs(delta.noisiness) > 0.1, `B is ${delta.noisiness > 0 ? 'noisier' : 'more tonal'}.`);
  say(Math.abs(delta.width) > 0.15, `B is ${delta.width > 0 ? 'wider' : 'narrower'} in stereo.`);
  for (const [name] of BANDS) {
    const d = bands[name]!;
    say(Math.abs(d) >= 12, `B has ${Math.abs(d)} points ${d > 0 ? 'more' : 'less'} of its energy in the ${name} band.`);
  }
  if (!summary.length) summary.push('The two sounds measure about the same.');
  return {
    a: ra,
    b: rb,
    delta,
    spectral_distance_db: round(dist, 2),
    similarity: Math.round(100 * Math.exp(-dist / 12)),
    summary,
  };
}
