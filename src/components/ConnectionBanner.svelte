<script lang="ts">
  // 連線中斷橫幅。連線正常時不會被畫出來(由呼叫端決定)。
</script>

<div class="banner" role="status" aria-live="polite">
  <svg class="ic" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M2 8.8a15 15 0 0120 0" /><path d="M5 12.6a10 10 0 0114 0" /><path d="M8.5 16.3a5 5 0 017 0" /><path d="M12 20h.01" /><path d="M3 3l18 18" /></svg>
  <div>
    <strong>連線中斷</strong>
    <div class="sub">正在重新連線,請稍候…</div>
  </div>
</div>

<style>
  .banner {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 40px;
    padding: 8px 14px;
    background: var(--dangerbg);
    color: var(--text);
    border-top: 1px solid var(--danger);
    border-bottom: 1px solid var(--danger);
    font-size: 14px;
    font-weight: 600;
  }
  .banner .ic {
    color: var(--danger);
  }
  .sub {
    font-weight: 400;
    color: var(--soft);
    font-size: 13px;
  }
</style>
