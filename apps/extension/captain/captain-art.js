// Captain Thread — the character. Pure SVG + CSS so it stays crisp at any size and
// animates without image files. One SVG holds every mood; `data-state` on the root
// picks which parts show: sleeping | awake | working | happy.
// Loaded as a classic content script before captain.js (shared isolated world).

(() => {
  if (globalThis.ThreadCaptainArt) return;

  let seq = 0;

  function svg({ state = "sleeping", size = 64, label = "Captain Thread" } = {}) {
    const id = `tc${++seq}`;
    return `
<svg class="tc-captain" data-state="${state}" width="${size}" height="${size}" viewBox="0 0 120 120" role="img" aria-label="${label}">
  <defs>
    <radialGradient id="${id}-body" cx="0.4" cy="0.32" r="0.78">
      <stop offset="0" stop-color="#d4efff"/>
      <stop offset="0.45" stop-color="#7cc4fb"/>
      <stop offset="1" stop-color="#3b82f6"/>
    </radialGradient>
    <linearGradient id="${id}-hat" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#334155"/>
      <stop offset="1" stop-color="#1e293b"/>
    </linearGradient>
  </defs>

  <ellipse class="tc-shadow" cx="60" cy="109" rx="27" ry="4.2" fill="#0f172a" opacity="0.16"/>

  <g class="tc-tail">
    <path d="M93 86 C106 88 112 77 105 71 C99 66 91 72 97 78 C102 83 111 84 114 95"
      fill="none" stroke="#fb7185" stroke-width="3.4" stroke-linecap="round"/>
    <path class="tc-heart" d="M114 101.6 L109.6 97.4 A2.6 2.6 0 1 1 114 94.6 A2.6 2.6 0 1 1 118.4 97.4 Z" fill="#f43f5e"/>
  </g>

  <g class="tc-bob">
    <ellipse cx="47" cy="103.5" rx="8.5" ry="4.8" fill="#2563eb"/>
    <ellipse cx="73" cy="103.5" rx="8.5" ry="4.8" fill="#2563eb"/>
    <ellipse cx="45" cy="102" rx="3.6" ry="1.5" fill="#ffffff" opacity="0.28"/>
    <ellipse cx="71" cy="102" rx="3.6" ry="1.5" fill="#ffffff" opacity="0.28"/>

    <g class="tc-breathe">
      <path d="M60 37 C85 37 99 55 99 75 C99 95 83 105 60 105 C37 105 21 95 21 75 C21 55 35 37 60 37Z" fill="url(#${id}-body)"/>
      <ellipse cx="60" cy="90" rx="21" ry="11" fill="#ffffff" opacity="0.13"/>
      <ellipse cx="38.5" cy="55" rx="7.5" ry="4.4" fill="#ffffff" opacity="0.6" transform="rotate(-32 38.5 55)"/>

      <ellipse cx="37.5" cy="80.5" rx="5.8" ry="3.5" fill="#fb7185" opacity="0.5"/>
      <ellipse cx="82.5" cy="80.5" rx="5.8" ry="3.5" fill="#fb7185" opacity="0.5"/>

      <g class="tc-arm tc-arm-l">
        <path d="M27 78 C21 78 17.5 84 18.5 89.5 C19.3 93.5 24 94.5 26.8 91.5 C29.2 88.8 30.5 83 29.6 79.5 C29.3 78.5 28.3 78 27 78Z" fill="#4f8ff7"/>
        <ellipse cx="22" cy="87.5" rx="1.6" ry="2.6" fill="#ffffff" opacity="0.35"/>
      </g>
      <g class="tc-arm tc-arm-r">
        <path d="M93 78 C99 78 102.5 84 101.5 89.5 C100.7 93.5 96 94.5 93.2 91.5 C90.8 88.8 89.5 83 90.4 79.5 C90.7 78.5 91.7 78 93 78Z" fill="#4f8ff7"/>
        <ellipse cx="98" cy="87.5" rx="1.6" ry="2.6" fill="#ffffff" opacity="0.35"/>
      </g>

      <g class="tc-eyes-open">
        <g class="tc-pupils">
          <ellipse cx="47" cy="70.5" rx="5.4" ry="6.6" fill="#0f172a"/>
          <ellipse cx="73" cy="70.5" rx="5.4" ry="6.6" fill="#0f172a"/>
          <circle cx="49" cy="67.6" r="2" fill="#fff"/>
          <circle cx="75" cy="67.6" r="2" fill="#fff"/>
          <circle cx="45.4" cy="73.2" r="0.95" fill="#fff"/>
          <circle cx="71.4" cy="73.2" r="0.95" fill="#fff"/>
        </g>
      </g>
      <g class="tc-eyes-closed" fill="none" stroke="#0f172a" stroke-width="2.5" stroke-linecap="round">
        <path d="M41.5 71.5 Q47 76 52.5 71.5"/>
        <path d="M67.5 71.5 Q73 76 78.5 71.5"/>
      </g>
      <g class="tc-eyes-happy" fill="none" stroke="#0f172a" stroke-width="2.6" stroke-linecap="round">
        <path d="M41.5 73 Q47 66 52.5 73"/>
        <path d="M67.5 73 Q73 66 78.5 73"/>
      </g>

      <path class="tc-mouth-smile" d="M55.5 80.5 Q60 85 64.5 80.5" fill="none" stroke="#0f172a" stroke-width="2.3" stroke-linecap="round"/>
      <ellipse class="tc-mouth-o" cx="60" cy="83" rx="2.3" ry="2.7" fill="#0f172a" opacity="0.85"/>
      <g class="tc-bubble">
        <circle cx="68.5" cy="78.5" r="5" fill="#e0f2fe" fill-opacity="0.55" stroke="#ffffff" stroke-width="1.1"/>
        <circle cx="66.8" cy="76.6" r="1.3" fill="#ffffff"/>
      </g>
      <path class="tc-mouth-focus" d="M56.5 82 Q60 83.6 63.5 82" fill="none" stroke="#0f172a" stroke-width="2.2" stroke-linecap="round"/>
      <g class="tc-mouth-grin">
        <path d="M53.5 79.5 Q60 90 66.5 79.5Z" fill="#0f172a"/>
        <ellipse cx="60" cy="85.2" rx="3.4" ry="1.9" fill="#fb7185"/>
      </g>

      <g class="tc-hat">
        <path d="M32 39 C28 27 43 18.5 60 18.5 C78 18.5 92 26 88 39Z" fill="url(#${id}-hat)"/>
        <rect x="33" y="34.5" width="54" height="7.5" rx="3.75" fill="#f8fafc"/>
        <path d="M37 41.5 C49 46.5 71 46.5 83 41.5 C81 47.5 71 51 60 51 C49 51 39 47.5 37 41.5Z" fill="#0f172a"/>
        <path d="M40 42.6 Q60 48.2 80 42.6" fill="none" stroke="#fbbf24" stroke-width="1.3" stroke-linecap="round"/>
        <circle cx="60" cy="27.5" r="5.6" fill="#fbbf24"/>
        <rect x="56.6" y="24" width="6.8" height="2.1" rx="1" fill="#1e293b"/>
        <rect x="58.95" y="24" width="2.1" height="7.6" rx="1" fill="#1e293b"/>
      </g>
    </g>
  </g>

  <g class="tc-zzz" font-family="ui-rounded, 'Arial Rounded MT Bold', system-ui, sans-serif" font-weight="800"
     fill="#3b82f6" stroke="#ffffff" stroke-width="2.4" paint-order="stroke" stroke-linejoin="round">
    <text class="tc-z tc-z1" x="70" y="62" font-size="11">z</text>
    <text class="tc-z tc-z2" x="80" y="48" font-size="14">z</text>
    <text class="tc-z tc-z3" x="92" y="32" font-size="18">Z</text>
  </g>

  <g class="tc-dots">
    <rect x="84" y="8" width="32" height="17" rx="8.5" fill="#ffffff" stroke="#bfdbfe" stroke-width="1.4"/>
    <circle class="tc-dot tc-d1" cx="92.5" cy="16.5" r="2.6" fill="#3b82f6"/>
    <circle class="tc-dot tc-d2" cx="100" cy="16.5" r="2.6" fill="#3b82f6"/>
    <circle class="tc-dot tc-d3" cx="107.5" cy="16.5" r="2.6" fill="#3b82f6"/>
  </g>

  <g class="tc-sparkles" fill="#fbbf24">
    <path class="tc-spark tc-s1" d="M14 30 l2.4 6 6 2.4 -6 2.4 -2.4 6 -2.4 -6 -6 -2.4 6 -2.4Z"/>
    <path class="tc-spark tc-s2" d="M102 18 l1.8 4.5 4.5 1.8 -4.5 1.8 -1.8 4.5 -1.8 -4.5 -4.5 -1.8 4.5 -1.8Z"/>
    <path class="tc-spark tc-s3" d="M106 56 l1.4 3.4 3.4 1.4 -3.4 1.4 -1.4 3.4 -1.4 -3.4 -3.4 -1.4 3.4 -1.4Z"/>
  </g>
</svg>`;
  }

  // Which parts each mood shows. Everything else in the SVG is hidden for that mood.
  const PARTS = {
    sleeping: ["tc-eyes-closed", "tc-mouth-o", "tc-zzz", "tc-bubble"],
    awake: ["tc-eyes-open", "tc-mouth-smile"],
    working: ["tc-eyes-open", "tc-mouth-focus", "tc-dots"],
    happy: ["tc-eyes-happy", "tc-mouth-grin", "tc-sparkles"],
  };
  const TOGGLED = [...new Set(Object.values(PARTS).flat())];

  const visibility = Object.entries(PARTS)
    .map(([state, show]) =>
      TOGGLED.filter((part) => !show.includes(part))
        .map((part) => `.tc-captain[data-state="${state}"] .${part}`)
        .join(",\n") + " { display: none; }",
    )
    .join("\n");

  const css = `
.tc-captain { display: block; overflow: visible; }
.tc-breathe, .tc-bob, .tc-hat, .tc-tail, .tc-arm, .tc-pupils, .tc-bubble, .tc-heart, .tc-z, .tc-dot, .tc-spark, .tc-shadow { transform-box: fill-box; }
.tc-arm-l { transform-origin: 85% 15%; }
.tc-arm-r { transform-origin: 15% 15%; }
${visibility}

/* sleeping: slow breath, hat slips over one eye, z's drift up */
.tc-captain[data-state="sleeping"] .tc-breathe { transform-origin: 50% 100%; animation: tc-breathe 3.2s ease-in-out infinite; }
.tc-captain[data-state="sleeping"] .tc-hat { transform-origin: 50% 100%; transform: rotate(9deg) translate(1px, 2.5px); transition: transform .5s; }
.tc-captain[data-state="sleeping"] .tc-tail { transform-origin: 0% 50%; animation: tc-sway 4s ease-in-out infinite; }
.tc-bubble { transform-origin: 0% 100%; animation: tc-bubble 3.2s ease-in-out infinite; }
.tc-z { opacity: 0; animation: tc-float 3.6s ease-in infinite; }
.tc-z2 { animation-delay: 1.2s; }
.tc-z3 { animation-delay: 2.4s; }

/* awake: a hello wave */
.tc-captain[data-state="awake"] .tc-arm-r { animation: tc-wave 1.6s ease-in-out 2; }
.tc-captain[data-state="awake"] .tc-heart { transform-origin: 50% 50%; animation: tc-beat 1.2s ease-in-out infinite; }
.tc-captain[data-state="awake"] .tc-hat { transform-origin: 50% 100%; transform: rotate(-6deg); transition: transform .35s; }
.tc-captain[data-state="awake"] .tc-tail { transform-origin: 0% 50%; animation: tc-sway 1.6s ease-in-out infinite; }

/* working: bouncing, eyes darting, typing dots */
.tc-captain[data-state="working"] .tc-bob { animation: tc-bob .9s ease-in-out infinite; }
.tc-captain[data-state="working"] .tc-pupils { animation: tc-look 2.4s ease-in-out infinite; }
.tc-captain[data-state="working"] .tc-tail { transform-origin: 0% 50%; animation: tc-sway .7s ease-in-out infinite; }
.tc-captain[data-state="working"] .tc-hat { transform-origin: 50% 100%; transform: rotate(-4deg); }
.tc-captain[data-state="working"] .tc-arm-l { animation: tc-type-l .45s ease-in-out infinite; }
.tc-captain[data-state="working"] .tc-arm-r { animation: tc-type-r .45s ease-in-out infinite .22s; }
.tc-dot { animation: tc-dot 1s ease-in-out infinite; }
.tc-d2 { animation-delay: .15s; }
.tc-d3 { animation-delay: .3s; }

/* happy: a little hop and twinkles */
.tc-captain[data-state="happy"] .tc-bob { animation: tc-hop .55s cubic-bezier(.3,1.6,.6,1) 2; }
.tc-captain[data-state="happy"] .tc-hat { transform-origin: 50% 100%; transform: rotate(-8deg) translateY(-2px); transition: transform .3s; }
.tc-captain[data-state="happy"] .tc-arm-l { transform: translate(-4px, -4px) rotate(100deg); transition: transform .25s cubic-bezier(.3,1.6,.6,1); }
.tc-captain[data-state="happy"] .tc-arm-r { transform: translate(4px, -4px) rotate(-100deg); transition: transform .25s cubic-bezier(.3,1.6,.6,1); }
.tc-captain[data-state="happy"] .tc-shadow { transform-origin: 50% 50%; animation: tc-squash .55s cubic-bezier(.3,1.6,.6,1) 2; }
.tc-captain[data-state="happy"] .tc-heart { transform-origin: 50% 50%; animation: tc-beat .6s ease-in-out infinite; }
.tc-spark { transform-origin: 50% 50%; animation: tc-twinkle 1.4s ease-in-out infinite; }
.tc-s2 { animation-delay: .35s; }
.tc-s3 { animation-delay: .7s; }

@keyframes tc-breathe { 0%,100% { transform: scale(1, 1); } 50% { transform: scale(1.035, .965); } }
@keyframes tc-float {
  0% { opacity: 0; transform: translate(0, 6px) scale(.6); }
  25% { opacity: 1; }
  100% { opacity: 0; transform: translate(10px, -14px) scale(1.1); }
}
@keyframes tc-sway { 0%,100% { transform: rotate(0deg); } 50% { transform: rotate(7deg); } }
@keyframes tc-wave {
  0%,100% { transform: rotate(0deg); }
  20% { transform: translate(5px, -4px) rotate(-104deg); }
  40% { transform: translate(5px, -4px) rotate(-70deg); }
  60% { transform: translate(5px, -4px) rotate(-104deg); }
  80% { transform: translate(5px, -4px) rotate(-70deg); }
}
@keyframes tc-type-l { 0%,100% { transform: rotate(0deg); } 50% { transform: rotate(-14deg); } }
@keyframes tc-type-r { 0%,100% { transform: rotate(0deg); } 50% { transform: rotate(14deg); } }
@keyframes tc-bubble { 0%,100% { transform: scale(.35); opacity: .6; } 50% { transform: scale(1.12); opacity: 1; } }
@keyframes tc-beat { 0%,100% { transform: scale(1); } 30% { transform: scale(1.3); } 55% { transform: scale(.95); } }
@keyframes tc-squash { 0%,100% { transform: scale(1); } 45% { transform: scale(.7); opacity: .1; } }
@keyframes tc-bob { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
@keyframes tc-look { 0%,100% { transform: translateX(0); } 25% { transform: translateX(-2.2px); } 65% { transform: translateX(2.2px); } }
@keyframes tc-dot { 0%,100% { transform: translateY(0); opacity: .45; } 40% { transform: translateY(-3px); opacity: 1; } }
@keyframes tc-hop { 0%,100% { transform: translateY(0); } 45% { transform: translateY(-9px); } }
@keyframes tc-twinkle { 0%,100% { transform: scale(.4) rotate(0deg); opacity: .2; } 50% { transform: scale(1.1) rotate(25deg); opacity: 1; } }

@media (prefers-reduced-motion: reduce) {
  .tc-captain *, .tc-captain { animation: none !important; transition: none !important; }
  .tc-z { opacity: .9; }
}
`;

  globalThis.ThreadCaptainArt = { svg, css };
})();
