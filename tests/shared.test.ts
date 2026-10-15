import { describe, expect, it } from 'vitest';
import { colorIndex } from '../src/shared/color';
import { levelAt, stateOf } from '../src/shared/fire';
import { safeHref, splitMessage } from '../src/shared/linkify';
import { activeMentionToken, mentions } from '../src/shared/mention';
import { cleanMessage, messageLength } from '../src/shared/message';
import { checkNickname, nicknameKey } from '../src/shared/nickname';
import { fadeStage } from '../src/shared/time';

describe('代號規則', () => {
  it('合格的代號', () => {
    for (const n of ['夜貓', 'amy', 'Amy_01', '🔥小火', '阿火2號']) {
      expect(checkNickname(n).ok, n).toBe(true);
    }
  });
  it('前後空白自動去掉', () => {
    const r = checkNickname('  夜貓  ');
    expect(r.ok && r.value).toBe('夜貓');
  });
  it('空白、@、全形 @ 都不行', () => {
    for (const n of ['小 明', '小明@', '@小明', '小　明', '小＠明']) {
      const r = checkNickname(n);
      expect(r.ok, n).toBe(false);
      if (!r.ok) expect(r.problem).toBe('space_or_at');
    }
  });
  it('空的、太長、奇怪符號', () => {
    expect(checkNickname('   ')).toEqual({ ok: false, problem: 'empty' });
    expect(checkNickname('一'.repeat(21))).toEqual({ ok: false, problem: 'too_long' });
    expect(checkNickname('一'.repeat(20)).ok).toBe(true);
    expect(checkNickname('小明!')).toEqual({ ok: false, problem: 'bad_char' });
    expect(checkNickname('<b>')).toEqual({ ok: false, problem: 'bad_char' });
  });
  it('一個表情符號算一個字', () => {
    expect(checkNickname('🔥'.repeat(20)).ok).toBe(true);
    expect(checkNickname('🔥'.repeat(21)).ok).toBe(false);
  });
  it('大小寫視為同一個', () => {
    expect(nicknameKey('Amy')).toBe(nicknameKey('amy'));
    expect(nicknameKey('AMY')).toBe(nicknameKey('aMy'));
  });
});

describe('訊息清理與長度', () => {
  it('去掉控制字元與雙向文字控制字元,保留換行', () => {
    expect(cleanMessage('a\u0000b‮c​d')).toBe('abcd');
    expect(cleanMessage('第一行\r\n第二行')).toBe('第一行\n第二行');
    expect(cleanMessage('a\n\n\n\n\nb')).toBe('a\n\nb');
  });
  it('只有空白就是空的', () => {
    expect(cleanMessage('  \n ​ ')).toBe('');
  });
  it('長度以字元計', () => {
    expect(messageLength('你好🔥')).toBe(3);
    expect(messageLength('a'.repeat(300))).toBe(300);
  });
  it('HTML 不會被改寫,原樣保留成文字', () => {
    expect(cleanMessage('<script>alert(1)</script>')).toBe('<script>alert(1)</script>');
  });
});

describe('連結判斷', () => {
  it('一般網址可以變成連結', () => {
    const s = splitMessage('看這個 https://example.com/a?b=1 很棒');
    expect(s).toEqual([
      { type: 'text', text: '看這個 ' },
      { type: 'link', text: 'https://example.com/a?b=1', href: 'https://example.com/a?b=1' },
      { type: 'text', text: ' 很棒' },
    ]);
  });
  it('http 也可以', () => {
    expect(splitMessage('http://example.com').some((x) => x.type === 'link')).toBe(true);
  });
  it('網址結尾的標點不算在連結裡', () => {
    const s = splitMessage('去 https://example.com/x.');
    const link = s.find((x) => x.type === 'link');
    expect(link && link.type === 'link' && link.text).toBe('https://example.com/x');
  });
  it('網址後面緊接中文,中文不會被吞進連結', () => {
    const s = splitMessage('https://example.com看這個');
    const link = s.find((x) => x.type === 'link');
    expect(link && link.type === 'link' && link.text).toBe('https://example.com');
  });
  it('javascript:、data:、ftp:、file: 一律只是普通文字', () => {
    for (const t of ['javascript:alert(1)', 'data:text/html,<b>x</b>', 'ftp://files.example.com', 'file:///etc/passwd', 'JaVaScRiPt:alert(1)']) {
      const s = splitMessage(t);
      expect(s.every((x) => x.type === 'text'), t).toBe(true);
      expect(s.map((x) => x.text).join(''), t).toBe(t);
    }
  });
  it('safeHref 只接受 http / https,不接受帶帳號密碼的', () => {
    expect(safeHref('https://example.com')).toBe('https://example.com/');
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('https://user:pw@example.com')).toBeNull();
    expect(safeHref('not a url')).toBeNull();
  });
  it('HTML 字串完全是普通文字', () => {
    const html = '<script>alert(1)</script> <img src=x onerror=alert(1)>';
    expect(splitMessage(html)).toEqual([{ type: 'text', text: html }]);
  });
  it('混合:HTML 裡的網址只有網址本身變連結', () => {
    const s = splitMessage('<a href="https://example.com">點我</a>');
    expect(s.filter((x) => x.type === 'link')).toHaveLength(1);
    expect(s.map((x) => x.text).join('')).toBe('<a href="https://example.com">點我</a>');
  });
});

describe('@ 提及', () => {
  it('基本情況', () => {
    expect(mentions('@夜貓 你好', '夜貓')).toBe(true);
    expect(mentions('嗨 @夜貓', '夜貓')).toBe(true);
    expect(mentions('嗨 @夜貓,晚安', '夜貓')).toBe(true);
    expect(mentions('@Amy hi', 'amy')).toBe(true);
  });
  it('代號後面緊接文字不算', () => {
    expect(mentions('@夜貓咪 你好', '夜貓')).toBe(false);
    expect(mentions('@amy_bob hi', 'amy')).toBe(false);
  });
  it('@ 前面緊接文字不算(例如電子郵件)', () => {
    expect(mentions('寄到 foo@amy.com', 'amy')).toBe(false);
  });
  it('沒有 @ 不算', () => {
    expect(mentions('夜貓你好', '夜貓')).toBe(false);
  });
  it('輸入框裡正在打的 @ 代號', () => {
    expect(activeMentionToken('嗨 @阿', 5)).toEqual({ start: 2, query: '阿' });
    expect(activeMentionToken('@', 1)).toEqual({ start: 0, query: '' });
    expect(activeMentionToken('嗨 @阿 好', 7)).toBeNull();
    expect(activeMentionToken('a@b', 3)).toBeNull();
  });
});

describe('顏色與火', () => {
  it('同一個代號永遠同一個顏色,大小寫不影響', () => {
    expect(colorIndex('Amy')).toBe(colorIndex('amy'));
    const i = colorIndex('夜貓');
    expect(i).toBeGreaterThanOrEqual(1);
    expect(i).toBeLessThanOrEqual(7);
  });
  it('火的亮度隨時間衰減,最低 0', () => {
    expect(levelAt(50, 0, 0, 6)).toBe(50);
    expect(levelAt(50, 0, 60_000, 6)).toBe(40);
    expect(levelAt(50, 0, 10_000_000, 6)).toBe(0);
    expect(levelAt(100, 0, 0, 6)).toBe(100);
  });
  it('四種外觀的分界', () => {
    expect(stateOf(100)).toBe('strong');
    expect(stateOf(67)).toBe('strong');
    expect(stateOf(66)).toBe('mid');
    expect(stateOf(34)).toBe('mid');
    expect(stateOf(33)).toBe('low');
    expect(stateOf(0.4)).toBe('low');
    expect(stateOf(0)).toBe('out');
  });
  it('訊息淡出的階段', () => {
    expect(fadeStage(5 * 60_000)).toBe(0);
    expect(fadeStage(50_000)).toBe(1);
    expect(fadeStage(10_000)).toBe(2);
  });
});
