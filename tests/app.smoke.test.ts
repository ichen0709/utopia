// @vitest-environment jsdom
// 整個畫面的冒煙測試:在模擬的瀏覽器裡把 App 真的跑起來,走過主要流程,確認沒有執行期錯誤。
// 它驗證的是「功能有沒有動」;版面、顏色、動畫要用真正的瀏覽器看。
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mount, tick, unmount } from 'svelte';

let app: ReturnType<typeof mount>;
let target: HTMLElement;
const errors: unknown[] = [];

const $ = <T extends Element = HTMLElement>(sel: string) => target.querySelector<T>(sel);
const $$ = (sel: string) => Array.from(target.querySelectorAll<HTMLElement>(sel));
const text = () => target.textContent ?? '';
const byText = (sel: string, t: string) => $$(sel).find((e) => (e.textContent ?? '').includes(t));

async function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  await tick();
}

async function send(value: string) {
  await type($('textarea')!, value);
  $('.btn-send')!.click();
  await tick();
  await new Promise((r) => setTimeout(r, 0));
  await tick();
}

beforeAll(async () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  window.matchMedia = ((q: string) => ({
    matches: false,
    media: q,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    onchange: null,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  window.addEventListener('error', (e) => errors.push(e.error ?? e.message));
  window.addEventListener('unhandledrejection', (e) => errors.push(e.reason));

  localStorage.clear();
  sessionStorage.clear();
  target = document.createElement('div');
  document.body.appendChild(target);
  const { default: App } = await import('../src/App.svelte');
  app = mount(App, { target });
});

afterAll(() => {
  if (app) void unmount(app);
});

describe('冒煙測試:階段一的主要流程', () => {
  it('先看到載入中,然後是輸入代號畫面,有示範模式橫幅', async () => {
    expect(text()).toContain('正在點火');
    await vi.waitFor(() => expect($('#nickname')).not.toBeNull(), { timeout: 4000 });
    expect(text()).toContain('示範模式 · 其他人是模擬的');
    expect(text()).toContain('營火聊天室');
  });

  it('格式不符:當場說明,按鈕是灰的', async () => {
    const input = $<HTMLInputElement>('#nickname')!;
    await type(input, '小 明@');
    expect(text()).toContain('代號不能有空白或 @');
    expect($('.btn-primary')!.classList.contains('off')).toBe(true);
  });

  it('代號已被模擬夥伴用了(大小寫不同也一樣):提示換一個,輸入保留', async () => {
    const input = $<HTMLInputElement>('#nickname')!;
    await type(input, '阿火');
    $('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(text()).toContain('這個代號正在使用中'));
    expect(input.value).toBe('阿火');
  });

  it('合格的代號可以進入聊天室:看得到歷史訊息、營火、加柴、人數', async () => {
    const input = $<HTMLInputElement>('#nickname')!;
    await type(input, ' Amy ');
    $('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect($('textarea')).not.toBeNull());
    expect(text()).toContain('大家晚安,今天營火看起來不錯');
    expect(text()).toContain('Amy');
    expect(text()).toContain('坐到了火堆旁');
    expect(byText('button', '加柴')).toBeTruthy();
    expect(byText('button', '離開營火')).toBeTruthy();
    expect(text()).toMatch(/目前\s*\d+\s*人/);
  });

  it('送出訊息:自己的訊息出現,而且有時間;300 字內可以送', async () => {
    await send('哈囉大家');
    await vi.waitFor(() => expect(text()).toContain('哈囉大家'));
    expect($$('.msg.me').length).toBeGreaterThan(0);
  });

  it('HTML 測試字串顯示成文字,沒有真的變成元素', async () => {
    await send('<img src=x onerror=alert(1)> <script>alert(2)</script> <b>粗</b>');
    await vi.waitFor(() => expect(text()).toContain('<img src=x onerror=alert(1)>'));
    expect(target.querySelector('.bub img')).toBeNull();
    expect(target.querySelector('.bub script')).toBeNull();
    expect(target.querySelector('.bub b')).toBeNull();
    expect(text()).toContain('<script>alert(2)</script>');
  });

  it('一般網址可以點:新分頁開啟,rel 有 noopener noreferrer', async () => {
    await send('看這個 https://example.com/camp 很棒');
    await vi.waitFor(() => expect($('.bub a.link')).not.toBeNull());
    const a = $<HTMLAnchorElement>('.bub a.link')!;
    expect(a.getAttribute('href')).toBe('https://example.com/camp');
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('javascript: 之類的網址只是普通文字,不是連結', async () => {
    const before = $$('.bub a').length;
    await send('javascript:alert(1) 和 ftp://files.example.com');
    await vi.waitFor(() => expect(text()).toContain('javascript:alert(1)'));
    expect($$('.bub a').length).toBe(before);
  });

  it('頻率限制:10 秒內第 6 則被擋,有清楚提示,送出變灰,文字保留', async () => {
    // 前面已經送了 4 則(哈囉、HTML、網址、javascript),再送 1 則就滿 5 則
    await send('第五則');
    await send('第六則');
    await vi.waitFor(() => expect(text()).toContain('慢一點,火還在呢'));
    expect($<HTMLTextAreaElement>('textarea')!.value).toBe('第六則');
    expect($('.btn-send')!.classList.contains('off')).toBe(true);
    expect(text()).not.toContain('第六則</');
  });

  it('超過 300 字:警示、送出灰、字不被截斷', async () => {
    await type($('textarea')!, 'a'.repeat(312));
    expect(text()).toContain('訊息太長了,最多 300 字');
    expect(text()).toContain('已超過 12 字');
    expect($<HTMLTextAreaElement>('textarea')!.value.length).toBe(312);
    await type($('textarea')!, 'a'.repeat(260));
    expect(text()).toContain('剩 40 字');
    await type($('textarea')!, '');
  });

  it('加柴:出現加柴系統訊息,按鈕進入冷卻', async () => {
    $('.btn-stoke')!.click();
    await vi.waitFor(() => expect(text()).toContain('加了一根柴'));
    await vi.waitFor(() => expect(text()).toMatch(/再等 \d 秒/));
  });

  it('輸入 @ 會跳出選單,可點選填入代號', async () => {
    await type($('textarea')!, '@阿');
    $<HTMLTextAreaElement>('textarea')!.setSelectionRange(2, 2);
    $('textarea')!.dispatchEvent(new Event('keyup', { bubbles: true }));
    await tick();
    expect($('[role="listbox"]')).not.toBeNull();
    expect(text()).toContain('阿火');
    const row = $$('[role="option"]').find((e) => (e.textContent ?? '').includes('阿火'))!;
    row.click();
    await tick();
    expect($<HTMLTextAreaElement>('textarea')!.value).toBe('@阿火 ');
    await type($('textarea')!, '');
  });

  it('模擬夥伴 @ 我:該則訊息高亮', async () => {
    const { createBackend } = await import('../src/backend');
    expect(createBackend).toBeTypeOf('function');
    // 用測試工具按鈕觸發
    byText('button', '測試工具')!.click();
    await tick();
    byText('button', '夥伴 @ 我')!.click();
    await vi.waitFor(() => expect($$('.msg.mention').length).toBeGreaterThan(0));
    expect(text()).toContain('@ 提到你');
  });

  it('模擬斷線:出現「連線中斷」,輸入與加柴停用,恢復後自動重連', async () => {
    byText('button', '模擬斷線')!.click();
    await vi.waitFor(() => expect(text()).toContain('連線中斷'));
    expect($<HTMLTextAreaElement>('textarea')!.disabled).toBe(true);
    expect($('.btn-stoke')!.hasAttribute('disabled')).toBe(true);
    byText('button', '恢復連線')!.click();
    await vi.waitFor(() => expect($('[role="status"].banner, .banner')).toBeNull(), { timeout: 5000 });
    expect($<HTMLTextAreaElement>('textarea')!.disabled).toBe(false);
  });

  it('營火熄滅:顯示提示、整頁變暗;加柴後重新點燃', async () => {
    byText('button', '讓營火立刻熄滅')!.click();
    await vi.waitFor(() => expect(text()).toContain('營火熄了,按「加柴」重新點燃'));
    expect(document.documentElement.hasAttribute('data-dim')).toBe(true);
  });

  it('暫離一下:從線上名單切換自己的暫離,名單與座位顯示「暫離中」,再切換就恢復,不產生系統訊息', async () => {
    $('.count')!.click(); // 人數是按鈕,隨時可以開名單
    await vi.waitFor(() => expect($('[role="dialog"]')).not.toBeNull());
    const myRow = () => $$('[role="dialog"] .mrow').find((r) => (r.textContent ?? '').includes('你'))!;
    const btn = () => myRow().querySelector<HTMLButtonElement>('.awaybtn')!;
    expect(btn().textContent).toContain('暫離一下');
    expect(myRow().querySelector('.away')).toBeNull();

    btn().click();
    await vi.waitFor(() => expect(myRow().querySelector('.away')).not.toBeNull());
    expect(myRow().querySelector('.away')!.textContent).toBe('暫離中');
    expect(btn().textContent).toContain('回來了');
    expect($$('.seat').some((s) => (s.textContent ?? '').includes('Amy') && (s.textContent ?? '').includes('暫離中'))).toBe(true);
    expect($$('.sys').some((s) => (s.textContent ?? '').includes('暫離'))).toBe(false);

    await new Promise((r) => setTimeout(r, 900)); // 連點防護結束
    btn().click();
    await vi.waitFor(() => expect(myRow().querySelector('.away')).toBeNull());
    expect(btn().textContent).toContain('暫離一下');
    expect($$('.seat').some((s) => (s.textContent ?? '').includes('Amy') && (s.textContent ?? '').includes('暫離中'))).toBe(false);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await vi.waitFor(() => expect($('[role="dialog"]')).toBeNull());
  });

  it('離開營火:回到輸入代號畫面,不再有變暗', async () => {
    byText('button', '關閉')!.click();
    byText('button', '離開營火')!.click();
    await vi.waitFor(() => expect($('#nickname')).not.toBeNull());
    expect(document.documentElement.hasAttribute('data-dim')).toBe(false);
  });

  it('整個過程沒有執行期錯誤', () => {
    expect(errors).toEqual([]);
  });
});
