import type { z } from 'zod';
import { nearest } from '../util.js';
import { LAYER_KEYS, MASTER_KEYS, NODE_KEYS, PATCH_KEYS, Patch as PatchSchema, type Patch } from './index.js';

export interface PatchIssue {
  /** JSON path such as `layers[0].source.material`. */
  path: string;
  message: string;
}

export class PatchError extends Error {
  constructor(public readonly issues: PatchIssue[]) {
    super(`Invalid patch:\n${issues.map((i) => `  ${i.path || '(root)'}: ${i.message}`).join('\n')}`);
    this.name = 'PatchError';
  }
}

type Issue = z.core.$ZodIssue;

const fmtPath = (path: readonly PropertyKey[]): string =>
  path.reduce<string>((s, k) => (typeof k === 'number' ? `${s}[${k}]` : s ? `${s}.${String(k)}` : String(k)), '');

function valueAt(root: unknown, path: readonly PropertyKey[]): unknown {
  let v: unknown = root;
  for (const k of path) {
    if (v === null || typeof v !== 'object') return undefined;
    v = (v as Record<PropertyKey, unknown>)[k];
  }
  return v;
}

const show = (v: unknown): string => {
  const s = JSON.stringify(v);
  return s === undefined ? 'missing' : s.length > 60 ? `${s.slice(0, 57)}...` : s;
};

function allowedKeysFor(root: unknown, path: readonly PropertyKey[], rootKeys: string[]): string[] | undefined {
  const obj = valueAt(root, path);
  const type = obj && typeof obj === 'object' ? (obj as { type?: unknown }).type : undefined;
  if (typeof type === 'string' && NODE_KEYS[type]) return NODE_KEYS[type];
  if (path.length === 0) return rootKeys;
  const last = path[path.length - 1];
  if (last === 'master') return MASTER_KEYS;
  if (path.length === 2 && path[0] === 'layers') return LAYER_KEYS;
  if (obj && typeof obj === 'object') {
    if ('env' in obj) return ['env', 'curve'];
    if ('lfo' in obj) return ['lfo', 'base'];
    if ('random' in obj) return ['random', 'base'];
  }
  return undefined;
}

function describe(issue: Issue, root: unknown, basePath: readonly PropertyKey[], rootKeys: string[] = PATCH_KEYS): PatchIssue[] {
  const path = [...basePath, ...issue.path];
  const value = valueAt(root, path);
  const at = fmtPath(path);
  switch (issue.code) {
    case 'invalid_value': {
      const options = issue.values.map(String);
      const hint = typeof value === 'string' ? nearest(value, options) : undefined;
      return [
        {
          path: at,
          message: `${show(value)} is not valid${hint ? `; did you mean "${hint}"?` : '.'} Allowed: ${options.join(', ')}`,
        },
      ];
    }
    case 'unrecognized_keys': {
      const allowed = allowedKeysFor(root, path, rootKeys);
      return issue.keys.map((k) => {
        const hint = allowed ? nearest(k, allowed) : undefined;
        return {
          path: fmtPath([...path, k]),
          message: `unknown key${hint ? `; did you mean "${hint}"?` : '.'}${allowed ? ` Allowed here: ${allowed.join(', ')}` : ''}`,
        };
      });
    }
    case 'too_big':
      return [{ path: at, message: `${show(value)} is too large; maximum is ${issue.maximum}` }];
    case 'too_small':
      return [{ path: at, message: `${show(value)} is too small; minimum is ${issue.minimum}` }];
    case 'invalid_type':
      return [
        {
          path: at,
          message: value === undefined ? `required ${issue.expected} is missing` : `expected ${issue.expected}, got ${show(value)}`,
        },
      ];
    case 'invalid_union': {
      const disc = issue as Issue & { discriminator?: string; options?: unknown[] };
      if (disc.discriminator && disc.options) {
        const options = disc.options.map(String);
        const hint = typeof value === 'string' ? nearest(value, options) : undefined;
        return [
          {
            path: at,
            message:
              value === undefined
                ? `required "type" is missing. Allowed: ${options.join(', ')}`
                : `${show(value)} is not a known type${hint ? `; did you mean "${hint}"?` : '.'} Allowed: ${options.join(', ')}`,
          },
        ];
      }
      if (value === undefined) return [{ path: at, message: 'required value is missing' }];
      // A modulatable parameter: report against the branch the author was clearly aiming for.
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        const idx = 'env' in value ? 1 : 'lfo' in value ? 2 : 'random' in value ? 3 : -1;
        const branch = issue.errors[idx];
        if (branch && branch.length) return branch.flatMap((sub) => describe(sub, root, path, rootKeys));
        return [
          {
            path: at,
            message: `${show(value)} is not a valid value. Use a number, or a modulation object: {"env": [[ms, value], ...]}, {"lfo": {"hz", "depth"}, "base"}, or {"random": {"rate_hz", "depth"}, "base"}`,
          },
        ];
      }
      const first = issue.errors.find((e) => e.length === 1 && e[0]!.code !== 'invalid_type');
      if (first) return first.flatMap((sub) => describe(sub, root, path, rootKeys));
      return [{ path: at, message: `${show(value)} is not valid here; expected a number or a modulation object` }];
    }
    default:
      return [{ path: at, message: issue.message }];
  }
}

/** Turn a zod error into path + plain-language messages. Also used for recipe parameters. */
export function formatIssues(error: z.ZodError, input: unknown, rootKeys: string[] = PATCH_KEYS): PatchIssue[] {
  return error.issues.flatMap((i) => describe(i, input, [], rootKeys));
}

export type ValidationResult = { ok: true; patch: Patch } | { ok: false; issues: PatchIssue[] };

export function validatePatch(input: unknown): ValidationResult {
  const r = PatchSchema.safeParse(input);
  if (r.success) {
    const issues = semanticChecks(r.data);
    return issues.length ? { ok: false, issues } : { ok: true, patch: r.data };
  }
  return { ok: false, issues: formatIssues(r.error, input) };
}

/** Parse or throw a PatchError with every problem listed. */
export function parsePatch(input: unknown): Patch {
  const r = validatePatch(input);
  if (!r.ok) throw new PatchError(r.issues);
  return r.patch;
}

function semanticChecks(patch: Patch): PatchIssue[] {
  const issues: PatchIssue[] = [];
  if (patch.master.loop && patch.duration === 'auto') {
    issues.push({ path: 'duration', message: 'master.loop needs a fixed duration in ms, not "auto"' });
  }
  const checkEnv = (p: unknown, path: string) => {
    if (p && typeof p === 'object' && 'env' in p) {
      const env = (p as { env: [number, number][] }).env;
      for (let i = 1; i < env.length; i++) {
        if (env[i]![0] < env[i - 1]![0]) {
          issues.push({ path: `${path}.env[${i}][0]`, message: `time ${env[i]![0]} ms is earlier than the previous point (${env[i - 1]![0]} ms); envelope times must increase` });
        }
      }
    }
  };
  const walk = (node: Record<string, unknown>, path: string) => {
    for (const [k, v] of Object.entries(node)) checkEnv(v, `${path}.${k}`);
  };
  patch.layers.forEach((layer, li) => {
    const lp = `layers[${li}]`;
    checkEnv(layer.amp, `${lp}.amp`);
    checkEnv(layer.pan, `${lp}.pan`);
    walk(layer.source, `${lp}.source`);
    layer.fx.forEach((fx, fi) => walk(fx, `${lp}.fx[${fi}]`));
    const s = layer.source;
    if ((s.type === 'particles') && (s.hz[0] > s.hz[1] || s.decay_ms[0] > s.decay_ms[1])) {
      issues.push({ path: `${lp}.source`, message: 'ranges must be [low, high] with low <= high' });
    }
  });
  patch.master.fx.forEach((fx, fi) => walk(fx, `master.fx[${fi}]`));
  if (patch.layers.every((l) => l.mute)) issues.push({ path: 'layers', message: 'every layer is muted; nothing to render' });
  return issues;
}
