<script lang="ts">
  // 營火場景:夜空、營火、圍坐的人、「+N」、熄滅提示、加柴按鈕。
  // 版面是 390×350 的固定構圖,依欄寬等比縮放(電腦版放大、矮視窗縮小),見 docs/design.md 第 5 章。
  import type { Member } from '../backend/types';
  import type { FireState } from '../shared/fire';
  import Campfire from './Campfire.svelte';
  import Roster from './Roster.svelte';
  import StokeButton from './StokeButton.svelte';

  let {
    fire,
    members,
    me,
    stoke,
    secondsLeft,
    cooldownSeconds,
    onstoke,
    onmention,
    onopen,
    reserveHeight = 340,
  }: {
    fire: FireState;
    members: Member[];
    me: string | null;
    stoke: 'ready' | 'cooldown' | 'off';
    secondsLeft: number;
    cooldownSeconds: number;
    onstoke: () => void;
    onmention: (nickname: string) => void;
    onopen: () => void;
    /** 場景以外的版面(頂部列、輸入區、聊天區最小高度)至少要保留的高度 */
    reserveHeight?: number;
  } = $props();

  const W = 390;
  const H = 350;
  let boxWidth = $state(W);
  let viewportHeight = $state(typeof window === 'undefined' ? 800 : window.innerHeight);

  // 縮放比例:寬度夠就放大(最多 1.3 倍),視窗太矮就縮小(最少 0.75 倍),讓聊天區保有空間
  const scale = $derived(Math.max(0.75, Math.min(boxWidth / W, 1.3, (viewportHeight - reserveHeight) / H)));

  const SKY = {
    strong: 'linear-gradient(180deg, #0a0f1e 0%, #18203f 55%, #4a2a18 100%)',
    mid: 'linear-gradient(180deg, #090e1c 0%, #151c38 58%, #33200f 100%)',
    low: 'linear-gradient(180deg, #080c18 0%, #111730 62%, #1e150c 100%)',
    out: 'linear-gradient(180deg, #04060b 0%, #080d1a 60%, #0a0f1c 100%)',
  } as const;
  const GLOW = { strong: 0.55, mid: 0.36, low: 0.2, out: 0 } as const;
  const STARS = [
    [34, 30],
    [92, 58],
    [150, 22],
    [238, 40],
    [286, 18],
    [352, 72],
  ];
</script>

<svelte:window bind:innerHeight={viewportHeight} />

<div class="box" bind:clientWidth={boxWidth} style:height="{H * scale}px" style:background={SKY[fire]}>
  <div class="hill"></div>
  <div class="scene" style:transform="translateX(-50%) scale({scale})">
    {#each STARS as [x, y] (x)}
      <div class="star" style:left="{x}px" style:top="{y}px" style:opacity={fire === 'out' ? 0.95 : 0.5}></div>
    {/each}
    {#if fire === 'out'}<div class="moon"></div>{/if}
    <div class="glow" style:opacity={GLOW[fire]}></div>

    <div class="fireplace"><Campfire level={fire} /></div>

    {#if fire === 'out'}
      <div class="hint" role="status">營火熄了,按「加柴」重新點燃</div>
    {/if}

    <Roster {members} {me} {onmention} {onopen} />

    <div class="stoke">
      <StokeButton state={stoke} {secondsLeft} {cooldownSeconds} {onstoke} />
    </div>
  </div>
</div>

<style>
  .box {
    position: relative;
    width: 100%;
    overflow: hidden;
    flex: none;
    border-radius: 0 0 30px 32px;
    transition: background 1.2s ease;
    /* 營火場景永遠是夜晚,不跟系統亮暗走:把代號顏色固定成夜晚版 */
    --c1: #ff9b85;
    --c2: #7fd6b0;
    --c3: #7db8ff;
    --c4: #c3a4ff;
    --c5: #e8d56a;
    --c6: #ff8fb8;
    --c7: #5ed3d9;
    color: #f4ead6;
  }
  .hill {
    position: absolute;
    left: -30px;
    right: -30px;
    bottom: -44px;
    height: 120px;
    border-radius: 50% 50% 0 0 / 60px 60px 0 0;
    background: #070a15;
  }
  .scene {
    position: absolute;
    left: 50%;
    top: 0;
    width: 390px;
    height: 350px;
    transform-origin: 50% 0;
  }
  .star {
    position: absolute;
    width: 2px;
    height: 2px;
    border-radius: 50%;
    background: #f4ead6;
    transition: opacity 1.2s ease;
  }
  .moon {
    position: absolute;
    left: 316px;
    top: 22px;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    background: #e4dcc6;
    box-shadow: 0 0 18px rgba(228, 220, 198, 0.45);
  }
  .glow {
    position: absolute;
    left: 25px;
    top: 10px;
    width: 340px;
    height: 340px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(242, 138, 58, 1) 0%, rgba(242, 138, 58, 0) 65%);
    transition: opacity 1.2s ease;
    pointer-events: none;
  }
  .fireplace {
    position: absolute;
    left: 135px;
    top: 80px;
  }
  .hint {
    /* 放在兩側座位之間(座位的代號在 x<118 與 x>272),不蓋到任何人的名字 */
    position: absolute;
    left: 122px;
    right: 122px;
    top: 96px;
    text-align: center;
    padding: 8px 10px;
    background: rgba(5, 7, 13, 0.84);
    border: 1.5px dashed #8a7358;
    border-radius: 14px 16px 14px 18px;
    color: #f4ead6;
    font-family: 'Noto Serif TC', 'Songti TC', serif;
    font-weight: 600;
    font-size: 14px;
    line-height: 1.5;
  }
  .stoke {
    position: absolute;
    left: 0;
    right: 0;
    top: 292px;
    display: flex;
    justify-content: center;
  }
  @media (prefers-reduced-motion: reduce) {
    .box,
    .star,
    .glow {
      transition: none;
    }
  }
</style>
