import { expandRecipe, type Assets, type PatchInput, type PatchIssue } from '@sfxer/core';
import { play } from './audio';
import { engine } from './engine';
import type { Rendered } from './protocol';

export type View = 'library' | 'editor' | 'variations' | 'match';

interface AppState {
  view: View;
  patch: PatchInput;
  result: Rendered | undefined;
  issues: PatchIssue[];
  /** A problem outside validation, e.g. a missing sample file. */
  error: string;
  busy: boolean;
  autoplay: boolean;
  /** Index of the soloed layer, or -1. */
  solo: number;
  assets: Assets;
}

/** Give every layer and the master an effect list, so the editor always has something to bind to. */
export function normalise(patch: PatchInput): PatchInput {
  patch.master ??= {};
  patch.master.fx ??= [];
  for (const layer of patch.layers) layer.fx ??= [];
  return patch;
}

export const app: AppState = $state({
  view: 'library',
  patch: normalise(expandRecipe('impact')),
  result: undefined,
  issues: [],
  error: '',
  busy: false,
  autoplay: true,
  solo: -1,
  assets: {},
});

let timer: ReturnType<typeof setTimeout> | undefined;
let generation = 0;

/** Plain copy without Svelte's reactive proxies, safe to send to the worker. */
export const snapshot = <T>(value: T): T => $state.snapshot(value) as T;

async function renderNow(andPlay: boolean): Promise<void> {
  const mine = ++generation;
  app.busy = true;
  try {
    const patch = snapshot(app.patch);
    const outcome = await engine.call('render', { patch, assets: snapshot(app.assets), ...(app.solo >= 0 ? { solo: [app.solo] } : {}) });
    if (mine !== generation) return; // a newer edit superseded this render
    app.error = '';
    if (outcome.ok) {
      app.issues = [];
      app.result = outcome.value;
      if (andPlay) playResult();
    } else {
      app.issues = outcome.issues;
    }
  } catch (e) {
    if (mine === generation) app.error = e instanceof Error ? e.message : String(e);
  } finally {
    if (mine === generation) app.busy = false;
  }
}

/** Re-render shortly after the last edit. */
export function touch(): void {
  clearTimeout(timer);
  timer = setTimeout(() => void renderNow(app.autoplay), 180);
}

export function setPatch(patch: PatchInput, andPlay = app.autoplay): void {
  app.patch = normalise(patch);
  app.solo = -1;
  clearTimeout(timer);
  void renderNow(andPlay);
}

export function playResult(): void {
  if (app.result) play(app.result.channels, app.result.sampleRate, app.patch.master?.loop === true);
}

export function reseed(): void {
  app.patch.seed = Math.floor(Math.random() * 1_000_000);
  touch();
}
