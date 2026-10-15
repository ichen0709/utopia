import { chars } from './text';

export type NicknameProblem = 'empty' | 'too_long' | 'space_or_at' | 'bad_char';
export type NicknameCheck = { ok: true; value: string } | { ok: false; problem: NicknameProblem };

// 中文、英文(各種文字)、數字、底線、表情符號
const ALLOWED = /^[\p{L}\p{N}_\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}‍️⃣]+$/u;

/** 代號規則(architecture.md 1.2):前後空白自動去掉;不可有空白與 @;1 到 max 個字 */
export function checkNickname(raw: string, max = 20): NicknameCheck {
  const value = raw.trim();
  if (!value) return { ok: false, problem: 'empty' };
  if (/[\s@＠]/u.test(value)) return { ok: false, problem: 'space_or_at' };
  if (chars(value) > max) return { ok: false, problem: 'too_long' };
  if (!ALLOWED.test(value)) return { ok: false, problem: 'bad_char' };
  return { ok: true, value };
}

/** 大小寫視為同一個代號 */
export function nicknameKey(nickname: string): string {
  return nickname.normalize('NFC').toLowerCase();
}

export function nicknameProblemText(problem: NicknameProblem, max = 20): string {
  switch (problem) {
    case 'empty':
      return '請輸入代號';
    case 'too_long':
      return `代號最多 ${max} 個字`;
    case 'space_or_at':
      return '代號不能有空白或 @,請拿掉再試試';
    case 'bad_char':
      return '代號只能用中文、英文、數字、底線和表情符號';
  }
}
