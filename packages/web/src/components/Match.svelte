<script lang="ts">
  import './Match.css';
  import type { MatchResult } from '@sfxer/core';
  import { decodeFile, downloadJson, play } from '../lib/audio';
  import { engine } from '../lib/engine';
  import type { Analysed, Rendered } from '../lib/protocol';
  import { app, setPatch } from '../lib/state.svelte';
  import Viz from './Viz.svelte';

  interface Original {
    name: string;
    sampleRate: number;
    channels: Float32Array[];
    analysis: Analysed;
  }

  let original = $state.raw<Original | undefined>();
  let matched = $state.raw<{ result: MatchResult; rendered: Rendered } | undefined>();
  let fraction = $state(0);
  let stage = $state('');
  let working = $state(false);
  let problem = $state('');
  let over = $state(false);
  let picker: HTMLInputElement | undefined = $state();

  async function run(file: File | undefined): Promise<void> {
    if (!file || working) return;
    working = true;
    problem = '';
    original = undefined;
    matched = undefined;
    fraction = 0;
    stage = 'decoding';
    try {
      const audio = await decodeFile(file);
      const analysis = await engine.call('analyse', { channels: audio.channels, sampleRate: audio.sampleRate });
      original = { name: file.name, ...audio, analysis };
      const result = await engine.call('match', { channels: audio.channels, sampleRate: audio.sampleRate }, (f, s) => {
        fraction = f;
        stage = s;
      });
      result.patch.name = `${file.name.replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '_')}_match`;
      const outcome = await engine.call('render', { patch: result.patch, assets: {} });
      if (!outcome.ok) throw new Error(outcome.issues.map((i) => `${i.path}: ${i.message}`).join('; '));
      matched = { result, rendered: outcome.value };
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    } finally {
      working = false;
    }
  }

  function openInEditor(): void {
    if (!matched) return;
    setPatch(structuredClone(matched.result.patch), false);
    app.view = 'editor';
  }
</script>

<div class="panel">
  <div class="panel-head"><span class="panel-title">Match an existing sound</span></div>
  <div class="panel-body">
    <span class="muted">
      Drop in a sound effect and get an editable patch that approximates it. This is measurement, not AI: the same file always gives the same patch. It works best on
      impacts, knocks, bells, blips, whooshes and noisy bursts, and is rough on voices, animals, water and dense recordings.
    </span>
    <button
      class="match-drop"
      class:match-drop-over={over}
      onclick={() => picker?.click()}
      ondragover={(e) => {
        e.preventDefault();
        over = true;
      }}
      ondragleave={() => (over = false)}
      ondrop={(e) => {
        e.preventDefault();
        over = false;
        void run(e.dataTransfer?.files[0]);
      }}
    >
      <span>Drop an audio file here, or click to choose one</span>
      <span class="muted">WAV, MP3, OGG, FLAC. Up to the first 15 seconds are used.</span>
    </button>
    <input class="match-file" type="file" accept="audio/*" bind:this={picker} onchange={(e) => void run(e.currentTarget.files?.[0])} />
    {#if working}
      <div class="match-progress"><div class="match-progress-bar" style:width={`${Math.round(fraction * 100)}%`}></div></div>
      <span class="muted">{stage}...</span>
    {/if}
    {#if problem}<div class="note-bad">{problem}</div>{/if}
  </div>
</div>

{#if original}
  <div class="match-pair">
    <div class="match-side">
      <Viz picture={original.analysis.picture} label={original.name} />
      <div><button class="btn btn-primary" onclick={() => original && play(original.channels, original.sampleRate)}>Play original</button></div>
    </div>
    <div class="match-side">
      <Viz picture={matched?.rendered.picture} label="approximation" />
      <div>
        <button class="btn btn-primary" disabled={!matched} onclick={() => matched && play(matched.rendered.channels, matched.rendered.sampleRate)}>Play approximation</button>
      </div>
    </div>
  </div>
{/if}

{#if matched}
  <div class="panel">
    <div class="panel-head"><span class="panel-title">Result</span></div>
    <div class="panel-body">
      <div class="match-score-row">
        <span class="match-score">{matched.result.similarity}<span class="muted">/100</span></span>
        <span class="muted">similarity (spectral distance {matched.result.spectral_distance_db} dB), {matched.result.patch.layers.length} layers</span>
        <span class="spacer"></span>
        <button class="btn" onclick={() => matched && downloadJson(matched.result.patch.name ?? 'match', matched.result.patch)}>Patch JSON</button>
        <button class="btn btn-primary" onclick={openInEditor}>Open in editor</button>
      </div>
      <ul class="match-notes">
        {#each matched.result.notes as note (note)}<li>{note}</li>{/each}
      </ul>
    </div>
  </div>
{/if}
