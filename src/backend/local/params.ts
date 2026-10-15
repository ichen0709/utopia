// 只給測試用的網址參數(階段一專用,階段二不會用到):
//   ?ttl=60          訊息只活 60 秒(原本 1800 秒),方便測「訊息消失」
//   ?decay=1         火每降 1 點只要 1 秒(原本 6 秒),方便測「由旺到熄滅」
//   ?bots=0          不要模擬夥伴(完全沒有其他人)
//   ?unavailable=12  剛開啟頁面的前 12 秒假裝連不上,方便看「連不上」畫面

export interface DevParams {
  ttlSeconds?: number;
  secondsPerPoint?: number;
  bots: boolean;
  unavailableUntil: number;
}

function positive(v: string | null): number | undefined {
  if (v === null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function readDevParams(search: string, now: number): DevParams {
  const p = new URLSearchParams(search);
  const unavailable = positive(p.get('unavailable'));
  return {
    ttlSeconds: positive(p.get('ttl')),
    secondsPerPoint: positive(p.get('decay')),
    bots: p.get('bots') !== '0',
    unavailableUntil: unavailable ? now + unavailable * 1000 : 0,
  };
}
