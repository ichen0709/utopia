// 程式啟動失敗時,畫面上顯示一行白話說明,而不是一片黑。
// 這裡不依賴 Svelte、不依賴樣式檔(它們可能就是壞掉的原因),所以全部用最基本的方式寫,而且只用文字節點。

export function showStartupError(error: unknown): void {
  try {
    console.error('營火聊天室啟動失敗', error);
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);

    const box = document.createElement('div');
    box.setAttribute('role', 'alert');
    box.setAttribute('data-startup-error', '');
    box.style.cssText =
      'box-sizing:border-box;width:calc(100% - 32px);max-width:420px;margin:15vh auto 0;padding:24px;' +
      'font:16px/1.7 "Noto Sans TC","PingFang TC","Microsoft JhengHei",system-ui,sans-serif;' +
      'color:#f4ead6;background:#171e38;border:1.5px dashed #f7bd62;border-radius:18px 20px 18px 20px;';

    const title = document.createElement('div');
    title.textContent = '營火暫時點不起來';
    title.style.cssText = 'font-size:20px;font-weight:700;margin-bottom:8px;';

    const help = document.createElement('div');
    help.textContent = '程式啟動時出了問題。請重新整理頁面;如果還是這樣,請把下面這行錯誤回報給開發者。';

    const code = document.createElement('code');
    code.textContent = detail;
    code.style.cssText =
      'display:block;margin-top:12px;padding:8px 10px;font:13px/1.5 ui-monospace,Consolas,monospace;' +
      'color:#cfc6b4;background:#0b1020;border-radius:8px;overflow-wrap:anywhere;';

    box.append(title, help, code);

    const host = document.getElementById('app') ?? document.body;
    host.replaceChildren(box);
    document.documentElement.style.background = '#0b1020';
    document.body.style.background = '#0b1020';
  } catch {
    // 連顯示錯誤都失敗了,就只能留在 Console
  }
}
