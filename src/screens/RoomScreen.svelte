<script lang="ts">
  // 聊天室主畫面:頂部列、(連線中斷橫幅)、營火場景、聊天區、輸入區、完整名單面板。
  import type { ChatStore } from '../lib/chat.svelte';
  import { clock } from '../lib/clock.svelte';
  import { levelAt, stateOf } from '../shared/fire';
  import CampScene from '../components/CampScene.svelte';
  import Composer from '../components/Composer.svelte';
  import ConnectionBanner from '../components/ConnectionBanner.svelte';
  import DemoBanner from '../components/DemoBanner.svelte';
  import MessageList from '../components/MessageList.svelte';
  import RosterPanel from '../components/RosterPanel.svelte';
  import SoundToggle from '../components/SoundToggle.svelte';

  let { chat }: { chat: ChatStore } = $props();

  let panelOpen = $state(false);

  const now = $derived(clock.now + chat.offset);
  const offline = $derived(chat.connection === 'offline');

  // 火的亮度:存下來的亮度 − 流逝時間 × 衰減速度。沒人操作時完全不需要流量。
  const level = $derived(
    chat.fire
      ? levelAt(chat.fire.level, Date.parse(chat.fire.updatedAt), now, chat.config.fireSecondsPerPoint)
      : chat.config.fireStartLevel,
  );
  const fireState = $derived(stateOf(level));

  // 不會超過冷卻總秒數(按下後經過網路與計算的零點幾秒,不要讓畫面顯示「再等 6 秒」)
  const stokeSeconds = $derived(
    Math.min(chat.config.stokeCooldownSeconds, Math.max(0, Math.ceil((chat.stokeUntil - now) / 1000))),
  );
  const stokeState = $derived(offline ? 'off' : stokeSeconds > 0 ? 'cooldown' : 'ready');
  const rateSeconds = $derived(Math.max(0, Math.ceil((chat.rateUntil - now) / 1000)));

  // 火熄滅:整頁變暗(文字色不變,見 docs/design.md 6.2)
  $effect(() => {
    document.documentElement.toggleAttribute('data-dim', fireState === 'out');
    return () => document.documentElement.removeAttribute('data-dim');
  });

  function mention(nickname: string) {
    chat.requestMention(nickname);
  }
</script>

{#if chat.backend.isDemo}<DemoBanner devTools={chat.backend.devTools} />{/if}

<header class="topbar">
  <button class="btn btn-leave" type="button" onclick={() => chat.leave()}>
    <svg class="ic" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M9 4H5v16h4" /><path d="M14 8l4 4-4 4" /><path d="M18 12H9" /></svg>
    離開營火
  </button>
  <div class="count">
    <svg class="ic" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="9" cy="8" r="3.2" /><path d="M3 20c0-3.5 2.7-6 6-6s6 2.5 6 6" /><circle cx="17" cy="9" r="2.5" /><path d="M17 14c2.5 0 4.5 2 4.5 5" /></svg>
    目前 <b>{chat.members.length}</b> 人
  </div>
  <SoundToggle on={chat.soundOn} ontoggle={() => chat.toggleSound()} />
</header>

{#if offline}<ConnectionBanner />{/if}

<CampScene
  fire={fireState}
  members={chat.members}
  me={chat.me}
  stoke={stokeState}
  secondsLeft={stokeSeconds}
  cooldownSeconds={chat.config.stokeCooldownSeconds}
  onstoke={() => chat.stoke()}
  onmention={mention}
  onopen={() => (panelOpen = true)}
/>

<MessageList messages={chat.messages} me={chat.me} offset={chat.offset} />

<Composer
  members={chat.members}
  me={chat.me}
  maxLength={chat.config.maxMessageLength}
  disabled={offline}
  rateSecondsLeft={rateSeconds}
  request={chat.mentionRequest}
  onsend={(text) => chat.send(text)}
/>

{#if panelOpen}
  <RosterPanel
    members={chat.members}
    me={chat.me}
    onclose={() => (panelOpen = false)}
    onpick={(nickname) => {
      panelOpen = false;
      mention(nickname);
    }}
  />
{/if}

<style>
  .topbar {
    height: 56px;
    flex: none;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 12px;
    background: var(--bg);
  }
  .btn-leave {
    border-color: var(--ember);
    background: var(--surface);
    color: var(--text);
    font-size: 15px;
  }
  .btn-leave .ic {
    color: var(--ember);
  }
  .count {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 14px;
    font-weight: 500;
    color: var(--soft);
  }
  .count b {
    color: var(--text);
    font-weight: 700;
  }
</style>
