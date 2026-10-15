import { nicknameKey } from './nickname';

/** 由代號算出固定的顏色編號 1 到 7(同一個代號永遠同一個顏色,大小寫不影響) */
export function colorIndex(nickname: string): number {
  const key = nicknameKey(nickname);
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h % 7) + 1;
}
