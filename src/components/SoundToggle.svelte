<script lang="ts">
  let { on, ontoggle }: { on: boolean; ontoggle: () => void } = $props();
</script>

<button
  class="iconbtn"
  class:mute={!on}
  type="button"
  aria-pressed={on}
  aria-label={on ? '提示音:開(點一下關閉)' : '提示音:關(點一下開啟)'}
  onclick={ontoggle}
>
  {#if on}
    <svg class="ic" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9z" /><path d="M16.5 8.5a5 5 0 010 7" /><path d="M19 6a8.5 8.5 0 010 12" /></svg>
  {:else}
    <svg class="ic" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9z" /><path d="M17 9l5 6" /><path d="M22 9l-5 6" /></svg>
  {/if}
</button>

<style>
  .iconbtn {
    width: 44px;
    height: 44px;
    padding: 0;
    border-radius: 50%;
    border: 1.5px solid var(--line);
    background: var(--surface);
    color: var(--text);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
  }
  .mute {
    color: var(--muted);
    border-style: dashed;
  }
</style>
