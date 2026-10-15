// Supabase 回傳的資料與錯誤,轉成「後端合約」(backend/types.ts)規定的格式。
// 全部是純函式,不碰網路,方便單獨測試。

import { ChatError, type ErrorCode, type Fire, type Message, type MessageKind } from '../types';

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

export function isMessageRow(v: unknown): v is MessageRow {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return (
    (typeof r.id === 'number' || typeof r.id === 'string') &&
    typeof r.kind === 'string' &&
    KINDS.has(r.kind) &&
    typeof r.nickname === 'string' &&
    typeof r.created_at === 'string' &&
    typeof r.expires_at === 'string'
  );
}

export function isFireRow(v: unknown): v is FireRow {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return typeof r.level === 'number' && typeof r.updated_at === 'string';
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
