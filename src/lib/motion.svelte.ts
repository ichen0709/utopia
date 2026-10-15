// 系統是否設為「減少動態效果」。CSS 用 media query 處理樣式;需要程式判斷的地方(例如訊息消失的動畫)讀這裡。

export const motion = $state({ reduced: false });

if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  motion.reduced = mq.matches;
  mq.addEventListener('change', (e) => {
    motion.reduced = e.matches;
  });
}
