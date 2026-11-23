<script lang="ts">
  import './Viz.css';
  import type { Picture } from '../lib/protocol';

  interface Props {
    picture: Picture | undefined;
    label: string;
  }
  let { picture, label }: Props = $props();

  let canvas: HTMLCanvasElement | undefined = $state();

  $effect(() => {
    if (!canvas || !picture) return;
    canvas.width = picture.width;
    canvas.height = picture.height;
    canvas.getContext('2d')?.putImageData(new ImageData(picture.data, picture.width, picture.height), 0, 0);
  });
</script>

<div class="panel viz">
  <div class="panel-head">
    <span class="panel-title">Waveform and spectrogram</span>
    <span class="spacer"></span>
    <span class="muted">{label}</span>
  </div>
  {#if picture}
    <canvas class="viz-canvas" bind:this={canvas}></canvas>
  {:else}
    <div class="viz-empty">Nothing rendered yet</div>
  {/if}
</div>
