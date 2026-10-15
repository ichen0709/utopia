// Supabase 回傳的資料與錯誤,轉成「後端合約」(backend/types.ts)規定的格式。
// 全部是純函式,不碰網路,方便單獨測試。

import { DEFAULT_ROOM_CONFIG } from '../../config';
import { chars } from '../../shared/text';
import {
  ChatError,
  type ErrorCode,
  type Fire,
  type Member,
  type Message,
  type MessageKind,
  type RoomConfig,
  type Snapshot,
} from '../types';

// 畫面不信任從網路收到的任何資料:長度上限用預設的規則數值(訊息 300 字、代號 20 字)。
// 所有檢查都不會丟出例外,也不會在 Console 印東西 —— 不合格的資料一律安靜地丟掉。
const MAX_BODY = DEFAULT_ROOM_CONFIG.maxMessageLength;
const MAX_NICKNAME = DEFAULT_ROOM_CONFIG.nicknameMax;

const KNOWN_CODES: ReadonlySet<string> = new Set<ErrorCode>([
  'NICKNAME_INVALID',
  'NICKNAME_TAKEN',
  'MESSAGE_EMPTY',
  'MESSAGE_TOO_LONG',
  'RATE_LIMITED',
  'FIRE_COOLDOWN',
  'NOT_JOINED',
]);

export interface RpcErrorLike {
  message?: string | null;
  details?: string | null;
  code?: string | null;
}

/**
 * 資料庫函式丟出的錯誤:message 就是錯誤代碼(例如 RATE_LIMITED);
 * 需要等待時間的,毫秒數放在 details;代號不合規則時 details 是原因。
 * 其他一切(網路中斷、登入過期、伺服器錯誤……)都當作 UNAVAILABLE。
 */
export function toChatError(err: RpcErrorLike): ChatError {
  const message = (err.message ?? '').trim();
  if (KNOWN_CODES.has(message)) {
    const code = message as ErrorCode;
    const ms = Number(err.details);
    const wantsWait = code === 'RATE_LIMITED' || code === 'FIRE_COOLDOWN';
    return new ChatError(code, wantsWait && Number.isFinite(ms) && ms > 0 ? ms : undefined, err.details ?? undefined);
  }
  return new ChatError('UNAVAILABLE', undefined, message || err.code || 'unknown');
}

/** Realtime 推送來的 messages 資料列(欄位是資料庫的欄位名稱) */
export interface MessageRow {
  id: number | string;
  kind: string;
  nickname: string;
  body: string | null;
  created_at: string;
  expires_at: string;
}

export interface FireRow {
  level: number;
  updated_at: string;
  last_stoked_by: string | null;
}

const KINDS: ReadonlySet<string> = new Set(['chat', 'join', 'leave', 'fire']);
const iso = (s: string) => new Date(s).toISOString();

// ---------- 欄位檢查的小工具(全部不會丟出例外) ----------

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** 是可以解析的時間字串 */
const isTime = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v));

/** 訊息編號:數字(有限)或非空字串 */
const isId = (v: unknown): v is number | string =>
  (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && v.length > 0);

/** 代號:字串,長度 1 到 20 字 */
const isNickname = (v: unknown): v is string => {
  if (typeof v !== 'string') return false;
  const n = chars(v);
  return n >= 1 && n <= MAX_NICKNAME;
};

/**
 * 訊息內容與種類要一致:
 *  - chat:一定要有非空的文字內容,長度不超過 300 字
 *  - join / leave / fire(系統訊息):內容可以是 null、沒有、或字串;如果是字串,同樣不能超過 300 字
 *  - 其他型別(數字、物件……)一律不合格
 */
const isBodyFor = (kind: string, body: unknown): boolean => {
  if (kind === 'chat') return typeof body === 'string' && body.trim().length > 0 && chars(body) <= MAX_BODY;
  if (body === null || body === undefined) return true;
  return typeof body === 'string' && chars(body) <= MAX_BODY;
};

/** 營火亮度:數字,0 到 100(architecture.md 5.4) */
const isLevel = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100;

// ---------- 即時推送來的資料列(欄位是資料庫的欄位名稱) ----------

export function isMessageRow(v: unknown): v is MessageRow {
  if (!isRecord(v)) return false;
  return (
    isId(v.id) &&
    typeof v.kind === 'string' &&
    KINDS.has(v.kind) &&
    isNickname(v.nickname) &&
    isBodyFor(v.kind, v.body) &&
    isTime(v.created_at) &&
    isTime(v.expires_at)
  );
}

export function isFireRow(v: unknown): v is FireRow {
  if (!isRecord(v)) return false;
  return (
    isLevel(v.level) &&
    isTime(v.updated_at) &&
    (v.last_stoked_by === null || v.last_stoked_by === undefined || typeof v.last_stoked_by === 'string')
  );
}

// ---------- 快照(get_snapshot / join_room 的回傳):逐項檢查,不合格的項目丟掉,其餘照常 ----------

/** 快照裡的一則訊息(已經是合約格式)。不合格回傳 null */
export function parseSnapshotMessage(v: unknown): Message | null {
  if (!isRecord(v)) return null;
  if (!isId(v.id) || typeof v.kind !== 'string' || !KINDS.has(v.kind)) return null;
  if (!isNickname(v.nickname) || !isBodyFor(v.kind, v.body)) return null;
  if (!isTime(v.createdAt) || !isTime(v.expiresAt)) return null;
  return {
    id: String(v.id),
    kind: v.kind as MessageKind,
    nickname: v.nickname,
    body: typeof v.body === 'string' ? v.body : null,
    createdAt: iso(v.createdAt),
    expiresAt: iso(v.expiresAt),
  };
}

/** 快照裡的一位成員。不合格回傳 null */
export function parseSnapshotMember(v: unknown): Member | null {
  if (!isRecord(v) || !isNickname(v.nickname) || !isTime(v.joinedAt)) return null;
  // 暫離標記只認 true;缺少或型別不對(不合格)一律當作沒有暫離,成員本身照常顯示
  return { nickname: v.nickname, joinedAt: iso(v.joinedAt), away: v.away === true };
}

/** 快照裡的營火。不合格回傳 null */
export function parseSnapshotFire(v: unknown): Fire | null {
  if (!isRecord(v) || !isLevel(v.level) || !isTime(v.updatedAt)) return null;
  if (v.lastStokedBy !== null && v.lastStokedBy !== undefined && typeof v.lastStokedBy !== 'string') return null;
  return { level: v.level, updatedAt: iso(v.updatedAt), lastStokedBy: typeof v.lastStokedBy === 'string' ? v.lastStokedBy : null };
}

// ---------- 暫離名單(room_away 表的即時推送) ----------

/** 暫離名單最多收這麼多個(遠大於實際人數,只是擋掉誇張的資料) */
const MAX_AWAY = 500;

/** 版本:有限的數字,不小於 0 */
const isVersion = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/**
 * 即時推送來的暫離名單資料列(room_away):
 *  - nicknames 必須是陣列;裡面不合格的項目(不是字串、長度不在 1 到 20 字)丟掉,其餘照常
 *  - version 必須是不小於 0 的有限數字
 *  - 整列不成樣子 → 回傳 null(整筆丟掉)
 * 不會丟出例外,也不會印任何東西。
 */
export function parseAwayRow(v: unknown): { nicknames: string[]; version: number } | null {
  if (!isRecord(v) || !Array.isArray(v.nicknames) || !isVersion(v.version)) return null;
  const nicknames: string[] = [];
  for (const n of v.nicknames.slice(0, MAX_AWAY)) if (isNickname(n)) nicknames.push(n);
  return { nicknames, version: v.version };
}

/** 規則數值:有效的(有限的正數)才採用,不合格的欄位退回預設值 */
function parseConfig(v: unknown): RoomConfig {
  const out: Record<string, number> = { ...DEFAULT_ROOM_CONFIG };
  if (isRecord(v)) {
    for (const key of Object.keys(DEFAULT_ROOM_CONFIG)) {
      const x = v[key];
      if (typeof x === 'number' && Number.isFinite(x) && x > 0) out[key] = x;
    }
  }
  return out as unknown as RoomConfig;
}

/**
 * 整份快照逐項檢查:
 *  - 整份不成樣子(不是物件、沒有可解析的 serverTime、messages 或 members 不是陣列)→ 回傳 null,由呼叫端當作「暫時連不上」
 *  - 每則訊息、每位成員、我自己、營火、規則數值各自檢查:不合格的項目丟掉(訊息、成員)或退回安全的預設值(我自己 → 沒加入;營火 → 中等亮度;規則數值 → 預設值),其餘照常顯示
 * 不會丟出例外,也不會印任何東西。
 */
export function sanitizeSnapshot(v: unknown): Snapshot | null {
  if (!isRecord(v) || !isTime(v.serverTime) || !Array.isArray(v.messages) || !Array.isArray(v.members)) return null;
  const config = parseConfig(v.config);
  const serverTime = iso(v.serverTime);
  const messages: Message[] = [];
  for (const m of v.messages) {
    const ok = parseSnapshotMessage(m);
    if (ok) messages.push(ok);
  }
  const members: Member[] = [];
  for (const m of v.members) {
    const ok = parseSnapshotMember(m);
    if (ok) members.push(ok);
  }
  const me = isRecord(v.me) && isNickname(v.me.nickname) ? { nickname: v.me.nickname } : null;
  const fire = parseSnapshotFire(v.fire) ?? {
    level: Math.min(100, config.fireStartLevel),
    updatedAt: serverTime,
    lastStokedBy: null,
  };
  const awayVersion = isVersion(v.awayVersion) ? v.awayVersion : undefined;
  return { serverTime, config, me, members, ...(awayVersion === undefined ? {} : { awayVersion }), messages, fire };
}

export function toMessage(row: MessageRow): Message {
  return {
    id: String(row.id),
    kind: row.kind as MessageKind,
    nickname: row.nickname,
    body: row.body,
    createdAt: iso(row.created_at),
    expiresAt: iso(row.expires_at),
  };
}

export function toFire(row: FireRow): Fire {
  return { level: row.level, updatedAt: iso(row.updated_at), lastStokedBy: row.last_stoked_by ?? null };
}

/** 訊息編號(資料庫是整數,隨新增遞增) */
export function numericId(id: string | number): number {
  const n = Number(id);
  return Number.isFinite(n) ? n : 0;
}

/** 分頁工作階段編號:資料庫要求是 UUID 格式 */
export function newSessionId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const b = new Uint8Array(16);
  c.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0'));
  return `${h.slice(0, 4).join('')}-${h.slice(4, 6).join('')}-${h.slice(6, 8).join('')}-${h.slice(8, 10).join('')}-${h.slice(10).join('')}`;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
