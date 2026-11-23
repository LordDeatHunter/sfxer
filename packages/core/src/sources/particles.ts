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
    if (s.kind === 'ping') {
      const inc = (2 * Math.PI * hz) / sr;
      let env = gain;
      for (let i = 0; i < len; i++) {
        const y = env * Math.sin(inc * i);
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
    t += Math.max(1, (-Math.log(1 - rng.next()) / r) * sr);
  }
  return [L, R];
}
