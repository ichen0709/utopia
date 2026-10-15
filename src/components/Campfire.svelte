<script lang="ts">
  // 營火本身(木柴、三層火焰、火星、熄滅時的煙)。四種外觀見 docs/design.md 2.5。
  import type { FireState } from '../shared/fire';

  let { level = 'strong', width = 120 }: { level?: FireState; width?: number } = $props();

  const LOOKS = {
    strong: { scale: 1, side: 1, sparks: 1, ember: 0.9, glow: 'drop-shadow(0 0 22px rgba(242, 138, 58, 0.7))' },
    mid: { scale: 0.74, side: 0, sparks: 0.7, ember: 0.85, glow: 'drop-shadow(0 0 16px rgba(242, 138, 58, 0.55))' },
    low: { scale: 0.4, side: 0, sparks: 0.35, ember: 1, glow: 'drop-shadow(0 0 10px rgba(242, 138, 58, 0.4))' },
    out: { scale: 0, side: 0, sparks: 0, ember: 0.25, glow: 'none' },
  } as const;

  const look = $derived(LOOKS[level]);
  const out = $derived(level === 'out');
</script>

<div class="flame" style:width="{width}px" style:height="{width * 1.25}px" style:filter={look.glow}>
  <svg viewBox="0 0 120 150" width="100%" height="100%" aria-hidden="true" focusable="false">
    <g class="smoke" style:opacity={out ? 0.4 : 0}>
      <path class="drift" d="M58 122 C50 102 68 92 58 72 C52 58 66 48 60 30" fill="none" stroke="#d9d0c0" stroke-width="3" stroke-linecap="round" />
      <path class="drift d2" d="M70 126 C64 112 76 104 70 92" fill="none" stroke="#d9d0c0" stroke-width="2.4" stroke-linecap="round" />
    </g>

    <rect x="14" y="132" width="92" height="14" rx="7" transform="rotate(-7 60 139)" fill={out ? '#2e2420' : '#5a3822'} />
    <rect x="14" y="132" width="92" height="14" rx="7" transform="rotate(7 60 139)" fill={out ? '#352a25' : '#6b4128'} />
    <g class="embers" style:opacity={look.ember} fill={out ? '#8a7466' : '#ff7a2a'}>
      <ellipse cx="60" cy="137" rx="34" ry="6" />
      <ellipse cx="44" cy="141" rx="3" ry="2" />
      <ellipse cx="78" cy="142" rx="3.5" ry="2.2" />
    </g>

    <g class="body" style:transform="scale({look.scale})" style:opacity={out ? 0 : 1}>
      <g class="side" style:opacity={look.side}>
        <g class="f3"><path d="M30 138 C18 128 18 108 28 94 C30 108 40 112 42 126 C43 134 38 138 30 138 Z" fill="#f26a1b" /></g>
        <g class="f3"><path d="M90 138 C102 128 102 108 92 94 C90 108 80 112 78 126 C77 134 82 138 90 138 Z" fill="#f26a1b" /></g>
      </g>
      <g class="f1"><path d="M60 4 C66 30 92 46 92 82 C92 112 78 138 60 138 C42 138 28 112 28 82 C28 62 40 52 44 34 C50 44 52 50 54 52 C58 40 56 22 60 4 Z" fill="#f26a1b" /></g>
      <g class="f2"><path d="M60 40 C66 60 80 72 80 98 C80 120 72 136 60 136 C48 136 40 120 40 98 C40 84 48 78 50 66 C54 74 56 76 57 76 C60 66 58 52 60 40 Z" fill="#ffa83a" /></g>
      <g class="f3"><path d="M60 84 C65 94 70 102 70 114 C70 128 66 136 60 136 C54 136 50 128 50 114 C50 104 56 98 60 84 Z" fill="#ffe08a" /></g>
    </g>

    <g class="sparks" style:opacity={look.sparks}>
      <circle class="sp s1" cx="48" cy="60" r="2.2" fill="#ffd27a" />
      <circle class="sp s2" cx="74" cy="52" r="1.8" fill="#ffb55a" />
      <circle class="sp s3" cx="62" cy="40" r="2" fill="#ffd27a" />
    </g>
  </svg>
</div>

<style>
  .flame {
    position: relative;
    transition: filter 0.9s ease;
  }
  svg {
    overflow: visible;
    display: block;
  }
  .body {
    transform-origin: 60px 138px;
    transition:
      transform 0.9s ease,
      opacity 0.9s ease;
  }
  .side,
  .embers,
  .sparks,
  .smoke {
    transition: opacity 0.9s ease;
  }
  .f1,
  .f2,
  .f3 {
    transform-origin: 60px 138px;
  }
  .f1 {
    animation: flick 1.3s ease-in-out infinite alternate;
  }
  .f2 {
    animation: flick 0.95s ease-in-out infinite alternate-reverse;
  }
  .f3 {
    animation: flick 0.7s ease-in-out infinite alternate;
  }
  @keyframes flick {
    0% {
      transform: scale(1, 1) skewX(0deg);
    }
    50% {
      transform: scale(0.96, 1.06) skewX(-2deg);
    }
    100% {
      transform: scale(1.04, 0.95) skewX(2deg);
    }
  }
  .sp {
    animation: rise 2.4s ease-out infinite;
  }
  .s2 {
    animation-delay: 0.8s;
  }
  .s3 {
    animation-delay: 1.6s;
  }
  @keyframes rise {
    0% {
      transform: translateY(0);
      opacity: 1;
    }
    100% {
      transform: translateY(-58px);
      opacity: 0;
    }
  }
  .drift {
    animation: drift 4s ease-in-out infinite alternate;
  }
  .d2 {
    animation-delay: 1s;
  }
  @keyframes drift {
    0% {
      transform: translateX(-3px);
    }
    100% {
      transform: translateX(4px);
    }
  }

  /* 減少動態效果:火不搖曳、火星不飄、煙不飄;旺弱只靠大小和亮度表示 */
  @media (prefers-reduced-motion: reduce) {
    .f1,
    .f2,
    .f3,
    .sp,
    .drift {
      animation: none;
    }
    .flame,
    .body,
    .side,
    .embers,
    .sparks,
    .smoke {
      transition: none;
    }
  }
</style>
