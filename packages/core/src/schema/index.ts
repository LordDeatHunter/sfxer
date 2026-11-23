import { z } from 'zod';

/**
 * The patch format. These schemas are the single source of truth: validation,
 * TypeScript types, JSON Schema, generated docs and the web editor all derive from them.
 */

export const CURVES = ['linear', 'exp', 'smooth', 'step'] as const;
export const LFO_SHAPES = ['sine', 'triangle', 'square', 'saw'] as const;

/** A parameter that accepts a plain number or a modulation object. */
function param(min: number, max: number, description: string) {
  const num = z.number().min(min).max(max);
  return z
    .union([
      num,
      z.strictObject({
        env: z.array(z.tuple([z.number().min(0).max(60000), num])).min(1).max(64),
        curve: z.enum(CURVES).default('linear'),
      }),
      z.strictObject({
        lfo: z.strictObject({
          hz: z.number().min(0.01).max(2000),
          depth: z.number(),
          shape: z.enum(LFO_SHAPES).default('sine'),
          phase: z.number().min(0).max(1).default(0),
        }),
        base: num,
      }),
      z.strictObject({
        random: z.strictObject({
          rate_hz: z.number().min(0.01).max(2000),
          depth: z.number(),
          smooth: z.boolean().default(true),
        }),
        base: num,
      }),
    ])
    .meta({ description, modulatable: true, min, max });
}

const num = (min: number, max: number, description: string) => z.number().min(min).max(max).meta({ description });
const int = (min: number, max: number, description: string) =>
  z.number().int().min(min).max(max).meta({ description });

// ---------------------------------------------------------------- sources

export const MATERIALS = [
  'wood',
  'metal',
  'glass',
  'plastic',
  'ceramic',
  'stone',
  'bell',
  'membrane',
  'hollow',
] as const;

const pitch = () => param(-48, 48, 'Pitch offset in semitones, added on top of hz. Good for sweeps and vibrato.');

const OscSource = z
  .strictObject({
    type: z.literal('osc'),
    shape: z.enum(['sine', 'triangle', 'saw', 'square', 'pulse']).default('sine'),
    hz: param(10, 20000, 'Frequency in Hz.'),
    pitch_semitones: pitch().default(0),
    pulse_width: param(0.05, 0.95, 'Duty cycle for shape "pulse".').default(0.5),
    unison: int(1, 9, 'Number of detuned voices. 3-7 gives a thick, non-retro tone.').default(1),
    detune_cents: num(0, 100, 'Total spread of the unison voices in cents.').default(12),
  })
  .meta({ description: 'Band-limited oscillator. On its own this sounds synthetic; filter it, layer it, or use unison.' });

const FmSource = z
  .strictObject({
    type: z.literal('fm'),
    hz: param(10, 20000, 'Carrier frequency in Hz.'),
    pitch_semitones: pitch().default(0),
    ratio: param(0.1, 16, 'Modulator frequency as a multiple of the carrier. Non-integer values sound metallic.').default(2),
    index: param(0, 20, 'Modulation depth. Sweep it downward over time for a natural bright-to-dull decay.').default(2),
    feedback: num(0, 1, 'Modulator self-feedback; adds grit.').default(0),
  })
  .meta({ description: 'Two-operator FM. Good for bells, energy, zaps and metallic tones.' });

const NoiseSource = z
  .strictObject({
    type: z.literal('noise'),
    color: z.enum(['white', 'pink', 'brown', 'velvet', 'crackle']).default('white'),
    density_hz: param(1, 20000, 'Impulses per second for "velvet" and "crackle".').default(2000),
  })
  .meta({
    description:
      'Noise. Runs for the whole layer, so give the layer an amp envelope and shape it with a moving filter.',
  });

const ImpulseSource = z
  .strictObject({
    type: z.literal('impulse'),
    width_ms: num(0.02, 10, 'Pulse width. Shorter is brighter.').default(0.3),
  })
  .meta({ description: 'A single click at the start of the layer. Feed it into filters, combs or reverb.' });

const ModalMode = z.strictObject({
  hz: z.number().min(20).max(20000),
  gain_db: z.number().min(-80).max(12).default(0),
  decay_ms: z.number().min(1).max(20000),
});

const ModalSource = z
  .strictObject({
    type: z.literal('modal'),
    material: z.enum(MATERIALS).default('wood'),
    size: num(0, 1, 'Object size. 0 = tiny and high, 1 = huge and low.').default(0.5),
    hz: num(20, 12000, 'Override the fundamental frequency chosen by material and size.').optional(),
    damping: num(0, 1, 'Extra damping. 0 rings freely, 1 is heavily muted (hand on the object).').default(0),
    strike: z
      .strictObject({
        hardness: num(0, 1, 'Mallet hardness. Soft excites only low modes; hard excites everything.').default(0.6),
        position: num(0, 1, 'Where the object is hit. 0.5 is the centre, which mutes even modes.').default(0.28),
      })
      .default({ hardness: 0.6, position: 0.28 }),
    mode_count: int(1, 64, 'Number of resonant modes generated from the material.').default(24),
    modes: z
      .array(ModalMode)
      .min(1)
      .max(96)
      .optional()
      .meta({ description: 'Explicit mode list. When given, material, size and hz are ignored.' }),
  })
  .meta({
    description:
      'A struck resonant object, synthesised as a bank of decaying modes. The main source for impacts, knocks, clinks and bells.',
  });

const PluckSource = z
  .strictObject({
    type: z.literal('pluck'),
    hz: num(20, 8000, 'String pitch in Hz.'),
    decay_ms: num(20, 10000, 'Time for the string to fade by 60 dB.').default(800),
    brightness: num(0, 1, 'Brightness of the pluck and how slowly highs die away.').default(0.6),
    position: num(0.02, 0.5, 'Pluck position along the string.').default(0.2),
  })
  .meta({ description: 'Plucked string or twang (Karplus-Strong).' });

const range = (min: number, max: number, description: string) =>
  z.tuple([z.number().min(min).max(max), z.number().min(min).max(max)]).meta({ description });

const ParticlesSource = z
  .strictObject({
    type: z.literal('particles'),
    kind: z
      .enum(['ping', 'burst', 'click', 'bubble'])
      .default('burst')
      .meta({
        description:
          'ping = tiny ringing tone, burst = filtered noise puff, click = sharp tick, bubble = liquid blip whose pitch rises as it rings (drips, gloops, wet squelch); set chirp_semitones for the rise.',
      }),
    rate_hz: param(0.2, 4000, 'Average particles per second. Use an envelope for a dense start that thins out.'),
    hz: range(30, 18000, 'Each particle picks a centre frequency in this [low, high] range.').default([800, 6000]),
    decay_ms: range(0.2, 2000, 'Each particle picks a decay time in this [low, high] range.').default([2, 30]),
    gain_jitter_db: num(0, 36, 'Random loudness variation between particles.').default(12),
    q: num(0.5, 40, 'Resonance of "burst" particles.').default(3),
    spread: num(0, 1, 'Random stereo placement of particles.').default(0.6),
    chirp_semitones: num(
      -24,
      24,
      'Pitch glide of each "ping" or "bubble" particle while it rings. Positive rises: 3-12 makes real bubbles and drips (a bubble rises fast, then settles). Negative falls (bouncy, cartoon).',
    ).default(0),
    regularity: num(
      0,
      1,
      'Timing. 0 = random (rain, crackle, debris); near 1 = an evenly spaced train with slight jitter (ratchets, engines, a creaking hinge, where rate_hz becomes a pitch).',
    ).default(0),
  })
  .meta({
    description:
      'Sprays many small randomised events: debris, sparks, crackle, gravel, rain, coins, bubbles, drips, wet squelch. Key to organic texture.',
  });

const SampleSource = z
  .strictObject({
    type: z.literal('sample'),
    file: z.string().min(1).meta({ description: 'WAV file path, relative to the patch file.' }),
    pitch_semitones: num(-36, 36, 'Repitch by resampling; also changes length.').default(0),
    start_ms: num(0, 600000, 'Skip this much of the file.').default(0),
    end_ms: num(0, 600000, 'Stop reading here.').optional(),
    reverse: z.boolean().default(false),
  })
  .meta({ description: 'Plays a user-supplied WAV file as a layer.' });

const GranularSource = z
  .strictObject({
    type: z.literal('granular'),
    file: z.string().min(1).meta({ description: 'WAV file path, relative to the patch file.' }),
    grain_ms: param(5, 500, 'Length of each grain.').default(60),
    density_hz: param(1, 400, 'Grains per second.').default(40),
    position: param(0, 1, 'Where in the file grains are read from (0 = start, 1 = end).').default(0.5),
    position_jitter: num(0, 1, 'Random offset of the read position.').default(0.05),
    pitch_semitones: param(-36, 36, 'Grain pitch offset.').default(0),
    pitch_jitter: num(0, 24, 'Random pitch variation per grain, in semitones.').default(0),
    spread: num(0, 1, 'Random stereo placement of grains.').default(0.5),
  })
  .meta({ description: 'Granular cloud made from a user-supplied WAV file. Good for textures and stretched tails.' });

export const Source = z.discriminatedUnion('type', [
  OscSource,
  FmSource,
  NoiseSource,
  ImpulseSource,
  ModalSource,
  PluckSource,
  ParticlesSource,
  SampleSource,
  GranularSource,
]);

// ---------------------------------------------------------------- effects

const mix = (def: number) => num(0, 1, 'Dry/wet balance. 0 = dry only, 1 = effect only.').default(def);

const FilterFx = z
  .strictObject({
    type: z.literal('filter'),
    mode: z.enum(['lowpass', 'highpass', 'bandpass', 'notch']).default('lowpass'),
    hz: param(20, 20000, 'Cutoff or centre frequency. Sweeping this with an envelope is the main way to make noise sound alive.'),
    q: param(0.3, 30, 'Resonance. 0.7 is neutral; above 4 whistles.').default(0.707),
    slope: z.union([z.literal(12), z.literal(24)]).default(12).meta({ description: 'Steepness in dB per octave.' }),
  })
  .meta({ description: 'Resonant filter with a modulatable cutoff.' });

const EqFx = z
  .strictObject({
    type: z.literal('eq'),
    low_db: num(-24, 24, 'Low shelf gain.').default(0),
    low_hz: num(30, 1000, 'Low shelf frequency.').default(150),
    mid_db: num(-24, 24, 'Mid bell gain.').default(0),
    mid_hz: num(100, 10000, 'Mid bell frequency.').default(1200),
    mid_q: num(0.3, 10, 'Mid bell width.').default(1),
    high_db: num(-24, 24, 'High shelf gain.').default(0),
    high_hz: num(1000, 16000, 'High shelf frequency.').default(6000),
  })
  .meta({ description: 'Three-band tone control.' });

const CombFx = z
  .strictObject({
    type: z.literal('comb'),
    hz: param(20, 5000, 'Resonant pitch of the comb.'),
    feedback: num(-0.98, 0.98, 'Ring amount. Negative values sound hollow.').default(0.7),
    mix: mix(0.5),
  })
  .meta({ description: 'Comb filter. Adds a pitched, tubular or metallic ring; sweep hz for flanging or pitched whooshes.' });

const FormantFx = z
  .strictObject({
    type: z.literal('formant'),
    vowel: z.enum(['a', 'e', 'i', 'o', 'u']).default('a'),
    shift_semitones: num(-12, 12, 'Moves all formants up or down (smaller or larger creature).').default(0),
    mix: mix(1),
  })
  .meta({ description: 'Vowel filter. Gives noise or buzz a vocal, creature-like character.' });

const ShaperFx = z
  .strictObject({
    type: z.literal('shaper'),
    drive_db: num(0, 48, 'Input gain into the distortion.').default(12),
    curve: z.enum(['tanh', 'soft', 'hard', 'fold']).default('tanh'),
    mix: mix(1),
  })
  .meta({ description: 'Saturation and distortion (oversampled). A few dB adds weight and density.' });

const CrushFx = z
  .strictObject({
    type: z.literal('crush'),
    bits: num(1, 16, 'Bit depth.').default(8),
    rate_hz: num(200, 48000, 'Sample-and-hold rate.').default(8000),
    mix: mix(1),
  })
  .meta({ description: 'Bit and sample-rate reduction. This is the lo-fi retro effect; use sparingly.' });

const ChorusFx = z
  .strictObject({
    type: z.literal('chorus'),
    rate_hz: num(0.05, 10, 'Modulation speed.').default(0.8),
    depth_ms: num(0.1, 10, 'Modulation depth.').default(2),
    delay_ms: num(1, 40, 'Base delay.').default(12),
    mix: mix(0.4),
  })
  .meta({ description: 'Stereo chorus. Thickens and widens tonal layers.' });

const DelayFx = z
  .strictObject({
    type: z.literal('delay'),
    time_ms: num(1, 2000, 'Echo time.').default(180),
    feedback: num(0, 0.95, 'Amount fed back; controls the number of repeats.').default(0.35),
    tone_hz: num(200, 20000, 'Lowpass applied to each repeat.').default(5000),
    ping_pong: z.boolean().default(false),
    mix: mix(0.25),
  })
  .meta({ description: 'Echo.' });

const ReverbFx = z
  .strictObject({
    type: z.literal('reverb'),
    size: num(0, 1, 'Room size. 0.1 = closet, 0.4 = room, 0.8 = hall.').default(0.4),
    decay_ms: num(50, 15000, 'Time for the tail to fade by 60 dB.').default(900),
    damping: num(0, 1, 'How quickly highs die in the tail. Higher is darker and softer.').default(0.4),
    predelay_ms: num(0, 200, 'Gap before the reverb starts; keeps the dry hit clear.').default(8),
    mix: mix(0.2),
  })
  .meta({ description: 'Algorithmic stereo reverb. Even 0.08-0.15 mix removes the "generated in a vacuum" feel.' });

const ConvolveFx = z
  .strictObject({
    type: z.literal('convolve'),
    ir: z.enum(['room', 'hall', 'cave', 'box', 'tube', 'tank']).default('room'),
    decay_scale: num(0.25, 4, 'Stretches or shortens the space.').default(1),
    mix: mix(0.25),
  })
  .meta({
    description:
      'Convolution with a synthetic impulse response: room, hall, cave, box (small enclosure), tube (pipe), tank (metal).',
  });

const ResonatorFx = z
  .strictObject({
    type: z.literal('resonator'),
    material: z.enum(MATERIALS).default('wood'),
    size: num(0, 1, 'Body size. 0 = tiny and high, 1 = huge and low.').default(0.5),
    hz: num(20, 12000, 'Override the fundamental chosen by material and size.').optional(),
    damping: num(0, 1, 'How quickly the body stops ringing.').default(0.3),
    mode_count: int(1, 48, 'Number of resonant modes.').default(16),
    mix: mix(1),
  })
  .meta({
    description:
      'Rings a material body with the incoming sound, using the same mode model as the modal source. Turns friction, scraping, rolling or tick trains into wood, metal or glass (a creaking door is a slow, irregular tick train through a wooden resonator).',
  });

const TransientFx = z
  .strictObject({
    type: z.literal('transient'),
    attack_db: num(-18, 18, 'Boost or soften the initial hit.').default(6),
    sustain_db: num(-18, 18, 'Boost or reduce the body after the hit.').default(0),
  })
  .meta({ description: 'Transient shaper. Positive attack adds punch.' });

const CompressorFx = z
  .strictObject({
    type: z.literal('compressor'),
    threshold_db: num(-60, 0, 'Level above which gain is reduced.').default(-18),
    ratio: num(1, 20, 'Amount of reduction.').default(4),
    attack_ms: num(0.1, 200, 'Reaction time; longer lets the transient through.').default(5),
    release_ms: num(5, 2000, 'Recovery time.').default(120),
    makeup_db: num(0, 36, 'Gain applied afterwards.').default(0),
  })
  .meta({ description: 'Compressor. Glues layers and brings up tails.' });

const LimiterFx = z
  .strictObject({
    type: z.literal('limiter'),
    ceiling_db: num(-24, 0, 'Maximum output peak.').default(-1),
    release_ms: num(5, 1000, 'Recovery time.').default(60),
  })
  .meta({ description: 'Look-ahead peak limiter. Put it last on the master.' });

const WidthFx = z
  .strictObject({
    type: z.literal('width'),
    amount: num(0, 2, 'Stereo width. 0 = mono, 1 = unchanged, 2 = extra wide.').default(1),
    haas_ms: num(0, 30, 'Delays one channel to widen a mono source.').default(0),
  })
  .meta({ description: 'Stereo width control.' });

const PitchFx = z
  .strictObject({
    type: z.literal('pitch'),
    semitones: param(-36, 36, 'Playback pitch. Envelope it for tape-stop, doppler and rise effects.'),
  })
  .meta({ description: 'Varispeed pitch shift: like changing tape speed, so it also changes timing.' });

const GainFx = z
  .strictObject({
    type: z.literal('gain'),
    db: param(-80, 36, 'Gain in dB.'),
  })
  .meta({ description: 'Gain, modulatable.' });

const DistanceFx = z
  .strictObject({
    type: z.literal('distance'),
    meters: num(1, 2000, 'Distance from the listener.').default(30),
  })
  .meta({ description: 'Makes a sound feel far away: duller highs, softer attack, thinner lows.' });

export const Fx = z.discriminatedUnion('type', [
  FilterFx,
  EqFx,
  CombFx,
  FormantFx,
  ShaperFx,
  CrushFx,
  ChorusFx,
  DelayFx,
  ReverbFx,
  ConvolveFx,
  ResonatorFx,
  TransientFx,
  CompressorFx,
  LimiterFx,
  WidthFx,
  PitchFx,
  GainFx,
  DistanceFx,
]);

// ---------------------------------------------------------------- patch

export const Layer = z
  .strictObject({
    id: z.string().min(1).max(64).optional().meta({ description: 'Name used in reports and the editor.' }),
    source: Source,
    amp: param(0, 4, 'Amplitude over time (linear, 1 = full). Usually an envelope; times are ms from the layer start.').default(1),
    gain_db: num(-80, 24, 'Layer level in the mix.').default(0),
    pan: param(-1, 1, 'Stereo position. -1 = left, 1 = right.').default(0),
    start_ms: num(0, 60000, 'Delay before the layer begins.').default(0),
    seed: z.number().int().min(0).max(1000000).optional().meta({
      description: 'Random stream for this layer. By default every layer gets its own; layers with the same seed share it, so repeated hits on one object (knocks, steps) have the same body. Vary them with strike, gain or fx instead.',
    }),
    fx: z.array(Fx).max(16).default([]),
    mute: z.boolean().default(false),
  })
  .meta({ description: 'One sound component. A good effect usually has 2-5 layers: transient, body, tail, sweetener.' });

export const Master = z
  .strictObject({
    fx: z.array(Fx).max(16).default([]),
    normalize: z
      .union([
        z.literal(false),
        z.strictObject({
          lufs: num(-40, -6, 'Target loudness. -16 suits most game SFX; -22 for quiet UI sounds.').default(-16),
          peak_db: num(-12, 0, 'Peak ceiling; loudness is reduced if needed to respect it.').default(-1),
        }),
      ])
      .default({ lufs: -16, peak_db: -1 }),
    trim: z.boolean().default(true).meta({ description: 'Remove trailing silence and add a short fade.' }),
    loop: z
      .boolean()
      .default(false)
      .meta({ description: 'Crossfade the end into the start so the file loops seamlessly. Needs a numeric duration.' }),
    mono: z.boolean().default(false).meta({ description: 'Fold the output to mono.' }),
  })
  .meta({ description: 'Effects and finishing applied to the mixed layers.' });

export const Patch = z
  .strictObject({
    version: z.literal(1).default(1),
    name: z.string().max(100).default('untitled'),
    duration: z
      .union([z.literal('auto'), z.number().min(10).max(60000)])
      .default('auto')
      .meta({ description: 'Length in ms, or "auto" to fit the layers and their tails.' }),
    seed: z.number().int().min(0).max(4294967295).default(1).meta({
      description: 'Random seed. Same patch and seed always renders the same audio; change it for a variation.',
    }),
    layers: z.array(Layer).min(1).max(32),
    master: Master.default({
      fx: [],
      normalize: { lufs: -16, peak_db: -1 },
      trim: true,
      loop: false,
      mono: false,
    }),
  })
  .meta({ description: 'A complete sound effect.' });

export type PatchInput = z.input<typeof Patch>;
export type Patch = z.output<typeof Patch>;
export type LayerInput = z.input<typeof Layer>;
export type Layer = z.output<typeof Layer>;
export type SourceInput = z.input<typeof Source>;
export type Source = z.output<typeof Source>;
export type FxInput = z.input<typeof Fx>;
export type Fx = z.output<typeof Fx>;
export type Param = Exclude<Layer['amp'], undefined>;
export type ParamInput = LayerInput['amp'];
export type SourceOf<T extends Source['type']> = Extract<Source, { type: T }>;
export type FxOf<T extends Fx['type']> = Extract<Fx, { type: T }>;

export const SOURCE_TYPES = Source.options.map((o) => o.shape.type.value) as Source['type'][];
export const FX_TYPES = Fx.options.map((o) => o.shape.type.value) as Fx['type'][];

/** Allowed keys per node type, used for "did you mean" on unknown keys. */
export const NODE_KEYS: Record<string, string[]> = {};
for (const o of [...Source.options, ...Fx.options]) NODE_KEYS[o.shape.type.value] = Object.keys(o.shape);
export const LAYER_KEYS = Object.keys(Layer.shape);
export const MASTER_KEYS = Object.keys(Master.shape);
export const PATCH_KEYS = Object.keys(Patch.shape);

export function sourceSchema(type: string) {
  return Source.options.find((o) => o.shape.type.value === type);
}
export function fxSchema(type: string) {
  return Fx.options.find((o) => o.shape.type.value === type);
}
