import { OnePole } from '../dsp/filters.js';
import { resolveParam } from '../mod.js';
import type { SourceOf } from '../schema/index.js';
import { clamp, msToSamples, peakOf, sigAt, type Mono } from '../util.js';
import type { Ctx } from './index.js';

function polyBlep(t: number, dt: number): number {
  if (t < dt) {
    t /= dt;
    return t + t - t * t - 1;
  }
  if (t > 1 - dt) {
    t = (t - 1) / dt;
    return t * t + t + t + 1;
  }
  return 0;
}

export function osc(s: SourceOf<'osc'>, ctx: Ctx): Mono {
  const { n, sr, rng } = ctx;
  const out = new Float32Array(n);
  const hz = resolveParam(s.hz, n, sr, rng, 10, 20000);
  const st = resolveParam(s.pitch_semitones, n, sr, rng, -48, 48);
  const pw = resolveParam(s.pulse_width, n, sr, rng, 0.05, 0.95);
  const voices = s.unison;
  const norm = 1 / Math.sqrt(voices);
  for (let v = 0; v < voices; v++) {
    const cents = voices > 1 ? s.detune_cents * (v / (voices - 1) - 0.5) : 0;
    const detune = Math.pow(2, cents / 1200);
    let ph = voices > 1 ? rng.next() : 0;
    for (let i = 0; i < n; i++) {
      const stv = sigAt(st, i);
      const f = clamp(sigAt(hz, i) * (stv === 0 ? 1 : Math.pow(2, stv / 12)) * detune, 0, sr * 0.45);
      const dt = f / sr;
      let y: number;
      switch (s.shape) {
        case 'sine':
          y = Math.sin(2 * Math.PI * ph);
          break;
        case 'triangle':
          y = 1 - 4 * Math.abs(((ph + 0.25) % 1) - 0.5);
          break;
        case 'saw':
          y = 2 * ph - 1 - polyBlep(ph, dt);
          break;
        default: {
          const w = s.shape === 'square' ? 0.5 : sigAt(pw, i);
          y = (ph < w ? 1 : -1) + polyBlep(ph, dt) - polyBlep((ph + 1 - w) % 1, dt);
        }
      }
      out[i] = out[i]! + y * norm;
      ph += dt;
      if (ph >= 1) ph -= 1;
    }
  }
  return out;
}

export function fm(s: SourceOf<'fm'>, ctx: Ctx): Mono {
  const { n, sr, rng } = ctx;
  const out = new Float32Array(n);
  const hz = resolveParam(s.hz, n, sr, rng, 10, 20000);
  const st = resolveParam(s.pitch_semitones, n, sr, rng, -48, 48);
  const ratio = resolveParam(s.ratio, n, sr, rng, 0.1, 16);
  const index = resolveParam(s.index, n, sr, rng, 0, 20);
  let cp = 0;
  let mp = 0;
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const f = clamp(sigAt(hz, i) * Math.pow(2, sigAt(st, i) / 12), 0, sr * 0.45);
    const m = Math.sin(2 * Math.PI * mp + s.feedback * 2.5 * prev);
    prev = m;
    out[i] = Math.sin(2 * Math.PI * cp + sigAt(index, i) * m);
    cp += f / sr;
    mp += (f * sigAt(ratio, i)) / sr;
    if (cp >= 1) cp -= 1;
    if (mp >= 1) mp -= Math.floor(mp);
  }
  return out;
}

export function noise(s: SourceOf<'noise'>, ctx: Ctx): Mono {
  const { n, sr, rng } = ctx;
  const out = new Float32Array(n);
  switch (s.color) {
    case 'white':
      for (let i = 0; i < n; i++) out[i] = rng.bi();
      break;
    case 'pink': {
      // Paul Kellet's economy pink filter.
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < n; i++) {
        const w = rng.bi();
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.016898;
        out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.2;
        b6 = w * 0.115926;
      }
      break;
    }
    case 'brown': {
      let b = 0;
      for (let i = 0; i < n; i++) {
        b = (b + 0.02 * rng.bi()) / 1.02;
        out[i] = b * 3.5;
      }
      break;
    }
    default: {
      const density = resolveParam(s.density_hz, n, sr, rng, 1, 20000);
      const crackle = s.color === 'crackle';
      for (let i = 0; i < n; i++) {
        if (rng.next() < sigAt(density, i) / sr) {
          const sign = rng.next() < 0.5 ? -1 : 1;
          const u = rng.next();
          out[i] = crackle ? sign * u * u : sign;
        }
      }
    }
  }
  return out;
}

export function impulse(s: SourceOf<'impulse'>, ctx: Ctx): Mono {
  const out = new Float32Array(ctx.n);
  const w = Math.max(2, msToSamples(s.width_ms, ctx.sr));
  for (let i = 0; i < w && i < ctx.n; i++) out[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * (i + 0.5)) / w);
  return out;
}

/** Karplus-Strong plucked string with a tuned loop and pick-position comb. */
export function pluck(s: SourceOf<'pluck'>, ctx: Ctx): Mono {
  const { n, sr, rng } = ctx;
  const out = new Float32Array(n);
  const period = sr / s.hz;
  const smooth = 0.5 * (1 - s.brightness) * 0.9 + 0.02; // one-zero loss filter coefficient
  const loopDelay = period - smooth;
  const len = Math.floor(loopDelay);
  const frac = loopDelay - len;
  const g = Math.pow(10, (-3 * (period / sr)) / (s.decay_ms / 1000));

  const exciteLen = Math.max(2, Math.ceil(period));
  const excite = new Float32Array(exciteLen);
  const lp = new OnePole(sr, 400 * Math.pow(2, s.brightness * 5.3));
  for (let i = 0; i < exciteLen; i++) excite[i] = lp.lp(rng.bi());
  const pick = Math.max(1, Math.round(s.position * period));

  const line = new Float32Array(len + 2);
  let w = 0;
  let prev = 0;
  for (let i = 0; i < n; i++) {
    let x = 0;
    if (i < exciteLen) x = excite[i]!;
    if (i >= pick && i - pick < exciteLen) x -= excite[i - pick]!;
    const r0 = line[(w - len + line.length * 2) % line.length]!;
    const r1 = line[(w - len - 1 + line.length * 2) % line.length]!;
    const delayed = r0 + (r1 - r0) * frac;
    const filtered = g * ((1 - smooth) * delayed + smooth * prev);
    prev = delayed;
    const y = x + filtered;
    line[w] = y;
    w = (w + 1) % line.length;
    out[i] = y;
  }
  const p = peakOf(out);
  if (p > 0) for (let i = 0; i < n; i++) out[i] = out[i]! / p;
  return out;
}
