<script lang="ts">
  // 單則訊息。內容一律「當文字」放進畫面:沒有 innerHTML,也沒有 {@html}。
  // 連結片段只會是 http / https 網址(由 shared/linkify 判斷),而且在新分頁開啟、不能控制原頁。
  import type { ViewMessage } from '../lib/chat.svelte';
  import { colorIndex } from '../shared/color';
  import { splitMessage } from '../shared/linkify';
  import { formatClock } from '../shared/time';

  let {
    message,
    mine,
    mention,
    stage,
  }: {
    message: ViewMessage;
    mine: boolean;
    mention: boolean;
    stage: 0 | 1 | 2;
  } = $props();

  const segments = $derived(message.kind === 'chat' ? splitMessage(message.body ?? '') : []);
  const time = $derived(formatClock(message.createdMs));
  const color = $derived(colorIndex(message.nickname));
</script>

{#if message.kind === 'chat'}
  <div class="msg" class:me={mine} class:mention class:stage1={stage === 1} class:stage2={stage === 2}>
    <div class="meta">
      {#if mine}
        <span>{time}</span><b class="c{color}">{message.nickname}</b>
      {:else}
        <b class="c{color}">{message.nickname}</b><span>{time}</span>
        {#if mention}<span class="atag">@ 提到你</span>{/if}
      {/if}
    </div>
    <div class="bub">
      {#each segments as seg, i (i)}
        {#if seg.type === 'link'}
          <a class="link" href={seg.href} target="_blank" rel="noopener noreferrer">{seg.text}</a>
        {:else}
          {seg.text}
        {/if}
      {/each}
    </div>
  </div>
{:else}
  <div class="sys" class:stage1={stage === 1} class:stage2={stage === 2}>
    {#if message.kind === 'fire'}
      <svg class="ic fire" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M12 3c1 4 5 6 5 10a5 5 0 01-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-4-1-6 1-9z" /></svg>
    {:else}
      <span class="dot" class:out={message.kind === 'leave'}></span>
    {/if}
    <span>
      <b class="c{color}">{message.nickname}</b>
      {message.kind === 'join' ? '坐到了火堆旁' : message.kind === 'leave' ? '離開了營火' : '加了一根柴'}
    </span>
    <span class="t">{time}</span>
  </div>
{/if}

<style>
  .msg {
    max-width: 84%;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
    transition: opacity 1.5s ease;
  }
  .msg.me {
    align-self: flex-end;
    align-items: flex-end;
  }
  .meta {
    display: flex;
    gap: 8px;
    align-items: baseline;
    font-size: 12px;
    color: var(--muted);
    min-width: 0;
  }
  .meta b {
    font-weight: 700;
    font-size: 13px;
    overflow-wrap: anywhere;
  }
  .bub {
    padding: 8px 12px;
    border-radius: 5px 16px 15px 17px;
    background: var(--surface);
    border: 1px solid var(--line);
    font-size: 15px;
    line-height: 1.5;
    overflow-wrap: anywhere;
    word-break: break-word;
    white-space: pre-wrap;
    min-width: 0;
    max-width: 100%;
  }
  .me .bub {
    background: var(--own);
    border-color: var(--ownline);
    border-radius: 17px 5px 17px 15px;
  }
  .mention .bub {
    background: var(--mention);
    border: 1.5px solid var(--mline);
    box-shadow:
      0 0 0 3px rgba(247, 189, 98, 0.16),
      0 0 18px rgba(247, 189, 98, 0.22);
  }
  .atag {
    display: inline-flex;
    align-items: center;
    font-size: 12px;
    font-weight: 700;
    color: var(--onamber);
    background: var(--amber);
    padding: 1px 8px;
    border-radius: 9px;
  }
  .link {
    color: var(--link);
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .sys {
    align-self: center;
    max-width: 92%;
    display: flex;
    gap: 6px;
    align-items: center;
    justify-content: center;
    flex-wrap: wrap;
    text-align: center;
    font-size: 13px;
    color: var(--soft);
    overflow-wrap: anywhere;
    transition: opacity 1.5s ease;
  }
  .sys .t {
    font-size: 12px;
    color: var(--muted);
  }
  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--ember);
    flex: none;
  }
  .dot.out {
    background: var(--muted);
  }
  .fire {
    color: var(--ember);
  }
  /* 快到期的訊息慢慢變淡(最後約 60 秒、約 20 秒) */
  .stage1 {
    opacity: 0.55;
  }
  .stage2 {
    opacity: 0.25;
  }
  @media (prefers-reduced-motion: reduce) {
    .msg,
    .sys {
      transition: none;
    }
    .stage1,
    .stage2 {
      opacity: 1;
    }
  }
</style>
