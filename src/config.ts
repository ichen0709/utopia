import type { RoomConfig } from './backend/types';

/** 要用哪個後端。階段一固定是 local(瀏覽器內的模擬後端) */
export const BACKEND: string = import.meta.env.VITE_BACKEND ?? 'local';

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
