import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { UserError } from './lib.js';

/** Semantic check of rendered audio through the Python judge (judge/judge.py): AudioSet labels + CLAP prompt match. */

export interface Label {
  label: string;
  p: number;
  cos?: number;
}

export interface JudgeResult {
  file: string;
  error?: string;
  audioset?: Label[];
  clap?: {
    top: Label[];
    prompt?: string;
    prompt_cos?: number;
    prompt_p?: number;
    prompt_rank?: number;
    of?: number;
    verdict?: 'match' | 'ambiguous' | 'mismatch';
  };
}

export interface JudgeOptions {
  prompt?: string | undefined;
  /** Competing labels; defaults to the judge's built-in SFX vocabulary. */
  alt?: string[] | undefined;
  top?: number | undefined;
}

/** packages/cli/dist/judge.js -> <repo>/judge. Override with SFXER_JUDGE_DIR. */
export function judgeDir(): string {
  return process.env.SFXER_JUDGE_DIR ?? resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'judge');
}

const SETUP = 'Set it up once with: uv sync --project judge (needs uv; downloads ~1.5 GB of models on first use).';

function command(extra: string[]): { cmd: string; args: string[] } {
  const dir = judgeDir();
  if (!existsSync(join(dir, 'judge.py'))) throw new UserError(`Judge not found at ${dir}. ${SETUP}`);
  return { cmd: 'uv', args: ['run', '--quiet', '--project', dir, 'python', join(dir, 'judge.py'), ...extra] };
}

const env = (): NodeJS.ProcessEnv => ({ ...process.env, PYTHONIOENCODING: 'utf-8', HF_HUB_DISABLE_PROGRESS_BARS: '1' });

/** Restore the caller's spelling of each path in the results. */
const relabel = (files: string[], results: JudgeResult[]): JudgeResult[] => results.map((r, i) => ({ ...r, file: files[i] ?? r.file }));

/** One-shot judge (loads the models each call, ~10 s). */
export function judgeSync(files: string[], opts: JudgeOptions = {}): JudgeResult[] {
  const extra = [...files.map((f) => resolve(f)), '--json', '--top', String(opts.top ?? 5)];
  if (opts.prompt) extra.push('--prompt', opts.prompt);
  if (opts.alt?.length) extra.push('--alt', ...opts.alt);
  const { cmd, args } = command(extra);
  const r = spawnSync(cmd, args, { encoding: 'utf8', env: env(), maxBuffer: 64 << 20 });
  if (r.error) throw new UserError(`Could not run the judge (${r.error.message}). ${SETUP}`);
  if (r.status !== 0) throw new UserError(`Judge failed: ${r.stderr.trim().split('\n').slice(-5).join('\n')}`);
  return relabel(files, (JSON.parse(r.stdout) as { results: JudgeResult[] }).results);
}

/** Long-lived judge process that keeps the models loaded (for the MCP server). */
export class JudgeServer {
  private proc: ChildProcessWithoutNullStreams | undefined;
  private ready: Promise<void> | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  private waiting: ((line: string) => void)[] = [];
  private stderr: string[] = [];

  private start(): Promise<void> {
    if (this.ready) return this.ready;
    const { cmd, args } = command(['--serve']);
    const proc = spawn(cmd, args, { env: env() });
    this.proc = proc;
    createInterface({ input: proc.stderr }).on('line', (l) => {
      this.stderr.push(l);
      if (this.stderr.length > 20) this.stderr.shift();
    });
    createInterface({ input: proc.stdout }).on('line', (l) => this.waiting.shift()?.(l));
    const died = new Promise<never>((_, reject) => {
      proc.on('error', (e) => reject(new UserError(`Could not run the judge (${e.message}). ${SETUP}`)));
      proc.on('exit', (code) => {
        this.reset();
        const msg = new UserError(`Judge exited (code ${code}): ${this.stderr.slice(-5).join('\n')}`);
        for (const w of this.waiting.splice(0)) w(JSON.stringify({ error: msg.message }));
        reject(msg);
      });
    });
    died.catch(() => {});
    this.ready = Promise.race([this.next().then(() => undefined), died]);
    this.ready.catch(() => this.reset());
    return this.ready;
  }

  private reset(): void {
    this.proc = undefined;
    this.ready = undefined;
  }

  private next(): Promise<string> {
    return new Promise((res) => this.waiting.push(res));
  }

  judge(files: string[], opts: JudgeOptions = {}): Promise<JudgeResult[]> {
    const run = async (): Promise<JudgeResult[]> => {
      await this.start();
      const reply = this.next();
      this.proc!.stdin.write(`${JSON.stringify({ files: files.map((f) => resolve(f)), prompt: opts.prompt, alt: opts.alt, top: opts.top ?? 5 })}\n`);
      const msg = JSON.parse(await reply) as { results?: JudgeResult[]; error?: string };
      if (msg.error || !msg.results) throw new UserError(`Judge failed: ${msg.error ?? 'no results'}`);
      return relabel(files, msg.results);
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }

  close(): void {
    this.proc?.stdin.end();
  }
}

const list = (ls: Label[] | undefined): string => (ls ?? []).map((t) => `${t.label} ${t.p.toFixed(2)}`).join(', ');

/** Plain-language summary for agents. */
export function judgeText(results: JudgeResult[]): string {
  return results
    .map((r) => {
      if (r.error) return `${r.file}: ${r.error}`;
      const lines = [r.file, `  AudioSet hears: ${list(r.audioset)}`, `  CLAP closest:   ${list(r.clap?.top)}`];
      const c = r.clap;
      if (c?.prompt) {
        lines.push(`  Prompt "${c.prompt}": rank ${c.prompt_rank} of ${c.of}, p ${c.prompt_p?.toFixed(2)} -> ${c.verdict?.toUpperCase()}`);
        if (c.verdict !== 'match') lines.push(`  ! A listener would more likely call this "${c.top[0]?.label}" than "${c.prompt}".`);
      }
      return lines.join('\n');
    })
    .join('\n\n');
}
