<script lang="ts">
  // 輸入區:輸入框、送出、字數提示、被限速的提示、斷線時停用(文字保留)、@ 選單。
  import { tick } from 'svelte';
  import type { Member } from '../backend/types';
  import { activeMentionToken } from '../shared/mention';
  import { messageLength } from '../shared/message';
  import { nicknameKey } from '../shared/nickname';
  import MentionMenu from './MentionMenu.svelte';

  let {
    members,
    me,
    maxLength,
    disabled,
    rateSecondsLeft,
    request,
    onsend,
  }: {
    members: Member[];
    me: string | null;
    maxLength: number;
    /** 斷線時整個輸入區停用,已輸入的文字保留 */
    disabled: boolean;
    rateSecondsLeft: number;
    request: { nickname: string; n: number } | null;
    onsend: (text: string) => Promise<boolean>;
  } = $props();

  const NEAR_LIMIT = 50;

  let text = $state('');
  let caret = $state(0);
  let el: HTMLTextAreaElement;
  let sending = $state(false);
  let active = $state(0);
  let dismissedAt = $state(-1);
  let lastRequest = 0;

  const length = $derived(messageLength(text));
  const remaining = $derived(maxLength - length);
  const over = $derived(remaining < 0);
  const near = $derived(remaining >= 0 && remaining <= NEAR_LIMIT && length > 0);
  const blocked = $derived(rateSecondsLeft > 0);
  const canSend = $derived(!disabled && !blocked && !sending && length > 0 && !over);

  const token = $derived(disabled ? null : activeMentionToken(text, caret));
  const candidates = $derived.by(() => {
    if (!token || token.start === dismissedAt) return null;
    const q = nicknameKey(token.query);
    return members
      .filter((m) => !me || nicknameKey(m.nickname) !== nicknameKey(me))
      .filter((m) => nicknameKey(m.nickname).includes(q))
      .sort((a, b) => Number(!nicknameKey(a.nickname).startsWith(q)) - Number(!nicknameKey(b.nickname).startsWith(q)));
  });
  const menuOpen = $derived(candidates !== null);

  $effect(() => {
    // 篩選結果改變時,選取位置回到第一個
    void token?.query;
    active = 0;
  });

  // 點座位或名單時,要求在輸入框插入 @代號
  $effect(() => {
    const r = request;
    if (r && r.n !== lastRequest) {
      lastRequest = r.n;
      void insertMention(r.nickname);
    }
  });

  function resize() {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 72) + 'px';
  }

  function syncCaret() {
    caret = el?.selectionStart ?? text.length;
  }

  async function setText(next: string, caretAt: number) {
    text = next;
    await tick();
    resize();
    el.focus();
    el.setSelectionRange(caretAt, caretAt);
    caret = caretAt;
  }

  async function insertMention(nickname: string) {
    if (disabled) return;
    const at = el?.selectionStart ?? text.length;
    const before = text.slice(0, at);
    const after = text.slice(at);
    const lead = before && !/\s$/.test(before) ? ' ' : '';
    const insert = `${lead}@${nickname} `;
    await setText(before + insert + after, (before + insert).length);
  }

  async function pick(nickname: string) {
    if (!token) return;
    const before = text.slice(0, token.start);
    const after = text.slice(caret);
    const insert = `@${nickname} `;
    await setText(before + insert + after, (before + insert).length);
  }

  async function submit() {
    if (!canSend) return;
    sending = true;
    try {
      const ok = await onsend(text);
      if (ok) {
        text = '';
        await tick();
        resize();
      }
    } finally {
      sending = false;
    }
  }

  const isTouchDevice = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

  function onKeydown(e: KeyboardEvent) {
    if (e.isComposing || e.keyCode === 229) return;
    if (menuOpen && candidates) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const n = candidates.length || 1;
        active = (active + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
        return;
      }
      if ((e.key === 'Enter' || e.key === 'Tab') && candidates[active]) {
        e.preventDefault();
        void pick(candidates[active].nickname);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        dismissedAt = token?.start ?? -1;
        return;
      }
    }
    // 電腦:Enter 送出、Shift+Enter 換行。手機:Enter 換行,用送出按鈕送出。
    if (e.key === 'Enter' && !e.shiftKey && !isTouchDevice()) {
      e.preventDefault();
      void submit();
    }
  }
</script>

<div class="composer">
  {#if menuOpen && candidates}
    <MentionMenu {candidates} {active} onpick={pick} onhover={(i) => (active = i)} />
  {/if}

  <div class="cstatus">
    <span class:slow={blocked && !over} class:bad={(over || disabled) && !blocked}>
      {#if over}
        訊息太長了,最多 {maxLength} 字
      {:else if blocked}
        慢一點,火還在呢 · {rateSecondsLeft} 秒後可再送
      {:else if disabled}
        連線中斷,已輸入的字會保留
      {/if}
    </span>
    <span class:warn={near} class:bad={over} aria-live="polite">
      {#if over}
        已超過 {-remaining} 字
      {:else if near}
        剩 {remaining} 字
      {/if}
    </span>
  </div>

  <div class="crow">
    <textarea
      bind:this={el}
      bind:value={text}
      class="field"
      class:err={over}
      rows="1"
      placeholder="說點什麼…"
      aria-label="輸入訊息"
      aria-invalid={over}
      autocomplete="off"
      autocapitalize="off"
      {disabled}
      oninput={() => {
        resize();
        syncCaret();
        dismissedAt = -1;
      }}
      onkeyup={syncCaret}
      onclick={syncCaret}
      onfocus={syncCaret}
      onkeydown={onKeydown}
    ></textarea>
    <button class="btn btn-send" class:off={!canSend} type="button" aria-disabled={!canSend} onclick={submit}>
      <svg class="ic" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 12l16-8-6 16-3-7z" /></svg>
      {blocked ? `等 ${rateSecondsLeft} 秒` : '送出'}
    </button>
  </div>
</div>

<style>
  .composer {
    position: relative;
    flex: none;
    background: var(--bg2);
    border-top: 1px solid var(--line);
    padding: 6px 12px max(14px, env(safe-area-inset-bottom));
  }
  .cstatus {
    min-height: 20px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: var(--muted);
    padding: 0 2px 4px;
  }
  .cstatus .warn {
    color: var(--ember);
    font-weight: 700;
  }
  .cstatus .bad {
    color: var(--danger);
    font-weight: 700;
  }
  .cstatus .slow {
    background: var(--mention);
    border: 1px solid var(--mline);
    color: var(--text);
    padding: 2px 10px;
    border-radius: 12px;
    font-weight: 600;
  }
  .crow {
    display: flex;
    gap: 8px;
    align-items: flex-end;
  }
  .field {
    flex: 1;
    min-width: 0;
    min-height: 44px;
    max-height: 72px;
    resize: none;
    border-radius: 14px 16px 14px 16px;
    background: var(--surface);
    border: 1.5px solid var(--line);
    padding: 10px 12px;
    font: inherit;
    font-size: 15px;
    line-height: 22px;
    color: var(--text);
    overflow-wrap: anywhere;
  }
  .field::placeholder {
    color: var(--muted);
  }
  .field:focus-visible {
    outline: none;
    border-color: var(--amber);
    box-shadow: 0 0 0 3px rgba(247, 189, 98, 0.28);
  }
  .field.err {
    border-color: var(--danger);
    box-shadow: 0 0 0 3px rgba(255, 154, 133, 0.18);
  }
  .field:disabled {
    border-style: dashed;
    background: var(--bg2);
    color: var(--muted);
  }
  .btn-send {
    min-width: 76px;
    padding: 0 14px;
    background: var(--amber);
    color: var(--onamber);
    border-radius: 16px 18px 16px 18px;
    flex: none;
  }
  .btn-send.off {
    background: var(--surface2);
    color: var(--muted);
    border: 1.5px dashed var(--line);
    cursor: default;
  }
</style>
