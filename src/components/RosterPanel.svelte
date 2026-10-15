<script lang="ts">
  // 完整線上名單(底部面板)。點一下代號,就在輸入框 @ 他。
  import { onMount } from 'svelte';
  import type { Member } from '../backend/types';
  import { colorIndex } from '../shared/color';
  import { nicknameKey } from '../shared/nickname';

  let {
    members,
    me,
    onpick,
    onclose,
  }: {
    members: Member[];
    me: string | null;
    onpick: (nickname: string) => void;
    onclose: () => void;
  } = $props();

  let closeBtn: HTMLButtonElement;
  let previouslyFocused: Element | null = null;

  const isMe = (n: string) => !!me && nicknameKey(n) === nicknameKey(me);
  const ordered = $derived(
    [...members].sort((a, b) => Number(isMe(b.nickname)) - Number(isMe(a.nickname)) || Date.parse(a.joinedAt) - Date.parse(b.joinedAt)),
  );

  onMount(() => {
    previouslyFocused = document.activeElement;
    closeBtn?.focus();
    return () => {
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
    };
  });

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') onclose();
  }
</script>

<svelte:window onkeydown={onKey} />

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="scrim" onclick={onclose}></div>
<div class="sheet" role="dialog" aria-modal="true" aria-label="完整線上名單">
  <div class="grip"></div>
  <div class="sh">
    <h2>坐在火堆旁 · {members.length} 人</h2>
    <button bind:this={closeBtn} class="close" type="button" aria-label="關閉名單" onclick={onclose}>
      <svg class="ic" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M6 6l12 12" /><path d="M18 6L6 18" /></svg>
    </button>
  </div>
  <div class="tip">點一下代號,就會在輸入框 @ 他</div>
  <ul class="list">
    {#each ordered as m (m.nickname)}
      <li>
        {#if isMe(m.nickname)}
          <div class="mrow">
            <span class="av c{colorIndex(m.nickname)}"><svg viewBox="0 0 28 28" width="20" height="20" aria-hidden="true"><circle cx="14" cy="9.5" r="5.2" /><path d="M3.5 26c0-6 4.5-9.5 10.5-9.5S24.5 20 24.5 26z" /></svg></span>
            <b class="c{colorIndex(m.nickname)}">{m.nickname}</b>
            <span class="you">你</span>
          </div>
        {:else}
          <button class="mrow pick" type="button" onclick={() => onpick(m.nickname)}>
            <span class="av c{colorIndex(m.nickname)}"><svg viewBox="0 0 28 28" width="20" height="20" aria-hidden="true"><circle cx="14" cy="9.5" r="5.2" /><path d="M3.5 26c0-6 4.5-9.5 10.5-9.5S24.5 20 24.5 26z" /></svg></span>
            <b class="c{colorIndex(m.nickname)}">{m.nickname}</b>
          </button>
        {/if}
      </li>
    {/each}
  </ul>
</div>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    background: var(--scrim);
    z-index: 20;
  }
  .sheet {
    position: fixed;
    z-index: 21;
    left: 50%;
    bottom: 0;
    transform: translateX(-50%);
    width: min(100%, 507px);
    max-height: min(540px, 80dvh);
    display: flex;
    flex-direction: column;
    background: var(--surface);
    border-radius: 26px 28px 0 0;
    border-top: 1.5px solid var(--line);
    box-shadow: 0 -10px 40px rgba(0, 0, 0, 0.5);
    animation: rise 0.22s ease-out;
  }
  @keyframes rise {
    from {
      transform: translate(-50%, 24px);
      opacity: 0;
    }
  }
  .grip {
    width: 44px;
    height: 5px;
    border-radius: 3px;
    background: var(--line);
    margin: 10px auto 0;
  }
  .sh {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 8px 4px 20px;
  }
  h2 {
    margin: 0;
    font: 700 19px/1.3 'Noto Serif TC', 'Songti TC', serif;
  }
  .close {
    width: 44px;
    height: 44px;
    border: 0;
    background: none;
    color: var(--text);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
  }
  .tip {
    padding: 0 20px 8px;
    font-size: 13px;
    color: var(--muted);
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0 8px 16px;
    overflow-y: auto;
  }
  .mrow {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    min-height: 48px;
    padding: 6px 14px;
    border: 0;
    border-radius: 12px;
    background: none;
    text-align: left;
    font-size: 15px;
  }
  .pick:hover,
  .pick:active {
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
  .you {
    margin-left: auto;
    font-size: 11px;
    font-weight: 700;
    background: var(--amber);
    color: var(--onamber);
    padding: 2px 7px;
    border-radius: 8px;
  }
  @media (prefers-reduced-motion: reduce) {
    .sheet {
      animation: none;
    }
  }
</style>
