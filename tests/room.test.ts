import { describe, expect, it } from 'vitest';
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
  snapshotOf,
  stoke,
  type Who,
} from '../src/backend/local/room';

const T0 = 1_700_000_000_000;
const A: Who = { userId: 'uA', sessionId: 'sA' };
const B: Who = { userId: 'uB', sessionId: 'sB' };

function codeOf(fn: () => void): string | null {
  try {
    fn();
    return null;
  } catch (e) {
    return e instanceof ChatError ? e.code : 'OTHER';
  }
}

function setup() {
  const db = emptyDb(T0, cfg);
  joinRoom(db, A, 'Amy', T0, cfg);
  return db;
}

describe('加入與代號', () => {
  it('加入後有一則「坐下」系統訊息,快照看得到自己', () => {
    const db = setup();
    const snap = snapshotOf(db, A, T0, cfg);
    expect(snap.me?.nickname).toBe('Amy');
    expect(snap.messages.map((m) => m.kind)).toEqual(['join']);
  });
  it('代號重複(大小寫視為同一個)會被擋', () => {
    const db = setup();
    expect(codeOf(() => joinRoom(db, B, 'amy', T0 + 1, cfg))).toBe('NICKNAME_TAKEN');
    expect(codeOf(() => joinRoom(db, B, 'AMY', T0 + 1, cfg))).toBe('NICKNAME_TAKEN');
  });
  it('不合規則的代號被擋', () => {
    const db = emptyDb(T0, cfg);
    expect(codeOf(() => joinRoom(db, A, '小 明', T0, cfg))).toBe('NICKNAME_INVALID');
    expect(codeOf(() => joinRoom(db, A, 'a@b', T0, cfg))).toBe('NICKNAME_INVALID');
    expect(codeOf(() => joinRoom(db, A, '一'.repeat(21), T0, cfg))).toBe('NICKNAME_INVALID');
  });
  it('同一個分頁重新加入(重新整理)不會重複產生「坐下」訊息,也不會被自己擋住', () => {
    const db = setup();
    joinRoom(db, A, 'amy', T0 + 5000, cfg);
    expect(db.messages.filter((m) => m.kind === 'join')).toHaveLength(1);
  });
  it('離開後代號立刻釋出,並產生「離開」訊息', () => {
    const db = setup();
    leaveRoom(db, A, T0 + 1000, cfg);
    expect(db.messages.map((m) => m.kind)).toEqual(['join', 'leave']);
    joinRoom(db, B, 'Amy', T0 + 2000, cfg);
    expect(db.members[0].nickname).toBe('Amy');
  });
  it('房間從沒人變有人,火回到中等亮度', () => {
    const db = emptyDb(T0, cfg);
    db.fire = { level: 3, updatedAt: T0, lastStokedBy: null };
    joinRoom(db, A, 'Amy', T0 + 3_600_000, cfg);
    expect(currentFireLevel(db, T0 + 3_600_000, cfg)).toBe(cfg.fireStartLevel);
  });
  it('房間已有人時,新加入的人不會重設火', () => {
    const db = setup();
    stoke(db, A, T0 + 1000, cfg);
    const before = currentFireLevel(db, T0 + 2000, cfg);
    joinRoom(db, B, 'Bob', T0 + 2000, cfg);
    expect(currentFireLevel(db, T0 + 2000, cfg)).toBe(before);
  });
});

describe('離開判定(心跳、即將離開)', () => {
  it('超過 30 秒沒有心跳,被判定離開,代號釋出', () => {
    const db = setup();
    cleanup(db, T0 + 29_000, cfg);
    expect(db.members).toHaveLength(1);
    cleanup(db, T0 + 31_000, cfg);
    expect(db.members).toHaveLength(0);
    expect(db.messages.some((m) => m.kind === 'leave')).toBe(true);
  });
  it('心跳會續命', () => {
    const db = setup();
    beat(db, A, T0 + 25_000, cfg);
    cleanup(db, T0 + 50_000, cfg);
    expect(db.members).toHaveLength(1);
  });
  it('已被判定離開的人送心跳,得到 NOT_JOINED', () => {
    const db = setup();
    expect(codeOf(() => beat(db, A, T0 + 40_000, cfg))).toBe('NOT_JOINED');
  });
  it('即將離開:緩衝時間內回來就取消,沒回來就移除', () => {
    const db = setup();
    markLeavingSoon(db, A, T0 + 1000);
    cleanup(db, T0 + 5000, cfg);
    expect(db.members).toHaveLength(1);
    beat(db, A, T0 + 6000, cfg);
    cleanup(db, T0 + 20_000, cfg);
    expect(db.members).toHaveLength(1);

    markLeavingSoon(db, A, T0 + 21_000);
    cleanup(db, T0 + 32_000, cfg);
    expect(db.members).toHaveLength(0);
    expect(db.messages.some((m) => m.kind === 'leave')).toBe(true);
  });
});

describe('送訊息', () => {
  it('一般訊息由伺服器填上發言者代號', () => {
    const db = setup();
    sendChat(db, A, '哈囉', T0 + 100, cfg);
    const m = db.messages.at(-1)!;
    expect(m.kind).toBe('chat');
    expect(m.nickname).toBe('Amy');
    expect(m.body).toBe('哈囉');
  });
  it('沒加入不能送', () => {
    const db = setup();
    expect(codeOf(() => sendChat(db, B, 'hi', T0, cfg))).toBe('NOT_JOINED');
  });
  it('空白訊息被擋', () => {
    const db = setup();
    expect(codeOf(() => sendChat(db, A, '  \n ', T0, cfg))).toBe('MESSAGE_EMPTY');
  });
  it('300 字可以,301 字被擋', () => {
    const db = setup();
    sendChat(db, A, 'a'.repeat(300), T0 + 1, cfg);
    expect(codeOf(() => sendChat(db, A, 'a'.repeat(301), T0 + 20_000, cfg))).toBe('MESSAGE_TOO_LONG');
  });
  it('HTML 字串原樣存成文字', () => {
    const db = setup();
    sendChat(db, A, '<img src=x onerror=alert(1)>', T0 + 1, cfg);
    expect(db.messages.at(-1)!.body).toBe('<img src=x onerror=alert(1)>');
  });
  it('10 秒內第 6 則被擋,並告知還要等多久;過了視窗就恢復', () => {
    const db = setup();
    for (let i = 0; i < 5; i++) sendChat(db, A, `m${i}`, T0 + 1000 * i, cfg);
    let retry = 0;
    try {
      sendChat(db, A, 'm6', T0 + 5000, cfg);
    } catch (e) {
      expect((e as ChatError).code).toBe('RATE_LIMITED');
      retry = (e as ChatError).retryAfterMs ?? 0;
    }
    // 最早那則在 T0,10 秒後才滑出視窗 → 還要等 5 秒
    expect(retry).toBe(5000);
    expect(codeOf(() => sendChat(db, A, 'm6', T0 + 5000 + retry, cfg))).toBeNull();
  });
  it('頻率限制以「使用者」計算,不同使用者互不影響', () => {
    const db = setup();
    joinRoom(db, B, 'Bob', T0, cfg);
    for (let i = 0; i < 5; i++) sendChat(db, A, `m${i}`, T0 + i, cfg);
    expect(codeOf(() => sendChat(db, A, 'x', T0 + 10, cfg))).toBe('RATE_LIMITED');
    expect(codeOf(() => sendChat(db, B, 'x', T0 + 10, cfg))).toBeNull();
  });
  it('同一個使用者開第二個分頁也不能多送', () => {
    const db = setup();
    const A2: Who = { userId: A.userId, sessionId: 'sA2' };
    joinRoom(db, A2, 'Amy2', T0, cfg);
    for (let i = 0; i < 5; i++) sendChat(db, A, `m${i}`, T0 + i, cfg);
    expect(codeOf(() => sendChat(db, A2, 'x', T0 + 10, cfg))).toBe('RATE_LIMITED');
  });
  it('被擋的那次嘗試不計入次數', () => {
    const db = setup();
    for (let i = 0; i < 5; i++) sendChat(db, A, `m${i}`, T0 + i, cfg);
    for (let i = 0; i < 3; i++) codeOf(() => sendChat(db, A, 'x', T0 + 100 + i, cfg));
    expect(codeOf(() => sendChat(db, A, 'x', T0 + 10_001, cfg))).toBeNull();
  });
});

describe('加柴與營火', () => {
  it('加柴增加亮度、新增系統訊息;5 秒內再加被擋', () => {
    const db = setup();
    const before = currentFireLevel(db, T0 + 1000, cfg);
    stoke(db, A, T0 + 1000, cfg);
    expect(currentFireLevel(db, T0 + 1000, cfg)).toBeCloseTo(before + cfg.fireStokeAmount, 5);
    expect(db.messages.at(-1)!.kind).toBe('fire');
    let retry = 0;
    try {
      stoke(db, A, T0 + 3000, cfg);
    } catch (e) {
      expect((e as ChatError).code).toBe('FIRE_COOLDOWN');
      retry = (e as ChatError).retryAfterMs ?? 0;
    }
    expect(retry).toBe(3000);
    expect(codeOf(() => stoke(db, A, T0 + 6000, cfg))).toBeNull();
  });
  it('亮度上限 100', () => {
    const db = setup();
    let t = T0;
    for (let i = 0; i < 10; i++) {
      t += 6000;
      beat(db, A, t, cfg);
      stoke(db, A, t, cfg);
    }
    expect(currentFireLevel(db, t, cfg)).toBeLessThanOrEqual(100);
  });
  it('沒人加柴,火慢慢變小,最後熄滅', () => {
    const db = setup();
    const t = T0 + (cfg.fireStartLevel + 1) * cfg.fireSecondsPerPoint * 1000;
    expect(currentFireLevel(db, t, cfg)).toBe(0);
  });
});

describe('30 分鐘到期', () => {
  it('過期的訊息在快照裡看不到,清理時真的被刪掉', () => {
    const db = setup();
    sendChat(db, A, '會消失的訊息', T0 + 100, cfg);
    const ttl = cfg.messageTtlSeconds * 1000;
    expect(snapshotOf(db, A, T0 + ttl - 1000, cfg).messages.some((m) => m.body === '會消失的訊息')).toBe(true);
    expect(snapshotOf(db, A, T0 + ttl + 200, cfg).messages.some((m) => m.body === '會消失的訊息')).toBe(false);
    cleanup(db, T0 + ttl + 200, cfg);
    expect(db.messages.some((m) => m.body === '會消失的訊息')).toBe(false);
  });
  it('系統訊息(坐下)也會到期', () => {
    const db = setup();
    cleanup(db, T0 + cfg.messageTtlSeconds * 1000 + 1, cfg);
    expect(db.messages.some((m) => m.kind === 'join')).toBe(false);
  });
});
