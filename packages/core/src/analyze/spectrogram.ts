import { fft, hann } from '../dsp/fft.js';
import { peakOf } from '../util.js';

export interface Image {
  width: number;
  height: number;
  /** RGBA, row-major. */
  data: Uint8ClampedArray;
}

const FONT: Record<string, string[]> = {
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'],
  '7': ['111', '001', '010', '010', '010'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'],
  '.': ['000', '000', '000', '000', '010'],
  k: ['100', '101', '110', '101', '101'],
  m: ['000', '111', '111', '101', '101'],
  s: ['011', '100', '010', '001', '110'],
  H: ['101', '101', '111', '101', '101'],
  z: ['000', '111', '010', '100', '111'],
  d: ['001', '001', '111', '101', '111'],
  B: ['110', '101', '110', '101', '110'],
  '-': ['000', '000', '111', '000', '000'],
  ' ': ['000', '000', '000', '000', '000'],
};

// Perceptually ordered colour ramp, dark to bright.
const RAMP: [number, number, number][] = [
  [8, 8, 20],
  [40, 18, 90],
  [110, 30, 120],
  [185, 55, 100],
  [240, 110, 60],
  [252, 190, 80],
  [252, 252, 200],
];

function ramp(t: number): [number, number, number] {
  const x = Math.max(0, Math.min(0.9999, t)) * (RAMP.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  const a = RAMP[i]!;
  const b = RAMP[i + 1]!;
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

export interface SpectrogramOptions {
  width?: number;
  height?: number;
  minHz?: number;
  maxHz?: number;
  /** Dynamic range shown, dB below the loudest point. */
  rangeDb?: number;
  /** Draw axes and labels. */
  axes?: boolean;
}

/**
 * Render a waveform strip above a log-frequency spectrogram. Agents that can
 * read images use this to check shape, brightness and motion at a glance.
 */
export function spectrogram(mono: Float32Array, sr: number, opts: SpectrogramOptions = {}): Image {
  const width = opts.width ?? 900;
  const height = opts.height ?? 440;
  const minHz = opts.minHz ?? 40;
  const maxHz = Math.min(opts.maxHz ?? 20000, sr / 2);
  const range = opts.rangeDb ?? 80;
  const axes = opts.axes ?? true;
  const data = new Uint8ClampedArray(width * height * 4);
  const left = axes ? 40 : 0;
  const bottom = axes ? 14 : 0;
  const waveH = Math.round(height * 0.18);
  const top = waveH + 4;
  const plotW = width - left;
  const plotH = height - top - bottom;

  const px = (x: number, y: number, r: number, g: number, b: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const o = (y * width + x) * 4;
    data[o] = r;
    data[o + 1] = g;
    data[o + 2] = b;
    data[o + 3] = 255;
  };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) px(x, y, 14, 14, 22);
  const text = (s: string, x: number, y: number) => {
    for (const ch of s) {
      const g = FONT[ch];
      if (g) for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) if (g[r]![c] === '1') px(x + c, y + r, 190, 190, 205);
      x += 4;
    }
  };

  // ---- waveform strip (min/max per column)
  const peak = peakOf(mono) || 1;
  for (let x = 0; x < plotW; x++) {
    const a = Math.floor((x * mono.length) / plotW);
    const b = Math.max(a + 1, Math.floor(((x + 1) * mono.length) / plotW));
    let lo = 0;
    let hi = 0;
    for (let i = a; i < b && i < mono.length; i++) {
      if (mono[i]! < lo) lo = mono[i]!;
      if (mono[i]! > hi) hi = mono[i]!;
    }
    const mid = waveH / 2;
    const y0 = Math.round(mid - (hi / peak) * (mid - 1));
    const y1 = Math.round(mid - (lo / peak) * (mid - 1));
    for (let y = y0; y <= y1; y++) px(left + x, y, 110, 200, 235);
  }

  // ---- spectrogram
  const size = mono.length < sr * 0.25 ? 1024 : 2048;
  const win = hann(size);
  const re = new Float32Array(size);
  const im = new Float32Array(size);
  const bins = size >> 1;
  const cols: Float32Array[] = [];
  let maxDb = -200;
  for (let x = 0; x < plotW; x++) {
    const centre = Math.floor(((x + 0.5) * mono.length) / plotW);
    for (let i = 0; i < size; i++) {
      const j = centre - (size >> 1) + i;
      re[i] = j >= 0 && j < mono.length ? mono[j]! * win[i]! : 0;
      im[i] = 0;
    }
    fft(re, im);
    const col = new Float32Array(plotH);
    for (let y = 0; y < plotH; y++) {
      const f0 = minHz * Math.pow(maxHz / minHz, 1 - (y + 1) / plotH);
      const f1 = minHz * Math.pow(maxHz / minHz, 1 - y / plotH);
      const k0 = Math.max(1, Math.floor((f0 / sr) * size));
      const k1 = Math.min(bins - 1, Math.max(k0, Math.ceil((f1 / sr) * size) - 1));
      let p = 0;
      for (let k = k0; k <= k1; k++) {
        const m = re[k]! * re[k]! + im[k]! * im[k]!;
        if (m > p) p = m;
      }
      const db = 10 * Math.log10(p + 1e-20);
      col[y] = db;
      if (db > maxDb) maxDb = db;
    }
    cols.push(col);
  }
  for (let x = 0; x < plotW; x++) {
    const col = cols[x]!;
    for (let y = 0; y < plotH; y++) {
      const [r, g, b] = ramp((col[y]! - (maxDb - range)) / range);
      px(left + x, top + y, r, g, b);
    }
  }

  if (axes) {
    for (const hz of [50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]) {
      if (hz < minHz || hz > maxHz) continue;
      const y = top + Math.round(plotH * (1 - Math.log(hz / minHz) / Math.log(maxHz / minHz)));
      for (let x = left; x < width; x += 6) px(x, y, 90, 90, 110);
      text(hz >= 1000 ? `${hz / 1000}kHz` : `${hz}Hz`, 2, Math.min(height - bottom - 6, Math.max(top, y - 2)));
    }
    const ms = (mono.length / sr) * 1000;
    const steps = [5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];
    const step = steps.find((s) => ms / s <= 10) ?? 10000;
    for (let t = 0; t <= ms; t += step) {
      const x = left + Math.round((t / ms) * plotW);
      for (let y = top; y < height - bottom; y += 6) px(x, y, 90, 90, 110);
      text(t >= 1000 ? `${t / 1000}s` : `${t}ms`, Math.min(width - 24, x + 2), height - 8);
    }
  }
  return { width, height, data };
}
