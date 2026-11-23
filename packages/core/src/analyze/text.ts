import type { RenderResult } from '../render.js';
import type { Comparison } from './compare.js';
import { BANDS, type Report } from './report.js';

/** Compact, readable version of a report: fewer tokens than the JSON, same facts. */
export function reportText(r: Report): string {
  const s = r.spectrum;
  const bands = BANDS.map(([name]) => `${name} ${s.bands_pct[name]}%`).join(', ');
  const lines = [
    `duration ${r.duration_ms} ms | peak ${r.level.peak_db} dBFS | loudness ${r.level.lufs} LUFS | crest ${r.level.crest_db} dB`,
    `shape: onset ${r.shape.onset_ms} ms, attack ${r.shape.attack_ms} ms, decay ${r.shape.decay_ms} ms`,
    `envelope dB (20 steps): ${r.shape.envelope_db.join(' ')}`,
    `brightness: centroid ${s.centroid_hz} Hz, rolloff ${s.rolloff_hz} Hz; over time: ${s.centroid_over_time_hz.join(' ')}`,
    `bands: ${bands}`,
    `character: noisiness ${s.noisiness}, tonality ${s.tonality}${s.dominant_hz ? `, dominant pitch ${s.dominant_hz} Hz` : ''}; peaks ${s.peaks.map((p) => `${p.hz}Hz(${p.db})`).join(' ')}`,
    `stereo: correlation ${r.stereo.correlation}, width ${r.stereo.width}`,
  ];
  if (r.warnings.length) lines.push('warnings:', ...r.warnings.map((w) => `  ! ${w}`));
  else lines.push('warnings: none');
  return lines.join('\n');
}

export function renderText(res: RenderResult): string {
  const lines = ['layers (level before master):'];
  for (const l of res.layers) {
    lines.push(`  ${l.id} [${l.source}] ${l.start_ms}-${l.end_ms} ms, peak ${l.peak_db} dB, rms ${l.rms_db} dB`);
  }
  if (res.normalizeGainDb) lines.push(`normalise gain: ${res.normalizeGainDb} dB`);
  for (const w of res.warnings) lines.push(`  ! ${w}`);
  return lines.join('\n');
}

export function compareText(c: Comparison): string {
  return [
    `similarity ${c.similarity}/100 (spectral distance ${c.spectral_distance_db} dB)`,
    ...c.summary.map((s) => `  - ${s}`),
    `A: ${c.a.duration_ms} ms, ${c.a.level.lufs} LUFS, centroid ${c.a.spectrum.centroid_hz} Hz, attack ${c.a.shape.attack_ms} ms, decay ${c.a.shape.decay_ms} ms`,
    `B: ${c.b.duration_ms} ms, ${c.b.level.lufs} LUFS, centroid ${c.b.spectrum.centroid_hz} Hz, attack ${c.b.shape.attack_ms} ms, decay ${c.b.shape.decay_ms} ms`,
    `band change (B - A, points): ${Object.entries(c.delta.bands_pct).map(([k, v]) => `${k} ${v > 0 ? '+' : ''}${v}`).join(', ')}`,
  ].join('\n');
}
