// 「暫離一下」:階段一模擬後端的伺服器規則(src/backend/local/room.ts)與 Supabase 資料的檢查(mapping.ts)。
// 暫離只是顯示用的標記:不產生系統訊息,不影響心跳、離開判定、頻率限制、加柴、訊息到期。
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_ROOM_CONFIG as cfg } from '../src/config';
import { ChatError } from '../src/backend/types';
import {
  beat,
  cleanup,
  currentFireLevel,
  emptyDb,
  joinRoom,
  leaveRoom,
  markLeavingSoon,
  sendChat,
  setAway,
  snapshotOf,
  stoke,
  type Who,
} from '../src/backend/local/room';
import { parseAwayRow, parseSnapshotMember, sanitizeSnapshot } from '../src/backend/supabase/mapping';

const T0 = 1_700_000_000_000;
const A: Who = { userId: 'uA', sessionId: 'sA' };
const B: Who = { userId: 'uB', sessionId: 'sB' };

const codeOf = (fn: () => void): string | null => {
  try {
    fn();
    return null;
  } catch (e) {
    return e instanceof ChatError ? e.code : 'OTHER';
  }
};

function room() {
  const db = emptyDb(T0, cfg);
  joinRoom(db, A, 'Amy', T0, cfg);
  joinRoom(db, B, 'Bob', T0, cfg);
  return db;
}
const awayOf = (db: ReturnType<typeof room>, w: Who) => snapshotOf(db, w, T0, cfg).members.find((m) => m.nickname === (w === A ? 'Amy' : 'Bob'))!.away;

describe('暫離一下(模擬後端的規則)', () => {
  it('預設不是暫離;切換之後所有人在快照裡看到同一份結果,再切換就恢復', () => {
    const db = room();
    expect(awayOf(db, A)).toBe(false);
    setAway(db, A, true, T0 + 1000, cfg);
    expect(snapshotOf(db, B, T0 + 1000, cfg).members.find((m) => m.nickname === 'Amy')!.away).toBe(true);
    expect(snapshotOf(db, B, T0 + 1000, cfg).members.find((m) => m.nickname === 'Bob')!.away).toBe(false);
    setAway(db, A, false, T0 + 2000, cfg);
    expect(snapshotOf(db, B, T0 + 2000, cfg).members.find((m) => m.nickname === 'Amy')!.away).toBe(false);
  });

  it('沒有加入的人不能切換', () => {
    const db = room();
    expect(codeOf(() => setAway(db, { userId: 'x', sessionId: 'nope' }, true, T0, cfg))).toBe('NOT_JOINED');
  });

  it('不產生任何系統訊息', () => {
    const db = room();
    const before = db.messages.length;
    for (let i = 0; i < 6; i++) setAway(db, A, i % 2 === 0, T0 + 1000 + i, cfg);
    expect(db.messages.length).toBe(before);
  });

  it('不更新心跳時間,也不動「即將離開」的標記', () => {
    const db = room();
    markLeavingSoon(db, A, T0 + 5000);
    const row = db.members.find((m) => m.sessionId === 'sA')!;
    const beatBefore = row.lastBeatAt;
    setAway(db, A, true, T0 + 6000, cfg);
    expect(row.lastBeatAt).toBe(beatBefore);
    expect(row.leavingAt).toBe(T0 + 5000);
  });

  it('暫離中照常送心跳:心跳會更新時間,暫離標記不變', () => {
    const db = room();
    setAway(db, A, true, T0 + 1000, cfg);
    beat(db, A, T0 + 20_000, cfg);
    const row = db.members.find((m) => m.sessionId === 'sA')!;
    expect(row.lastBeatAt).toBe(T0 + 20_000);
    expect(row.away).toBe(true);
  });

  it('離開判定完全不變:暫離中的人 30 秒沒有心跳,照樣被判定離開,並產生「離開」訊息', () => {
    const db = room();
    setAway(db, A, true, T0 + 1000, cfg);
    beat(db, B, T0 + 25_000, cfg); // B 一直有心跳
    cleanup(db, T0 + 29_000, cfg);
    expect(db.members.some((m) => m.nickname === 'Amy')).toBe(true);
    cleanup(db, T0 + 31_000, cfg);
    expect(db.members.some((m) => m.nickname === 'Amy')).toBe(false);
    expect(db.members.some((m) => m.nickname === 'Bob')).toBe(true);
    expect(db.messages.filter((m) => m.kind === 'leave' && m.nickname === 'Amy')).toHaveLength(1);
  });

  it('暫離中的人通知離開、超過緩衝時間沒回來:照樣被移除;緩衝時間內回來(心跳)就取消', () => {
    const db = room();
    setAway(db, A, true, T0 + 1000, cfg);
    markLeavingSoon(db, A, T0 + 2000);
    cleanup(db, T0 + 8000, cfg);
    expect(db.members.some((m) => m.nickname === 'Amy')).toBe(true);
    beat(db, A, T0 + 9000, cfg);
    cleanup(db, T0 + 25_000, cfg);
    expect(db.members.some((m) => m.nickname === 'Amy')).toBe(true);
    markLeavingSoon(db, A, T0 + 26_000);
    cleanup(db, T0 + 37_000, cfg);
    expect(db.members.some((m) => m.nickname === 'Amy')).toBe(false);
  });

  it('離開營火後暫離標記跟著消失;重新加入不是暫離中', () => {
    const db = room();
    setAway(db, A, true, T0 + 1000, cfg);
    leaveRoom(db, A, T0 + 2000, cfg);
    expect(db.members.some((m) => m.nickname === 'Amy')).toBe(false);
    joinRoom(db, A, 'Amy', T0 + 3000, cfg);
    expect(snapshotOf(db, A, T0 + 3000, cfg).members.find((m) => m.nickname === 'Amy')!.away).toBe(false);
  });

  it('不影響頻率限制:只算一般訊息,10 秒 5 則照舊', () => {
    const db = room();
    for (let i = 0; i < 6; i++) setAway(db, A, i % 2 === 0, T0 + i, cfg);
    for (let i = 0; i < 5; i++) sendChat(db, A, `m${i}`, T0 + 100 + i, cfg);
    expect(codeOf(() => sendChat(db, A, '第六則', T0 + 200, cfg))).toBe('RATE_LIMITED');
  });

  it('不影響加柴(含冷卻與亮度)和訊息', () => {
    const db = room();
    setAway(db, A, true, T0, cfg);
    const before = currentFireLevel(db, T0 + 1000, cfg);
    stoke(db, A, T0 + 1000, cfg);
    expect(currentFireLevel(db, T0 + 1000, cfg)).toBeCloseTo(before + cfg.fireStokeAmount, 5);
    expect(codeOf(() => stoke(db, A, T0 + 2000, cfg))).toBe('FIRE_COOLDOWN');
    sendChat(db, A, '暫離中也能說話', T0 + 3000, cfg);
    expect(db.messages.at(-1)!.body).toBe('暫離中也能說話');
    // 暫離中的人發言,不會自動回來
    expect(awayOf(db, A)).toBe(true);
  });

  it('不影響訊息 30 分鐘到期', () => {
    const db = room();
    sendChat(db, A, '會到期', T0 + 100, cfg);
    setAway(db, A, true, T0 + 200, cfg);
    const ttl = cfg.messageTtlSeconds * 1000;
    expect(snapshotOf(db, B, T0 + ttl - 1000, cfg).messages.some((m) => m.body === '會到期')).toBe(true);
    expect(snapshotOf(db, B, T0 + ttl + 500, cfg).messages.some((m) => m.body === '會到期')).toBe(false);
  });
});

describe('暫離狀態資料的檢查(mapping.ts)', () => {
  it('即時推送的暫離名單:合格的原樣通過', () => {
    expect(parseAwayRow({ nicknames: ['Amy', 'Bob'], version: 3 })).toEqual({ nicknames: ['Amy', 'Bob'], version: 3 });
    expect(parseAwayRow({ nicknames: [], version: 0 })).toEqual({ nicknames: [], version: 0 });
  });

  it('整列不合格就整筆丟掉:不是物件、nicknames 不是陣列、版本不對', () => {
    for (const v of [null, undefined, 'x', 5, [], {}, { version: 1 }, { nicknames: 'Amy', version: 1 }, { nicknames: {}, version: 1 }, { nicknames: [] }, { nicknames: [], version: -1 }, { nicknames: [], version: NaN }, { nicknames: [], version: Infinity }, { nicknames: [], version: '1' }, { nicknames: [], version: null }]) {
      expect(parseAwayRow(v), JSON.stringify(v)).toBeNull();
    }
  });

  it('名單裡不合格的項目丟掉,其餘照常(不是字串、空的、超過 20 字)', () => {
    const r = parseAwayRow({ nicknames: ['Amy', 5, null, '', '一'.repeat(21), {}, [], 'Bob', '一'.repeat(20)], version: 2 })!;
    expect(r.nicknames).toEqual(['Amy', 'Bob', '一'.repeat(20)]);
  });

  it('名單太長只收前面 500 個', () => {
    const many = Array.from({ length: 800 }, (_, i) => `n${i}`);
    expect(parseAwayRow({ nicknames: many, version: 1 })!.nicknames).toHaveLength(500);
  });

  it('快照裡成員的暫離標記:只有 true 才算,其他(沒有、false、字串、數字……)都當作沒有暫離,成員照常顯示', () => {
    const base = { nickname: 'Amy', joinedAt: '2026-10-15T12:00:00.000Z' };
    expect(parseSnapshotMember({ ...base, away: true })!.away).toBe(true);
    for (const away of [undefined, null, false, 'true', 'yes', 1, 0, {}, []]) {
      const m = parseSnapshotMember({ ...base, away });
      expect(m, String(away)).not.toBeNull();
      expect(m!.away).toBe(false);
    }
  });

  it('快照的暫離名單版本:合格才保留,不合格就沒有這個欄位', () => {
    const snap = (extra: Record<string, unknown>) => ({
      serverTime: '2026-10-15T12:00:00.000Z',
      config: {},
      me: null,
      members: [],
      messages: [],
      fire: { level: 50, updatedAt: '2026-10-15T12:00:00.000Z', lastStokedBy: null },
      ...extra,
    });
    expect(sanitizeSnapshot(snap({ awayVersion: 7 }))!.awayVersion).toBe(7);
    expect(sanitizeSnapshot(snap({ awayVersion: 0 }))!.awayVersion).toBe(0);
    for (const awayVersion of [undefined, null, -1, NaN, '7', {}]) {
      expect('awayVersion' in sanitizeSnapshot(snap({ awayVersion }))!, String(awayVersion)).toBe(false);
    }
  });

  it('不會丟出例外,也不會在 Console 印任何東西', () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const junk: unknown[] = [null, undefined, 0, NaN, '', 'x', [], {}, { nicknames: [Symbol('s')], version: 1 }, { nicknames: [() => 1], version: 1 }, { away: {} }, [[]]];
    expect(() => {
      for (const v of junk) {
        parseAwayRow(v);
        parseSnapshotMember(v);
        parseSnapshotMember({ nickname: 'Amy', joinedAt: '2026-10-15T12:00:00Z', away: v });
      }
    }).not.toThrow();
    for (const s of spies) expect(s).not.toHaveBeenCalled();
    for (const s of spies) s.mockRestore();
  });
});
