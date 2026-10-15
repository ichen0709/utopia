import { describe, expect, it } from 'vitest';
import { BACKEND } from '../src/config';
import {
  isFireRow,
  isMessageRow,
  newSessionId,
  numericId,
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

describe('選哪個後端', () => {
  it('自動測試一律使用模擬後端,就算本機有 .env', () => {
    expect(BACKEND).toBe('local');
  });
});
