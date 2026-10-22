/* Öl Nu — 🎨 ICONS: the UI icon set (CONTRACT "IKONER · Phosphor-ikoner på kartan").
   window.ICONS. No hooks, no RPC, no new buttons. Loads before app.js (index.html), works offline (inline, sw.js precaches it).
   - Glyphs: Phosphor Icons 2.1.1 (@phosphor-icons/core, MIT, licence below and in docs/icons-LICENSE.txt). Only the glyphs
     we use are here, as ONE hidden inline <svg> sprite of <symbol id="ph-NAME"> (Bold) and "ph-NAME-f" (Fill), put first
     in <body>. Markup stays small: <svg class="ic"><use href="#ph-fire"/></svg>, colour = currentColor.
   - Round map buttons (decorated here, the emoji stays as the fallback when this file is missing):
       🔥 #btn-heat fire · 👻 #btn-ghostpins ghost · 🚕 #btn-taxi taxi · 📅 #btn-evs calendar-dots (badge kept) ·
       📍 #btn-locate crosshair · 🏆 #btn-top trophy · ⚙️ #btn-settings gear-six · 👥 #btn-groups users-three.
     Each gets the Bold glyph (idle) and the Fill glyph (on). ON = amber circle + Fill glyph:
       heat / ghost: aria-pressed="true" (app.js applyHeatBtn, social.js applyGhost) · locate: .busy (finding you) ·
       taxi / events / top / settings / groups: .ic-on while the sheet that button opened is open.
     Heat + ghost: app.js iconChip() wraps "🔥 Värme" into .mc-i + .mc-t; a MutationObserver here swaps the .mc-i emoji for
     the glyphs each time (applyHeatBtn / applyGhost reset textContent). #btn-evs is made later by evsheet.js: a body
     childList observer (no subtree) decorates it when it is added. Ids, sizes, positions, aria-labels, badges and click
     handlers are not touched.
   - Map markers by place type: white Fill glyph on the type colour with a white ring.
       ICONS.barIco(bar, innerHTML) → the .bar-ico div in app.js compositeIcon (all overlays kept: pills, 👑, 🏰, 🚪, 🪖, labels).
       ICONS.placeDot(type)         → the .pl-dot span in places.js (restaurant / café / fast food dots, zoom ≥ 16).
       ICONS.disc(kind)              → the type disc in arenapin.js chips (hockey / fotboll / other arena).
       pub beer-stein #E58A00 · bar martini #E8336F · nightclub disco-ball #7C4DFF · biergarten tree #1F9D55 ·
       hockey hockey #2B7BE4 · fotboll soccer-ball #2B7BE4 · restaurant fork-knife #138A8A · cafe coffee #8D6346 ·
       fast_food hamburger #C8202A · other arena flag-pennant #5B6B7F. Unknown bar type → pub.
   - Also: ICONS.svg(name, cls) (name "fire" = Bold, "fire-f" = Fill), ICONS.has(name), ICONS.type(t) → {k, g, c}.

   Phosphor Icons licence:
   MIT License

   Copyright (c) 2023 Phosphor Icons

   Permission is hereby granted, free of charge, to any person obtaining a copy
   of this software and associated documentation files (the "Software"), to deal
   in the Software without restriction, including without limitation the rights
   to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
   copies of the Software, and to permit persons to whom the Software is
   furnished to do so, subject to the following conditions:

   The above copyright notice and this permission notice shall be included in all
   copies or substantial portions of the Software.

   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
   IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
   FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
   AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
   LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
   OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
   SOFTWARE.
*/
(function () {
  "use strict";
  var G = {"fire":"<path d=\"M177.62,159.6a52,52,0,0,1-34,34,12.2,12.2,0,0,1-3.6.55,12,12,0,0,1-3.6-23.45,28,28,0,0,0,18.32-18.32,12,12,0,0,1,22.9,7.2ZM220,144a92,92,0,0,1-184,0c0-28.81,11.27-58.18,33.48-87.28a12,12,0,0,1,17.9-1.33L107.07,74.5,127,19.89a12,12,0,0,1,18.94-5.12C168.2,33.25,220,82.85,220,144Zm-24,0c0-41.71-30.61-78.39-52.52-99.29l-20.21,55.4a12,12,0,0,1-19.63,4.5L80.71,82.36C67,103.38,60,124.06,60,144a68,68,0,0,0,136,0Z\"/>","ghost":"<path d=\"M116,116a16,16,0,1,1-16-16A16,16,0,0,1,116,116Zm40-16a16,16,0,1,0,16,16A16,16,0,0,0,156,100Zm72,20v96a12,12,0,0,1-19.6,9.29L186.67,207.5l-21.74,17.79a12,12,0,0,1-15.2,0L128,207.5l-21.73,17.79a12,12,0,0,1-15.2,0L69.33,207.5,47.6,225.29A12,12,0,0,1,28,216V120a100,100,0,0,1,200,0Zm-24,0a76,76,0,0,0-152,0v70.68l9.73-8a12,12,0,0,1,15.2,0L98.67,200.5l21.73-17.79a12,12,0,0,1,15.2,0l21.73,17.79,21.74-17.79a12,12,0,0,1,15.2,0l9.73,8Z\"/>","taxi":"<path d=\"M240,100h-9L204.72,54.08A20,20,0,0,0,187.36,44H168.12l-11-27.43A19.9,19.9,0,0,0,138.58,4H117.42A19.9,19.9,0,0,0,98.85,16.57L87.88,44H68.64A20,20,0,0,0,51.28,54.08L25,100H16a12,12,0,0,0,0,24h4v76a20,20,0,0,0,20,20H68a20,20,0,0,0,20-20V180h80v20a20,20,0,0,0,20,20h28a20,20,0,0,0,20-20V124h4a12,12,0,0,0,0-24ZM120.12,28h15.76l6.4,16H113.72ZM71,68H185l18.28,32H52.68ZM64,196H44V180H64Zm148,0H192V180h20Zm0-40H44V124H212Z\"/>","calendar-dots":"<path d=\"M208,28H188V24a12,12,0,0,0-24,0v4H92V24a12,12,0,0,0-24,0v4H48A20,20,0,0,0,28,48V208a20,20,0,0,0,20,20H208a20,20,0,0,0,20-20V48A20,20,0,0,0,208,28ZM68,52a12,12,0,0,0,24,0h72a12,12,0,0,0,24,0h16V76H52V52ZM52,204V100H204V204Zm92-76a16,16,0,1,1-16-16A16,16,0,0,1,144,128Zm48,0a16,16,0,1,1-16-16A16,16,0,0,1,192,128ZM96,176a16,16,0,1,1-16-16A16,16,0,0,1,96,176Zm48,0a16,16,0,1,1-16-16A16,16,0,0,1,144,176Zm48,0a16,16,0,1,1-16-16A16,16,0,0,1,192,176Z\"/>","crosshair":"<path d=\"M232,116h-4.72A100.21,100.21,0,0,0,140,28.72V24a12,12,0,0,0-24,0v4.72A100.21,100.21,0,0,0,28.72,116H24a12,12,0,0,0,0,24h4.72A100.21,100.21,0,0,0,116,227.28V232a12,12,0,0,0,24,0v-4.72A100.21,100.21,0,0,0,227.28,140H232a12,12,0,0,0,0-24Zm-92,87v-3a12,12,0,0,0-24,0v3a76.15,76.15,0,0,1-63-63h3a12,12,0,0,0,0-24H53a76.15,76.15,0,0,1,63-63v3a12,12,0,0,0,24,0V53a76.15,76.15,0,0,1,63,63h-3a12,12,0,0,0,0,24h3A76.15,76.15,0,0,1,140,203ZM128,84a44,44,0,1,0,44,44A44.05,44.05,0,0,0,128,84Zm0,64a20,20,0,1,1,20-20A20,20,0,0,1,128,148Z\"/>","trophy":"<path d=\"M232,60H212V48a12,12,0,0,0-12-12H56A12,12,0,0,0,44,48V60H24A20,20,0,0,0,4,80V96a44.05,44.05,0,0,0,44,44h.77A84.18,84.18,0,0,0,116,195.15V212H96a12,12,0,0,0,0,24h64a12,12,0,0,0,0-24H140V195.11c30.94-4.51,56.53-26.2,67-55.11h1a44.05,44.05,0,0,0,44-44V80A20,20,0,0,0,232,60ZM28,96V84H44v28c0,1.21,0,2.41.09,3.61A20,20,0,0,1,28,96Zm160,15.1c0,33.33-26.71,60.65-59.54,60.9A60,60,0,0,1,68,112V60H188ZM228,96a20,20,0,0,1-16.12,19.62c.08-1.5.12-3,.12-4.52V84h16Z\"/>","gear-six":"<path d=\"M128,76a52,52,0,1,0,52,52A52.06,52.06,0,0,0,128,76Zm0,80a28,28,0,1,1,28-28A28,28,0,0,1,128,156Zm113.86-49.57A12,12,0,0,0,236,98.34L208.21,82.49l-.11-31.31a12,12,0,0,0-4.25-9.12,116,116,0,0,0-38-21.41,12,12,0,0,0-9.68.89L128,37.27,99.83,21.53a12,12,0,0,0-9.7-.9,116.06,116.06,0,0,0-38,21.47,12,12,0,0,0-4.24,9.1l-.14,31.34L20,98.35a12,12,0,0,0-5.85,8.11,110.7,110.7,0,0,0,0,43.11A12,12,0,0,0,20,157.66l27.82,15.85.11,31.31a12,12,0,0,0,4.25,9.12,116,116,0,0,0,38,21.41,12,12,0,0,0,9.68-.89L128,218.73l28.14,15.74a12,12,0,0,0,9.7.9,116.06,116.06,0,0,0,38-21.47,12,12,0,0,0,4.24-9.1l.14-31.34,27.81-15.81a12,12,0,0,0,5.85-8.11A110.7,110.7,0,0,0,241.86,106.43Zm-22.63,33.18-26.88,15.28a11.94,11.94,0,0,0-4.55,4.59c-.54,1-1.11,1.93-1.7,2.88a12,12,0,0,0-1.83,6.31L184.13,199a91.83,91.83,0,0,1-21.07,11.87l-27.15-15.19a12,12,0,0,0-5.86-1.53h-.29c-1.14,0-2.3,0-3.44,0a12.08,12.08,0,0,0-6.14,1.51L93,210.82A92.27,92.27,0,0,1,71.88,199l-.11-30.24a12,12,0,0,0-1.83-6.32c-.58-.94-1.16-1.91-1.7-2.88A11.92,11.92,0,0,0,63.7,155L36.8,139.63a86.53,86.53,0,0,1,0-23.24l26.88-15.28a12,12,0,0,0,4.55-4.58c.54-1,1.11-1.94,1.7-2.89a12,12,0,0,0,1.83-6.31L71.87,57A91.83,91.83,0,0,1,92.94,45.17l27.15,15.19a11.92,11.92,0,0,0,6.15,1.52c1.14,0,2.3,0,3.44,0a12.08,12.08,0,0,0,6.14-1.51L163,45.18A92.27,92.27,0,0,1,184.12,57l.11,30.24a12,12,0,0,0,1.83,6.32c.58.94,1.16,1.91,1.7,2.88A11.92,11.92,0,0,0,192.3,101l26.9,15.33A86.53,86.53,0,0,1,219.23,139.61Z\"/>","users-three":"<path d=\"M164.38,181.1a52,52,0,1,0-72.76,0,75.89,75.89,0,0,0-30,28.89,12,12,0,0,0,20.78,12,53,53,0,0,1,91.22,0,12,12,0,1,0,20.78-12A75.89,75.89,0,0,0,164.38,181.1ZM100,144a28,28,0,1,1,28,28A28,28,0,0,1,100,144Zm147.21,9.59a12,12,0,0,1-16.81-2.39c-8.33-11.09-19.85-19.59-29.33-21.64a12,12,0,0,1-1.82-22.91,20,20,0,1,0-24.78-28.3,12,12,0,1,1-21-11.6,44,44,0,1,1,73.28,48.35,92.18,92.18,0,0,1,22.85,21.69A12,12,0,0,1,247.21,153.59Zm-192.28-24c-9.48,2.05-21,10.55-29.33,21.65A12,12,0,0,1,6.41,136.79,92.37,92.37,0,0,1,29.26,115.1a44,44,0,1,1,73.28-48.35,12,12,0,1,1-21,11.6,20,20,0,1,0-24.78,28.3,12,12,0,0,1-1.82,22.91Z\"/>","fire-f":"<path d=\"M143.38,17.85a8,8,0,0,0-12.63,3.41l-22,60.41L84.59,58.26a8,8,0,0,0-11.93.89C51,87.53,40,116.08,40,144a88,88,0,0,0,176,0C216,84.55,165.21,36,143.38,17.85Zm40.51,135.49a57.6,57.6,0,0,1-46.56,46.55A7.65,7.65,0,0,1,136,200a8,8,0,0,1-1.32-15.89c16.57-2.79,30.63-16.85,33.44-33.45a8,8,0,0,1,15.78,2.68Z\"/>","ghost-f":"<path d=\"M128,24a96.11,96.11,0,0,0-96,96v96a8,8,0,0,0,13.07,6.19l24.26-19.85L93.6,222.19a8,8,0,0,0,10.13,0L128,202.34l24.27,19.85a8,8,0,0,0,10.13,0l24.27-19.85,24.26,19.85A8,8,0,0,0,224,216V120A96.11,96.11,0,0,0,128,24ZM100,128a12,12,0,1,1,12-12A12,12,0,0,1,100,128Zm56,0a12,12,0,1,1,12-12A12,12,0,0,1,156,128Z\"/>","taxi-f":"<path d=\"M240,104H228.64L201.25,56.06A16,16,0,0,0,187.36,48H165.42l-12-29.94A15.93,15.93,0,0,0,138.58,8H117.42a15.93,15.93,0,0,0-14.86,10.06L90.58,48H68.64a16,16,0,0,0-13.89,8.06L27.36,104H16a8,8,0,0,0,0,16h8v80a16,16,0,0,0,16,16H64a16,16,0,0,0,16-16v-8h96v8a16,16,0,0,0,16,16h24a16,16,0,0,0,16-16V120h8a8,8,0,0,0,0-16ZM80,152H56a8,8,0,0,1,0-16H80a8,8,0,0,1,0,16Zm120,0H176a8,8,0,0,1,0-16h24a8,8,0,0,1,0,16ZM45.79,104,68.64,64H187.36l22.85,40Z\"/>","calendar-dots-f":"<path d=\"M208,32H184V24a8,8,0,0,0-16,0v8H88V24a8,8,0,0,0-16,0v8H48A16,16,0,0,0,32,48V208a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V48A16,16,0,0,0,208,32ZM84,184a12,12,0,1,1,12-12A12,12,0,0,1,84,184Zm44,0a12,12,0,1,1,12-12A12,12,0,0,1,128,184Zm0-40a12,12,0,1,1,12-12A12,12,0,0,1,128,144Zm44,40a12,12,0,1,1,12-12A12,12,0,0,1,172,184Zm0-40a12,12,0,1,1,12-12A12,12,0,0,1,172,144Zm36-64H48V48H72v8a8,8,0,0,0,16,0V48h80v8a8,8,0,0,0,16,0V48h24Z\"/>","crosshair-f":"<path d=\"M232,120h-8.34A96.14,96.14,0,0,0,136,32.34V24a8,8,0,0,0-16,0v8.34A96.14,96.14,0,0,0,32.34,120H24a8,8,0,0,0,0,16h8.34A96.14,96.14,0,0,0,120,223.66V232a8,8,0,0,0,16,0v-8.34A96.14,96.14,0,0,0,223.66,136H232a8,8,0,0,0,0-16Zm-32,16h7.6A80.15,80.15,0,0,1,136,207.6V200a8,8,0,0,0-16,0v7.6A80.15,80.15,0,0,1,48.4,136H56a8,8,0,0,0,0-16H48.4A80.15,80.15,0,0,1,120,48.4V56a8,8,0,0,0,16,0V48.4A80.15,80.15,0,0,1,207.6,120H200a8,8,0,0,0,0,16Zm-32-8a40,40,0,1,1-40-40A40,40,0,0,1,168,128Z\"/>","trophy-f":"<path d=\"M232,64H208V48a8,8,0,0,0-8-8H56a8,8,0,0,0-8,8V64H24A16,16,0,0,0,8,80V96a40,40,0,0,0,40,40h3.65A80.13,80.13,0,0,0,120,191.61V216H96a8,8,0,0,0,0,16h64a8,8,0,0,0,0-16H136V191.58c31.94-3.23,58.44-25.64,68.08-55.58H208a40,40,0,0,0,40-40V80A16,16,0,0,0,232,64ZM48,120A24,24,0,0,1,24,96V80H48v32q0,4,.39,8ZM232,96a24,24,0,0,1-24,24h-.5a81.81,81.81,0,0,0,.5-8.9V80h24Z\"/>","gear-six-f":"<path d=\"M237.94,107.21a8,8,0,0,0-3.89-5.4l-29.83-17-.12-33.62a8,8,0,0,0-2.83-6.08,111.91,111.91,0,0,0-36.72-20.67,8,8,0,0,0-6.46.59L128,41.85,97.88,25a8,8,0,0,0-6.47-.6A111.92,111.92,0,0,0,54.73,45.15a8,8,0,0,0-2.83,6.07l-.15,33.65-29.83,17a8,8,0,0,0-3.89,5.4,106.47,106.47,0,0,0,0,41.56,8,8,0,0,0,3.89,5.4l29.83,17,.12,33.63a8,8,0,0,0,2.83,6.08,111.91,111.91,0,0,0,36.72,20.67,8,8,0,0,0,6.46-.59L128,214.15,158.12,231a7.91,7.91,0,0,0,3.9,1,8.09,8.09,0,0,0,2.57-.42,112.1,112.1,0,0,0,36.68-20.73,8,8,0,0,0,2.83-6.07l.15-33.65,29.83-17a8,8,0,0,0,3.89-5.4A106.47,106.47,0,0,0,237.94,107.21ZM128,168a40,40,0,1,1,40-40A40,40,0,0,1,128,168Z\"/>","users-three-f":"<path d=\"M64.12,147.8a4,4,0,0,1-4,4.2H16a8,8,0,0,1-7.8-6.17,8.35,8.35,0,0,1,1.62-6.93A67.79,67.79,0,0,1,37,117.51a40,40,0,1,1,66.46-35.8,3.94,3.94,0,0,1-2.27,4.18A64.08,64.08,0,0,0,64,144C64,145.28,64,146.54,64.12,147.8Zm182-8.91A67.76,67.76,0,0,0,219,117.51a40,40,0,1,0-66.46-35.8,3.94,3.94,0,0,0,2.27,4.18A64.08,64.08,0,0,1,192,144c0,1.28,0,2.54-.12,3.8a4,4,0,0,0,4,4.2H240a8,8,0,0,0,7.8-6.17A8.33,8.33,0,0,0,246.17,138.89Zm-89,43.18a48,48,0,1,0-58.37,0A72.13,72.13,0,0,0,65.07,212,8,8,0,0,0,72,224H184a8,8,0,0,0,6.93-12A72.15,72.15,0,0,0,157.19,182.07Z\"/>","beer-stein-f":"<path d=\"M216,88H200V72a40,40,0,0,0-40-40H148.82c-11.91-10.2-28-16-44.82-16C68.71,16,40,41.12,40,72V208a16,16,0,0,0,16,16H184a16,16,0,0,0,16-16v-8h16a24,24,0,0,0,24-24V112A24,24,0,0,0,216,88ZM104,184a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Zm48,0a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0ZM57,64c4.46-18.24,23.85-32,47-32,13.87,0,27.06,5,36.21,13.78A8,8,0,0,0,145.74,48H160a24,24,0,0,1,22.62,16ZM224,176a8,8,0,0,1-8,8H200V104h16a8,8,0,0,1,8,8Z\"/>","martini-f":"<path d=\"M237.66,45.66A8,8,0,0,0,232,32H24a8,8,0,0,0-5.66,13.66L120,147.31V208H88a8,8,0,0,0,0,16h80a8,8,0,0,0,0-16H136V147.31Zm-25,2.34-16,16H59.31l-16-16Z\"/>","disco-ball-f":"<path d=\"M120,64.37V16a8,8,0,0,0-16,0V64.37a88,88,0,1,0,16,0ZM183.54,144H151.77c-1.51-28.36-10.79-48.36-19.44-61.06A72.16,72.16,0,0,1,183.54,144Zm-47.78,16c-2,33.52-16.13,52.95-23.76,61.08-7.64-8.15-21.77-27.57-23.76-61.08ZM91.67,82.94C83,95.64,73.74,115.64,72.23,144H40.46A72.16,72.16,0,0,1,91.67,82.94ZM40.46,160H72.23c1.51,28.36,10.79,48.36,19.44,61.06A72.16,72.16,0,0,1,40.46,160ZM256,88a8,8,0,0,1-8,8h-8v8a8,8,0,0,1-16,0V96h-8a8,8,0,0,1,0-16h8V72a8,8,0,0,1,16,0v8h8A8,8,0,0,1,256,88ZM152,40a8,8,0,0,1,8-8h16V16a8,8,0,0,1,16,0V32h16a8,8,0,0,1,0,16H192V64a8,8,0,0,1-16,0V48H160A8,8,0,0,1,152,40Z\"/>","tree-f":"<path d=\"M128,187.85a72.44,72.44,0,0,0,8,4.62V232a8,8,0,0,1-16,0V192.47A72.44,72.44,0,0,0,128,187.85ZM198.1,62.59a76,76,0,0,0-140.2,0A71.71,71.71,0,0,0,16,127.8C15.9,166,48,199,86.14,200A72.22,72.22,0,0,0,120,192.47V156.94L76.42,135.16a8,8,0,1,1,7.16-14.32L120,139.06V88a8,8,0,0,1,16,0v27.06l36.42-18.22a8,8,0,1,1,7.16,14.32L136,132.94v59.53A72.17,72.17,0,0,0,168,200l1.82,0C208,199,240.11,166,240,127.8A71.71,71.71,0,0,0,198.1,62.59Z\"/>","hockey-f":"<path d=\"M149.9,122.82l68-80a8,8,0,0,1,12.2,10.36l-68,80a8,8,0,1,1-12.2-10.36ZM240,168v32a16,16,0,0,1-16,16H171.7a16,16,0,0,1-12.19-5.64L25.9,53.18h0A8,8,0,0,1,38.1,42.82L130.9,152H224A16,16,0,0,1,240,168Zm-16,0H208v32h16ZM115.3,183.06a4,4,0,0,1,0,5.18L96.49,210.36A16,16,0,0,1,84.3,216H32a16,16,0,0,1-16-16V168a16,16,0,0,1,16-16H87.05a4,4,0,0,1,3,1.41ZM48,168H32v32H48Z\"/>","soccer-ball-f":"<path d=\"M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm8,39.38,24.79-17.05a88.41,88.41,0,0,1,36.18,27l-8,26.94c-.2,0-.41.1-.61.17l-22.82,7.41a7.59,7.59,0,0,0-1,.4L136,88.62c0-.2,0-.41,0-.62V64C136,63.79,136,63.58,136,63.38ZM95.24,46.33,120,63.38c0,.2,0,.41,0,.62V88c0,.21,0,.42,0,.62L91.44,108.29a7.59,7.59,0,0,0-1-.4l-22.82-7.41c-.2-.07-.41-.12-.61-.17l-8-26.94A88.41,88.41,0,0,1,95.24,46.33Zm-13,129.09H53.9a87.4,87.4,0,0,1-13.79-43.07l22-16.88a5.77,5.77,0,0,0,.58.22l22.83,7.42a7.83,7.83,0,0,0,.93.22l10.79,31.42c-.15.18-.3.36-.44.55L82.7,174.71A7.8,7.8,0,0,0,82.24,175.42ZM150.69,213a88.16,88.16,0,0,1-45.38,0L95.25,184.6c.13-.16.27-.31.39-.48l14.11-19.42a7.66,7.66,0,0,0,.46-.7h35.58a7.66,7.66,0,0,0,.46.7l14.11,19.42c.12.17.26.32.39.48Zm23.07-37.61a7.8,7.8,0,0,0-.46-.71L159.19,155.3c-.14-.19-.29-.37-.44-.55l10.79-31.42a7.83,7.83,0,0,0,.93-.22l22.83-7.42a5.77,5.77,0,0,0,.58-.22l22,16.88a87.4,87.4,0,0,1-13.79,43.07Z\"/>","fork-knife-f":"<path d=\"M216,40V224a8,8,0,0,1-16,0V176H152a8,8,0,0,1-8-8,268.75,268.75,0,0,1,7.22-56.88c9.78-40.49,28.32-67.63,53.63-78.47A8,8,0,0,1,216,40Zm-96.11-1.31a8,8,0,1,0-15.78,2.63L111.89,88H88V40a8,8,0,0,0-16,0V88H48.11l7.78-46.68a8,8,0,1,0-15.78-2.63l-8,48A8.17,8.17,0,0,0,32,88a48.07,48.07,0,0,0,40,47.32V224a8,8,0,0,0,16,0V135.32A48.07,48.07,0,0,0,128,88a8.17,8.17,0,0,0-.11-1.31Z\"/>","coffee-f":"<path d=\"M208,80H32a8,8,0,0,0-8,8v48a96.3,96.3,0,0,0,32.54,72H32a8,8,0,0,0,0,16H208a8,8,0,0,0,0-16H183.46a96.59,96.59,0,0,0,27-40.09A40,40,0,0,0,248,128v-8A40,40,0,0,0,208,80Zm24,48a24,24,0,0,1-17.2,23,95.78,95.78,0,0,0,1.2-15V97.38A24,24,0,0,1,232,120ZM112,56V24a8,8,0,0,1,16,0V56a8,8,0,0,1-16,0Zm32,0V24a8,8,0,0,1,16,0V56a8,8,0,0,1-16,0ZM80,56V24a8,8,0,0,1,16,0V56a8,8,0,0,1-16,0Z\"/>","hamburger-f":"<path d=\"M35.58,98.06a16,16,0,0,1-3.23-13.44C39.78,49.5,80,24,128,24s88.22,25.5,95.65,60.62A16,16,0,0,1,207.93,104H48.07A16,16,0,0,1,35.58,98.06Zm193.68,54.42-41.13,15L151,152.57a8,8,0,0,0-5.94,0l-37,14.81L71,152.57a8,8,0,0,0-5.7-.09l-44,16a8,8,0,0,0,5.47,15L40,178.69V184a40,40,0,0,0,40,40h96a40,40,0,0,0,40-40v-9.67l18.73-6.81a8,8,0,1,0-5.47-15ZM24,136H232a8,8,0,0,0,0-16H24a8,8,0,0,0,0,16Z\"/>","flag-pennant-f":"<path d=\"M248,104a8,8,0,0,1-5.37,7.56L64,173.69V216a8,8,0,0,1-16,0V40a8,8,0,0,1,10.63-7.56l184,64A8,8,0,0,1,248,104Z\"/>"};
  var TYPES = {
    pub: ["beer-stein", "#E58A00"], bar: ["martini", "#E8336F"], nightclub: ["disco-ball", "#7C4DFF"], biergarten: ["tree", "#1F9D55"],
    hockey: ["hockey", "#2B7BE4"], fotboll: ["soccer-ball", "#2B7BE4"], restaurant: ["fork-knife", "#138A8A"], cafe: ["coffee", "#8D6346"],
    fast_food: ["hamburger", "#C8202A"], arena: ["flag-pennant", "#5B6B7F"]
  };
  var ALIAS = { beer_garden: "biergarten", garden: "biergarten", club: "nightclub", cafe: "cafe", "café": "cafe", fastfood: "fast_food",
    football: "fotboll", soccer: "fotboll", ishockey: "hockey", place: "restaurant" };
  var BTN = { "btn-heat": "fire", "btn-ghostpins": "ghost", "btn-taxi": "taxi", "btn-evs": "calendar-dots", "btn-locate": "crosshair",
    "btn-top": "trophy", "btn-settings": "gear-six", "btn-groups": "users-three" };
  // buttons whose "on" look = their sheet is open
  var SHEET_BTN = { "btn-taxi": 1, "btn-evs": 1, "btn-top": 1, "btn-settings": 1, "btn-groups": 1 };

  function has(n) { return Object.prototype.hasOwnProperty.call(G, n); }
  function svg(n, cls) {
    return '<svg class="ic' + (cls ? " " + cls : "") + '" aria-hidden="true" focusable="false"><use href="#ph-' + n + '"/></svg>';
  }
  function pair(n) { return svg(n, "ic-b") + svg(n + "-f", "ic-f"); }
  function type(t) {
    var k = String(t || "").toLowerCase(); k = ALIAS[k] || k;
    if (!TYPES[k]) k = "pub";
    return { k: k, g: TYPES[k][0], c: TYPES[k][1] };
  }
  function barIco(bar, inner) {
    bar = bar || {};
    var ty = type(bar.arena ? (bar.s || "arena") : bar.type || (bar.place ? "restaurant" : "pub"));
    return '<div class="bar-ico ic-mk ic-t-' + ty.k + (bar.place ? ' place-ico" aria-hidden="true">' : '">') + svg(ty.g + "-f") + (inner || "") + "</div>";
  }
  function placeDot(t) { var ty = type(t || "restaurant"); return '<span class="pl-dot ic-mk ic-t-' + ty.k + '" aria-hidden="true">' + svg(ty.g + "-f") + "</span>"; }
  function disc(kind) { var ty = type(kind || "arena"); return '<span class="ic-disc ic-t-' + ty.k + '">' + svg(ty.g + "-f") + "</span>"; }

  /* ---------- look ---------- */
  var AMB = "var(--ds-amber,var(--amber,#f5a623))", INK = "var(--on-amber,#1a1206)";
  var css =
    ".ic{display:block;width:24px;height:24px;fill:currentColor;flex:0 0 auto;pointer-events:none}" +
    ".ic-btn .ic-f{display:none}" +
    ".ic-btn.ic-on .ic-b,.ic-btn[aria-pressed=\"true\"] .ic-b,.ic-btn.busy .ic-b{display:none}" +
    ".ic-btn.ic-on .ic-f,.ic-btn[aria-pressed=\"true\"] .ic-f,.ic-btn.busy .ic-f{display:block}" +
    ".ic-btn{color:var(--ds-text,var(--text,#eef0ec))}" +
    ".ic-btn .mc-i,.ic-btn>span[aria-hidden=\"true\"]{display:grid;place-items:center;font-size:0;line-height:0}" +
    /* on = amber circle (round buttons) / amber tile (top bar) */
    "#btn-heat.ic-btn[aria-pressed=\"true\"],#btn-ghostpins.ic-btn[aria-pressed=\"true\"],.locate-btn.ic-btn.ic-on,.locate-btn.ic-btn.busy,.icon-btn.ic-btn.ic-on{" +
      "background:" + AMB + " !important;border-color:transparent !important;color:" + INK + " !important;" +
      "box-shadow:0 0 0 3px rgba(245,166,35,.22),0 2px 8px rgba(0,0,0,.45) !important}" +
    ".side-btn.ic-btn .side-ico{display:grid;place-items:center;width:32px;height:32px;margin:0 auto;border-radius:50%;font-size:0;line-height:0}" +
    ".side-btn.ic-btn .side-ico .ic{width:22px;height:22px}" +
    ".side-btn.ic-btn.ic-on .side-ico{background:" + AMB + ";color:" + INK + "}" +
    /* markers: white Fill glyph on the type colour, white ring */
    ".ic-t-pub{--ic-c:#E58A00}.ic-t-bar{--ic-c:#E8336F}.ic-t-nightclub{--ic-c:#7C4DFF}.ic-t-biergarten{--ic-c:#1F9D55}" +
    ".ic-t-hockey{--ic-c:#2B7BE4}.ic-t-fotboll{--ic-c:#2B7BE4}.ic-t-restaurant{--ic-c:#138A8A}.ic-t-cafe{--ic-c:#8D6346}" +
    ".ic-t-fast_food{--ic-c:#C8202A}.ic-t-arena{--ic-c:#5B6B7F}" +
    ".bar-ico.ic-mk{background:var(--ic-c) !important;border:2px solid #fff !important;color:#fff;font-size:0}" +
    ".bar-ico.ic-mk>svg.ic{width:14px;height:14px}" +
    ".cm .bar-ico.ic-mk{box-shadow:0 0 0 1px rgba(0,0,0,.35),0 1px 4px rgba(0,0,0,.6)}" +
    ".cm.cm-hot .bar-ico.ic-mk{box-shadow:0 0 0 2px var(--amber-2,#ffb43a),0 1px 6px rgba(0,0,0,.6)}" +
    ".cm.cm-lit .bar-ico.ic-mk{box-shadow:0 0 0 2px var(--green,#3ddc84),0 0 6px rgba(61,220,132,.55)}" +
    ".cm.cm-quiet .bar-ico.ic-mk{border-width:1.5px !important;opacity:.78;box-shadow:0 1px 2px rgba(0,0,0,.5)}" +
    ".cm.cm-quiet .bar-ico.ic-mk>svg.ic{width:10px;height:10px}" +
    ".pl-dot.ic-mk{background:var(--ic-c) !important;border:1.5px solid #fff !important;color:#fff;font-size:0;opacity:.86}" +
    ".pl-dot.ic-mk>svg.ic{width:10px;height:10px}" +
    ".ic-disc{display:grid;place-items:center;width:18px;height:18px;border-radius:50%;background:var(--ic-c);border:1.5px solid #fff;color:#fff;box-sizing:border-box}" +
    ".ic-disc>svg.ic{width:11px;height:11px}" +
    ".ap-pin.ap-quiet .ic-disc{width:16px;height:16px}.ap-pin.ap-quiet .ic-disc>svg.ic{width:10px;height:10px}";

  /* ---------- sprite + style (once) ---------- */
  function sprite() {
    if (!document.body || document.getElementById("ph-sprite")) return;
    var s = '<svg id="ph-sprite" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false" style="position:absolute;width:0;height:0;overflow:hidden">';
    Object.keys(G).forEach(function (n) { s += '<symbol id="ph-' + n + '" viewBox="0 0 256 256">' + G[n] + "</symbol>"; });
    document.body.insertAdjacentHTML("afterbegin", s + "</svg>");
    var st = document.createElement("style"); st.id = "ic-css"; st.textContent = css; document.head.appendChild(st);
  }

  /* ---------- buttons ---------- */
  function slot(b) {
    if (b.id === "btn-heat" || b.id === "btn-ghostpins") return b.querySelector(".mc-i");
    if (b.id === "btn-groups") return b.querySelector(".side-ico");
    if (b.id === "btn-top" || b.id === "btn-settings") return b;
    return b.querySelector('span[aria-hidden="true"]');
  }
  function fill(b) {
    var n = BTN[b.id], s = n && slot(b);
    if (!s || s.querySelector("svg.ic-b")) return;
    s.innerHTML = pair(n);
  }
  function decorate(b) {
    if (!b || !BTN[b.id]) return;
    if (!b.classList.contains("ic-btn")) {
      b.classList.add("ic-btn");
      if ((b.id === "btn-heat" || b.id === "btn-ghostpins") && window.MutationObserver)
        new MutationObserver(function () { fill(b); }).observe(b, { childList: true, subtree: true, characterData: true });
    }
    fill(b);
  }
  function decorateAll() { Object.keys(BTN).forEach(function (id) { decorate(document.getElementById(id)); }); }

  // "on" while the sheet a button opened is open
  var owner = null, ownerAt = 0;
  function sheetWatch() {
    var sh = document.getElementById("sheet"); if (!sh || !window.MutationObserver) return;
    document.addEventListener("click", function (e) {
      var b = e.target && e.target.closest && e.target.closest(".ic-btn");
      if (b && SHEET_BTN[b.id]) { owner = b; ownerAt = Date.now(); }
    }, true);
    function sync() {
      if (sh.hidden) { owner = null; document.querySelectorAll(".ic-btn.ic-on").forEach(function (x) { x.classList.remove("ic-on"); }); return; }
      if (owner && Date.now() - ownerAt < 2500) { owner.classList.add("ic-on"); owner = null; }
    }
    new MutationObserver(sync).observe(sh, { attributes: true, attributeFilter: ["hidden"] });
  }

  function init() {
    sprite(); decorateAll(); sheetWatch();
    // #btn-evs (evsheet.js) and any late button: watch <body> children only (cheap: markers live inside #map).
    if (window.MutationObserver && document.body) new MutationObserver(function (ms) {
      for (var i = 0; i < ms.length; i++) for (var j = 0; j < ms[i].addedNodes.length; j++) { var x = ms[i].addedNodes[j]; if (x.id && BTN[x.id]) decorate(x); }
    }).observe(document.body, { childList: true });
  }
  window.ICONS = { svg: svg, has: has, type: type, barIco: barIco, placeDot: placeDot, disc: disc, decorate: decorateAll, _glyphs: G };
  if (document.body) init(); else document.addEventListener("DOMContentLoaded", init);
})();
