// 全站共用的「現在時間」,每 250 毫秒更新一次。
// 火的亮度、訊息淡出、冷卻倒數都從這裡算,所以畫面會自己慢慢變化。

export const clock = $state({ now: Date.now() });

if (typeof window !== 'undefined') {
  window.setInterval(() => {
    clock.now = Date.now();
  }, 250);
}
