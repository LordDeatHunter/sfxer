<script lang="ts">
  import './App.css';
  import Editor from './components/Editor.svelte';
  import Library from './components/Library.svelte';
  import Match from './components/Match.svelte';
  import ReportPanel from './components/ReportPanel.svelte';
  import Variations from './components/Variations.svelte';
  import Viz from './components/Viz.svelte';
  import { downloadJson, downloadWav, isPlaying, pause, progress, resume, seek, setLooping, stop } from './lib/audio';
  import { app, setPatch, snapshot, togglePlay, type View } from './lib/state.svelte';
  import { setTheme, theme, type ThemeChoice } from './lib/theme.svelte';
  import { playToggle, preloadUiSounds } from './lib/uisound';

  const tabs: { id: View; label: string }[] = [
    { id: 'library', label: 'Library' },
    { id: 'editor', label: 'Editor' },
    { id: 'variations', label: 'Variations' },
    { id: 'match', label: 'Match' },
  ];

  const themes: { id: ThemeChoice; label: string }[] = [
    { id: 'light', label: 'Light' },
    { id: 'dark', label: 'Dark' },
    { id: 'system', label: 'System' },
  ];

  const fileName = $derived((app.patch.name ?? 'untitled').replace(/[^\w-]+/g, '_'));

  // Playback state for the dock, polled once per frame.
  let position: number | undefined = $state();
  let playing = $state(false);
  $effect(() => {
    let frame = requestAnimationFrame(function tick() {
      position = progress();
      playing = isPlaying() || resumeAfterDrag;
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  });

  // Click or drag the bar to seek. Playback pauses while dragging and continues on release.
  let resumeAfterDrag = false;
  const fractionAt = (event: PointerEvent): number => {
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    return (event.clientX - box.left) / box.width;
  };
  function dragStart(event: PointerEvent): void {
    if (!app.result || progress() === undefined) return;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    resumeAfterDrag = isPlaying();
    pause();
    seek(fractionAt(event));
  }
  function dragMove(event: PointerEvent): void {
    if ((event.currentTarget as HTMLElement).hasPointerCapture(event.pointerId)) seek(fractionAt(event));
  }
  function dragEnd(): void {
    if (resumeAfterDrag) resume();
    resumeAfterDrag = false;
  }

  function onKey(event: KeyboardEvent): void {
    const el = event.target as HTMLElement | null;
    if (event.code !== 'Space' || (el && /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(el.tagName))) return;
    event.preventDefault();
    togglePlay();
  }

  // Every checkbox toggle in the app clicks with a random sfxer-made toggle sound.
  function onChange(event: Event): void {
    const el = event.target;
    if (el instanceof HTMLInputElement && el.type === 'checkbox') playToggle();
  }

  // First render on load, without sound: browsers block audio before a user gesture.
  setPatch(snapshot(app.patch), false);
  preloadUiSounds();
</script>

<svelte:window onkeydown={onKey} onchange={onChange} />

<div class="app">
  <header class="app-bar">
    <span class="app-logo">sfx<span class="app-logo-accent">er</span></span>
    <nav class="app-tabs">
      {#each tabs as tab (tab.id)}
        <button class="app-tab" class:app-tab-active={app.view === tab.id} onclick={() => (app.view = tab.id)}>{tab.label}</button>
      {/each}
    </nav>
    <span class="spacer"></span>
    <div class="theme-switch" role="radiogroup" aria-label="Theme">
      {#each themes as t (t.id)}
        <button class="theme-option" class:theme-option-active={theme.choice === t.id} role="radio" aria-checked={theme.choice === t.id} onclick={() => setTheme(t.id)}>{t.label}</button>
      {/each}
    </div>
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

  <footer class="dock">
    <div class="dock-controls">
      <span class={app.busy ? 'app-busy' : 'app-idle'} title={app.busy ? 'Rendering' : 'Idle'}></span>
      <label class="app-toggle"><input class="check" type="checkbox" bind:checked={app.autoplay} /> play on change</label>
      <label class="app-toggle"><input class="check" type="checkbox" bind:checked={app.loop} onchange={() => setLooping(app.loop)} /> loop</label>
      <button class="btn btn-primary dock-play" onclick={togglePlay} disabled={!app.result} title="Space">{playing ? 'Pause' : 'Play'}</button>
      <button class="btn" onclick={stop}>Stop</button>
      <button class="btn" disabled={!app.result} onclick={() => app.result && downloadWav(fileName, app.result.channels, app.result.sampleRate)}>WAV</button>
      <button class="btn" onclick={() => downloadJson(fileName, snapshot(app.patch))}>Patch JSON</button>
    </div>
    <div
      class="dock-seek"
      class:dock-seek-off={position === undefined}
      role="slider"
      tabindex="-1"
      aria-label="Playback position"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round((position ?? 0) * 100)}
      onpointerdown={dragStart}
      onpointermove={dragMove}
      onpointerup={dragEnd}
      onpointercancel={dragEnd}
    >
      <div class="dock-track">
        <div class="dock-fill" style:width={`${(position ?? 0) * 100}%`}></div>
      </div>
      <div class="dock-thumb" style:left={`${(position ?? 0) * 100}%`}></div>
    </div>
  </footer>
</div>
