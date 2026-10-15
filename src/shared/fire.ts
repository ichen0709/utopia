import { FIRE_MID_FROM, FIRE_STRONG_FROM } from '../config';

export type FireState = 'strong' | 'mid' | 'low' | 'out';

/** 現在的亮度 = 存下來的亮度 − 流逝的時間 × 衰減速度,最低 0、最高 100 */
export function levelAt(level: number, updatedAtMs: number, nowMs: number, secondsPerPoint: number): number {
  const elapsed = Math.max(0, nowMs - updatedAtMs) / 1000;
  return Math.max(0, Math.min(100, level - elapsed / secondsPerPoint));
}

export function stateOf(level: number): FireState {
  if (level <= 0) return 'out';
  if (level >= FIRE_STRONG_FROM) return 'strong';
  if (level >= FIRE_MID_FROM) return 'mid';
  return 'low';
}
