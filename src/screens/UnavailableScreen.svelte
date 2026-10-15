<script lang="ts">
  // 連不上後端時的畫面(階段二接上 Supabase 後才會真的遇到;階段一可用網址參數 ?unavailable=12 看到)。
  import { RETRY_SECONDS } from '../config';
  import Campfire from '../components/Campfire.svelte';
</script>

<div class="center" role="status" aria-live="polite">
  <Campfire level="out" />
  <div class="serif title">營火暫時點不起來</div>
  <p>我們正在重新嘗試連線,好了會自動回到營火旁,不用重新整理。</p>
  <div class="dots" aria-hidden="true"><span></span><span></span><span></span></div>
  <div class="retry">下次重試約 {RETRY_SECONDS} 秒後</div>
</div>

<style>
  .center {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 0 36px;
    text-align: center;
  }
  .title {
    font-size: 22px;
    font-weight: 700;
  }
  p {
    margin: 0;
    color: var(--soft);
    max-width: 280px;
  }
  .retry {
    font-size: 13px;
    color: var(--muted);
  }
  .dots span {
    display: inline-block;
    width: 7px;
    height: 7px;
    margin: 0 3px;
    border-radius: 50%;
    background: var(--amber);
    animation: blink 1.2s ease-in-out infinite;
  }
  .dots span:nth-child(2) {
    animation-delay: 0.2s;
  }
  .dots span:nth-child(3) {
    animation-delay: 0.4s;
  }
  @keyframes blink {
    0%,
    100% {
      opacity: 0.25;
    }
    50% {
      opacity: 1;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .dots span {
      animation: none;
      opacity: 0.8;
    }
  }
</style>
