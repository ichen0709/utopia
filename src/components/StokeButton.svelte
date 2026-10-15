<script lang="ts">
  // 加柴按鈕:可按 / 冷卻中(再等 N 秒 + 進度條)/ 停用(斷線)
  let {
    state,
    secondsLeft = 0,
    cooldownSeconds = 5,
    onstoke,
  }: {
    state: 'ready' | 'cooldown' | 'off';
    secondsLeft?: number;
    cooldownSeconds?: number;
    onstoke: () => void;
  } = $props();

  const progress = $derived(Math.max(0, Math.min(1, secondsLeft / cooldownSeconds)));
</script>

{#if state === 'ready'}
  <button class="btn-stoke" type="button" onclick={onstoke}>
    <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M12 2c1 4 5 6 5 11a5 5 0 01-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-4-1-6 1-10z" /></svg>
    加柴
  </button>
{:else if state === 'cooldown'}
  <button class="btn-stoke cool" type="button" aria-disabled="true" aria-live="polite">
    再等 {secondsLeft} 秒
    <span class="prog" aria-hidden="true"><i style:width="{progress * 100}%"></i></span>
  </button>
{:else}
  <button class="btn-stoke offb" type="button" disabled>
    <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M12 2c1 4 5 6 5 11a5 5 0 01-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-4-1-6 1-10z" /></svg>
    加柴
  </button>
{/if}

<style>
  .btn-stoke {
    position: relative;
    overflow: hidden;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    min-height: 52px;
    min-width: 184px;
    padding: 0 26px;
    font-size: 18px;
    font-weight: 700;
    line-height: 1;
    border: 2px solid transparent;
    border-radius: 26px 28px 26px 28px;
    background: linear-gradient(180deg, #ffc873, #f28a3a);
    color: #1c1108;
    box-shadow:
      0 0 0 3px rgba(247, 189, 98, 0.28),
      0 8px 24px rgba(242, 138, 58, 0.5);
  }
  .btn-stoke:active:not(.cool):not(:disabled) {
    transform: translateY(1px);
  }
  .cool {
    background: #1b2342;
    color: #efe5d0;
    border: 2px dashed #f7bd62;
    box-shadow: none;
    font-size: 16px;
    cursor: default;
  }
  .offb {
    background: #1a2038;
    color: #a3a8c0;
    border: 2px dashed #46527f;
    box-shadow: none;
  }
  .prog {
    position: absolute;
    left: 14px;
    right: 14px;
    bottom: 5px;
    height: 4px;
    border-radius: 2px;
    background: rgba(247, 189, 98, 0.25);
  }
  .prog i {
    display: block;
    height: 100%;
    border-radius: 2px;
    background: #f7bd62;
  }
</style>
