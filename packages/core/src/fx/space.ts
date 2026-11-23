import { convolve as fftConvolve } from '../dsp/fft.js';
import { Allpass, Delay, OnePole } from '../dsp/filters.js';
import type { FxOf } from '../schema/index.js';
import { msToSamples, Rng, type Stereo } from '../util.js';
import type { FxCtx } from './index.js';

export function chorus(buf: Stereo, fx: FxOf<'chorus'>, ctx: FxCtx): void {
  const { sr } = ctx;
  buf.forEach((ch, c) => {
    const d = new Delay(((fx.delay_ms + fx.depth_ms) * 2 * sr) / 1000 + 16);
    for (let i = 0; i < ch.length; i++) {
      const t = i / sr;
      let wet = 0;
      for (let v = 0; v < 2; v++) {
        const lfo = Math.sin(2 * Math.PI * (fx.rate_hz * (1 + v * 0.13) * t + c * 0.25 + v * 0.5));
        wet += d.read(((fx.delay_ms * (1 + v * 0.35) + fx.depth_ms * (1 + lfo) * 0.5) * sr) / 1000);
      }
      d.write(ch[i]!);
      ch[i] = ch[i]! * (1 - fx.mix) + wet * 0.7 * fx.mix;
    }
  });
}

export function delay(buf: Stereo, fx: FxOf<'delay'>, ctx: FxCtx): void {
  const [L, R] = buf;
  const len = (fx.time_ms * ctx.sr) / 1000;
  const dl = new Delay(len + 8);
  const dr = new Delay(len + 8);
  const tl = new OnePole(ctx.sr, fx.tone_hz);
  const tr = new OnePole(ctx.sr, fx.tone_hz);
  for (let i = 0; i < L.length; i++) {
    const wl = tl.lp(dl.read(len));
    const wr = tr.lp(dr.read(len));
    if (fx.ping_pong) {
      dl.write((L[i]! + R[i]!) * 0.5 + wr * fx.feedback);
      dr.write(wl * fx.feedback);
    } else {
      dl.write(L[i]! + wl * fx.feedback);
      dr.write(R[i]! + wr * fx.feedback);
    }
    L[i] = L[i]! * (1 - fx.mix) + wl * fx.mix;
    R[i] = R[i]! * (1 - fx.mix) + wr * fx.mix;
  }
}

const FDN_MS = [29.7, 37.1, 41.1, 43.7, 53.3, 59.9, 67.3, 73.1];

/** Eight-line feedback delay network with a Householder mixing matrix. */
export function reverb(buf: Stereo, fx: FxOf<'reverb'>, ctx: FxCtx): void {
  const { sr } = ctx;
  const [L, R] = buf;
  const scale = 0.22 + 1.15 * fx.size;
  const N = FDN_MS.length;
  const lens = FDN_MS.map((ms) => Math.max(8, Math.round((ms * scale * sr) / 1000) | 1));
  const lines = lens.map((l) => new Delay(l + 4));
  const gains = lens.map((l) => Math.pow(10, (-3 * l) / ((fx.decay_ms / 1000) * sr)));
  const damp = lens.map(() => new OnePole(sr, 20000 * Math.pow(2, -fx.damping * 5)));
  const pre = msToSamples(fx.predelay_ms, sr);
  const preL = new Delay(pre + 4);
  const preR = new Delay(pre + 4);
  const diffL = [new Allpass(Math.round(4.7 * scale * sr / 1000) + 3, 0.6), new Allpass(Math.round(1.7 * scale * sr / 1000) + 2, 0.6)];
  const diffR = [new Allpass(Math.round(5.3 * scale * sr / 1000) + 3, 0.6), new Allpass(Math.round(2.1 * scale * sr / 1000) + 2, 0.6)];
  const v = new Float32Array(N);
  for (let i = 0; i < L.length; i++) {
    let inL = pre > 0 ? preL.read(pre) : L[i]!;
    let inR = pre > 0 ? preR.read(pre) : R[i]!;
    preL.write(L[i]!);
    preR.write(R[i]!);
    for (const a of diffL) inL = a.tick(inL);
    for (const a of diffR) inR = a.tick(inR);
    let sum = 0;
    for (let k = 0; k < N; k++) {
      v[k] = damp[k]!.lp(lines[k]!.read(lens[k]!)) * gains[k]!;
      sum += v[k]!;
    }
    const h = (2 / N) * sum;
    let wl = 0;
    let wr = 0;
    for (let k = 0; k < N; k++) {
      const sign = k & 2 ? -1 : 1;
      if (k & 1) wr += v[k]! * sign;
      else wl += v[k]! * sign;
      lines[k]!.write(v[k]! - h + (k & 1 ? inR : inL));
    }
    L[i] = L[i]! * (1 - fx.mix) + wl * 0.5 * fx.mix;
    R[i] = R[i]! * (1 - fx.mix) + wr * 0.5 * fx.mix;
  }
}

interface IrModel {
  ms: number;
  /** Ring time of highs relative to lows. */
  hfRatio: number;
  lowHz: number;
  predelayMs: number;
  early: number;
  earlySpanMs: number;
}

const IR_MODELS: Record<'room' | 'hall' | 'cave' | 'box', IrModel> = {
  room: { ms: 450, hfRatio: 0.5, lowHz: 2500, predelayMs: 3, early: 10, earlySpanMs: 30 },
  hall: { ms: 2200, hfRatio: 0.45, lowHz: 2000, predelayMs: 18, early: 14, earlySpanMs: 80 },
  cave: { ms: 3600, hfRatio: 0.3, lowHz: 1200, predelayMs: 30, early: 18, earlySpanMs: 220 },
  box: { ms: 70, hfRatio: 0.6, lowHz: 1800, predelayMs: 0, early: 14, earlySpanMs: 9 },
};

export function irLengthMs(fx: FxOf<'convolve'>): number {
  const base = fx.ir === 'tube' ? 280 : fx.ir === 'tank' ? 1300 : IR_MODELS[fx.ir].ms;
  return base * fx.decay_scale;
}

/** Synthesise an impulse response. No recordings are shipped; every space is generated. */
export function makeIr(fx: FxOf<'convolve'>, sr: number, seed: number): Float32Array {
  const rng = new Rng(seed);
  const total = irLengthMs(fx);
  const n = msToSamples(total, sr);
  const h = new Float32Array(n);
  if (fx.ir === 'tube') {
    // Regular reflections between the ends of a pipe, darkening on each trip.
    const period = msToSamples(3.4 * fx.decay_scale, sr) + rng.int(0, 6);
    const lp = new OnePole(sr, 3500);
    for (let i = 0; i < n; i++) {
      const x = i % period === 0 ? (Math.floor(i / period) % 2 ? -1 : 1) : 0;
      h[i] = lp.lp(x + rng.bi() * 0.02) * Math.exp((-6.9 * i) / n);
    }
  } else if (fx.ir === 'tank') {
    // Dense inharmonic ringing of a metal enclosure.
    for (let m = 0; m < 70; m++) {
      const hz = rng.logRange(180, 9000);
      const t60 = (total / 1000) * rng.range(0.3, 1) * (1 / (1 + hz / 6000));
      const d = Math.exp(-6.908 / (t60 * sr));
      const inc = (2 * Math.PI * hz) / sr;
      const ph = rng.next() * 6.283;
      let env = rng.range(0.3, 1);
      for (let i = 0; i < n && env > 1e-4; i++) {
        h[i] = h[i]! + env * Math.sin(inc * i + ph);
        env *= d;
      }
    }
  } else {
    const m = IR_MODELS[fx.ir];
    const pre = msToSamples(m.predelayMs, sr);
    const lp = new OnePole(sr, m.lowHz);
    const tail = n - pre;
    for (let i = 0; i < tail; i++) {
      const w = rng.bi();
      const low = lp.lp(w);
      const t = i / tail;
      const build = Math.min(1, i / (0.004 * sr)); // avoid a click at the tail onset
      h[pre + i] = build * ((w - low) * Math.exp((-6.9 * t) / m.hfRatio) + low * 2 * Math.exp(-6.9 * t));
    }
    for (let e = 0; e < m.early; e++) {
      const at = pre + msToSamples(rng.range(0.4, m.earlySpanMs) * fx.decay_scale, sr);
      if (at < n) h[at] = h[at]! + (rng.next() < 0.5 ? -1 : 1) * rng.range(0.3, 0.9) * 2.5;
    }
  }
  let energy = 0;
  for (let i = 0; i < n; i++) energy += h[i]! * h[i]!;
  const norm = energy > 0 ? 1 / Math.sqrt(energy) : 0;
  for (let i = 0; i < n; i++) h[i] = h[i]! * norm;
  return h;
}

export function convolveFx(buf: Stereo, fx: FxOf<'convolve'>, ctx: FxCtx): void {
  const seed = ctx.rng.int(1, 0x7fffffff);
  buf.forEach((ch, c) => {
    const wet = fftConvolve(ch, makeIr(fx, ctx.sr, seed + c * 7919));
    for (let i = 0; i < ch.length; i++) ch[i] = ch[i]! * (1 - fx.mix) + wet[i]! * fx.mix;
  });
}

export function width(buf: Stereo, fx: FxOf<'width'>, ctx: FxCtx): void {
  const [L, R] = buf;
  const haas = msToSamples(fx.haas_ms, ctx.sr);
  if (haas > 0) {
    const src = R.slice();
    for (let i = 0; i < R.length; i++) R[i] = i >= haas ? src[i - haas]! : 0;
  }
  for (let i = 0; i < L.length; i++) {
    const mid = 0.5 * (L[i]! + R[i]!);
    const side = 0.5 * (L[i]! - R[i]!) * fx.amount;
    L[i] = mid + side;
    R[i] = mid - side;
  }
}
