<script lang="ts">
  import './Editor.css';
  import { describeNode } from '@sfxer/core';
  import { fxTypes, newFx } from '../lib/nodes';
  import Field from './Field.svelte';

  type Dict = Record<string, unknown>;

  interface Props {
    /** The effect chain; edited in place. */
    list: Dict[];
    onchange: () => void;
  }
  let { list, onchange }: Props = $props();

  let adding = $state('');

  function add(): void {
    if (!adding) return;
    list.push(newFx(adding) as unknown as Dict);
    adding = '';
    onchange();
  }

  function move(index: number, by: number): void {
    const target = index + by;
    if (target < 0 || target >= list.length) return;
    const [item] = list.splice(index, 1);
    if (item) list.splice(target, 0, item);
    onchange();
  }
</script>

<div class="fx-list">
  {#each list as fx, i (i)}
    {@const doc = describeNode(String(fx.type))}
    <div class="fx-item">
      <div class="fx-head">
        <span class="fx-name" title={doc?.description}>{fx.type}</span>
        <span class="spacer"></span>
        <button class="btn btn-quiet btn-small" onclick={() => move(i, -1)} disabled={i === 0} aria-label="Move earlier">&uarr;</button>
        <button class="btn btn-quiet btn-small" onclick={() => move(i, 1)} disabled={i === list.length - 1} aria-label="Move later">&darr;</button>
        <button
          class="btn btn-quiet btn-small btn-danger"
          onclick={() => {
            list.splice(i, 1);
            onchange();
          }}
          aria-label="Remove effect">&times;</button
        >
      </div>
      {#each doc?.fields ?? [] as field (field.name)}
        <Field
          doc={field}
          value={fx[field.name]}
          onchange={(v) => {
            if (v === undefined) delete fx[field.name];
            else fx[field.name] = v;
            onchange();
          }}
        />
      {/each}
    </div>
  {/each}
  <div class="fx-add">
    <select class="input" bind:value={adding} onchange={add} aria-label="Add effect">
      <option value="">+ add effect...</option>
      {#each fxTypes as type (type)}<option value={type}>{type}</option>{/each}
    </select>
  </div>
</div>
