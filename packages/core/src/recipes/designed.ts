import { z } from 'zod';
import type { LayerInput } from '../schema/index.js';
import { brightness, choice, defineRecipe, distance, env, far, layers, lg, lin, num, r0, r1, room, unit, wetness } from './common.js';

const st = (semi: number): number => Math.pow(2, semi / 12);

/** A soft, glassy FM note: the building block for interface tones. */
function note(id: string, hz: number, startMs: number, lenMs: number, bright: number, gainDb = 0): LayerInput {
  return {
    id,
    start_ms: startMs,
    source: { type: 'fm', hz: r1(hz), ratio: 2.005, index: env([[0, r1(1.4 + 3 * bright)], [r0(lenMs * 0.6), 0.35]]), feedback: 0.2 },
    amp: env([[0, 0], [3, 1], [r0(lenMs), 0]]),
    gain_db: gainDb,
  };
}

function tick(id: string, startMs: number, hz: number, gainDb: number): LayerInput {
  return {
    id,
    start_ms: startMs,
    source: { type: 'noise', color: 'white' },
    amp: env([[0, 1], [5, 0]]),
    gain_db: gainDb,
    fx: [{ type: 'filter', mode: 'bandpass', hz: r0(hz), q: 1.2 }],
  };
}

export const ui = defineRecipe({
  name: 'ui',
  description: 'Interface sounds: soft, short and clean rather than chiptune beeps.',
  params: z.strictObject({
    kind: choice(['click', 'hover', 'confirm', 'error', 'toggle', 'notify', 'back'], 'click', 'Which interface event.'),
    pitch_semitones: num(-12, 12, 0, 'Transpose the whole sound.'),
    brightness: brightness(),
    wetness: wetness(0.15),
  }),
  build: (p, seed) => {
    const k = st(p.pitch_semitones);
    const b = p.brightness;
    let ls: LayerInput[];
    let lufs = -20;
    switch (p.kind) {
      case 'click':
        lufs = -23;
        ls = [
          { id: 'body', source: { type: 'modal', material: 'plastic', hz: r0(950 * k), damping: 0.45, strike: { hardness: r1(0.5 + 0.4 * b) } } },
          tick('tick', 0, 4200 * k, -12),
          { id: 'low', source: { type: 'osc', hz: env([[0, r0(320 * k)], [18, r0(170 * k)]]) }, amp: env([[0, 0], [1, 1], [30, 0]]), gain_db: -10 },
        ];
        break;
      case 'hover':
        lufs = -26;
        ls = [
          { id: 'tap', source: { type: 'modal', material: 'glass', hz: r0(1250 * k), damping: 0.7, strike: { hardness: r1(0.3 + 0.4 * b) } } },
          note('blip', 1250 * k, 0, 45, b * 0.5, -8),
          tick('air', 0, 5000 * k, -8),
        ];
        break;
      case 'confirm':
        ls = [note('first', 660 * k, 0, 170, b), note('second', 990 * k, 85, 320, b), tick('tick', 0, 5000 * k, -10)];
        break;
      case 'error':
        ls = [
          {
            id: 'first',
            source: { type: 'osc', shape: 'saw', hz: r1(233 * k), unison: 3, detune_cents: 18 },
            amp: env([[0, 0], [4, 1], [110, 0]]),
            fx: [{ type: 'filter', hz: env([[0, r0(lg(2500, 7000, b))], [110, 500]]), q: 1.2 }],
          },
          {
            id: 'second',
            start_ms: 120,
            source: { type: 'osc', shape: 'saw', hz: r1(185 * k), unison: 3, detune_cents: 18 },
            amp: env([[0, 0], [4, 1], [190, 0]]),
            fx: [{ type: 'filter', hz: env([[0, r0(lg(2500, 7000, b))], [190, 400]]), q: 1.2 }],
          },
          tick('tick', 0, 3500 * k, -8),
        ];
        break;
      case 'toggle':
        lufs = -23;
        ls = [
          { id: 'down', source: { type: 'modal', material: 'plastic', hz: r0(700 * k), damping: 0.5 } },
          { id: 'up', start_ms: 48, source: { type: 'modal', material: 'plastic', hz: r0(1050 * k), damping: 0.5 }, gain_db: -3 },
          tick('tick', 0, 3800 * k, -14),
        ];
        break;
      case 'back':
        ls = [note('first', 620 * k, 0, 130, b), note('second', 415 * k, 70, 220, b), tick('tick', 0, 4000 * k, -9)];
        break;
      default:
        lufs = -18;
        ls = [
          { id: 'glass', source: { type: 'modal', material: 'glass', hz: r0(1320 * k), damping: 0.2, strike: { hardness: r1(0.4 + 0.4 * b) } }, gain_db: -4 },
          note('tone', 880 * k, 0, 520, b),
          note('fifth', 1320 * k, 110, 620, b, -4),
        ];
    }
    return {
      name: `ui_${p.kind}`,
      seed,
      layers: ls,
      master: {
        fx: [
          { type: 'eq', high_db: r1((b - 0.5) * 6), low_db: -2 },
          ...room(p.wetness, 0.3, 300 + 700 * p.wetness),
          { type: 'limiter' },
        ],
        normalize: { lufs },
      },
    };
  },
});

export const pickup = defineRecipe({
  name: 'pickup',
  description: 'Collecting things: coins, gems, power-ups, generic items.',
  params: z.strictObject({
    kind: choice(['coin', 'gem', 'powerup', 'item'], 'coin', 'What is collected.'),
    pitch_semitones: num(-12, 12, 0, 'Transpose the whole sound.'),
    sparkle: unit(0.5, 'Amount of glitter on top.'),
    brightness: brightness(0.6),
    wetness: wetness(0.25),
  }),
  build: (p, seed) => {
    const k = st(p.pitch_semitones);
    const sparkle = (startMs: number, lenMs: number, lo: number, hi: number): LayerInput | false =>
      p.sparkle > 0.02 && {
        id: 'sparkle',
        start_ms: startMs,
        source: { type: 'particles', kind: 'ping', rate_hz: env([[0, r0(20 + 90 * p.sparkle)], [r0(lenMs), 2]]), hz: [r0(lo * k), r0(hi * k)], decay_ms: [30, 220], spread: 0.9 },
        amp: env([[0, 1], [r0(lenMs), 0]], 'linear'),
        gain_db: r1(-22 + 8 * p.sparkle),
      };
    let ls: (LayerInput | false)[];
    switch (p.kind) {
      case 'coin':
        ls = [
          { id: 'clink1', source: { type: 'modal', material: 'metal', hz: r0(2100 * k), size: 0.1, damping: 0.25, strike: { hardness: 0.9 } } },
          { id: 'clink2', start_ms: 62, source: { type: 'modal', material: 'metal', hz: r0(2800 * k), size: 0.1, damping: 0.15, strike: { hardness: 0.9 } }, gain_db: -2 },
          tick('tick', 0, 7000, -14),
          sparkle(60, 350, 4000, 11000),
        ];
        break;
      case 'gem':
        ls = [
          { id: 'glass', source: { type: 'modal', material: 'glass', hz: r0(1568 * k), damping: 0.1 } },
          note('n1', 1046 * k, 0, 260, p.brightness, -6),
          note('n2', 1568 * k, 70, 320, p.brightness, -7),
          note('n3', 2093 * k, 140, 480, p.brightness, -8),
          sparkle(40, 600, 3500, 12000),
        ];
        break;
      case 'powerup':
        ls = [
          {
            id: 'rise',
            source: { type: 'osc', shape: 'saw', hz: r1(196 * k), pitch_semitones: env([[0, 0], [420, 19]], 'smooth'), unison: 5, detune_cents: 22 },
            amp: env([[0, 0], [30, 0.8], [380, 1], [560, 0]], 'smooth'),
            gain_db: -4,
            fx: [
              { type: 'filter', hz: env([[0, 500], [420, r0(lg(3500, 9000, p.brightness))]]), q: 2.2 },
              { type: 'chorus', mix: 0.4 },
            ],
          },
          {
            id: 'bell',
            start_ms: 400,
            source: { type: 'fm', hz: r1(1175 * k), ratio: 3.01, index: env([[0, 3], [300, 0.2]]) },
            amp: env([[0, 0], [2, 1], [650, 0]]),
            gain_db: -5,
          },
          {
            id: 'air',
            source: { type: 'noise', color: 'pink' },
            amp: env([[0, 0], [400, 1], [520, 0]], 'smooth'),
            gain_db: -14,
            fx: [{ type: 'filter', mode: 'bandpass', hz: env([[0, 800], [420, 7000]]), q: 2 }],
          },
          sparkle(380, 700, 3000, 12000),
        ];
        break;
      default:
        ls = [
          { id: 'pop', source: { type: 'osc', hz: env([[0, r0(380 * k)], [70, r0(900 * k)]]) }, amp: env([[0, 0], [3, 1], [110, 0]]) },
          { id: 'body', source: { type: 'modal', material: 'plastic', hz: r0(820 * k), damping: 0.3 }, gain_db: -5 },
          tick('tick', 0, 5000, -15),
          sparkle(50, 250, 3000, 9000),
        ];
    }
    return {
      name: `pickup_${p.kind}`,
      seed,
      layers: layers(...ls),
      master: {
        fx: [{ type: 'eq', high_db: r1((p.brightness - 0.5) * 8) }, ...room(p.wetness, 0.35, 400 + 900 * p.wetness), { type: 'limiter' }],
        normalize: { lufs: -18 },
      },
    };
  },
});

export const magic = defineRecipe({
  name: 'magic',
  description: 'Spells and supernatural effects: charge-ups, casts, shimmers, heals.',
  params: z.strictObject({
    kind: choice(['cast', 'charge', 'shimmer', 'heal'], 'cast', 'Which magical gesture.'),
    length_ms: num(200, 5000, 900, 'Approximate length before the reverb tail.'),
    pitch_semitones: num(-12, 12, 0, 'Transpose the tonal parts.'),
    darkness: unit(0.2, '0 = light and sparkly, 1 = dark and ominous.'),
    brightness: brightness(0.6),
    wetness: wetness(0.45),
  }),
  build: (p, seed) => {
    const T = p.length_ms;
    const k = st(p.pitch_semitones - 12 * p.darkness);
    const top = lg(11000, 5000, p.darkness);
    let ls: (LayerInput | false)[];
    if (p.kind === 'charge') {
      ls = [
        {
          id: 'tone',
          source: { type: 'osc', shape: 'saw', hz: r1(110 * k), pitch_semitones: env([[0, 0], [r0(T), 17]], 'exp'), unison: 7, detune_cents: 30 },
          amp: env([[0, 0], [25, 0.25], [r0(T * 0.9), 1], [r0(T + 70), 0]], 'linear'),
          fx: [
            { type: 'filter', hz: env([[0, 700], [r0(T), r0(top)]]), q: 3 },
            { type: 'chorus', rate_hz: 1.6, mix: 0.5 },
          ],
        },
        {
          id: 'air',
          source: { type: 'noise', color: 'pink' },
          amp: env([[0, 0], [20, 0.2], [r0(T), 1], [r0(T + 60), 0]], 'linear'),
          gain_db: -5,
          fx: [{ type: 'filter', mode: 'bandpass', hz: env([[0, 400], [r0(T), r0(top * 0.8)]]), q: 2.5 }],
        },
        {
          id: 'sparks',
          source: { type: 'particles', kind: 'ping', rate_hz: env([[0, 3], [r0(T), 160]]), hz: [r0(1500 * k), r0(top)], decay_ms: [15, 120], spread: 1 },
          amp: env([[0, 0.2], [r0(T), 1], [r0(T + 60), 0]], 'linear'),
          gain_db: -12,
        },
        {
          id: 'pulse',
          source: { type: 'fm', hz: r1(55 * k), ratio: 1, index: { lfo: { hz: r1(lin(6, 14, p.brightness)), depth: 1.5 }, base: 2 } },
          amp: env([[0, 0], [r0(T), 1], [r0(T + 60), 0]], 'smooth'),
          gain_db: -16,
        },
      ];
    } else if (p.kind === 'shimmer' || p.kind === 'heal') {
      const heal = p.kind === 'heal';
      const chord = heal ? [0, 4, 7, 12] : [0, 7, 14, 19];
      ls = [
        ...chord.map(
          (semi, i): LayerInput => ({
            id: `tone${i + 1}`,
            start_ms: heal ? r0((i * T) / 8) : 0,
            source: { type: 'fm', hz: r1(523.25 * k * st(semi)), ratio: 2, index: { lfo: { hz: 0.7 + i * 0.3, depth: 0.5 }, base: 0.8 } },
            amp: env([[0, 0], [r0(T * 0.3), 1], [r0(T), 0]], 'smooth'),
            gain_db: -6 - i * 2,
            pan: (i % 2 ? 1 : -1) * 0.4,
            fx: [{ type: 'chorus', mix: 0.5 }],
          }),
        ),
        {
          id: 'glitter',
          source: { type: 'particles', kind: 'ping', rate_hz: env([[0, 60], [r0(T * 0.4), 90], [r0(T), 4]]), hz: [r0(2500 * k), r0(top)], decay_ms: [60, 500], spread: 1 },
          amp: env([[0, 0], [r0(T * 0.2), 1], [r0(T), 0]], 'smooth'),
          gain_db: -10,
        },
        {
          id: 'breath',
          source: { type: 'noise', color: 'pink' },
          amp: env([[0, 0], [r0(T * 0.4), 1], [r0(T), 0]], 'smooth'),
          gain_db: -18,
          fx: [{ type: 'filter', mode: 'bandpass', hz: env([[0, 1500], [r0(T * 0.5), 5000], [r0(T), 2500]]), q: 1.5 }],
        },
      ];
    } else {
      ls = [
        {
          id: 'whoosh',
          source: { type: 'noise', color: 'pink' },
          amp: env([[0, 0], [r0(T * 0.12), 1], [r0(T * 0.7), 0]]),
          pan: env([[0, -0.5], [r0(T * 0.7), 0.5]], 'smooth'),
          fx: [
            { type: 'filter', mode: 'bandpass', hz: env([[0, r0(top * 0.8)], [r0(T * 0.6), 350]]), q: 2.2 },
            { type: 'comb', hz: env([[0, r0(900 * k)], [r0(T * 0.6), r0(180 * k)]]), feedback: 0.75, mix: 0.4 },
          ],
        },
        {
          id: 'strike',
          source: { type: 'fm', hz: r1(392 * k), ratio: 2.76, index: env([[0, 6], [r0(T * 0.4), 0.3]]) },
          amp: env([[0, 0], [3, 1], [r0(T * 0.8), 0]]),
          gain_db: -5,
          fx: [{ type: 'chorus', mix: 0.35 }],
        },
        {
          id: 'sub',
          source: { type: 'osc', hz: env([[0, r0(180 * k)], [120, r0(60 * k)]]) },
          amp: env([[0, 0], [4, 1], [r0(T * 0.35), 0]]),
          gain_db: -7,
        },
        {
          id: 'trail',
          start_ms: 40,
          source: { type: 'particles', kind: 'ping', rate_hz: env([[0, 140], [r0(T), 3]]), hz: [r0(1800 * k), r0(top)], decay_ms: [30, 260], spread: 1 },
          amp: env([[0, 1], [r0(T), 0]], 'linear'),
          gain_db: -11,
        },
      ];
    }
    return {
      name: `magic_${p.kind}`,
      seed,
      layers: layers(...ls),
      master: {
        fx: [
          { type: 'eq', high_db: r1((p.brightness - 0.5) * 8 - 4 * p.darkness), low_db: r1(3 * p.darkness) },
          ...room(p.wetness, 0.75, 900 + 2600 * p.wetness),
          { type: 'limiter' },
        ],
        normalize: { lufs: -18 },
      },
    };
  },
});

export const energy = defineRecipe({
  name: 'energy',
  description: 'Sci-fi energy: laser shots, electric zaps, sustained beams, shield hits. Dense and modern, not chiptune.',
  params: z.strictObject({
    kind: choice(['laser', 'zap', 'beam', 'shield'], 'laser', 'Which energy effect.'),
    length_ms: num(60, 4000, 320, 'Approximate length.'),
    pitch_semitones: num(-24, 24, 0, 'Transpose the whole sound.'),
    power: unit(0.5, 'Heaviness. 0 = light blaster, 1 = cannon.'),
    brightness: brightness(0.6),
    wetness: wetness(0.2),
    distance_m: distance(),
  }),
  build: (p, seed) => {
    const T = p.kind === 'beam' ? Math.max(p.length_ms, 250) : p.length_ms;
    const k = st(p.pitch_semitones - 10 * p.power);
    let ls: (LayerInput | false)[];
    switch (p.kind) {
      case 'zap':
        ls = [
          {
            id: 'arc',
            source: { type: 'noise', color: 'crackle', density_hz: env([[0, 9000], [r0(T), 600]]) },
            amp: env([[0, 1], [r0(T * 0.3), 0.5], [r0(T), 0]]),
            fx: [
              { type: 'filter', mode: 'bandpass', hz: { random: { rate_hz: 45, depth: 1800 }, base: r0(3200 * k) }, q: 2.5 },
              { type: 'shaper', drive_db: 22, curve: 'hard' },
            ],
          },
          {
            id: 'buzz',
            source: { type: 'fm', hz: { random: { rate_hz: 60, depth: 60, smooth: false }, base: r0(140 * k) }, ratio: 7.3, index: env([[0, 9], [r0(T), 1]]), feedback: 0.5 },
            amp: env([[0, 1], [r0(T), 0]]),
            gain_db: -8,
            fx: [{ type: 'filter', mode: 'highpass', hz: 300 }],
          },
          tick('snap', 0, 5000, -4),
        ];
        break;
      case 'beam':
        ls = [
          {
            id: 'core',
            source: { type: 'osc', shape: 'saw', hz: r1(110 * k), unison: 7, detune_cents: 35 },
            amp: env([[0, 0], [40, 1], [r0(T - 60), 1], [r0(T), 0]], 'smooth'),
            fx: [
              { type: 'filter', mode: 'bandpass', hz: { lfo: { hz: 9, depth: 500 }, base: r0(lg(1200, 3000, p.brightness)) }, q: 3 },
              { type: 'shaper', drive_db: 14 },
            ],
          },
          {
            id: 'hum',
            source: { type: 'fm', hz: r1(55 * k), ratio: 1.5, index: { lfo: { hz: 23, depth: 1.5 }, base: 2.5 } },
            amp: env([[0, 0], [60, 1], [r0(T - 60), 1], [r0(T), 0]], 'smooth'),
            gain_db: -6,
          },
          {
            id: 'sizzle',
            source: { type: 'noise', color: 'white' },
            amp: env([[0, 0], [30, 1], [r0(T - 40), 1], [r0(T), 0]], 'smooth'),
            gain_db: -16,
            fx: [{ type: 'filter', mode: 'bandpass', hz: { random: { rate_hz: 14, depth: 2000 }, base: 7000 }, q: 2 }],
          },
        ];
        break;
      case 'shield':
        ls = [
          {
            id: 'ring',
            source: { type: 'fm', hz: r1(330 * k), ratio: 1.41, index: env([[0, 5], [r0(T), 0.4]]) },
            amp: env([[0, 0], [5, 1], [r0(T), 0]]),
            fx: [{ type: 'chorus', rate_hz: 2.5, depth_ms: 3, mix: 0.6 }],
          },
          {
            id: 'ripple',
            source: { type: 'noise', color: 'pink' },
            amp: env([[0, 1], [r0(T * 0.8), 0]]),
            gain_db: -6,
            fx: [{ type: 'comb', hz: env([[0, r0(1400 * k)], [r0(T * 0.8), r0(300 * k)]]), feedback: 0.9, mix: 0.8 }],
          },
          { id: 'thump', source: { type: 'osc', hz: env([[0, r0(160 * k)], [60, r0(60 * k)]]) }, amp: env([[0, 0], [3, 1], [160, 0]]), gain_db: -6 },
        ];
        break;
      default:
        ls = [
          {
            id: 'beam',
            source: { type: 'fm', hz: r1(1100 * k), pitch_semitones: env([[0, 12], [r0(T * 0.7), -22]]), ratio: 1.5, index: env([[0, 4], [r0(T), 0.5]]), feedback: 0.25 },
            amp: env([[0, 0], [2, 1], [r0(T), 0]]),
            fx: [
              { type: 'comb', hz: env([[0, r0(2200 * k)], [r0(T * 0.7), r0(350 * k)]]), feedback: 0.6, mix: 0.35 },
              { type: 'shaper', drive_db: r1(8 + 10 * p.power) },
            ],
          },
          {
            id: 'body',
            source: { type: 'osc', shape: 'saw', hz: r1(440 * k), pitch_semitones: env([[0, 7], [r0(T * 0.6), -19]]), unison: 5, detune_cents: 28 },
            amp: env([[0, 0], [3, 1], [r0(T * 0.9), 0]]),
            gain_db: -7,
            fx: [{ type: 'filter', hz: env([[0, r0(lg(5000, 12000, p.brightness))], [r0(T * 0.8), 500]]), q: 1.8 }],
          },
          {
            id: 'blast',
            source: { type: 'noise', color: 'white' },
            amp: env([[0, 1], [r0(40 + 60 * p.power), 0]]),
            gain_db: -6,
            fx: [{ type: 'filter', mode: 'bandpass', hz: env([[0, 6000], [r0(40 + 60 * p.power), 1200]]), q: 0.9 }],
          },
          p.power > 0.05 && {
            id: 'kick',
            source: { type: 'osc', hz: env([[0, r0(lg(260, 160, p.power))], [50, r0(lg(90, 45, p.power))]]) },
            amp: env([[0, 0], [2, 1], [r0(90 + 200 * p.power), 0]]),
            gain_db: r1(-16 + 14 * p.power),
            fx: [{ type: 'shaper', drive_db: 8 }],
          },
        ];
    }
    return {
      name: `energy_${p.kind}`,
      seed,
      layers: layers(...ls),
      master: {
        fx: [
          { type: 'compressor', threshold_db: -14, ratio: 3, attack_ms: 10, release_ms: 120 },
          { type: 'eq', high_db: r1((p.brightness - 0.5) * 8) },
          ...far(p.distance_m),
          ...room(p.wetness, 0.45, 350 + 1200 * p.wetness),
          { type: 'limiter' },
        ],
        normalize: { lufs: p.kind === 'shield' ? -18 : -16 },
      },
    };
  },
});
