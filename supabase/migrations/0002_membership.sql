-- =====================================================================
-- 0002_membership.sql
-- 代號規則、加入、離開、即將離開、心跳、離線成員清理
--
-- 【執行順序】第 2 個,共 5 個。請先確認 0001 已經執行成功,再貼這一份。
-- 【可以重複執行】再貼一次不會壞(函式用 create or replace)。
--
-- 這個檔案負責的伺服器規則:
--   * 代號規則:長度、不可有空白與 @、不可有不可見的控制字元(大小寫視為同一個)
--   * 代號唯一:別人正在用就拒絕;同一個分頁重新加入(重新整理)視為本人
--   * 離開判定:30 秒沒有心跳就判定離開;通知「即將離開」後,10 秒緩衝時間內回來就取消
--   * 房間從沒人變成有人時,火回到中等亮度(房間沒人時火的時間不計算)
--
-- 所有函式:security definer、固定 search_path,只授權給 authenticated
-- (含匿名登入的人),不授權給 anon 或 public。
-- 出錯時,函式會丟出以下錯誤代碼(畫面依代碼顯示白話說明):
--   NICKNAME_INVALID(detail 是原因)、NICKNAME_TAKEN、NOT_JOINED
-- =====================================================================


-- ---------------------------------------------------------------------
-- 離線成員清理(給定時工作與其他函式內部使用,瀏覽器不能呼叫)
-- 移除「超過 stale_seconds 沒有心跳」或「通知離開後超過緩衝時間」的人,
-- 並替每個人新增一則「離開」系統訊息、釋出代號。
-- ---------------------------------------------------------------------
create or replace function public.cleanup_members()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.campfire_config;
begin
  select * into c from public.campfire_config where id;

  with gone as (
    delete from public.members m
    where m.last_beat_at < now() - make_interval(secs => c.stale_seconds)
       or (m.leaving_at is not null
           and m.leaving_at < now() - make_interval(secs => c.leave_grace_seconds))
    returning m.user_id, m.nickname
  )
  insert into public.messages (kind, user_id, nickname, body, expires_at)
  select 'leave', g.user_id, g.nickname, null,
         now() + make_interval(secs => c.message_ttl_seconds)
  from gone g;
end;
$$;

revoke all on function public.cleanup_members() from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 加入聊天室
--   p_session_id:這個分頁的編號(畫面產生,重新整理時保持不變)
--   p_nickname:想用的代號
-- 回傳:快照(伺服器時間、規則數值、我自己、目前的人、還沒過期的訊息、營火)
-- ---------------------------------------------------------------------
create or replace function public.join_room(p_session_id uuid, p_nickname text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_cfg     public.campfire_config;
  v_nick    text;
  v_key     text;
  v_mine    public.members;
  v_other   uuid;
  v_humans  integer;
begin
  if v_uid is null or p_session_id is null then
    raise exception 'NOT_JOINED';
  end if;

  select * into v_cfg from public.campfire_config where id;

  -- 代號規則(前後空白自動去掉)
  v_nick := regexp_replace(coalesce(p_nickname, ''), '^[\s 　]+|[\s 　]+$', '', 'g');

  if char_length(v_nick) < 1 then
    raise exception 'NICKNAME_INVALID' using detail = 'empty';
  end if;
  if v_nick ~ '[\s@＠   -     　]' then
    raise exception 'NICKNAME_INVALID' using detail = 'space_or_at';
  end if;
  if char_length(v_nick) > v_cfg.nickname_max then
    raise exception 'NICKNAME_INVALID' using detail = 'too_long';
  end if;
  -- 控制字元、零寬字元、雙向文字控制字元(可拿來偽裝名字)
  if v_nick ~ '[[:cntrl:]​-‏‪-‮⁠⁦-⁩﻿]' then
    raise exception 'NICKNAME_INVALID' using detail = 'bad_char';
  end if;

  v_key := public.nickname_key(v_nick);

  -- 先清掉已經離線的人,他們的代號才會釋出
  perform public.cleanup_members();

  -- 這個分頁編號如果已經被別的使用者占用,拒絕(正常情況不會發生)
  select m.user_id into v_other from public.members m where m.session_id = p_session_id;
  if v_other is not null and v_other <> v_uid then
    raise exception 'NOT_JOINED' using detail = 'session_in_use';
  end if;

  select * into v_mine from public.members m
  where m.session_id = p_session_id and m.user_id = v_uid;

  if found and public.nickname_key(v_mine.nickname) = v_key then
    -- 同一個分頁重新加入(例如重新整理):直接接回,不產生新的「坐下」提示
    update public.members
       set last_beat_at = now(), leaving_at = null
     where session_id = p_session_id;
    return public.build_snapshot(v_uid, p_session_id);
  end if;

  -- 別人正在用這個代號
  if exists (
    select 1 from public.members m
    where public.nickname_key(m.nickname) = v_key and m.session_id <> p_session_id
  ) then
    raise exception 'NICKNAME_TAKEN';
  end if;

  select count(*) into v_humans from public.members;

  -- 同一個分頁換了新代號:舊代號視為離開
  if v_mine.session_id is not null then
    delete from public.members where session_id = p_session_id;
    insert into public.messages (kind, user_id, nickname, body, expires_at)
    values ('leave', v_uid, v_mine.nickname, null, now() + make_interval(secs => v_cfg.message_ttl_seconds));
  end if;

  begin
    insert into public.members (session_id, user_id, nickname)
    values (p_session_id, v_uid, v_nick);
  exception when unique_violation then
    -- 兩個人同一瞬間搶同一個代號,晚到的那個會走到這裡
    raise exception 'NICKNAME_TAKEN';
  end;

  -- 房間從沒有人變成有人:火回到中等亮度
  if v_humans = 0 then
    update public.fire
       set level = v_cfg.fire_start_level, updated_at = now(), last_stoked_by = null
     where id;
  end if;

  insert into public.messages (kind, user_id, nickname, body, expires_at)
  values ('join', v_uid, v_nick, null, now() + make_interval(secs => v_cfg.message_ttl_seconds));

  return public.build_snapshot(v_uid, p_session_id);
end;
$$;

revoke all on function public.join_room(uuid, text) from public, anon, authenticated;
grant execute on function public.join_room(uuid, text) to authenticated;


-- ---------------------------------------------------------------------
-- 離開營火(按「離開營火」按鈕):立刻離開、代號立刻釋出、新增「離開」系統訊息
-- ---------------------------------------------------------------------
create or replace function public.leave_room(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_cfg  public.campfire_config;
  v_nick text;
begin
  if v_uid is null then
    raise exception 'NOT_JOINED';
  end if;

  select * into v_cfg from public.campfire_config where id;

  delete from public.members
   where session_id = p_session_id and user_id = v_uid
  returning nickname into v_nick;

  if found then
    insert into public.messages (kind, user_id, nickname, body, expires_at)
    values ('leave', v_uid, v_nick, null, now() + make_interval(secs => v_cfg.message_ttl_seconds));
  end if;
end;
$$;

revoke all on function public.leave_room(uuid) from public, anon, authenticated;
grant execute on function public.leave_room(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- 即將離開:瀏覽器分頁關閉前盡力通知一次。
-- 不會立刻移除,只是標記;緩衝時間內同一個分頁回來(例如重新整理)就取消,
-- 沒有回來才由清理工作移除。
-- ---------------------------------------------------------------------
create or replace function public.leave_soon(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'NOT_JOINED';
  end if;

  update public.members
     set leaving_at = now()
   where session_id = p_session_id and user_id = v_uid;
end;
$$;

revoke all on function public.leave_soon(uuid) from public, anon, authenticated;
grant execute on function public.leave_soon(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- 心跳:每 10 秒告訴伺服器「我還在」。
-- 如果已經被判定離開(例如斷線太久),會丟出 NOT_JOINED,畫面會自動重新加入。
-- ---------------------------------------------------------------------
create or replace function public.heartbeat(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'NOT_JOINED';
  end if;

  perform public.cleanup_members();

  update public.members
     set last_beat_at = now(), leaving_at = null
   where session_id = p_session_id and user_id = v_uid;

  if not found then
    raise exception 'NOT_JOINED';
  end if;
end;
$$;

revoke all on function public.heartbeat(uuid) from public, anon, authenticated;
grant execute on function public.heartbeat(uuid) to authenticated;
