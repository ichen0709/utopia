// 畫面的「狀態中心」:接收後端事件、整理成畫面要用的資料、提供動作給畫面呼叫。
// 這裡只透過 ChatBackend 合約和後端說話,不知道後端是模擬的還是 Supabase。

import {
  asChatError,
  type ChatBackend,
  type Fire,
  type Member,
  type Message,
  type RoomConfig,
  type Snapshot,
} from '../backend/types';
import { DEFAULT_ROOM_CONFIG, MIN_LOADING_MS, RETRY_SECONDS } from '../config';
import { mentions } from '../shared/mention';
import { checkNickname, nicknameKey, nicknameProblemText } from '../shared/nickname';
import { local } from './storage';
import { playMention, unlockSound } from './sound';

export type Phase = 'loading' | 'join' | 'room' | 'unavailable';

/** 畫面用的訊息:多帶兩個毫秒時間,免得每次重畫都要重新解析日期字串 */
export interface ViewMessage extends Message {
  createdMs: number;
  expiresMs: number;
}

const NICK_KEY = 'campfire.nickname';
const SOUND_KEY = 'campfire.sound';

const toView = (m: Message): ViewMessage => ({
  ...m,
  createdMs: Date.parse(m.createdAt),
  expiresMs: Date.parse(m.expiresAt),
});

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** 訊息的順序:先比時間,再比編號(和伺服器的排序一樣) */
const compareMessages = (a: ViewMessage, b: ViewMessage): number =>
  a.createdMs - b.createdMs || a.id.localeCompare(b.id, 'en', { numeric: true });

export class ChatStore {
  phase = $state<Phase>('loading');
  connection = $state<'online' | 'offline'>('online');
  members = $state<Member[]>([]);
  messages = $state<ViewMessage[]>([]);
  fire = $state<Fire | null>(null);
  config = $state<RoomConfig>(DEFAULT_ROOM_CONFIG);
  /** 伺服器時間 − 這台電腦的時間(毫秒)。所有倒數與淡出都以伺服器時間為準 */
  offset = $state(0);
  me = $state<string | null>(null);
  joining = $state(false);
  joinError = $state<string | null>(null);
  joinNotice = $state<string | null>(null);
  /** 被頻率限制擋住,要到這個(伺服器)時間才能再送 */
  rateUntil = $state(0);
  /** 加柴冷卻到這個(伺服器)時間為止 */
  stokeUntil = $state(0);
  soundOn = $state(local.get(SOUND_KEY) !== 'off');
  /** 要求輸入框插入 @代號(點座位、點名單時使用) */
  mentionRequest = $state<{ nickname: string; n: number } | null>(null);

  readonly backend: ChatBackend;
  private listening = false;
  private heartbeatTimer: number | undefined;
  private resyncTimer: number | undefined;
  private retryTimer: number | undefined;
  private resyncing = false;
  private mentionSeq = 0;

  constructor(backend: ChatBackend) {
    this.backend = backend;
  }

  serverNow(): number {
    return Date.now() + this.offset;
  }

  // ---------- 啟動 ----------

  async init(): Promise<void> {
    window.clearTimeout(this.retryTimer);
    this.phase = 'loading';
    try {
      await Promise.all([this.backend.start(), delay(MIN_LOADING_MS)]);
    } catch {
      this.goUnavailable();
      return;
    }
    this.listen();

    const saved = local.get(NICK_KEY);
    if (saved) {
      const result = await this.tryJoin(saved, true);
      if (result !== 'fail') return;
      // tryJoin 內部可能已經把畫面切到「連不上」
      if ((this.phase as Phase) === 'unavailable') return;
    }
    this.phase = 'join';
  }

  private goUnavailable(): void {
    this.phase = 'unavailable';
    window.clearTimeout(this.retryTimer);
    this.retryTimer = window.setTimeout(() => void this.init(), RETRY_SECONDS * 1000);
  }

  private listen(): void {
    if (this.listening) return;
    this.listening = true;
    const b = this.backend;

    b.on('message.created', (m) => {
      // 依訊息編號去重;並依「時間、編號」插在正確的位置,補進來的訊息不會亂序
      if (this.phase !== 'room' || this.messages.some((x) => x.id === m.id)) return;
      const view = toView(m);
      let at = this.messages.length;
      while (at > 0 && compareMessages(this.messages[at - 1], view) > 0) at--;
      this.messages.splice(at, 0, view);
      if (m.kind === 'chat' && m.body && this.me && nicknameKey(m.nickname) !== nicknameKey(this.me)) {
        if (this.soundOn && mentions(m.body, this.me)) playMention();
      }
    });
    b.on('member.joined', (m) => {
      if (this.phase !== 'room') return;
      if (!this.members.some((x) => nicknameKey(x.nickname) === nicknameKey(m.nickname))) {
        this.members = [...this.members, m].sort((a, c) => Date.parse(a.joinedAt) - Date.parse(c.joinedAt));
      }
    });
    b.on('member.left', ({ nickname }) => {
      if (this.phase !== 'room') return;
      this.members = this.members.filter((x) => nicknameKey(x.nickname) !== nicknameKey(nickname));
      if (this.me && nicknameKey(nickname) === nicknameKey(this.me)) void this.resync();
    });
    b.on('fire.changed', (f) => {
      this.fire = f;
    });
    b.on('connection.lost', () => {
      this.connection = 'offline';
      this.stopHeartbeat();
    });
    b.on('connection.restored', () => {
      void this.resync();
    });
  }

  // ---------- 加入、離開 ----------

  /** 手動輸入代號後按「坐到火堆旁」 */
  async join(raw: string): Promise<void> {
    unlockSound();
    this.joinNotice = null;
    await this.tryJoin(raw, false);
  }

  private async tryJoin(nickname: string, auto: boolean): Promise<'ok' | 'fail'> {
    this.joining = true;
    this.joinError = null;
    try {
      const snap = await this.backend.join(nickname);
      this.applySnapshot(snap);
      local.set(NICK_KEY, snap.me?.nickname ?? nickname);
      this.phase = 'room';
      this.startHeartbeat();
      return 'ok';
    } catch (e) {
      const err = asChatError(e);
      if (err.code === 'NICKNAME_TAKEN') {
        if (auto) {
          this.joinNotice = `你上次的代號「${nickname}」剛剛被別人用走了,請換一個新的。`;
          local.remove(NICK_KEY);
        } else {
          this.joinError = '這個代號正在使用中,請換一個';
        }
      } else if (err.code === 'NICKNAME_INVALID') {
        const check = checkNickname(nickname, this.config.nicknameMax);
        if (auto) local.remove(NICK_KEY);
        else this.joinError = check.ok ? '這個代號不能用,請換一個' : nicknameProblemText(check.problem, this.config.nicknameMax);
      } else if (err.code === 'UNAVAILABLE') {
        if (auto) {
          this.goUnavailable();
          return 'fail';
        }
        this.joinError = '現在連不上營火,請稍後再試';
      } else {
        this.joinError = '加入失敗,請再試一次';
      }
      if (this.phase !== 'unavailable') this.phase = 'join';
      return 'fail';
    } finally {
      this.joining = false;
    }
  }

  async leave(): Promise<void> {
    this.stopHeartbeat();
    try {
      await this.backend.leave();
    } catch {
      // 離線時離不了也沒關係,伺服器會在稍後判定離開
    }
    local.remove(NICK_KEY);
    this.joinNotice = null;
    this.joinError = null;
    this.resetRoom();
    this.phase = 'join';
  }

  private resetRoom(): void {
    this.members = [];
    this.messages = [];
    this.fire = null;
    this.me = null;
    this.rateUntil = 0;
    this.stokeUntil = 0;
    this.connection = 'online';
  }

  /** 瀏覽器分頁即將關閉:盡力通知一次 */
  pageHide(): void {
    if (this.phase === 'room') this.backend.leaveSoon();
  }

  /** 分頁重新變成可見(手機切回來):立刻回報「我還在」 */
  pageVisible(): void {
    if (this.phase === 'room' && this.connection === 'online') void this.beat();
  }

  // ---------- 狀態同步 ----------

  private applySnapshot(s: Snapshot): void {
    this.offset = Date.parse(s.serverTime) - Date.now();
    this.config = s.config;
    this.me = s.me?.nickname ?? this.me;
    this.members = s.members;
    this.messages = s.messages.map(toView);
    this.fire = s.fire;
  }

  /** 斷線恢復(或發現自己被判定離開)後:重新取得完整狀態,必要時用同一個代號重新加入 */
  async resync(): Promise<void> {
    if (this.resyncing || this.phase !== 'room') return;
    this.resyncing = true;
    window.clearTimeout(this.resyncTimer);
    try {
      let snap = await this.backend.getSnapshot();
      if (!snap.me && this.me) snap = await this.backend.join(this.me);
      this.applySnapshot(snap);
      this.connection = 'online';
      this.startHeartbeat();
    } catch (e) {
      const err = asChatError(e);
      if (err.code === 'NICKNAME_TAKEN' && this.me) {
        const old = this.me;
        local.remove(NICK_KEY);
        this.stopHeartbeat();
        this.resetRoom();
        this.joinNotice = `你上次的代號「${old}」剛剛被別人用走了,請換一個新的。`;
        this.phase = 'join';
      } else {
        this.connection = 'offline';
        this.resyncTimer = window.setTimeout(() => void this.resync(), 3000);
      }
    } finally {
      this.resyncing = false;
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = window.setInterval(() => void this.beat(), this.config.heartbeatSeconds * 1000);
  }

  private stopHeartbeat(): void {
    window.clearInterval(this.heartbeatTimer);
  }

  private async beat(): Promise<void> {
    if (this.phase !== 'room' || this.connection !== 'online') return;
    try {
      await this.backend.heartbeat();
    } catch (e) {
      if (asChatError(e).code === 'NOT_JOINED') void this.resync();
    }
  }

  // ---------- 動作 ----------

  /** 送出訊息。成功回傳 true;失敗(例如被限速)回傳 false,輸入的文字由畫面保留 */
  async send(text: string): Promise<boolean> {
    try {
      await this.backend.sendMessage(text);
      return true;
    } catch (e) {
      const err = asChatError(e);
      if (err.code === 'RATE_LIMITED') this.rateUntil = this.serverNow() + (err.retryAfterMs ?? 3000);
      else if (err.code === 'NOT_JOINED') void this.resync();
      return false;
    }
  }

  async stoke(): Promise<void> {
    if (this.connection !== 'online' || this.serverNow() < this.stokeUntil) return;
    try {
      await this.backend.stokeFire();
      this.stokeUntil = this.serverNow() + this.config.stokeCooldownSeconds * 1000;
    } catch (e) {
      const err = asChatError(e);
      if (err.code === 'FIRE_COOLDOWN') this.stokeUntil = this.serverNow() + (err.retryAfterMs ?? 1000);
      else if (err.code === 'NOT_JOINED') void this.resync();
    }
  }

  toggleSound(): void {
    this.soundOn = !this.soundOn;
    local.set(SOUND_KEY, this.soundOn ? 'on' : 'off');
    if (this.soundOn) unlockSound();
  }

  requestMention(nickname: string): void {
    this.mentionRequest = { nickname, n: ++this.mentionSeq };
  }
}
