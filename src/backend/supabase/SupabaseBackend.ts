// 階段二的後端:接上真正的 Supabase。實作 backend/types.ts 的 ChatBackend 合約,畫面程式完全不用改。
//
// - 身分:匿名登入(使用者看不到)。登入狀態由 supabase-js 存在瀏覽器裡並自動續期,
//   所以重新整理、切分頁都沿用同一個身分;只有「還沒有登入狀態」時才建立新的匿名身分。
// - 所有寫入都經過資料庫函式(supabase/migrations),規則由伺服器強制;瀏覽器沒有任何直接寫入的權限。
// - 即時推送:Realtime 監聽 messages 的新增與 fire 的更新。誰坐下、誰離開,由「坐下」「離開」系統訊息得知。

import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import { session } from '../../lib/storage';
import {
  ChatError,
  type BackendEventName,
  type BackendEvents,
  type ChatBackend,
  type Snapshot,
} from '../types';
import {
  isFireRow,
  isMessageRow,
  newSessionId,
  numericId,
  toChatError,
  toFire,
  toMessage,
  UUID_RE,
} from './mapping';

const SESSION_KEY = 'campfire.sessionId';
const RESTORE_DELAY_MS = 1500;

type Handler<K extends BackendEventName> = (payload: BackendEvents[K]) => void;

/** 資料類事件在「取得快照的途中」收到時,先暫存,等畫面套用完快照再補發,才不會漏掉也不會倒退 */
interface Pending {
  event: 'message.created' | 'member.joined' | 'member.left' | 'fire.changed';
  payload: unknown;
  /** 對應的訊息編號(只有來自 messages 的事件有) */
  messageId?: number;
  /** 營火更新時間(只有 fire.changed 有) */
  fireMs?: number;
}

export class SupabaseBackend implements ChatBackend {
  readonly isDemo = false;

  private readonly client: SupabaseClient;
  private readonly url: string;
  private readonly key: string;
  private readonly sessionId: string;
  private readonly listeners = new Map<BackendEventName, Set<(p: never) => void>>();

  private started = false;
  private starting: Promise<void> | null = null;
  private joined = false;
  private channel: RealtimeChannel | null = null;
  private accessToken: string | null = null;

  private hold = false;
  private buffer: Pending[] = [];
  private baseline = { maxId: 0, fireMs: 0 };

  private reportedOffline = false;
  private restoreTimer: number | undefined;

  /** 資料表推送(Postgres Changes)是否已經就緒。頻道顯示 SUBSCRIBED 之後,還要再等約 1 秒才真的就緒 */
  private pgReady = false;
  private readyWaiters: Array<() => void> = [];
  /** 加入時推送還沒就緒:等它就緒之後,要補做一次完整同步,免得漏掉中間的訊息 */
  private needResyncOnReady = false;

  constructor(url: string, publishableKey: string) {
    this.url = url.replace(/\/+$/, '');
    this.key = publishableKey;
    this.client = createClient(this.url, publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    });
    let id = session.get(SESSION_KEY);
    if (!id || !UUID_RE.test(id)) {
      id = newSessionId();
      session.set(SESSION_KEY, id);
    }
    this.sessionId = id;
  }

  // ---------- 合約 ----------

  start(): Promise<void> {
    if (this.started) return Promise.resolve();
    this.starting ??= this.doStart().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private async doStart(): Promise<void> {
    await this.ensureIdentity();
    this.client.auth.onAuthStateChange((_event, s) => {
      this.accessToken = s?.access_token ?? null;
    });
    window.addEventListener('offline', this.onBrowserOffline);
    window.addEventListener('online', this.onBrowserOnline);
    this.subscribe();
    this.started = true;
  }

  /** 已經有登入狀態就直接用;沒有才建立匿名身分(每次重新整理都重新登入是不必要的,也會碰到每小時次數限制) */
  private async ensureIdentity(): Promise<void> {
    let data: Awaited<ReturnType<typeof this.client.auth.getSession>>['data'];
    try {
      ({ data } = await this.client.auth.getSession());
    } catch (e) {
      throw new ChatError('UNAVAILABLE', undefined, String(e));
    }
    if (data.session) {
      this.accessToken = data.session.access_token;
      return;
    }
    try {
      const res = await this.client.auth.signInAnonymously();
      if (res.error || !res.data.session) {
        throw new ChatError('UNAVAILABLE', undefined, res.error?.message ?? 'anonymous sign-in failed');
      }
      this.accessToken = res.data.session.access_token;
    } catch (e) {
      throw e instanceof ChatError ? e : new ChatError('UNAVAILABLE', undefined, String(e));
    }
  }

  async join(nickname: string): Promise<Snapshot> {
    // 盡量等到即時推送就緒再加入,這樣加入之後不會漏掉任何人的訊息(等太久就先加入,稍後補同步)
    await this.waitReady(2500);
    this.needResyncOnReady = !this.pgReady;
    return this.snapshotCall('join_room', { p_session_id: this.sessionId, p_nickname: nickname }, true);
  }

  async leave(): Promise<void> {
    this.joined = false;
    this.hold = false;
    this.buffer = [];
    await this.call('leave_room', { p_session_id: this.sessionId });
  }

  /** 分頁即將關閉:用 keepalive 的 fetch 盡力送出一次,不等結果 */
  leaveSoon(): void {
    const token = this.accessToken;
    if (!token || !this.joined) return;
    try {
      void fetch(`${this.url}/rest/v1/rpc/leave_soon`, {
        method: 'POST',
        keepalive: true,
        headers: {
          apikey: this.key,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ p_session_id: this.sessionId }),
      }).catch(() => {});
    } catch {
      // 盡力而為:失敗也沒關係,還有心跳逾時這道保險
    }
  }

  async heartbeat(): Promise<void> {
    await this.call('heartbeat', { p_session_id: this.sessionId });
  }

  async sendMessage(body: string): Promise<void> {
    await this.call('send_message', { p_session_id: this.sessionId, p_body: body });
  }

  async stokeFire(): Promise<void> {
    await this.call('stoke_fire', { p_session_id: this.sessionId });
  }

  async getSnapshot(): Promise<Snapshot> {
    return this.snapshotCall('get_snapshot', { p_session_id: this.sessionId }, false);
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

  // ---------- 呼叫資料庫函式 ----------

  /** 呼叫函式;登入過期時換發新憑證後重試一次 */
  private async call(fn: string, args: Record<string, unknown>): Promise<unknown> {
    for (let attempt = 0; attempt < 2; attempt++) {
      let res: { data: unknown; error: { message?: string; details?: string; code?: string } | null; status: number };
      try {
        res = await this.client.rpc(fn, args);
      } catch (e) {
        throw new ChatError('UNAVAILABLE', undefined, String(e));
      }
      if (!res.error) return res.data;
      if (attempt === 0 && (res.status === 401 || res.error.code === 'PGRST301')) {
        try {
          await this.client.auth.refreshSession();
          continue;
        } catch {
          // 換發失敗,照一般錯誤處理
        }
      }
      throw toChatError(res.error);
    }
    throw new ChatError('UNAVAILABLE');
  }

  /**
   * 取得快照(加入或重連):在等待回應的期間,Realtime 推來的資料先暫存,
   * 等畫面套用完快照之後再補發。
   */
  private async snapshotCall(fn: string, args: Record<string, unknown>, becomesJoined: boolean): Promise<Snapshot> {
    const track = becomesJoined || this.joined;
    if (track) {
      this.hold = true;
      this.buffer = [];
    }
    try {
      const data = (await this.call(fn, args)) as Snapshot | null;
      if (!data || typeof data !== 'object' || !('serverTime' in data)) {
        throw new ChatError('UNAVAILABLE', undefined, 'unexpected snapshot');
      }
      if (becomesJoined) this.joined = true;
      this.baseline = {
        maxId: data.messages.reduce((m, x) => Math.max(m, numericId(x.id)), 0),
        fireMs: Date.parse(data.fire.updatedAt),
      };
      if (track) window.setTimeout(this.flush, 0);
      return data;
    } catch (e) {
      if (track) {
        this.hold = false;
        this.buffer = [];
      }
      throw e;
    }
  }

  // ---------- Realtime ----------

  private subscribe(): void {
    this.channel = this.client
      .channel('campfire')
      .on('system', {}, (payload: { extension?: string; status?: string }) => {
        if (payload.extension !== 'postgres_changes') return;
        if (payload.status === 'ok') this.onPgReady();
        else if (payload.status === 'error') this.onPgDown();
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
        if (isMessageRow(payload.new)) this.onMessageRow(payload.new);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'fire' }, (payload) => {
        if (isFireRow(payload.new)) {
          const fire = toFire(payload.new);
          this.dispatch({ event: 'fire.changed', payload: fire, fireMs: Date.parse(fire.updatedAt) });
        }
      })
      .subscribe((status) => this.onChannelStatus(status));
  }

  private onMessageRow(row: Parameters<typeof toMessage>[0]): void {
    const m = toMessage(row);
    const id = numericId(m.id);
    this.dispatch({ event: 'message.created', payload: m, messageId: id });
    if (m.kind === 'join') {
      this.dispatch({ event: 'member.joined', payload: { nickname: m.nickname, joinedAt: m.createdAt }, messageId: id });
    } else if (m.kind === 'leave') {
      this.dispatch({ event: 'member.left', payload: { nickname: m.nickname }, messageId: id });
    }
  }

  /** 資料類事件:取得快照途中先暫存;已加入就直接發出;還沒加入就丟掉(之後的快照會包含它) */
  private dispatch(p: Pending): void {
    if (this.hold) this.buffer.push(p);
    else if (this.joined) this.deliver(p);
  }

  private deliver(p: Pending): void {
    this.emit(p.event as BackendEventName, p.payload as never);
  }

  private readonly flush = (): void => {
    const pending = this.buffer;
    this.buffer = [];
    this.hold = false;
    if (!this.joined) return;
    for (const p of pending) {
      // 快照已經包含的事件不要重複發(訊息本身由畫面端用編號去重)
      if (p.event === 'fire.changed' && (p.fireMs ?? 0) <= this.baseline.fireMs) continue;
      if ((p.event === 'member.joined' || p.event === 'member.left') && (p.messageId ?? 0) <= this.baseline.maxId) continue;
      this.deliver(p);
    }
  };

  // ---------- 連線狀態 ----------

  private onChannelStatus(status: string): void {
    // SUBSCRIBED 只代表頻道連上了;資料表推送要等 system 訊息說 ok 才算就緒(onPgReady)
    if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') this.onPgDown();
  }

  private onPgReady(): void {
    this.pgReady = true;
    for (const w of this.readyWaiters.splice(0)) w();
    if (this.reportedOffline) {
      this.needResyncOnReady = false;
      this.markOnline();
    } else if (this.needResyncOnReady && this.joined) {
      // 加入時推送還沒就緒,中間可能漏掉訊息:通知畫面重新同步一次
      this.needResyncOnReady = false;
      this.emit('connection.restored', undefined);
    }
  }

  private onPgDown(): void {
    this.pgReady = false;
    this.markOffline();
  }

  /** 最多等 ms 毫秒,等資料表推送就緒(就緒了就立刻回來) */
  private waitReady(ms: number): Promise<void> {
    if (this.pgReady || !this.channel) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        window.clearTimeout(timer);
        resolve();
      };
      const timer = window.setTimeout(() => {
        this.readyWaiters = this.readyWaiters.filter((w) => w !== done);
        resolve();
      }, ms);
      this.readyWaiters.push(done);
    });
  }

  private markOffline(): void {
    window.clearTimeout(this.restoreTimer);
    if (this.reportedOffline) return;
    this.reportedOffline = true;
    this.emit('connection.lost', undefined);
  }

  private markOnline(): void {
    window.clearTimeout(this.restoreTimer);
    if (!this.reportedOffline) return;
    this.reportedOffline = false;
    this.emit('connection.restored', undefined);
  }

  private readonly onBrowserOffline = (): void => {
    this.markOffline();
  };

  /** 瀏覽器說網路回來了:如果即時推送的連線其實沒斷,就直接視為恢復;斷了的話,等它重新訂閱成功 */
  private readonly onBrowserOnline = (): void => {
    window.clearTimeout(this.restoreTimer);
    this.restoreTimer = window.setTimeout(() => {
      if (this.reportedOffline && this.pgReady && this.channel?.state === 'joined') this.markOnline();
    }, RESTORE_DELAY_MS);
  };

  private emit<K extends BackendEventName>(event: K, payload: BackendEvents[K]): void {
    for (const h of this.listeners.get(event) ?? []) {
      try {
        (h as Handler<K>)(payload);
      } catch (e) {
        console.error('事件處理失敗', event, e);
      }
    }
  }
}
