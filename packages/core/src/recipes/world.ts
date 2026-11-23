import { z } from 'zod';
import type { LayerInput } from '../schema/index.js';
import { hash32, Rng } from '../util.js';
import { brightness, choice, defineRecipe, distance, env, far, layers, lg, lin, num, r0, r1, r2, room, unit, wetness } from './common.js';

const click = (id: string, startMs: number, hz: number, material: 'metal' | 'plastic', damping: number, gainDb = 0): LayerInput => ({
  id,
  start_ms: startMs,
  source: { type: 'modal', material, hz: r0(hz), size: 0.2, damping, strike: { hardness: 0.85 } },
  gain_db: gainDb,
});

const snap = (id: string, startMs: number, hz: number, gainDb: number): LayerInput => ({
  id,
  start_ms: startMs,
  source: { type: 'noise', color: 'white' },
  amp: env([[0, 1], [6, 0]]),
  gain_db: gainDb,
  fx: [{ type: 'filter', mode: 'bandpass', hz: r0(hz), q: 1 }],
});

export const mechanical = defineRecipe({
  name: 'mechanical',
  description: 'Mechanisms and devices: latches, switches, heavy clunks, servos, ratchets.',
  params: z.strictObject({
    kind: choice(['latch', 'switch', 'clunk', 'servo', 'ratchet'], 'latch', 'Which mechanism.'),
    size: unit(0.4, 'Size of the mechanism. 0 = tiny, 1 = industrial.'),
    length_ms: num(100, 4000, 600, 'Length of servo and ratchet movements.'),
    brightness: brightness(),
    wetness: wetness(0.15),
    distance_m: distance(),
  }),
  build: (p, seed) => {
    const f = lg(3200, 500, p.size);
    const T = Math.max(p.length_ms, 200);
    let ls: LayerInput[];
    switch (p.kind) {
      case 'switch':
        ls = [
          click('press', 0, f * 0.8, 'plastic', 0.5),
          click('release', 70, f * 1.1, 'plastic', 0.55, -4),
          snap('snap', 0, f * 2.5, -10),
          { id: 'spring', start_ms: 4, source: { type: 'pluck', hz: r0(f * 0.9), decay_ms: 90, brightness: 0.8 }, gain_db: -16 },
        ];
        break;
      case 'clunk':
        ls = [
          { id: 'body', source: { type: 'modal', material: 'metal', size: r1(0.5 + 0.5 * p.size), damping: 0.6, strike: { hardness: 0.5 }, mode_count: 40 } },
          { id: 'thump', source: { type: 'osc', hz: env([[0, r0(lg(200, 110, p.size))], [40, r0(lg(80, 42, p.size))]]) }, amp: env([[0, 0], [3, 1], [r0(120 + 200 * p.size), 0]]), gain_db: -3, fx: [{ type: 'shaper', drive_db: 8 }] },
          snap('contact', 0, 2200, -8),
          {
            id: 'rattle',
            start_ms: 30,
            source: { type: 'particles', kind: 'ping', rate_hz: env([[0, 90], [260, 2]]), hz: [r0(f * 0.8), r0(f * 4)], decay_ms: [10, 70] },
            amp: env([[0, 1], [280, 0]], 'linear'),
            gain_db: -16,
          },
        ];
        break;
      case 'servo': {
        const base = lg(420, 90, p.size);
        ls = [
          {
            id: 'motor',
            source: { type: 'osc', shape: 'pulse', pulse_width: 0.3, hz: env([[0, r0(base * 0.5)], [r0(T * 0.2), r0(base)], [r0(T * 0.8), r0(base * 1.08)], [r0(T), r0(base * 0.45)]], 'smooth'), unison: 3, detune_cents: 14 },
            amp: env([[0, 0], [20, 1], [r0(T - 40), 1], [r0(T), 0]], 'smooth'),
            fx: [
              { type: 'filter', mode: 'bandpass', hz: r0(base * 5), q: 2.2 },
              { type: 'formant', vowel: 'e', mix: 0.4 },
            ],
          },
          {
            id: 'gears',
            source: { type: 'osc', shape: 'saw', hz: env([[0, r0(base * 3.1)], [r0(T * 0.2), r0(base * 6.2)], [r0(T * 0.8), r0(base * 6.7)], [r0(T), r0(base * 2.8)]], 'smooth') },
            amp: env([[0, 0], [20, 1], [r0(T - 40), 1], [r0(T), 0]], 'smooth'),
            gain_db: -12,
            fx: [{ type: 'filter', mode: 'highpass', hz: 1500 }],
          },
          {
            id: 'air',
            source: { type: 'noise', color: 'pink' },
            amp: env([[0, 0], [30, 1], [r0(T - 40), 1], [r0(T), 0]], 'smooth'),
            gain_db: -18,
            fx: [{ type: 'filter', mode: 'bandpass', hz: r0(base * 9), q: 1.5 }],
          },
          click('stop', r0(T - 10), f, 'metal', 0.6, -8),
        ];
        break;
      }
      case 'ratchet': {
        const rate = lg(45, 14, p.size);
        ls = [
          {
            id: 'teeth',
            source: { type: 'osc', shape: 'pulse', pulse_width: 0.06, hz: { random: { rate_hz: 6, depth: r1(rate * 0.12) }, base: r1(rate) } },
            amp: env([[0, 1], [r0(T - 20), 1], [r0(T), 0]], 'linear'),
            fx: [
              { type: 'filter', mode: 'highpass', hz: 400 },
              { type: 'comb', hz: r0(f * 0.7), feedback: 0.82, mix: 0.7 },
              { type: 'filter', mode: 'bandpass', hz: r0(f * 1.4), q: 1 },
            ],
          },
          {
            id: 'grit',
            source: { type: 'particles', kind: 'click', rate_hz: r1(rate * 2), hz: [r0(f), r0(f * 4)], decay_ms: [1, 6], spread: 0.2 },
            amp: env([[0, 1], [r0(T - 20), 1], [r0(T), 0]], 'linear'),
            gain_db: -10,
          },
        ];
        break;
      }
      default: {
        // A latch is two broadband clicks (a small catch, then the clack as it seats) followed by
        // tiny settling clicks. Ringing metal modes make it a coin or a bell, and a swept sine
        // under it a drum, so the clicks are short noise bursts and the weight is low-passed noise.
        const gap = r0(lin(30, 60, p.size));
        const hp = r0(lg(300, 100, p.size));
        const noiseClick = (id: string, t: number, gainDb: number, lenMs: number): LayerInput => ({
          id,
          start_ms: t,
          source: { type: 'noise', color: 'white' },
          amp: env([[0, 1], [2, 0.35], [lenMs, 0]]),
          gain_db: gainDb,
          fx: [
            { type: 'filter', mode: 'highpass', hz: hp, q: 0.7 },
            { type: 'filter', mode: 'lowpass', hz: 12000, q: 0.7 },
          ],
        });
        ls = [
          noiseClick('catch', 0, -7, r0(lin(8, 14, p.size))),
          noiseClick('clack', gap, 0, r0(lin(14, 26, p.size))),
          {
            id: 'settle',
            start_ms: gap - 2,
            source: { type: 'particles', kind: 'burst', rate_hz: env([[0, 900], [40, 300], [140, 5]]), hz: [r0(f * 0.6), 7000], decay_ms: [0.4, 3], q: 0.9, gain_jitter_db: 14, spread: 0.2 },
            amp: env([[0, 1], [150, 0]]),
            gain_db: -6,
          },
          {
            id: 'thud',
            start_ms: gap,
            source: { type: 'noise', color: 'brown' },
            amp: env([[0, 0], [1, 1], [r0(lin(40, 90, p.size)), 0]]),
            gain_db: -8,
            fx: [{ type: 'filter', mode: 'lowpass', hz: r0(lg(700, 300, p.size)), q: 0.8 }],
          },
        ];
      }
    }
    return {
      name: `mechanical_${p.kind}`,
      seed,
      layers: ls,
      master: {
        fx: [
          // The box IR rings; it suits devices with a housing but turns a latch into a bell.
          ...(p.kind === 'latch' ? [] : [{ type: 'convolve' as const, ir: 'box' as const, mix: 0.25 }]),
          { type: 'eq', high_db: r1((p.brightness - 0.5) * 10) },
          ...far(p.distance_m),
          ...room(p.wetness, 0.3, 250 + 700 * p.wetness),
          { type: 'limiter' },
        ],
        normalize: { lufs: p.kind === 'switch' || p.kind === 'latch' ? -22 : -18 },
      },
    };
  },
});

export const door = defineRecipe({
  name: 'door',
  description: 'Doors: knocks, closing slams and hinge creaks.',
  params: z.strictObject({
    kind: choice(['knock', 'close', 'creak'], 'knock', 'Which door sound.'),
    material: choice(['wood', 'metal'], 'wood', 'Door material.'),
    size: unit(0.6, 'Door size and heaviness.'),
    force: unit(0.5, 'How hard: gentle tap to angry slam.'),
    knocks: num(1, 6, 3, 'Number of knocks for kind "knock".'),
    length_ms: num(300, 4000, 1200, 'Length of the creak.'),
    wetness: wetness(0.25),
    distance_m: distance(),
  }),
  build: (p, seed) => {
    const mat = p.material;
    let ls: LayerInput[];
    if (p.kind === 'knock') {
      ls = [];
      const gap = lin(210, 130, p.force);
      // A door is a large, heavily damped slab struck by a soft knuckle: a very low, dull body plus
      // a short bandpassed tap. Every knock shares one random stream (`seed`), so all of them hit
      // the same body; otherwise each gets differently tuned overtones and reads as a new pitch.
      // The later knocks only vary slightly in strength, spot and knuckle brightness.
      const rng = new Rng(hash32(seed + 0x6b6e));
      const tap = lg(1800, 3600, p.force);
      for (let i = 0; i < Math.round(p.knocks); i++) {
        const t = r0(i * gap + (i % 2) * 12);
        const first = i === 0;
        const accent = first ? 0 : r1(-0.5 - rng.next());
        ls.push(
          {
            id: `knock${i + 1}`,
            seed: 1,
            start_ms: t,
            source: {
              type: 'modal',
              material: mat,
              size: r2(0.7 + 0.3 * p.size),
              hz: r0(lg(32, 14, p.size)),
              damping: mat === 'metal' ? 0.7 : 0.89,
              strike: { hardness: r2(0.02 + 0.1 * p.force + (first ? 0 : 0.015 * rng.bi())), position: r2(0.3 + (first ? 0 : 0.015 * rng.bi())) },
              mode_count: 40,
            },
            amp: 2.4,
            gain_db: 10 + accent,
          },
          {
            id: `knuckle${i + 1}`,
            seed: 2,
            start_ms: t,
            source: { type: 'noise', color: 'pink' },
            amp: env([[0, 1], [5, 0]]),
            gain_db: 24 + accent,
            fx: [{ type: 'filter', mode: 'bandpass', hz: r0(tap * (first ? 1 : 1 + 0.05 * rng.bi())), q: 2.2 }],
          },
        );
      }
    } else if (p.kind === 'close') {
      ls = [
        { id: 'slam', source: { type: 'modal', material: mat === 'metal' ? 'metal' : 'hollow', size: r1(0.6 + 0.4 * p.size), damping: mat === 'metal' ? 0.45 : 0.2, strike: { hardness: r1(0.3 + 0.4 * p.force) }, mode_count: 36 } },
        { id: 'boom', source: { type: 'osc', hz: env([[0, r0(lg(150, 95, p.size))], [50, r0(lg(70, 42, p.size))]]) }, amp: env([[0, 0], [3, 1], [r0(140 + 260 * p.force), 0]]), gain_db: r1(-18 + 8 * p.force), fx: [{ type: 'shaper', drive_db: 6 }] },
        { id: 'air', source: { type: 'noise', color: 'pink' }, amp: env([[0, 0], [1, 1], [r0(60 + 100 * p.force), 0]]), gain_db: -2, fx: [{ type: 'filter', mode: 'lowpass', hz: env([[0, 4500], [100, 500]]), q: 0.8 }] },
        click('latch', r0(18 + 30 * (1 - p.force)), 1900, 'metal', 0.6, -5),
        click('latch2', r0(52 + 30 * (1 - p.force)), 1300, 'metal', 0.6, -8),
        {
          id: 'rattle',
          start_ms: 40,
          source: { type: 'particles', kind: 'burst', rate_hz: env([[0, r0(30 + 120 * p.force)], [300, 1]]), hz: [300, 3000], decay_ms: [4, 30] },
          amp: env([[0, 1], [320, 0]], 'linear'),
          gain_db: -10,
        },
      ];
    } else {
      const T = p.length_ms;
      const f = lg(73, 30, p.size);
      // Stick-slip friction: the hinge sticks and slips in segments, so the tick rate sits on a
      // plateau, jumps, and briefly stops while the hinge sticks. Each tick rings the door body.
      // A smoothly gliding buzz reads as a voice (kazoo, frog, groan), so avoid glides and
      // vowel filters. Keep ticks slow (below ~100 per second, or the train becomes a pitched burp) and
      // the body small and bright: real creaks sit at 2-6 kHz, and low body modes read as burping.
      const seg = (t0: number, t1: number, k: number): [number, number][] => [[r0(T * t0), r0(f * k)], [r0(T * t1), r0(f * k * 1.04)]];
      const rate = env([...seg(0, 0.18, 0.25), ...seg(0.2, 0.42, 0.9), ...seg(0.44, 0.62, 0.65), ...seg(0.64, 0.9, 1.15), ...seg(0.92, 1, 0.3)]);
      const stick = env([[0, 0], [r0(T * 0.02), 1], [r0(T * 0.18), 0.9], [r0(T * 0.19), 0.1], [r0(T * 0.21), 1], [r0(T * 0.42), 0.8], [r0(T * 0.43), 0.15], [r0(T * 0.45), 1], [r0(T * 0.62), 0.9], [r0(T * 0.63), 0.1], [r0(T * 0.65), 1], [r0(T * 0.9), 0.7], [r0(T * 0.91), 0.1], [r0(T * 0.93), 0.6], [r0(T), 0]]);
      ls = [
        {
          id: 'hinge',
          source: { type: 'particles', kind: 'click', rate_hz: rate, regularity: 0.85, hz: [2000, 6000], decay_ms: [0.3, 1], gain_jitter_db: 4, spread: 0.1 },
          amp: stick,
          fx: [
            { type: 'resonator', material: mat, size: mat === 'metal' ? 0.4 : r2(0.02 + 0.05 * p.size), damping: mat === 'metal' ? 0.6 : 0.3 },
            { type: 'filter', mode: 'highpass', hz: mat === 'metal' ? 200 : 2000 },
          ],
        },
      ];
    }
    return {
      name: `door_${p.kind}`,
      seed,
      layers: ls,
      master: {
        fx: [
          { type: 'transient', attack_db: p.kind === 'creak' ? 0 : r1(2 + 4 * p.force) },
          ...far(p.distance_m),
          ...room(p.wetness, 0.35, 350 + 900 * p.wetness),
          { type: 'limiter' },
        ],
        normalize: { lufs: p.kind === 'close' ? -18 : p.kind === 'knock' ? -21 : -20 },
      },
    };
  },
});

export const ambience_loop = defineRecipe({
  name: 'ambience_loop',
  description: 'Seamlessly looping background beds: wind, rain, fire, room tone.',
  params: z.strictObject({
    kind: choice(['wind', 'rain', 'fire', 'room'], 'wind', 'Which ambience.'),
    length_ms: num(2000, 30000, 6000, 'Loop length.'),
    intensity: unit(0.5, 'Breeze to gale, drizzle to downpour, embers to blaze.'),
    brightness: brightness(),
    wetness: wetness(0.1),
  }),
  build: (p, seed) => {
    const i = p.intensity;
    let ls: LayerInput[];
    let lufs = -24;
    switch (p.kind) {
      case 'rain':
        lufs = -22;
        ls = [
          { id: 'wash', source: { type: 'noise', color: 'white' }, gain_db: -6, fx: [{ type: 'filter', mode: 'highpass', hz: 1800 }, { type: 'filter', hz: r0(lg(6000, 12000, p.brightness)) }, { type: 'width', amount: 1, haas_ms: 11 }] },
          { id: 'drops', source: { type: 'particles', kind: 'burst', rate_hz: r0(lg(60, 900, i)), hz: [1800, 9000], decay_ms: [1.5, 12], gain_jitter_db: 20, q: 2, spread: 1 } },
          { id: 'drips', source: { type: 'particles', kind: 'ping', rate_hz: r1(lg(1.5, 14, i)), hz: [500, 1800], decay_ms: [20, 70], gain_jitter_db: 14, spread: 0.9 }, gain_db: -12 },
          { id: 'low', source: { type: 'noise', color: 'brown' }, gain_db: r1(-22 + 10 * i), fx: [{ type: 'filter', hz: 350 }] },
        ];
        break;
      case 'fire':
        // Mostly a low, fluttering roar, with crackles that come in clusters (wood splitting)
        // and have some body. A steady high hiss under evenly spread one-cycle ticks is static.
        ls = [
          {
            id: 'roar',
            source: { type: 'noise', color: 'brown' },
            amp: { random: { rate_hz: 7, depth: 0.35 }, base: 0.65 },
            gain_db: -8,
            fx: [
              { type: 'filter', hz: { random: { rate_hz: 3, depth: 200 }, base: r0(lg(300, 800, i)) }, q: 0.8 },
              { type: 'gain', db: { random: { rate_hz: 18, depth: 4 }, base: 0 } },
            ],
          },
          {
            id: 'crackle',
            source: { type: 'particles', kind: 'burst', rate_hz: { random: { rate_hz: 2.5, depth: r1(lg(6, 40, i)) }, base: r1(lg(6, 40, i)) }, hz: [900, 7000], decay_ms: [0.6, 4], q: 0.9, gain_jitter_db: 22, spread: 0.8 },
            gain_db: 8,
          },
          { id: 'pops', source: { type: 'particles', kind: 'burst', rate_hz: r1(lg(0.8, 5, i)), hz: [150, 900], decay_ms: [6, 30], q: 1, gain_jitter_db: 10, spread: 0.6 }, gain_db: 4 },
          { id: 'hiss', source: { type: 'noise', color: 'pink' }, amp: { random: { rate_hz: 4, depth: 0.4 }, base: 0.5 }, gain_db: -26, fx: [{ type: 'filter', mode: 'bandpass', hz: 2500, q: 0.7 }] },
        ];
        break;
      case 'room':
        lufs = -34;
        ls = [
          { id: 'air', source: { type: 'noise', color: 'brown' }, fx: [{ type: 'filter', hz: 260 }, { type: 'width', haas_ms: 17 }] },
          { id: 'vent', source: { type: 'noise', color: 'pink' }, gain_db: r1(-20 + 12 * i), fx: [{ type: 'filter', mode: 'bandpass', hz: r0(lg(500, 1600, p.brightness)), q: 0.8 }, { type: 'width', haas_ms: 9 }] },
          { id: 'hum', source: { type: 'osc', shape: 'triangle', hz: 100 }, gain_db: r1(-34 + 12 * i) },
        ];
        break;
      default:
        ls = [
          { id: 'gust', source: { type: 'noise', color: 'pink' }, amp: { random: { rate_hz: r1(lin(0.2, 0.7, i)), depth: 0.4 }, base: 0.6 }, pan: { random: { rate_hz: 0.2, depth: 0.5 }, base: 0 }, fx: [{ type: 'filter', mode: 'bandpass', hz: { random: { rate_hz: r1(lin(0.25, 0.9, i)), depth: r0(lin(150, 500, i)) }, base: r0(lg(350, 900, i)) }, q: r1(lin(1.2, 3, i)) }] },
          { id: 'whistle', source: { type: 'noise', color: 'white' }, amp: { random: { rate_hz: 0.5, depth: 0.5 }, base: 0.5 }, gain_db: r1(-12 + 12 * i), pan: { random: { rate_hz: 0.3, depth: 0.7 }, base: 0 }, fx: [{ type: 'filter', mode: 'bandpass', hz: { random: { rate_hz: 0.6, depth: 500 }, base: r0(lg(1400, 2600, p.brightness)) }, q: 9 }] },
          { id: 'rumble', source: { type: 'noise', color: 'brown' }, amp: { random: { rate_hz: 0.3, depth: 0.3 }, base: 0.7 }, gain_db: -16, fx: [{ type: 'filter', hz: 180 }, { type: 'width', haas_ms: 13 }] },
        ];
    }
    return {
      name: `ambience_${p.kind}`,
      seed,
      duration: p.length_ms,
      layers: ls,
      master: {
        fx: [{ type: 'eq', high_db: r1((p.brightness - 0.5) * 8) }, ...room(p.wetness, 0.6, 1200)],
        loop: true,
        normalize: { lufs, peak_db: -3 },
      },
    };
  },
});
