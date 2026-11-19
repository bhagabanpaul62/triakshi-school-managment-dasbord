"use client";

import { motion, useReducedMotion, useTransform, type MotionValue } from "framer-motion";
import { EASE } from "./motion";

// A flat, hand-drawn Indian school on a 1200 x 640 stage. The middle 600 (x 300-900) holds the tower, the
// main block, the flag and the bus, so a narrow phone crop still reads; wings, trees and gate fill the rest.

const C = {
  sky: "#e6efe8", sun: "#e8a317", sunRing: "#f6e8c3", cloud: "#ffffff",
  hillFar: "#d5e4d5", hillNear: "#c2d7c4", lawn: "#d2e3ca",
  wall: "#f4e7c9", wallFront: "#f9efd8", shade: "#e4d0a2", green: "#22403a", green2: "#2e544b",
  glass: "#c9dcd7", lit: "#ffd978", ink: "#15181a",
  leafDark: "#2f5d46", leaf: "#3f7457", leafLight: "#5c8f6e", trunk: "#7a5a3a",
  path: "#e6e2d4", kerb: "#cfc9b6", road: "#b7c1bb", pole: "#59615b",
};

const WING_L = [200, 246, 292, 338, 384, 430];
const WING_R = [744, 790, 836, 882, 928, 974];
const MAIN = [494, 536, 638, 680];
// Upper windows in reading order, so they light up left to right.
const WINDOWS: [number, number][] = [
  ...WING_L.map((x) => [x, 330] as [number, number]),
  ...MAIN.map((x) => [x, 288] as [number, number]),
  ...MAIN.map((x) => [x, 344] as [number, number]),
  ...WING_R.map((x) => [x, 330] as [number, number]),
];
const UNLIT = new Set([2, 9, 14, 19]);
const ARCHES = [...WING_L, 496, 674, ...WING_R].map((x) => (x === 496 || x === 674 ? x : x - 2));

const arch = (x: number, top: number, w: number, bottom: number) => `M${x} ${bottom}V${top + w / 2}a${w / 2} ${w / 2} 0 0 1 ${w} 0V${bottom}Z`;
// One band of the flag; `k` flips the wave.
const band = (y: number, h: number, k: number) => `M382 ${y}C408 ${y - 6 * k} 434 ${y + 6 * k} 460 ${y}L460 ${y + h}C434 ${y + h + 6 * k} 408 ${y + h - 6 * k} 382 ${y + h}Z`;

function Cloud({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`} fill={C.cloud}>
      <rect x="0" y="18" width="120" height="26" rx="13" /><circle cx="42" cy="18" r="20" /><circle cx="72" cy="14" r="24" />
    </g>
  );
}

function Neem({ x }: { x: number }) {
  return (
    <g>
      <path d={`M${x - 5} 500 L${x - 3} 400 Q${x - 18} 380 ${x - 30} 372 M${x + 3} 420 Q${x + 18} 392 ${x + 26} 380`} stroke={C.trunk} strokeWidth="9" fill="none" strokeLinecap="round" />
      <rect x={x - 6} y="398" width="12" height="104" rx="4" fill={C.trunk} />
      <circle cx={x - 34} cy="372" r="42" fill={C.leafDark} /><circle cx={x + 30} cy="368" r="46" fill={C.leafDark} />
      <circle cx={x} cy="336" r="52" fill={C.leaf} /><circle cx={x - 40} cy="350" r="30" fill={C.leaf} />
      <circle cx={x + 16} cy="318" r="30" fill={C.leafLight} /><circle cx={x - 22} cy="330" r="18" fill={C.leafLight} />
    </g>
  );
}

function Ashoka({ x }: { x: number }) {
  return (
    <g>
      <rect x={x - 3} y="470" width="6" height="32" fill={C.trunk} />
      <ellipse cx={x} cy="392" rx="20" ry="92" fill={C.leafDark} />
      <ellipse cx={x - 4} cy="384" rx="10" ry="74" fill={C.leaf} />
    </g>
  );
}

/** `progress` is the hero's scroll progress (0 at the top, 1 once it has scrolled away). */
export function SchoolIllustration({ className = "", progress }: { className?: string; progress: MotionValue<number> }) {
  const reduce = useReducedMotion();
  const still = !!reduce;
  // Gentle depth on scroll: the sky drifts, the far layers lag, the front stays put.
  const yClouds = useTransform(progress, [0, 1], [0, 70]);
  const yHills = useTransform(progress, [0, 1], [0, 34]);
  const ySun = useTransform(progress, [0, 1], [0, 90]);
  const par = (v: MotionValue<number>) => (still ? undefined : { y: v });

  return (
    <svg viewBox="0 -90 1200 730" role="img" aria-labelledby="school-art-title school-art-desc" className={className} preserveAspectRatio="xMidYMid slice">
      <title id="school-art-title">A school building with a clock tower</title>
      <desc id="school-art-desc">A two-storey school with arched verandahs, a clock tower with a bell, the Indian flag in front, a gate in the boundary wall, neem and ashoka trees, and a yellow school bus on the road.</desc>
      <rect y="-90" width="1200" height="730" fill={C.sky} />

      {/* sun and sky */}
      <motion.g style={par(ySun)}>
        <circle cx="812" cy="150" r="58" fill={C.sunRing} />
        <motion.circle cx="812" cy="150" r="36" fill={C.sun} initial={still ? false : { scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.6, delay: 0.2, ease: EASE }} style={{ transformBox: "fill-box", transformOrigin: "center" }} />
      </motion.g>
      <motion.g style={par(yClouds)}>
        <motion.g animate={still ? undefined : { x: [0, 34, 0] }} transition={{ duration: 26, repeat: Infinity, ease: "easeInOut" }}>
          <Cloud x={196} y={150} s={0.9} /><Cloud x={880} y={190} s={0.75} />
        </motion.g>
        <motion.g animate={still ? undefined : { x: [0, -28, 0] }} transition={{ duration: 32, repeat: Infinity, ease: "easeInOut" }}>
          <Cloud x={420} y={70} s={0.6} /><Cloud x={1010} y={60} s={0.85} />
        </motion.g>
        {/* birds */}
        <motion.g fill="none" stroke={C.green} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
          animate={still ? undefined : { x: [0, 70], y: [0, -14] }} transition={{ duration: 16, repeat: Infinity, repeatType: "mirror", ease: "easeInOut" }}>
          <path d="M470 168 q8 -8 16 0 q8 -8 16 0" /><path d="M510 150 q6 -6 12 0 q6 -6 12 0" /><path d="M448 140 q5 -5 10 0 q5 -5 10 0" />
        </motion.g>
      </motion.g>

      {/* distant hills and tree line */}
      <motion.g style={par(yHills)}>
        <path d="M0 404C140 360 260 384 380 392S620 356 780 380 1060 352 1200 386V520H0Z" fill={C.hillFar} />
        {[0, 52, 98, 150, 1040, 1092, 1140, 1190].map((x, i) => <circle key={x} cx={x} cy={440 - (i % 3) * 10} r={34 + (i % 2) * 10} fill={C.hillNear} />)}
      </motion.g>

      {/* campus lawn */}
      <rect y="470" width="1200" height="70" fill={C.lawn} />
      <Neem x={96} /><Neem x={1104} />

      {/* clock tower, behind the main block */}
      <g>
        <rect x="566" y="64" width="68" height="180" fill={C.wall} />
        <rect x="560" y="56" width="80" height="10" rx="2" fill={C.green} />
        <polygon points="566,57 600,20 634,57" fill={C.green} />
        <line x1="600" y1="22" x2="600" y2="4" stroke={C.green} strokeWidth="3" /><circle cx="600" cy="6" r="4.5" fill={C.sun} />
        <path d={arch(582, 72, 36, 108)} fill={C.green2} />
        <motion.g style={{ originX: 0.5, originY: 0 }} animate={still ? undefined : { rotate: [-9, 9, -9] }} transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}>
          <line x1="600" y1="74" x2="600" y2="82" stroke={C.sun} strokeWidth="2" />
          <path d="M589 100Q589 83 600 81Q611 83 611 100L614 104H586Z" fill={C.sun} />
          <circle cx="600" cy="106" r="2.6" fill={C.sun} />
        </motion.g>
        <rect x="560" y="108" width="80" height="8" rx="2" fill={C.green} />
        <circle cx="600" cy="172" r="27" fill="#fff" stroke={C.green} strokeWidth="5" />
        {Array.from({ length: 12 }, (_, i) => <line key={i} x1="600" y1="150" x2="600" y2={i % 3 ? 153 : 155} stroke={C.ink} strokeWidth={i % 3 ? 1.4 : 2.2} transform={`rotate(${i * 30} 600 172)`} />)}
        <line x1="600" y1="172" x2="588" y2="167" stroke={C.ink} strokeWidth="3" strokeLinecap="round" />
        <motion.line x1="600" y1="172" x2="600" y2="154" stroke={C.ink} strokeWidth="2.2" strokeLinecap="round"
          style={{ originX: 0.5, originY: 1 }} initial={{ rotate: -60 }} animate={still ? undefined : { rotate: 300 }} transition={{ duration: 90, repeat: Infinity, ease: "linear" }} />
        <circle cx="600" cy="172" r="2.6" fill={C.ink} />
      </g>

      {/* wings */}
      {[180, 725].map((x) => (
        <g key={x}>
          <rect x={x} y="300" width="295" height="192" fill={C.wall} />
          <rect x={x - 6} y="292" width="307" height="9" rx="2" fill={C.green} />
          <rect x={x} y="398" width="295" height="8" fill={C.shade} />
          <rect x={x} y="486" width="295" height="6" fill={C.shade} />
        </g>
      ))}

      {/* main block */}
      <rect x="470" y="236" width="260" height="256" fill={C.wallFront} />
      <rect x="462" y="228" width="276" height="9" rx="2" fill={C.green} />
      <polygon points="520,229 600,190 680,229" fill={C.wallFront} stroke={C.green} strokeWidth="6" strokeLinejoin="round" />
      <circle cx="600" cy="214" r="7" fill={C.sun} />
      <rect x="470" y="398" width="260" height="8" fill={C.shade} />
      <rect x="488" y="245" width="224" height="27" rx="4" fill={C.green} />
      <text x="600" y="263.5" textAnchor="middle" fontSize="11.5" fontWeight="700" letterSpacing="1.3" fill={C.wall} style={{ fontFamily: "var(--font-inter), system-ui, sans-serif" }}>SUNRISE PUBLIC SCHOOL</text>

      {/* sunshades over every upper window */}
      {WINDOWS.map(([x, y]) => <rect key={`s${x}-${y}`} x={x - 5} y={y - 8} width="36" height="5" rx="1.5" fill={C.green} />)}
      {/* arched window above the porch */}
      <path d={arch(587, 282, 26, 326)} fill={C.lit} stroke={C.green} strokeWidth="2.5" />

      {/* ground-floor verandah arches */}
      {ARCHES.map((x) => <path key={`a${x}`} d={arch(x, 424, 30, 486)} fill={C.green2} />)}

      {/* porch: pediment, slab, columns, door, steps */}
      <polygon points="556,392 600,366 644,392" fill={C.wallFront} stroke={C.green} strokeWidth="5" strokeLinejoin="round" />
      <rect x="550" y="390" width="100" height="10" rx="2" fill={C.green} />
      <path d={arch(584, 430, 32, 492)} fill={C.green} />
      <line x1="600" y1="446" x2="600" y2="492" stroke={C.green2} strokeWidth="2" />
      {[558, 578, 614, 634].map((x) => <rect key={x} x={x} y="400" width="8" height="88" fill="#fff8e6" />)}
      <rect x="548" y="486" width="104" height="7" rx="2" fill={C.shade} />

      {/* windows light up as the school wakes */}
      {WINDOWS.map(([x, y], i) => (
        <motion.rect key={`w${x}-${y}`} x={x} y={y} width="26" height="40" rx="4" stroke={C.green} strokeWidth="2.5"
          initial={still ? false : { fill: C.glass }} animate={{ fill: UNLIT.has(i) ? C.glass : C.lit }}
          transition={{ duration: 0.4, delay: 0.9 + i * 0.06, ease: "easeOut" }} />
      ))}
      {WINDOWS.map(([x, y]) => <line key={`m${x}-${y}`} x1={x + 13} y1={y + 2} x2={x + 13} y2={y + 38} stroke={C.green} strokeWidth="1.6" opacity="0.55" />)}

      {/* ashoka trees at the ends of the wings */}
      <Ashoka x={176} /><Ashoka x={1024} />

      {/* flag on its platform */}
      <g>
        <rect x="362" y="484" width="40" height="10" rx="2" fill={C.shade} /><rect x="368" y="476" width="28" height="9" rx="2" fill={C.wall} />
        <line x1="382" y1="204" x2="382" y2="478" stroke={C.pole} strokeWidth="4" strokeLinecap="round" />
        <circle cx="382" cy="200" r="5" fill={C.sun} />
        {([["#ff9933", 0], ["#ffffff", 1], ["#138808", 2]] as const).map(([fill, i]) => (
          <motion.path key={fill} fill={fill} d={band(210 + i * 17, 17, 1)}
            animate={still ? undefined : { d: [band(210 + i * 17, 17, 1), band(210 + i * 17, 17, -1), band(210 + i * 17, 17, 1)] }}
            transition={{ duration: 2.8, repeat: Infinity, ease: "easeInOut" }} />
        ))}
        <circle cx="421" cy="235.5" r="6.5" fill="none" stroke="#1f3a93" strokeWidth="1.4" />
        {Array.from({ length: 12 }, (_, i) => <line key={i} x1="421" y1="229.5" x2="421" y2="241.5" stroke="#1f3a93" strokeWidth="0.7" transform={`rotate(${i * 15} 421 235.5)`} />)}
      </g>

      {/* hedge with marigolds, inside the wall */}
      {Array.from({ length: 56 }, (_, i) => i * 22 + 4).filter((x) => x < 540 || x > 660).map((x, i) => (
        <g key={x}>
          <circle cx={x} cy={502} r={14} fill={i % 2 ? C.leaf : C.leafDark} />
          {i % 3 === 0 ? <circle cx={x - 4} cy={494} r={3.4} fill={i % 2 ? "#f08a24" : C.sun} /> : null}
          {i % 4 === 1 ? <circle cx={x + 5} cy={497} r={3} fill={C.sun} /> : null}
        </g>
      ))}

      {/* path to the door, boundary wall and the gate */}
      <rect x="560" y="493" width="80" height="40" fill={C.path} />
      {([[0, 548], [652, 1200]] as const).map(([a, b]) => (
        <g key={a}>
          <rect x={a} y="506" width={b - a} height="27" fill={C.wall} />
          <rect x={a} y="500" width={b - a} height="7" fill={C.green} />
          {Array.from({ length: Math.floor((b - a) / 26) }, (_, i) => a + 10 + i * 26).map((x) => <rect key={x} x={x} y="513" width="14" height="12" rx="2" fill={C.shade} />)}
        </g>
      ))}
      {[530, 652].map((x) => (
        <g key={x}>
          <rect x={x} y="462" width="20" height="71" fill={C.wallFront} />
          <rect x={x - 3} y="454" width="26" height="9" rx="2" fill={C.green} />        </g>
      ))}
      {/* the two gate leaves, swung open */}
      <g stroke={C.green} strokeWidth="2.2" fill="none">
        <path d="M550 476 L572 484 V528 L550 532 Z" />{[556, 562, 568].map((x) => <line key={x} x1={x} y1={478 + (x - 550) * 0.36} x2={x} y2={531 - (x - 550) * 0.18} />)}
        <path d="M652 476 L630 484 V528 L652 532 Z" />{[634, 640, 646].map((x) => <line key={x} x1={x} y1={478 + (652 - x) * 0.36} x2={x} y2={531 - (652 - x) * 0.18} />)}
      </g>

      {/* footpath and road */}
      <rect y="533" width="1200" height="20" fill={C.path} />
      <rect y="552" width="1200" height="5" fill={C.kerb} />
      <rect y="557" width="1200" height="83" fill={C.road} />
      {Array.from({ length: 13 }, (_, i) => i * 96 - 20).map((x) => <rect key={x} x={x} y="604" width="50" height="5" rx="2.5" fill="#fff" opacity="0.9" />)}

      {/* the school bus drives in and parks */}
      <motion.g initial={still ? false : { x: -980 }} animate={{ x: 0 }} transition={{ duration: 2.2, delay: 0.8, ease: [0.16, 1, 0.3, 1] }}>
        <ellipse cx="446" cy="630" rx="124" ry="6" fill={C.ink} opacity="0.12" />
        <rect x="336" y="533" width="212" height="7" rx="3" fill="#c98b0c" />
        <rect x="330" y="538" width="232" height="74" rx="12" fill={C.sun} />
        {[344, 374, 404, 434, 464].map((x) => <rect key={x} x={x} y="550" width="24" height="24" rx="3" fill={C.glass} />)}
        <rect x="498" y="550" width="24" height="56" rx="3" fill={C.green2} /><rect x="501" y="553" width="18" height="22" rx="2" fill={C.glass} /><rect x="501" y="579" width="18" height="22" rx="2" fill={C.glass} />
        <path d="M530 550H552Q558 550 558 558V586H530Z" fill={C.glass} />
        <rect x="330" y="584" width="166" height="7" fill={C.green} /><rect x="524" y="590" width="38" height="5" fill={C.green} />
        <text x="446" y="604" textAnchor="middle" fontSize="10" fontWeight="800" letterSpacing="1.1" fill={C.ink} style={{ fontFamily: "var(--font-inter), system-ui, sans-serif" }}>SCHOOL BUS</text>
        <circle cx="557" cy="600" r="3.5" fill="#fff6d8" /><rect x="330" y="592" width="4" height="9" rx="1" fill="#d9573f" />
        <rect x="548" y="606" width="20" height="7" rx="2" fill={C.pole} /><rect x="324" y="606" width="14" height="7" rx="2" fill={C.pole} />
        <line x1="560" y1="556" x2="568" y2="550" stroke={C.ink} strokeWidth="2.5" strokeLinecap="round" />
        {[380, 512].map((cx) => (
          <g key={cx}>
            <circle cx={cx} cy="612" r="19" fill="#b58008" />
            <circle cx={cx} cy="614" r="16" fill={C.ink} />
            <motion.g style={{ transformBox: "fill-box", transformOrigin: "center" }} initial={still ? false : { rotate: 0 }} animate={{ rotate: still ? 0 : 900 }} transition={{ duration: 2.2, delay: 0.8, ease: [0.16, 1, 0.3, 1] }}>
              <circle cx={cx} cy="614" r="7.5" fill="#cdd3ca" />
              {[0, 72, 144, 216, 288].map((a) => <circle key={a} cx={cx} cy="609.5" r="1.4" fill={C.pole} transform={`rotate(${a} ${cx} 614)`} />)}
            </motion.g>
          </g>
        ))}
      </motion.g>
    </svg>
  );
}
