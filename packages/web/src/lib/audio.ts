import { encodeWav } from '@sfxer/core';

let context: AudioContext | undefined;
let current: AudioBufferSourceNode | undefined;

function ctx(): AudioContext {
  context ??= new AudioContext({ sampleRate: 48000 });
  return context;
}

export function stop(): void {
  try {
    current?.stop();
  } catch {
    // already stopped
  }
  current = undefined;
}

export function play(channels: Float32Array[], sampleRate: number, loop = false): void {
  if (!channels[0] || channels[0].length === 0) return;
  const ac = ctx();
  void ac.resume();
  stop();
  const buffer = ac.createBuffer(channels.length, channels[0].length, sampleRate);
  channels.forEach((ch, i) => buffer.copyToChannel(new Float32Array(ch), i));
  const node = ac.createBufferSource();
  node.buffer = buffer;
  node.loop = loop;
  node.connect(ac.destination);
  node.start();
  current = node;
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
