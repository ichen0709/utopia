<script lang="ts">
  import { onMount } from 'svelte';
  import { createBackend } from './backend';
  import { ChatStore } from './lib/chat.svelte';
  import JoinScreen from './screens/JoinScreen.svelte';
  import LoadingScreen from './screens/LoadingScreen.svelte';
  import RoomScreen from './screens/RoomScreen.svelte';
  import UnavailableScreen from './screens/UnavailableScreen.svelte';

  // 畫面只認 ChatBackend 合約;用哪個後端由 backend/index.ts 決定
  const chat = new ChatStore(createBackend());

  onMount(() => {
    void chat.init();
  });

  function onVisibility() {
    if (document.visibilityState === 'visible') chat.pageVisible();
  }
</script>

<svelte:window onpagehide={() => chat.pageHide()} onpageshow={() => chat.pageVisible()} />
<svelte:document onvisibilitychange={onVisibility} />

<div class="frame">
  {#if chat.phase === 'loading'}
    <LoadingScreen demo={chat.backend.isDemo} devTools={chat.backend.devTools} />
  {:else if chat.phase === 'unavailable'}
    <UnavailableScreen />
  {:else if chat.phase === 'join'}
    <JoinScreen {chat} />
  {:else}
    <RoomScreen {chat} />
  {/if}
</div>

<style>
  .frame {
    position: relative;
    width: 100%;
    max-width: 507px;
    height: 100dvh;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    background: var(--bg);
    box-shadow: var(--shadow);
    overflow: hidden;
    transition: background 1.2s ease;
  }
  @media (prefers-reduced-motion: reduce) {
    .frame {
      transition: none;
    }
  }
</style>
