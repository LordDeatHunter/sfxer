import { encodeWav } from '@sfxer/core';

let context: AudioContext | undefined;
let current: AudioBufferSourceNode | undefined;
let buffer: AudioBuffer | undefined;
/** Context time at which offset 0 of the buffer would have played. */
let startedAt = 0;
/** Offset in seconds while paused; undefined when stopped or playing. */
let pausedAt: number | undefined;
let looping = false;

function ctx(): AudioContext {
  context ??= new AudioContext({ sampleRate: 48000 });
  return context;
}

function stopNode(): void {
  const node = current;
  current = undefined;
  try {
    node?.stop();
  } catch {
    // already stopped
  }
}

function startAt(offset: number): void {
  if (!buffer) return;
  const ac = ctx();
  void ac.resume();
  stopNode();
  const node = ac.createBufferSource();
  node.buffer = buffer;
  node.loop = looping;
  node.connect(ac.destination);
  node.onended = () => {
    if (current === node) current = undefined;
  };
  node.start(0, Math.min(offset, buffer.duration));
  startedAt = ac.currentTime - offset;
  pausedAt = undefined;
  current = node;
}

/** Current offset into the buffer in seconds. */
function offsetNow(): number {
  if (!buffer || !context) return 0;
  const t = context.currentTime - startedAt;
  return looping ? t % buffer.duration : Math.min(buffer.duration, t);
}

export function stop(): void {
  stopNode();
  pausedAt = undefined;
}

export function play(channels: Float32Array[], sampleRate: number, loop = false): void {
  if (!channels[0] || channels[0].length === 0) return;
  const ac = ctx();
  buffer = ac.createBuffer(channels.length, channels[0].length, sampleRate);
  channels.forEach((ch, i) => buffer!.copyToChannel(new Float32Array(ch), i));
  looping = loop;
  startAt(0);
}

export function pause(): void {
  if (!current) return;
  const at = offsetNow();
  stopNode();
  pausedAt = at;
}

/** Continue from where pause() stopped. Returns false if there was nothing paused. */
export function resume(): boolean {
  if (pausedAt === undefined || !buffer) return false;
  startAt(pausedAt);
  return true;
}

export const isPlaying = (): boolean => current !== undefined;
export const isPaused = (): boolean => pausedAt !== undefined;

/** Jump to a position (0..1). Keeps playing if playing; otherwise moves the paused position. */
export function seek(fraction: number): void {
  if (!buffer) return;
  const at = Math.max(0, Math.min(1, fraction)) * buffer.duration;
  if (current) startAt(at);
  else pausedAt = at;
}

/** Switch looping on the sound that is playing now. */
export function setLooping(loop: boolean): void {
  if (current && !loop) {
    // Re-anchor so the position stays right once the wrap-around stops.
    startedAt = (context?.currentTime ?? 0) - offsetNow();
  }
  looping = loop;
  if (current) current.loop = loop;
}

/** Playback position as 0..1, or undefined when nothing is playing or paused. */
export function progress(): number | undefined {
  if (!buffer) return undefined;
  if (current) return offsetNow() / buffer.duration;
  return pausedAt === undefined ? undefined : pausedAt / buffer.duration;
}

/** Decode any audio file the browser understands into raw channels. */
export async function decodeFile(file: File): Promise<{ sampleRate: number; channels: Float32Array[] }> {
  const buffer = await ctx().decodeAudioData(await file.arrayBuffer());
  const channels: Float32Array[] = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c).slice());
  return { sampleRate: buffer.sampleRate, channels };
}

export function download(name: string, data: BlobPart, type: string): void {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadWav(name: string, channels: Float32Array[], sampleRate: number): void {
  const bytes = encodeWav(channels, sampleRate, 16);
  download(`${name}.wav`, new Uint8Array(bytes), 'audio/wav');
}

export function downloadJson(name: string, value: unknown): void {
  download(`${name}.json`, `${JSON.stringify(value, null, 2)}\n`, 'application/json');
}
