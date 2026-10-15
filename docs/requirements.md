# 需求說明

## 這是什麼
一個不用登入的匿名聊天室。所有人在同一個聊天室裡。

## 誰會用
任何知道網站連結的人都可以進來用,可以用電腦,也可以用手機來操作。

## 使用的流程
1. 打開網頁
2. 輸入一個代號
3. 進入聊天室,看到其他人的訊息,也可以送出訊息

## 畫面上要有
- 誰在線上
- 有人進來或離開時要有提示

## 不需要的
- 註冊、登入

## 技術上我知道的
- 網頁放在 GitHub Pages
- 即時傳訊用 Supabase,透過 WebSocket
- 畫面設計用 /design,前端用 /frontend-design 做出來

## 做事的順序
1. 先把前端做好,放上 GitHub Pages 看得到
2. 最後才接上 Supabase

## 我不知道、需要你幫我決定並解釋的
- 前端要用什麼語言和框架
- Supabase 要怎麼設定
- 金鑰怎麼產生、要放在哪裡


## 新增功能
在上面的需求之外,這次額外做了下面六項(詳細的設計與分類見 `docs/architecture.md` 1.4):
- **營火加柴全員同步**:畫面上有一堆營火和「加柴」按鈕,任何人按下,所有人看到的火同步變旺,沒人加就慢慢變小直到熄滅。
  對應檔案:`supabase/migrations/0004_fire.sql`、`src/components/CampScene.svelte`、`src/components/Campfire.svelte`、`src/shared/fire.ts`
- **伺服器端發訊頻率限制**:同一個人 10 秒內最多送 5 則訊息,超過由伺服器拒絕,繞過畫面也破解不了。
  對應檔案:`supabase/migrations/0003_messages.sql`(階段一的模擬版:`src/backend/local/room.ts`)
- **訊息 30 分鐘由伺服器刪除**:每則訊息 30 分鐘後,伺服器不再提供並定時真的刪除,不只是畫面上藏起來。
  對應檔案:`supabase/migrations/0001_schema.sql`、`supabase/migrations/0005_cron.sql`
- **@ 提及與提示音**:輸入 @ 可以選人,有人 @ 我的代號時,該則訊息高亮並發出提示音(可以關閉)。
  對應檔案:`src/shared/mention.ts`、`src/components/MentionMenu.svelte`、`src/lib/sound.ts`
- **http/https 安全連結**:訊息裡只有 http、https 開頭的網址可以點,在新分頁開啟,而且新分頁不能控制原本的聊天室。
  對應檔案:`src/shared/linkify.ts`、`src/components/MessageItem.svelte`
- **暫離一下**:線上名單裡可以切換自己的「暫離一下」,所有人在名單中看到該使用者旁邊顯示「暫離中」,再切換就恢復。只是顯示用的標記,不影響心跳與離開判定,也不產生系統訊息。
  對應檔案:`supabase/migrations/0006_away.sql`、`src/components/RosterPanel.svelte`、`src/components/Roster.svelte`、`src/backend/local/room.ts`(階段一的模擬版)
