// @vitest-environment jsdom
// 「暫離一下」在 Supabase 後端與畫面狀態的行為:用假的 Supabase 連線,完整走過 SupabaseBackend → ChatStore。
import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { SupabaseBackend } from '../src/backend/supabase/SupabaseBackend';
import { ChatStore } from '../src/lib/chat.svelte';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const T0 = Date.parse('2026-10-15T12:00:00Z');

class FakeServer {
  rows: Array<{ id: number; kind: string; nickname: string; body: unknown; created_at: string; expires_at: string }> = [];
  members = [
    { nickname: 'Amy', away: false },
    { nickname: 'Bob', away: false },
  ];
  awayVersion = 0;
  snapshotCalls = 0;
  heartbeatCalls = 0;
  setAwayCalls: boolean[] = [];
  setAwayError: string | null = null;
  gate: Promise<void> | null = null;
  private nextId = 1;

  addMsg(over: Record<string, unknown> = {}) {
    const id = this.nextId++;
    const row = {
      id,
      kind: 'chat',
      nickname: 'Bob',
      body: `訊息${id}`,
      created_at: new Date(T0 + id * 1000).toISOString(),
      expires_at: new Date(T0 + 1_800_000 + id * 1000).toISOString(),
      ...over,
    };
    this.rows.push(row);
    return row;
  }

  snapshot() {
    return {
      serverTime: new Date(T0 + 60_000).toISOString(),
      config: {},
      me: { nickname: 'Amy' },
      members: this.members.map((m, i) => ({ nickname: m.nickname, joinedAt: new Date(T0 + i * 1000).toISOString(), away: m.away })),
      awayVersion: this.awayVersion,
      messages: this.rows.map((r) => ({ id: String(r.id), kind: r.kind, nickname: r.nickname, body: r.body, createdAt: r.created_at, expiresAt: r.expires_at })),
      fire: { level: 60, updatedAt: new Date(T0).toISOString(), lastStokedBy: null },
    };
  }
}

class FakeChannel {
  state = 'joined';
  sys: (p: unknown) => void = () => {};
  insert: (p: unknown) => void = () => {};
  away: (p: unknown) => void = () => {};
  awayBound = false;
  on(type: string, filter: { table?: string }, cb: (p: unknown) => void) {
    if (type === 'system') this.sys = cb;
    else if (filter.table === 'messages') this.insert = cb;
    else if (filter.table === 'room_away') {
      this.away = cb;
      this.awayBound = true;
    }
    return this;
  }
  subscribe() {
    return this;
  }
}

function fakeClient(server: FakeServer, channel: FakeChannel): SupabaseClient {
  return {
    auth: {
      getSession: async () => ({ data: { session: { access_token: 'fake' } } }),
      signInAnonymously: async () => ({ data: { session: { access_token: 'fake' } }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      refreshSession: async () => ({}),
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (fn === 'join_room' || fn === 'get_snapshot') {
        server.snapshotCalls++;
        if (fn === 'get_snapshot' && server.gate) await server.gate;
        return { data: server.snapshot(), error: null, status: 200 };
      }
      if (fn === 'heartbeat') server.heartbeatCalls++;
      if (fn === 'set_away') {
        server.setAwayCalls.push(args.p_away as boolean);
        if (server.setAwayError) return { data: null, error: { message: server.setAwayError }, status: 400 };
        const me = server.members.find((m) => m.nickname === 'Amy')!;
        me.away = args.p_away as boolean;
        server.awayVersion++;
      }
      return { data: null, error: null, status: 204 };
    },
    channel: () => channel,
    from: () => ({
      select: () => ({
        order: () => ({
          limit: () => ({
            maybeSingle: async () => {
              const last = server.rows.at(-1);
              return { data: last ? { id: last.id } : null, error: null };
            },
          }),
        }),
      }),
    }),
  } as unknown as SupabaseClient;
}

async function setup() {
  localStorage.clear();
  sessionStorage.clear();
  const server = new FakeServer();
  server.addMsg({ kind: 'join', nickname: 'Amy', body: null });
  server.addMsg({ kind: 'join', nickname: 'Bob', body: null });
  const channel = new FakeChannel();
  const backend = new SupabaseBackend('https://example.invalid', 'fake-key', { client: fakeClient(server, channel), gapGraceMs: 40 });
  const store = new ChatStore(backend);
  await store.init();
  channel.sys({ extension: 'postgres_changes', status: 'ok' });
  await store.join('Amy');
  await sleep(20);
  const awayOf = (n: string) => store.members.find((m) => m.nickname === n)?.away === true;
  return { server, channel, backend, store, awayOf };
}

describe('暫離一下(Supabase 後端與畫面狀態)', () => {
  it('加入時從快照得到每個人的暫離狀態', async () => {
    localStorage.clear();
    const server = new FakeServer();
    server.members[1].away = true;
    server.awayVersion = 4;
    const channel = new FakeChannel();
    const backend = new SupabaseBackend('https://example.invalid', 'k', { client: fakeClient(server, channel) });
    const store = new ChatStore(backend);
    await store.init();
    channel.sys({ extension: 'postgres_changes', status: 'ok' });
    await store.join('Amy');
    expect(store.members.find((m) => m.nickname === 'Bob')!.away).toBe(true);
    expect(store.members.find((m) => m.nickname === 'Amy')!.away).toBe(false);
  });

  it('收到暫離名單的即時推送:名單裡的人顯示暫離中,不在名單裡的恢復;所有人看到同一份', async () => {
    const { channel, awayOf } = await setup();
    channel.away({ new: { nicknames: ['Bob'], version: 1 } });
    expect(awayOf('Bob')).toBe(true);
    expect(awayOf('Amy')).toBe(false);
    channel.away({ new: { nicknames: ['Amy', 'Bob'], version: 2 } });
    expect(awayOf('Amy')).toBe(true);
    channel.away({ new: { nicknames: [], version: 3 } });
    expect(awayOf('Bob')).toBe(false);
    expect(awayOf('Amy')).toBe(false);
  });

  it('代號大小寫不同也對得起來', async () => {
    const { channel, awayOf } = await setup();
    channel.away({ new: { nicknames: ['bob'], version: 1 } });
    expect(awayOf('Bob')).toBe(true);
  });

  it('不合格的推送整筆丟掉,不改變畫面,不丟例外、不印 Console', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const { channel, awayOf } = await setup();
    channel.away({ new: { nicknames: ['Bob'], version: 1 } });
    for (const bad of [null, undefined, 'x', {}, { nicknames: 'Bob', version: 2 }, { nicknames: [], version: -1 }, { nicknames: [], version: '3' }, { version: 4 }]) {
      expect(() => channel.away({ new: bad })).not.toThrow();
    }
    expect(awayOf('Bob')).toBe(true); // 沒有被任何不合格的推送改掉
    // 名單裡不合格的項目只丟掉那一個
    channel.away({ new: { nicknames: [5, null, 'Bob', '一'.repeat(21)], version: 5 } });
    expect(awayOf('Bob')).toBe(true);
    for (const s of spies) expect(s).not.toHaveBeenCalled();
    for (const s of spies) s.mockRestore();
  });

  it('切換暫離:呼叫 set_away、畫面立刻反應;再切換就恢復;不產生任何訊息', async () => {
    const { server, store } = await setup();
    const messagesBefore = store.messages.length;
    expect(store.myAway).toBe(false);
    await store.toggleAway();
    expect(server.setAwayCalls).toEqual([true]);
    expect(store.myAway).toBe(true);
    await sleep(900); // 連點防護結束
    await store.toggleAway();
    expect(server.setAwayCalls).toEqual([true, false]);
    expect(store.myAway).toBe(false);
    expect(store.messages.length).toBe(messagesBefore);
    expect(server.rows.length).toBe(2); // 伺服器上也沒有新增任何訊息
  });

  it('連點會被擋住,不會連續送出好幾次', async () => {
    const { server, store } = await setup();
    await store.toggleAway();
    await store.toggleAway();
    await store.toggleAway();
    expect(server.setAwayCalls).toEqual([true]);
  });

  it('伺服器失敗時,畫面還原成原本的狀態', async () => {
    const { server, store } = await setup();
    server.setAwayError = 'boom';
    await store.toggleAway();
    expect(store.myAway).toBe(false);
  });

  it('斷線時不能切換', async () => {
    const { server, store } = await setup();
    store.connection = 'offline';
    await store.toggleAway();
    expect(server.setAwayCalls).toEqual([]);
    expect(store.myAway).toBe(false);
  });

  it('暫離中照常送心跳:切換暫離不碰心跳,心跳也不碰暫離', async () => {
    const { server, backend, store } = await setup();
    await store.toggleAway();
    expect(server.heartbeatCalls).toBe(0); // 切換暫離不會順便送心跳
    await backend.heartbeat();
    await backend.heartbeat();
    expect(server.heartbeatCalls).toBe(2);
    expect(store.myAway).toBe(true);
    await sleep(100);
    expect(server.snapshotCalls).toBe(1); // 心跳沒有造成任何額外的完整同步
  });

  it('補同步途中,比快照舊的暫離推送不會把畫面改回去', async () => {
    const { server, channel, store, awayOf } = await setup();
    server.members[1].away = true; // 伺服器上 Bob 暫離了
    server.awayVersion = 9;
    let release!: () => void;
    server.gate = new Promise<void>((r) => (release = r));
    const resync = store.resync(); // 卡在取得快照的途中
    await sleep(10);
    channel.away({ new: { nicknames: [], version: 8 } }); // 比快照舊的推送在這時候到了(先暫存)
    release();
    server.gate = null;
    await resync;
    await sleep(30);
    expect(awayOf('Bob')).toBe(true); // 以快照為準,舊的推送被丟掉
    channel.away({ new: { nicknames: [], version: 10 } }); // 之後比較新的推送照常生效
    expect(awayOf('Bob')).toBe(false);
  });

  it('暫離不影響漏訊息安全網:心跳照常補上漏掉的訊息', async () => {
    const { server, backend, store } = await setup();
    await store.toggleAway();
    server.addMsg({ body: '暫離中漏掉的訊息' });
    await backend.heartbeat();
    await vi.waitFor(() => expect(store.messages.some((m) => m.body === '暫離中漏掉的訊息')).toBe(true));
    expect(store.myAway).toBe(true); // 補同步之後,暫離狀態仍然保留(來自快照)
  });

  it('暫離不影響訊息的即時推送', async () => {
    const { server, channel, store } = await setup();
    await store.toggleAway();
    const row = server.addMsg({ body: '即時來的訊息' });
    channel.insert({ new: row });
    expect(store.messages.some((m) => m.body === '即時來的訊息')).toBe(true);
  });
});

describe('資料庫還沒執行 0006_away.sql 時(room_away 不在推送名單裡)', () => {
  async function setupWithChannels() {
    localStorage.clear();
    sessionStorage.clear();
    const server = new FakeServer();
    server.addMsg({ kind: 'join', nickname: 'Amy', body: null });
    const channels: FakeChannel[] = [];
    let removed = 0;
    const client = {
      ...(fakeClient(server, new FakeChannel()) as object),
      channel: () => {
        const c = new FakeChannel();
        channels.push(c);
        return c;
      },
      removeChannel: async () => {
        removed++;
      },
    } as unknown as SupabaseClient;
    const backend = new SupabaseBackend('https://example.invalid', 'fake-key', { client, gapGraceMs: 40 });
    const store = new ChatStore(backend);
    await store.init();
    return { server, channels, backend, store, removed: () => removed };
  }

  it('不整個連線中斷:改成不監聽暫離、重新訂閱,聊天與其他功能照常', async () => {
    const { server, channels, backend, store, removed } = await setupWithChannels();
    expect(channels).toHaveLength(1);
    expect(channels[0].awayBound).toBe(true);
    const lost = vi.fn();
    backend.on('connection.lost', lost);

    channels[0].sys({ extension: 'postgres_changes', status: 'error', message: 'Unable to subscribe to changes with given parameters. [event: UPDATE, schema: public, table: room_away, filters: []]' });
    expect(channels).toHaveLength(2);
    expect(channels[1].awayBound).toBe(false); // 第二次訂閱不再監聽暫離
    expect(removed()).toBe(1);
    expect(lost).not.toHaveBeenCalled();

    channels[1].sys({ extension: 'postgres_changes', status: 'ok' });
    await store.join('Amy');
    await sleep(20);
    expect(store.connection).toBe('online');
    const row = server.addMsg({ body: '照常即時收到' });
    channels[1].insert({ new: row });
    expect(store.messages.some((m) => m.body === '照常即時收到')).toBe(true);
  });

  it('其他原因的推送錯誤:照常視為連線中斷,不會重新訂閱', async () => {
    const { channels, backend } = await setupWithChannels();
    const lost = vi.fn();
    backend.on('connection.lost', lost);
    channels[0].sys({ extension: 'postgres_changes', status: 'error', message: 'something else went wrong' });
    expect(lost).toHaveBeenCalledTimes(1);
    expect(channels).toHaveLength(1);
  });
});
