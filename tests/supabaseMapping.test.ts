import { describe, expect, it, vi } from 'vitest';
import { BACKEND } from '../src/config';
import {
  isFireRow,
  isMessageRow,
  newSessionId,
  numericId,
  parseSnapshotFire,
  parseSnapshotMember,
  parseSnapshotMessage,
  sanitizeSnapshot,
  toChatError,
  toFire,
  toMessage,
  UUID_RE,
} from '../src/backend/supabase/mapping';

describe('Supabase 回傳的錯誤轉成合約的錯誤', () => {
  it('資料庫函式丟出的錯誤代碼原樣對應', () => {
    for (const code of ['NICKNAME_TAKEN', 'NICKNAME_INVALID', 'MESSAGE_EMPTY', 'MESSAGE_TOO_LONG', 'NOT_JOINED']) {
      expect(toChatError({ message: code, code: 'P0001' }).code).toBe(code);
    }
  });
  it('頻率限制與加柴冷卻帶著還要等多久(毫秒)', () => {
    const a = toChatError({ message: 'RATE_LIMITED', details: '4200', code: 'P0001' });
    expect(a.code).toBe('RATE_LIMITED');
    expect(a.retryAfterMs).toBe(4200);
    const b = toChatError({ message: 'FIRE_COOLDOWN', details: '1500' });
    expect(b.retryAfterMs).toBe(1500);
  });
  it('代號不合規則時,details 是原因', () => {
    expect(toChatError({ message: 'NICKNAME_INVALID', details: 'space_or_at' }).message).toBe('space_or_at');
  });
  it('網路中斷、登入過期、權限錯誤、伺服器錯誤,一律是 UNAVAILABLE', () => {
    for (const err of [
      { message: 'Failed to fetch' },
      { message: 'JWT expired', code: 'PGRST301' },
      { message: 'permission denied for function join_room', code: '42501' },
      { message: '' },
    ]) {
      expect(toChatError(err).code).toBe('UNAVAILABLE');
    }
  });
});

describe('Realtime 推送的資料列轉成合約的格式', () => {
  const row = {
    id: 42,
    kind: 'chat',
    user_id: 'x',
    nickname: 'Amy',
    body: '嗨',
    created_at: '2026-10-15T12:00:00.123456+00:00',
    expires_at: '2026-10-15T12:30:00.123456+00:00',
  };
  it('訊息', () => {
    expect(isMessageRow(row)).toBe(true);
    expect(toMessage(row)).toEqual({
      id: '42',
      kind: 'chat',
      nickname: 'Amy',
      body: '嗨',
      createdAt: '2026-10-15T12:00:00.123Z',
      expiresAt: '2026-10-15T12:30:00.123Z',
    });
  });
  it('系統訊息沒有內容', () => {
    expect(toMessage({ ...row, kind: 'join', body: null }).body).toBeNull();
  });
  it('不合格的資料列會被擋下', () => {
    expect(isMessageRow(null)).toBe(false);
    expect(isMessageRow({ ...row, kind: 'hack' })).toBe(false);
    expect(isMessageRow({ ...row, nickname: 5 })).toBe(false);
  });
  it('營火', () => {
    const fire = { level: 73.5, updated_at: '2026-10-15T12:00:00+00:00', last_stoked_by: 'Bob' };
    expect(isFireRow(fire)).toBe(true);
    expect(toFire(fire)).toEqual({ level: 73.5, updatedAt: '2026-10-15T12:00:00.000Z', lastStokedBy: 'Bob' });
    expect(isFireRow({ level: 'x' })).toBe(false);
  });
  it('訊息編號與分頁編號', () => {
    expect(numericId('17')).toBe(17);
    expect(numericId('abc')).toBe(0);
    expect(UUID_RE.test(newSessionId())).toBe(true);
  });
});

// ---------- 不信任網路來的資料:逐項檢查,不合格的安靜丟掉 ----------

const goodRow = {
  id: 7,
  kind: 'chat',
  user_id: 'u',
  nickname: 'Amy',
  body: '你好',
  created_at: '2026-10-15T12:00:00.000Z',
  expires_at: '2026-10-15T12:30:00.000Z',
};

describe('即時推送的訊息資料列:每一種不合格的情況', () => {
  it('合格的:一般訊息、系統訊息(內容是 null、沒有、空字串、字串都可以)', () => {
    expect(isMessageRow(goodRow)).toBe(true);
    for (const kind of ['join', 'leave', 'fire']) {
      expect(isMessageRow({ ...goodRow, kind, body: null })).toBe(true);
      expect(isMessageRow({ ...goodRow, kind, body: undefined })).toBe(true);
      expect(isMessageRow({ ...goodRow, kind, body: '' })).toBe(true);
      expect(isMessageRow({ ...goodRow, kind, body: '字串' })).toBe(true);
    }
  });
  it('整個資料列不是物件', () => {
    for (const v of [null, undefined, 'x', 5, true, [], [goodRow]]) expect(isMessageRow(v)).toBe(false);
  });
  it('id 缺少、是 null、不是有限數字、空字串、其他型別', () => {
    for (const id of [undefined, null, NaN, Infinity, '', {}, [], true]) expect(isMessageRow({ ...goodRow, id })).toBe(false);
    expect(isMessageRow({ ...goodRow, id: '12' })).toBe(true);
  });
  it('kind 缺少、不是字串、不在 chat/join/leave/fire 之內', () => {
    for (const kind of [undefined, null, 5, {}, 'hack', 'CHAT', '', 'system']) expect(isMessageRow({ ...goodRow, kind })).toBe(false);
  });
  it('nickname 不是字串、是空的、超過 20 字(20 字可以,表情符號算一個字)', () => {
    for (const nickname of [undefined, null, 5, {}, '', '一'.repeat(21), '🔥'.repeat(21)]) {
      expect(isMessageRow({ ...goodRow, nickname })).toBe(false);
    }
    expect(isMessageRow({ ...goodRow, nickname: '一'.repeat(20) })).toBe(true);
    expect(isMessageRow({ ...goodRow, nickname: '🔥'.repeat(20) })).toBe(true);
  });
  it('一般訊息(chat)沒有內容、內容是空白、內容不是字串', () => {
    for (const body of [undefined, null, '', '   ', '\n\t ', 42, {}, [], true]) {
      expect(isMessageRow({ ...goodRow, body }), String(body)).toBe(false);
    }
  });
  it('一般訊息(chat)超過 300 字(300 字可以,以字元計)', () => {
    expect(isMessageRow({ ...goodRow, body: 'a'.repeat(301) })).toBe(false);
    expect(isMessageRow({ ...goodRow, body: '你'.repeat(301) })).toBe(false);
    expect(isMessageRow({ ...goodRow, body: 'a'.repeat(300) })).toBe(true);
    expect(isMessageRow({ ...goodRow, body: '🔥'.repeat(300) })).toBe(true);
  });
  it('系統訊息的內容不是字串或 null、或超過 300 字', () => {
    for (const kind of ['join', 'leave', 'fire']) {
      for (const body of [42, {}, [], true]) expect(isMessageRow({ ...goodRow, kind, body })).toBe(false);
      expect(isMessageRow({ ...goodRow, kind, body: 'a'.repeat(301) })).toBe(false);
    }
  });
  it('created_at、expires_at 缺少、不是字串、不是可解析的時間', () => {
    for (const field of ['created_at', 'expires_at']) {
      for (const bad of [undefined, null, 5, {}, '', 'not a time', '2026-13-45T99:99:99Z', 'yesterday']) {
        expect(isMessageRow({ ...goodRow, [field]: bad }), `${field}=${String(bad)}`).toBe(false);
      }
    }
  });
});

describe('即時推送的營火資料列:每一種不合格的情況', () => {
  const fire = { level: 50, updated_at: '2026-10-15T12:00:00.000Z', last_stoked_by: 'Amy' };
  it('合格的:0、100、小數,加柴的人可以是 null 或沒有', () => {
    for (const level of [0, 100, 50.5, 0.01]) expect(isFireRow({ ...fire, level })).toBe(true);
    expect(isFireRow({ ...fire, last_stoked_by: null })).toBe(true);
    expect(isFireRow({ level: 10, updated_at: fire.updated_at })).toBe(true);
  });
  it('level 不是數字、不是有限數字、超出 0 到 100', () => {
    for (const level of [undefined, null, '50', NaN, Infinity, -Infinity, -0.1, -1, 100.1, 101, 1000, {}]) {
      expect(isFireRow({ ...fire, level }), String(level)).toBe(false);
    }
  });
  it('updated_at 不合格、last_stoked_by 型別不對、整個不是物件', () => {
    for (const updated_at of [undefined, null, 5, '', 'nope']) expect(isFireRow({ ...fire, updated_at })).toBe(false);
    for (const last_stoked_by of [5, {}, true]) expect(isFireRow({ ...fire, last_stoked_by })).toBe(false);
    for (const v of [null, undefined, 'x', 5, []]) expect(isFireRow(v)).toBe(false);
  });
});

describe('快照:逐項檢查,不合格的項目丟掉,其餘照常', () => {
  const t = '2026-10-15T12:00:00.000Z';
  const msg = (over: Record<string, unknown> = {}) => ({ id: '1', kind: 'chat', nickname: 'Amy', body: '嗨', createdAt: t, expiresAt: t, ...over });
  const mem = (over: Record<string, unknown> = {}) => ({ nickname: 'Amy', joinedAt: t, ...over });
  const snap = (over: Record<string, unknown> = {}) => ({
    serverTime: t,
    config: {},
    me: { nickname: 'Amy' },
    members: [mem()],
    messages: [msg()],
    fire: { level: 60, updatedAt: t, lastStokedBy: null },
    ...over,
  });

  it('合格的快照原樣通過(id 轉成字串、時間轉成標準格式)', () => {
    const s = sanitizeSnapshot(snap({ messages: [msg({ id: 5 })], serverTime: '2026-10-15T20:00:00+08:00' }))!;
    expect(s.messages[0].id).toBe('5');
    expect(s.serverTime).toBe('2026-10-15T12:00:00.000Z');
    expect(s.me).toEqual({ nickname: 'Amy' });
    expect(s.members).toHaveLength(1);
    expect(s.fire).toEqual({ level: 60, updatedAt: t, lastStokedBy: null });
  });
  it('不合格的訊息被丟掉,好的照常顯示(各種不合格都試)', () => {
    const bad = [
      null,
      'x',
      5,
      [],
      msg({ id: undefined }),
      msg({ kind: 'hack' }),
      msg({ nickname: 5 }),
      msg({ nickname: '' }),
      msg({ nickname: '一'.repeat(21) }),
      msg({ body: null }), // chat 沒內容
      msg({ body: '  ' }),
      msg({ body: 42 }),
      msg({ body: 'a'.repeat(301) }),
      msg({ kind: 'join', body: 42 }),
      msg({ createdAt: 'nope' }),
      msg({ expiresAt: undefined }),
    ];
    const s = sanitizeSnapshot(snap({ messages: [msg({ id: 'a' }), ...bad, msg({ id: 'b' }), msg({ id: 'c', kind: 'join', body: null })] }))!;
    expect(s.messages.map((m) => m.id)).toEqual(['a', 'b', 'c']);
    expect(s.messages[2].body).toBeNull();
  });
  it('不合格的成員被丟掉,好的照常顯示', () => {
    const bad = [null, 'x', 5, mem({ nickname: undefined }), mem({ nickname: '' }), mem({ nickname: '一'.repeat(21) }), mem({ joinedAt: 'nope' }), mem({ joinedAt: undefined })];
    const s = sanitizeSnapshot(snap({ members: [mem({ nickname: 'Amy' }), ...bad, mem({ nickname: 'Bob' })] }))!;
    expect(s.members.map((m) => m.nickname)).toEqual(['Amy', 'Bob']);
  });
  it('不合格的營火:退回中等亮度,不影響其他項目', () => {
    for (const fire of [undefined, null, 'x', { level: 150, updatedAt: t }, { level: -5, updatedAt: t }, { level: '60', updatedAt: t }, { level: 60, updatedAt: 'nope' }, { level: NaN, updatedAt: t }]) {
      const s = sanitizeSnapshot(snap({ fire }))!;
      expect(s.fire.level, JSON.stringify(fire)).toBe(50);
      expect(s.fire.updatedAt).toBe(t);
      expect(s.messages).toHaveLength(1);
    }
  });
  it('「我自己」不合格就當作還沒加入', () => {
    for (const me of [undefined, 'x', 5, { nickname: 5 }, { nickname: '' }, { nickname: '一'.repeat(21) }, {}]) {
      expect(sanitizeSnapshot(snap({ me }))!.me).toBeNull();
    }
    expect(sanitizeSnapshot(snap({ me: null }))!.me).toBeNull();
  });
  it('規則數值:不合格的欄位退回預設值,合格的採用', () => {
    const s = sanitizeSnapshot(snap({ config: { maxMessageLength: 500, rateLimitCount: 'x', stokeCooldownSeconds: -1, nicknameMax: NaN } }))!;
    expect(s.config.maxMessageLength).toBe(500);
    expect(s.config.rateLimitCount).toBe(5);
    expect(s.config.stokeCooldownSeconds).toBe(5);
    expect(s.config.nicknameMax).toBe(20);
    expect(sanitizeSnapshot(snap({ config: 'nope' }))!.config.maxMessageLength).toBe(300);
  });
  it('整份快照不成樣子:回傳 null(由呼叫端當作暫時連不上),而不是丟出例外', () => {
    for (const v of [null, undefined, 'x', 5, [], {}, snap({ serverTime: 'nope' }), snap({ serverTime: undefined }), snap({ messages: 'x' }), snap({ messages: null }), snap({ members: {} }), snap({ members: undefined })]) {
      expect(sanitizeSnapshot(v)).toBeNull();
    }
  });
});

describe('所有檢查都不會丟出例外,也不會在 Console 印任何東西', () => {
  it('把各式各樣的垃圾資料全部餵進去', () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const junk: unknown[] = [null, undefined, 0, NaN, '', 'x', [], {}, { id: {} }, { kind: [] }, { body: Symbol('s') }, { nickname: () => 1 }, { createdAt: {} }, [[]], [{}], { messages: [{}], members: [{}], serverTime: {} }, JSON.parse('{"__proto__": {"x": 1}}')];
    expect(() => {
      for (const v of junk) {
        isMessageRow(v);
        isFireRow(v);
        parseSnapshotMessage(v);
        parseSnapshotMember(v);
        parseSnapshotFire(v);
        sanitizeSnapshot(v);
        sanitizeSnapshot({ serverTime: '2026-10-15T12:00:00Z', messages: [v], members: [v], fire: v, me: v, config: v });
      }
    }).not.toThrow();
    for (const s of spies) expect(s).not.toHaveBeenCalled();
    for (const s of spies) s.mockRestore();
  });
});

describe('選哪個後端', () => {
  it('自動測試一律使用模擬後端,就算本機有 .env', () => {
    expect(BACKEND).toBe('local');
  });
});
