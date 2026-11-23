<script lang="ts">
  import './Field.css';
  import { CURVES, LFO_SHAPES, type FieldDoc } from '@sfxer/core';
  import EnvEditor from './EnvEditor.svelte';
  import Field from './Field.svelte';

  type Point = [number, number];
  type Curve = (typeof CURVES)[number];
  type Dict = Record<string, unknown>;

  interface Props {
    doc: FieldDoc;
    /** Current value; undefined means "not set, the default applies". */
    value: unknown;
    onchange: (value: unknown) => void;
    /** Names offered for string fields, e.g. loaded sample files. */
    suggestions?: string[];
  }
  let { doc, value, onchange, suggestions = [] }: Props = $props();

  const isObj = (v: unknown): v is Dict => v !== null && typeof v === 'object' && !Array.isArray(v);
  const shown = $derived(value === undefined ? doc.default : value);
  const min = $derived(doc.min ?? 0);
  const max = $derived(doc.max ?? 1);
  const unit = $derived(doc.name.endsWith('hz') ? 'Hz' : doc.name.endsWith('_ms') ? 'ms' : doc.name.endsWith('db') ? 'dB' : doc.name.includes('semitones') ? 'st' : '');
  // Frequencies and times are heard in ratios, so their sliders are logarithmic.
  const logScale = $derived((unit === 'Hz' || unit === 'ms') && min > 0);
  const step = $derived(max - min <= 2 ? 0.01 : max - min <= 60 ? 0.1 : 1);
  const tidy = (v: number): number => Math.round(v / step) * step;
  const fix = (v: number): number => Number(Math.min(max, Math.max(min, tidy(v))).toFixed(4));

  const toSlider = (v: number): number => (logScale ? (Math.log(Math.max(v, min) / min) / Math.log(max / min)) * 1000 : v);
  const fromSlider = (s: number): number => (logScale ? min * Math.pow(max / min, s / 1000) : s);

  type Mode = 'value' | 'env' | 'lfo' | 'random';
  const mode: Mode = $derived(isObj(shown) ? ('env' in shown ? 'env' : 'lfo' in shown ? 'lfo' : 'random' in shown ? 'random' : 'value') : 'value');
  const plain = $derived(typeof shown === 'number' ? shown : isObj(shown) && typeof shown.base === 'number' ? shown.base : isObj(shown) && Array.isArray(shown.env) ? Number((shown.env as Point[])[0]?.[1] ?? min) : min);

  function setMode(next: Mode): void {
    const v = plain;
    const depth = Number(((max - min) * 0.1).toFixed(3));
    if (next === 'value') onchange(v);
    else if (next === 'env') onchange({ env: doc.name === 'amp' ? [[0, 0], [5, 1], [300, 0]] : [[0, v], [300, v]], curve: unit === 'Hz' || doc.name === 'amp' ? 'exp' : 'linear' });
    else if (next === 'lfo') onchange({ lfo: { hz: 5, depth, shape: 'sine' }, base: v });
    else onchange({ random: { rate_hz: 8, depth }, base: v });
  }

  const num = (raw: string, fallback: number): number => {
    const n = Number(raw);
    return raw !== '' && Number.isFinite(n) ? n : fallback;
  };
  const patchInner = (key: 'lfo' | 'random', field: string, v: unknown): void => {
    if (isObj(shown)) onchange({ ...shown, [key]: { ...(shown[key] as Dict), [field]: v } });
  };

  const asObject = $derived(isObj(shown) ? shown : {});
  const optionIsNumber = $derived(typeof doc.default === 'number');
  const listId = $derived(`suggest-${doc.name}`);
</script>

<div class="field">
  {#if doc.type === 'number' || doc.type === 'integer'}
    <div class="field-row">
      <span class="field-label" class:field-label-set={value !== undefined} title={doc.description}>{doc.name}</span>
      {#if doc.modulatable}
        <select class="input field-mode" value={mode} onchange={(e) => setMode(e.currentTarget.value as Mode)} aria-label={`${doc.name} mode`}>
          <option value="value">value</option>
          <option value="env">envelope</option>
          <option value="lfo">lfo</option>
          <option value="random">random</option>
        </select>
      {/if}
      {#if mode === 'value'}
        <input
          class="slider"
          type="range"
          min={logScale ? 0 : min}
          max={logScale ? 1000 : max}
          step={logScale ? 1 : doc.type === 'integer' ? 1 : step}
          value={toSlider(plain)}
          oninput={(e) => onchange(doc.type === 'integer' ? Math.round(fromSlider(Number(e.currentTarget.value))) : fix(fromSlider(Number(e.currentTarget.value))))}
          aria-label={doc.name}
        />
        <input class="input input-number" type="number" {min} {max} step="any" value={plain} onchange={(e) => onchange(Math.min(max, Math.max(min, num(e.currentTarget.value, plain))))} aria-label={`${doc.name} value`} />
        <span class="field-unit">{unit}</span>
      {/if}
    </div>
    {#if mode === 'env' && isObj(shown)}
      <div class="field-sub">
        <EnvEditor
          points={shown.env as Point[]}
          curve={(shown.curve as Curve | undefined) ?? 'linear'}
          {min}
          {max}
          log={unit === 'Hz'}
          onchange={(points, curve) => onchange({ env: points, curve })}
        />
      </div>
    {:else if mode === 'lfo' && isObj(shown) && isObj(shown.lfo)}
      <div class="field-sub">
        <div class="field-inline">
          centre <input class="input input-number" type="number" step="any" value={shown.base} onchange={(e) => onchange({ ...shown, base: Math.min(max, Math.max(min, num(e.currentTarget.value, plain))) })} />
          rate <input class="input input-number" type="number" min="0.01" max="2000" step="any" value={shown.lfo.hz} onchange={(e) => patchInner('lfo', 'hz', Math.min(2000, Math.max(0.01, num(e.currentTarget.value, 5))))} /> Hz
          depth <input class="input input-number" type="number" step="any" value={shown.lfo.depth} onchange={(e) => patchInner('lfo', 'depth', num(e.currentTarget.value, 0))} />
          <select class="input field-mode" value={shown.lfo.shape ?? 'sine'} onchange={(e) => patchInner('lfo', 'shape', e.currentTarget.value)}>
            {#each LFO_SHAPES as s (s)}<option value={s}>{s}</option>{/each}
          </select>
        </div>
      </div>
    {:else if mode === 'random' && isObj(shown) && isObj(shown.random)}
      <div class="field-sub">
        <div class="field-inline">
          centre <input class="input input-number" type="number" step="any" value={shown.base} onchange={(e) => onchange({ ...shown, base: Math.min(max, Math.max(min, num(e.currentTarget.value, plain))) })} />
          rate <input class="input input-number" type="number" min="0.01" max="2000" step="any" value={shown.random.rate_hz} onchange={(e) => patchInner('random', 'rate_hz', Math.min(2000, Math.max(0.01, num(e.currentTarget.value, 8))))} /> Hz
          depth <input class="input input-number" type="number" step="any" value={shown.random.depth} onchange={(e) => patchInner('random', 'depth', num(e.currentTarget.value, 0))} />
          <label class="field-inline"><input class="check" type="checkbox" checked={shown.random.smooth !== false} onchange={(e) => patchInner('random', 'smooth', e.currentTarget.checked)} /> smooth</label>
        </div>
      </div>
    {/if}
  {:else if doc.type === 'enum'}
    <div class="field-row">
      <span class="field-label" class:field-label-set={value !== undefined} title={doc.description}>{doc.name}</span>
      <select class="input" value={String(shown)} onchange={(e) => onchange(optionIsNumber ? Number(e.currentTarget.value) : e.currentTarget.value)} aria-label={doc.name}>
        {#each doc.options ?? [] as option (option)}<option value={option}>{option}</option>{/each}
      </select>
    </div>
  {:else if doc.type === 'boolean'}
    <label class="field-row">
      <span class="field-label" class:field-label-set={value !== undefined} title={doc.description}>{doc.name}</span>
      <input class="check" type="checkbox" checked={shown === true} onchange={(e) => onchange(e.currentTarget.checked)} />
    </label>
  {:else if doc.type === 'range'}
    {@const pair = (Array.isArray(shown) ? shown : [min, max]) as [number, number]}
    <div class="field-row">
      <span class="field-label" class:field-label-set={value !== undefined} title={doc.description}>{doc.name}</span>
      <input class="input input-number" type="number" {min} {max} step="any" value={pair[0]} onchange={(e) => onchange([Math.min(pair[1], Math.max(min, num(e.currentTarget.value, pair[0]))), pair[1]])} aria-label={`${doc.name} low`} />
      <span class="muted">to</span>
      <input class="input input-number" type="number" {min} {max} step="any" value={pair[1]} onchange={(e) => onchange([pair[0], Math.max(pair[0], Math.min(max, num(e.currentTarget.value, pair[1])))])} aria-label={`${doc.name} high`} />
      <span class="field-unit">{unit}</span>
    </div>
  {:else if doc.type === 'object' && doc.fields}
    <div class="field-row">
      <span class="field-label" class:field-label-set={value !== undefined} title={doc.description}>{doc.name}</span>
      {#if doc.options?.includes('false')}
        <input class="check" type="checkbox" checked={shown !== false} onchange={(e) => onchange(e.currentTarget.checked ? {} : false)} aria-label={`${doc.name} enabled`} />
      {/if}
    </div>
    {#if shown !== false}
      <div class="field-sub">
        {#each doc.fields as child (child.name)}
          <Field doc={child} value={asObject[child.name]} onchange={(v) => onchange({ ...asObject, [child.name]: v })} />
        {/each}
      </div>
    {/if}
  {:else if doc.type === 'string'}
    <div class="field-row">
      <span class="field-label" class:field-label-set={value !== undefined} title={doc.description}>{doc.name}</span>
      <input class="input" type="text" list={listId} value={typeof shown === 'string' ? shown : ''} onchange={(e) => onchange(e.currentTarget.value)} aria-label={doc.name} />
      <datalist id={listId}>{#each suggestions as s (s)}<option value={s}></option>{/each}</datalist>
    </div>
  {:else}
    <div class="field-row">
      <span class="field-label" class:field-label-set={value !== undefined} title={doc.description}>{doc.name}</span>
      <textarea
        class="input input-code"
        rows="3"
        placeholder="JSON (optional)"
        value={value === undefined ? '' : JSON.stringify(value)}
        onchange={(e) => {
          const raw = e.currentTarget.value.trim();
          if (!raw) return onchange(undefined);
          try {
            onchange(JSON.parse(raw));
          } catch {
            e.currentTarget.value = value === undefined ? '' : JSON.stringify(value);
          }
        }}
        aria-label={doc.name}
      ></textarea>
    </div>
  {/if}
</div>
