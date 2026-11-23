<script lang="ts">
  import './Library.css';
  import { describeNode, expandRecipe, RECIPES } from '@sfxer/core';
  import { app, playResult, setPatch } from '../lib/state.svelte';
  import Field from './Field.svelte';

  const names = Object.keys(RECIPES);
  let selected = $state(names[0] ?? 'impact');
  let seed = $state(1);
  /** Parameters the user has changed, per recipe; everything else stays at its default. */
  let chosen = $state<Record<string, Record<string, unknown>>>({});

  const doc = $derived(describeNode(selected)!);
  const params = $derived(chosen[selected] ?? {});

  function build(): void {
    try {
      setPatch(expandRecipe(selected, $state.snapshot(params) as Record<string, unknown>, seed));
    } catch (e) {
      app.error = e instanceof Error ? e.message : String(e);
    }
  }

  function pick(name: string): void {
    selected = name;
    build();
  }

  function change(name: string, value: unknown): void {
    chosen[selected] = { ...params, [name]: value };
    build();
  }

  function another(): void {
    seed = Math.floor(Math.random() * 1_000_000);
    build();
  }

  function reset(): void {
    chosen[selected] = {};
    seed = 1;
    build();
  }
</script>

<div class="library">
  <div class="panel">
    <div class="panel-head"><span class="panel-title">Recipes</span></div>
    <div class="library-list">
      {#each names as name (name)}
        <button class="library-item" class:library-item-active={name === selected} onclick={() => pick(name)}>{name.replace('_', ' ')}</button>
      {/each}
    </div>
  </div>

  <div class="panel">
    <div class="panel-head">
      <span class="panel-title">{selected.replace('_', ' ')}</span>
      <span class="spacer"></span>
      <span class="library-seed">seed {seed}</span>
    </div>
    <div class="panel-body">
      <p class="library-desc">{doc.description}</p>
      {#each doc.fields as field (selected + field.name)}
        <Field doc={field} value={params[field.name]} onchange={(v) => change(field.name, v)} />
      {/each}
      <div class="library-actions">
        <button class="btn btn-primary" onclick={playResult}>Play</button>
        <button class="btn" onclick={another} title="Same settings, different random details">Another take</button>
        <button class="btn" onclick={reset}>Reset</button>
        <span class="spacer"></span>
        <button class="btn" onclick={() => (app.view = 'variations')}>Make variations</button>
        <button class="btn" onclick={() => (app.view = 'editor')}>Open in editor</button>
      </div>
      <p class="library-desc">A recipe is a starting point. Open it in the editor to change individual layers, envelopes and effects.</p>
    </div>
  </div>
</div>
