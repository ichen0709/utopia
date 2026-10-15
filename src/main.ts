import { mount } from 'svelte';
import './styles/global.css';
import App from './App.svelte';
import { showStartupError } from './startupError';

let app: ReturnType<typeof mount> | undefined;

try {
  // 如果 index.html 的備用檢查先顯示了錯誤(例如網路很慢),啟動成功後把它拿掉
  document.querySelector('[data-startup-error]')?.remove();
  app = mount(App, { target: document.getElementById('app')! });
  // 啟動成功:告訴 index.html 裡的備用檢查,不需要再顯示錯誤
  (window as { __campfireStarted?: boolean }).__campfireStarted = true;
} catch (e) {
  showStartupError(e);
}

export default app;
