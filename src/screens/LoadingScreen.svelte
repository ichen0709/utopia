<script lang="ts">
  import type { DevTools } from '../backend/types';
  import Campfire from '../components/Campfire.svelte';
  import DemoBanner from '../components/DemoBanner.svelte';

  let { demo, devTools }: { demo: boolean; devTools?: DevTools } = $props();
</script>

{#if demo}<DemoBanner {devTools} />{/if}
<div class="center" role="status" aria-live="polite">
  <Campfire level="low" />
  <div class="serif title">正在點火…</div>
  <div class="dots" aria-hidden="true"><span></span><span></span><span></span></div>
</div>

<style>
  .center {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 0 36px;
    text-align: center;
  }
  .title {
    font-size: 20px;
    font-weight: 600;
  }
  .dots span {
    display: inline-block;
    width: 7px;
    height: 7px;
    margin: 0 3px;
    border-radius: 50%;
    background: var(--amber);
    animation: blink 1.2s ease-in-out infinite;
  }
  .dots span:nth-child(2) {
    animation-delay: 0.2s;
  }
  .dots span:nth-child(3) {
    animation-delay: 0.4s;
  }
  @keyframes blink {
    0%,
    100% {
      opacity: 0.25;
    }
    50% {
      opacity: 1;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .dots span {
      animation: none;
      opacity: 0.8;
    }
  }
</style>
