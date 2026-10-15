import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// 只有「跑自動測試」時,VITEST 這個環境變數才會存在
const isTest = !!process.env.VITEST;

// GitHub Pages 的網址是 https://<帳號>.github.io/utopia/,所以網站不在根目錄,base 必須是 /utopia/
export default defineConfig({
  base: '/utopia/',
  plugins: [svelte()],
  // 重要:一般的預覽(dev)與編譯(build)不可以設定 resolve.conditions。
  // Vite 的 resolve.conditions 是「整個取代」預設值,不是「追加」:只要寫了(哪怕是空陣列),
  // 就會失去預設的 'browser',瀏覽器載入到 Svelte 的伺服器版本,畫面一片黑,
  // Console 出現 lifecycle_function_unavailable。
  // 測試是在模擬瀏覽器 (jsdom) 裡跑,才需要明確指定 browser 版本,所以只在測試時設定。
  ...(isTest ? { resolve: { conditions: ['browser'] } } : {}),
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
