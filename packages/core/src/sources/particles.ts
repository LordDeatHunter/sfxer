import { Svf } from '../dsp/filters.js';
import { resolveParam } from '../mod.js';
import type { SourceOf } from '../schema/index.js';
import { dbToGain, sigAt, type Stereo } from '../util.js';
import type { Ctx } from './index.js';

/** Equal-power pan gains with unity at the centre. */
export function panGains(pan: number): [number, number] {
  const a = ((pan + 1) * Math.PI) / 4;
  return [Math.SQRT2 * Math.cos(a), Math.SQRT2 * Math.sin(a)];
}

export function particles(s: SourceOf<'particles'>, ctx: Ctx): Stereo {
  const { n, sr, rng } = ctx;
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  const rate = resolveParam(s.rate_hz, n, sr, rng, 0.2, 4000);
  let t = (-Math.log(1 - rng.next()) / Math.max(sigAt(rate, 0), 0.2)) * sr * 0.25;
  while (t < n) {
    const start = Math.floor(t);
    const hz = rng.logRange(s.hz[0], s.hz[1]);
    const decayMs = rng.logRange(s.decay_ms[0], s.decay_ms[1]);
    const gain = dbToGain(-s.gain_jitter_db * rng.next());
    const [gl, gr] = panGains(rng.bi() * s.spread);
    const len = Math.min(n - start, Math.max(8, Math.ceil((decayMs / 1000) * sr)));
    const d = Math.exp(-6.908 / Math.max(1, (decayMs / 1000) * sr));
    if (s.kind === 'ping' && s.chirp_semitones === 0) {
      const inc = (2 * Math.PI * hz) / sr;
      let env = gain;
      for (let i = 0; i < len; i++) {
        const y = env * Math.sin(inc * i);
        L[start + i] = L[start + i]! + y * gl;
        R[start + i] = R[start + i]! + y * gr;
        env *= d;
      }
    } else if (s.kind === 'ping' || s.kind === 'bubble') {
      // Gliding sine. A ping glides evenly over its life; a bubble (Minnaert resonance of a
      // forming bubble) rises fast and settles, and starts with a soft 1 ms onset plus a tiny
      // broadband tick from the surface breaking.
      const bubble = s.kind === 'bubble';
      const tau = Math.max(1, len * 0.18);
      const attack = bubble ? Math.max(1, Math.round(sr * 0.001)) : 0;
      const tick = bubble ? Math.max(2, Math.round(sr * 0.0006)) : 0;
      const tickGain = gain * 0.35;
      let phase = 0;
      let env = gain;
      for (let i = 0; i < len; i++) {
        const g = bubble ? 1 - Math.exp(-i / tau) : i / len;
        phase += (2 * Math.PI * hz * Math.pow(2, (s.chirp_semitones * g) / 12)) / sr;
        let y = env * Math.sin(phase) * (i < attack ? i / attack : 1);
        if (i < tick) y += tickGain * rng.bi() * (1 - i / tick);
        L[start + i] = L[start + i]! + y * gl;
        R[start + i] = R[start + i]! + y * gr;
        env *= d;
      }
    } else if (s.kind === 'click') {
      const period = Math.max(4, Math.min(len, Math.round(sr / hz)));
      for (let i = 0; i < period && start + i < n; i++) {
        const u = i / period;
        const y = gain * Math.sin(2 * Math.PI * u) * (1 - u) * (1 - u);
        L[start + i] = L[start + i]! + y * gl;
        R[start + i] = R[start + i]! + y * gr;
      }
    } else {
      const f = new Svf(sr);
      f.set(hz, s.q);
      let env = gain * Math.sqrt(s.q); // narrow bands carry less energy; compensate
      for (let i = 0; i < len; i++) {
        const y = env * f.tick(rng.bi(), 'bandpass');
        L[start + i] = L[start + i]! + y * gl;
        R[start + i] = R[start + i]! + y * gr;
        env *= d;
      }
    }
    const r = Math.max(sigAt(rate, Math.min(n - 1, start)), 0.2);
    // Blend a random (Poisson) gap with an even one; same rng draw either way, so regularity 0 is unchanged.
    const gap = (1 - s.regularity) * -Math.log(1 - rng.next()) + s.regularity;
    t += Math.max(1, (gap / r) * sr);
  }
  return [L, R];
}
