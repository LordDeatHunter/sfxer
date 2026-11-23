import { z } from 'zod';
import type { LayerInput, ParamInput } from '../schema/index.js';
import { brightness, choice, defineRecipe, distance, env, far, layers, lg, lin, num, r0, r1, r2, room, unit, wetness } from './common.js';

/*
 * Wet sounds, broken down from CC0 reference recordings (squelches, slime, gore hits, bubbles)
 * and tuned against the judge across several seeds:
 * - the wet core (see `wet`): a jittering pink-noise band with fast irregular level flutter, a
 *   dense film of tiny high `bubble` particles and some mid gloops, all under a swell.
 * - liquid = `bubble` particles: a sine blip whose pitch rises fast then settles (Minnaert).
 *   Thicker liquid = lower bubbles and squelch bands, more clustered.
 * - splatter = a dense spray of tiny bright noise flecks right after contact, thinning out.
 * - meat = low-passed brown noise for weight plus a short slap, never a swept sine (kick drum).
 * - bone = a few distinct snaps (crack + fibre crackle + small damped wooden body) at uneven gaps.
 * Pitfalls found on the way: loud tonal bubbles read as "magic spell", a steady dense click or
 * crackle stream reads as "electric zap", a narrow smooth noise band reads as a whoosh, and an
 * instant attack on a squish reads as a punch.
 */

const KINDS = ['squish', 'splat', 'squelch', 'slime', 'stab', 'crunch', 'gib', 'drip'] as const;

type Range = [number, number];
type Mod = Exclude<ParamInput, undefined>;

function bubbleLayer(id: string, start: number, T: number, rate: Mod, hz: Range, decay: Range, chirp: number, gainDb: number, spread = 0.5): LayerInput {
  return {
    id,
    start_ms: r0(start),
    source: { type: 'particles', kind: 'bubble', rate_hz: rate, hz: [r0(hz[0]), r0(hz[1])], decay_ms: decay, chirp_semitones: r1(chirp), gain_jitter_db: 12, spread },
    amp: env([[0, 1], [r0(T * 0.6), 0.6], [r0(T * 0.9), 0.08], [r0(T), 0]], 'linear'),
    gain_db: r1(gainDb),
  };
}

/**
 * The crinkle of liquid films tearing and popping: clumps of tiny broadband bursts. In recordings
 * this, not low gloops, is most of what makes something sound wet (AudioSet hears real squelches as
 * "crunch", "tearing", "crumpling"). Tonal bubbles here read as magic; a steady stream reads as electricity.
 */
function film(id: string, start: number, T: number, rate: Mod, lo: number, hi: number, gainDb: number, shape: [number, number][] = [[0, 1], [0.6, 0.8], [1, 0]]): LayerInput {
  return {
    id,
    start_ms: r0(start),
    source: { type: 'particles', kind: 'burst', rate_hz: rate, hz: [r0(lo), r0(hi)], decay_ms: [0.5, 3], q: 0.8, gain_jitter_db: 18, spread: 0.7 },
    amp: env(shape.map(([t, a]) => [r0(T * t), a] as [number, number]), 'smooth'),
    gain_db: r1(gainDb),
  };
}

interface WetOpts {
  centre: number; // squelch band centre, Hz
  film: number; // tiny high bubbles per second
  gloop: number; // mid bubbles per second
  gloopHz: Range;
  chirp: number;
  gloopDb?: number;
  gloopDecay?: Range;
  shape?: [number, number][]; // amp envelope as [fraction of T, level]
}

/**
 * The wet core, found by A/B-ing variants against the judge and the reference recordings. Three
 * parts under one swell (squishes swell in; an instant attack reads as a punch):
 * - a pink-noise band whose centre jitters (~28 Hz) and whose level flutters fast and irregularly
 *   (~70 Hz): liquid and air forced through a gap. Without the flutter it is a whoosh.
 * - a dense film of tiny high bubbles: the bright wet crackle.
 * - mid-range gloops: rising bubbles that say "liquid" (on their own they read as magic).
 */
function wet(prefix: string, start: number, T: number, o: WetOpts, gainDb = 0): LayerInput[] {
  const shape = [...(o.shape ?? [[0, 0], [0.3, 1], [0.7, 0.3], [1, 0]])];
  // Taper into the end so long shapes fade out instead of dropping from half level.
  const prev = shape[shape.length - 2];
  if (prev && prev[0] < 0.88) shape.splice(shape.length - 1, 0, [0.9, r2(prev[1] * 0.15)]);
  const amp = env(shape.map(([t, a]) => [r0(T * t), a] as [number, number]), 'smooth');
  return [
    {
      id: `${prefix}squelch`,
      start_ms: r0(start),
      source: { type: 'noise', color: 'pink' },
      amp,
      gain_db: r1(gainDb),
      fx: [
        { type: 'filter', mode: 'bandpass', hz: { random: { rate_hz: 28, depth: r0(o.centre * 0.55) }, base: r0(o.centre) }, q: 1.8 },
        { type: 'gain', db: { random: { rate_hz: 70, depth: 9 }, base: 0 } },
      ],
    },
    {
      id: `${prefix}film`,
      start_ms: r0(start),
      source: { type: 'particles', kind: 'bubble', rate_hz: { random: { rate_hz: 9, depth: r0(o.film) }, base: r0(o.film) }, hz: [r0(o.centre * 0.75), r0(o.centre * 4.5)], decay_ms: [0.8, 4], chirp_semitones: 5, gain_jitter_db: 18, spread: 0.7 },
      amp,
      gain_db: r1(gainDb - 2),
    },
    {
      id: `${prefix}gloop`,
      start_ms: r0(start),
      source: { type: 'particles', kind: 'bubble', rate_hz: { random: { rate_hz: 5, depth: r0(o.gloop * 1.2) }, base: r0(o.gloop) }, hz: [r0(o.gloopHz[0]), r0(o.gloopHz[1])], decay_ms: o.gloopDecay ?? [8, 30], chirp_semitones: r1(o.chirp), gain_jitter_db: 12, spread: 0.5 },
      amp,
      gain_db: r1(gainDb + (o.gloopDb ?? 0)),
    },
  ];
}

/** Goo pulling apart: a short sticky tick and one quick rising blip as the strand snaps. */
function peel(id: string, start: number, hz: number, gainDb: number): LayerInput[] {
  return [
    {
      id: `${id}_tick`,
      start_ms: r0(start),
      source: { type: 'noise', color: 'white' },
      amp: env([[0, 1], [6, 0]]),
      gain_db: r1(gainDb - 4),
      fx: [{ type: 'filter', mode: 'bandpass', hz: r0(hz * 3), q: 1.2 }],
    },
    {
      id: `${id}_snap`,
      start_ms: r0(start + 2),
      source: { type: 'osc', hz: env([[0, r0(hz)], [12, r0(hz * 1.5)], [35, r0(hz * 1.7)]]) },
      amp: env([[0, 0], [2, 1], [35, 0]]),
      gain_db: r1(gainDb),
    },
  ];
}

/** Narrow, jittering band of noise: the sound of goo being squeezed. */
function squelch(id: string, start: number, T: number, centre: number, q: number, jitterHz: number, gainDb: number): LayerInput {
  return {
    id,
    start_ms: r0(start),
    source: { type: 'noise', color: 'pink' },
    amp: env([[0, 0], [r0(Math.min(30, T * 0.15)), 1], [r0(T * 0.55), 0.6], [r0(T), 0]], 'smooth'),
    gain_db: r1(gainDb),
    fx: [
      { type: 'filter', mode: 'bandpass', hz: { random: { rate_hz: r1(jitterHz), depth: r0(centre * 0.55) }, base: r0(centre) }, q: r1(q) },
      { type: 'gain', db: { random: { rate_hz: r1(jitterHz * 1.6), depth: 9 }, base: 0 } },
    ],
  };
}

/**
 * One squeeze: a resonant band of noise that swells in (soft material compressing), glides up as
 * the gap opens and settles back. Squishes are swells, not hits: an instant attack reads as a punch.
 */
function squeeze(id: string, start: number, T: number, centre: number, q: number, gainDb: number, peak = 0.35): LayerInput {
  const pk = r0(T * peak);
  return {
    id,
    start_ms: r0(start),
    source: { type: 'noise', color: 'white' },
    amp: env([[0, 0], [pk, 1], [r0(T * 0.7), 0.3], [r0(T), 0]], 'smooth'),
    gain_db: r1(gainDb),
    fx: [
      { type: 'filter', mode: 'bandpass', hz: env([[0, r0(centre * 0.6)], [pk, r0(centre)], [r0(T), r0(centre * 0.75)]], 'smooth'), q: r1(q) },
      { type: 'gain', db: { random: { rate_hz: 11, depth: 5 }, base: 0 } },
    ],
  };
}

/** One bone snap: a sharp broadband crack over a small, heavily damped woody body. */
function snap(id: string, start: number, size: number, gainDb: number, hz: number): LayerInput[] {
  return [
    {
      id: `${id}_crack`,
      start_ms: r0(start),
      source: { type: 'noise', color: 'white' },
      amp: env([[0, 1], [2, 0.5], [r0(6 + 6 * size), 0]]),
      gain_db: r1(gainDb),
      fx: [{ type: 'filter', mode: 'bandpass', hz: r0(hz), q: 0.9 }],
    },
    {
      // Fibres giving way: a short dense cluster of cracks right after the snap.
      id: `${id}_fibres`,
      start_ms: r0(start),
      source: { type: 'particles', kind: 'burst', rate_hz: 700, hz: [900, 7000], decay_ms: [0.5, 3], q: 0.8, gain_jitter_db: 16, spread: 0.3 },
      amp: env([[0, 1], [r0(15 + 25 * size), 0]], 'linear'),
      gain_db: r1(gainDb - 4),
    },
    {
      id: `${id}_body`,
      start_ms: r0(start),
      source: { type: 'modal', material: 'wood', size: r2(0.12 + 0.25 * size), damping: 0.7, strike: { hardness: 1, position: 0.3 } },
      gain_db: r1(gainDb - 3),
    },
  ];
}

/** Dense spray of tiny bright flecks right after contact. */
function splatter(id: string, start: number, T: number, density: number, top: number, gainDb: number): LayerInput {
  return {
    id,
    start_ms: r0(start),
    source: {
      type: 'particles',
      kind: 'burst',
      rate_hz: env([[0, r0(400 + 1800 * density)], [r0(T * 0.25), r0(80 + 300 * density)], [r0(T), 2]]),
      hz: [1200, r0(top)],
      decay_ms: [1, 9],
      q: 1.6,
      gain_jitter_db: 18,
      spread: 0.8,
    },
    amp: env([[0, 1], [r0(T), 0]], 'linear'),
    gain_db: r1(gainDb),
  };
}

/** Meaty low weight: low-passed brown noise, lightly saturated. */
function thump(id: string, start: number, lenMs: number, hz: number, gainDb: number): LayerInput {
  return {
    id,
    start_ms: r0(start),
    source: { type: 'noise', color: 'brown' },
    amp: env([[0, 0], [2, 1], [r0(lenMs * 0.35), 0.5], [r0(lenMs), 0]]),
    gain_db: r1(gainDb),
    fx: [{ type: 'filter', mode: 'lowpass', hz: env([[0, r0(hz * 2.2)], [r0(lenMs), r0(hz * 0.7)]]), q: 0.9 }, { type: 'shaper', drive_db: 9 }],
  };
}

/** Short broadband slap of wet contact. */
function slap(id: string, start: number, lenMs: number, hz: number, gainDb: number): LayerInput {
  return {
    id,
    start_ms: r0(start),
    source: { type: 'noise', color: 'white' },
    amp: env([[0, 1], [r0(lenMs * 0.3), 0.4], [r0(lenMs), 0]]),
    gain_db: r1(gainDb),
    fx: [{ type: 'filter', mode: 'bandpass', hz: env([[0, r0(hz)], [r0(lenMs), r0(hz * 0.5)]]), q: 0.8 }],
  };
}

/** Bone and gristle snapping. */
function bone(prefix: string, start: number, T: number, amount: number, gainDb: number): LayerInput[] {
  return [
    {
      // A handful of distinct snaps, not a steady stream: dense even clicking reads as electricity.
      id: `${prefix}cracks`,
      start_ms: r0(start),
      source: {
        type: 'particles',
        kind: 'burst',
        rate_hz: env([[0, r0(60 + 80 * amount)], [r0(T * 0.5), r0(20 + 30 * amount)], [r0(T), 3]]),
        hz: [700, 5000],
        decay_ms: [2, 10],
        q: 0.9,
        gain_jitter_db: 14,
        spread: 0.3,
      },
      amp: env([[0, 1], [r0(T * 0.6), 0.6], [r0(T), 0]]),
      gain_db: r1(gainDb),
    },
    {
      id: `${prefix}splinters`,
      start_ms: r0(start),
      source: { type: 'particles', kind: 'click', rate_hz: env([[0, r0(150 + 250 * amount)], [r0(T), 5]]), hz: [2000, 8000], decay_ms: [0.3, 1.5], gain_jitter_db: 18, spread: 0.4 },
      amp: env([[0, 1], [r0(T), 0]], 'linear'),
      gain_db: r1(gainDb - 8),
    },
    {
      id: `${prefix}bone`,
      start_ms: r0(start),
      source: { type: 'modal', material: 'wood', size: 0.12, damping: 0.75, strike: { hardness: 0.9, position: 0.3 } },
      gain_db: r1(gainDb - 4),
    },
  ];
}

export const gore = defineRecipe({
  name: 'gore',
  description: 'Wet, squishy and gory sounds: squishes, splats, squelches, slime, stabs, bone crunches, gibs and drips.',
  params: z.strictObject({
    kind: choice(
      KINDS,
      'splat',
      'squish = squeezing something soft; splat = a wet lump hitting a surface; squelch = a longer wet churn; slime = thick bubbling goo moving; stab = a blade going into flesh; crunch = bone breaking; gib = a body bursting apart; drip = a single drop.',
    ),
    size: unit(0.5, 'How much material. 0 = small (a finger in jelly), 1 = huge (a body bursting).'),
    viscosity: unit(0.5, 'How thick the liquid is. 0 = thin and watery (blood, juice), 1 = thick gloop (slime, mud).'),
    weight: unit(0.5, 'Low-end meat under hits. 0 = none, 1 = heavy.'),
    crunch: unit(0.2, 'Bone and gristle cracking mixed in (crunch and gib always have some).'),
    brightness: brightness(),
    wetness: wetness(0.12),
    distance_m: distance(),
  }),
  build: (p, seed) => {
    const v = p.viscosity;
    const s = p.size;
    // Bigger blobs and thicker liquid make lower bubbles and squelches.
    const fh = lg(1.5, 0.55, v) * lg(1.3, 0.7, s);
    // Wet crackle and squelch bands sit high; thick goo pulls them down a little.
    const fw = lg(1.2, 0.7, v);
    const bubDecay: Range = [r1(lg(10, 5, v)), r1(lg(45, 20, v))];
    const chirp = lg(5, 10, v);
    const top = lg(5000, 10000, p.brightness);
    const low = lg(320, 140, s);
    // Thick goo comes in clumps: modulate bubble density rather than a steady stream.
    const clumpy = (base: number, rate = 7): Mod => ({ random: { rate_hz: rate, depth: r0(base * (1 + 0.6 * v)) }, base: r0(base) });
    const crunch = p.crunch > 0.02;
    const soft = p.kind === 'squish' || p.kind === 'squelch' || p.kind === 'slime' || p.kind === 'crunch';

    let ls: LayerInput[];
    let lufs = -18;
    switch (p.kind) {
      case 'squish': {
        const T = lg(250, 600, s);
        lufs = -20;
        ls = layers(
          ...wet('', 0, T, { centre: 2000 * fw, film: lg(250, 400, s), gloop: lg(40, 70, s), gloopHz: [400 * fh, 1600 * fh], chirp }),
          p.weight > 0.02 && squeeze('body', 0, T * 0.6, low * 1.4, 1, -24 + 10 * p.weight),
          ...(crunch ? bone('', T * 0.2, T * 0.5, p.crunch, -12 + 8 * p.crunch) : []),
        );
        break;
      }
      case 'splat': {
        const T = lg(350, 1000, s);
        ls = layers(
          slap('slap', 0, lg(25, 60, s), lg(2500, 5000, p.brightness), -2),
          thump('meat', 0, lg(90, 260, s), low, -16 + 14 * p.weight),
          splatter('spray', 2, T * 0.7, 0.6 + 0.4 * s, top, -2),
          film('wet', 0, T, env([[0, r0(lg(1200, 2000, s))], [r0(T * 0.3), 250], [r0(T), 20]]), 1500 * fw, 12000 * fw, -3),
          squelch('squish', 8, lg(140, 320, s), 2000 * fw, 1.8, 30, -6),
          bubbleLayer('drips', 30, T, env([[0, r0(lg(40, 100, s))], [r0(T * 0.4), 15], [r0(T), 2]]), [500 * fh, 2400 * fh], bubDecay, chirp, -14, 0.8),
          ...(crunch ? bone('', 2, lg(60, 160, s), p.crunch, -10 + 8 * p.crunch) : []),
        );
        break;
      }
      case 'squelch': {
        const T = lg(500, 1400, s);
        // Several pushes in a row: churning rather than one squeeze.
        ls = layers(
          ...wet('', 0, T, { centre: 1800 * fw, film: lg(250, 400, s), gloop: lg(40, 80, s), gloopHz: [350 * fh, 1600 * fh], chirp, shape: [[0, 0], [0.12, 1], [0.3, 0.45], [0.45, 0.9], [0.62, 0.35], [0.78, 0.75], [1, 0]] }),
          p.weight > 0.02 && squeeze('body', 0, T * 0.5, low * 1.4, 1, -24 + 10 * p.weight),
        );
        break;
      }
      case 'slime': {
        lufs = -20;
        // Slime is handled, not boiled: separate gooey pushes with gaps between them, each ending
        // in a sticky peel as the goo pulls apart. A continuous bed of bubbles reads as boiling
        // liquid or a magic spell, so gloops are kept sparse and quiet.
        const pushes: [number, number, number][] = [
          [0, 1, 0],
          [1.25, 0.8, -3],
          [2.2, 1.15, -1],
          [3.4, 0.9, -4],
        ];
        const len = lg(280, 480, s);
        ls = layers(
          ...pushes.slice(0, s < 0.3 ? 2 : s < 0.7 ? 3 : 4).flatMap(([at, k, g], i) => [
            ...wet(`p${i + 1}_`, at * len, len, { centre: 1500 * fw * k, film: lg(180, 300, s), gloop: 8, gloopHz: [250 * fh, 1000 * fh], chirp, gloopDb: -10, shape: [[0, 0], [0.35, 1], [0.75, 0.4], [1, 0]] }, g),
            ...peel(`p${i + 1}_peel`, at * len + len * 0.8, lg(900, 500, v) * k, g - 14),
          ]),
        );
        break;
      }
      case 'stab': {
        const T = lg(300, 700, s);
        ls = layers(
          {
            id: 'pierce',
            source: { type: 'noise', color: 'white' },
            amp: env([[0, 0], [2, 1], [12, 0.3], [35, 0]]),
            gain_db: -6,
            fx: [{ type: 'filter', mode: 'highpass', hz: r0(lg(1500, 3500, p.brightness)), q: 0.7 }],
          },
          thump('meat', 0, lg(70, 160, s), low * 1.3, -18 + 12 * p.weight),
          squelch('wound', 6, T * 0.55, 2500 * fw, 1.8, 40, -3),
          film('wet', 4, T, env([[0, 1200], [r0(T * 0.4), 150], [r0(T), 10]]), 1500 * fw, 12000 * fw, -2),
          splatter('spurt', 10, T * 0.6, 0.35, top, -8),
          bubbleLayer('blood', 40, T, env([[0, 40], [r0(T), 2]]), [700 * fh, 2600 * fh], bubDecay, chirp, -15),
          ...(crunch ? bone('', 4, 70, p.crunch, -10 + 8 * p.crunch) : []),
        );
        break;
      }
      case 'crunch': {
        const T = lg(250, 700, s);
        const amount = Math.max(p.crunch, 0.6);
        // A few distinct snaps at uneven gaps over wet gristle; a steady click stream reads as electricity.
        const snaps: [number, number, number][] = [[0, 0, 2600], [0.14, -4, 3400], [0.27, -2, 2000], [0.48, -8, 4200]];
        ls = layers(
          ...snaps.slice(0, amount > 0.8 ? 4 : 3).flatMap(([at, g, hz], i) => snap(`snap${i + 1}`, T * at, s, g, hz * lg(0.8, 1.25, p.brightness))),
          ...wet('', 0, T, { centre: 2000 * fw, film: 250, gloop: 30, gloopHz: [500 * fh, 2000 * fh], chirp, gloopDb: -14, shape: [[0, 0], [0.1, 1], [0.5, 0.5], [1, 0]] }, -6),
          p.weight > 0.02 && thump('meat', 0, T * 0.35, low, -22 + 10 * p.weight),
        );
        break;
      }
      case 'gib': {
        const T = lg(900, 2200, s);
        lufs = r1(-19 + 3 * s);
        ls = layers(
          slap('burst', 0, 70, lg(1500, 3500, p.brightness), 0),
          thump('meat', 0, lg(200, 500, s), low * 0.8, -10 + 10 * p.weight),
          splatter('spray', 0, T * 0.6, 1, top, 0),
          film('wet', 0, T, env([[0, 2000], [r0(T * 0.3), 400], [r0(T), 20]]), 1500 * fw, 12000 * fw, -2),
          squelch('rip', 10, T * 0.35, 2000 * fw, 1.8, 34, -4),
          ...bone('', 0, lg(120, 300, s), Math.max(p.crunch, 0.4), -6),
          bubbleLayer('chunks', 60, T, env([[0, 80], [r0(T * 0.3), 25], [r0(T), 2]]), [300 * fh, 2000 * fh], bubDecay, chirp, -14, 0.9),
          {
            // Lumps landing around the listener after the burst.
            id: 'landing',
            start_ms: r0(T * 0.12),
            source: { type: 'particles', kind: 'burst', rate_hz: env([[0, 14], [r0(T * 0.6), 2]]), hz: [250, 1500], decay_ms: [8, 30], q: 1.2, gain_jitter_db: 12, spread: 1 },
            amp: env([[0, 1], [r0(T * 0.7), 0]], 'linear'),
            gain_db: -4,
          },
        );
        break;
      }
      case 'drip': {
        // One drop: a single rising blip plus the faint splash of it landing.
        const f = r0(lg(1400, 500, s) * lg(1.25, 0.75, v));
        const len = r0(lg(25, 70, s));
        lufs = -22;
        ls = layers(
          {
            id: 'drop',
            source: { type: 'osc', hz: env([[0, f], [r0(len * 0.2), r0(f * 1.45)], [len, r0(f * 1.6)]], 'exp') },
            amp: env([[0, 0], [1, 1], [len, 0]]),
          },
          slap('splash', 0, 6, lg(3000, 6000, p.brightness), -14),
          bubbleLayer('spatter', 4, 60, 70, [r0(f * 1.4), r0(f * 3)], [3, 10], 6, -20, 0.6),
        );
        break;
      }
    }

    return {
      name: `gore_${p.kind}`,
      seed,
      layers: ls,
      master: {
        fx: [
          // Soft wet sounds want air and no saturation (it turns the flutter into buzz); hits want grit.
          soft
            ? { type: 'eq', mid_db: -3, mid_hz: 900, mid_q: 0.8, high_db: r1(5 + (p.brightness - 0.5) * 8), high_hz: 4000, low_db: r1(p.weight * 2) }
            : { type: 'eq', high_db: r1((p.brightness - 0.5) * 8), low_db: r1(p.weight * 2) },
          { type: 'compressor', threshold_db: -20, ratio: 3, attack_ms: 4, release_ms: 120 },
          ...(soft ? [] : [{ type: 'shaper' as const, drive_db: 4, mix: 0.4 }]),
          ...far(p.distance_m),
          ...room(p.wetness, 0.22, 250 + 600 * p.wetness),
          { type: 'limiter' },
        ],
        normalize: { lufs },
      },
    };
  },
});

export const bubbles = defineRecipe({
  name: 'bubbles',
  description: 'Bubbles: big blubs rising, an underwater stream, a pot boiling, a single pop.',
  params: z.strictObject({
    kind: choice(
      ['blub', 'stream', 'boil', 'pop'],
      'blub',
      'blub = a few big bubbles rising; stream = steady underwater stream; boil = a pot at a rolling boil; pop = one bubble surfacing.',
    ),
    size: unit(0.5, 'Bubble size. 0 = tiny and high, 1 = big and low.'),
    amount: unit(0.5, 'How many bubbles.'),
    length_ms: num(150, 6000, 1500, 'Length (not used by pop).'),
    brightness: brightness(),
    wetness: wetness(0.15),
    distance_m: distance(),
  }),
  build: (p, seed) => {
    const T = p.length_ms;
    const f = lg(1800, 300, p.size); // Minnaert: bigger bubble, lower note
    const hold = (fade = 0.15): Mod => env([[0, 0], [r0(Math.min(60, T * 0.1)), 1], [r0(T * (1 - fade)), 1], [r0(T), 0]], 'smooth');
    // Under water there are no highs; the surface pops of boiling are the bright part.
    const underwater = { type: 'filter' as const, mode: 'lowpass' as const, hz: r0(lg(2500, 6000, p.brightness)), q: 0.7 };
    let ls: LayerInput[];
    let lufs = -20;
    switch (p.kind) {
      case 'stream':
        ls = layers(
          {
            id: 'bubbles',
            source: { type: 'particles', kind: 'bubble', rate_hz: { random: { rate_hz: 3, depth: r0(lin(10, 40, p.amount)) }, base: r0(lin(20, 90, p.amount)) }, hz: [r0(f * 0.6), r0(f * 2.2)], decay_ms: [12, 40], chirp_semitones: 7, gain_jitter_db: 12, spread: 0.5 },
            amp: hold(),
            fx: [underwater],
          },
          {
            id: 'rush',
            source: { type: 'noise', color: 'brown' },
            amp: hold(),
            gain_db: -16,
            fx: [{ type: 'filter', mode: 'lowpass', hz: { random: { rate_hz: 2, depth: 80 }, base: r0(f * 0.4 + 150) }, q: 0.8 }],
          },
        );
        break;
      case 'boil':
        // A real boil is a dense spray of broadband bursts over a steady low rumble, with only a few
        // tonal bubbles; mostly-tonal bubbles read as underwater instead.
        ls = layers(
          {
            id: 'bubbles',
            source: { type: 'particles', kind: 'bubble', rate_hz: { random: { rate_hz: 4, depth: r0(lin(10, 35, p.amount)) }, base: r0(lin(25, 80, p.amount)) }, hz: [r0(f * 0.5), r0(f * 1.8)], decay_ms: [6, 25], chirp_semitones: 6, gain_jitter_db: 14, spread: 0.7 },
            amp: hold(),
            gain_db: 0,
          },
          {
            // Bubbles bursting at the surface: short broadband spits.
            id: 'spits',
            source: { type: 'particles', kind: 'burst', rate_hz: { random: { rate_hz: 5, depth: r0(lin(90, 240, p.amount)) }, base: r0(lin(150, 400, p.amount)) }, hz: [600, r0(lg(8000, 14000, p.brightness))], decay_ms: [0.4, 3], q: 0.8, gain_jitter_db: 20, spread: 0.8 },
            amp: hold(),
            gain_db: -2,
          },
          {
            id: 'rumble',
            source: { type: 'noise', color: 'brown' },
            amp: hold(),
            gain_db: -14,
            fx: [{ type: 'filter', mode: 'lowpass', hz: { random: { rate_hz: 3, depth: 60 }, base: 220 }, q: 0.8 }, { type: 'gain', db: { random: { rate_hz: 8, depth: 6 }, base: 0 } }],
          },
        );
        break;
      case 'pop': {
        // One bubble reaching the surface: a quick rising note, the tick of the film breaking.
        const len = r0(lg(30, 90, p.size));
        lufs = -22;
        ls = layers(
          {
            id: 'bubble',
            source: { type: 'osc', hz: env([[0, r0(f)], [r0(len * 0.25), r0(f * 1.5)], [len, r0(f * 1.7)]]) },
            amp: env([[0, 0], [2, 1], [len, 0]]),
          },
          {
            id: 'burst',
            start_ms: r0(len * 0.6),
            source: { type: 'noise', color: 'white' },
            amp: env([[0, 1], [4, 0]]),
            gain_db: -16,
            fx: [{ type: 'filter', mode: 'bandpass', hz: r0(lg(3000, 7000, p.brightness)), q: 1 }],
          },
        );
        break;
      }
      default: {
        // A few big bubbles wobbling up: separate, rising blips with a little space between.
        ls = layers({
          id: 'blubs',
          source: { type: 'particles', kind: 'bubble', rate_hz: r1(lin(4, 14, p.amount)), regularity: 0.35, hz: [r0(f * 0.7), r0(f * 1.4)], decay_ms: [25, 60], chirp_semitones: 9, gain_jitter_db: 6, spread: 0.4 },
          amp: hold(0.1),
          fx: [underwater],
        });
      }
    }
    return {
      name: `bubbles_${p.kind}`,
      seed,
      layers: ls,
      master: {
        fx: [{ type: 'eq', high_db: r1((p.brightness - 0.5) * 6) }, ...far(p.distance_m), ...room(p.wetness, 0.25, 400), { type: 'limiter' }],
        normalize: { lufs },
      },
    };
  },
});
