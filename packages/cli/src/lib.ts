import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, isAbsolute, resolve } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import {
  analyze,
  decodeWav,
  encodeWav,
  parsePatch,
  render,
  spectrogram,
  toMono,
  type Assets,
  type BitDepth,
  type Image,
  type Patch,
  type RenderResult,
  type Report,
  type WavData,
} from '@sfxer/core';

/** Node-side file helpers shared by the CLI and the MCP server. */

export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserError';
  }
}

export function encodePng(img: Image): Buffer {
  const stride = img.width * 4;
  const raw = Buffer.alloc((stride + 1) * img.height);
  for (let y = 0; y < img.height; y++) {
    raw[y * (stride + 1)] = 0;
    raw.set(img.data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const chunk = (type: string, body: Buffer): Buffer => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(body.length, 0);
    head.write(type, 4, 'latin1');
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])) >>> 0, 0);
    return Buffer.concat([head, body, tail]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.width, 0);
  ihdr.writeUInt32BE(img.height, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export function hasFfmpeg(): boolean {
  return spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
}

/** Read an audio file. WAV is decoded directly; anything else goes through ffmpeg if it is installed. */
export function loadAudio(path: string): WavData {
  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch {
    throw new UserError(`Cannot read audio file "${path}".`);
  }
  if (extname(path).toLowerCase() === '.wav') {
    try {
      return decodeWav(bytes);
    } catch (e) {
      if (!hasFfmpeg()) throw new UserError(`${path}: ${(e as Error).message}`);
    }
  }
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', path, '-f', 'wav', '-acodec', 'pcm_f32le', '-'], { maxBuffer: 1 << 30 });
  if (r.status !== 0) {
    throw new UserError(`Cannot decode "${path}". Only WAV is read natively; other formats need ffmpeg on PATH.${r.stderr?.length ? ` ffmpeg said: ${r.stderr.toString().trim()}` : ''}`);
  }
  return decodeWav(r.stdout);
}

export function readPatchFile(path: string): Patch {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    throw new UserError(`Cannot read patch file "${path}".`);
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new UserError(`${path} is not valid JSON: ${(e as Error).message}`);
  }
  return parsePatch(json);
}

/** Load every WAV a patch refers to, resolved relative to the patch file. */
export function loadAssets(patch: Patch, baseDir: string): Assets {
  const assets: Assets = {};
  for (const layer of patch.layers) {
    const s = layer.source;
    if ((s.type === 'sample' || s.type === 'granular') && !assets[s.file]) {
      const a = loadAudio(isAbsolute(s.file) ? s.file : resolve(baseDir, s.file));
      assets[s.file] = { sr: a.sampleRate, channels: a.channels };
    }
  }
  return assets;
}

export interface WriteOptions {
  bits?: BitDepth;
  /** Also write a spectrogram PNG to this path. */
  png?: string;
}

export interface Written {
  wav: string;
  png?: string;
  /** Path of the ogg/mp3/flac export, when one was requested. */
  exported?: string;
  result: RenderResult;
  report: Report;
}

export function writeSpectrogram(channels: Float32Array[], sr: number, path: string): void {
  const mono = channels.length >= 2 ? toMono([channels[0]!, channels[1]!]) : channels[0]!;
  mkdirSync(dirname(resolve(path)), { recursive: true });
  writeFileSync(path, encodePng(spectrogram(mono, sr)));
}

/** Render a patch and write the WAV (and optionally a spectrogram and a compressed export). */
export function renderToFile(patch: Patch, baseDir: string, out: string, opts: WriteOptions = {}): Written {
  const result = render(patch, { assets: loadAssets(patch, baseDir) });
  const ext = extname(out).toLowerCase();
  const wav = ext === '.wav' ? out : `${out.slice(0, out.length - ext.length)}.wav`;
  mkdirSync(dirname(resolve(wav)), { recursive: true });
  const channels = patch.master.mono ? [result.channels[0]] : result.channels;
  writeFileSync(wav, encodeWav(channels, result.sampleRate, opts.bits ?? 16));
  const written: Written = { wav, result, report: analyze(result.channels, result.sampleRate, { loop: patch.master.loop }) };
  if (ext !== '.wav' && ext !== '') {
    if (!hasFfmpeg()) throw new UserError(`Writing ${ext} needs ffmpeg on PATH. The WAV was written to ${wav}.`);
    const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', wav, out]);
    if (r.status !== 0) throw new UserError(`ffmpeg could not write ${out}: ${r.stderr?.toString().trim()}`);
    written.exported = out;
  }
  if (opts.png) {
    writeSpectrogram(result.channels, result.sampleRate, opts.png);
    written.png = opts.png;
  }
  return written;
}
