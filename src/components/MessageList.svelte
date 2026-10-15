<script lang="ts">
  // 聊天區:依時間排列、到期的訊息淡出消失、新訊息時的捲動規則、空狀態。
  import { tick, untrack } from 'svelte';
  import { fade } from 'svelte/transition';
  import { clock } from '../lib/clock.svelte';
  import type { ViewMessage } from '../lib/chat.svelte';
  import { motion } from '../lib/motion.svelte';
  import { mentions } from '../shared/mention';
  import { nicknameKey } from '../shared/nickname';
  import { fadeStage } from '../shared/time';
  import MessageItem from './MessageItem.svelte';

  let { messages, me, offset }: { messages: ViewMessage[]; me: string | null; offset: number } = $props();

  let scroller: HTMLDivElement;
  let atBottom = $state(true);
  let unread = $state(0);
  const known = new Set<string>();
  let first = true;

  const now = $derived(clock.now + offset);
  // 到期的訊息從畫面上拿掉(伺服器那邊也會真的刪除)
  const visible = $derived(messages.filter((m) => m.expiresMs > now));

  const isMine = (m: ViewMessage) => !!me && m.kind === 'chat' && nicknameKey(m.nickname) === nicknameKey(me);
  const isMention = (m: ViewMessage) => !!me && m.kind === 'chat' && !isMine(m) && !!m.body && mentions(m.body, me);

  function toBottom() {
    if (!scroller) return;
    scroller.scrollTop = scroller.scrollHeight;
    atBottom = true;
    unread = 0;
  }

  function onScroll() {
    atBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 32;
    if (atBottom) unread = 0;
  }

  // 有新訊息時:停在最底就自動捲到底;正在往上翻就不動,改顯示「有 N 則新訊息」;自己送出的一律捲到底
  $effect(() => {
    const list = visible;
    untrack(() => {
      const fresh = list.filter((m) => !known.has(m.id));
      for (const m of list) known.add(m.id);
      if (first) {
        first = false;
        void tick().then(toBottom);
        return;
      }
      if (!fresh.length) return;
      if (fresh.some(isMine) || atBottom) {
        void tick().then(toBottom);
      } else {
        unread += fresh.length;
      }
    });
  });
</script>

<div class="wrap">
  <div class="chat" bind:this={scroller} onscroll={onScroll} role="log" aria-live="polite" aria-label="聊天內容">
    {#if visible.length === 0}
      <div class="empty">
        <svg class="ic" viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><path d="M12 3c1 4 5 6 5 10a5 5 0 01-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-4-1-6 1-9z" /></svg>
        <div class="serif">火堆旁很安靜……說點什麼吧</div>
      </div>
    {/if}
    {#each visible as m (m.id)}
      <div class="item" out:fade={{ duration: motion.reduced ? 0 : 700 }}>
        <MessageItem message={m} mine={isMine(m)} mention={isMention(m)} stage={fadeStage(m.expiresMs - now)} />
      </div>
    {/each}
  </div>

  {#if unread > 0 && !atBottom}
    <button class="pill" type="button" onclick={toBottom}>
      有 {unread} 則新訊息
      <svg class="ic" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 5v14" /><path d="M6 13l6 6 6-6" /></svg>
    </button>
  {/if}
</div>

<style>
  .wrap {
    position: relative;
    flex: 1;
    min-height: 120px;
    display: flex;
    flex-direction: column;
  }
  .chat {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 12px 14px 8px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    overscroll-behavior: contain;
  }
  /* 內容少的時候,訊息貼著底部,像營火邊的對話一路往上長 */
  .chat > :global(:first-child) {
    margin-top: auto;
  }
  .item {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    text-align: center;
    color: var(--ember);
    padding: 0 32px;
  }
  .empty .serif {
    font-size: 17px;
    font-weight: 600;
    color: var(--text);
  }
  .pill {
    position: absolute;
    left: 50%;
    bottom: 12px;
    transform: translateX(-50%);
    min-height: 44px;
    background: var(--amber);
    color: var(--onamber);
    border: 0;
    border-radius: 22px 24px 22px 24px;
    padding: 0 18px;
    font-weight: 700;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4);
    white-space: nowrap;
  }
</style>
