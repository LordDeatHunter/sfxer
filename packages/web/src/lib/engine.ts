import type { Op, Requests, RequestMessage, ResponseMessage } from './protocol';

type Pending = {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  onProgress: ((fraction: number, stage: string) => void) | undefined;
};

/** Runs the synthesis engine off the main thread so the page never freezes. */
class Engine {
  private worker = new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' });
  private pending = new Map<number, Pending>();
  private nextId = 1;

  constructor() {
    this.worker.onmessage = (event: MessageEvent<ResponseMessage>) => {
      const message = event.data;
      const entry = this.pending.get(message.id);
      if (!entry) return;
      if (message.kind === 'progress') {
        entry.onProgress?.(message.fraction, message.stage);
        return;
      }
      this.pending.delete(message.id);
      if (message.kind === 'done') entry.resolve(message.result);
      else entry.reject(new Error(message.message));
    };
  }

  call<K extends Op>(op: K, args: Requests[K]['args'], onProgress?: (fraction: number, stage: string) => void): Promise<Requests[K]['result']> {
    const id = this.nextId++;
    const message: RequestMessage<K> = { id, op, args };
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, onProgress });
      this.worker.postMessage(message);
    });
  }
}

export const engine = new Engine();
