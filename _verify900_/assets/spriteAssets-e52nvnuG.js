import{cL as d,cM as t}from"./index-C8u1oDXN.js";const l="/assets/half-timber-house-iHHbLLRQ.png",i="/assets/house-CWwRYMj5.png",s=`.world-shell {
  display: grid;
  gap: 0;
  grid-template-columns: minmax(0, 1fr);
  min-height: 0;
  overflow: hidden;
  padding: 3px;
}

.toolbar-button,
.chat-tab,
.action-button,
.zoom-button {
  appearance: none;
  background: linear-gradient(180deg, #d6d1c3 0%, #9c978c 45%, #736e66 100%);
  border: 1px solid #2b2a28;
  box-shadow:
    inset 1px 1px 0 rgba(255, 255, 255, 0.45),
    inset -1px -1px 0 rgba(0, 0, 0, 0.45);
  color: #1c1b18;
  cursor: pointer;
  font: inherit;
  font-size: 0.7rem;
  min-height: 22px;
  padding: 0 6px;
}

.toolbar-button {
  min-width: 44px;
}

.zoom-button {
  min-width: 64px;
}

.zoom-button.is-active {
  background: linear-gradient(180deg, #f2dd90 0%, #d0aa47 55%, #87641f 100%);
}

.board-panel {
  min-height: 0;
  overflow: hidden;
  padding: 0;
  position: relative;
}

.board-overlay {
  display: flex;
  justify-content: space-between;
  left: 10px;
  pointer-events: none;
  position: absolute;
  right: 10px;
  top: 10px;
  z-index: 1;
}

.board-coords {
  color: #f5f0e3;
  font-size: 0.8rem;
  pointer-events: none;
  text-shadow:
    -1px -1px 0 #000,
    1px -1px 0 #000,
    -1px 1px 0 #000,
    1px 1px 0 #000;
}

/*
 * The current region's name, centered along the top edge of the board in the
 * same white-with-black-outline style as .board-coords. Absolutely positioned so
 * it does not disturb the coords/zoom space-between row; the overlay's symmetric
 * 10px insets make its horizontal center the board's center.
 */
.board-region {
  color: #f5f0e3;
  font-size: 0.8rem;
  left: 50%;
  pointer-events: none;
  position: absolute;
  text-shadow:
    -1px -1px 0 #000,
    1px -1px 0 #000,
    -1px 1px 0 #000,
    1px 1px 0 #000;
  top: 0;
  transform: translateX(-50%);
  white-space: nowrap;
}

.board-region-pvp {
  color: #ffd6d6;
}

.board-controls,
.zoom-controls {
  display: flex;
  gap: 6px;
  pointer-events: auto;
}

.board-controls {
  flex-wrap: wrap;
}

.board-panel {
  min-height: 0;
  overflow: hidden;
}

.board {
  background: #09966b;
  cursor: crosshair;
  display: block;
  height: 100%;
  max-height: 100%;
  overflow: hidden;
  width: 100%;
}

.board.board-editor {
  cursor: grab;
}

.board-void {
  fill: #0a815f;
}

.board-void-underground {
  fill: #050505;
}

.board-bg {
  fill: #0f9567;
}

.board-bg-underground {
  fill: #101010;
}

.board-ground-tile {
  fill: #0f9567;
  stroke: rgba(5, 78, 56, 0.18);
  stroke-width: 0.04;
}

.board-ground-tile-underground {
  fill: #121212;
  stroke: rgba(255, 255, 255, 0.03);
  stroke-width: 0.04;
}

.board-sand {
  fill: #b9a55a;
}

/* Ground tile base classes */
.board-ground-base {
  fill: #8b7a49;
}

.board-ground-splotch {
  fill: rgba(55, 40, 12, 0.12);
}

/* ground-dirt: worn dirt road */
.board-ground-type-ground-dirt .board-ground-base {
  fill: #8b7a49;
}
.board-ground-type-ground-dirt .board-ground-splotch {
  fill: rgba(55, 40, 12, 0.13);
}

/* ground-salt-road: packed salt road of the Wastelands */
.board-ground-type-ground-salt-road .board-ground-base {
  fill: #b0a279;
}
.board-ground-type-ground-salt-road .board-ground-splotch {
  fill: rgba(125, 116, 84, 0.16);
}

/* ground-cave: dark stone floor */
.board-ground-type-ground-cave .board-ground-base {
  fill: #4a4848;
}
.board-ground-type-ground-cave .board-ground-splotch {
  fill: rgba(0, 0, 0, 0.22);
}

/* ground-house: warm stone tile floor */
.board-ground-type-ground-house .board-ground-base {
  fill: #c8b898;
}
.board-ground-type-ground-house .board-ground-splotch {
  fill: rgba(90, 70, 40, 0.1);
}

/* ground-wood: wooden planks */
.board-ground-type-ground-wood .board-ground-base {
  fill: #9e6a36;
}
.board-ground-type-ground-wood .board-ground-splotch {
  fill: rgba(50, 25, 5, 0.18);
}

/* ground-cobble: cobblestone street */
.board-ground-type-ground-cobblestone .board-ground-base {
  fill: #74786d;
}

.ground-type-swatch-ground-cobblestone {
  background: #74786d;
}

.board-ground-type-ground-cobble .board-ground-base {
  fill: #8a8278;
}
.board-ground-type-ground-cobble .board-ground-splotch {
  fill: rgba(50, 50, 50, 0.14);
}

/* ground-sand: sandy ground */
.board-ground-type-ground-sand .board-ground-base {
  fill: #d4b86a;
}
.board-ground-type-ground-sand .board-ground-splotch {
  fill: rgba(120, 90, 20, 0.11);
}

/* ground-grass: trimmed grass path */
.board-ground-type-ground-grass .board-ground-base {
  fill: #5a8a3c;
}
.board-ground-type-ground-grass .board-ground-splotch {
  fill: rgba(25, 55, 15, 0.18);
}

/* Ground type swatches in the editor sidebar */
.ground-type-swatch {
  border-left: 4px solid transparent;
}
.ground-type-swatch-ground-dirt {
  border-left-color: #8b7a49;
}
.ground-type-swatch-ground-salt-road {
  border-left-color: #b0a279;
}
.ground-type-swatch-ground-cave {
  border-left-color: #4a4848;
}
.ground-type-swatch-ground-house {
  border-left-color: #c8b898;
}
.ground-type-swatch-ground-wood {
  border-left-color: #9e6a36;
}
.ground-type-swatch-ground-cobble {
  border-left-color: #8a8278;
}
.ground-type-swatch-ground-sand {
  border-left-color: #d4b86a;
}
.ground-type-swatch-ground-grass {
  border-left-color: #5a8a3c;
}
.ground-type-swatch-ground-water {
  border-left-color: #276485;
}
.ground-type-swatch-ground-mountain {
  border-left-color: #8a857b;
}

.board-ground-type-ground-limestone .board-ground-base {
  fill: #b2b3a3;
}
.ground-type-swatch-ground-limestone {
  border-left-color: #b2b3a3;
}
.board-ground-type-ground-brick .board-ground-base {
  fill: #8e826d;
}
.ground-type-swatch-ground-brick {
  border-left-color: #8e826d;
}
.board-ground-type-ground-slate .board-ground-base {
  fill: #424f52;
}
.ground-type-swatch-ground-slate {
  border-left-color: #424f52;
}
.board-ground-type-ground-marble .board-ground-base {
  fill: #b3b9ac;
}
.ground-type-swatch-ground-marble {
  border-left-color: #b3b9ac;
}
.board-ground-type-ground-gravel .board-ground-base {
  fill: #8e907c;
}
.ground-type-swatch-ground-gravel {
  border-left-color: #8e907c;
}
.board-ground-type-ground-forest .board-ground-base {
  fill: #59583c;
}
.ground-type-swatch-ground-forest {
  border-left-color: #59583c;
}
.board-ground-type-ground-mud .board-ground-base {
  fill: #887052;
}
.ground-type-swatch-ground-mud {
  border-left-color: #887052;
}
.board-ground-type-ground-snow .board-ground-base {
  fill: #dce7e7;
}
.ground-type-swatch-ground-snow {
  border-left-color: #dce7e7;
}
.board-ground-type-ground-wood-weathered .board-ground-base {
  fill: #626a62;
}
.ground-type-swatch-ground-wood-weathered {
  border-left-color: #626a62;
}
.board-ground-type-ground-wood-walnut .board-ground-base {
  fill: #46382e;
}
.ground-type-swatch-ground-wood-walnut {
  border-left-color: #46382e;
}

.board-object-shadow {
  fill: rgba(0, 0, 0, 0.22);
}

.board-ground-mound {
  fill: rgba(64, 110, 47, 0.42);
}

.board-root-base {
  fill: rgba(74, 53, 32, 0.52);
}

.board-house-ref-wall-left {
  fill: #efe2c4;
  stroke: #918368;
  stroke-width: 0.08;
}

.board-house-ref-wall-right {
  fill: #e6d5b2;
  stroke: #827359;
  stroke-width: 0.08;
}

.board-house-ref-base {
  fill: #cab996;
  stroke: #8a7a5e;
  stroke-width: 0.06;
}

.board-house-ref-roof-top {
  fill: #757245;
  stroke: #3f3d25;
  stroke-linejoin: round;
  stroke-width: 0.12;
}

.board-house-ref-roof-left {
  fill: #807d4b;
  stroke: #474527;
  stroke-width: 0.1;
}

.board-house-ref-roof-right {
  fill: #6a673c;
  stroke: #3a381f;
  stroke-width: 0.1;
}

.board-house-ref-trim {
  fill: none;
  stroke: rgba(90, 81, 60, 0.72);
  stroke-linecap: round;
  stroke-width: 0.07;
}

.board-house-ref-window {
  fill: #10294f;
  stroke: #07101d;
  stroke-width: 0.08;
}

.board-house-ref-window-grid {
  fill: none;
  stroke: rgba(67, 103, 156, 0.9);
  stroke-linecap: round;
  stroke-width: 0.05;
}

.board-house-ref-door {
  fill: #a9711d;
  stroke: #5f3c0f;
  stroke-width: 0.08;
}

.board-house-ref-door-plank {
  fill: none;
  stroke: rgba(96, 62, 16, 0.78);
  stroke-linecap: round;
  stroke-width: 0.05;
}

.board-house-ref-step {
  fill: #d8c7a7;
  stroke: #9a8b72;
  stroke-width: 0.05;
}

.board-door-knob {
  fill: #d8bb63;
}

.board-house-step {
  fill: #d3c4a4;
  stroke: #93856d;
  stroke-width: 0.06;
}

.board-sprite-blocker {
  fill: transparent;
  stroke: none;
}

.board-door-hotspot {
  fill: transparent;
  stroke: none;
  cursor: pointer;
}

.board-door-travel-indicator {
  pointer-events: none;
}

.board-door-travel-arrow {
  fill: none;
  stroke: #fff2a8;
  stroke-linecap: round;
  stroke-width: 0.12;
}

.board-door-travel-arrowhead {
  fill: #fff2a8;
}

.board-stone {
  fill: #aaa095;
  stroke: #6d645b;
  stroke-width: 0.12;
}

.board-weapon-rack {
  fill: #4f3521;
}

.board-hanging-weapon {
  fill: #c8c4be;
  stroke: #585650;
  stroke-linejoin: round;
  stroke-width: 0.08;
}

.board-fire {
  fill: #ff6a1d;
}

.board-object-label {
  fill: #ece7d3;
  font-family: "Trebuchet MS", "Verdana", sans-serif;
  font-size: 0.42px;
  paint-order: stroke;
  stroke: rgba(0, 0, 0, 0.75);
  stroke-width: 0.12px;
}

.sign-label {
  fill: #f2e8c8;
  font-family: "Trebuchet MS", "Verdana", sans-serif;
  font-size: 0.19px;
  font-weight: 700;
  paint-order: stroke;
  stroke: rgba(40, 20, 0, 0.75);
  stroke-width: 0.06px;
}

.board-cave-shadow {
  fill: #020202;
  stroke: #2f2f2f;
  stroke-width: 0.12;
}

.board-cave-exit-glow {
  fill: #c8a84a;
  opacity: 0.55;
}

.board-cave-exit-inner {
  fill: #1c1408;
}

.board-cave-exit-bright {
  fill: #ffe8a0;
}

.board-cave-mouth {
  fill: #070707;
}

.board-cave-rim {
  fill: #726d67;
  stroke: #4f4b46;
  stroke-width: 0.1;
}

.board-trunk,
.board-trunk-fill,
.board-post-wood,
.board-fence-post,
.board-fence-wood,
.board-wood-plank,
.board-log,
.board-cart-bed,
.board-cart-rail {
  fill: #7a5231;
}

.board-log-end {
  fill: #9c6a40;
}

.board-trunk,
.board-trunk-fill,
.board-post-wood,
.board-fence-post,
.board-fence-wood,
.board-wood-plank,
.board-cart-bed,
.board-cart-rail {
  stroke: #53341d;
  stroke-width: 0.08;
}

.board-bark-line,
.board-cart-axle,
.board-cart-shaft,
.board-stone-crack,
.board-crate-line,
.board-statue-line,
.board-wheat-stalk,
.board-willow-frond,
.board-deadwood,
.board-trunk-side-line {
  fill: none;
  stroke-linecap: round;
}

.board-trunk-side {
  fill: #654224;
  stroke: #4d2f19;
  stroke-width: 0.08;
}

.board-bark-line {
  stroke: rgba(65, 38, 20, 0.45);
  stroke-width: 0.08;
}

.board-trunk-side-line {
  stroke: rgba(73, 45, 23, 0.45);
  stroke-width: 0.08;
}

.board-canopy-dark {
  fill: #2c6d33;
}

.board-canopy-mid {
  fill: #3f8c46;
}

.board-canopy-light {
  fill: #71b664;
}

.board-pine-dark {
  fill: #1d5b34;
}

.board-pine-mid {
  fill: #2d7644;
}

.board-pine-light {
  fill: #49955a;
}

.board-walnut-dark {
  fill: #2f4f2a;
}

.board-walnut-mid {
  fill: #436b34;
}

.board-walnut-light {
  fill: #6c9748;
}

.board-shagbark-dark {
  fill: #5a6a25;
}

.board-shagbark-mid {
  fill: #7e9234;
}

.board-shagbark-light {
  fill: #aec24f;
}

.board-shagbark-bark {
  fill: #9c7449;
  stroke: #6f4f2c;
  stroke-width: 0.05;
  stroke-linejoin: round;
}

.board-willow-frond {
  stroke: #6ea95d;
  stroke-width: 0.2;
}

.board-deadwood-fill {
  fill: #6b5849;
  stroke: #403329;
  stroke-width: 0.08;
}

.board-deadwood {
  stroke: #47362a;
  stroke-width: 0.14;
}

.board-mushroom-stem {
  fill: #efe6cf;
  stroke: #a19379;
  stroke-width: 0.04;
}

.board-mushroom-cap-red {
  fill: #c84b43;
  stroke: #7d251d;
  stroke-width: 0.05;
}

.board-mushroom-cap-gold {
  fill: #c79a4c;
  stroke: #7a5622;
  stroke-width: 0.05;
}

.board-mushroom-spot {
  fill: #f5f0e3;
}

.board-stone-dark {
  fill: #86827c;
}

.board-stone-mid {
  fill: #aba7a1;
}

.board-stone-light {
  fill: #d2cfca;
}

.board-stone-crack {
  stroke: rgba(86, 84, 81, 0.8);
  stroke-width: 0.09;
}

.board-fire-glow {
  fill: rgba(255, 177, 76, 0.28);
}

.board-fire-base {
  fill: #e0481a;
}

.board-fire-outer {
  fill: #f56d22;
}

.board-fire-core {
  fill: #ffd768;
}

/* Animated fire. Each flame group flickers from its own base: transform-box
   keeps the origin on the element's bounding box, so a tongue scales and sways
   around the point where it leaves the coals. Instances stagger duration and
   delay inline so no two fires burn in step. Opacity keyframes read the
   per-instance base opacity from the --fire-o custom property. */
.board-flame {
  transform-box: fill-box;
  transform-origin: 50% 100%;
  animation: board-flame-flicker 1.8s ease-in-out infinite;
}

@keyframes board-flame-flicker {
  0%,
  100% {
    transform: scaleX(1) scaleY(1) skewX(0deg);
  }
  22% {
    transform: scaleX(0.95) scaleY(1.08) skewX(1.6deg);
  }
  41% {
    transform: scaleX(1.06) scaleY(0.91) skewX(-2deg);
  }
  62% {
    transform: scaleX(0.96) scaleY(1.11) skewX(2.4deg);
  }
  81% {
    transform: scaleX(1.04) scaleY(0.94) skewX(-1.2deg);
  }
}

.board-fire-glow-anim {
  animation: board-fire-glow-pulse 2.6s ease-in-out infinite;
}

@keyframes board-fire-glow-pulse {
  0%,
  100% {
    opacity: calc(var(--fire-o, 0.16) * 0.75);
  }
  50% {
    opacity: calc(var(--fire-o, 0.16) * 1.2);
  }
}

.board-ember {
  animation: board-ember-pulse 2.2s ease-in-out infinite;
}

@keyframes board-ember-pulse {
  0%,
  100% {
    opacity: calc(var(--fire-o, 0.8) * 0.55);
  }
  45% {
    opacity: var(--fire-o, 0.8);
  }
}

.board-smoke {
  transform-box: fill-box;
  transform-origin: 50% 100%;
  opacity: 0;
  animation: board-smoke-rise 5s linear infinite;
}

@keyframes board-smoke-rise {
  0% {
    transform: translate(0, 0) scale(0.55);
    opacity: 0;
  }
  14% {
    opacity: var(--fire-o, 0.2);
  }
  72% {
    opacity: calc(var(--fire-o, 0.2) * 0.5);
  }
  100% {
    transform: translate(var(--smoke-drift, 0.2px), var(--smoke-rise, -1.6px))
      scale(1.6);
    opacity: 0;
  }
}

.board-spark {
  opacity: 0;
  animation: board-spark-rise 2s linear infinite;
}

@keyframes board-spark-rise {
  0% {
    transform: translate(0, 0);
    opacity: 0;
  }
  10% {
    opacity: 0.9;
  }
  48% {
    opacity: 0.45;
  }
  70% {
    opacity: 0.8;
  }
  100% {
    transform: translate(var(--spark-drift, 0.1px), var(--spark-rise, -1.3px));
    opacity: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .board-flame,
  .board-fire-glow-anim,
  .board-ember,
  .board-smoke,
  .board-spark {
    animation: none;
  }

  .board-smoke,
  .board-spark {
    opacity: 0.18;
  }
}

.board-water {
  fill: #68c9e5;
}

.board-water-deep {
  fill: #2f8db2;
}

.board-water-foam {
  fill: rgba(236, 250, 255, 0.92);
}

.board-crate {
  fill: #956631;
  stroke: #553615;
  stroke-width: 0.08;
}

.board-crate-line {
  stroke: rgba(78, 47, 19, 0.75);
  stroke-width: 0.08;
}

.board-wheel {
  fill: #4f3727;
  stroke: #2c1b10;
  stroke-width: 0.08;
}

.board-wheel-hub {
  fill: #aa7c40;
}

.board-metal-dark {
  fill: #4e4d4a;
}

.board-lantern {
  fill: #79592d;
  stroke: #3e2c15;
  stroke-width: 0.07;
}

.board-lamp-glow {
  fill: rgba(250, 226, 126, 0.7);
}

.board-cart-shaft {
  stroke: #5a3b21;
  stroke-width: 0.1;
}

.board-cart-axle {
  stroke: #4a2f1a;
  stroke-width: 0.12;
}

.board-fence-wood {
  fill: #8b6139;
}

.board-wheat-stalk {
  stroke: #8db55d;
  stroke-width: 0.1;
}

.board-wheat-head {
  fill: #dcb85b;
  stroke: #9a7a32;
  stroke-width: 0.04;
}

.board-fabric-red {
  fill: #ac3e38;
  stroke: #69231f;
  stroke-width: 0.08;
}

.board-fabric-cream {
  fill: rgba(243, 229, 191, 0.9);
}

.board-statue {
  fill: #c9c6c0;
  stroke: #83807a;
  stroke-width: 0.08;
}

.board-statue-line {
  stroke: #8c8882;
  stroke-width: 0.11;
}

.board-pond-edge {
  fill: #6da06a;
}

.board-pond-ripple {
  fill: none;
  stroke: rgba(195, 239, 252, 0.62);
  stroke-width: 0.08;
}

.board-lily-pad {
  fill: #7fb356;
  stroke: #4e7a33;
  stroke-width: 0.05;
}

.grid-line {
  fill: none;
  stroke: rgba(255, 255, 255, 0.07);
  stroke-width: 0.03;
}

.grid-line-underground {
  fill: none;
  stroke: rgba(255, 255, 255, 0.04);
  stroke-width: 0.03;
}

.board-object-hit {
  cursor: grab;
}

.target-marker {
  fill: rgba(240, 215, 99, 0.72);
  stroke: #fff2ad;
  stroke-width: 0.06;
}

.health-track {
  fill: rgba(0, 0, 0, 0.55);
}

.health-fill {
  fill: #d92d24;
}

.player-shadow {
  fill: rgba(0, 0, 0, 0.24);
}

.player-leg {
  fill: #5b4634;
}

.player-self-body {
  fill: #f0d355;
}

.player-self-shoulders {
  fill: #d0ae30;
}

.player-self-head {
  fill: #f3d9bd;
}

.player-other-body {
  fill: #7a5533;
}

.player-other-shoulders {
  fill: #604227;
}

.player-other-head {
  fill: #e2c39b;
}

.player-arm-line {
  fill: none;
  stroke: #3e2d20;
  stroke-linecap: round;
  stroke-width: 0.08;
}

.player-label {
  fill: #e9e7de;
  font-size: 0.42px;
  paint-order: stroke;
  stroke: rgba(0, 0, 0, 0.75);
  stroke-width: 0.14px;
}

.npc-friendly-body {
  fill: #3a7d44;
}

.npc-friendly-shoulders {
  fill: #2d6135;
}

.npc-friendly-head {
  fill: #f3d9bd;
}

.npc-hostile-body {
  fill: #9b2226;
}

.npc-hostile-shoulders {
  fill: #7a1a1e;
}

.npc-hostile-head {
  fill: #e2c39b;
}

.npc-label {
  fill: #b8e0a8;
  font-size: 0.4px;
  paint-order: stroke;
  stroke: rgba(0, 0, 0, 0.8);
  stroke-width: 0.14px;
}

.npc-action-label {
  fill: #ffd166;
  font-size: 0.32px;
  paint-order: stroke;
  stroke: rgba(0, 0, 0, 0.7);
  stroke-width: 0.1px;
}

.npc-selection-ring {
  fill: none;
  stroke: #ffd700;
  stroke-width: 0.07px;
  opacity: 0.9;
}

/* The live SVG preview uses the same 32 gem poses as the Pixi texture loop. */
.board-totem-gem-frame {
  opacity: 0;
  animation: board-totem-gem-pose 4.8s steps(1, end) infinite;
}
@keyframes board-totem-gem-pose {
  0% {
    opacity: 1;
  }
  3.125%,
  100% {
    opacity: 0;
  }
}
.board-totem-pulse {
  animation: board-totem-breathe 4.8s ease-in-out infinite;
}
@keyframes board-totem-breathe {
  0%,
  100% {
    opacity: 0.58;
  }
  50% {
    opacity: 1;
  }
}
@media (prefers-reduced-motion: reduce) {
  .board-totem-gem-frame,
  .board-totem-pulse {
    animation: none;
  }
  .board-totem-gem-frame:first-child {
    opacity: 1;
  }
  .board-totem-pulse {
    opacity: 0.75;
  }
}
`;d(s);const b=Object.assign({"../../../../../packages/sprites/assets/world-objects/half-timber-house.png":l,"../../../../../packages/sprites/assets/world-objects/house.png":i}),r={};var o;for(const[e,a]of Object.entries(b)){const n=(o=e.split("/").pop())==null?void 0:o.replace(/\.png$/i,"");n&&(r[n]=a)}t(r);
