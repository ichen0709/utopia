-- =====================================================================
-- 0003_messages.sql
-- 送訊息(長度檢查、頻率限制)、取得快照
--
-- 【執行順序】第 3 個,共 5 個。請先確認 0001、0002 都已經執行成功,再貼這一份。
-- 【可以重複執行】再貼一次不會壞(函式用 create or replace)。
--
-- 這個檔案負責的伺服器規則:
--   * 訊息長度上限(預設 300 字)、不可為空白
--   * 去掉不可見的控制字元與雙向文字控制字元;內容只當純文字存放,伺服器不解析任何 HTML
--   * 頻率限制:同一個使用者 10 秒內最多 5 則「一般訊息」
--       - 只算使用者自己送的一般訊息,不算系統訊息(坐下、離開、加柴)
--       - 以「使用者」計算,同一個人開很多分頁也不能多送
--       - 被擋時,會告訴畫面還要等多少毫秒(錯誤的 detail)
--   * 發言者的代號由伺服器依登入身分查出來,不接受畫面帶來的任何名字
--
-- 出錯時,函式會丟出以下錯誤代碼:
--   MESSAGE_EMPTY、MESSAGE_TOO_LONG、RATE_LIMITED(detail 是還要等幾毫秒)、NOT_JOINED
-- =====================================================================


-- ---------------------------------------------------------------------
-- 送出一般訊息
--   p_session_id:這個分頁的編號
--   p_body:訊息內容
-- ---------------------------------------------------------------------
create or replace function public.send_message(p_session_id uuid, p_body text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := auth.uid();
  v_cfg      public.campfire_config;
  v_member   public.members;
  v_body     text;
  v_count    integer;
  v_blocker  timestamptz;
  v_window   interval;
  v_wait_ms  integer;
begin
  if v_uid is null or p_session_id is null then
    raise exception 'NOT_JOINED';
  end if;

  select * into v_cfg from public.campfire_config where id;

  -- 先清掉已經離線的人;如果連我自己也被判定離線了,下面會得到 NOT_JOINED
  perform public.cleanup_members();

  select * into v_member from public.members m
  where m.session_id = p_session_id and m.user_id = v_uid;
  if not found then
    raise exception 'NOT_JOINED';
  end if;

  -- 清理內容:換行統一、去掉控制字元與雙向文字控制字元、連續空行縮成一行、去掉前後空白
  v_body := coalesce(p_body, '');
  v_body := regexp_replace(v_body, '\r\n?', E'\n', 'g');
  v_body := replace(v_body, E'\t', ' ');
  v_body := regexp_replace(
    v_body,
    '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f​‎‏‪-‮⁠⁦-⁩﻿]',
    '', 'g');
  v_body := regexp_replace(v_body, '\n{3,}', E'\n\n', 'g');
  v_body := regexp_replace(v_body, '^[\s 　]+|[\s 　]+$', '', 'g');

  if char_length(v_body) = 0 then
    raise exception 'MESSAGE_EMPTY';
  end if;
  if char_length(v_body) > v_cfg.max_message_length then
    raise exception 'MESSAGE_TOO_LONG';
  end if;

  -- 頻率限制。先對「這個使用者」上鎖,避免同一個人同時送出好幾則時一起通過檢查。
  perform pg_advisory_xact_lock(hashtextextended('send_message:' || v_uid::text, 0));

  v_window := make_interval(secs => v_cfg.rate_limit_window_seconds);

  select count(*) into v_count
  from public.messages g
  where g.user_id = v_uid and g.kind = 'chat' and g.created_at > now() - v_window;

  if v_count >= v_cfg.rate_limit_count then
    -- 要等到「讓名額空出來的那一則」滑出時間視窗
    select g.created_at into v_blocker
    from public.messages g
    where g.user_id = v_uid and g.kind = 'chat' and g.created_at > now() - v_window
    order by g.created_at asc
    offset (v_count - v_cfg.rate_limit_count)
    limit 1;

    v_wait_ms := greatest(1, ceil(extract(epoch from (v_blocker + v_window - now())) * 1000)::integer);
    raise exception 'RATE_LIMITED' using detail = v_wait_ms::text;
  end if;

  update public.members
     set last_beat_at = now(), leaving_at = null
   where session_id = p_session_id;

  -- 發言者的代號取自成員表(伺服器依登入身分查出來),不信任畫面帶來的任何名字
  insert into public.messages (kind, user_id, nickname, body, expires_at)
  values ('chat', v_uid, v_member.nickname, v_body,
          now() + make_interval(secs => v_cfg.message_ttl_seconds));
end;
$$;

revoke all on function public.send_message(uuid, text) from public, anon, authenticated;
grant execute on function public.send_message(uuid, text) to authenticated;


-- ---------------------------------------------------------------------
-- 取得快照:加入、重連時一次取得完整狀態
-- (伺服器時間、規則數值、我自己、目前的人、還沒過期的訊息、營火)
-- 過期的訊息一律不會回傳。
-- ---------------------------------------------------------------------
create or replace function public.get_snapshot(p_session_id uuid)
returns jsonb
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

  return public.build_snapshot(v_uid, p_session_id);
end;
$$;

revoke all on function public.get_snapshot(uuid) from public, anon, authenticated;
grant execute on function public.get_snapshot(uuid) to authenticated;
