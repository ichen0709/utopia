<script lang="ts">
  // 圍著營火坐的人:最多 SEAT_COUNT 個座位(含自己),人太多時用「+N」,點開看完整名單。
  // 座位位置是營火場景(390×350)裡的座標,見 docs/design.md 3.5。
  import { SEAT_COUNT } from '../config';
  import type { Member } from '../backend/types';
  import { colorIndex } from '../shared/color';
  import { nicknameKey } from '../shared/nickname';

  let {
    members,
    me,
    onmention,
    onopen,
  }: {
    members: Member[];
    me: string | null;
    onmention: (nickname: string) => void;
    onopen: () => void;
  } = $props();

  // 其他人依序坐在這幾個位置(中心座標)
  const SLOTS = [
    { x: 50, y: 160 },
    { x: 86, y: 92 },
    { x: 304, y: 92 },
    { x: 340, y: 160 },
    { x: 298, y: 236 },
  ];
  const SELF_SLOT = { x: 92, y: 236 };

  const others = $derived(
    members
      .filter((m) => !me || nicknameKey(m.nickname) !== nicknameKey(me))
      .sort((a, b) => Date.parse(a.joinedAt) - Date.parse(b.joinedAt)),
  );
  const meAway = $derived(!!me && members.some((m) => nicknameKey(m.nickname) === nicknameKey(me) && m.away === true));
  const seated = $derived(others.slice(0, SEAT_COUNT - 1));
  const extra = $derived(Math.max(0, others.length - seated.length));
</script>

{#if me}
  <div class="seat" style:left="{SELF_SLOT.x - 32}px" style:top="{SELF_SLOT.y - 22}px">
    <span class="sw you c{colorIndex(me)}" class:away={meAway}>
      <svg viewBox="0 0 28 28" width="28" height="28" aria-hidden="true"><circle cx="14" cy="9.5" r="5.2" /><path d="M3.5 26c0-6 4.5-9.5 10.5-9.5S24.5 20 24.5 26z" /></svg>
      <span class="youtag">你</span>
    </span>
    <span class="sn">{me}</span>
    {#if meAway}<span class="awaytag">暫離中</span>{/if}
  </div>
{/if}

{#each seated as m, i (m.nickname)}
  <button
    class="seat btn-seat"
    type="button"
    style:left="{SLOTS[i].x - 32}px"
    style:top="{SLOTS[i].y - 22}px"
    aria-label="對 {m.nickname} 說話(在輸入框插入 @{m.nickname})"
    onclick={() => onmention(m.nickname)}
  >
    <span class="sw c{colorIndex(m.nickname)}" class:away={m.away === true}>
      <svg viewBox="0 0 28 28" width="28" height="28" aria-hidden="true"><circle cx="14" cy="9.5" r="5.2" /><path d="M3.5 26c0-6 4.5-9.5 10.5-9.5S24.5 20 24.5 26z" /></svg>
    </span>
    <span class="sn">{m.nickname}</span>
    {#if m.away}<span class="awaytag">暫離中</span>{/if}
  </button>
{/each}

{#if extra > 0}
  <button class="chip" type="button" aria-label="還有 {extra} 位,點開看完整名單" onclick={onopen}>
    <svg class="ic" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M12 5v14" /><path d="M5 12h14" /></svg>{extra}
  </button>
{/if}

<style>
  .seat {
    position: absolute;
    width: 64px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
  }
  .btn-seat {
    padding: 0;
    border: 0;
    background: none;
    border-radius: 12px;
  }
  .sw {
    position: relative;
    width: 34px;
    height: 34px;
    border-radius: 50%;
    background: rgba(10, 15, 30, 0.62);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .sw svg {
    fill: currentColor;
  }
  /* 暫離中:圖示變淡,名字下面多一個「暫離中」標籤 */
  .sw.away {
    opacity: 0.5;
  }
  .awaytag {
    margin-top: -1px;
    padding: 1px 6px;
    font-size: 11px;
    line-height: 1.3;
    border-radius: 8px;
    background: rgba(23, 30, 56, 0.92);
    border: 1px solid #6a77a8;
    color: #f4ead6;
    white-space: nowrap;
  }
  .sw.you {
    box-shadow:
      0 0 0 2px #f7bd62,
      0 0 0 5px rgba(247, 189, 98, 0.25);
  }
  .youtag {
    position: absolute;
    top: -8px;
    right: -8px;
    background: #f7bd62;
    color: #1c1108;
    font-size: 11px;
    font-weight: 700;
    line-height: 1;
    padding: 2px 5px;
    border-radius: 8px;
  }
  .sn {
    font-size: 12px;
    line-height: 1.2;
    max-width: 64px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: #f4ead6;
    text-shadow:
      0 1px 3px #000,
      0 0 6px #000;
  }
  .chip {
    position: absolute;
    left: 157px;
    top: 240px;
    width: 76px;
    height: 44px;
    border-radius: 22px;
    background: rgba(23, 30, 56, 0.92);
    border: 1.5px solid #6a77a8;
    color: #f4ead6;
    font-weight: 700;
    font-size: 15px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    padding: 0;
  }
</style>
