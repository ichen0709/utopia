# 營火聊天室

一個不用登入的匿名聊天室。大家圍著一堆營火聊天,線上的人像坐在火堆旁。所有人在同一個聊天室,電腦和手機都能用。

**線上網址:** https://ichen0709.github.io/utopia/

- 網頁放在 GitHub Pages。
- 前端用 TypeScript、Svelte、Vite。
- 即時傳訊用 Supabase(Realtime,透過 WebSocket)。

## 基本功能

- **匿名登入**:不用註冊,每個瀏覽器自動得到一個隱形的身分。
- **輸入代號**:進入前先取一個代號;已有人用就提示換一個。
- **代號規則**:長度 1 到 20 字、不可有空白與 `@`、大小寫視為相同,由伺服器強制。
- **線上名單**:誰在線上(圍坐營火的人、「+N」、完整名單、目前人數)。
- **加入與離開提示**:有人坐下或離開,聊天區出現一行系統訊息。
- **離開營火按鈕**:按下後立刻離開、代號立刻釋出。
- **心跳逾時與離線清除**:直接關網頁或斷線的人,由伺服器在 30 秒後判定離開並清除。
- **歷史訊息**:新進來的人看得到還沒過期(30 分鐘內)的訊息。
- **連線中斷提示與自動重連**:斷線時停用輸入並保留已打的字,恢復後自動重連。
- **「有 N 則新訊息」按鈕與自動捲動**。
- **訊息長度上限 300 字**:由伺服器強制。
- **深色與淺色、減少動態效果、手機單欄**:依自己的系統設定自動切換。
- **記住代號**:重新整理後直接回到聊天室。
- **純文字顯示**:訊息內容一律當純文字,HTML 字串原樣顯示成文字,不會被執行。

## 新增功能

- **營火加柴全員同步**:任何人按下「加柴」,所有人看到的火同步變旺,沒人加就慢慢變小直到熄滅。
  (`supabase/migrations/0004_fire.sql`、`src/components/CampScene.svelte`、`src/components/Campfire.svelte`、`src/shared/fire.ts`)
- **伺服器端發訊頻率限制**:同一個人 10 秒內最多送 5 則訊息,超過由伺服器拒絕。
  (`supabase/migrations/0003_messages.sql`)
- **訊息 30 分鐘由伺服器刪除**:30 分鐘後伺服器不再提供並定時真的刪除,不只是畫面上藏起來。
  (`supabase/migrations/0001_schema.sql`、`supabase/migrations/0005_cron.sql`)
- **@ 提及與提示音**:有人 @ 我的代號時,該則訊息高亮並發出提示音(可以關閉)。
  (`src/shared/mention.ts`、`src/components/MentionMenu.svelte`、`src/lib/sound.ts`)
- **http/https 安全連結**:只有 http、https 網址可以點,在新分頁開啟且不能控制原頁。
  (`src/shared/linkify.ts`、`src/components/MessageItem.svelte`)

## 在自己的電腦上執行

需要先安裝 [Node.js](https://nodejs.org)(建議 24 版;22.22 以上也可以)。

```
npm install
npm run dev
```

然後打開 http://localhost:5173/utopia/ (網址後面的 `/utopia/` 不能省)。

- **沒有任何設定時**,畫面會使用瀏覽器內的「模擬後端」,頂端有「示範模式」橫幅,其他人是模擬的,不需要任何帳號或金鑰。
- **想連到自己的 Supabase 時**:把 `.env.example` 複製成 `.env`,填入你專案的「專案網址」和「公開金鑰」兩個值,資料庫要先照 [`supabase/README.md`](supabase/README.md) 設定好。`.env` 不會被 commit。

其他常用指令:

| 指令 | 做什麼 |
|---|---|
| `npm test` | 執行自動測試 |
| `npm run check` | 檢查型別與 Svelte 語法 |
| `npm run build` | 編譯成可以發佈的網頁(輸出到 `dist/`) |
| `npm run preview` | 預覽編譯後的網頁(http://localhost:4173/utopia/) |

## 文件

- [需求說明](docs/requirements.md)
- [架構文件](docs/architecture.md):技術選擇、資料流、畫面清單、金鑰與安全、驗證清單
- [設計文件](docs/design.md):配色、字體、元件與各畫面狀態
- [Supabase 資料庫設定](supabase/README.md):SQL 檔的執行順序與每一步怎麼確認

## 關於金鑰

資料庫密碼、secret key、`service_role` key 絕對不能出現在這個 repo 的任何地方。網頁只會用到公開的專案網址與公開金鑰。每次發佈時,`scripts/check-secrets.sh` 會自動檢查,發現就停止發佈。
