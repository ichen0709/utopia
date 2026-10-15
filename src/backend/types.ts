// 「後端合約」:畫面只透過這份合約和後端說話(architecture.md 第 5 章)。
// 階段一由 local/LocalBackend 實作;階段二換成 Supabase 的實作,畫面程式不用改。

export type MessageKind = 'chat' | 'join' | 'leave' | 'fire';

export interface Message {
  id: string;
  kind: MessageKind;
  nickname: string;
  /** 一般訊息的文字;系統訊息(join / leave / fire)為 null */
  body: string | null;
  /** 伺服器時間,ISO 8601 */
  createdAt: string;
  expiresAt: string;
}

export interface Member {
  nickname: string;
  joinedAt: string;
}

export interface Fire {
  /** 0 到 100,在 updatedAt 那一刻的亮度 */
  level: number;
  updatedAt: string;
  lastStokedBy: string | null;
}

/** 伺服器決定的規則數值(architecture.md 5.1),畫面從快照取得,不自己寫死 */
export interface RoomConfig {
  messageTtlSeconds: number;
  maxMessageLength: number;
  nicknameMax: number;
  rateLimitCount: number;
  rateLimitWindowSeconds: number;
  stokeCooldownSeconds: number;
  fireStartLevel: number;
  fireStokeAmount: number;
  /** 火每降 1 點亮度需要幾秒 */
  fireSecondsPerPoint: number;
  heartbeatSeconds: number;
  staleSeconds: number;
  leaveGraceSeconds: number;
}

export interface Snapshot {
  serverTime: string;
  config: RoomConfig;
  me: { nickname: string } | null;
  members: Member[];
  messages: Message[];
  fire: Fire;
}

export type ErrorCode =
  | 'NICKNAME_INVALID'
  | 'NICKNAME_TAKEN'
  | 'MESSAGE_EMPTY'
  | 'MESSAGE_TOO_LONG'
  | 'RATE_LIMITED'
  | 'FIRE_COOLDOWN'
  | 'NOT_JOINED'
  | 'UNAVAILABLE';

export class ChatError extends Error {
  readonly code: ErrorCode;
  /** 還要等多久才能再試(只有 RATE_LIMITED 與 FIRE_COOLDOWN 會有) */
  readonly retryAfterMs?: number;

  constructor(code: ErrorCode, retryAfterMs?: number, detail?: string) {
    super(detail ?? code);
    this.name = 'ChatError';
    this.code = code;
    this.retryAfterMs = retryAfterMs;
  }
}

export function asChatError(e: unknown): ChatError {
  return e instanceof ChatError ? e : new ChatError('UNAVAILABLE', undefined, String(e));
}

export interface BackendEvents {
  'message.created': Message;
  'member.joined': Member;
  'member.left': { nickname: string };
  'fire.changed': Fire;
  'connection.lost': undefined;
  'connection.restored': undefined;
}

export type BackendEventName = keyof BackendEvents;

/** 只有模擬後端才有的測試工具(階段二的後端沒有這個,測試工具自然不會出現) */
export interface DevTools {
  isOffline(): boolean;
  setOffline(offline: boolean): void;
  setFire(level: number): void;
  botSay(): void;
  botMention(): void;
  isBotsQuiet(): boolean;
  setBotsQuiet(quiet: boolean): void;
  clearMessages(): void;
}

export interface ChatBackend {
  /** 是否為示範用的模擬後端。畫面用它決定要不要顯示「示範模式」橫幅 */
  readonly isDemo: boolean;
  readonly devTools?: DevTools;

  /** 啟動後端(取得身分、建立連線)。失敗時丟出 UNAVAILABLE */
  start(): Promise<void>;
  join(nickname: string): Promise<Snapshot>;
  leave(): Promise<void>;
  /** 瀏覽器分頁即將關閉時盡力呼叫一次;同步、不等結果 */
  leaveSoon(): void;
  heartbeat(): Promise<void>;
  sendMessage(body: string): Promise<void>;
  stokeFire(): Promise<void>;
  getSnapshot(): Promise<Snapshot>;
  on<K extends BackendEventName>(event: K, handler: (payload: BackendEvents[K]) => void): () => void;
}
