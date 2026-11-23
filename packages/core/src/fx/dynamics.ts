import type { FxOf } from '../schema/index.js';
import { dbToGain, gainToDb, msToSamples, type Stereo } from '../util.js';
import type { FxCtx } from './index.js';

const coef = (ms: number, sr: number): number => Math.exp(-1 / Math.max(1, (ms / 1000) * sr));

export function transient(buf: Stereo, fx: FxOf<'transient'>, ctx: FxCtx): void {
  const [L, R] = buf;
  const fastA = coef(0.3, ctx.sr);
  const slowA = coef(20, ctx.sr);
  const rel = coef(60, ctx.sr);
  let fast = 0;
  let slow = 0;
  for (let i = 0; i < L.length; i++) {
    const x = Math.max(Math.abs(L[i]!), Math.abs(R[i]!));
    fast = x > fast ? fastA * fast + (1 - fastA) * x : rel * fast;
    slow = x > slow ? slowA * slow + (1 - slowA) * x : rel * slow;
    const attackness = fast > 1e-6 ? Math.max(0, Math.min(1, (fast - slow) / fast)) : 0;
    const g = dbToGain(fx.attack_db * attackness + fx.sustain_db * (1 - attackness));
    L[i] = L[i]! * g;
    R[i] = R[i]! * g;
  }
}

export function compressor(buf: Stereo, fx: FxOf<'compressor'>, ctx: FxCtx): void {
  const [L, R] = buf;
  const att = coef(fx.attack_ms, ctx.sr);
  const rel = coef(fx.release_ms, ctx.sr);
  const knee = 6;
  const makeup = dbToGain(fx.makeup_db);
  let gr = 0; // gain reduction in dB, >= 0
  for (let i = 0; i < L.length; i++) {
    const level = gainToDb(Math.max(Math.abs(L[i]!), Math.abs(R[i]!)));
    const over = level - fx.threshold_db;
    let target = 0;
    if (over > knee / 2) target = over * (1 - 1 / fx.ratio);
    else if (over > -knee / 2) target = ((1 - 1 / fx.ratio) * (over + knee / 2) ** 2) / (2 * knee);
    gr = target > gr ? att * gr + (1 - att) * target : rel * gr + (1 - rel) * target;
    const g = dbToGain(-gr) * makeup;
    L[i] = L[i]! * g;
    R[i] = R[i]! * g;
  }
}

/** Look-ahead limiter: gain is fully reduced by the time a peak arrives, so nothing clips. */
export function limiter(buf: Stereo, fx: FxOf<'limiter'>, ctx: FxCtx): void {
  const [L, R] = buf;
  const n = L.length;
  const ceiling = dbToGain(fx.ceiling_db);
  const look = Math.max(1, msToSamples(4, ctx.sr));
  const need = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = Math.max(Math.abs(L[i]!), Math.abs(R[i]!));
    need[i] = p > ceiling ? ceiling / p : 1;
  }
  // Minimum over the next `look` samples, with a smooth release.
  const held = new Float32Array(n);
  const rel = 1 - coef(fx.release_ms, ctx.sr);
  let prev = 1;
  for (let i = 0; i < n; i++) {
    let m = 1;
    const end = Math.min(n, i + look + 1);
    for (let j = i; j < end; j++) if (need[j]! < m) m = need[j]!;
    prev = Math.min(m, prev + (1 - prev) * rel);
    held[i] = prev;
  }
  // Moving average turns the stepped gain into a ramp that lands on time.
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += held[i]!;
    if (i >= look) sum -= held[i - look]!;
    const g = sum / Math.min(i + 1, look);
    L[i] = L[i]! * g;
    R[i] = R[i]! * g;
  }
}
