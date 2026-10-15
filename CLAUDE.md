# 營火聊天室

一個不用登入的匿名聊天室,主題是營火:大家圍著火堆聊天,網頁放 GitHub Pages,即時傳訊用 Supabase。

## 規則

- 開始任何工作前,先讀 `docs/architecture.md`。
- 目前在「階段二」(接上 Supabase)。階段一(前端搭配本機模擬後端)已完成並上線。
- 資料庫設定檔放 `supabase/migrations/`。不使用 Supabase CLI:SQL 由使用者一份一份貼進 Supabase 網頁的 SQL Editor 執行,每份貼完怎麼確認寫在 `supabase/README.md`。
- 不可以把金鑰檔案 commit 進 git(`.env`、資料庫密碼、secret key、`service_role` key 等),細節見架構文件第 8 章。SQL 與 README 裡也不可以出現任何金鑰、密碼、專案網址。
