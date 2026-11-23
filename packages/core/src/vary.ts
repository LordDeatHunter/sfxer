import { Patch, type PatchInput } from './schema/index.js';
import { hash32, Rng } from './util.js';

const SKIP = new Set(['version', 'seed', 'mode_count', 'unison', 'slope', 'bits', 'duration', 'phase', 'lufs', 'peak_db', 'ceiling_db']);

type Json = unknown;
const isObj = (v: Json): v is Record<string, Json> => v !== null && typeof v === 'object' && !Array.isArray(v);

/** How a value under a given key should be nudged: [multiplicative octaves, additive amount]. */
function rule(key: string): { mul?: number; add?: number } | undefined {
  if (SKIP.has(key) || key === 'amp') return undefined;
  if (key.endsWith('hz') || key === 'q' || key === 'ratio') return { mul: 0.3 };
  if (key.endsWith('_ms')) return { mul: 0.35 };
  if (key.endsWith('db')) return { add: 3 };
  if (key.includes('semitones')) return { add: 1.5 };
  if (key === 'pan') return { add: 0.25 };
  return { mul: 0.3 };
}

function nudge(v: number, r: { mul?: number; add?: number }, amount: number, u: number): number {
  const out = r.mul !== undefined ? v * Math.pow(2, r.mul * amount * u) : v + (r.add ?? 0) * amount * u;
  return Math.round(out * 1000) / 1000;
}

function mutate(node: Json, key: string, amount: number, rng: Rng): Json {
  if (typeof node === 'number') {
    const r = rule(key);
    return r ? nudge(node, r, amount, rng.bi()) : node;
  }
  if (Array.isArray(node)) {
    if (node.length === 2 && node.every((x) => typeof x === 'number')) {
      const r = rule(key);
      if (!r) return node;
      return (node as number[]).map((x) => nudge(x, r, amount, rng.bi())).sort((a, b) => a - b);
    }
    return node.map((x) => mutate(x, key, amount, rng));
  }
  if (!isObj(node)) return node;
  if (Array.isArray(node.env)) {
    // Keep an envelope's shape: one time stretch and one value shift for all points.
    const stretch = Math.pow(2, 0.3 * amount * rng.bi());
    const r = rule(key);
    const u = rng.bi();
    return {
      ...node,
      env: (node.env as [number, number][]).map(([t, v]) => [Math.round(t * stretch * 10) / 10, r ? nudge(v, r, amount, u) : v]),
    };
  }
  if (isObj(node.lfo) || isObj(node.random)) {
    const out: Record<string, Json> = {};
    for (const [k, v] of Object.entries(node)) {
      out[k] = k === 'base' ? mutate(v, key, amount, rng) : isObj(v) ? mutate(v, 'mod', amount, rng) : v;
    }
    return out;
  }
  const out: Record<string, Json> = {};
  for (const [k, v] of Object.entries(node)) {
    out[k] = k === 'start_ms' && v === 0 ? v : mutate(v, k, amount, rng);
  }
  return out;
}

/** Pull any value that drifted out of range back to the nearest allowed value. */
export function clampToSchema(patch: Record<string, Json>): void {
  for (let pass = 0; pass < 4; pass++) {
    const r = Patch.safeParse(patch);
    if (r.success) return;
    let fixed = false;
    const fix = (path: readonly PropertyKey[], issue: { code?: string; maximum?: unknown; minimum?: unknown; errors?: unknown }) => {
      if (issue.code === 'invalid_union' && Array.isArray(issue.errors)) {
        for (const branch of issue.errors as { path: PropertyKey[]; code: string }[][]) {
          for (const sub of branch) fix([...path, ...sub.path], sub);
        }
        return;
      }
      const limit = issue.code === 'too_big' ? issue.maximum : issue.code === 'too_small' ? issue.minimum : undefined;
      if (typeof limit !== 'number') return;
      let parent: Json = patch;
      for (const k of path.slice(0, -1)) parent = (parent as Record<PropertyKey, Json>)?.[k];
      const last = path[path.length - 1];
      if (parent && typeof parent === 'object' && last !== undefined && typeof (parent as Record<PropertyKey, Json>)[last] === 'number') {
        (parent as Record<PropertyKey, Json>)[last] = limit;
        fixed = true;
      }
    };
    for (const issue of r.error.issues) fix(issue.path, issue as never);
    if (!fixed) return;
  }
}

export interface VaryOptions {
  /** How many variations to make. */
  count?: number;
  /** 0 = only the random seed changes; 1 = clearly different takes. */
  amount?: number;
  seed?: number;
}

/**
 * Make related-but-different versions of a patch, the way a sound designer
 * records several takes so repeated footsteps or hits never sound identical.
 */
export function vary(patch: PatchInput, options: VaryOptions = {}): PatchInput[] {
  const count = options.count ?? 4;
  const amount = Math.max(0, Math.min(1, options.amount ?? 0.3));
  const baseSeed = options.seed ?? patch.seed ?? 1;
  const out: PatchInput[] = [];
  for (let i = 0; i < count; i++) {
    const seed = hash32(baseSeed + (i + 1) * 0x9e3779b1) % 1000000;
    const rng = new Rng(seed);
    const copy = structuredClone(patch) as Record<string, Json>;
    if (amount > 0) {
      copy.layers = (copy.layers as Json[]).map((l) => mutate(l, 'layer', amount, rng));
      if (isObj(copy.master) && Array.isArray(copy.master.fx)) {
        copy.master = { ...copy.master, fx: copy.master.fx.map((f) => (isObj(f) && f.type === 'limiter' ? f : mutate(f, 'fx', amount * 0.5, rng))) };
      }
    }
    copy.seed = seed;
    copy.name = `${patch.name ?? 'untitled'}_v${i + 1}`;
    clampToSchema(copy);
    out.push(copy as PatchInput);
  }
  return out;
}
