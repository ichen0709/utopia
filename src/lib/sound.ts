// 被 @ 時的提示音。用瀏覽器內建的聲音合成產生一個短短的兩音提示,不需要音檔。
// 手機瀏覽器要使用者先點過畫面才允許出聲,所以在「加入」那一下點擊時呼叫 unlockSound()。

let ctx: AudioContext | null = null;

type AudioWindow = Window & { webkitAudioContext?: typeof AudioContext };

export function unlockSound(): void {
  try {
    const AC = window.AudioContext ?? (window as AudioWindow).webkitAudioContext;
    if (!AC) return;
    ctx ??= new AC();
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    // 不支援聲音就算了
  }
}

function tone(c: AudioContext, freq: number, start: number, duration: number): void {
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(0.22, start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(gain);
  gain.connect(c.destination);
  osc.start(start);
  osc.stop(start + duration + 0.05);
}

export function playMention(): void {
  try {
    if (!ctx) unlockSound();
    if (!ctx) return;
    if (ctx.state === 'suspended') void ctx.resume();
    const t = ctx.currentTime;
    tone(ctx, 660, t, 0.16);
    tone(ctx, 990, t + 0.15, 0.26);
  } catch {
    // 出不了聲也不影響使用
  }
}
