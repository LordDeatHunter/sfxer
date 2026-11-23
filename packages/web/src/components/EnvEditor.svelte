<script lang="ts">
  import './EnvEditor.css';
  import { CURVES } from '@sfxer/core';

  type Point = [number, number];
  type Curve = (typeof CURVES)[number];

  interface Props {
    points: Point[];
    curve: Curve;
    min: number;
    max: number;
    /** Plot the value axis logarithmically (frequencies). */
    log: boolean;
    onchange: (points: Point[], curve: Curve) => void;
  }
  let { points, curve, min, max, log, onchange }: Props = $props();

  const HEIGHT = 96;
  const PAD = 7;
  let width = $state(300);
  let selected = $state(0);
  let dragging = $state(-1);

  const useLog = $derived(log && min > 0);
  const span = $derived(Math.max(50, (points[points.length - 1]?.[0] ?? 0) * 1.25));
  const sel = $derived(points[Math.min(selected, points.length - 1)]);

  const tx = (ms: number): number => PAD + (ms / span) * (width - 2 * PAD);
  const ty = (v: number): number => {
    const u = useLog ? Math.log(Math.max(v, min) / min) / Math.log(max / min) : (v - min) / (max - min);
    return HEIGHT - PAD - u * (HEIGHT - 2 * PAD);
  };
  const fromX = (x: number): number => Math.max(0, ((x - PAD) / (width - 2 * PAD)) * span);
  const fromY = (y: number): number => {
    const u = Math.min(1, Math.max(0, (HEIGHT - PAD - y) / (HEIGHT - 2 * PAD)));
    return useLog ? min * Math.pow(max / min, u) : min + u * (max - min);
  };
  const tidy = (v: number): number => (Math.abs(max - min) > 50 ? Math.round(v) : Math.round(v * 1000) / 1000);

  // The same interpolation the engine uses, so the drawing is what you hear.
  function between(a: number, b: number, t: number): number {
    if (curve === 'step') return a;
    if (curve === 'smooth') return a + (b - a) * t * t * (3 - 2 * t);
    if (curve === 'exp') {
      if (a > 0 && b > 0) return a * Math.pow(b / a, t);
      return b < a ? b + (a - b) * Math.pow(1 - t, 3) : a + (b - a) * t * t * t;
    }
    return a + (b - a) * t;
  }

  const path = $derived.by(() => {
    const first = points[0];
    const last = points[points.length - 1];
    if (!first || !last) return '';
    let d = `M ${tx(0)} ${ty(first[1])} L ${tx(first[0])} ${ty(first[1])}`;
    for (let i = 0; i < points.length - 1; i++) {
      const [t0, v0] = points[i]!;
      const [t1, v1] = points[i + 1]!;
      for (let s = 1; s <= 16; s++) d += ` L ${tx(t0 + ((t1 - t0) * s) / 16)} ${ty(between(v0, v1, s / 16))}`;
    }
    return `${d} L ${tx(span)} ${ty(last[1])}`;
  });

  function emit(next: Point[], nextCurve: Curve = curve): void {
    onchange(next, nextCurve);
  }

  function local(event: PointerEvent | MouseEvent): { x: number; y: number } {
    const box = (event.currentTarget as SVGElement).closest('svg')!.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  }

  function move(event: PointerEvent): void {
    if (dragging < 0) return;
    const { x, y } = local(event);
    const before = points[dragging - 1]?.[0] ?? 0;
    const after = points[dragging + 1]?.[0] ?? Infinity;
    const ms = Math.round(Math.min(after, Math.max(before, fromX(x))) * 10) / 10;
    emit(points.map((p, i): Point => (i === dragging ? [ms, tidy(fromY(y))] : p)));
  }

  function add(event: MouseEvent): void {
    const { x, y } = local(event);
    const next: Point[] = [...points, [Math.round(fromX(x)), tidy(fromY(y))]];
    next.sort((a, b) => a[0] - b[0]);
    emit(next);
  }

  function remove(index: number): void {
    if (points.length <= 1) return;
    selected = Math.max(0, index - 1);
    emit(points.filter((_, i) => i !== index));
  }

  function setSelected(part: 0 | 1, raw: string): void {
    const n = Number(raw);
    if (!Number.isFinite(n) || !sel) return;
    const i = Math.min(selected, points.length - 1);
    emit(points.map((p, j): Point => (j === i ? (part === 0 ? [Math.max(0, n), p[1]] : [p[0], Math.min(max, Math.max(min, n))]) : p)));
  }
</script>

<div class="env">
  <svg
    class="env-plot"
    role="application"
    aria-label="Envelope editor"
    bind:clientWidth={width}
    ondblclick={add}
    onpointermove={move}
    onpointerup={() => (dragging = -1)}
    onpointerleave={() => (dragging = -1)}
  >
    <path class="env-fill" d={`${path} L ${tx(span)} ${HEIGHT} L ${tx(0)} ${HEIGHT} Z`} />
    <path class="env-line" d={path} />
    {#each points as point, i (i)}
      <circle
        class="env-point"
        class:env-point-selected={i === selected}
        role="button"
        tabindex="-1"
        aria-label={`Point ${i + 1}`}
        cx={tx(point[0])}
        cy={ty(point[1])}
        r="5"
        onpointerdown={(event) => {
          selected = i;
          dragging = i;
          (event.currentTarget as SVGElement).closest('svg')?.setPointerCapture(event.pointerId);
        }}
        oncontextmenu={(event) => {
          event.preventDefault();
          remove(i);
        }}
      />
    {/each}
  </svg>
  <div class="env-row">
    {#if sel}
      <span>point {Math.min(selected, points.length - 1) + 1}</span>
      <input class="input input-number" type="number" min="0" value={sel[0]} onchange={(e) => setSelected(0, e.currentTarget.value)} aria-label="Time in ms" />
      <span>ms</span>
      <input class="input input-number" type="number" {min} {max} step="any" value={sel[1]} onchange={(e) => setSelected(1, e.currentTarget.value)} aria-label="Value" />
    {/if}
    <span class="spacer"></span>
    <select class="input input-number" value={curve} onchange={(e) => emit(points, e.currentTarget.value as Curve)} aria-label="Curve">
      {#each CURVES as c (c)}<option value={c}>{c}</option>{/each}
    </select>
  </div>
  <span class="env-hint">Drag points. Double-click to add, right-click to remove.</span>
</div>
