-- =====================================================================
-- 0006_away.sql
-- 「暫離一下」:線上的人可以把自己標記成暫離中,所有人在名單裡看到同一份結果
--
-- 【執行順序】第 6 個,共 6 個。請先確認 0001 到 0005 都已經執行成功,再貼這一份。
--            ⚠ 請先貼這一份、確認成功,再讓新版網頁上線:新版網頁會監聽這份檔案建立的 room_away 表,
--              還沒執行這份檔案就上線的話,即時推送會整個連不上。
-- 【可以重複執行】再貼一次不會壞(同名的東西會被更新,不會變成兩個)。
--
-- 這個功能的設計:
--   * 「誰暫離中」存在 members 表新增的 away 欄位。這只是一個顯示用的標記,
--     沒有任何伺服器強制的規則:不產生系統訊息、不計入頻率限制、不影響加柴、不影響訊息到期,
--     也不碰心跳與離開判定(暫離中照常送心跳,逾時一樣會被判定離開,離開時暫離標記跟著消失)。
--   * 為什麼要多一張很小的 room_away 表:members 表不能直接推送給所有人——每個人每 10 秒的心跳都會更新它,
--     一推送就是 N × N 個即時事件,而且刪除事件不受權限規則過濾。room_away 只有一列,
--     只有「有人切換暫離」或「暫離中的人離開」時才會更新,所以事件很少。
--     它用的是現有的 Realtime 機制(加進同一份推送名單、同一個頻道),沒有新增任何 Supabase 服務。
--   * members.away 與 room_away 之間用觸發器自動保持一致,不用靠函式記得去更新。
--
-- 出錯時,函式會丟出以下錯誤代碼:NOT_JOINED
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. members 表:新增「暫離中」欄位(預設不是暫離)
-- ---------------------------------------------------------------------
alter table public.members add column if not exists away boolean not null default false;


-- ---------------------------------------------------------------------
-- 2. room_away 表:目前所有暫離中的人(只有一列),給 Realtime 推送用
--    version 每次更新加 1,畫面用它判斷「這份名單是不是比我手上的新」。
-- ---------------------------------------------------------------------
create table if not exists public.room_away (
  id         boolean primary key default true check (id),
  nicknames  text[]  not null default '{}',
  version    bigint  not null default 0
);

insert into public.room_away (id) values (true) on conflict (id) do nothing;

alter table public.room_away enable row level security;

drop policy if exists room_away_read on public.room_away;
create policy room_away_read on public.room_away
  for select to authenticated
  using (true);

revoke all on table public.room_away from public, anon, authenticated;
grant select on public.room_away to authenticated;


-- ---------------------------------------------------------------------
-- 3. 觸發器:members 的暫離狀態一改變(或暫離中的人離開),就重新整理 room_away
--    心跳只更新 last_beat_at、沒有改變 away,所以不會觸發,也不會有任何推送。
-- ---------------------------------------------------------------------
create or replace function public.sync_room_away()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.room_away
     set nicknames = coalesce((select array_agg(m.nickname order by m.nickname) from public.members m where m.away), '{}'),
         version = version + 1
   where id;
  return null;
end;
$$;

revoke all on function public.sync_room_away() from public, anon, authenticated;

drop trigger if exists members_away_changed on public.members;
create trigger members_away_changed
  after update of away on public.members
  for each row
  when (old.away is distinct from new.away)
  execute function public.sync_room_away();

drop trigger if exists members_away_left on public.members;
create trigger members_away_left
  after delete on public.members
  for each row
  when (old.away)
  execute function public.sync_room_away();


-- ---------------------------------------------------------------------
-- 4. Realtime:把 room_away 加進同一份推送名單(不新增頻道、不新增服務)
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'room_away'
    ) then
      alter publication supabase_realtime add table public.room_away;
    end if;
  end if;
end
$$;


-- ---------------------------------------------------------------------
-- 5. 切換暫離:把自己標記成「暫離中」或「回來了」
--    沒有任何額外規則:不產生系統訊息、不限制次數、不更新心跳時間、不影響離開判定。
--      p_session_id:這個分頁的編號
--      p_away:true = 暫離中、false = 回來了
-- ---------------------------------------------------------------------
create or replace function public.set_away(p_session_id uuid, p_away boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or p_session_id is null or p_away is null then
    raise exception 'NOT_JOINED';
  end if;

  -- 和其他函式一樣,先清掉已經離線的人;如果連我自己也被判定離線了,下面會得到 NOT_JOINED
  perform public.cleanup_members();

  update public.members
     set away = p_away
   where session_id = p_session_id and user_id = v_uid;

  if not found then
    raise exception 'NOT_JOINED';
  end if;
end;
$$;

revoke all on function public.set_away(uuid, boolean) from public, anon, authenticated;
grant execute on function public.set_away(uuid, boolean) to authenticated;


-- ---------------------------------------------------------------------
-- 6. 快照:成員多帶「是否暫離中」,另外帶目前的暫離名單版本
--    (取代 0001 的 build_snapshot,其餘內容完全相同)
-- ---------------------------------------------------------------------
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
        jsonb_build_object('nickname', m.nickname, 'joinedAt', public.to_iso(m.joined_at), 'away', m.away)
        order by m.joined_at, m.session_id
      )
      from public.members m
    ), '[]'::jsonb),
    'awayVersion', (select a.version from public.room_away a where a.id),
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

revoke all on function public.build_snapshot(uuid, uuid) from public, anon, authenticated;
