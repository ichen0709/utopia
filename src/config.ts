import type { RoomConfig } from './backend/types';

/**
 * Supabase 的連線設定:專案網址與公開金鑰(sb_publishable_ 開頭那一把)。
 * 這兩個值本來就是公開的,會被打包進網頁;資料庫密碼、secret key、service_role key 絕對不能放在這裡。
 * 本機放在 .env,線上放在 GitHub 的 Variables。
 */
export const SUPABASE_URL: string = (import.meta.env.VITE_SUPABASE_URL ?? '').trim();
export const SUPABASE_KEY: string = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '').trim();

/** 兩個值都有就用 Supabase,沒有才用瀏覽器內的模擬後端 */
export const BACKEND: 'supabase' | 'local' = SUPABASE_URL && SUPABASE_KEY ? 'supabase' : 'local';

/** architecture.md 5.1 的預設數值。真正的數值由後端在快照裡回傳,這裡只是預設與模擬後端的來源 */
export const DEFAULT_ROOM_CONFIG: RoomConfig = {
  messageTtlSeconds: 30 * 60,
  maxMessageLength: 300,
  nicknameMax: 20,
  rateLimitCount: 5,
  rateLimitWindowSeconds: 10,
  stokeCooldownSeconds: 5,
  fireStartLevel: 50,
  fireStokeAmount: 20,
  fireSecondsPerPoint: 6,
  heartbeatSeconds: 10,
  staleSeconds: 30,
  leaveGraceSeconds: 10,
};

/** 營火亮度分成四種外觀的分界(docs/design.md 2.5) */
export const FIRE_STRONG_FROM = 67;
export const FIRE_MID_FROM = 34;

/** 營火旁最多顯示幾個座位(含自己),超過的用「+N」 */
export const SEAT_COUNT = 6;

/** 訊息在到期前多久開始淡出(docs/design.md 3.3) */
export const FADE_STAGE1_MS = 60_000;
export const FADE_STAGE2_MS = 20_000;

/** 載入畫面至少停留多久,避免一閃而過 */
export const MIN_LOADING_MS = 700;

/** 連不上時,每隔幾秒重試 */
export const RETRY_SECONDS = 5;
