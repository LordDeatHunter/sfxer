import type { Source } from '../schema/index.js';
import type { Mono, Rng, Stereo } from '../util.js';
import { fm, impulse, noise, osc, pluck } from './basic.js';
import { modal, modalLengthMs } from './modal.js';
import { particles } from './particles.js';
import { granular, sample, sampleLengthMs } from './sampler.js';

/** Decoded audio for `sample` and `granular` sources. */
export interface Asset {
  sr: number;
  channels: Float32Array[];
}
export type Assets = Record<string, Asset>;

export interface Ctx {
  sr: number;
  /** Number of samples to produce. */
  n: number;
  rng: Rng;
  assets: Assets;
}

export function renderSource(s: Source, ctx: Ctx): Mono | Stereo {
  switch (s.type) {
    case 'osc':
      return osc(s, ctx);
    case 'fm':
      return fm(s, ctx);
    case 'noise':
      return noise(s, ctx);
    case 'impulse':
      return impulse(s, ctx);
    case 'modal':
      return modal(s, ctx);
    case 'pluck':
      return pluck(s, ctx);
    case 'particles':
      return particles(s, ctx);
    case 'sample':
      return sample(s, ctx);
    case 'granular':
      return granular(s, ctx);
  }
}

/** How long a source sounds by itself, or undefined if it runs until something stops it. */
export function sourceLengthMs(s: Source, rng: Rng, sr: number, assets: Assets): number | undefined {
  switch (s.type) {
    case 'impulse':
      return s.width_ms;
    case 'modal':
      return modalLengthMs(s, rng, sr);
    case 'pluck':
      return s.decay_ms;
    case 'sample':
      return sampleLengthMs(s, assets[s.file]);
    default:
      return undefined;
  }
}
