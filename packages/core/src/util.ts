export type Mono = Float32Array;
export type Stereo = [Float32Array, Float32Array];
/** A control signal: a constant, or one value per sample. */
export type Sig = number | Float32Array;

export const dbToGain = (db: number): number => Math.pow(10, db / 20);
export const gainToDb = (g: number): number => (g > 1e-10 ? 20 * Math.log10(g) : -200);
export const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
/** Interpolate on a log scale; use for frequencies and times. */
export const logLerp = (a: number, b: number, t: number): number => a * Math.pow(b / a, t);
export const semitones = (st: number): number => Math.pow(2, st / 12);
export const msToSamples = (ms: number, sr: number): number => Math.max(0, Math.round((ms * sr) / 1000));
export const round = (x: number, digits = 2): number => {
  const p = Math.pow(10, digits);
  return Math.round(x * p) / p;
};

export const sigAt = (s: Sig, i: number): number => (typeof s === 'number' ? s : s[i]!);

/** Deterministic PRNG (mulberry32). Identical output in Node and browsers. */
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0 || 0x9e3779b9;
  }
  /** Uniform in [0, 1). */
  next(): number {
    let t = (this.s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  /** Uniform in [-1, 1). */
  bi(): number {
    return this.next() * 2 - 1;
  }
  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }
  logRange(lo: number, hi: number): number {
    return lo * Math.pow(hi / lo, this.next());
  }
  int(lo: number, hi: number): number {
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }
  /** Independent child generator; keeps layers from disturbing each other's randomness. */
  fork(salt: number): Rng {
    return new Rng(hash32((this.s ^ Math.imul(salt + 1, 0x85ebca6b)) >>> 0));
  }
}

export function hash32(x: number): number {
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  return (x ^ (x >>> 16)) >>> 0;
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function levenshtein(a: string, b: string): number {
  const prev = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length]!;
}

export function nearest(word: string, options: readonly string[]): string | undefined {
  let best: string | undefined;
  let bestD = Infinity;
  for (const o of options) {
    const d = levenshtein(word.toLowerCase(), o.toLowerCase());
    if (d < bestD) {
      bestD = d;
      best = o;
    }
  }
  return best !== undefined && bestD <= Math.max(2, Math.floor(word.length / 2)) ? best : undefined;
}

export function peakOf(buf: Float32Array): number {
  let p = 0;
  for (let i = 0; i < buf.length; i++) {
    const a = Math.abs(buf[i]!);
    if (a > p) p = a;
  }
  return p;
}

export function toMono(st: Stereo): Float32Array {
  const [l, r] = st;
  const out = new Float32Array(l.length);
  for (let i = 0; i < l.length; i++) out[i] = 0.5 * (l[i]! + r[i]!);
  return out;
}

export function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}
