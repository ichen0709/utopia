export type Segment =
  | { type: 'text'; text: string }
  | { type: 'link'; text: string; href: string };

// 只認 http:// 與 https:// 開頭,而且前面不能緊接著文字(避免 xhttp://)。
// 網址只收 ASCII 字元,這樣後面緊接的中文不會被吞進連結。
const URL_RE = /(?<![\p{L}\p{N}])https?:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+/giu;
const TRAILING = /[.,;:!?)\]}']+$/;

/** 檢查網址是否安全:只接受 http / https,不接受帶帳號密碼的網址。回傳整理過的網址,不安全則回傳 null */
export function safeHref(candidate: string): string | null {
  try {
    const u = new URL(candidate);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (!u.hostname) return null;
    if (u.username || u.password) return null;
    return u.href;
  } catch {
    return null;
  }
}

/** 把訊息切成「普通文字」與「連結」片段。畫面只能用文字方式顯示這些片段,不可以當 HTML。 */
export function splitMessage(text: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  const push = (t: string) => {
    if (!t) return;
    const prev = out[out.length - 1];
    if (prev && prev.type === 'text') prev.text += t;
    else out.push({ type: 'text', text: t });
  };

  for (const m of text.matchAll(URL_RE)) {
    const start = m.index ?? 0;
    let candidate = m[0];
    const trimmed = candidate.replace(TRAILING, '');
    if (trimmed) candidate = trimmed;
    const href = safeHref(candidate);
    push(text.slice(last, start));
    if (href) {
      out.push({ type: 'link', text: candidate, href });
    } else {
      push(candidate);
    }
    last = start + candidate.length;
  }
  push(text.slice(last));
  return out;
}
