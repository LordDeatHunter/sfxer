import { expandRecipe } from '@sfxer/core';
import { playOneShot } from './audio';
import { engine } from './engine';

/**
 * Interface feedback made by sfxer itself: a pool of `ui` toggle variants (different seeds and
 * slight pitch offsets), rendered once in the background, one picked at random per click.
 */
const VARIANTS = [
  [1, 0],
  [2, 1.5],
  [3, -1.5],
  [4, 0.7],
  [5, -0.8],
  [6, 2.2],
] as const;

let pool: Float32Array[][] = [];
let loading: Promise<void> | undefined;
let last = -1;

function load(): Promise<void> {
  loading ??= (async () => {
    const rendered: Float32Array[][] = [];
    for (const [seed, pitch] of VARIANTS) {
      const patch = expandRecipe('ui', { kind: 'toggle', pitch_semitones: pitch }, seed);
      const outcome = await engine.call('render', { patch, assets: {} });
      if (outcome.ok) rendered.push(outcome.value.channels);
    }
    pool = rendered;
  })();
  return loading;
}

/** Start rendering the pool once the page has settled, so the first click already has a sound. */
export function preloadUiSounds(): void {
  setTimeout(() => void load(), 1500);
}

export function playToggle(): void {
  if (pool.length === 0) {
    void load();
    return;
  }
  // Random, but never the same variant twice in a row.
  let i = Math.floor(Math.random() * pool.length);
  if (i === last && pool.length > 1) i = (i + 1) % pool.length;
  last = i;
  playOneShot(pool[i]!, 48000, 0.5);
}
