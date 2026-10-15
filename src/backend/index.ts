import { BACKEND, SUPABASE_KEY, SUPABASE_URL } from '../config';
import { LocalBackend } from './local/LocalBackend';
import { SupabaseBackend } from './supabase/SupabaseBackend';
import type { ChatBackend } from './types';

/**
 * 決定要用哪個後端。畫面程式只認 ChatBackend 合約,不知道背後是誰。
 *   - 專案網址與公開金鑰「兩個都有」→ 真正的 Supabase(階段二)
 *   - 沒有 → 瀏覽器內的模擬後端(階段一的示範模式)
 * 示範橫幅、測試工具、測試用的網址參數,都只屬於模擬後端,用 Supabase 時完全不會出現。
 */
export function createBackend(): ChatBackend {
  if (BACKEND === 'supabase') return new SupabaseBackend(SUPABASE_URL, SUPABASE_KEY);
  return new LocalBackend();
}
