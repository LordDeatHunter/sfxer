/// <reference lib="webworker" />
import { analyze, match, render, spectrogram, toMono, validatePatch } from '@sfxer/core';
import type { Analysed, Picture, RenderOutcome, RequestMessage, Requests, ResponseMessage } from './protocol';

const scope = self as unknown as DedicatedWorkerGlobalScope;
const post = (message: ResponseMessage, transfer: Transferable[] = []): void => scope.postMessage(message, transfer);

function picture(channels: Float32Array[], sampleRate: number): Picture {
  const mono = channels.length >= 2 ? toMono([channels[0]!, channels[1]!]) : channels[0]!;
  const img = spectrogram(mono, sampleRate, { width: 960, height: 320 });
  return { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) };
}

const handlers: { [K in keyof Requests]: (args: Requests[K]['args'], id: number) => Requests[K]['result'] } = {
  render({ patch, assets, solo }): RenderOutcome {
    const checked = validatePatch(patch);
    if (!checked.ok) return { ok: false, issues: checked.issues };
    const r = render(checked.patch, { assets, ...(solo ? { solo } : {}) });
    return {
      ok: true,
      value: {
        sampleRate: r.sampleRate,
        channels: r.channels,
        durationMs: r.durationMs,
        layers: r.layers,
        warnings: r.warnings,
        report: analyze(r.channels, r.sampleRate, { loop: checked.patch.master.loop }),
        picture: picture(r.channels, r.sampleRate),
      },
    };
  },
  analyse({ channels, sampleRate }): Analysed {
    return { report: analyze(channels, sampleRate), picture: picture(channels, sampleRate) };
  },
  match({ channels, sampleRate }, id) {
    return match(channels, sampleRate, { onProgress: (fraction, stage) => post({ id, kind: 'progress', fraction, stage }) });
  },
};

scope.onmessage = (event: MessageEvent<RequestMessage>) => {
  const { id, op, args } = event.data;
  try {
    const result = (handlers[op] as (a: unknown, id: number) => unknown)(args, id);
    post({ id, kind: 'done', result });
  } catch (e) {
    post({ id, kind: 'error', message: e instanceof Error ? e.message : String(e) });
  }
};
