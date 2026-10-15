// @vitest-environment jsdom
// 「漏訊息的安全網」:每次心跳順便檢查資料庫最新訊息編號,有落差就補同步一次。
// 用假的 Supabase 連線,完整走過 SupabaseBackend → ChatStore。
import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { SupabaseBackend } from '../src/backend/supabase/SupabaseBackend';
import { ChatStore } from '../src/lib/chat.svelte';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Row {
  id: number;
  kind: string;
  nickname: string;
  body: unknown;
  created_at: string;
  expires_at: string;
}

class FakeServer {
  rows: Row[] = [];
  private nextId = 1;
  private readonly t0 = Date.parse('2026-10-15T12:00:00Z');
  snapshotCalls = 0;
  latestCalls = 0;
  heartbeatCalls = 0;
  latestMode: 'ok' | 'error' | 'throw' = 'ok';

  add(over: Partial<Row> = {}): Row {
    const id = this.nextId++;
    const row: Row = {
      id,
      kind: 'chat',
      nickname: 'Bob',
      body: `訊息${id}`,
      created_at: new Date(this.t0 + id * 1000).toISOString(),
      expires_at: new Date(this.t0 + 1_800_000 + id * 1000).toISOString(),
      ...over,
    };
    this.rows.push(row);
    return row;
  }

  snapshot() {
    return {
      serverTime: new Date(this.t0 + 60_000).toISOString(),
      config: {},
      me: { nickname: 'Amy' },
      members: [{ nickname: 'Amy', joinedAt: new Date(this.t0).toISOString() }],
      messages: this.rows.map((r) => ({
        id: String(r.id),
        kind: r.kind,
        nickname: r.nickname,
        body: r.body,
        createdAt: r.created_at,
        expiresAt: r.expires_at,
      })),
      fire: { level: 60, updatedAt: new Date(this.t0).toISOString(), lastStokedBy: null },
    };
  }
}

class FakeChannel {
  state = 'joined';
  sys: (p: unknown) => void = () => {};
  insert: (p: unknown) => void = () => {};
  on(type: string, filter: { table?: string }, cb: (p: unknown) => void) {
    if (type === 'system') this.sys = cb;
    else if (filter.table === 'messages') this.insert = cb;
    return this;
  }
  subscribe() {
    return this;
  }
}

function fakeClient(server: FakeServer, channel: FakeChannel): SupabaseClient {
  const client = {
    auth: {
      getSession: async () => ({ data: { session: { access_token: 'fake-token' } } }),
      signInAnonymously: async () => ({ data: { session: { access_token: 'fake-token' } }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      refreshSession: async () => ({}),
    },
    rpc: async (fn: string) => {
      if (fn === 'join_room' || fn === 'get_snapshot') {
        server.snapshotCalls++;
        return { data: server.snapshot(), error: null, status: 200 };
      }
      if (fn === 'heartbeat') server.heartbeatCalls++;
      return { data: null, error: null, status: 204 };
    },
    channel: () => channel,
    from: () => ({
      select: () => ({
        order: () => ({
          limit: () => ({
            maybeSingle: async () => {
              server.latestCalls++;
              if (server.latestMode === 'throw') throw new Error('network down');
              if (server.latestMode === 'error') return { data: null, error: { message: 'boom' } };
              const last = server.rows.at(-1);
              return { data: last ? { id: last.id } : null, error: null };
            },
          }),
        }),
      }),
    }),
  };
  return client as unknown as SupabaseClient;
}

/** 建好環境:兩則既有訊息(編號 1、2),Amy 已經加入,即時推送已就緒 */
async function setup(graceMs = 40) {
  localStorage.clear();
  sessionStorage.clear();
  const server = new FakeServer();
  server.add({ kind: 'join', nickname: 'Amy', body: null });
  server.add({ kind: 'chat', nickname: 'Bob', body: '你好' });
  const channel = new FakeChannel();
  const backend = new SupabaseBackend('https://example.invalid', 'fake-key', { client: fakeClient(server, channel), gapGraceMs: graceMs });
  const store = new ChatStore(backend);
  await store.init(); // 載入畫面至少停留 0.7 秒
  channel.sys({ extension: 'postgres_changes', status: 'ok' });
  await store.join('Amy');
  await sleep(20); // 加入後的暫存(快照套用完才補發)在下一個時間點結束
  expect(store.phase).toBe('room');
  expect(store.messages.map((m) => m.id)).toEqual(['1', '2']);
  const ids = () => store.messages.map((m) => m.id);
  const has = (body: string) => store.messages.some((m) => m.body === body);
  const count = (id: string) => store.messages.filter((m) => m.id === id).length;
  return { server, channel, backend, store, ids, has, count };
}

describe('漏訊息的安全網', () => {
  it('推送漏掉一則:下一次心跳後,訊息被補進畫面(只補同步一次)', async () => {
    const { server, backend, ids, has } = await setup();
    server.add({ body: '漏掉的訊息' }); // 資料庫有了,但即時推送沒有來
    expect(has('漏掉的訊息')).toBe(false);

    await backend.heartbeat();
    await vi.waitFor(() => expect(has('漏掉的訊息')).toBe(true));

    expect(ids()).toEqual(['1', '2', '3']);
    expect(server.snapshotCalls).toBe(2); // 加入一次 + 補同步一次
  });

  it('沒有落差:每次心跳只做一次輕量查詢,不補同步', async () => {
    const { server, backend, ids } = await setup();
    await backend.heartbeat();
    await backend.heartbeat();
    await backend.heartbeat();
    await sleep(150);
    expect(server.latestCalls).toBe(3); // 每次心跳一次輕量查詢
    expect(server.snapshotCalls).toBe(1); // 只有加入時那一次,沒有任何完整補同步
    expect(ids()).toEqual(['1', '2']);
  });

  it('寬限時間內推送自己到了:不補同步,也不重複顯示', async () => {
    const { server, channel, backend, ids, count } = await setup(120);
    const row = server.add({ body: '稍晚才到的推送' });
    await backend.heartbeat(); // 查到落差,開始等寬限時間
    setTimeout(() => channel.insert({ new: row }), 20);
    await sleep(300);
    expect(server.snapshotCalls).toBe(1);
    expect(ids()).toEqual(['1', '2', '3']);
    expect(count('3')).toBe(1);
  });

  it('補同步之後,同一則訊息的推送又晚到、或再補一次:不會重複顯示、不會亂序', async () => {
    const { server, channel, backend, ids, count } = await setup();
    const row = server.add({ body: '補進來的訊息' });
    await backend.heartbeat();
    await vi.waitFor(() => expect(count('3')).toBe(1));

    channel.insert({ new: row }); // 推送晚到:編號相同
    channel.insert({ new: row }); // 重複推送
    await backend.heartbeat(); // 再一次心跳:已經沒有落差
    await sleep(150);

    expect(count('3')).toBe(1);
    expect(ids()).toEqual(['1', '2', '3']);
    expect(server.snapshotCalls).toBe(2); // 沒有再補第二次
  });

  it('連續漏掉好幾則:一次補同步全部補上,依編號排列', async () => {
    const { server, backend, ids } = await setup();
    server.add({ body: 'a' });
    server.add({ body: 'b' });
    server.add({ body: 'c' });
    await backend.heartbeat();
    await vi.waitFor(() => expect(ids()).toEqual(['1', '2', '3', '4', '5']));
    expect(server.snapshotCalls).toBe(2);
  });

  it('推送順序顛倒:畫面仍依時間與編號排列,不重複', async () => {
    const { server, channel, ids } = await setup();
    const a = server.add({ body: '先發生的' });
    const b = server.add({ body: '後發生的' });
    channel.insert({ new: b }); // 後發生的先到
    channel.insert({ new: a });
    channel.insert({ new: b });
    expect(ids()).toEqual(['1', '2', '3', '4']);
  });

  it('補同步時,不合格的項目照樣丟掉,其餘照常顯示;而且不會每次心跳都再補一次', async () => {
    const { server, backend, ids, has } = await setup();
    server.add({ body: '合格的訊息' });
    server.add({ kind: 'chat', body: null }); // 不合格:chat 沒有內容(編號最大)
    await backend.heartbeat();
    await vi.waitFor(() => expect(has('合格的訊息')).toBe(true));
    expect(ids()).toEqual(['1', '2', '3']); // 編號 4 的不合格訊息被丟掉

    await backend.heartbeat();
    await backend.heartbeat();
    await sleep(150);
    expect(server.snapshotCalls).toBe(2); // 已經補過了,不會一直重複補
  });

  it('即時推送來的不合格資料列:丟掉不顯示,但編號算「已經看過」,不會被誤判成漏訊息', async () => {
    const { server, channel, backend, ids } = await setup();
    const bad = server.add({ body: 42 }); // 不合格:內容不是字串
    channel.insert({ new: bad });
    await backend.heartbeat();
    await sleep(150);
    expect(ids()).toEqual(['1', '2']);
    expect(server.snapshotCalls).toBe(1);
  });

  it('輕量查詢失敗(回傳錯誤或連線例外):安靜地忽略,不補同步、不丟例外、不印 Console', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const { server, backend, ids } = await setup();
    server.add({ body: '漏掉的訊息' });
    for (const mode of ['error', 'throw'] as const) {
      server.latestMode = mode;
      await expect(backend.heartbeat()).resolves.toBeUndefined();
    }
    await sleep(150);
    expect(server.snapshotCalls).toBe(1);
    expect(ids()).toEqual(['1', '2']);
    for (const s of spies) expect(s).not.toHaveBeenCalled();
    for (const s of spies) s.mockRestore();
  });

  it('查詢恢復正常之後,下一次心跳就能補上先前漏掉的訊息', async () => {
    const { server, backend, has } = await setup();
    server.add({ body: '漏掉的訊息' });
    server.latestMode = 'error';
    await backend.heartbeat();
    await sleep(100);
    expect(has('漏掉的訊息')).toBe(false);
    server.latestMode = 'ok';
    await backend.heartbeat();
    await vi.waitFor(() => expect(has('漏掉的訊息')).toBe(true));
  });
});
