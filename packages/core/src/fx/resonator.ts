import type { FxOf, SourceOf } from '../schema/index.js';
import { MATERIAL_MODELS, materialModes } from '../sources/modal.js';
import { dbToGain, type Stereo } from '../util.js';
import type { FxCtx } from './index.js';

const rms = (x: Float32Array): number => {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i]! * x[i]!;
  return Math.sqrt(s / Math.max(1, x.length));
};

/** Parallel bank of two-pole resonators tuned to a material's modes; output matched to the input's RMS. */
export function resonator(buf: Stereo, fx: FxOf<'resonator'>, ctx: FxCtx): void {
  const spec = {
    type: 'modal',
    material: fx.material,
    size: fx.size,
    damping: fx.damping,
    mode_count: fx.mode_count,
    strike: { hardness: 1, position: 0.28 },
    ...(fx.hz !== undefined ? { hz: fx.hz } : {}),
  } as SourceOf<'modal'>;
  const modes = materialModes(spec, ctx.rng, ctx.sr);
  for (const ch of buf) {
    const inRms = rms(ch);
    if (inRms === 0) continue;
    const wet = new Float32Array(ch.length);
    for (const m of modes) {
      const g = dbToGain(m.gain_db);
      if (g < 1e-4) continue;
      const w = (2 * Math.PI * m.hz) / ctx.sr;
      const r = Math.exp(-6.908 / Math.max(1, (m.decay_ms / 1000) * ctx.sr));
      const a1 = 2 * r * Math.cos(w);
      const a2 = r * r;
      // (1 - r^2) keeps each mode's energy roughly independent of its ring time.
      const b0 = g * (1 - a2);
      let y1 = 0;
      let y2 = 0;
      for (let i = 0; i < ch.length; i++) {
        const y = b0 * ch[i]! + a1 * y1 - a2 * y2;
        y2 = y1;
        y1 = y;
        wet[i] = wet[i]! + y;
      }
    }
    const outRms = rms(wet);
    const k = outRms > 0 ? inRms / outRms : 0;
    for (let i = 0; i < ch.length; i++) ch[i] = ch[i]! * (1 - fx.mix) + wet[i]! * k * fx.mix;
  }
}

/** Ring time of the fundamental, roughly as the modal source computes it. */
export function resonatorTailMs(fx: FxOf<'resonator'>): number {
  const m = MATERIAL_MODELS[fx.material];
  return fx.mix > 0 ? Math.min(8000, m.t60 * (0.5 + fx.size) * (1 - 0.93 * fx.damping)) : 0;
}
