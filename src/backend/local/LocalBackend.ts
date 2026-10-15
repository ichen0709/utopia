// 階段一的模擬後端:全部在瀏覽器裡執行。
// - 「資料庫」存在 localStorage,所以同一個瀏覽器的多個分頁會互相同步(用 storage 事件通知)。
// - 規則由 room.ts 的純函式實作,模擬伺服器的行為與錯誤種類。
// - 模擬的營火夥伴由其中一個分頁(領頭的)驅動。

import { DEFAULT_ROOM_CONFIG } from '../../config';
import { local, randomId, session } from '../../lib/storage';
import { nicknameKey } from '../../shared/nickname';
import {
  ChatError,
  type BackendEventName,
  type BackendEvents,
  type ChatBackend,
  type DevTools,
  type RoomConfig,
  type Snapshot,
} from '../types';
import { botSpeak, botStep, seedDb } from './bots';
import { readDevParams } from './params';
import {
  beat,
  cleanup,
  emptyDb,
  joinRoom,
  leaveRoom,
  markLeavingSoon,
  sendChat,
  setAway,
  setFireLevel,
  snapshotOf,
  stoke,
  toFire,
  toMember,
  toMessage,
  type LocalDb,
  type Who,
} from './room';

const DB_KEY = 'campfire.local.db.v1';
const LEASE_KEY = 'campfire.local.botLease.v1';
const USER_KEY = 'campfire.userId';
const SESSION_KEY = 'campfire.sessionId';
const RECONNECT_DELAY_MS = 1500;

const awayKeyOf = (names: string[]): string => [...names].sort().join('\u0000');

type Handler<K extends BackendEventName> = (payload: BackendEvents[K]) => void;

/** 這個分頁目前「看到」的狀態,用來比較出新增了什麼、少了什麼,再發出事件 */
interface Seen {
  messageIds: Set<string>;
  memberKeys: Set<string>;
  fireKey: string;
  /** 目前暫離中的人(排序後用逗號連起來),有變就發 away.changed */
  awayKey: string;
}

export class LocalBackend implements ChatBackend {
  readonly isDemo = true;
  readonly devTools: DevTools;

  private readonly cfg: RoomConfig;
  private readonly params = readDevParams(typeof location === 'undefined' ? '' : location.search, Date.now());
  private readonly who: Who;
  private readonly tabId = randomId();
  private readonly listeners = new Map<BackendEventName, Set<(p: never) => void>>();

  private started = false;
  private joined = false;
  private seen: Seen | null = null;
  private simulatedOffline = false;
  private reportedOffline = false;
  private reconnectTimer: number | undefined;
  private lastRaw: string | null = null;

  constructor() {
    this.cfg = {
      ...DEFAULT_ROOM_CONFIG,
      ...(this.params.ttlSeconds ? { messageTtlSeconds: this.params.ttlSeconds } : {}),
      ...(this.params.secondsPerPoint ? { fireSecondsPerPoint: this.params.secondsPerPoint } : {}),
    };
    let userId = local.get(USER_KEY);
    if (!userId) {
      userId = randomId();
      local.set(USER_KEY, userId);
    }
    let sessionId = session.get(SESSION_KEY);
    if (!sessionId) {
      sessionId = randomId();
      session.set(SESSION_KEY, sessionId);
    }
    this.who = { userId, sessionId };
    this.devTools = this.makeDevTools();
  }

  // ---------- 合約 ----------

  async start(): Promise<void> {
    if (Date.now() < this.params.unavailableUntil) throw new ChatError('UNAVAILABLE');
    if (this.started) return;
    this.started = true;
    this.reportedOffline = this.isOffline();

    window.addEventListener('storage', this.onStorage);
    window.addEventListener('online', this.reevaluateConnection);
    window.addEventListener('offline', this.reevaluateConnection);
    window.setInterval(() => this.serverTick(), 5000);
    window.setInterval(() => this.botTick(), 1000);
    this.serverTick();
  }

  async join(nickname: string): Promise<Snapshot> {
    const snap = this.commit((db, now) => {
      joinRoom(db, this.who, nickname, now, this.cfg);
      return snapshotOf(db, this.who, now, this.cfg);
    });
    this.joined = true;
    this.seen = this.seenFrom(snap);
    return snap;
  }

  async leave(): Promise<void> {
    this.joined = false;
    this.seen = null;
    this.commit((db, now) => leaveRoom(db, this.who, now, this.cfg));
  }

  leaveSoon(): void {
    try {
      this.commit((db, now) => markLeavingSoon(db, this.who, now));
    } catch {
      // 盡力而為:失敗也沒關係,還有心跳逾時這道保險
    }
  }

  async heartbeat(): Promise<void> {
    this.commit((db, now) => beat(db, this.who, now, this.cfg));
  }

  async sendMessage(body: string): Promise<void> {
    this.commit((db, now) => sendChat(db, this.who, body, now, this.cfg));
  }

  async stokeFire(): Promise<void> {
    this.commit((db, now) => stoke(db, this.who, now, this.cfg));
  }

  async setAway(away: boolean): Promise<void> {
    this.commit((db, now) => setAway(db, this.who, away, now, this.cfg));
  }

  async getSnapshot(): Promise<Snapshot> {
    const snap = this.commit((db, now) => {
      cleanup(db, now, this.cfg);
      return snapshotOf(db, this.who, now, this.cfg);
    });
    if (this.joined) this.seen = this.seenFrom(snap);
    return snap;
  }

  on<K extends BackendEventName>(event: K, handler: Handler<K>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(handler as (p: never) => void);
    return () => set.delete(handler as (p: never) => void);
  }

  // ---------- 內部:資料庫 ----------

  private emit<K extends BackendEventName>(event: K, payload: BackendEvents[K]): void {
    for (const h of this.listeners.get(event) ?? []) {
      try {
        (h as Handler<K>)(payload);
      } catch (e) {
        console.error('事件處理失敗', event, e);
      }
    }
  }

  private load(now: number): LocalDb {
    const raw = local.get(DB_KEY);
    this.lastRaw = raw;
    let db: LocalDb | null = null;
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as LocalDb;
        if (parsed && parsed.v === 1) db = parsed;
      } catch {
        db = null;
      }
    }
    if (!db) {
      db = emptyDb(now, this.cfg);
      if (this.params.bots) seedDb(db, now, this.cfg);
    }
    if (!this.params.bots) db.members = db.members.filter((m) => !m.isBot);
    return db;
  }

  /** 讀取資料、執行一個動作、存回去、再通知畫面。出錯時整個動作作廢,不會留下半套資料。 */
  private commit<T>(fn: (db: LocalDb, now: number) => T): T {
    if (this.isOffline()) throw new ChatError('UNAVAILABLE');
    const now = Date.now();
    const db = this.load(now);
    const result = fn(db, now);
    const raw = JSON.stringify(db);
    if (raw !== this.lastRaw) {
      local.set(DB_KEY, raw);
      this.lastRaw = raw;
    }
    this.sync(db, now);
    return result;
  }

  private seenFrom(snap: Snapshot): Seen {
    return {
      messageIds: new Set(snap.messages.map((m) => m.id)),
      memberKeys: new Set(snap.members.map((m) => nicknameKey(m.nickname))),
      fireKey: `${snap.fire.level}|${snap.fire.updatedAt}`,
      awayKey: awayKeyOf(snap.members.filter((m) => m.away).map((m) => m.nickname)),
    };
  }

  /** 比較「資料庫現在的樣子」和「這個分頁看過的樣子」,把新增與減少的部分變成事件 */
  private sync(db: LocalDb, now: number): void {
    if (!this.joined || !this.seen) return;
    const seen = this.seen;

    const nextMessageIds = new Set<string>();
    for (const row of db.messages) {
      if (row.expiresAt <= now) continue;
      nextMessageIds.add(row.id);
      if (!seen.messageIds.has(row.id)) this.emit('message.created', toMessage(row));
    }
    seen.messageIds = nextMessageIds;

    const nextMemberKeys = new Set<string>();
    for (const row of db.members) {
      const key = nicknameKey(row.nickname);
      nextMemberKeys.add(key);
      if (!seen.memberKeys.has(key)) this.emit('member.joined', toMember(row));
    }
    const names = new Map(db.members.map((m) => [nicknameKey(m.nickname), m.nickname]));
    for (const key of seen.memberKeys) {
      if (!nextMemberKeys.has(key)) this.emit('member.left', { nickname: names.get(key) ?? key });
    }
    seen.memberKeys = nextMemberKeys;

    const awayNames = db.members.filter((m) => m.away).map((m) => m.nickname);
    const awayKey = awayKeyOf(awayNames);
    if (awayKey !== seen.awayKey) {
      seen.awayKey = awayKey;
      this.emit('away.changed', { nicknames: [...awayNames].sort() });
    }

    const fire = toFire(db.fire);
    const fireKey = `${fire.level}|${fire.updatedAt}`;
    if (fireKey !== seen.fireKey) {
      seen.fireKey = fireKey;
      this.emit('fire.changed', fire);
    }
  }

  private readonly onStorage = (e: StorageEvent): void => {
    if (e.key !== DB_KEY || !this.joined || this.isOffline()) return;
    this.sync(this.load(Date.now()), Date.now());
  };

  // ---------- 內部:定時工作 ----------

  /** 伺服器的定時清理(每個分頁都會做,做幾次結果都一樣) */
  private serverTick(): void {
    if (this.isOffline()) return;
    try {
      this.commit((db, now) => cleanup(db, now, this.cfg));
    } catch {
      // 離線或其他暫時性問題,下一輪再試
    }
  }

  private botTick(): void {
    if (!this.params.bots || this.isOffline() || !this.isLeader()) return;
    try {
      this.commit((db, now) => botStep(db, now, this.cfg));
    } catch {
      // 同上
    }
  }

  /** 多個分頁同時開著時,只讓其中一個驅動模擬夥伴 */
  private isLeader(): boolean {
    const now = Date.now();
    let lease: { tab: string; until: number } | null = null;
    try {
      const raw = local.get(LEASE_KEY);
      lease = raw ? (JSON.parse(raw) as { tab: string; until: number }) : null;
    } catch {
      lease = null;
    }
    if (!lease || lease.until < now || lease.tab === this.tabId) {
      local.set(LEASE_KEY, JSON.stringify({ tab: this.tabId, until: now + 4000 }));
      return true;
    }
    return false;
  }

  // ---------- 內部:連線狀態 ----------

  private isOffline(): boolean {
    return this.simulatedOffline || (typeof navigator !== 'undefined' && navigator.onLine === false);
  }

  /** 網路狀態改變時:斷線立刻通知;恢復則等一小段時間(模擬重新連線)再通知 */
  private readonly reevaluateConnection = (): void => {
    const offline = this.isOffline();
    if (offline && !this.reportedOffline) {
      this.reportedOffline = true;
      window.clearTimeout(this.reconnectTimer);
      this.emit('connection.lost', undefined);
    } else if (!offline && this.reportedOffline) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = window.setTimeout(() => {
        if (this.isOffline()) return;
        this.reportedOffline = false;
        this.emit('connection.restored', undefined);
      }, RECONNECT_DELAY_MS);
    }
  };

  // ---------- 測試工具 ----------

  private makeDevTools(): DevTools {
    return {
      isOffline: () => this.simulatedOffline,
      setOffline: (offline) => {
        this.simulatedOffline = offline;
        this.reevaluateConnection();
      },
      setFire: (level) => {
        this.commit((db, now) => setFireLevel(db, level, now));
      },
      botSay: () => {
        this.commit((db, now) => botSpeak(db, now, this.cfg, null));
      },
      botMention: () => {
        this.commit((db, now) => {
          const me = db.members.find((m) => m.sessionId === this.who.sessionId);
          botSpeak(db, now, this.cfg, me ? me.nickname : null);
        });
      },
      isBotsQuiet: () => {
        try {
          return this.load(Date.now()).botsQuiet;
        } catch {
          return false;
        }
      },
      setBotsQuiet: (quiet) => {
        this.commit((db) => {
          db.botsQuiet = quiet;
        });
      },
      clearMessages: () => {
        this.commit((db) => {
          db.messages = [];
        });
      },
    };
  }
}
