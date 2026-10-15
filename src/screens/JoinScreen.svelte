<script lang="ts">
  // 輸入代號畫面。規則檢查用 shared/nickname(和伺服器同一份規則),伺服器的回應(代號使用中)另外顯示。
  import { onMount } from 'svelte';
  import type { ChatStore } from '../lib/chat.svelte';
  import Campfire from '../components/Campfire.svelte';
  import DemoBanner from '../components/DemoBanner.svelte';
  import { checkNickname, nicknameProblemText } from '../shared/nickname';
  import { chars } from '../shared/text';

  let { chat }: { chat: ChatStore } = $props();

  let value = $state('');
  let input: HTMLInputElement;

  const max = $derived(chat.config.nicknameMax);
  const check = $derived(checkNickname(value, max));
  // 還沒輸入時不報錯;輸入了不合規則就當場說明;伺服器說代號被用了,也顯示
  const formatError = $derived(value.length > 0 && !check.ok && check.problem !== 'empty' ? nicknameProblemText(check.problem, max) : null);
  const errorText = $derived(formatError ?? chat.joinError);
  const canJoin = $derived(check.ok && !chat.joining);

  onMount(() => input?.focus());

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (!canJoin) return;
    await chat.join(value);
  }
</script>

{#if chat.backend.isDemo}<DemoBanner devTools={chat.backend.devTools} />{/if}

<form class="join" onsubmit={submit} novalidate>
  <Campfire level="strong" />
  <h1 class="h1 serif">營火聊天室</h1>
  <p class="lead">找個位置坐下,和圍著火的人聊聊。不用註冊,取個代號就好。</p>

  {#if chat.joinNotice}
    <div class="note" role="status">{chat.joinNotice}</div>
  {/if}

  <label class="lbl" for="nickname">你的代號</label>
  <div class="input" class:err={!!errorText}>
    <input
      id="nickname"
      bind:this={input}
      bind:value
      type="text"
      placeholder="例:夜貓"
      autocomplete="off"
      autocapitalize="off"
      spellcheck="false"
      aria-invalid={!!errorText}
      aria-describedby="nick-help"
      oninput={() => (chat.joinError = null)}
    />
    <span class="n" aria-hidden="true">{chars(value)}/{max}</span>
  </div>
  <div class="helper" id="nick-help">
    {#if errorText}
      <div class="errtxt" role="alert">
        <svg class="ic" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v6" /><path d="M12 16.5v.5" /></svg>
        <span>{errorText}</span>
      </div>
    {:else}
      1 到 {max} 個字,不能有空白或 @
    {/if}
  </div>

  <button class="btn btn-primary" class:off={!canJoin} type="submit" aria-disabled={!canJoin}>坐到火堆旁</button>
  <div class="foot">訊息會在 30 分鐘後像火星一樣散去</div>
</form>

<style>
  .join {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 22px 28px 30px;
  }
  .h1 {
    font-size: 30px;
    font-weight: 700;
    line-height: 1.25;
    text-align: center;
    margin: 6px 0 8px;
  }
  .lead {
    text-align: center;
    color: var(--soft);
    font-size: 15px;
    margin: 0 0 24px;
    max-width: 300px;
  }
  .lbl {
    align-self: stretch;
    font-weight: 600;
    font-size: 14px;
    margin-bottom: 6px;
  }
  .input {
    align-self: stretch;
    min-height: 52px;
    border-radius: 16px 14px 16px 14px;
    background: var(--surface);
    border: 1.5px solid var(--line);
    padding: 0 14px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .input:focus-within {
    border-color: var(--amber);
    box-shadow: 0 0 0 3px rgba(247, 189, 98, 0.28);
  }
  .input.err {
    border-color: var(--danger);
    box-shadow: 0 0 0 3px rgba(255, 154, 133, 0.18);
  }
  input {
    flex: 1;
    min-width: 0;
    min-height: 48px;
    border: 0;
    background: none;
    color: var(--text);
    font: inherit;
    font-size: 17px;
  }
  input::placeholder {
    color: var(--muted);
  }
  input:focus-visible {
    outline: none;
  }
  .n {
    font-size: 12px;
    color: var(--muted);
    flex: none;
  }
  .helper {
    align-self: stretch;
    margin: 8px 0 14px;
    font-size: 13px;
    color: var(--muted);
    min-height: 40px;
  }
  .errtxt {
    color: var(--danger);
    font-weight: 700;
    display: flex;
    gap: 6px;
    align-items: flex-start;
  }
  .btn-primary {
    align-self: stretch;
    min-height: 54px;
    font-size: 18px;
    font-weight: 700;
    background: linear-gradient(180deg, #ffc873, #f28a3a);
    color: #1c1108;
    border-radius: 27px 29px 27px 29px;
    box-shadow: 0 8px 24px rgba(242, 138, 58, 0.35);
  }
  .btn-primary.off {
    background: var(--surface2);
    color: var(--muted);
    box-shadow: none;
    border: 1.5px dashed var(--line);
    cursor: default;
  }
  .foot {
    margin-top: auto;
    padding-top: 20px;
    font-size: 13px;
    color: var(--muted);
    text-align: center;
  }
  .note {
    align-self: stretch;
    margin-bottom: 16px;
    padding: 10px 14px;
    border: 1.5px dashed var(--amber);
    border-radius: 14px 16px 14px 16px;
    background: var(--mention);
    font-size: 14px;
  }
</style>
