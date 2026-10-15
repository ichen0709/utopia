-- =====================================================================
-- 0005_cron.sql
-- 定時工作:刪除過期訊息、清除離線成員、清掉工作紀錄
--
-- 【執行順序】第 5 個(最後一個),共 5 個。
--            請先確認 0001 到 0004 都已經執行成功,而且已經在後台啟用 pg_cron
--            (Integrations → Cron → Enable,詳見 supabase/README.md 的步驟)。
-- 【可以重複執行】再貼一次不會壞:同名的定時工作會被更新,不會變成兩個。
--
-- 這個檔案負責的伺服器規則:
--   * 訊息 30 分鐘後「真的被刪除」:每分鐘刪掉已過期的訊息
--     (這是第二道保險;第一道是 0001 的權限規則,過期的訊息本來就已經讀不到)
--   * 離開判定:約每 10 秒清除沒有心跳、或已通知離開的成員,並新增「離開」系統訊息
--     (其他函式在每次被呼叫時也會順手做一次,所以這個工作只是確保「沒有人操作時」
--      離線的人也會被移除)
-- =====================================================================


-- 沒有啟用 pg_cron 的話,先給一個看得懂的提示,而不是一堆英文錯誤
do $$
begin
  if to_regnamespace('cron') is null then
    raise exception '還沒啟用 pg_cron。請先到 Supabase 後台:Integrations → Cron → Enable(或 Database → Extensions 搜尋 pg_cron 並打開),再重新執行這份檔案。';
  end if;
end
$$;


-- ---------------------------------------------------------------------
-- 刪除過期訊息(給定時工作使用,瀏覽器不能呼叫)
-- ---------------------------------------------------------------------
create or replace function public.cleanup_messages()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.messages where expires_at <= now();
end;
$$;

revoke all on function public.cleanup_messages() from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 排程(同名的工作會被更新,重複執行不會變成兩個)
-- ---------------------------------------------------------------------
do $$
begin
  -- 每分鐘:真的刪掉過期訊息
  perform cron.schedule('campfire-delete-expired-messages', '* * * * *', 'select public.cleanup_messages()');

  -- 約每 10 秒:清除離線成員(排程的寫法是「每 10 秒」)
  perform cron.schedule('campfire-cleanup-members', '10 seconds', 'select public.cleanup_members()');

  -- 每天凌晨 3 點(UTC):清掉超過 1 天的定時工作紀錄,避免紀錄表越長越大
  perform cron.schedule(
    'campfire-prune-cron-log',
    '0 3 * * *',
    $job$delete from cron.job_run_details where end_time < now() - interval '1 day'$job$
  );
end
$$;
