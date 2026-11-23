<script lang="ts">
  import './App.css';
  import Editor from './components/Editor.svelte';
  import Library from './components/Library.svelte';
  import Match from './components/Match.svelte';
  import ReportPanel from './components/ReportPanel.svelte';
  import Variations from './components/Variations.svelte';
  import Viz from './components/Viz.svelte';
  import { downloadJson, downloadWav, stop } from './lib/audio';
  import { app, playResult, setPatch, snapshot, type View } from './lib/state.svelte';

  const tabs: { id: View; label: string }[] = [
    { id: 'library', label: 'Library' },
    { id: 'editor', label: 'Editor' },
    { id: 'variations', label: 'Variations' },
    { id: 'match', label: 'Match' },
  ];

  const fileName = $derived((app.patch.name ?? 'untitled').replace(/[^\w-]+/g, '_'));

  function onKey(event: KeyboardEvent): void {
    const el = event.target as HTMLElement | null;
    if (event.code !== 'Space' || (el && /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(el.tagName))) return;
    event.preventDefault();
    playResult();
  }

  // First render on load, without sound: browsers block audio before a user gesture.
  setPatch(snapshot(app.patch), false);
</script>

<svelte:window onkeydown={onKey} />

<div class="app">
  <header class="app-bar">
    <span class="app-logo">sfx<span class="app-logo-accent">er</span></span>
    <nav class="app-tabs">
      {#each tabs as tab (tab.id)}
        <button class="app-tab" class:app-tab-active={app.view === tab.id} onclick={() => (app.view = tab.id)}>{tab.label}</button>
      {/each}
    </nav>
    <span class="spacer"></span>
    <span class={app.busy ? 'app-busy' : 'app-idle'} title={app.busy ? 'Rendering' : 'Idle'}></span>
    <label class="app-toggle"><input class="check" type="checkbox" bind:checked={app.autoplay} /> play on change</label>
    <button class="btn btn-primary" onclick={playResult} disabled={!app.result} title="Space">Play</button>
    <button class="btn" onclick={stop}>Stop</button>
    <button class="btn" disabled={!app.result} onclick={() => app.result && downloadWav(fileName, app.result.channels, app.result.sampleRate)}>WAV</button>
    <button class="btn" onclick={() => downloadJson(fileName, snapshot(app.patch))}>Patch JSON</button>
  </header>

  <main class="app-main" class:app-main-wide={app.view === 'match'}>
    <section class="app-view">
      {#if app.view === 'library'}
        <Library />
      {:else if app.view === 'editor'}
        <Editor />
      {:else if app.view === 'variations'}
        <Variations />
      {:else}
        <Match />
      {/if}
    </section>
    {#if app.view !== 'match'}
      <aside class="app-side">
        <Viz picture={app.result?.picture} label={app.patch.name ?? 'untitled'} />
        <ReportPanel />
      </aside>
    {/if}
  </main>
</div>
