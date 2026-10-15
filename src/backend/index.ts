import { BACKEND } from '../config';
import { LocalBackend } from './local/LocalBackend';
import type { ChatBackend } from './types';

/**
 * 決定要用哪個後端。畫面程式只認 ChatBackend 合約,不知道背後是誰。
 *
 * 階段二:新增 src/backend/supabase/ 實作同一份合約,然後在這裡加上
 *   if (BACKEND === 'supabase') return new SupabaseBackend(...)
 * 其餘畫面程式一行都不用改。
 */
export function createBackend(): ChatBackend {
  if (BACKEND !== 'local') {
    throw new Error(`尚未支援的後端:${BACKEND}(階段一只有 local)`);
  }
  return new LocalBackend();
}
