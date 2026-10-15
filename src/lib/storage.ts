// 瀏覽器儲存的小包裝。無痕視窗或被封鎖時,存取可能丟出錯誤,所以每次都包 try/catch,失敗就退回記憶體。

function make(getStore: () => Storage) {
  const mem = new Map<string, string>();
  return {
    get(key: string): string | null {
      try {
        return getStore().getItem(key);
      } catch {
        return mem.get(key) ?? null;
      }
    },
    set(key: string, value: string): void {
      try {
        getStore().setItem(key, value);
      } catch {
        mem.set(key, value);
      }
    },
    remove(key: string): void {
      try {
        getStore().removeItem(key);
      } catch {
        mem.delete(key);
      }
    },
  };
}

/** 跨分頁共用、關掉瀏覽器還在(記住代號、提示音偏好) */
export const local = make(() => localStorage);
/** 只屬於這個分頁(分頁工作階段編號) */
export const session = make(() => sessionStorage);

export function randomId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
}
