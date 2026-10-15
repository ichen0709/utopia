# supabase/ — 資料庫設定(階段二)

這個資料夾放的是「Supabase 資料庫要怎麼設定」的 SQL。**SQL 是純文字的設定檔,裡面沒有任何金鑰、密碼或網址**,所以可以放在公開的 repo。

我們**不使用 Supabase CLI**。做法是:在 Supabase 網頁的 **SQL Editor**,把 `migrations/` 底下的檔案**一份一份**複製貼上、按執行。

---

## 開始之前,要先完成這三件事

1. 已經建好 Supabase 專案(Free 方案,Region 選 **Northeast Asia (Tokyo)**)。
2. 已開啟匿名登入:**Authentication → Sign In / Providers → Allow anonymous sign-ins** 打開並 Save。
3. 已啟用定時工作:**Integrations → Cron → Enable**。找不到的話,到 **Database → Extensions** 搜尋 `pg_cron` 並打開。

(介面偶爾改版,找不到時用頁面上的搜尋,或把你看到的畫面告訴我。)

---

## 執行順序(一定要照順序)

| 順序 | 檔案 | 做什麼 |
|---|---|---|
| 1 | `migrations/0001_schema.sql` | 資料表、權限規則、規則數值、Realtime 推送 |
| 2 | `migrations/0002_membership.sql` | 代號規則、加入、離開、心跳、清除離線成員 |
| 3 | `migrations/0003_messages.sql` | 送訊息(長度檢查、10 秒 5 則限制)、取得快照 |
| 4 | `migrations/0004_fire.sql` | 營火加柴(5 秒冷卻) |
| 5 | `migrations/0005_cron.sql` | 定時工作(刪除過期訊息、清除離線成員) |

**每一份的操作都一樣:**

1. 在 Supabase 左側選 **SQL Editor**,按 **New query**(每份檔案用一個新的查詢)。
2. 打開檔案,**全選、複製**,貼到 SQL Editor。
3. 按 **Run**(或 Ctrl+Enter)。
4. 畫面下方出現 **Success** 之類的訊息,就是成功。
5. 照下面「貼完之後怎麼確認」做一次確認,**確認沒問題再貼下一份**。

**可以重複執行:** 每份都可以再貼一次,不會壞,也不會洗掉已有的資料或你調整過的數值。貼錯了、不確定有沒有成功,就重貼。

如果 SQL Editor 跳出「這個查詢有可能破壞資料(destructive)」之類的提醒,選繼續執行即可:0001 裡有 `drop policy if exists`,它只會刪除並重建我們自己的權限規則。

---

## 貼完之後怎麼確認

確認的方法是:**開一個新的 New query,貼上下面的檢查指令,按 Run,看結果跟「應該看到」一樣不一樣。** 這些指令都只是查看,不會改動任何東西。

### 0001_schema.sql 之後

**檢查 1:四張表都有開權限規則**

```sql
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in ('campfire_config', 'fire', 'messages', 'members')
order by tablename;
```

應該看到 **4 列**:`campfire_config`、`fire`、`members`、`messages`,`rowsecurity` 欄位**全部是 true**。

**檢查 2:瀏覽器完全不能寫入**

```sql
select grantee, table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('campfire_config', 'fire', 'messages', 'members')
  and grantee in ('anon', 'authenticated')
order by table_name, grantee;
```

應該**只看到 2 列**:`authenticated | fire | SELECT` 和 `authenticated | messages | SELECT`。
如果多出任何一列(尤其是 INSERT、UPDATE、DELETE,或 anon),請把結果貼給我,不要繼續。

**檢查 3:Realtime 只推送兩張表**

```sql
select tablename
from pg_publication_tables
where pubname = 'supabase_realtime' and schemaname = 'public'
order by tablename;
```

應該看到 **2 列**:`fire`、`messages`(**沒有** `members`)。

**檢查 4:規則數值**

```sql
select * from public.campfire_config;
```

應該看到 **1 列**,數值是:`message_ttl_seconds` 1800、`max_message_length` 300、`nickname_max` 20、`rate_limit_count` 5、`rate_limit_window_seconds` 10、`stoke_cooldown_seconds` 5、`fire_start_level` 50、`fire_stoke_amount` 20、`fire_seconds_per_point` 6、`heartbeat_seconds` 10、`stale_seconds` 30、`leave_grace_seconds` 10。

### 0002_membership.sql 之後

```sql
select proname,
       has_function_privilege('anon', oid, 'execute')          as anon_can_run,
       has_function_privilege('authenticated', oid, 'execute') as authenticated_can_run
from pg_proc
where pronamespace = 'public'::regnamespace
  and proname in ('join_room', 'leave_room', 'leave_soon', 'heartbeat', 'cleanup_members')
order by proname;
```

應該看到 **5 列**:
- `join_room`、`leave_room`、`leave_soon`、`heartbeat`:`anon_can_run` 是 **false**,`authenticated_can_run` 是 **true**。
- `cleanup_members`:兩欄都是 **false**(這是內部用的,瀏覽器不能呼叫)。

### 0003_messages.sql 之後

```sql
select proname,
       has_function_privilege('anon', oid, 'execute')          as anon_can_run,
       has_function_privilege('authenticated', oid, 'execute') as authenticated_can_run
from pg_proc
where pronamespace = 'public'::regnamespace
  and proname in ('send_message', 'get_snapshot')
order by proname;
```

應該看到 **2 列**:`get_snapshot`、`send_message`,`anon_can_run` 是 **false**,`authenticated_can_run` 是 **true**。

### 0004_fire.sql 之後

```sql
select proname,
       has_function_privilege('anon', oid, 'execute')          as anon_can_run,
       has_function_privilege('authenticated', oid, 'execute') as authenticated_can_run
from pg_proc
where pronamespace = 'public'::regnamespace
  and proname = 'stoke_fire';
```

應該看到 **1 列**:`stoke_fire`,`anon_can_run` 是 **false**,`authenticated_can_run` 是 **true**。

### 0005_cron.sql 之後

```sql
select jobname, schedule, active
from cron.job
where jobname like 'campfire-%'
order by jobname;
```

應該看到 **3 列**,`active` 都是 **true**:

| jobname | schedule |
|---|---|
| `campfire-cleanup-members` | `10 seconds` |
| `campfire-delete-expired-messages` | `* * * * *` |
| `campfire-prune-cron-log` | `0 3 * * *` |

如果 `campfire-cleanup-members` 那一列沒出現,或貼 0005 時出現關於 `10 seconds` 的錯誤,代表這個 Supabase 版本不接受「每 10 秒」的寫法,請把錯誤貼給我,我會改成每分鐘。

---

## 全部貼完之後的總檢查

1. 在 SQL Editor 貼上這段,**所有內部函式都應該是 false**:

```sql
select proname,
       has_function_privilege('anon', oid, 'execute')          as anon_can_run,
       has_function_privilege('authenticated', oid, 'execute') as authenticated_can_run
from pg_proc
where pronamespace = 'public'::regnamespace
order by proname;
```

應該看到 **12 列**(7 個給畫面用的 + 5 個內部用的)。其中**只有** `get_snapshot`、`heartbeat`、`join_room`、`leave_room`、`leave_soon`、`send_message`、`stoke_fire` 這 7 個的 `authenticated_can_run` 是 true;`build_snapshot`、`cleanup_members`、`cleanup_messages`、`nickname_key`、`to_iso` 這 5 個(內部用)和所有 `anon_can_run` 都必須是 false。
(12 列是指你的專案 public 裡原本沒有別的函式。如果有其他不是我們建的,忽略即可。)

2. 到 **Database → Publications**,點 `supabase_realtime`,確認 `messages` 和 `fire` 是打開的,`members` 是關的。
3. 到 **Integrations → Cron**(或 Jobs),確認看得到三個 `campfire-` 開頭的工作。
4. 到 **Authentication → Policies**,確認 `messages` 和 `fire` 各有一條規則,`members`、`campfire_config` 沒有規則(代表瀏覽器完全不能碰)。

---

## 常見狀況

| 看到什麼 | 代表什麼 | 怎麼辦 |
|---|---|---|
| `relation "public.xxx" does not exist` 或 `function ... does not exist` | 前面的檔案還沒執行成功 | 回頭從 0001 開始照順序貼 |
| `還沒啟用 pg_cron…`(貼 0005 時) | 還沒啟用定時工作 | 做「開始之前」的第 3 件事,再貼一次 0005 |
| `permission denied` | 用錯身分執行 | 在 SQL Editor 用預設身分執行即可,不要切換成其他角色 |
| 其他任何英文錯誤 | — | 把**整段錯誤文字**複製給我(不用貼 SQL 內容) |

---

## 調整規則數值

所有規則數值都在 `campfire_config` 這一列。想調整(例如頻率限制改成 10 秒 8 則),在 SQL Editor 執行:

```sql
update public.campfire_config set rate_limit_count = 8;
```

畫面會在下次取得快照時讀到新數值。重新貼 SQL 檔**不會**把你調過的數值改回預設。

---

## 這個資料夾裡絕對不要放的東西

- 資料庫密碼、secret key、`service_role` key、access token、連線字串。
- 專案網址(它放在 `.env` 與 GitHub 的設定裡,不放在這裡)。

SQL 與這份 README 只描述「規則」,不含任何與你的專案綁在一起的資訊,所以換一個 Supabase 專案時,可以照同樣順序重新貼一次,得到一模一樣的環境。

---

## 每個伺服器規則在哪個檔案

| 規則 | 檔案 |
|---|---|
| 訊息 30 分鐘到期(讀不到 + 真的刪除) | `0001_schema.sql`(權限規則)+ `0005_cron.sql`(定時刪除) |
| 10 秒內最多 5 則一般訊息(不含系統訊息) | `0003_messages.sql` |
| 加柴 5 秒冷卻 | `0004_fire.sql` |
| 代號唯一(大小寫視為同一個)、代號規則 | `0001_schema.sql`(唯一限制)+ `0002_membership.sql`(規則與衝突判斷) |
| 離開判定(30 秒沒心跳、通知離開後 10 秒緩衝) | `0002_membership.sql` + `0005_cron.sql`(定時清除) |
| 瀏覽器不能直接寫入任何資料表 | `0001_schema.sql` |
| 發言者代號由伺服器查出來、內容只當純文字 | `0003_messages.sql` |
