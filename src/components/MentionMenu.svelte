<script lang="ts">
  // 輸入 @ 之後跳出的選單:列出線上的人,可繼續打字篩選。
  import type { Member } from '../backend/types';
  import { colorIndex } from '../shared/color';

  let {
    candidates,
    active,
    onpick,
    onhover,
  }: {
    candidates: Member[];
    active: number;
    onpick: (nickname: string) => void;
    onhover: (index: number) => void;
  } = $props();
</script>

<div class="menu" role="listbox" aria-label="線上的人">
  <div class="mh">線上的人 · 繼續輸入可以篩選</div>
  {#each candidates as m, i (m.nickname)}
    <!-- 用 mousedown 擋掉焦點轉移,輸入框才不會在點選時失去焦點 -->
    <div
      class="mrow"
      class:on={i === active}
      role="option"
      aria-selected={i === active}
      tabindex="-1"
      onmousedown={(e) => e.preventDefault()}
      onmouseenter={() => onhover(i)}
      onclick={() => onpick(m.nickname)}
      onkeydown={(e) => e.key === 'Enter' && onpick(m.nickname)}
    >
      <span class="av c{colorIndex(m.nickname)}"><svg viewBox="0 0 28 28" width="20" height="20" aria-hidden="true"><circle cx="14" cy="9.5" r="5.2" /><path d="M3.5 26c0-6 4.5-9.5 10.5-9.5S24.5 20 24.5 26z" /></svg></span>
      <b class="c{colorIndex(m.nickname)}">{m.nickname}</b>
    </div>
  {:else}
    <div class="none">沒有符合的人</div>
  {/each}
</div>

<style>
  .menu {
    position: absolute;
    left: 12px;
    right: 12px;
    bottom: calc(100% + 6px);
    max-height: 244px;
    overflow-y: auto;
    background: var(--surface2);
    border: 1.5px solid var(--line);
    border-radius: 16px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
    z-index: 10;
  }
  .mh {
    padding: 8px 14px;
    font-size: 12px;
    color: var(--muted);
    border-bottom: 1px solid var(--line);
  }
  .mrow {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 44px;
    padding: 6px 14px;
    font-size: 15px;
    cursor: pointer;
  }
  .mrow.on {
    background: var(--mention);
  }
  .mrow b {
    font-weight: 700;
    overflow-wrap: anywhere;
    min-width: 0;
  }
  .av {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: var(--bg);
    display: flex;
    align-items: center;
    justify-content: center;
    flex: none;
  }
  .av svg {
    fill: currentColor;
  }
  .none {
    padding: 12px 14px;
    color: var(--muted);
    font-size: 14px;
  }
</style>
