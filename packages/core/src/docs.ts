import { z } from 'zod';
import { RECIPES } from './recipes/index.js';
import { Fx, FX_TYPES, Layer, Master, Patch, Source, SOURCE_TYPES, fxSchema, sourceSchema } from './schema/index.js';

export interface FieldDoc {
  name: string;
  /** number, integer, boolean, string, enum, range, object, list. */
  type: string;
  /** Accepts a modulation object (env / lfo / random) as well as a number. */
  modulatable: boolean;
  required: boolean;
  min?: number;
  max?: number;
  default?: unknown;
  options?: string[];
  description?: string;
  fields?: FieldDoc[];
}

export interface NodeDoc {
  name: string;
  kind: 'source' | 'fx' | 'recipe' | 'structure';
  description: string;
  fields: FieldDoc[];
}

type JS = {
  type?: string;
  description?: string;
  default?: unknown;
  enum?: unknown[];
  const?: unknown;
  minimum?: number;
  maximum?: number;
  modulatable?: boolean;
  min?: number;
  max?: number;
  anyOf?: JS[];
  properties?: Record<string, JS>;
  required?: string[];
  items?: JS;
  prefixItems?: JS[];
};

function field(name: string, s: JS, required: boolean): FieldDoc {
  const f: FieldDoc = { name, type: s.type ?? 'any', modulatable: false, required };
  if (s.description) f.description = s.description;
  if (s.default !== undefined) f.default = s.default;
  if (s.modulatable) {
    f.type = 'number';
    f.modulatable = true;
    if (s.min !== undefined) f.min = s.min;
    if (s.max !== undefined) f.max = s.max;
  } else if (s.enum) {
    f.type = 'enum';
    f.options = s.enum.map(String);
  } else if (s.const !== undefined) {
    f.type = 'enum';
    f.options = [String(s.const)];
  } else if (s.anyOf) {
    const consts = s.anyOf.filter((a) => a.const !== undefined).map((a) => String(a.const));
    const numeric = s.anyOf.find((a) => a.type === 'number');
    const object = s.anyOf.find((a) => a.type === 'object');
    if (consts.length === s.anyOf.length) {
      f.type = 'enum';
      f.options = consts;
    } else if (object?.properties) {
      f.type = 'object';
      f.fields = Object.entries(object.properties).map(([k, v]) => field(k, v, object.required?.includes(k) ?? false));
      if (consts.length) f.options = consts;
    } else if (numeric) {
      f.type = 'number';
      if (numeric.minimum !== undefined) f.min = numeric.minimum;
      if (numeric.maximum !== undefined) f.max = numeric.maximum;
      if (consts.length) f.options = consts;
    } else {
      f.type = 'enum';
      f.options = consts;
    }
  } else if (s.type === 'array' && s.prefixItems) {
    f.type = 'range';
    const first = s.prefixItems[0];
    if (first?.minimum !== undefined) f.min = first.minimum;
    if (first?.maximum !== undefined) f.max = first.maximum;
  } else if (s.type === 'array') {
    f.type = 'list';
    if (s.items?.properties) f.fields = Object.entries(s.items.properties).map(([k, v]) => field(k, v, s.items!.required?.includes(k) ?? false));
  } else if (s.type === 'object' && s.properties) {
    f.fields = Object.entries(s.properties).map(([k, v]) => field(k, v, s.required?.includes(k) ?? false));
  } else {
    if (s.minimum !== undefined) f.min = s.minimum;
    if (s.maximum !== undefined) f.max = s.maximum;
  }
  return f;
}

function nodeDoc(name: string, kind: NodeDoc['kind'], schema: z.ZodType, skip: string[] = []): NodeDoc {
  const js = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as JS;
  return {
    name,
    kind,
    description: js.description ?? '',
    fields: Object.entries(js.properties ?? {})
      .filter(([k]) => k !== 'type' && !skip.includes(k))
      .map(([k, v]) => field(k, v, js.required?.includes(k) ?? false)),
  };
}

/** Describe one source, effect, recipe or structural node ("patch", "layer", "master"). */
export function describeNode(name: string): NodeDoc | undefined {
  const src = sourceSchema(name);
  if (src) return nodeDoc(name, 'source', src);
  const fx = fxSchema(name);
  if (fx) return nodeDoc(name, 'fx', fx);
  const recipe = RECIPES[name];
  if (recipe) return { ...nodeDoc(name, 'recipe', recipe.params), description: recipe.description };
  if (name === 'layer') return nodeDoc('layer', 'structure', Layer, ['source', 'fx']);
  if (name === 'master') return nodeDoc('master', 'structure', Master, ['fx']);
  if (name === 'patch') return nodeDoc('patch', 'structure', Patch, ['layers', 'master']);
  return undefined;
}

export const NODE_NAMES = (): string[] => ['patch', 'layer', 'master', ...SOURCE_TYPES, ...FX_TYPES, ...Object.keys(RECIPES)];

/** JSON Schema for the whole patch, or for one source/effect type. */
export function jsonSchema(name?: string): unknown {
  const schema = name === undefined || name === 'patch' ? Patch : name === 'layer' ? Layer : name === 'master' ? Master : name === 'source' ? Source : name === 'fx' ? Fx : (sourceSchema(name) ?? fxSchema(name) ?? RECIPES[name]?.params);
  return schema ? z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) : undefined;
}

function fieldLine(f: FieldDoc, indent = ''): string {
  let type: string;
  if (f.options && f.type === 'enum') type = f.options.join(' | ');
  else if (f.type === 'range') type = `[low, high] each ${f.min}..${f.max}`;
  else if (f.min !== undefined || f.max !== undefined) type = `${f.min ?? ''}..${f.max ?? ''}${f.options ? ` | ${f.options.join(' | ')}` : ''}`;
  else type = f.type;
  const flags = [f.modulatable ? 'mod' : '', f.required ? 'required' : f.default !== undefined ? `default ${JSON.stringify(f.default)}` : 'optional'].filter(Boolean).join(', ');
  let line = `${indent}- \`${f.name}\`: ${type} (${flags})${f.description ? ` — ${f.description}` : ''}`;
  if (f.fields && f.type !== 'list') line += `\n${f.fields.map((c) => fieldLine(c, `${indent}  `)).join('\n')}`;
  else if (f.fields) line += `\n${indent}  each item:\n${f.fields.map((c) => fieldLine(c, `${indent}  `)).join('\n')}`;
  return line;
}

export function nodeMarkdown(doc: NodeDoc): string {
  return `### ${doc.name} (${doc.kind})\n${doc.description}\n${doc.fields.map((f) => fieldLine(f)).join('\n')}`;
}

/** The full reference, generated from the schemas so it can never drift from the engine. */
export function docsMarkdown(): string {
  const section = (title: string, names: string[]) => `## ${title}\n\n${names.map((n) => nodeMarkdown(describeNode(n)!)).join('\n\n')}`;
  return [
    '# sfxer patch reference',
    [
      'A patch is JSON: `{ name, seed, duration, layers: [...], master: {...} }`.',
      'Each layer is `{ source, amp, gain_db, pan, start_ms, fx: [...] }`. Layers are mixed, then `master.fx` runs, then the result is loudness-normalised and trimmed.',
      '',
      'Units: `hz`, `ms`, `db`, `semitones`; everything else is 0..1 unless a range says otherwise.',
      '',
      'Fields marked `mod` accept a number **or** one modulation object:',
      '- `{ "env": [[ms, value], ...], "curve": "linear" | "exp" | "smooth" | "step" }` — envelope; holds the last value. `exp` suits frequencies and natural decays.',
      '- `{ "lfo": { "hz", "depth", "shape": "sine" | "triangle" | "square" | "saw" }, "base" }` — base ± depth.',
      '- `{ "random": { "rate_hz", "depth", "smooth": true }, "base" }` — base ± depth, drifting randomly.',
      'Envelope times are milliseconds from the start of the layer.',
    ].join('\n'),
    section('Structure', ['patch', 'layer', 'master']),
    section('Sources', SOURCE_TYPES),
    section('Effects', FX_TYPES),
    section('Recipes', Object.keys(RECIPES)),
  ].join('\n\n');
}
