-- =====================================================================
-- 0001_schema.sql
-- 資料表、權限規則、可調數值、Realtime 推送、快照產生器
--
-- 【執行順序】第 1 個,共 5 個。請依 0001 → 0002 → 0003 → 0004 → 0005 的順序,
--            一份一份貼進 Supabase 網頁的 SQL Editor 執行。
-- 【可以重複執行】再貼一次不會壞,也不會洗掉你已經調整過的數值或已有的資料。
--
-- 這個檔案負責的伺服器規則:
--   * 訊息 30 分鐘到期:每則訊息記下到期時間;權限規則讓「已過期」的訊息讀不到
--   * 代號唯一(大小寫視為同一個):成員表對「小寫後的代號」做唯一限制
--   * 瀏覽器不能直接寫入任何資料表:收回所有寫入權限,只留下 messages、fire 的「讀取」
--   * 所有規則數值集中在 campfire_config 一張表
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. 規則數值(只有一列;改這一列就能調整整個聊天室的規則)
--    重複執行時不會覆蓋你改過的值。
-- ---------------------------------------------------------------------
create table if not exists public.campfire_config (
  id                        boolean primary key default true check (id),
  message_ttl_seconds       integer          not null default 1800,  -- 訊息存活 30 分鐘
  max_message_length        integer          not null default 300,   -- 訊息上限 300 字
  nickname_max              integer          not null default 20,    -- 代號上限 20 字
  rate_limit_count          integer          not null default 5,     -- 頻率限制:幾則
  rate_limit_window_seconds integer          not null default 10,    -- 頻率限制:幾秒內
  stoke_cooldown_seconds    integer          not null default 5,     -- 加柴冷卻 5 秒
  fire_start_level          integer          not null default 50,    -- 房間從沒人變有人時,火的亮度
  fire_stoke_amount         integer          not null default 20,    -- 每根柴增加的亮度
  fire_seconds_per_point    double precision not null default 6,     -- 火每降 1 點亮度要幾秒
  heartbeat_seconds         integer          not null default 10,    -- 心跳間隔(畫面用)
  stale_seconds             integer          not null default 30,    -- 幾秒沒心跳就判定離開
  leave_grace_seconds       integer          not null default 10     -- 通知離開後的緩衝時間
);

insert into public.campfire_config (id) values (true) on conflict (id) do nothing;


-- ---------------------------------------------------------------------
-- 2. 營火(只有一列)
-- ---------------------------------------------------------------------
create table if not exists public.fire (
  id              boolean primary key default true check (id),
  level           double precision not null default 50 check (level >= 0 and level <= 100),
  updated_at      timestamptz      not null default now(),
  last_stoked_by  text
);

insert into public.fire (id) values (true) on conflict (id) do nothing;


-- ---------------------------------------------------------------------
-- 3. 訊息(含系統訊息:坐下、離開、加柴)
--    注意:user_id 是匿名身分編號,隨機產生、沒有任何個人資訊;
--    其他人看得到它,但光憑它什麼事也做不了(要有登入憑證才能呼叫函式)。
-- ---------------------------------------------------------------------
create table if not exists public.messages (
  id          bigint generated always as identity primary key,
  kind        text        not null check (kind in ('chat', 'join', 'leave', 'fire')),
  user_id     uuid        not null,
  nickname    text        not null,
  body        text,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  -- 一般訊息一定要有內容;系統訊息沒有內容
  check ((kind = 'chat') = (body is not null))
);

-- 查「某個人最近送了幾則一般訊息」(頻率限制)、「某個人最近加過柴嗎」(冷卻)
create index if not exists messages_user_kind_created_idx on public.messages (user_id, kind, created_at desc);
create index if not exists messages_expires_idx on public.messages (expires_at);


-- ---------------------------------------------------------------------
-- 4. 成員(目前坐在火堆旁的人)
--    session_id:畫面每個分頁各自產生的編號,重新整理時保持不變
--    瀏覽器完全不能直接讀這張表,只能透過 get_snapshot 取得名單。
-- ---------------------------------------------------------------------
create table if not exists public.members (
  session_id   uuid        primary key,
  user_id      uuid        not null,
  nickname     text        not null,
  joined_at    timestamptz not null default now(),
  last_beat_at timestamptz not null default now(),
  leaving_at   timestamptz
);

-- 代號唯一的基礎:大小寫視為同一個
create or replace function public.nickname_key(p text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select lower(normalize(p, NFC))
$$;

create unique index if not exists members_nickname_key_idx on public.members (public.nickname_key(nickname));
create index if not exists members_user_idx on public.members (user_id);


-- ---------------------------------------------------------------------
-- 5. 小工具(只給其他函式內部使用,瀏覽器不能呼叫)
-- ---------------------------------------------------------------------
-- 時間轉成畫面讀得懂的格式(UTC、ISO 8601)
create or replace function public.to_iso(p timestamptz)
returns text
language sql
stable
set search_path = ''
as $$
  select to_char(p at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$$;

-- 組出「快照」:加入、重連時一次取得的完整狀態
-- (伺服器時間、規則數值、我自己、目前的人、還沒過期的訊息、營火)
create or replace function public.build_snapshot(p_user uuid, p_session uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  select jsonb_build_object(
    'serverTime', public.to_iso(now()),
    'config', jsonb_build_object(
      'messageTtlSeconds',      c.message_ttl_seconds,
      'maxMessageLength',       c.max_message_length,
      'nicknameMax',            c.nickname_max,
      'rateLimitCount',         c.rate_limit_count,
      'rateLimitWindowSeconds', c.rate_limit_window_seconds,
      'stokeCooldownSeconds',   c.stoke_cooldown_seconds,
      'fireStartLevel',         c.fire_start_level,
      'fireStokeAmount',        c.fire_stoke_amount,
      'fireSecondsPerPoint',    c.fire_seconds_per_point,
      'heartbeatSeconds',       c.heartbeat_seconds,
      'staleSeconds',           c.stale_seconds,
      'leaveGraceSeconds',      c.leave_grace_seconds
    ),
    'me', (
      select jsonb_build_object('nickname', m.nickname)
      from public.members m
      where m.session_id = p_session and m.user_id = p_user
    ),
    'members', coalesce((
      select jsonb_agg(
        jsonb_build_object('nickname', m.nickname, 'joinedAt', public.to_iso(m.joined_at))
        order by m.joined_at, m.session_id
      )
      from public.members m
    ), '[]'::jsonb),
    'messages', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', g.id::text,
          'kind', g.kind,
          'nickname', g.nickname,
          'body', g.body,
          'createdAt', public.to_iso(g.created_at),
          'expiresAt', public.to_iso(g.expires_at)
        )
        order by g.created_at, g.id
      )
      from public.messages g
      where g.expires_at > now()
    ), '[]'::jsonb),
    'fire', (
      select jsonb_build_object(
        'level', f.level,
        'updatedAt', public.to_iso(f.updated_at),
        'lastStokedBy', f.last_stoked_by
      )
      from public.fire f
      where f.id
    )
  )
  into v_result
  from public.campfire_config c
  where c.id;

  return v_result;
end;
$$;


-- ---------------------------------------------------------------------
-- 6. 權限規則(RLS)與權限
--    原則:瀏覽器「只能讀」messages 與 fire,而且過期的訊息讀不到;
--          其他資料表完全不能碰;任何資料表都不能由瀏覽器直接寫入。
--    (登入過的人,包含匿名登入的人,在 Supabase 裡的身分都是 authenticated)
-- ---------------------------------------------------------------------
alter table public.campfire_config enable row level security;
alter table public.fire            enable row level security;
alter table public.messages        enable row level security;
alter table public.members         enable row level security;

drop policy if exists messages_read_unexpired on public.messages;
create policy messages_read_unexpired on public.messages
  for select to authenticated
  using (expires_at > now());

drop policy if exists fire_read on public.fire;
create policy fire_read on public.fire
  for select to authenticated
  using (true);

-- campfire_config 與 members 沒有任何政策 = 瀏覽器完全不能讀寫

-- 先把 Supabase 預設給的權限全部收回,再只給需要的
revoke all on table public.campfire_config, public.fire, public.messages, public.members
  from public, anon, authenticated;
revoke all on sequence public.messages_id_seq from public, anon, authenticated;

grant select on public.messages to authenticated;
grant select on public.fire     to authenticated;

-- 內部小工具:瀏覽器不能呼叫
revoke all on function public.nickname_key(text)         from public, anon, authenticated;
revoke all on function public.to_iso(timestamptz)        from public, anon, authenticated;
revoke all on function public.build_snapshot(uuid, uuid) from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 7. Realtime:messages 與 fire 一有變動,就即時推給所有人
--    members 不推送(誰坐下、誰離開,由系統訊息得知)。
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
    ) then
      alter publication supabase_realtime add table public.messages;
    end if;

    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'fire'
    ) then
      alter publication supabase_realtime add table public.fire;
    end if;

    if exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'members'
    ) then
      alter publication supabase_realtime drop table public.members;
    end if;
  end if;
end
$$;
