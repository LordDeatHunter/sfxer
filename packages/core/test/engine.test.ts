import { describe, expect, it } from 'vitest';
import { Biquad, oversampled, svfProcess } from '../src/dsp/filters.js';
import { fft } from '../src/dsp/fft.js';
import {
  analyze,
  compare,
  decodeWav,
  encodeWav,
  expandRecipe,
  integratedLufs,
  parsePatch,
  PatchError,
  RECIPES,
  render,
  validatePatch,
  vary,
  match,
  describeNode,
  docsMarkdown,
  type PatchInput,
} from '../src/index.js';
import { renderEnv } from '../src/mod.js';

const SR = 48000;
const sine = (hz: number, n: number, amp = 1) => Float32Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / SR));
const rms = (x: Float32Array, from = 0) => Math.sqrt(x.subarray(from).reduce((s, v) => s + v * v, 0) / (x.length - from));
const db = (g: number) => 20 * Math.log10(g);

describe('dsp primitives', () => {
  it('fft round-trips', () => {
    const re = Float32Array.from({ length: 1024 }, (_, i) => Math.sin(i * 0.3) + 0.2 * Math.cos(i * 1.7));
    const orig = re.slice();
    const im = new Float32Array(1024);
    fft(re, im);
    fft(re, im, true);
    for (let i = 0; i < 1024; i++) expect(re[i]).toBeCloseTo(orig[i]!, 4);
  });

  it('lowpass passes lows and rejects highs at the expected slope', () => {
    const low = sine(100, SR);
    const high = sine(8000, SR);
    svfProcess(low, SR, 'lowpass', 1000, 0.707);
    svfProcess(high, SR, 'lowpass', 1000, 0.707);
    expect(db(rms(low, 4800) / Math.SQRT1_2)).toBeGreaterThan(-0.5);
    // 12 dB/octave, three octaves above cutoff: about -36 dB
    expect(db(rms(high, 4800) / Math.SQRT1_2)).toBeLessThan(-33);
    expect(db(rms(high, 4800) / Math.SQRT1_2)).toBeGreaterThan(-42);
  });

  it('biquad peak boosts its centre by the requested gain', () => {
    const x = sine(1000, SR);
    Biquad.design('peak', SR, 1000, 1, 6).process(x);
    expect(db(rms(x, 4800) / Math.SQRT1_2)).toBeCloseTo(6, 0);
  });

  it('oversampled distortion keeps aliasing low', () => {
    // 5 kHz driven hard: harmonics at 15k, 25k (aliases to 23k without oversampling), ...
    const x = sine(5000, 8192, 1);
    oversampled(x, 4, (v) => Math.tanh(v * 8));
    const re = x.slice();
    const im = new Float32Array(8192);
    for (let i = 0; i < 8192; i++) re[i] = re[i]! * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / 8192));
    fft(re, im);
    const mag = (hz: number) => {
      const k = Math.round((hz / SR) * 8192);
      let m = 0;
      for (let j = k - 3; j <= k + 3; j++) m = Math.max(m, Math.hypot(re[j]!, im[j]!));
      return m;
    };
    // The 7th harmonic (35 kHz) would fold to 13 kHz.
    expect(db(mag(13000) / mag(5000))).toBeLessThan(-50);
  });

  it('envelopes hit their points on time', () => {
    const e = renderEnv([[0, 0], [10, 1], [110, 0]], 'linear', SR / 5, SR);
    expect(e[0]).toBe(0);
    expect(e[480]).toBeCloseTo(1, 3);
    expect(e[480 + 2400]).toBeCloseTo(0.5, 2);
    expect(e[9000]).toBe(0);
    const g = renderEnv([[0, 100], [100, 1600]], 'exp', SR / 5, SR);
    expect(g[2400]).toBeCloseTo(400, 0); // geometric midpoint
  });

  it('measures loudness like BS.1770', () => {
    // A 997 Hz sine at -18 dBFS in both channels reads about -18 LUFS.
    const x = sine(997, SR * 3, Math.pow(10, -18 / 20));
    expect(integratedLufs([x, x], SR)).toBeCloseTo(-18, 0);
  });

  it('wav round-trips at every bit depth', () => {
    const x = sine(440, 1000, 0.5);
    for (const bits of [16, 24, 32] as const) {
      const d = decodeWav(encodeWav([x, x], SR, bits));
      expect(d.sampleRate).toBe(SR);
      expect(d.channels.length).toBe(2);
      for (let i = 0; i < 1000; i += 37) expect(d.channels[0]![i]).toBeCloseTo(x[i]!, bits === 16 ? 3 : 5);
    }
  });
});

describe('validation', () => {
  it('explains mistakes with paths and suggestions', () => {
    const r = validatePatch({ layers: [{ source: { type: 'modal', material: 'wod' }, fx: [{ type: 'filtr', hz: 100 }] }], mastr: {} });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const text = r.issues.map((i) => `${i.path}: ${i.message}`).join('\n');
    expect(text).toContain('layers[0].source.material');
    expect(text).toContain('did you mean "wood"');
    expect(text).toContain('did you mean "filter"');
    expect(text).toContain('did you mean "master"');
  });

  it('rejects out-of-range values and backwards envelopes instead of clamping', () => {
    expect(() => parsePatch({ layers: [{ source: { type: 'osc', hz: 5 } }] })).toThrow(PatchError);
    expect(() => parsePatch({ layers: [{ source: { type: 'osc', hz: 200 }, amp: { env: [[50, 1], [10, 0]] } }] })).toThrow(/must increase/);
  });
});

describe('render', () => {
  const knock: PatchInput = {
    seed: 7,
    layers: [
      { id: 'body', source: { type: 'modal', material: 'wood' } },
      { id: 'click', source: { type: 'noise' }, amp: { env: [[0, 1], [5, 0]] }, gain_db: -8, fx: [{ type: 'filter', mode: 'bandpass', hz: 3000 }] },
    ],
    master: { fx: [{ type: 'reverb', mix: 0.15 }] },
  };

  it('is deterministic for a given seed and changes with the seed', () => {
    const a = render(parsePatch(knock));
    const b = render(parsePatch(knock));
    const c = render(parsePatch({ ...knock, seed: 8 }));
    expect(Buffer.from(encodeWav(a.channels, SR)).equals(Buffer.from(encodeWav(b.channels, SR)))).toBe(true);
    expect(Buffer.from(encodeWav(a.channels, SR)).equals(Buffer.from(encodeWav(c.channels, SR)))).toBe(false);
  });

  it('normalises loudness and respects the peak ceiling', () => {
    const r = render(parsePatch({ layers: [{ source: { type: 'noise', color: 'pink' }, amp: { env: [[0, 0], [50, 1], [1500, 0]] } }] }));
    const rep = analyze(r.channels, SR);
    expect(rep.level.lufs).toBeCloseTo(-16, 0);
    expect(rep.level.peak_db).toBeLessThanOrEqual(-0.9);
    expect(rep.level.clipped).toBe(false);
  });

  it('fits duration to the layers and their tails, and warns about endless layers', () => {
    const short = render(parsePatch({ layers: [{ source: { type: 'osc', hz: 300 }, amp: { env: [[0, 0], [5, 1], [100, 0]] } }] }));
    expect(short.durationMs).toBeGreaterThan(95);
    expect(short.durationMs).toBeLessThan(160);
    const endless = render(parsePatch({ layers: [{ source: { type: 'noise' } }] }));
    expect(endless.warnings.join(' ')).toContain('never ends on its own');
  });

  it('loops seamlessly', () => {
    const r = render(parsePatch({ duration: 1000, layers: [{ source: { type: 'noise', color: 'brown' }, fx: [{ type: 'filter', hz: 400 }] }], master: { loop: true } }));
    expect(r.channels[0].length).toBe(SR);
    const x = r.channels[0];
    // The jump across the loop point is no bigger than ordinary sample-to-sample movement.
    let typical = 0;
    for (let i = 1; i < x.length; i++) typical = Math.max(typical, Math.abs(x[i]! - x[i - 1]!));
    expect(Math.abs(x[0]! - x[x.length - 1]!)).toBeLessThanOrEqual(typical * 1.5);
  });
});

describe('recipes', () => {
  const kinds: Record<string, Record<string, unknown>[]> = {};
  for (const [name, recipe] of Object.entries(RECIPES)) {
    const doc = describeNode(name)!;
    const variants: Record<string, unknown>[] = [{}];
    // Every value of every choice parameter, plus both extremes of every numeric one.
    for (const f of doc.fields) {
      if (f.options) for (const o of f.options) variants.push({ [f.name]: o });
      else if (f.min !== undefined && f.max !== undefined && f.name !== 'length_ms') variants.push({ [f.name]: f.min }, { [f.name]: f.max });
    }
    kinds[name] = variants;
    expect(recipe.name).toBe(name);
  }

  for (const [name, variants] of Object.entries(kinds)) {
    it(`${name}: every parameter extreme yields a valid, clean render`, () => {
      for (const params of variants) {
        const patch = parsePatch(expandRecipe(name, name === 'ambience_loop' ? { length_ms: 2000, ...params } : params, 3));
        const r = render(patch);
        const rep = analyze(r.channels, SR, { loop: patch.master.loop });
        const label = `${name} ${JSON.stringify(params)}`;
        expect(r.warnings.filter((w) => !w.includes('Loudness target')), label).toEqual([]);
        expect(rep.level.clipped, label).toBe(false);
        expect(rep.level.peak_db, label).toBeGreaterThan(-40);
        expect(rep.level.peak_db, label).toBeLessThanOrEqual(0);
        expect(r.channels[0].every(Number.isFinite), label).toBe(true);
        expect(rep.warnings.filter((w) => /Clipping|silent|out of phase|DC offset/.test(w)), label).toEqual([]);
      }
    }, 120000);
  }

  it('recipes encode their intent', () => {
    const rep = (name: string, params = {}) => {
      const r = render(parsePatch(expandRecipe(name, params)));
      return analyze(r.channels, SR);
    };
    expect(rep('impact').shape.attack_ms).toBeLessThan(10);
    const w = rep('whoosh').spectrum.centroid_over_time_hz;
    expect(Math.max(...w.slice(1, 5))).toBeGreaterThan(w[0]! * 2); // rises...
    expect(w[7]!).toBeLessThan(Math.max(...w) / 2); // ...then falls
    expect(rep('impact', { material: 'metal' }).shape.decay_ms).toBeGreaterThan(rep('impact', { material: 'wood' }).shape.decay_ms * 2);
    expect(rep('impact', { size: 0.1 }).spectrum.centroid_hz).toBeGreaterThan(rep('impact', { size: 0.9 }).spectrum.centroid_hz);
    expect(rep('explosion').spectrum.noisiness).toBeGreaterThan(rep('ui', { kind: 'confirm' }).spectrum.noisiness);
    expect(rep('gore', { kind: 'slime', viscosity: 0 }).spectrum.centroid_hz).toBeGreaterThan(rep('gore', { kind: 'slime', viscosity: 1 }).spectrum.centroid_hz);
    expect(rep('gore', { kind: 'squish' }).shape.attack_ms).toBeGreaterThan(rep('gore', { kind: 'splat' }).shape.attack_ms); // swells vs hits
  });

  it('bubble particles rise in pitch with chirp_semitones', () => {
    const centroid = (chirp: number) => {
      const r = render(parsePatch({
        layers: [{ source: { type: 'particles', kind: 'bubble', rate_hz: 40, hz: [800, 800], decay_ms: [40, 40], chirp_semitones: chirp, gain_jitter_db: 0 }, amp: { env: [[0, 1], [400, 1], [450, 0]] } }],
        master: { normalize: false },
      }));
      return analyze(r.channels, SR).spectrum.centroid_hz;
    };
    // Energy-weighted: most of the rise happens as the blip decays, so the centroid moves ~1.25x.
    expect(centroid(12)).toBeGreaterThan(centroid(0) * 1.15);
  });

  it('rejects bad recipe parameters helpfully', () => {
    expect(() => expandRecipe('impakt')).toThrow(/did you mean "impact"/);
    expect(() => expandRecipe('impact', { materal: 'wood' })).toThrow(/did you mean "material"/);
  });
});

describe('tools', () => {
  it('vary makes valid, distinct, reproducible takes', () => {
    const base = expandRecipe('footstep', { surface: 'gravel' });
    const a = vary(base, { count: 4, amount: 1 });
    const b = vary(base, { count: 4, amount: 1 });
    expect(a).toEqual(b);
    expect(new Set(a.map((p) => JSON.stringify(p))).size).toBe(4);
    for (const p of a) expect(validatePatch(p).ok).toBe(true);
  });

  it('compare is zero for identical sounds and describes differences', () => {
    const wood = render(parsePatch(expandRecipe('impact'))).channels;
    const metal = render(parsePatch(expandRecipe('impact', { material: 'metal' }))).channels;
    expect(compare(wood, SR, wood, SR).similarity).toBe(100);
    const c = compare(wood, SR, metal, SR);
    expect(c.similarity).toBeLessThan(60);
    expect(c.summary.join(' ')).toMatch(/brighter/);
    // Different sample rates are resampled rather than rejected.
    const wood96 = wood.map((ch) => Float32Array.from({ length: ch.length * 2 }, (_, i) => ch[i >> 1]!));
    expect(compare(wood, SR, wood96, SR * 2).similarity).toBeGreaterThan(90);
  });

  it('match approximates a sound deterministically', () => {
    const coin = render(parsePatch(expandRecipe('pickup', { kind: 'coin' })));
    const a = match(coin.channels, SR);
    const b = match(coin.channels, SR);
    expect(a.patch).toEqual(b.patch);
    expect(validatePatch(a.patch).ok).toBe(true);
    expect(a.similarity).toBeGreaterThan(70);
    // The score reported is the score you get by rendering the patch and comparing.
    const again = render(parsePatch(a.patch));
    expect(compare(coin.channels, SR, again.channels, SR).similarity).toBeGreaterThan(60);
    const noise = render(parsePatch(expandRecipe('whoosh')));
    expect(match(noise.channels, SR, { quick: true }).patch.layers.every((l) => l.source.type === 'noise')).toBe(true);
  }, 60000);

  it('flags a bare beep as synthetic', () => {
    const r = render(parsePatch({ layers: [{ source: { type: 'osc', shape: 'sine', hz: 880 }, amp: { env: [[0, 1], [300, 0]] } }] }));
    expect(analyze(r.channels, SR).warnings.join(' ')).toMatch(/pure tone/);
  });

  it('docs cover every source, effect and recipe', () => {
    const md = docsMarkdown();
    for (const name of ['modal', 'particles', 'reverb', 'limiter', 'impact', 'ambience_loop']) expect(md).toContain(`### ${name}`);
    expect(describeNode('filter')!.fields.find((f) => f.name === 'hz')!.modulatable).toBe(true);
  });
});
