import { Biquad, Delay, OnePole, Svf, oversampled, svfProcess } from '../dsp/filters.js';
import { resolveParam } from '../mod.js';
import type { FxOf } from '../schema/index.js';
import { clamp, dbToGain, sigAt, type Stereo } from '../util.js';
import type { FxCtx } from './index.js';

const mixInto = (dry: Float32Array, wet: Float32Array, mix: number): void => {
  for (let i = 0; i < dry.length; i++) dry[i] = dry[i]! * (1 - mix) + wet[i]! * mix;
};

export function filter(buf: Stereo, fx: FxOf<'filter'>, ctx: FxCtx): void {
  const hz = resolveParam(fx.hz, ctx.n, ctx.sr, ctx.rng, 20, 20000);
  const q = resolveParam(fx.q, ctx.n, ctx.sr, ctx.rng, 0.3, 30);
  for (const ch of buf) svfProcess(ch, ctx.sr, fx.mode, hz, q, fx.slope / 12);
}

export function eq(buf: Stereo, fx: FxOf<'eq'>, ctx: FxCtx): void {
  for (const ch of buf) {
    if (fx.low_db !== 0) Biquad.design('lowshelf', ctx.sr, fx.low_hz, 0.707, fx.low_db).process(ch);
    if (fx.mid_db !== 0) Biquad.design('peak', ctx.sr, fx.mid_hz, fx.mid_q, fx.mid_db).process(ch);
    if (fx.high_db !== 0) Biquad.design('highshelf', ctx.sr, fx.high_hz, 0.707, fx.high_db).process(ch);
  }
}

export function comb(buf: Stereo, fx: FxOf<'comb'>, ctx: FxCtx): void {
  const hz = resolveParam(fx.hz, ctx.n, ctx.sr, ctx.rng, 20, 5000);
  for (const ch of buf) {
    const d = new Delay(ctx.sr / 20 + 8);
    for (let i = 0; i < ch.length; i++) {
      const y = ch[i]! + fx.feedback * d.read(ctx.sr / sigAt(hz, i));
      d.write(y);
      ch[i] = ch[i]! * (1 - fx.mix) + y * fx.mix * (1 - Math.abs(fx.feedback) * 0.5);
    }
  }
}

const VOWELS: Record<FxOf<'formant'>['vowel'], [number, number, number]> = {
  a: [800, 1150, 2900],
  e: [400, 1700, 2600],
  i: [280, 2250, 2950],
  o: [450, 800, 2830],
  u: [325, 700, 2700],
};

export function formant(buf: Stereo, fx: FxOf<'formant'>, ctx: FxCtx): void {
  const shift = Math.pow(2, fx.shift_semitones / 12);
  const gains = [1, 0.6, 0.35];
  const qs = [7, 9, 11];
  for (const ch of buf) {
    const wet = new Float32Array(ch.length);
    VOWELS[fx.vowel].forEach((f, k) => {
      const svf = new Svf(ctx.sr);
      svf.set(f * shift, qs[k]!);
      for (let i = 0; i < ch.length; i++) wet[i] = wet[i]! + svf.tick(ch[i]!, 'bandpass') * gains[k]! * 2;
    });
    mixInto(ch, wet, fx.mix);
  }
}

export function shaper(buf: Stereo, fx: FxOf<'shaper'>, _ctx: FxCtx): void {
  const drive = dbToGain(fx.drive_db);
  const curve: (x: number) => number =
    fx.curve === 'tanh'
      ? Math.tanh
      : fx.curve === 'soft'
        ? (x) => x / (1 + Math.abs(x))
        : fx.curve === 'hard'
          ? (x) => clamp(x, -1, 1)
          : (x) => Math.sin((Math.PI / 2) * x);
  // Keep a full-scale input at full scale so more drive means more density, not more level.
  const comp = fx.curve === 'tanh' || fx.curve === 'soft' ? 1 / curve(drive) : 1;
  for (const ch of buf) {
    const wet = ch.slice();
    oversampled(wet, 4, (x) => curve(x * drive) * comp);
    mixInto(ch, wet, fx.mix);
  }
}

export function crush(buf: Stereo, fx: FxOf<'crush'>, ctx: FxCtx): void {
  const levels = Math.pow(2, fx.bits - 1);
  const step = fx.rate_hz / ctx.sr;
  for (const ch of buf) {
    let acc = 1;
    let held = 0;
    for (let i = 0; i < ch.length; i++) {
      acc += step;
      if (acc >= 1) {
        acc -= 1;
        held = Math.round(ch[i]! * levels) / levels;
      }
      ch[i] = ch[i]! * (1 - fx.mix) + held * fx.mix;
    }
  }
}

/** Varispeed: reads the input at a changing rate, like tape. */
export function pitch(buf: Stereo, fx: FxOf<'pitch'>, ctx: FxCtx): void {
  const st = resolveParam(fx.semitones, ctx.n, ctx.sr, ctx.rng, -36, 36);
  for (const ch of buf) {
    const src = ch.slice();
    let pos = 0;
    for (let i = 0; i < ch.length; i++) {
      const p0 = Math.floor(pos);
      ch[i] = p0 + 1 < src.length ? src[p0]! + (src[p0 + 1]! - src[p0]!) * (pos - p0) : 0;
      pos += Math.pow(2, sigAt(st, i) / 12);
    }
  }
}

export function gain(buf: Stereo, fx: FxOf<'gain'>, ctx: FxCtx): void {
  const db = resolveParam(fx.db, ctx.n, ctx.sr, ctx.rng, -80, 36);
  for (const ch of buf) for (let i = 0; i < ch.length; i++) ch[i] = ch[i]! * dbToGain(sigAt(db, i));
}

export function distance(buf: Stereo, fx: FxOf<'distance'>, ctx: FxCtx): void {
  const lpHz = clamp(20000 / (1 + fx.meters / 25), 250, 20000);
  const hpHz = clamp(20 + fx.meters * 0.4, 20, 300);
  for (const ch of buf) {
    const a = new OnePole(ctx.sr, lpHz);
    const b = new OnePole(ctx.sr, lpHz * 1.5);
    const h = new OnePole(ctx.sr, hpHz);
    for (let i = 0; i < ch.length; i++) ch[i] = h.hp(b.lp(a.lp(ch[i]!)));
  }
}
