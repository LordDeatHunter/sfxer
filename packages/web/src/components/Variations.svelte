<script lang="ts">
  import './Variations.css';
  import { vary, type PatchInput } from '@sfxer/core';
  import { downloadWav, play } from '../lib/audio';
  import { engine } from '../lib/engine';
  import type { Rendered } from '../lib/protocol';
  import { app, setPatch, snapshot } from '../lib/state.svelte';

  interface Take {
    patch: PatchInput;
    result: Rendered;
  }

  let count = $state(6);
  let amount = $state(0.3);
  let takes = $state.raw<Take[]>([]);
  let working = $state(false);
  let problem = $state('');

  async function generate(): Promise<void> {
    working = true;
    problem = '';
    takes = [];
    try {
      const patches = vary(snapshot(app.patch), { count, amount, seed: Math.floor(Math.random() * 1_000_000) });
      for (const patch of patches) {
        const outcome = await engine.call('render', { patch, assets: snapshot(app.assets) });
        if (outcome.ok) takes = [...takes, { patch, result: outcome.value }];
      }
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    } finally {
      working = false;
    }
  }

  /** Svelte action: draw a min/max waveform into a canvas. */
  function waveform(canvas: HTMLCanvasElement, samples: Float32Array): void {
    const w = (canvas.width = 480);
    const h = (canvas.height = 96);
    const g = canvas.getContext('2d');
    if (!g) return;
    g.fillStyle = '#6ec8eb';
    let peak = 1e-6;
    for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]!));
    for (let x = 0; x < w; x++) {
      const a = Math.floor((x * samples.length) / w);
      const b = Math.max(a + 1, Math.floor(((x + 1) * samples.length) / w));
      let lo = 0;
      let hi = 0;
      for (let i = a; i < b; i++) {
        const v = samples[i] ?? 0;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      const y0 = h / 2 - (hi / peak) * (h / 2 - 2);
      const y1 = h / 2 - (lo / peak) * (h / 2 - 2);
      g.fillRect(x, y0, 1, Math.max(1, y1 - y0));
    }
  }

  function use(take: Take): void {
    setPatch(structuredClone(take.patch));
    app.view = 'editor';
  }

  function downloadAll(): void {
    takes.forEach((take, i) => setTimeout(() => downloadWav(take.patch.name ?? `take${i + 1}`, take.result.channels, take.result.sampleRate), i * 250));
  }
</script>

<div class="panel">
  <div class="panel-head"><span class="panel-title">Variations of {app.patch.name ?? 'untitled'}</span></div>
  <div class="panel-body">
    <span class="muted">Several takes of the current sound, so repeated footsteps or hits never sound identical.</span>
    <div class="vary-controls">
      <label class="vary-control">takes <input class="slider" type="range" min="2" max="12" step="1" bind:value={count} /> {count}</label>
      <label class="vary-control">difference <input class="slider" type="range" min="0" max="1" step="0.05" bind:value={amount} /> {amount.toFixed(2)}</label>
      <button class="btn btn-primary" onclick={() => void generate()} disabled={working}>{working ? 'Rendering...' : 'Generate'}</button>
      <button class="btn" onclick={downloadAll} disabled={!takes.length}>Download all</button>
    </div>
    {#if problem}<div class="note-bad">{problem}</div>{/if}
  </div>
</div>

<div class="vary-grid">
  {#each takes as take, i (take.patch.name ?? i)}
    <div class="panel vary-card">
      <canvas class="vary-wave" {@attach (node) => waveform(node, take.result.channels[0])}></canvas>
      <span class="vary-meta">
        take {i + 1} &middot; {take.result.durationMs} ms &middot; centroid {take.result.report.spectrum.centroid_hz} Hz
      </span>
      <div class="vary-actions">
        <button class="btn btn-small btn-primary" onclick={() => play(take.result.channels, take.result.sampleRate)}>Play</button>
        <button class="btn btn-small" onclick={() => use(take)}>Edit this one</button>
        <button class="btn btn-small" onclick={() => downloadWav(take.patch.name ?? `take${i + 1}`, take.result.channels, take.result.sampleRate)}>WAV</button>
      </div>
    </div>
  {/each}
</div>
