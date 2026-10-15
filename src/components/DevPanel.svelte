<script lang="ts">
  // 階段一的測試工具:模擬斷線、讓營火快熄、叫模擬夥伴說話或 @ 我……方便一項一項驗證。
  // 只在示範模式出現(模擬後端才有 devTools)。
  import type { DevTools } from '../backend/types';

  let { tools }: { tools: DevTools } = $props();

  let open = $state(false);
  // tools 在整個頁面生命週期內不會換,所以只在開始時讀一次
  // svelte-ignore state_referenced_locally
  let offline = $state(tools.isOffline());
  // svelte-ignore state_referenced_locally
  let quiet = $state(tools.isBotsQuiet());
  let note = $state('');

  function run(label: string, fn: () => void) {
    try {
      fn();
      note = label;
    } catch {
      note = '現在做不到(可能還沒加入,或正在斷線)';
    }
  }
</script>

<button class="open" type="button" aria-expanded={open} aria-controls="dev-panel" onclick={() => (open = !open)}>測試工具</button>

{#if open}
  <div id="dev-panel" class="panel" role="group" aria-label="測試工具">
    <div class="title">階段一測試工具<span>(階段二不會有)</span></div>
    <button type="button" onclick={() => { offline = !offline; tools.setOffline(offline); note = offline ? '已模擬斷線' : '已恢復連線,稍等就會自動重連'; }}>
      {offline ? '恢復連線' : '模擬斷線'}
    </button>
    <button type="button" onclick={() => run('營火已調成快熄', () => tools.setFire(12))}>讓營火快熄</button>
    <button type="button" onclick={() => run('營火已熄滅', () => tools.setFire(0))}>讓營火立刻熄滅</button>
    <button type="button" onclick={() => run('夥伴說了一句話', () => tools.botSay())}>夥伴說一句話</button>
    <button type="button" onclick={() => run('夥伴 @ 了你', () => tools.botMention())}>夥伴 @ 我</button>
    <button
      type="button"
      aria-pressed={quiet}
      onclick={() => { quiet = !quiet; run(quiet ? '夥伴安靜了' : '夥伴恢復說話', () => tools.setBotsQuiet(quiet)); }}
    >
      {quiet ? '讓夥伴恢復說話' : '讓夥伴安靜(不說話、不加柴)'}
    </button>
    <button type="button" onclick={() => run('已清除所有訊息', () => tools.clearMessages())}>清除所有訊息</button>
    {#if note}<div class="note" role="status">{note}</div>{/if}
    <button class="close" type="button" onclick={() => (open = false)}>關閉</button>
  </div>
{/if}

<style>
  .open {
    margin-left: 8px;
    min-height: 24px;
    padding: 0 10px;
    border-radius: 12px;
    border: 1px dashed var(--muted);
    background: transparent;
    color: var(--soft);
    font-size: 12px;
  }
  .panel {
    position: absolute;
    z-index: 30;
    top: 26px;
    right: 8px;
    width: min(280px, calc(100vw - 16px));
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 12px;
    background: var(--surface);
    color: var(--text);
    border: 1.5px solid var(--amber);
    border-radius: 16px;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
    letter-spacing: 0;
  }
  .title {
    font-size: 13px;
    font-weight: 700;
  }
  .title span {
    font-weight: 400;
    color: var(--muted);
    margin-left: 4px;
  }
  .panel button {
    min-height: 40px;
    padding: 0 12px;
    text-align: left;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: var(--surface2);
    font-size: 14px;
  }
  .panel button[aria-pressed='true'] {
    border-color: var(--amber);
  }
  .note {
    font-size: 13px;
    color: var(--soft);
    padding: 2px 4px;
  }
  .close {
    text-align: center !important;
  }
</style>
