import { stft } from '../dsp/fft.js';
import { gainToDb, peakOf, round } from '../util.js';
import { integratedLufs } from './loudness.js';

export const BANDS = [
  ['sub', 20, 60],
  ['bass', 60, 250],
  ['low_mid', 250, 500],
  ['mid', 500, 2000],
  ['high_mid', 2000, 4000],
  ['presence', 4000, 6000],
  ['brilliance', 6000, 12000],
  ['air', 12000, 20000],
] as const;
export type BandName = (typeof BANDS)[number][0];

export interface Report {
  duration_ms: number;
  sample_rate: number;
  channels: number;
  level: {
    peak_db: number;
    rms_db: number;
    lufs: number;
    /** Peak minus RMS. High = punchy and dynamic, low = dense or squashed. */
    crest_db: number;
    clipped: boolean;
    dc_offset: number;
  };
  shape: {
    /** Silence before the sound starts. */
    onset_ms: number;
    /** Time to rise from 10% to 90% of peak level. */
    attack_ms: number;
    /** Time from the loudest point until the level is 60 dB down (or the file ends). */
    decay_ms: number;
    /** Level in dB relative to peak at 20 evenly spaced points. */
    envelope_db: number[];
  };
  spectrum: {
    /** Brightness: the centre of mass of the spectrum. */
    centroid_hz: number;
    /** Centroid in 8 consecutive time slices; shows whether the tone moves. */
    centroid_over_time_hz: number[];
    /** Frequency below which 85% of the energy lies. */
    rolloff_hz: number;
    /** Percentage of energy per band. */
    bands_pct: Record<BandName, number>;
    /** 0 = pure tones, 1 = noise. */
    noisiness: number;
    /** Share of energy in the five strongest spectral peaks. */
    tonality: number;
    /** Strongest pitch when the sound is clearly tonal. */
    dominant_hz: number | null;
    peaks: { hz: number; db: number }[];
  };
  stereo: {
    /** 1 = mono, 0 = unrelated channels, negative = phase problems. */
    correlation: number;
    /** Side energy relative to mid energy, 0 = mono. */
    width: number;
  };
  warnings: string[];
}

function envelope(x: Float32Array, win: number): Float32Array {
  const n = Math.max(1, Math.ceil(x.length / win));
  const env = new Float32Array(n);
  for (let w = 0; w < n; w++) {
    let p = 0;
    const end = Math.min(x.length, (w + 1) * win);
    for (let i = w * win; i < end; i++) {
      const a = Math.abs(x[i]!);
      if (a > p) p = a;
    }
    env[w] = p;
  }
  return env;
}

export interface AnalyzeOptions {
  /** The sound is a seamless loop: skip warnings about its start, end and constant level. */
  loop?: boolean;
}

export function analyze(channels: Float32Array[], sr: number, options: AnalyzeOptions = {}): Report {
  const warnings: string[] = [];
  const n = channels[0]?.length ?? 0;
  const L = channels[0] ?? new Float32Array(0);
  const R = channels[1] ?? L;
  const mono = new Float32Array(n);
  for (let i = 0; i < n; i++) mono[i] = 0.5 * (L[i]! + R[i]!);
  const duration_ms = (n / sr) * 1000;

  // ---- level
  const peak = Math.max(peakOf(L), peakOf(R));
  let sq = 0;
  let dc = 0;
  let clipRun = 0;
  let clipped = false;
  for (let i = 0; i < n; i++) {
    sq += 0.5 * (L[i]! * L[i]! + R[i]! * R[i]!);
    dc += mono[i]!;
    if (Math.abs(L[i]!) >= 0.999 || Math.abs(R[i]!) >= 0.999) {
      if (++clipRun >= 3) clipped = true;
    } else clipRun = 0;
  }
  const rms = n ? Math.sqrt(sq / n) : 0;
  dc = n ? dc / n : 0;
  const lufs = integratedLufs(channels.slice(0, 2), sr);

  // ---- shape
  const win = Math.max(1, Math.round(sr * 0.002));
  const env = envelope(mono.map((v, i) => Math.max(Math.abs(L[i]!), Math.abs(R[i]!))), win);
  let peakIdx = 0;
  let envPeak = 0;
  for (let i = 0; i < env.length; i++) if (env[i]! > envPeak) { envPeak = env[i]!; peakIdx = i; }
  const first = (level: number) => {
    for (let i = 0; i < env.length; i++) if (env[i]! >= level) return i;
    return 0;
  };
  const onsetIdx = first(envPeak * 0.02);
  const attack_ms = Math.max(0, (first(envPeak * 0.9) - first(envPeak * 0.1)) * 2);
  let lastLoud = peakIdx;
  for (let i = env.length - 1; i > peakIdx; i--) if (env[i]! > envPeak * 0.001) { lastLoud = i; break; }
  const decay_ms = (lastLoud - peakIdx) * 2;
  const envelope_db: number[] = [];
  for (let k = 0; k < 20; k++) {
    const a = Math.floor((k * env.length) / 20);
    const b = Math.max(a + 1, Math.floor(((k + 1) * env.length) / 20));
    let p = 0;
    for (let i = a; i < b && i < env.length; i++) if (env[i]! > p) p = env[i]!;
    envelope_db.push(Math.max(-90, Math.round(gainToDb(envPeak > 0 ? p / envPeak : 0))));
  }

  // ---- spectrum
  const size = 2048;
  const S = stft(mono, sr, size, 512);
  const bins = (size >> 1) + 1;
  const hzPerBin = sr / size;
  const power = new Float64Array(bins);
  const sliceCentroid = (from: number, to: number): number => {
    let num = 0;
    let den = 0;
    for (let f = from; f < to; f++) {
      const fr = S.frames[f]!;
      for (let k = 1; k < bins; k++) {
        const p = fr[k]! * fr[k]!;
        num += p * k * hzPerBin;
        den += p;
      }
    }
    return den > 0 ? num / den : 0;
  };
  for (const fr of S.frames) for (let k = 0; k < bins; k++) power[k] = power[k]! + fr[k]! * fr[k]!;
  let total = 0;
  let cnum = 0;
  for (let k = 1; k < bins; k++) {
    total += power[k]!;
    cnum += power[k]! * k * hzPerBin;
  }
  const centroid_hz = total > 0 ? cnum / total : 0;
  let acc = 0;
  let rolloff_hz = 0;
  for (let k = 1; k < bins; k++) {
    acc += power[k]!;
    if (acc >= 0.85 * total) { rolloff_hz = k * hzPerBin; break; }
  }
  const bands_pct = {} as Record<BandName, number>;
  for (const [name, lo, hi] of BANDS) {
    let e = 0;
    for (let k = Math.max(1, Math.ceil(lo / hzPerBin)); k < bins && k * hzPerBin < hi; k++) e += power[k]!;
    bands_pct[name] = total > 0 ? round((100 * e) / total, 1) : 0;
  }
  const frames = S.frames.length;
  const centroid_over_time_hz: number[] = [];
  for (let s = 0; s < 8; s++) {
    const a = Math.floor((s * frames) / 8);
    const b = Math.max(a + 1, Math.floor(((s + 1) * frames) / 8));
    centroid_over_time_hz.push(Math.round(sliceCentroid(a, Math.min(b, frames))));
  }
  // Spectral flatness between 100 Hz and 16 kHz.
  let logSum = 0;
  let linSum = 0;
  let count = 0;
  for (let k = Math.ceil(100 / hzPerBin); k * hzPerBin < 16000 && k < bins; k++) {
    logSum += Math.log(power[k]! + 1e-20);
    linSum += power[k]!;
    count++;
  }
  const noisiness = linSum > 0 ? Math.min(1, Math.exp(logSum / count) / (linSum / count)) : 0;

  // Strongest spectral peaks.
  const cand: { k: number; p: number }[] = [];
  for (let k = 2; k < bins - 2; k++) {
    const p = power[k]!;
    if (p > power[k - 1]! && p >= power[k + 1]! && p > power[k - 2]! && p > power[k + 2]!) cand.push({ k, p });
  }
  cand.sort((a, b) => b.p - a.p);
  const top = cand.slice(0, 5);
  let peakEnergy = 0;
  for (const c of top) for (let k = c.k - 2; k <= c.k + 2; k++) peakEnergy += power[k] ?? 0;
  const tonality = total > 0 ? Math.min(1, peakEnergy / total) : 0;
  const refine = (k: number): number => {
    const a = Math.log(power[k - 1]! + 1e-20);
    const b = Math.log(power[k]! + 1e-20);
    const c = Math.log(power[k + 1]! + 1e-20);
    const d = a - 2 * b + c;
    return (k + (d !== 0 ? (0.5 * (a - c)) / d : 0)) * hzPerBin;
  };
  const maxP = top[0]?.p ?? 1;
  const peaks = top.map((c) => ({ hz: Math.round(refine(c.k)), db: round(10 * Math.log10(c.p / maxP), 1) }));
  const dominant_hz = tonality > 0.35 && top[0] ? Math.round(refine(top[0].k)) : null;

  // ---- stereo
  let ll = 0, rr = 0, lr = 0, mm = 0, ss = 0;
  for (let i = 0; i < n; i++) {
    ll += L[i]! * L[i]!;
    rr += R[i]! * R[i]!;
    lr += L[i]! * R[i]!;
    const m = 0.5 * (L[i]! + R[i]!);
    const s = 0.5 * (L[i]! - R[i]!);
    mm += m * m;
    ss += s * s;
  }
  const correlation = ll > 0 && rr > 0 ? lr / Math.sqrt(ll * rr) : 1;
  const stereoWidth = mm > 0 ? Math.sqrt(ss / mm) : 0;

  // ---- plain-language warnings
  const crest = gainToDb(peak) - gainToDb(rms);
  const lowPct = bands_pct.sub + bands_pct.bass * ((120 - 60) / (250 - 60));
  const above4k = bands_pct.presence + bands_pct.brilliance + bands_pct.air;
  const above8k = bands_pct.brilliance * 0.6 + bands_pct.air;
  if (peak < 1e-4) warnings.push('The sound is silent.');
  else {
    if (clipped) warnings.push('Clipping: consecutive samples at full scale. Lower the level or add a limiter.');
    if (Math.abs(dc) > 0.02) warnings.push(`DC offset of ${round(dc, 3)}; add a highpass filter around 30 Hz.`);
    if (bands_pct.sub > 55 || lowPct > 70) warnings.push(`${Math.round(lowPct)}% of the energy is below 120 Hz; it will vanish on small speakers. Add a mid or high layer.`);
    if (above4k < 0.5 && duration_ms > 30) warnings.push('Almost no energy above 4 kHz; the sound will be dull and lack definition. Add a bright transient or noise layer.');
    if (above8k > 60) warnings.push(`${Math.round(above8k)}% of the energy is above 8 kHz; the sound will be thin or harsh. Add body below 1 kHz.`);
    let top1 = 0;
    if (top[0]) for (let k = top[0].k - 2; k <= top[0].k + 2; k++) top1 += power[k] ?? 0;
    if (total > 0 && top1 / total > 0.8 && duration_ms > 60) warnings.push(`${Math.round((100 * top1) / total)}% of the energy is one pure tone at ${dominant_hz} Hz; this is the classic synthetic/retro beep. Add a noise or modal layer, detune with unison, or filter and saturate.`);
    const lastDb = envelope_db[envelope_db.length - 1]!;
    if (!options.loop && lastDb > -30 && duration_ms > 50) warnings.push(`The sound ends abruptly (still ${lastDb} dB at the end). Extend the tail or fade out, unless it is a loop.`);
    if (!options.loop && n > 0 && Math.abs(mono[0]!) > 0.5 * peak) warnings.push('The first sample is already loud, which can click. Start envelopes at 0 or add a 1-2 ms attack.');
    if (onsetIdx * 2 > 40) warnings.push(`${onsetIdx * 2} ms of near-silence before the sound starts; it will feel late when triggered.`);
    if (crest < 5 && duration_ms > 100) warnings.push('Very low crest factor: the sound is flat and squashed. Ease off saturation/limiting or sharpen the transient.');
    if (correlation < -0.2) warnings.push('Left and right are out of phase; the sound will thin out or cancel in mono.');
    if (!options.loop && duration_ms > 400) {
      const body = envelope_db.slice(2, 17);
      const flat = Math.max(...body) - Math.min(...body) < 3;
      const cs = centroid_over_time_hz.slice(1, 7);
      const still = Math.max(...cs) / Math.max(1, Math.min(...cs)) < 1.15;
      if (flat && still) warnings.push('Level and tone stay constant for the whole sound. Unless this is a loop, give it shape: an amp envelope and a filter sweep.');
    }
  }

  return {
    duration_ms: round(duration_ms, 1),
    sample_rate: sr,
    channels: channels.length,
    level: {
      peak_db: round(gainToDb(peak), 2),
      rms_db: round(gainToDb(rms), 2),
      lufs: round(lufs, 2),
      crest_db: round(crest, 1),
      clipped,
      dc_offset: round(dc, 4),
    },
    shape: { onset_ms: onsetIdx * 2, attack_ms, decay_ms, envelope_db },
    spectrum: {
      centroid_hz: Math.round(centroid_hz),
      centroid_over_time_hz,
      rolloff_hz: Math.round(rolloff_hz),
      bands_pct,
      noisiness: round(noisiness, 3),
      tonality: round(tonality, 3),
      dominant_hz,
      peaks,
    },
    stereo: { correlation: round(correlation, 3), width: round(stereoWidth, 3) },
    warnings,
  };
}
