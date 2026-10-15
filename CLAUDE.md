# 營火聊天室

一個不用登入的匿名聊天室,主題是營火:大家圍著火堆聊天,網頁放 GitHub Pages,即時傳訊用 Supabase。

## 規則

- 開始任何工作前,先讀 `docs/architecture.md`。
- 目前在「階段一」(前端搭配本機模擬後端,不接 Supabase)。
- 階段一不要建立 `supabase/` 資料夾與任何 SQL 檔案,等使用者說進入階段二才建。
- 不可以把金鑰檔案 commit 進 git(`.env`、資料庫密碼、secret key、`service_role` key 等),細節見架構文件第 8 章。
