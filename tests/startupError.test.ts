// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { showStartupError } from '../src/startupError';

afterEach(() => {
  document.body.replaceChildren();
});

describe('程式啟動失敗的錯誤提示', () => {
  it('顯示一行白話說明加上錯誤內容,而且錯誤內容只當文字', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const app = document.createElement('div');
    app.id = 'app';
    document.body.appendChild(app);

    showStartupError(new Error('<img src=x onerror=alert(1)>'));

    const box = document.querySelector('[data-startup-error]')!;
    expect(box).not.toBeNull();
    expect(box.textContent).toContain('營火暫時點不起來');
    expect(box.textContent).toContain('請重新整理頁面');
    expect(box.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(box.querySelector('img')).toBeNull();
  });

  it('找不到 #app 時,顯示在 body 上', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    showStartupError('boom');
    expect(document.body.querySelector('[data-startup-error]')).not.toBeNull();
  });
});
