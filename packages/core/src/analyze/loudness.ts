import { Biquad } from '../dsp/filters.js';

/** K-weighting pre-filter from ITU-R BS.1770, designed for any sample rate. */
function kWeight(x: Float32Array, sr: number): Float32Array {
  const y = x.slice();
  Biquad.design('highshelf', sr, 1681.974450955533, 0.7071752369554196, 3.999843853973347).process(y);
  Biquad.design('highpass', sr, 38.13547087602444, 0.5003270373238773).process(y);
  return y;
}

const toLufs = (meanSquare: number): number => (meanSquare > 1e-12 ? -0.691 + 10 * Math.log10(meanSquare) : -120);

/**
 * Integrated loudness in LUFS (BS.1770 gating). Sounds shorter than one 400 ms
 * block are measured over their whole length, since most sound effects are that short.
 */
export function integratedLufs(channels: Float32Array[], sr: number): number {
  const weighted = channels.map((c) => kWeight(c, sr));
  const n = weighted[0]?.length ?? 0;
  if (n === 0) return -120;
  const block = Math.round(0.4 * sr);
  const hop = Math.round(0.1 * sr);
  const energy = (from: number, to: number): number => {
    let sum = 0;
    for (const c of weighted) {
      let s = 0;
      for (let i = from; i < to; i++) s += c[i]! * c[i]!;
      sum += s / (to - from);
    }
    return sum;
  };
  if (n < block) return toLufs(energy(0, n));
  const blocks: number[] = [];
  for (let start = 0; start + block <= n; start += hop) blocks.push(energy(start, start + block));
  const abs = blocks.filter((e) => toLufs(e) > -70);
  if (abs.length === 0) return -120;
  const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
  const rel = toLufs(mean(abs)) - 10;
  const gated = abs.filter((e) => toLufs(e) > rel);
  return toLufs(mean(gated.length ? gated : abs));
}
