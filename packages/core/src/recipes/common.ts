import { z } from 'zod';
import type { FxInput, LayerInput, PatchInput } from '../schema/index.js';

export type Curve = 'linear' | 'exp' | 'smooth' | 'step';
export const env = (points: [number, number][], curve: Curve = 'exp') => ({ env: points, curve });

export const unit = (def: number, description: string) => z.number().min(0).max(1).default(def).meta({ description });
export const num = (min: number, max: number, def: number, description: string) =>
  z.number().min(min).max(max).default(def).meta({ description });
export const choice = <const T extends readonly [string, ...string[]]>(values: T, def: T[number], description: string) =>
  z.enum(values).default(def as never).meta({ description });

export const wetness = (def: number) => unit(def, 'Amount of room/reverb. 0 = dry and close, 1 = drenched.');
export const brightness = (def = 0.5) => unit(def, 'Overall brightness. 0 = dark and muffled, 1 = crisp and airy.');
export const distance = () => num(0, 500, 0, 'Distance from the listener in metres. 0 = right here.');

export interface Recipe<S extends z.ZodObject = z.ZodObject> {
  name: string;
  description: string;
  params: S;
  build: (p: z.output<S>, seed: number) => PatchInput;
}

export const defineRecipe = <S extends z.ZodObject>(r: Recipe<S>): Recipe<S> => r;

export const room = (wet: number, size: number, decayMs: number): FxInput[] =>
  wet > 0.001
    ? [{ type: 'reverb', size, decay_ms: Math.round(decayMs), damping: 0.45, predelay_ms: 6, mix: Math.round(wet * 0.45 * 1000) / 1000 }]
    : [];

export const far = (meters: number): FxInput[] => (meters >= 1 ? [{ type: 'distance', meters }] : []);

export const r1 = (x: number): number => Math.round(x * 10) / 10;
export const r0 = (x: number): number => Math.round(x);
export const lg = (a: number, b: number, t: number): number => a * Math.pow(b / a, t);
export const lin = (a: number, b: number, t: number): number => a + (b - a) * t;

export const layers = (...items: (LayerInput | false | undefined)[]): LayerInput[] =>
  items.filter((l): l is LayerInput => Boolean(l));
