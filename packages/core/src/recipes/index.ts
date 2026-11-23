import type { PatchInput } from '../schema/index.js';
import { formatIssues, PatchError } from '../schema/validate.js';
import { nearest } from '../util.js';
import { clampToSchema } from '../vary.js';
import type { Recipe } from './common.js';
import { energy, magic, pickup, ui } from './designed.js';
import { gore } from './organic.js';
import { crumble, explosion, footstep, impact, whoosh } from './physical.js';
import { ambience_loop, door, mechanical } from './world.js';

export type { Recipe } from './common.js';

export const RECIPES: Record<string, Recipe> = Object.fromEntries(
  ([impact, whoosh, explosion, footstep, ui, pickup, magic, energy, mechanical, door, ambience_loop, gore, crumble] as unknown as Recipe[]).map((r) => [r.name, r]),
);

export class UnknownRecipeError extends Error {
  constructor(name: string) {
    const names = Object.keys(RECIPES);
    const hint = nearest(name, names);
    super(`Unknown recipe "${name}"${hint ? `; did you mean "${hint}"?` : '.'} Available: ${names.join(', ')}`);
    this.name = 'UnknownRecipeError';
  }
}

/**
 * Expand a recipe into a full, editable patch. Recipes are starting points:
 * render the result, read the report, then edit the patch itself.
 */
export function expandRecipe(name: string, params: Record<string, unknown> = {}, seed = 1): PatchInput {
  const recipe = RECIPES[name];
  if (!recipe) throw new UnknownRecipeError(name);
  const parsed = recipe.params.safeParse(params);
  if (!parsed.success) throw new PatchError(formatIssues(parsed.error, params, Object.keys(recipe.params.shape)));
  const patch = recipe.build(parsed.data, seed);
  // Extreme parameter combinations can push a derived value just past its range; pull it back.
  clampToSchema(patch as Record<string, unknown>);
  return patch;
}
