import type { Assets, LayerStat, MatchResult, PatchInput, PatchIssue, Report } from '@sfxer/core';

/** Messages between the page and the engine worker. */

export interface Picture {
  width: number;
  height: number;
  data: Uint8ClampedArray<ArrayBuffer>;
}

export interface Rendered {
  sampleRate: number;
  channels: [Float32Array, Float32Array];
  durationMs: number;
  layers: LayerStat[];
  warnings: string[];
  report: Report;
  picture: Picture;
}

export type RenderOutcome = { ok: true; value: Rendered } | { ok: false; issues: PatchIssue[] };

export interface Analysed {
  report: Report;
  picture: Picture;
}

export interface Requests {
  render: { args: { patch: PatchInput; assets: Assets; solo?: number[] }; result: RenderOutcome };
  analyse: { args: { channels: Float32Array[]; sampleRate: number }; result: Analysed };
  match: { args: { channels: Float32Array[]; sampleRate: number }; result: MatchResult };
}

export type Op = keyof Requests;

export interface RequestMessage<K extends Op = Op> {
  id: number;
  op: K;
  args: Requests[K]['args'];
}

export type ResponseMessage =
  | { id: number; kind: 'done'; result: unknown }
  | { id: number; kind: 'error'; message: string }
  | { id: number; kind: 'progress'; fraction: number; stage: string };
