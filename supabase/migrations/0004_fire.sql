-- =====================================================================
-- 0004_fire.sql
-- 營火加柴
--
-- 【執行順序】第 4 個,共 5 個。請先確認 0001、0002、0003 都已經執行成功,再貼這一份。
-- 【可以重複執行】再貼一次不會壞(函式用 create or replace)。
--
-- 這個檔案負責的伺服器規則:
--   * 加柴冷卻:同一個使用者 5 秒內只能加一次柴;被擋時告訴畫面還要等多少毫秒
--   * 火的亮度計算:伺服器只存「某個時間點的亮度」,現在的亮度 = 存的亮度 − 流逝時間 ÷ 衰減速度
--     (最低 0、最高 100)。加柴時先算出當下亮度,再加上一根柴的量,上限 100
--   * 加柴時新增一則「加柴」系統訊息,所有人同步看到火變旺
--   (房間從沒人變有人時火回到中等亮度,這條規則在 0002_membership.sql 的 join_room)
--
-- 出錯時,函式會丟出以下錯誤代碼:
--   FIRE_COOLDOWN(detail 是還要等幾毫秒)、NOT_JOINED
-- =====================================================================


-- ---------------------------------------------------------------------
-- 加柴
--   p_session_id:這個分頁的編號
-- ---------------------------------------------------------------------
create or replace function public.stoke_fire(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := auth.uid();
  v_cfg       public.campfire_config;
  v_member    public.members;
  v_last      timestamptz;
  v_cooldown  interval;
  v_wait_ms   integer;
  v_fire      public.fire;
  v_now_level double precision;
  v_new_level double precision;
begin
  if v_uid is null or p_session_id is null then
    raise exception 'NOT_JOINED';
  end if;

  select * into v_cfg from public.campfire_config where id;

  perform public.cleanup_members();

  select * into v_member from public.members m
  where m.session_id = p_session_id and m.user_id = v_uid;
  if not found then
    raise exception 'NOT_JOINED';
  end if;

  -- 冷卻:先對「這個使用者」上鎖,避免同時按兩次一起通過
  perform pg_advisory_xact_lock(hashtextextended('stoke_fire:' || v_uid::text, 0));

  v_cooldown := make_interval(secs => v_cfg.stoke_cooldown_seconds);

  select max(g.created_at) into v_last
  from public.messages g
  where g.user_id = v_uid and g.kind = 'fire';

  if v_last is not null and v_last + v_cooldown > now() then
    v_wait_ms := greatest(1, ceil(extract(epoch from (v_last + v_cooldown - now())) * 1000)::integer);
    raise exception 'FIRE_COOLDOWN' using detail = v_wait_ms::text;
  end if;

  -- 鎖住營火那一列(很多人同時加柴時,一個一個處理),算出當下亮度,加一根柴
  select * into v_fire from public.fire f where f.id for update;

  v_now_level := greatest(0, least(100,
    v_fire.level - extract(epoch from (now() - v_fire.updated_at)) / v_cfg.fire_seconds_per_point));
  v_new_level := least(100, v_now_level + v_cfg.fire_stoke_amount);

  update public.fire
     set level = v_new_level, updated_at = now(), last_stoked_by = v_member.nickname
   where id;

  update public.members
     set last_beat_at = now(), leaving_at = null
   where session_id = p_session_id;

  insert into public.messages (kind, user_id, nickname, body, expires_at)
  values ('fire', v_uid, v_member.nickname, null,
          now() + make_interval(secs => v_cfg.message_ttl_seconds));
end;
$$;

revoke all on function public.stoke_fire(uuid) from public, anon, authenticated;
grant execute on function public.stoke_fire(uuid) to authenticated;
