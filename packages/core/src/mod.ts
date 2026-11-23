import type { Param } from './schema/index.js';
import { clamp, type Rng, type Sig } from './util.js';

type Curve = 'linear' | 'exp' | 'smooth' | 'step';

function interp(a: number, b: number, t: number, curve: Curve): number {
  switch (curve) {
    case 'step':
      return a;
    case 'smooth': {
      const s = t * t * (3 - 2 * t);
      return a + (b - a) * s;
    }
    case 'exp':
      // Geometric between positive values (right for frequencies); otherwise a
      // curve with the same character: fast initial fall, slow initial rise.
      if (a > 0 && b > 0) return a * Math.pow(b / a, t);
      return b < a ? b + (a - b) * Math.pow(1 - t, 3) : a + (b - a) * t * t * t;
    default:
      return a + (b - a) * t;
  }
}

export function renderEnv(points: [number, number][], curve: Curve, n: number, sr: number): Float32Array {
  const out = new Float32Array(n);
  let seg = 0;
  for (let i = 0; i < n; i++) {
    const ms = (i * 1000) / sr;
    while (seg < points.length - 1 && ms >= points[seg + 1]![0]) seg++;
    const [t0, v0] = points[seg]!;
    const next = points[seg + 1];
    if (ms <= t0 || !next) {
      out[i] = v0;
    } else {
      const [t1, v1] = next;
      out[i] = t1 > t0 ? interp(v0, v1, (ms - t0) / (t1 - t0), curve) : v1;
    }
  }
  return out;
}

/** Turn a parameter into a control signal of `n` samples (or a constant). */
export function resolveParam(p: Param, n: number, sr: number, rng: Rng, min = -Infinity, max = Infinity): Sig {
  if (typeof p === 'number') return p;
  if ('env' in p) return renderEnv(p.env, p.curve, n, sr);
  const out = new Float32Array(n);
  if ('lfo' in p) {
    const { hz, depth, shape, phase } = p.lfo;
    const inc = hz / sr;
    let ph = phase;
    for (let i = 0; i < n; i++) {
      let v: number;
      switch (shape) {
        case 'triangle':
          v = 1 - 4 * Math.abs(ph - 0.5);
          break;
        case 'square':
          v = ph < 0.5 ? 1 : -1;
          break;
        case 'saw':
          v = 2 * ph - 1;
          break;
        default:
          v = Math.sin(2 * Math.PI * ph);
      }
      out[i] = clamp(p.base + depth * v, min, max);
      ph += inc;
      if (ph >= 1) ph -= 1;
    }
    return out;
  }
  const { rate_hz, depth, smooth } = p.random;
  const inc = rate_hz / sr;
  let ph = 0;
  let a = rng.bi();
  let b = rng.bi();
  for (let i = 0; i < n; i++) {
    const v = smooth ? a + (b - a) * (0.5 - 0.5 * Math.cos(Math.PI * ph)) : a;
    out[i] = clamp(p.base + depth * v, min, max);
    ph += inc;
    if (ph >= 1) {
      ph -= 1;
      a = b;
      b = rng.bi();
    }
  }
  return out;
}

/** Time in ms of the last envelope point, or undefined if the parameter is not an envelope. */
export function envEndMs(p: Param): number | undefined {
  if (typeof p === 'object' && 'env' in p) return p.env[p.env.length - 1]![0];
  return undefined;
}

/** True if an envelope ends at (near) zero, i.e. it bounds the sound's length. */
export function envEndsSilent(p: Param): boolean {
  return typeof p === 'object' && 'env' in p && Math.abs(p.env[p.env.length - 1]![1]) < 1e-4;
}
