#!/usr/bin/env bash
# 金鑰檢查:不該公開的東西,不能出現在 repo 的檔案裡,也不能出現在打包後的網頁裡。
#
# 用法:
#   bash scripts/check-secrets.sh repo     檢查 git 追蹤的檔案(以及還沒被 .gitignore 擋掉的新檔案)
#   bash scripts/check-secrets.sh dist     檢查打包後的 dist/(會被公開到網路上)
#
# 擋:secret key(sb_secret_)、access token(sbp_)、資料庫連線字串(帶密碼的 postgres://)、
#     任何 JWT(舊版的 anon / service_role 金鑰都是 JWT,這個專案用不到,出現就一定是錯的)、
#     以及 dist 裡的 service_role 字樣。
# 放行:publishable key(sb_publishable_ 開頭,本來就是公開的,會被打包進網頁)和專案網址。
# 資料庫密碼本身沒有固定的長相,無法自動辨識,所以只能靠上面的連線字串檢查,與「不要貼到任何地方」的規矩。
set -u

mode="${1:-}"
fail=0

PATTERNS=(
  'sb_secret_[A-Za-z0-9_-]{8,}'
  'sbp_[A-Za-z0-9]{20,}'
  "postgres(ql)?://[^[:space:]'\"]+:[^[:space:]'\"@]+@"
  'eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{8,}'
)

scan() {
  local pattern="$1"
  local hits
  if [ "$mode" = "dist" ]; then
    hits=$(grep -rEIl -e "$pattern" dist 2>/dev/null)
  else
    hits=$(git ls-files -co --exclude-standard -z | xargs -0 grep -EIl -e "$pattern" 2>/dev/null | grep -v '^package-lock\.json$')
  fi
  if [ -n "$hits" ]; then
    echo "發現不該公開的內容(符合規則:$pattern):"
    echo "$hits" | sed 's/^/  - /'
    fail=1
  fi
}

case "$mode" in
  repo | dist) ;;
  *)
    echo "用法:bash scripts/check-secrets.sh repo|dist"
    exit 2
    ;;
esac

if [ "$mode" = "dist" ] && [ ! -d dist ]; then
  echo "找不到 dist/ 資料夾,請先執行 npm run build"
  exit 2
fi

for p in "${PATTERNS[@]}"; do
  scan "$p"
done

if [ "$mode" = "dist" ]; then
  scan 'service_role'
fi

if [ "$fail" -ne 0 ]; then
  echo "金鑰檢查沒有通過,停止。"
  exit 1
fi
echo "金鑰檢查通過($mode):沒有發現不該公開的內容。"
