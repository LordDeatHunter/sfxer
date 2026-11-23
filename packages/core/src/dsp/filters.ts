import { clamp, sigAt, type Sig } from '../util.js';

/** Direct-form-I biquad with RBJ cookbook designs. Coefficients are fixed after construction. */
export class Biquad {
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;
  constructor(
    private b0: number,
    private b1: number,
    private b2: number,
    private a1: number,
    private a2: number,
  ) {}

  static design(
    kind: 'lowpass' | 'highpass' | 'bandpass' | 'peak' | 'lowshelf' | 'highshelf',
    sr: number,
    hz: number,
    q: number,
    gainDb = 0,
  ): Biquad {
    const w = (2 * Math.PI * clamp(hz, 5, sr * 0.49)) / sr;
    const cs = Math.cos(w);
    const sn = Math.sin(w);
    const alpha = sn / (2 * q);
    const A = Math.pow(10, gainDb / 40);
    let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;
    switch (kind) {
      case 'lowpass':
        b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = (1 - cs) / 2;
        a0 = 1 + alpha; a1 = -2 * cs; a2 = 1 - alpha;
        break;
      case 'highpass':
        b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = (1 + cs) / 2;
        a0 = 1 + alpha; a1 = -2 * cs; a2 = 1 - alpha;
        break;
      case 'bandpass':
        b0 = alpha; b1 = 0; b2 = -alpha;
        a0 = 1 + alpha; a1 = -2 * cs; a2 = 1 - alpha;
        break;
      case 'peak':
        b0 = 1 + alpha * A; b1 = -2 * cs; b2 = 1 - alpha * A;
        a0 = 1 + alpha / A; a1 = -2 * cs; a2 = 1 - alpha / A;
        break;
      case 'lowshelf': {
        const k = 2 * Math.sqrt(A) * alpha;
        b0 = A * (A + 1 - (A - 1) * cs + k); b1 = 2 * A * (A - 1 - (A + 1) * cs); b2 = A * (A + 1 - (A - 1) * cs - k);
        a0 = A + 1 + (A - 1) * cs + k; a1 = -2 * (A - 1 + (A + 1) * cs); a2 = A + 1 + (A - 1) * cs - k;
        break;
      }
      case 'highshelf': {
        const k = 2 * Math.sqrt(A) * alpha;
        b0 = A * (A + 1 + (A - 1) * cs + k); b1 = -2 * A * (A - 1 + (A + 1) * cs); b2 = A * (A + 1 + (A - 1) * cs - k);
        a0 = A + 1 - (A - 1) * cs + k; a1 = 2 * (A - 1 - (A + 1) * cs); a2 = A + 1 - (A - 1) * cs - k;
        break;
      }
    }
    return new Biquad(b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0);
  }

  tick(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }

  process(buf: Float32Array): void {
    for (let i = 0; i < buf.length; i++) buf[i] = this.tick(buf[i]!);
  }
}

export type SvfMode = 'lowpass' | 'highpass' | 'bandpass' | 'notch';

/**
 * Zero-delay-feedback state-variable filter. Stable under audio-rate cutoff
 * modulation, which is what lets patches sweep filters freely.
 */
export class Svf {
  private ic1 = 0;
  private ic2 = 0;
  private g = 0;
  private k = 1;
  private a1 = 0;
  private a2 = 0;
  private a3 = 0;
  private lastHz = -1;
  private lastQ = -1;
  constructor(private readonly sr: number) {}

  set(hz: number, q: number): void {
    if (hz === this.lastHz && q === this.lastQ) return;
    this.lastHz = hz;
    this.lastQ = q;
    this.g = Math.tan((Math.PI * clamp(hz, 10, this.sr * 0.49)) / this.sr);
    this.k = 1 / Math.max(q, 0.05);
    this.a1 = 1 / (1 + this.g * (this.g + this.k));
    this.a2 = this.g * this.a1;
    this.a3 = this.g * this.a2;
  }

  tick(x: number, mode: SvfMode): number {
    const v3 = x - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    switch (mode) {
      case 'lowpass':
        return v2;
      case 'bandpass':
        return v1 * this.k; // unity gain at the centre frequency
      case 'highpass':
        return x - this.k * v1 - v2;
      default:
        return x - this.k * v1;
    }
  }
}

export function svfProcess(buf: Float32Array, sr: number, mode: SvfMode, hz: Sig, q: Sig, stages = 1): void {
  for (let s = 0; s < stages; s++) {
    const f = new Svf(sr);
    if (typeof hz === 'number' && typeof q === 'number') {
      f.set(hz, q);
      for (let i = 0; i < buf.length; i++) buf[i] = f.tick(buf[i]!, mode);
    } else {
      for (let i = 0; i < buf.length; i++) {
        f.set(sigAt(hz, i), sigAt(q, i));
        buf[i] = f.tick(buf[i]!, mode);
      }
    }
  }
}

export class OnePole {
  private z = 0;
  private a: number;
  constructor(sr: number, hz: number) {
    this.a = 1 - Math.exp((-2 * Math.PI * clamp(hz, 1, sr * 0.49)) / sr);
  }
  lp(x: number): number {
    this.z += this.a * (x - this.z);
    return this.z;
  }
  hp(x: number): number {
    return x - this.lp(x);
  }
}

/** Fractional delay line with linear interpolation. */
export class Delay {
  private buf: Float32Array;
  private w = 0;
  constructor(maxSamples: number) {
    this.buf = new Float32Array(Math.max(4, Math.ceil(maxSamples) + 4));
  }
  write(x: number): void {
    this.buf[this.w] = x;
    this.w = (this.w + 1) % this.buf.length;
  }
  /** Read `d` samples behind the write head (call before write for a delay of exactly d). */
  read(d: number): number {
    const len = this.buf.length;
    d = clamp(d, 1, len - 3);
    let pos = this.w - d;
    while (pos < 0) pos += len;
    const i0 = Math.floor(pos);
    const frac = pos - i0;
    const a = this.buf[i0 % len]!;
    const b = this.buf[(i0 + 1) % len]!;
    return a + (b - a) * frac;
  }
}

export class Allpass {
  private d: Delay;
  constructor(
    private readonly len: number,
    private readonly g: number,
  ) {
    this.d = new Delay(len + 2);
  }
  tick(x: number): number {
    const delayed = this.d.read(this.len);
    const v = x + this.g * delayed;
    this.d.write(v);
    return delayed - this.g * v;
  }
}

/** Windowed-sinc lowpass kernel, cutoff as a fraction of Nyquist. */
export function sincKernel(taps: number, cutoff: number): Float32Array {
  const k = new Float32Array(taps);
  const mid = (taps - 1) / 2;
  let sum = 0;
  for (let i = 0; i < taps; i++) {
    const x = i - mid;
    const s = x === 0 ? cutoff : Math.sin(Math.PI * cutoff * x) / (Math.PI * x);
    const w = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / (taps - 1)) + 0.08 * Math.cos((4 * Math.PI * i) / (taps - 1));
    k[i] = s * w;
    sum += k[i]!;
  }
  for (let i = 0; i < taps; i++) k[i] = k[i]! / sum;
  return k;
}

function fir(x: Float32Array, k: Float32Array): Float32Array {
  const out = new Float32Array(x.length);
  const mid = (k.length - 1) >> 1;
  for (let i = 0; i < x.length; i++) {
    let acc = 0;
    const lo = Math.max(0, i + mid - (x.length - 1));
    const hi = Math.min(k.length - 1, i + mid);
    for (let j = lo; j <= hi; j++) acc += k[j]! * x[i + mid - j]!;
    out[i] = acc;
  }
  return out;
}

/** Run a memoryless non-linearity at `factor` times the sample rate to suppress aliasing. */
export function oversampled(buf: Float32Array, factor: number, fn: (x: number) => number): void {
  const kernel = sincKernel(factor * 16 + 1, 0.9 / factor);
  const up = new Float32Array(buf.length * factor);
  for (let i = 0; i < buf.length; i++) up[i * factor] = buf[i]! * factor;
  const hi = fir(up, kernel);
  for (let i = 0; i < hi.length; i++) hi[i] = fn(hi[i]!);
  const lo = fir(hi, kernel);
  for (let i = 0; i < buf.length; i++) buf[i] = lo[i * factor]!;
}

/** High-quality resampling by an arbitrary ratio (output rate / input rate). */
export function resample(x: Float32Array, ratio: number): Float32Array {
  if (Math.abs(ratio - 1) < 1e-9) return x.slice();
  const n = Math.max(1, Math.floor(x.length * ratio));
  const out = new Float32Array(n);
  const cutoff = Math.min(1, ratio) * 0.95;
  const half = 16;
  for (let i = 0; i < n; i++) {
    const pos = i / ratio;
    const i0 = Math.floor(pos);
    let acc = 0;
    let norm = 0;
    for (let j = i0 - half + 1; j <= i0 + half; j++) {
      if (j < 0 || j >= x.length) continue;
      const d = pos - j;
      const s = d === 0 ? cutoff : Math.sin(Math.PI * cutoff * d) / (Math.PI * d);
      const w = 0.5 + 0.5 * Math.cos((Math.PI * d) / half);
      const c = s * w;
      acc += c * x[j]!;
      norm += c;
    }
    out[i] = norm !== 0 ? (acc / norm) * 1 : 0;
  }
  return out;
}
