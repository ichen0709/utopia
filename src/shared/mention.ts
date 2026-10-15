import { nicknameKey } from './nickname';
import { firstChar, lastChar } from './text';

const isWordChar = (ch: string) => /[\p{L}\p{N}_]/u.test(ch);
// 「@代號」後面必須是結尾、空白或標點;底線屬於代號的一部分,不算標點
const isBoundaryAfter = (ch: string) => ch === '' || (ch !== '_' && /[\s\p{P}\p{S}]/u.test(ch));

/**
 * 這則訊息有沒有 @ 到我?
 * 規則(architecture.md 9.2):@ 前面不能緊接著文字(排除 a@amy.com),代號後面必須是結尾、空白或標點;大小寫視為同一個。
 */
export function mentions(body: string, nickname: string): boolean {
  const text = body.normalize('NFC').toLowerCase();
  const needle = '@' + nicknameKey(nickname);
  let from = 0;
  for (;;) {
    const i = text.indexOf(needle, from);
    if (i < 0) return false;
    const before = lastChar(text.slice(0, i));
    const after = firstChar(text.slice(i + needle.length));
    if ((before === '' || !isWordChar(before)) && isBoundaryAfter(after)) return true;
    from = i + 1;
  }
}

/** 輸入框裡游標所在位置,是不是正在打 @ 代號?回傳 @ 的位置與已打的篩選文字 */
export function activeMentionToken(text: string, caret: number): { start: number; query: string } | null {
  const upto = text.slice(0, caret);
  const at = upto.lastIndexOf('@');
  if (at < 0) return null;
  const query = upto.slice(at + 1);
  if (/\s/.test(query)) return null;
  const prev = at === 0 ? '' : upto[at - 1];
  if (prev && isWordChar(prev)) return null;
  return { start: at, query };
}
