<script lang="ts">
  import './Editor.css';
  import { describeNode, type PatchInput } from '@sfxer/core';
  import { decodeFile } from '../lib/audio';
  import { newLayer, newSource, sourceTypes } from '../lib/nodes';
  import { app, reseed, setPatch, snapshot, touch } from '../lib/state.svelte';
  import Field from './Field.svelte';
  import FxList from './FxList.svelte';

  type Dict = Record<string, unknown>;

  const layerDoc = describeNode('layer')!;
  const masterDoc = describeNode('master')!;
  const layerFields = layerDoc.fields.filter((f) => f.name !== 'id' && f.name !== 'mute');

  // The editor treats nodes as plain dictionaries; the engine validates on every render.
  const layers = $derived(app.patch.layers as unknown as Dict[]);
  // setPatch() guarantees that master, master.fx and every layer.fx exist.
  const master = $derived((app.patch.master ?? {}) as unknown as Dict);
  const masterFx = $derived((master.fx ?? []) as Dict[]);
  const assetNames = $derived(Object.keys(app.assets));

  let open = $state<Record<number, boolean>>({ 0: true });
  let adding = $state('');
  let jsonError = $state('');
  const json = $derived(JSON.stringify(app.patch, null, 2));

  function set(target: Dict, key: string, value: unknown): void {
    if (value === undefined) delete target[key];
    else target[key] = value;
    touch();
  }

  function addLayer(): void {
    if (!adding) return;
    layers.push(newLayer(adding, layers.length) as unknown as Dict);
    open[layers.length - 1] = true;
    adding = '';
    touch();
  }

  function changeSource(layer: Dict, type: string): void {
    layer.source = newSource(type);
    touch();
  }

  function solo(index: number): void {
    app.solo = app.solo === index ? -1 : index;
    touch();
  }

  function editJson(text: string): void {
    try {
      const parsed = JSON.parse(text) as PatchInput;
      jsonError = '';
      setPatch(parsed);
    } catch (e) {
      jsonError = e instanceof Error ? e.message : String(e);
    }
  }

  async function loadAssets(files: FileList | null): Promise<void> {
    for (const file of files ?? []) {
      try {
        const audio = await decodeFile(file);
        app.assets[file.name] = { sr: audio.sampleRate, channels: audio.channels };
      } catch {
        app.error = `Could not decode ${file.name}.`;
      }
    }
    touch();
  }
</script>

<div class="panel">
  <div class="panel-head"><span class="panel-title">Patch</span></div>
  <div class="panel-body">
    <div class="editor-top">
      <label class="editor-cell">
        <span class="editor-cell-label">name</span>
        <input class="input" type="text" value={app.patch.name ?? ''} onchange={(e) => (app.patch.name = e.currentTarget.value)} />
      </label>
      <div class="editor-cell">
        <span class="editor-cell-label">seed</span>
        <input class="input" type="number" min="0" value={app.patch.seed ?? 1} onchange={(e) => set(app.patch as unknown as Dict, 'seed', Math.max(0, Math.round(Number(e.currentTarget.value) || 0)))} aria-label="Seed" />
        <button class="btn btn-small" onclick={reseed} title="New random seed">shuffle</button>
      </div>
      <div class="editor-cell">
        <span class="editor-cell-label">length</span>
        {#if typeof app.patch.duration === 'number'}
          <input class="input" type="number" min="10" max="60000" value={app.patch.duration} onchange={(e) => set(app.patch as unknown as Dict, 'duration', Math.min(60000, Math.max(10, Number(e.currentTarget.value) || 1000)))} aria-label="Duration in ms" />
          <button class="btn btn-small" onclick={() => set(app.patch as unknown as Dict, 'duration', 'auto')}>auto</button>
        {:else}
          <span class="muted">auto (fits the layers)</span>
          <button class="btn btn-small" onclick={() => set(app.patch as unknown as Dict, 'duration', Math.round(app.result?.durationMs ?? 1000))}>fix</button>
        {/if}
      </div>
    </div>
  </div>
</div>

<div class="editor-columns">
  {#each layers as layer, i (i)}
    {@const source = layer.source as Dict}
    {@const sourceDoc = describeNode(String(source.type))}
    <div class="panel layer" class:layer-muted={layer.mute === true}>
      <div class="panel-head">
        <button class="btn btn-quiet btn-small" onclick={() => (open[i] = !open[i])} aria-label="Expand or collapse">{open[i] ? '▾' : '▸'}</button>
        <input class="input layer-id" type="text" value={layer.id ?? `layer${i}`} onchange={(e) => set(layer, 'id', e.currentTarget.value || undefined)} aria-label="Layer name" />
        <select class="input layer-type" value={source.type} onchange={(e) => changeSource(layer, e.currentTarget.value)} aria-label="Source type" title={sourceDoc?.description}>
          {#each sourceTypes as type (type)}<option value={type}>{type}</option>{/each}
        </select>
        <span class="spacer"></span>
        <button class="btn btn-small" class:btn-on={app.solo === i} onclick={() => solo(i)} title="Hear only this layer">solo</button>
        <button class="btn btn-small" class:btn-on={layer.mute === true} onclick={() => set(layer, 'mute', layer.mute === true ? undefined : true)}>mute</button>
        <button
          class="btn btn-small btn-danger"
          disabled={layers.length <= 1}
          onclick={() => {
            layers.splice(i, 1);
            app.solo = -1;
            touch();
          }}
          aria-label="Delete layer">&times;</button
        >
      </div>
      {#if open[i]}
        <div class="panel-body">
          <span class="muted">{sourceDoc?.description}</span>
          {#each layerFields as field (field.name)}
            <Field doc={field} value={layer[field.name]} onchange={(v) => set(layer, field.name, v)} />
          {/each}
          <span class="editor-section">Source: {source.type}</span>
          {#each sourceDoc?.fields ?? [] as field (field.name)}
            <Field doc={field} value={source[field.name]} onchange={(v) => set(source, field.name, v)} suggestions={assetNames} />
          {/each}
          <span class="editor-section">Effects</span>
          <FxList list={(layer.fx ?? []) as Dict[]} onchange={touch} />
        </div>
      {/if}
    </div>
  {/each}
</div>

<div class="panel">
  <div class="panel-body">
    <select class="input" bind:value={adding} onchange={addLayer} aria-label="Add layer">
      <option value="">+ add layer...</option>
      {#each sourceTypes as type (type)}<option value={type}>{type} — {describeNode(type)?.description}</option>{/each}
    </select>
  </div>
</div>

<div class="editor-columns">
  <div class="panel">
    <div class="panel-head"><span class="panel-title">Master</span></div>
    <div class="panel-body">
      <span class="muted">{masterDoc.description}</span>
      <FxList list={masterFx} onchange={touch} />
      {#each masterDoc.fields as field (field.name)}
        <Field doc={field} value={master[field.name]} onchange={(v) => set(master, field.name, v)} />
      {/each}
    </div>
  </div>

  <div class="panel">
    <div class="panel-head"><span class="panel-title">Sample files</span></div>
    <div class="panel-body">
      <span class="muted">Audio files for `sample` and `granular` layers. Refer to them by file name.</span>
      <input class="input" type="file" accept="audio/*" multiple onchange={(e) => void loadAssets(e.currentTarget.files)} />
      <div class="editor-assets">
        {#each assetNames as name (name)}<span class="editor-asset">{name}</span>{:else}<span class="muted">None loaded.</span>{/each}
      </div>
    </div>
  </div>
</div>

<div class="panel">
  <div class="panel-head">
    <span class="panel-title">Patch JSON</span>
    <span class="spacer"></span>
    <button class="btn btn-small" onclick={() => void navigator.clipboard.writeText(JSON.stringify(snapshot(app.patch), null, 2))}>copy</button>
  </div>
  <div class="panel-body">
    <span class="muted">The same file an agent reads and writes. Edits here apply when you leave the box.</span>
    <textarea class="input input-code editor-json" spellcheck="false" value={json} onchange={(e) => editJson(e.currentTarget.value)} aria-label="Patch JSON"></textarea>
    {#if jsonError}<div class="note-bad">Not valid JSON: {jsonError}</div>{/if}
  </div>
</div>
