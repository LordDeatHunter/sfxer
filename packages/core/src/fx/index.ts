import type { Fx } from '../schema/index.js';
import type { Rng, Stereo } from '../util.js';
import { compressor, limiter, transient } from './dynamics.js';
import { chorus, convolveFx, delay, irLengthMs, reverb, width } from './space.js';
import { comb, crush, distance, eq, filter, formant, gain, pitch, shaper } from './tone.js';

export interface FxCtx {
  sr: number;
  n: number;
  rng: Rng;
}

/** Apply one effect in place. */
export function applyFx(buf: Stereo, fx: Fx, ctx: FxCtx): void {
  switch (fx.type) {
    case 'filter':
      return filter(buf, fx, ctx);
    case 'eq':
      return eq(buf, fx, ctx);
    case 'comb':
      return comb(buf, fx, ctx);
    case 'formant':
      return formant(buf, fx, ctx);
    case 'shaper':
      return shaper(buf, fx, ctx);
    case 'crush':
      return crush(buf, fx, ctx);
    case 'chorus':
      return chorus(buf, fx, ctx);
    case 'delay':
      return delay(buf, fx, ctx);
    case 'reverb':
      return reverb(buf, fx, ctx);
    case 'convolve':
      return convolveFx(buf, fx, ctx);
    case 'transient':
      return transient(buf, fx, ctx);
    case 'compressor':
      return compressor(buf, fx, ctx);
    case 'limiter':
      return limiter(buf, fx, ctx);
    case 'width':
      return width(buf, fx, ctx);
    case 'pitch':
      return pitch(buf, fx, ctx);
    case 'gain':
      return gain(buf, fx, ctx);
    case 'distance':
      return distance(buf, fx, ctx);
  }
}

/** Extra time an effect keeps sounding after its input stops, in ms. */
export function fxTailMs(fx: Fx): number {
  switch (fx.type) {
    case 'reverb':
      return fx.mix > 0 ? fx.decay_ms + fx.predelay_ms : 0;
    case 'convolve':
      return fx.mix > 0 ? irLengthMs(fx) : 0;
    case 'delay':
      return fx.mix > 0 ? fx.time_ms * (1 + (fx.feedback > 0.01 ? Math.min(40, Math.log(0.001) / Math.log(fx.feedback)) : 0)) : 0;
    case 'comb': {
      const fb = Math.abs(fx.feedback);
      const hz = typeof fx.hz === 'number' ? fx.hz : 60;
      return fb > 0.01 ? Math.min(4000, ((1000 / hz) * Math.log(0.001)) / Math.log(fb)) : 0;
    }
    case 'chorus':
      return fx.delay_ms * 2 + fx.depth_ms;
    case 'pitch':
      return 0;
    default:
      return 0;
  }
}
