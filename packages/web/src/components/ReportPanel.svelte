<script lang="ts">
  import './ReportPanel.css';
  import { BANDS } from '@sfxer/core';
  import { app } from '../lib/state.svelte';

  const report = $derived(app.result?.report);
  const tallest = $derived(report ? Math.max(1, ...BANDS.map(([name]) => report.spectrum.bands_pct[name])) : 1);
</script>

<div class="panel">
  <div class="panel-head"><span class="panel-title">Report</span></div>
  <div class="panel-body">
    {#if app.error}
      <div class="note-bad">{app.error}</div>
    {/if}
    {#each app.issues as issue (issue.path + issue.message)}
      <div class="note-bad"><span class="path">{issue.path || 'patch'}</span>: {issue.message}</div>
    {/each}

    {#if report && app.result}
      <div class="report-stats">
        <div class="report-stat"><span class="report-stat-value">{report.duration_ms} ms</span><span class="report-stat-label">duration</span></div>
        <div class="report-stat"><span class="report-stat-value">{report.level.lufs}</span><span class="report-stat-label">loudness, LUFS</span></div>
        <div class="report-stat"><span class="report-stat-value">{report.level.peak_db}</span><span class="report-stat-label">peak, dBFS</span></div>
        <div class="report-stat"><span class="report-stat-value">{report.shape.attack_ms} ms</span><span class="report-stat-label">attack</span></div>
        <div class="report-stat"><span class="report-stat-value">{report.shape.decay_ms} ms</span><span class="report-stat-label">decay</span></div>
        <div class="report-stat"><span class="report-stat-value">{report.spectrum.centroid_hz} Hz</span><span class="report-stat-label">brightness (centroid)</span></div>
        <div class="report-stat"><span class="report-stat-value">{report.spectrum.noisiness}</span><span class="report-stat-label">noisiness, 0-1</span></div>
        <div class="report-stat"><span class="report-stat-value">{report.level.crest_db} dB</span><span class="report-stat-label">crest (punch)</span></div>
        <div class="report-stat"><span class="report-stat-value">{report.stereo.width}</span><span class="report-stat-label">stereo width</span></div>
      </div>

      <span class="report-section">Energy by band</span>
      <div class="report-bands">
        {#each BANDS as [name, low, high] (name)}
          <div class="report-band" title={`${name}: ${low}-${high} Hz, ${report.spectrum.bands_pct[name]}%`}>
            <div class="report-band-bar" style:height={`${(report.spectrum.bands_pct[name] / tallest) * 100}%`}></div>
            <span class="report-band-label">{name.replace('_', ' ')}</span>
          </div>
        {/each}
      </div>

      {#each [...app.result.warnings, ...report.warnings] as warning (warning)}
        <div class="note-warn">{warning}</div>
      {:else}
        <div class="note-good">No warnings.</div>
      {/each}

      <span class="report-section">Layers before the master chain</span>
      <table class="report-layers">
        <thead>
          <tr>
            <th class="report-layers-head">layer</th>
            <th class="report-layers-head">source</th>
            <th class="report-layers-head">ms</th>
            <th class="report-layers-head">peak dB</th>
            <th class="report-layers-head">rms dB</th>
          </tr>
        </thead>
        <tbody>
          {#each app.result.layers as layer (layer.id + layer.start_ms)}
            <tr>
              <td class="report-layers-cell">{layer.id}</td>
              <td class="report-layers-cell">{layer.source}</td>
              <td class="report-layers-cell">{Math.round(layer.start_ms)}-{Math.round(layer.end_ms)}</td>
              <td class="report-layers-cell">{layer.peak_db}</td>
              <td class="report-layers-cell">{layer.rms_db}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {:else if !app.issues.length && !app.error}
      <span class="muted">Rendering...</span>
    {/if}
  </div>
</div>
