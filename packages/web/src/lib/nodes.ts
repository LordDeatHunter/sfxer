import { FX_TYPES, SOURCE_TYPES, type FxInput, type LayerInput, type SourceInput } from '@sfxer/core';

/** Smallest valid node of each type, used when the editor adds or switches one. */
const SOURCE_REQUIRED: Partial<Record<SourceInput['type'], Record<string, unknown>>> = {
  osc: { hz: 220 },
  fm: { hz: 220 },
  pluck: { hz: 220 },
  particles: { rate_hz: 60 },
  sample: { file: '' },
  granular: { file: '' },
};

const FX_REQUIRED: Partial<Record<FxInput['type'], Record<string, unknown>>> = {
  filter: { hz: 2000 },
  comb: { hz: 200 },
  pitch: { semitones: 0 },
  gain: { db: 0 },
};

const ENDLESS = new Set<string>(['osc', 'fm', 'noise', 'particles', 'granular']);

export const sourceTypes: readonly string[] = SOURCE_TYPES;
export const fxTypes: readonly string[] = FX_TYPES;

export function newSource(type: string): SourceInput {
  return { type, ...SOURCE_REQUIRED[type as SourceInput['type']] } as SourceInput;
}

export function newFx(type: string): FxInput {
  return { type, ...FX_REQUIRED[type as FxInput['type']] } as FxInput;
}

export function newLayer(type: string, index: number): LayerInput {
  const layer: LayerInput = { id: `${type}${index + 1}`, source: newSource(type), fx: [] };
  // Sources that never stop need an envelope, or the sound has no end.
  if (ENDLESS.has(type)) layer.amp = { env: [[0, 0], [5, 1], [400, 0]], curve: 'exp' };
  return layer;
}

export const isEndless = (type: string): boolean => ENDLESS.has(type);
