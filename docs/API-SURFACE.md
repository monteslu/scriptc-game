# API Surface

Three support tiers, marked throughout:

- **S** shipped in v1, conformance-tested
- **D** deferred (post-v1, path known)
- **X** intentionally out, with a reason

The goal is web COMPATIBILITY, not merely web shape: where a spec exists we
match it, and a deviation is a bug with a comment at the site explaining why
it has not been fixed yet. Where the web defines nothing (the Standard
Gamepad names no button constants), we do not invent a global either --
conveniences belong in `engine/`, which is optional.

Games import from **`web/globals.js`** and get the browser surface:
`document`, `window`, `navigator`, `requestAnimationFrame`, `Image`, `fetch`,
`FontFace`, `AudioContext` (and every Web Audio node type), `Math`, and the
Gamepad interfaces. See [WRITING-GAMES.md](WRITING-GAMES.md) for the
author-facing guide.

The 3D surface has **shipped** and is specified separately in
[WEBGL-AND-3D.md](WEBGL-AND-3D.md): a `WebGL2RenderingContext` reached via
`canvas.getContextGL()` (spelled `getContext("webgl2")` in a page), plus the
threeTS-lite library on top of it.

---

## Entry point

There is no framework entry point to call. A game registers a `load` handler
and drives itself with `requestAnimationFrame`, exactly as in a page:

```ts
window.addEventListener("load", () => {
  const canvas = document.getElementById("game-canvas");
  const ctx = canvas.getContext("2d");

  function frame(time: number): void {
    // update + draw
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
});
```

Canvas size and title come from the game's `game.json`, which is the native
equivalent of what a page expresses in HTML. The HOST owns the outer loop and
drives rAF callbacks (`host/runtime.ts`); nothing about it appears in game
source.

`requestAnimationFrame` is a proper QUEUE: two independent systems
registering in the same frame both run, as a browser does.

---

## Context2D (Canvas 2D)

Backed by `skiac_*` (same Skia, same version as @napi-rs/canvas via
build-libcanvas pins), so rendering output is expected byte-identical to
napi-rs/canvas goldens.

### State and transforms: all S

`save() restore() reset()`
`translate(x,y) rotate(a) scale(x,y) transform(a,b,c,d,e,f)`
`setTransform(...) resetTransform() getTransform()` (returns a DOMMatrix-
shaped record `{a,b,c,d,e,f}`; X: full DOMMatrix class, reason: dialect
cost with no game value)

### Rects: all S

`clearRect fillRect strokeRect`

### Paths: S

`beginPath closePath moveTo lineTo bezierCurveTo quadraticCurveTo arc
arcTo ellipse rect roundRect fill(rule?) stroke() clip(rule?)
isPointInPath isPointInStroke`
`Path2D` class: S (skiac_path_* has 36 functions including boolean ops;
`Path2D.addPath`, `op()` extensions D).

### Styles

- `fillStyle` / `strokeStyle`: S for CSS colors (hex/rgb/rgba/hsl/named,
  parser in pure TS), gradients, patterns.
- `createLinearGradient createRadialGradient createConicGradient`: S
  (skiac_shader_*).
- `createPattern(image, repeat)`: S.
- `lineWidth lineCap lineJoin miterLimit setLineDash getLineDash
  lineDashOffset`: S.
- `globalAlpha`: S. `globalCompositeOperation`: S (Skia blend modes; the
  full 26-mode CSS list mapped, unsupported ones documented).
- `filter` (CSS filter string): D (Skia image filters exist in skiac;
  parser + plumbing is post-v1).
- `shadowBlur/Color/OffsetX/OffsetY`: D pending a check of what skiac
  exposes for loopers/image filters; napi-rs/canvas implements shadows, so
  the capability exists; wiring order puts it just after v1.

### Text

- `fillText strokeText measureText`: S (skiac font family = 15 fns +
  line-metrics call).
- `font` shorthand parsing, `textAlign textBaseline`: S.
- `direction letterSpacing wordSpacing`: D.
- `new FontFace(family, "url(file.ttf)").load()` + `document.fonts.add(face)`:
  S. The spec path; the promise settles on a later turn.

### Images

- `new Image()` with `src` / `onload` / `onerror` / `decode()` (Skia codecs:
  png, jpg, webp, bmp, gif-first-frame): S. `Image` IS the drawable, as in a
  browser; there is no separate bitmap type on the game-facing surface.
- `drawImage(img, dx, dy)` / `drawImageScaled` (5-arg) / `drawImageRect`
  (9-arg): S. The dialect has no overloads, so each arity is its own method
  name. Draws of another canvas
  (offscreen surface): S via `sg.createCanvas(w, h)` returning a
  Context2D whose backing surface can be a drawImage source
  (skiac_canvas_draw_surface exists).
- `createImageData putImageData`: S (pixels IN is the supported FFI
  direction; skiac_canvas_put_image_data exists).
- `getImageData`: D-tier ergonomics, S-tier existence: implemented via the
  per-pixel readback protocol, documented as debug-speed. Real use cases
  get a host-side PNG write, driven by `SG_SHOT`: S.
- `imageSmoothingEnabled/Quality`: S.

### X (out, with reasons)

- `drawFocusIfNeeded`, hit regions: DOM concepts.
- `ImageBitmap`, `OffscreenCanvas` transfer semantics: no workers here;
  `sg.createCanvas` covers offscreen composition.
- Canvas element `.toDataURL`: base64 data URLs have no consumer;
  `sg.screenshot(path)` and (D) `encodeToFile(format, quality)`.

---

## Web Audio (`sg.audio`)

Backed by the webaudio-node C++ graph verbatim, so behavior parity with the
existing WASM build is a test target, not a hope. Sample-accurate scheduling
preserved (`current_sample` counters render-side).

### S in v1

- `AudioContext` (`new AudioContext()`; the device is a process-wide
  singleton, so a second construction returns the same context). `sampleRate`,
  `currentTime`,
  `destination`, `state`, `suspend/resume`).
- Nodes (all 15 engine types): Gain, Oscillator, BufferSource, BiquadFilter,
  Delay, StereoPanner, Panner, DynamicsCompressor, WaveShaper, Convolver,
  ChannelMerger, ChannelSplitter, ConstantSource, IIRFilter, Analyser.
- `AudioParam`: value, setValueAtTime, linearRampToValueAtTime,
  exponentialRampToValueAtTime, setTargetAtTime, cancelScheduledValues.
- `decodeAudioData(bytes) -> Promise<AudioBuffer>` (sync native decode of
  wav/mp3/flac/ogg/aac, resolved promise for API familiarity).
- `connect/disconnect` including param connections if the engine supports
  them today (audit in Phase 4.1; else D).
- Analyser: `fftSize`, `frequencyBinCount`, per-bin scalar reads wrapped as
  `getFloatFrequencyData(array)` filling a caller array TS-side (one FFI
  call per bin; documented cost; fine for typical 256-1024 bins).

### D

- OfflineAudioContext as public API (the engine supports offline render;
  v1 uses it internally for parity tests only).
- MediaStream/microphone input (media_stream_source.cpp exists in the
  engine; needs SDL capture wiring).
- `AudioListener`/full HRTF panning options beyond what the engine's
  PannerNode implements.

### X

- AudioWorklet / ScriptProcessorNode: requires callbacks into TS from the
  audio thread; impossible under FFI format 1 and wrong for the
  architecture even if possible. Custom DSP goes into the C engine (the
  wave_shaper + iir nodes cover most game needs).
- `MediaElementAudioSourceNode`: no media element exists.

---

## Input (`sg.input`)

### S

- Polled keyboard: `isDown(code) wasPressed(code) wasReleased(code)` with
  W3C `KeyboardEvent.code` names mapped from SDL scancodes.
- Text input: `onText(handlerRegisteredAsPolledQueue)` (drain-a-queue shape,
  not callback shape: `sg.input.textEvents(): string[]` per frame).
- Mouse: position in logical coordinates, buttons, wheel.
- Gamepads: `sg.input.gamepads(): Gamepad[]`, Gamepad-shaped records
  (`id index connected axes[] buttons[{value,pressed}] mapping:"standard"`),
  hot-plug add/remove reflected each frame, standard mapping via
  SDL_GameController + `addMapping(sdlMappingString)`.
- Rumble: `gamepad.vibrationActuator.playEffect("dual-rumble", {...})`
  mapped to SDL_GameControllerRumble: S.
- Window events surfaced as state: `sg.screen.focused`, resize (logical
  size fixed; scale changes), quit veto via `onQuit`.

### X

- DOM event objects/addEventListener: polled state + drained queues only.
  (Event-shaped records are constructible on top by user code if wanted.)

---

## Assets (web APIs, web root)

The game directory is the web root, with `public/` preferred when present, the
same rule jsgamelauncher uses. There is no `sg.assets`: assets load through the
same APIs a page uses.

- `new Image()` + `src`, `fetch(url)` -> `arrayBuffer` / `text` / `json`,
  `FontFace.load()`, `decodeAudioData`: S.
- Relative paths resolve against the web root; `http://`, `https://`, `//`,
  `data:` and `blob:` are treated as real URLs. This build has no network
  stack, so those report `ok === false` rather than reading a file: S.
- The web root is baked at build time and overridable with `SG_GAME_DIR`: S.
- Failures warn to the terminal naming the resolved path, since an unhandled
  rejection is otherwise silent: S.
- `engine/assets.ts` adds an optional batching loader with progress and a
  `failed()` list. Optional: a game can skip it entirely.
- Single-file pak mode: D.

---

## Conformance strategy

- Canvas: scene-per-feature PNG goldens vs Node + @napi-rs/canvas at the
  pinned CANVAS_VERSION; byte-identical expected (same Skia).
- Audio: offline render hashes vs webaudio-node WASM build; bit-exact
  expected (same C++ core).
- Input: manual test page + scripted SDL virtual-device tests where SDL
  supports them (virtual joystick API): S for axes/buttons.
- Every API entry in this document gets a row in
  `test/coverage-matrix.md` marked S/D/X with its test's path, kept in CI.
