<script lang="ts">
  // 「示範模式 · 其他人是模擬的」橫幅 —— 只在階段一(模擬後端)出現。
  // 階段二換成 Supabase 後端時,backend.isDemo 為 false,畫面會自動不再顯示這條橫幅,
  // 也不會出現旁邊的「測試工具」。要整個拿掉的話,刪掉這個檔案與它的引用即可。
  import type { DevTools } from '../backend/types';
  import DevPanel from './DevPanel.svelte';

  let { devTools }: { devTools?: DevTools } = $props();
</script>

<div class="demo">
  <svg class="ic" viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path d="M12 3c1 4 5 6 5 10a5 5 0 01-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-4-1-6 1-9z" /></svg>
  <span>示範模式 · 其他人是模擬的</span>
  {#if devTools}<DevPanel tools={devTools} />{/if}
</div>

<style>
  .demo {
    position: relative;
    min-height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 0 8px;
    font-size: 12px;
    color: var(--soft);
    background: var(--surface2);
    letter-spacing: 0.05em;
    flex: none;
  }
</style>
