import type { SourceOf } from '../schema/index.js';
import { dbToGain, logLerp, peakOf, type Mono, type Rng } from '../util.js';
import type { Ctx } from './index.js';

export interface Mode {
  hz: number;
  gain_db: number;
  /** Time to decay by 60 dB. */
  decay_ms: number;
}

interface Material {
  /** Explicit partial ratios, continued by `stretch` when more modes are requested. */
  ratios?: number[];
  /** Partial k sits at (k+1)^stretch times the fundamental. 1 = harmonic, 2 = stiff bar. */
  stretch: number;
  /** Random detuning of partials; gives irregular, real-object character. */
  jitter: number;
  /** Fundamental for the largest and smallest object. */
  fLarge: number;
  fSmall: number;
  /** Ring time of the fundamental at medium size, ms. */
  t60: number;
  /** Frequency at which ring time has halved; lower means highs die faster. */
  fDamp: number;
  dampPower: number;
  /** Level change per octave above the fundamental, dB. */
  tilt: number;
  /** Detune of a twin partial; real ringing objects have near-degenerate mode pairs that beat. */
  beat: number;
}

export const MATERIAL_MODELS: Record<SourceOf<'modal'>['material'], Material> = {
  wood: { stretch: 1.25, jitter: 0.2, fLarge: 80, fSmall: 900, t60: 180, fDamp: 700, dampPower: 1.2, tilt: -3, beat: 0 },
  metal: { stretch: 1.08, jitter: 0.35, fLarge: 120, fSmall: 2600, t60: 2600, fDamp: 5000, dampPower: 1, tilt: -1, beat: 0.004 },
  glass: {
    ratios: [1, 2.32, 4.25, 6.63, 9.38, 12.5, 16.1],
    stretch: 1.62, jitter: 0.03, fLarge: 450, fSmall: 4200, t60: 900, fDamp: 6000, dampPower: 1.2, tilt: -1, beat: 0.003,
  },
  plastic: { stretch: 1.2, jitter: 0.2, fLarge: 180, fSmall: 1900, t60: 90, fDamp: 1500, dampPower: 1.3, tilt: -2.5, beat: 0 },
  ceramic: { stretch: 1.4, jitter: 0.1, fLarge: 350, fSmall: 3200, t60: 380, fDamp: 4000, dampPower: 1.2, tilt: -2.5, beat: 0.002 },
  stone: { stretch: 1.05, jitter: 0.4, fLarge: 130, fSmall: 1600, t60: 45, fDamp: 2500, dampPower: 1, tilt: -1, beat: 0 },
  bell: {
    ratios: [0.5, 1, 1.183, 1.506, 2, 2.514, 2.662, 3.011, 4.166, 5.433, 6.796, 8.215],
    stretch: 1.3, jitter: 0.01, fLarge: 180, fSmall: 3200, t60: 5000, fDamp: 3000, dampPower: 0.9, tilt: -2, beat: 0.003,
  },
  membrane: {
    ratios: [1, 1.593, 2.136, 2.296, 2.653, 2.918, 3.156, 3.501, 3.6, 3.652, 4.06, 4.154],
    stretch: 1.05, jitter: 0.02, fLarge: 45, fSmall: 420, t60: 380, fDamp: 400, dampPower: 1, tilt: -5, beat: 0,
  },
  hollow: { stretch: 1.1, jitter: 0.25, fLarge: 55, fSmall: 520, t60: 260, fDamp: 500, dampPower: 1.1, tilt: -4, beat: 0 },
};

/** Build the mode list for a material. Exposed so the editor and Match can show and edit modes. */
export function materialModes(s: SourceOf<'modal'>, rng: Rng, sr: number): Mode[] {
  const m = MATERIAL_MODELS[s.material];
  const f0 = s.hz ?? logLerp(m.fSmall, m.fLarge, s.size);
  const sizeScale = 0.5 + s.size;
  const damp = 1 - 0.93 * s.damping;
  const fc = 300 * Math.pow(2, s.strike.hardness * 6);
  const modes: Mode[] = [];
  const explicit = m.ratios ?? [];
  const lastExplicit = explicit[explicit.length - 1] ?? 1;
  for (let k = 0; k < s.mode_count; k++) {
    let ratio =
      k < explicit.length
        ? explicit[k]!
        : explicit.length
          ? lastExplicit * Math.pow((k + 1) / explicit.length, m.stretch)
          : Math.pow(k + 1, m.stretch);
    if (k > 0) ratio *= 1 + m.jitter * rng.bi() * 0.5;
    const jitterDb = k > 0 ? rng.bi() * 4 : 0;
    const hz = f0 * ratio;
    if (hz > sr * 0.42) continue;
    const position = 0.35 + 0.65 * Math.abs(Math.sin(Math.PI * (k + 1) * s.strike.position));
    const hardness = 1 / Math.sqrt(1 + Math.pow(hz / fc, 2));
    const gain_db = m.tilt * Math.log2(Math.max(ratio, 0.25)) + jitterDb + 20 * Math.log10(position * hardness);
    const decay_ms = Math.max(3, (m.t60 * sizeScale * damp) / (1 + Math.pow(hz / m.fDamp, m.dampPower)));
    modes.push({ hz, gain_db, decay_ms });
    if (m.beat > 0 && k < 12) {
      modes.push({ hz: hz * (1 + m.beat * (0.5 + rng.next())), gain_db: gain_db - 4 - 4 * rng.next(), decay_ms: decay_ms * (0.7 + 0.3 * rng.next()) });
    }
  }
  return modes;
}

export function synthModes(modes: Mode[], n: number, sr: number): Mono {
  const out = new Float32Array(n);
  for (const mode of modes) {
    const g = dbToGain(mode.gain_db);
    if (g < 1e-5) continue;
    const d = Math.exp(-6.908 / ((mode.decay_ms / 1000) * sr));
    const inc = (2 * Math.PI * mode.hz) / sr;
    let env = g;
    let ph = 0;
    const floor = g * 1e-4;
    for (let i = 0; i < n && env > floor; i++) {
      out[i] = out[i]! + env * Math.sin(ph);
      env *= d;
      ph += inc;
    }
  }
  const p = peakOf(out);
  if (p > 0) for (let i = 0; i < n; i++) out[i] = out[i]! / p;
  return out;
}

export function modalModes(s: SourceOf<'modal'>, rng: Rng, sr: number): Mode[] {
  return s.modes ? s.modes.map((m) => ({ ...m })) : materialModes(s, rng, sr);
}

export function modal(s: SourceOf<'modal'>, ctx: Ctx): Mono {
  return synthModes(modalModes(s, ctx.rng, ctx.sr), ctx.n, ctx.sr);
}

export function modalLengthMs(s: SourceOf<'modal'>, rng: Rng, sr: number): number {
  let longest = 0;
  for (const m of modalModes(s, rng, sr)) if (m.gain_db > -50) longest = Math.max(longest, m.decay_ms);
  return longest;
}
