import { z } from 'zod';
import { MATERIALS } from '../schema/index.js';
import { brightness, choice, defineRecipe, distance, env, far, layers, lg, lin, num, r0, r1, room, unit, wetness } from './common.js';

const RINGING = new Set(['metal', 'glass', 'ceramic', 'bell']);

export const impact = defineRecipe({
  name: 'impact',
  description: 'One object hitting another: knocks, thuds, clanks, clinks, punches, drops.',
  params: z.strictObject({
    material: choice(MATERIALS, 'wood', 'What the struck object is made of.'),
    size: unit(0.5, 'Object size. 0 = small trinket, 1 = huge.'),
    hardness: unit(0.6, 'Hardness of the hit. 0 = soft/padded, 1 = hard and sharp.'),
    weight: unit(0.4, 'Low-end thump under the hit. 0 = none, 1 = heavy.'),
    rattle: unit(0, 'Loose bits that scatter or buzz after the hit.'),
    damping: unit(0.1, 'How muted the object is. 0 rings freely, 1 is held or stuffed.'),
    brightness: brightness(),
    wetness: wetness(0.2),
    distance_m: distance(),
  }),
  build: (p, seed) => {
    const sub = lg(150, 42, p.size);
    const ring = RINGING.has(p.material);
    return {
      name: `impact_${p.material}`,
      seed,
      layers: layers(
        {
          id: 'body',
          source: { type: 'modal', material: p.material, size: p.size, damping: p.damping, mode_count: 32, strike: { hardness: p.hardness, position: 0.28 } },
          fx: [{ type: 'eq', high_db: r1((p.brightness - 0.5) * 14), low_db: r1(p.weight * 3) }],
        },
        {
          id: 'contact',
          source: { type: 'noise', color: 'white' },
          amp: env([[0, 1], [r1(3 + (1 - p.hardness) * 16), 0]]),
          gain_db: r1(-7 + p.hardness * 5),
          fx: [{ type: 'filter', mode: 'bandpass', hz: r0(lg(1200, 7000, 0.5 * p.hardness + 0.5 * p.brightness) * lg(1.5, 0.6, p.size)), q: 0.7 }],
        },
        p.weight > 0.02 && {
          id: 'thump',
          source: { type: 'osc', shape: 'sine', hz: env([[0, r0(sub * 2.4)], [30, r0(sub)]]) },
          amp: env([[0, 0], [2, 1], [r0(70 + p.size * 220), 0]]),
          gain_db: r1(-28 + p.weight * 20),
          fx: [{ type: 'shaper', drive_db: 6 }],
        },
        p.rattle > 0.02 && {
          id: 'rattle',
          start_ms: 25,
          source: {
            type: 'particles',
            kind: ring ? 'ping' : 'burst',
            rate_hz: env([[0, r0(20 + 220 * p.rattle)], [r0(150 + 500 * p.rattle), 1]]),
            hz: ring ? [r0(lg(4000, 900, p.size)), r0(lg(12000, 5000, p.size))] : [r0(lg(1500, 300, p.size)), r0(lg(7000, 2500, p.size))],
            decay_ms: ring ? [20, 180] : [3, 35],
          },
          amp: env([[0, 1], [r0(200 + 700 * p.rattle), 0]]),
          gain_db: -14,
        },
      ),
      master: {
        fx: [
          { type: 'transient', attack_db: r1(2 + p.hardness * 5) },
          { type: 'shaper', drive_db: 4, mix: 0.5 },
          ...far(p.distance_m),
          ...room(p.wetness, r1(0.15 + 0.35 * p.size), 220 + 700 * p.wetness),
          { type: 'limiter' },
        ],
        normalize: { lufs: p.material === 'metal' || p.material === 'bell' || p.material === 'glass' ? -16 : -18 },
      },
    };
  },
});

export const whoosh = defineRecipe({
  name: 'whoosh',
  description: 'Air movement: swings, swipes, fly-bys, transitions, fast objects passing.',
  params: z.strictObject({
    length_ms: num(80, 4000, 450, 'Total length.'),
    peak: num(0.2, 0.9, 0.55, 'Where the loudest point falls. 0.2 = fast start, 0.9 = slow build with a sharp end.'),
    speed: unit(0.5, 'How fast the object feels: higher sweeps further and sounds tighter.'),
    tonal: unit(0.15, 'Adds a pitched, hollow ring (blade, pipe, engine). 0 = pure air.'),
    pan_sweep: unit(0.6, 'How far it travels left to right.'),
    brightness: brightness(),
    wetness: wetness(0.15),
    distance_m: distance(),
  }),
  build: (p, seed) => {
    const T = p.length_ms;
    const pk = r0(T * p.peak);
    const lo = lg(250, 500, p.brightness);
    const hi = lg(1200, 6500, 0.5 * p.speed + 0.5 * p.brightness);
    const shape = env([[0, 0], [pk, 1], [r0(T), 0]], 'smooth');
    const pan = p.pan_sweep > 0.02 ? env([[0, -r1(p.pan_sweep)], [r0(T), r1(p.pan_sweep)]], 'smooth') : 0;
    return {
      name: 'whoosh',
      seed,
      layers: layers(
        {
          id: 'air',
          source: { type: 'noise', color: 'pink' },
          amp: shape,
          pan,
          fx: [
            { type: 'filter', mode: 'bandpass', hz: env([[0, r0(lo)], [pk, r0(hi)], [r0(T), r0(lo * 1.3)]]), q: r1(lin(0.9, 2.6, p.speed)), slope: 12 },
            ...(p.tonal > 0.02
              ? [{ type: 'comb' as const, hz: env([[0, r0(lo * 0.6)], [pk, r0(hi * 0.35)], [r0(T), r0(lo * 0.5)]]), feedback: r1(0.5 + 0.4 * p.tonal), mix: r1(p.tonal) }]
              : []),
          ],
        },
        {
          id: 'hiss',
          source: { type: 'noise', color: 'white' },
          amp: env([[r0(T * 0.15), 0], [pk, 1], [r0(Math.min(T, pk + T * 0.3)), 0]], 'smooth'),
          gain_db: r1(-20 + p.brightness * 12),
          pan,
          fx: [{ type: 'filter', mode: 'highpass', hz: env([[0, 2500], [pk, r0(lg(4000, 9000, p.speed))], [r0(T), 3000]]), q: 0.8 }],
        },
        {
          id: 'body',
          source: { type: 'noise', color: 'brown' },
          amp: shape,
          gain_db: -7,
          fx: [{ type: 'filter', mode: 'lowpass', hz: env([[0, 150], [pk, r0(lg(350, 900, p.speed))], [r0(T), 120]]), q: 1.1 }],
        },
      ),
      master: {
        fx: [...far(p.distance_m), ...room(p.wetness, 0.4, 500 + 900 * p.wetness), { type: 'limiter' }],
        normalize: { lufs: -18 },
      },
    };
  },
});

export const explosion = defineRecipe({
  name: 'explosion',
  description: 'Blasts from a small pop or grenade to a huge detonation, with optional falling debris.',
  params: z.strictObject({
    size: unit(0.5, 'Blast size. 0 = firecracker, 1 = building-sized.'),
    debris: unit(0.4, 'Rubble and fragments falling afterwards.'),
    crack: unit(0.6, 'Sharpness of the initial crack.'),
    brightness: brightness(),
    wetness: wetness(0.35),
    distance_m: distance(),
  }),
  build: (p, seed) => {
    const T = 700 + 2800 * p.size;
    // No pitched sweeps: a swept sine under a noise burst is a kick drum, and a clipped
    // white-noise crack on its own is a gunshot. A blast is turbulent broadband noise whose
    // highs die first, rolling on as uneven low rumble.
    const turbulence = (rate: number, depth: number) => ({ type: 'gain' as const, db: { random: { rate_hz: rate, depth }, base: 0 } });
    return {
      name: 'explosion',
      seed,
      layers: layers(
        {
          id: 'crack',
          source: { type: 'noise', color: 'white' },
          amp: env([[0, 0], [0.5, 1], [6, 0.35], [r0(50 + 70 * p.size), 0]]),
          gain_db: r1(-12 + p.crack * 8),
          fx: [
            { type: 'filter', mode: 'highpass', hz: r0(lg(300, 1000, p.brightness)), q: 0.6 },
            { type: 'shaper', drive_db: 8 },
          ],
        },
        {
          id: 'blast',
          source: { type: 'noise', color: 'pink' },
          amp: env([[0, 0], [3, 1], [r0(T * 0.12), 0.6], [r0(T * 0.55), 0]]),
          gain_db: 5,
          fx: [
            { type: 'filter', mode: 'lowpass', hz: env([[0, r0(lg(7000, 14000, p.brightness))], [r0(T * 0.15), 3000], [r0(T * 0.5), 400]]), q: 0.6, slope: 24 },
            turbulence(40, 5),
            { type: 'shaper', drive_db: 12 },
          ],
        },
        {
          id: 'body',
          source: { type: 'noise', color: 'brown' },
          amp: env([[0, 0], [6, 1], [r0(T * 0.25), 0.7], [r0(T * 0.75), 0]]),
          gain_db: r1(-6 + p.size * 4),
          fx: [
            { type: 'filter', mode: 'lowpass', hz: env([[0, r0(lg(500, 260, p.size))], [r0(T * 0.6), 80]]), q: 0.8, slope: 24 },
            turbulence(12, 6),
            { type: 'shaper', drive_db: 14 },
          ],
        },
        {
          id: 'rumble',
          start_ms: r0(T * 0.08),
          source: { type: 'noise', color: 'brown' },
          amp: env([[0, 0], [r0(T * 0.15), 1], [r0(T * 0.5), 0.55], [r0(T * 0.92), 0]], 'smooth'),
          gain_db: -8,
          fx: [
            { type: 'filter', mode: 'lowpass', hz: { random: { rate_hz: 3, depth: 60 }, base: r0(lg(220, 130, p.size)) }, q: 0.9 },
            turbulence(5, 8),
            { type: 'shaper', drive_db: 10 },
          ],
        },
        p.debris > 0.02 && {
          id: 'debris',
          start_ms: r0(60 + 80 * p.size),
          source: {
            type: 'particles',
            kind: 'burst',
            rate_hz: env([[0, 2], [r0(180 + 200 * p.size), r0(40 + 220 * p.debris)], [r0(T * 0.9), 1]]),
            hz: [r0(lg(500, 200, p.size)), r0(lg(7000, 4000, p.size))],
            decay_ms: [2, r0(20 + 30 * p.size)],
            gain_jitter_db: 18,
            q: 0.8,
            spread: 0.9,
          },
          amp: env([[0, 1], [r0(T * 0.9), 0]], 'linear'),
          gain_db: r1(-10 + p.debris * 8),
        },
      ),
      master: {
        fx: [
          { type: 'compressor', threshold_db: -16, ratio: 4, attack_ms: 8, release_ms: 200 },
          { type: 'shaper', drive_db: 5, mix: 0.6 },
          ...far(p.distance_m),
          ...room(p.wetness, r1(0.5 + 0.4 * p.size), 900 + 2200 * p.wetness),
          { type: 'limiter' },
        ],
        normalize: { lufs: -14 },
      },
    };
  },
});

const SURFACES = ['concrete', 'wood', 'gravel', 'grass', 'metal', 'snow', 'dirt'] as const;

export const footstep = defineRecipe({
  name: 'footstep',
  description: 'A single footstep. Use `vary` to make a set so repeats do not sound identical.',
  params: z.strictObject({
    surface: choice(SURFACES, 'concrete', 'What is being walked on.'),
    weight: unit(0.5, 'Heaviness of the walker. 0 = light sneaker, 1 = heavy boot.'),
    scuff: unit(0.4, 'Amount of sole scrape between heel and toe.'),
    brightness: brightness(),
    wetness: wetness(0.12),
    distance_m: distance(),
  }),
  build: (p, seed) => {
    const toe = r0(55 + 60 * p.weight);
    const heelMat = { concrete: 'stone', wood: 'wood', gravel: 'stone', grass: 'hollow', metal: 'metal', snow: 'hollow', dirt: 'hollow' } as const;
    const loose = p.surface === 'gravel' || p.surface === 'snow' || p.surface === 'grass' || p.surface === 'dirt';
    // Stones knocking together are short and broadband (low q, a few ms); resonant bursts that
    // ring for 10-20 ms are water droplets and make gravel sound wet.
    const grain = {
      gravel: { hz: [600, 5000], decay: [1, 6], rate: 380, kind: 'burst', gain: 2, q: 0.8 },
      snow: { hz: [700, 3500], decay: [6, 40], rate: 420, kind: 'burst', gain: 1, q: 1.5 },
      grass: { hz: [3000, 11000], decay: [4, 30], rate: 200, kind: 'burst', gain: -4, q: 3 },
      dirt: { hz: [500, 4000], decay: [1, 8], rate: 150, kind: 'burst', gain: -3, q: 1 },
    } as const;
    const g = loose ? grain[p.surface as keyof typeof grain] : undefined;
    return {
      name: `footstep_${p.surface}`,
      seed,
      layers: layers(
        {
          id: 'heel',
          source: {
            type: 'modal',
            material: heelMat[p.surface],
            size: r1(0.45 + 0.4 * p.weight),
            damping: p.surface === 'metal' ? 0.55 : 0.5,
            strike: { hardness: r1(loose ? 0.3 : 0.6 + 0.3 * p.brightness), position: 0.3 },
          },
          gain_db: loose ? -10 : 0,
        },
        {
          // Filtered noise, not a swept sine: a sine dropping in pitch under a hit is a kick drum.
          id: 'thud',
          source: { type: 'noise', color: 'brown' },
          amp: env([[0, 0], [1, 1], [r0(30 + 40 * p.weight), 0]]),
          gain_db: r1(-14 + 10 * p.weight),
          fx: [{ type: 'filter', mode: 'lowpass', hz: r0(lg(500, 220, p.weight)), q: 0.7 }],
        },
        !loose && {
          // Grit between sole and floor.
          id: 'grit',
          source: { type: 'particles', kind: 'click', rate_hz: env([[0, 600], [8, 120], [r0(toe), 30], [r0(toe + 6), 400], [r0(toe + 40), 1]]), hz: [2500, 9000], decay_ms: [0.3, 1.5], gain_jitter_db: 18, spread: 0.2 },
          amp: env([[0, 1], [r0(toe + 50), 0]], 'linear'),
          gain_db: -20,
        },
        {
          id: 'toe',
          start_ms: toe,
          source: { type: 'noise', color: 'pink' },
          amp: env([[0, 1], [r0(18 + 20 * p.weight), 0]]),
          gain_db: -11,
          fx: [{ type: 'filter', mode: 'bandpass', hz: r0(lg(900, 3200, p.brightness)), q: 0.7 }],
        },
        p.scuff > 0.02 && {
          id: 'scuff',
          start_ms: 8,
          source: { type: 'noise', color: 'pink' },
          amp: env([[0, 0], [r0(toe * 0.5), 1], [r0(toe + 40), 0]], 'smooth'),
          gain_db: r1(-24 + 14 * p.scuff),
          fx: [{ type: 'filter', mode: 'bandpass', hz: { random: { rate_hz: 30, depth: 800 }, base: r0(lg(1800, 4500, p.brightness)) }, q: 1.4 }],
        },
        g && {
          id: 'grain',
          source: {
            type: 'particles',
            kind: g.kind,
            rate_hz: env([[0, g.rate], [r0(toe), r0(g.rate * 0.35)], [r0(toe + 10), g.rate], [r0(toe + 120), 2]]),
            hz: [g.hz[0], g.hz[1]],
            decay_ms: [g.decay[0], g.decay[1]],
            gain_jitter_db: 16,
            q: g.q,
            spread: 0.35,
          },
          amp: env([[0, 1], [r0(toe + 130), 0]], 'linear'),
          gain_db: g.gain,
        },
        p.surface === 'gravel' && {
          id: 'stones',
          source: { type: 'particles', kind: 'burst', rate_hz: env([[0, 90], [r0(toe), 20], [r0(toe + 10), 90], [r0(toe + 100), 1]]), hz: [250, 1400], decay_ms: [2, 8], q: 1, gain_jitter_db: 14, spread: 0.3 },
          amp: env([[0, 1], [r0(toe + 110), 0]], 'linear'),
          gain_db: 0,
        },
      ),
      master: {
        fx: [
          { type: 'eq', high_db: r1((p.brightness - 0.5) * 8) },
          ...far(p.distance_m),
          ...room(p.wetness, 0.25, 250 + 600 * p.wetness),
          { type: 'limiter' },
        ],
        normalize: { lufs: loose ? -20 : -26 },
      },
    };
  },
});
