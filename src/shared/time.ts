import { FADE_STAGE1_MS, FADE_STAGE2_MS } from '../config';

const pad = (n: number) => String(n).padStart(2, '0');

export function formatClock(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 訊息淡出階段:0 正常、1 正在淡出(最後約 60 秒)、2 快要消失(最後約 20 秒) */
export function fadeStage(remainingMs: number): 0 | 1 | 2 {
  if (remainingMs <= FADE_STAGE2_MS) return 2;
  if (remainingMs <= FADE_STAGE1_MS) return 1;
  return 0;
}
