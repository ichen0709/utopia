/** 以 Unicode 字元(不是 UTF-16 單位)計算長度;畫面與伺服器用同一種算法 */
export function chars(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

export function lastChar(s: string): string {
  const a = Array.from(s);
  return a.length ? a[a.length - 1] : '';
}

export function firstChar(s: string): string {
  const it = s[Symbol.iterator]().next();
  return it.done ? '' : it.value;
}
