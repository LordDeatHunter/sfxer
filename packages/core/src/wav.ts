export interface WavData {
  sampleRate: number;
  channels: Float32Array[];
}

export type BitDepth = 16 | 24 | 32;

/** Encode PCM WAV. 16 and 24 are integer; 32 is IEEE float. */
export function encodeWav(channels: Float32Array[], sampleRate: number, bits: BitDepth = 16): Uint8Array {
  const nch = channels.length;
  const n = channels[0]?.length ?? 0;
  const bytes = bits / 8;
  const dataLen = n * nch * bytes;
  const out = new Uint8Array(44 + dataLen);
  const dv = new DataView(out.buffer);
  const tag = (o: number, s: string) => {
    for (let i = 0; i < 4; i++) out[o + i] = s.charCodeAt(i);
  };
  tag(0, 'RIFF');
  dv.setUint32(4, 36 + dataLen, true);
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, bits === 32 ? 3 : 1, true);
  dv.setUint16(22, nch, true);
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate * nch * bytes, true);
  dv.setUint16(32, nch * bytes, true);
  dv.setUint16(34, bits, true);
  tag(36, 'data');
  dv.setUint32(40, dataLen, true);
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < nch; c++) {
      const x = Math.max(-1, Math.min(1, channels[c]![i]!));
      if (bits === 16) {
        dv.setInt16(o, Math.round(x * 32767), true);
      } else if (bits === 24) {
        const v = Math.round(x * 8388607);
        out[o] = v & 0xff;
        out[o + 1] = (v >> 8) & 0xff;
        out[o + 2] = (v >> 16) & 0xff;
      } else {
        dv.setFloat32(o, channels[c]![i]!, true);
      }
      o += bytes;
    }
  }
  return out;
}

/** Decode PCM (8/16/24/32-bit integer) or 32/64-bit float WAV. */
export function decodeWav(data: Uint8Array): WavData {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const tag = (o: number) => String.fromCharCode(data[o]!, data[o + 1]!, data[o + 2]!, data[o + 3]!);
  if (data.length < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('Not a WAV file (missing RIFF/WAVE header).');
  let format = 1;
  let nch = 1;
  let sampleRate = 48000;
  let bits = 16;
  let o = 12;
  let found = false;
  while (o + 8 <= data.length) {
    const id = tag(o);
    const size = dv.getUint32(o + 4, true);
    const body = o + 8;
    if (id === 'fmt ') {
      format = dv.getUint16(body, true);
      nch = dv.getUint16(body + 2, true);
      sampleRate = dv.getUint32(body + 4, true);
      bits = dv.getUint16(body + 14, true);
      if (format === 0xfffe && size >= 26) format = dv.getUint16(body + 24, true); // WAVE_FORMAT_EXTENSIBLE
      found = true;
    } else if (id === 'data') {
      if (!found) throw new Error('WAV file has no format chunk before its data.');
      if (format !== 1 && format !== 3) throw new Error(`Unsupported WAV encoding (format ${format}). Convert it to PCM first, e.g. with ffmpeg.`);
      const bytes = bits / 8;
      const n = Math.floor(Math.min(size, data.length - body) / (bytes * nch));
      const channels = Array.from({ length: nch }, () => new Float32Array(n));
      let p = body;
      for (let i = 0; i < n; i++) {
        for (let c = 0; c < nch; c++) {
          let v: number;
          if (format === 3) v = bits === 64 ? dv.getFloat64(p, true) : dv.getFloat32(p, true);
          else if (bits === 8) v = (data[p]! - 128) / 128;
          else if (bits === 16) v = dv.getInt16(p, true) / 32768;
          else if (bits === 24) v = ((data[p]! | (data[p + 1]! << 8) | (data[p + 2]! << 16)) << 8) / 2147483648;
          else v = dv.getInt32(p, true) / 2147483648;
          channels[c]![i] = v;
          p += bytes;
        }
      }
      return { sampleRate, channels };
    }
    o = body + size + (size & 1);
  }
  throw new Error('WAV file has no data chunk.');
}
