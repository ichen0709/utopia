// 模擬「伺服器」的規則。全部是純函式,操作一份資料 (LocalDb),不碰畫面、不碰瀏覽器。
// 階段二這些規則會改寫在 Supabase 的資料庫函式裡(supabase/migrations/),行為必須保持一致。

import { cleanMessage } from '../../shared/message';
import { checkNickname, nicknameKey } from '../../shared/nickname';
import { chars } from '../../shared/text';
import { levelAt } from '../../shared/fire';
import {
  ChatError,
  type Fire,
  type Member,
  type Message,
  type MessageKind,
  type RoomConfig,
  type Snapshot,
} from '../types';

export interface MemberRow {
  sessionId: string;
  userId: string;
  nickname: string;
  joinedAt: number;
  lastBeatAt: number;
  /** 收到「即將離開」的時間;緩衝時間內同一個分頁回來就取消 */
  leavingAt: number | null;
  isBot: boolean;
}

export interface MessageRow {
  id: string;
  kind: MessageKind;
  nickname: string;
  body: string | null;
  userId: string;
  createdAt: number;
  expiresAt: number;
}

export interface FireRow {
  level: number;
  updatedAt: number;
  lastStokedBy: string | null;
}

export interface LocalDb {
  v: 1;
  nextId: number;
  messages: MessageRow[];
  members: MemberRow[];
  fire: FireRow;
  /** 每個使用者最近送出一般訊息的時間(頻率限制用) */
  sends: Record<string, number[]>;
  /** 每個使用者上次加柴的時間(冷卻用) */
  stokes: Record<string, number>;
  botsQuiet: boolean;
}

export interface Who {
  userId: string;
  sessionId: string;
}

export function emptyDb(now: number, cfg: RoomConfig): LocalDb {
  return {
    v: 1,
    nextId: 1,
    messages: [],
    members: [],
    fire: { level: cfg.fireStartLevel, updatedAt: now, lastStokedBy: null },
    sends: {},
    stokes: {},
    botsQuiet: false,
  };
}

export function addMessage(
  db: LocalDb,
  m: { kind: MessageKind; nickname: string; body: string | null; userId: string },
  now: number,
  cfg: RoomConfig,
): MessageRow {
  const row: MessageRow = {
    id: `m${db.nextId++}`,
    kind: m.kind,
    nickname: m.nickname,
    body: m.body,
    userId: m.userId,
    createdAt: now,
    expiresAt: now + cfg.messageTtlSeconds * 1000,
  };
  db.messages.push(row);
  return row;
}

function removeMember(db: LocalDb, row: MemberRow, now: number, cfg: RoomConfig): void {
  db.members = db.members.filter((m) => m !== row);
  addMessage(db, { kind: 'leave', nickname: row.nickname, body: null, userId: row.userId }, now, cfg);
}

/** 伺服器的定時清理:移除沒有心跳或已通知離開的成員、刪除過期訊息 */
export function cleanup(db: LocalDb, now: number, cfg: RoomConfig): void {
  for (const m of [...db.members]) {
    if (m.isBot) continue;
    const stale = now - m.lastBeatAt > cfg.staleSeconds * 1000;
    const left = m.leavingAt !== null && now - m.leavingAt > cfg.leaveGraceSeconds * 1000;
    if (stale || left) removeMember(db, m, now, cfg);
  }
  db.messages = db.messages.filter((m) => m.expiresAt > now);
}

function requireMember(db: LocalDb, who: Who): MemberRow {
  const me = db.members.find((m) => m.sessionId === who.sessionId);
  if (!me) throw new ChatError('NOT_JOINED');
  return me;
}

export function currentFireLevel(db: LocalDb, now: number, cfg: RoomConfig): number {
  return levelAt(db.fire.level, db.fire.updatedAt, now, cfg.fireSecondsPerPoint);
}

export function joinRoom(db: LocalDb, who: Who, rawNickname: string, now: number, cfg: RoomConfig): void {
  const check = checkNickname(rawNickname, cfg.nicknameMax);
  if (!check.ok) throw new ChatError('NICKNAME_INVALID', undefined, check.problem);
  const nickname = check.value;
  const key = nicknameKey(nickname);

  cleanup(db, now, cfg);

  const mine = db.members.find((m) => m.sessionId === who.sessionId);
  if (mine && nicknameKey(mine.nickname) === key) {
    // 同一個分頁重新加入(例如重新整理):直接接回,不產生新的「坐下」提示
    mine.lastBeatAt = now;
    mine.leavingAt = null;
    return;
  }
  const clash = db.members.find((m) => nicknameKey(m.nickname) === key && m.sessionId !== who.sessionId);
  if (clash) throw new ChatError('NICKNAME_TAKEN');

  if (mine) removeMember(db, mine, now, cfg);

  const humansBefore = db.members.filter((m) => !m.isBot).length;
  db.members.push({
    sessionId: who.sessionId,
    userId: who.userId,
    nickname,
    joinedAt: now,
    lastBeatAt: now,
    leavingAt: null,
    isBot: false,
  });
  // 房間從沒有人變成有人:火回到中等亮度(房間沒人時火的時間不計算)
  if (humansBefore === 0) {
    db.fire = { level: cfg.fireStartLevel, updatedAt: now, lastStokedBy: null };
  }
  addMessage(db, { kind: 'join', nickname, body: null, userId: who.userId }, now, cfg);
}

export function leaveRoom(db: LocalDb, who: Who, now: number, cfg: RoomConfig): void {
  const me = db.members.find((m) => m.sessionId === who.sessionId);
  if (me) removeMember(db, me, now, cfg);
}

export function markLeavingSoon(db: LocalDb, who: Who, now: number): void {
  const me = db.members.find((m) => m.sessionId === who.sessionId);
  if (me) me.leavingAt = now;
}

export function beat(db: LocalDb, who: Who, now: number, cfg: RoomConfig): void {
  cleanup(db, now, cfg);
  const me = requireMember(db, who);
  me.lastBeatAt = now;
  me.leavingAt = null;
}

export function sendChat(db: LocalDb, who: Who, raw: string, now: number, cfg: RoomConfig): void {
  cleanup(db, now, cfg);
  const me = requireMember(db, who);
  const body = cleanMessage(raw);
  if (!body) throw new ChatError('MESSAGE_EMPTY');
  if (chars(body) > cfg.maxMessageLength) throw new ChatError('MESSAGE_TOO_LONG');

  // 頻率限制:以「使用者」計算(開很多分頁也不能多送)
  const windowMs = cfg.rateLimitWindowSeconds * 1000;
  const recent = (db.sends[who.userId] ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= cfg.rateLimitCount) {
    throw new ChatError('RATE_LIMITED', Math.max(1, recent[0] + windowMs - now));
  }
  recent.push(now);
  db.sends[who.userId] = recent;

  me.lastBeatAt = now;
  me.leavingAt = null;
  // 發言者的代號由「伺服器」依身分查出來,不信任畫面帶來的任何名字
  addMessage(db, { kind: 'chat', nickname: me.nickname, body, userId: who.userId }, now, cfg);
}

export function stoke(db: LocalDb, who: Who, now: number, cfg: RoomConfig): void {
  cleanup(db, now, cfg);
  const me = requireMember(db, who);
  const last = db.stokes[who.userId];
  if (last !== undefined && now - last < cfg.stokeCooldownSeconds * 1000) {
    throw new ChatError('FIRE_COOLDOWN', last + cfg.stokeCooldownSeconds * 1000 - now);
  }
  db.stokes[who.userId] = now;
  me.lastBeatAt = now;
  me.leavingAt = null;
  addFuel(db, me.nickname, who.userId, now, cfg);
}

/** 加一根柴:先算出當下亮度,再加上一根柴的量(上限 100),並新增一則加柴系統訊息 */
export function addFuel(db: LocalDb, nickname: string, userId: string, now: number, cfg: RoomConfig): void {
  const level = Math.min(100, currentFireLevel(db, now, cfg) + cfg.fireStokeAmount);
  db.fire = { level, updatedAt: now, lastStokedBy: nickname };
  addMessage(db, { kind: 'fire', nickname, body: null, userId }, now, cfg);
}

export function setFireLevel(db: LocalDb, level: number, now: number): void {
  db.fire = { level, updatedAt: now, lastStokedBy: db.fire.lastStokedBy };
}

const iso = (ms: number) => new Date(ms).toISOString();

export function toMessage(m: MessageRow): Message {
  return {
    id: m.id,
    kind: m.kind,
    nickname: m.nickname,
    body: m.body,
    createdAt: iso(m.createdAt),
    expiresAt: iso(m.expiresAt),
  };
}

export function toMember(m: MemberRow): Member {
  return { nickname: m.nickname, joinedAt: iso(m.joinedAt) };
}

export function toFire(f: FireRow): Fire {
  return { level: f.level, updatedAt: iso(f.updatedAt), lastStokedBy: f.lastStokedBy };
}

/** 取得快照。過期的訊息一律不回傳(就像資料庫的列級權限會把它們濾掉) */
export function snapshotOf(db: LocalDb, who: Who, now: number, cfg: RoomConfig): Snapshot {
  const me = db.members.find((m) => m.sessionId === who.sessionId);
  const messages = db.messages
    .filter((m) => m.expiresAt > now)
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id, 'en', { numeric: true }));
  return {
    serverTime: iso(now),
    config: cfg,
    me: me ? { nickname: me.nickname } : null,
    members: [...db.members].sort((a, b) => a.joinedAt - b.joinedAt).map(toMember),
    messages: messages.map(toMessage),
    fire: toFire(db.fire),
  };
}
