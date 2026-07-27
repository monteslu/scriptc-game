# Phase 0 Spike Results

Run 2026-07-27. Host: Linux x86_64, Node v24.16.0, clang 21.1.8,
scriptc 0.0.17 (latest; FFI landed in 0.0.15, so it is two releases old).

**Verdict: Phase 0 gate PASSED.** All kill criteria cleared, with one real
upstream compiler bug found that has a cheap, mechanical workaround.

## Results

| # | Spike | Result |
| --- | --- | --- |
| 0.1 | Linux-host scriptc | **PASS**, and better than planned. `npm i scriptc` (6 packages), builds and runs natively on Linux. Risk R2 is dead: no macOS build host needed. Hello-world: 3.5s cold build, 395KB binary. |
| 0.2 | FFI hello, all ABI classes | **PASS**. f64, bool, u8, u32, i32, void, string, bytes all round-trip correctly. |
| 0.3 | FFI call overhead | **PASS, spectacularly.** 2.5-3.3 ns/call over 10M calls of `f64(f64)`. Budget was <1µs; this is ~300x under. |
| 0.4 | Float32Array as bytes | **PASS with a required idiom.** See below. |
| 0.5 | Long-running alloc churn | **PASS**. 200k iterations x 10 objects = 2M allocations, RSS 2.5MB, no growth. |
| 0.6 | Foreign native thread | **PASS**. A pthread spawned by the C archive ran and advanced its atomic counter throughout the churn loop, then joined cleanly. scriptc's runtime is undisturbed. The audio-thread architecture is viable. |
| 0.7 | fs + typed arrays across FFI | **PASS**. `readFileSync` gives a Buffer that passes straight into a `bytes` param. |
| 0.8 | License | Deferred (not a gate; scriptc is a public npm package, terms to confirm before any distribution). |
| 0.9 | Class accessors | **PASS**. `get x()` and `set x(v)` both compile and work. WebGL tier can use `drawingBufferWidth` and threeTS-lite can use property-style APIs. |
| 0.10 | Shared-library linking | Deferred to Phase 8 (not needed for the 2D tier, which links static archives only). |

## The measurement that shapes the architecture

**2.5-3.3 ns/call.** For context, a heavy 2D frame of ~500 draw calls plus
~50 state calls costs about **1.8µs of boundary overhead per frame**, or
0.011% of a 16.6ms budget. Consequences:

- The Phase 7 "draw-call batching / command buffer" stretch item is
  **cancelled as unnecessary**. It was contingent on this number.
- Per-pixel and per-bin scalar getters (readback, analyser bins) are far
  more viable than assumed. A 256-bin analyser read is ~0.8µs.
- No reason to fear chatty wrappers anywhere in the runtime.

## Required idiom: bulk float upload

`new Uint8Array(f32.buffer, off, len)` is **not** supported (SC2020: 3-arg
form has no lowering; SC1090 for the 1-arg `.buffer` form). The compiler's
own diagnostic names the supported path, and it works:

```ts
const view = Buffer.from(f32.buffer, byteOffset, byteLength);  // zero copy
sgUploadMatrix(view);                                          // bytes param
```

Verified round-trip: 1.5 and -3.25 arrived bit-exact as C floats. So
`bytes` params in the runtime are typed `Buffer`, not `Uint8Array`, when
they carry float data. (`readFileSync` also returns a Buffer, so the asset
path is uniform.)

## Upstream bug: FFI call dropped on single-assignment locals

**This is the one real hazard found, and it is silent.**

An `--ffi` bound call is dropped when its result initializes a local that
is **never reassigned**. The build succeeds with no diagnostic; the program
dies at load with `Uncaught ReferenceError: <name> is not defined` (nothing
prints at all, so the error points away from the real cause).

The trigger is single assignment, not the `const` keyword:

```ts
let a = sgF64(21); console.log(a);            // FAILS
const a = sgF64(21); console.log(a);          // FAILS
let a = sgF64(21); a += 1; console.log(a);    // works
console.log(sgF64(21));                       // works (no binding)
function f(v: number) { return sgF64(v); }    // works (no binding)
const o = { v: sgF64(5) }; console.log(o.v);  // works
let s = 0; s += sgF64(7);                     // works
this.id = sgU32(seed);                        // works (class field)
arr.push(sgF64(i));                           // works
```

Emitted C shows the cause: it declares `extern double sg_f64(double)` and
then never calls it, lowering the reference to
`scr_undef_global_read` instead, i.e. the name resolved as an undefined
global rather than the manifest's binding. Reproduces identically on
`--backend llvm` (default) and `--backend c`, across every ABI class and
every scope tried.

Repro preserved at `spike/const-ffi-repro.ts`.

### Codegen rule this forces (mechanical, no architecture change)

Every generated FFI wrapper returns the call **directly** rather than
binding it:

```ts
// generated wrapper shape: safe
export function canvasDrawRect(c: number, x: number, y: number,
                               w: number, h: number, p: number): number {
  return sgCanvasDrawRect(c, x, y, w, h, p);   // direct return: no binding
}
```

Handle-producing calls assign to class fields (`this.id = sgPaintCreate()`),
which also works. Both shapes were verified end to end. The codegen
generates all of them, so the rule is enforced by a generator, not by
developer discipline; a lint rule in the runtime package covers hand-written
code.

**Status:** reported upstream. Retest on every scriptc pin bump; when fixed,
the rule becomes optional (harmless either way).

## Incidental findings

- **Manifests are all-or-nothing per program.** Every function in the
  passed manifest must have a matching `declare` in the compiled program,
  or the build fails with SC5xxx. So the build script must emit a
  per-program manifest (or one manifest matched to a single declarations
  module that every program imports). The plan's "merge fragments at build
  time" step handles this; it is now a hard requirement, not a convenience.
- **Zero-arg FFI functions**: initially suspected broken, but that was a
  symptom of the manifest rule above. Not independently retested; the shim
  gives every function at least one parameter anyway (cheap insurance).
- Build times: 3.5s cold for hello-world, ~2-3s for the FFI tests. Fine
  for a dev loop; incremental behavior still unmeasured (Phase 1).

## Gate decision

Proceed to Phase 1. No kill criterion was met; the FFI overhead result
strengthens the design, and the one bug found is contained by a codegen
rule.

---

# Phase 1 Results: window + bouncing square PoC

Run 2026-07-27, same host. **Phase 1 gate PASSED.** The full stack runs:
dialect TS -> scriptc -> FFI -> shim -> Skia raster -> SDL texture -> screen.

## What shipped

`examples/bounce/` builds to a single 29MB static binary with no runtime
dependency on Node, and draws a rotating square over a grid at vsync.
`scripts/build.sh <entry.ts>` is the whole build: regenerate the manifest,
compile + merge the shim, invoke scriptc.

## Measurements

| Lane | Frames | avg | min | max | hitches |
| --- | --- | --- | --- | --- | --- |
| x11 window, vsync | 150 | 32.79ms (30.5fps) | 2.90 | 34.97 | 0 |
| x11 window, vsync (repeat) | 150 | 32.89ms (30.4fps) | 2.73 | 35.02 | 0 |
| x11 window, no vsync | 2000 | 0.19ms (5315fps) | 0.14 | 3.22 | 0 |
| headless (dummy) | 200000 | 0.16ms (6262fps) | 0.14 | 0.86 | 0 |

- **RSS flat at 7.3MB** across 200k frames (sampled every 4s; identical to
  the kB at every sample). Gate was <64MB.
- **Handle counters return to 0** in every domain at exit, every lane.
- Binary: 29MB static (Skia dominates; unstripped, no size work done yet).

## The 30Hz discovery, and the stats bug it exposed

The dev display is **3840x2160 @ 30Hz** (4K over an HDMI 1.4-class link).
So 32.8ms/frame is *correctly locked vsync*, not a slow present: a bare SDL
program that only calls RenderClear+RenderPresent measures the same 33ms,
and with vsync off our full draw+present costs 0.19ms.

That is a hardware fact, but it caught a real bug in `Stats`: hitches were
counted against `fixedStepMs` (16.67ms), so on a 30Hz panel **every frame
scored as a hitch** (177/180). The frame budget is the DISPLAY's, not the
simulation's. Fixed by adding `sg_display_hz()` to the shim and pacing the
hitch threshold off the actual refresh; the fixed update step is unchanged
(the accumulator is precisely what decouples the two rates).

Lesson for the CI report in Phase 6: **never hardcode 60**. Publish
`display=<hz> budget=<ms>` alongside frame times, or the numbers are
uninterpretable across machines.

## Bugs found and fixed in Phase 1

1. **libc++ vs libstdc++.** build-libcanvas compiles Skia against LLVM's
   libc++, so every std:: symbol in the vendored archives is `std::__1::`.
   The manifest's `system_libraries` listed `stdc++`, which left thousands
   of undefined references at link. Fixed: `c++` + `c++abi` in the manifest,
   and `-stdlib=libc++` when compiling the shim's C++ (ABI must match at the
   skia_c.hpp boundary, not just resolve).
2. **Missing C linkage guard.** `sg_tables.c` is C11, `sg_core.cpp` is C++17;
   `sg_tables.h` had no `extern "C"` block, so C++ emitted mangled references
   the C definitions never satisfied. Fixed in the header.
3. **Headless renderer.** `SDL_RENDERER_ACCELERATED` is unavailable under
   `SDL_VIDEODRIVER=dummy`, so init failed with "Couldn't find matching
   render driver". Since drawing is Skia-on-CPU either way and the renderer
   only blits the finished frame, the shim now falls back to
   `SDL_RENDERER_SOFTWARE`. One code path serves windowed and headless.
4. **Path handle leak (1 per beginPath).** `Context2D.beginPath()` freed the
   old path only when a `pathOpen` flag was set, but the constructor also
   allocates one, so the first path per context leaked and the flag bought
   nothing. Caught by the handle counters, exactly what they exist for.
5. **Canvas handle leak.** `sg_screen_canvas()` allocates a table slot per
   call and nothing released it. The canvas is *borrowed* from its surface,
   so `sg_canvas_release()` reclaims the slot without destroying the object.

## Added ahead of plan

- **`sg_surface_save_png(path)`** (PLAN 2.4). Pulled forward because a
  render pipeline that is never looked at is not verified: the first
  screenshot is what proved pixels were real. Keeps readback native (no
  per-pixel FFI, and format 1 cannot return bytes anyway). The conformance
  harness in Phase 2 uses this same entry point.
- **Screenshot hook in the loop** (`shotPath`/`shotFrame`), captured after
  draw and before present, so headless and windowed runs save identical
  pixels.
- **`string` params in the codegen.** A `string`/`bytes` argument is ONE TS
  parameter that expands to the C pair `(const uint8_t*, size_t)`.
  `gen-ffi.js` now collapses that pair, using the TS declaration's type to
  pick the class (`string` vs `Buffer`) since the C types are identical.

## Notes for Phase 2

- Incremental rebuild of the example is ~10s wall (shim compile + scriptc);
  the Skia archive merge is cached and only re-runs when inputs change.
- `skiac` exposes **no path reset**, so `beginPath()` must destroy and
  recreate. Fine at measured FFI prices, but worth revisiting if a profile
  ever disagrees.
- The napi-rs/canvas golden comparison (2.5) is still unwritten; PNG output
  now exists on both sides, so it is unblocked.

---

# Phase 2 Results: Canvas 2D, text, images, conformance

Run 2026-07-27, same host. **All 53 conformance scenes are byte-identical**
to @napi-rs/canvas goldens rendered at the same pinned CANVAS_VERSION (1.0.0)
and therefore the same Skia build.

`./scripts/conformance.sh` runs the whole loop: build harness, render scenes
headless, render goldens under Node, compare pixels.

## Why "byte-identical" is a fair bar here

build-libcanvas builds our Skia archives from the same commit @napi-rs/canvas
ships, and `render-goldens.mjs` refuses to run if the installed canvas version
does not match `vendor/<target>/CANVAS_VERSION`. Same Skia, same version, same
scene: any difference is OUR bug. No tolerance is configured anywhere, and
none should be added.

The comparison decodes both PNGs and compares RGBA buffers rather than file
bytes, because two encoders can emit different chunk layouts for identical
pictures. The claim under test is about the picture.

**The harness is verified to fail.** Perturbing a single pixel by 1 in a
single channel is reported (`1/30000 px differ, max channel delta 1`). An
all-green run from a broken comparator would look exactly like a real pass,
so this control is re-run whenever the suite changes shape.

## Coverage

53 scenes across: rects, alpha, all path verbs (lines, bezier, quadratic,
arc, arcTo, ellipse, rect, roundRect), both fill rules, line width/cap/join/
miter/dash/dashOffset, transforms (translate/rotate/scale/transform/
setTransform) and save/restore, clipping (rect and path), clearRect, linear/
radial/conic gradients and multi-stop ramps, four composite operations, CSS
colour formats, text (fill, stroke, align, baseline, weight/style, sizes),
images (natural, scaled, sub-rect, alpha, smoothing on/off), and patterns
(repeat, no-repeat).

## The header lies; the implementation is authoritative

Four of the bugs below came from trusting `skia_c.hpp`. Its declarations are
accurate about TYPES and unreliable about MEANING: parameter names and struct
layouts drift from the bodies in `skia_c.cpp`. **Read the implementation
before wrapping anything**, especially anything taking a rect or filling an
out-param.

| What the header says | What the code does |
| --- | --- |
| `skiac_path_add_rect(l, t, r, b)` | `SkRect::MakeXYWH(x, y, w, h)` |
| `skiac_line_metrics` (assumed skparagraph's) | eight floats, nothing else |
| `skiac_bitmap_info` (assumed a pixel span) | `{bitmap*, int, int, bool}` |
| `skiac_matrix_new(a..f)` pass-through | row-major `MakeAll`; canvas is column-major |

## Bugs found, in the order conformance surfaced them

1. **rect() ran to the canvas edge.** `skiac_path_add_rect` is XYWH, not
   LTRB (see above). Affected rect, clip-rect, both fill-rule scenes.
2. **Sheared shapes landed at the wrong origin.** Canvas `transform(a,b,c,
   d,e,f)` is column-major `[a c e / b d f]`; `skiac_matrix_new` feeds
   `SkMatrix::MakeAll`, which is row-major. The tuple needs reordering to
   `(a,c,e,b,d,f)`.
3. **Every full circle and ellipse silently vanished** while half circles
   were byte-perfect: a 360-degree sweep through Skia's `arcTo` draws nothing
   because the start and end points coincide. Full sweeps are now split into
   two 180-degree arcs.
4. **1321 leaked path handles in 120 frames.** Generated `*_destroy` wrappers
   used `sg_table_get`, which leaves the table slot occupied. They now use
   `sg_table_take` and are idempotent on a stale handle.
5. **Segfault on the first stroke.** `skiac_paint_set_shader` and
   `set_path_effect` call `->ref()` on their argument with no null check, and
   handle 0 (clear the shader / solid line) is the COMMON case. skiac exposes
   no "clear" entry point (napi-rs/canvas never needs one: it builds a fresh
   SkPaint per draw). Clearing now swaps a pristine SkPaint in behind the same
   handle via `sg_table_replace`.
6. **All text laid out right-to-left.** `TextDirection` is `{kRtl = 0,
   kLtr = 1}`; passing 0 for "LTR" laid text out from `MAX_LAYOUT_WIDTH` and
   compensated, pushing strings off the left edge.
7. **measureText returned zeros**: `skiac_line_metrics` is eight floats, not
   skparagraph's much larger `LineMetrics`. With the right layout, width
   matches the reference exactly (114.2699966430664 for a 24px sample).
8. **measureText segfaulted before that**: the text entry point does
   `text_style.setForegroundColor(*PAINT_CAST)` unconditionally, so the paint
   is NOT optional even when only measuring. Measuring borrows a shim-owned
   scratch paint.
9. **Bold text differed.** Registering only the regular face made both sides
   SYNTHESIZE bold and italic, and they synthesize differently. All three
   faces are now registered; text scenes name the family explicitly so
   neither side resolves through a system font manager (250-odd fonts, so a
   diff would mean "different machine" not "different renderer").
10. **Image decode always failed**: `skiac_bitmap_make_from_buffer` returns a
    READY bitmap in its info struct; the shim was trying to re-wrap a pixel
    span that does not exist there.
11. **Off-by-one alpha, twice, in opposite directions.** The reference uses
    TWO different rules and conformance rejects either one applied
    everywhere: colour fills TRUNCATE globalAlpha to a byte (`... as u8`, so
    0.25 -> 63) while drawImage ROUNDS (`(alpha*255).round()`, so 0.25 -> 64).
    Colours additionally round twice, storing globalAlpha as a byte first and
    then computing `(a/255 * ga/255 * 255).round()`. Unifying the rule made
    one scene pass and another fail, alternating, until they were separated.

## Codegen

`codegen/gen-shim.js` parses `skia_c.hpp` and emits both the C wrappers and
the matching TS declares from one allowlist, so the two cannot drift. 83
functions generate; 17 are hand-written in `sg_skia_extra.cpp`, each with a
reason recorded in `skia-allowlist.json` (array params, struct-by-value,
struct out-params, and the two null-crashing setters).

The generator REFUSES to emit anything it cannot classify rather than
guessing, which is what caught `draw_picture` needing a handle domain that
does not exist yet. That refusal is the feature; keep it.

## Notes for later phases

- `skiac` has no path reset, so `beginPath()` destroys and recreates. Fine at
  measured FFI prices.
- The paint-reset trick (swap a pristine SkPaint behind the same handle) is
  only needed because skiac cannot clear a shader. If upstream ever adds a
  clear, `sg_paint_reset` and `sg_table_replace` can go.
- Text state is a shim-owned block set by scalar calls and committed by one
  draw/measure call, rather than 26 arguments per call. The same shape will
  suit the audio graph's command ring in Phase 4.
- `Math.round`/`Math.floor` compile in the static tier; `Math.PI` does not.

---

# Phase 3 Results: Input

Run 2026-07-27, same host. **Phase 3 acceptance met**, with the hardware half
confirmed on a real Xbox 360 pad and the mechanical half automated.

`./scripts/test.sh` now runs every automated suite headless: canvas
conformance (55), readback, input (89 checks), and the pad visual proof.

## The acceptance gate, and how it was actually met

The plan asked for "a test page showing live state of every axis/button of
two physical pads + keyboard + mouse; hot-plug works; rumble works". No CI
machine has two pads, so the gate is split:

- **`examples/inputs/`** is the live display: keyboard (held keys, mods,
  focus), mouse (position, wheel, buttons), and every connected pad with all
  17 standard-mapping buttons and 4 axes. Run on this box it detects the
  real controller as `slot 0: X360 Controller, rumble: yes`.
- **`test/inputtest.ts`** is the mechanical proof, using SDL's VIRTUAL
  JOYSTICK. A synthetic controller goes through the identical path -- device
  add event, slot assignment, standard-mapping accessors, disconnect -- so
  89 checks cover every button, every axis extreme, analog triggers, and
  hot-plug with no hardware at all. Verified it FAILS when the mapping is
  wrong: swapping A and B in the table trips seven checks, including the
  "no mapping bleed" assertion that catches a shifted table.
- **`test/padvisual.ts`** closes the gap between "the accessors return the
  right numbers" and "the screen shows them". A display can pass every
  numeric check while rendering a static layout, so this drives a synthetic
  pad into a known pose (A + dpad-right held, stick on a diagonal, trigger
  half-pulled) and saves the frame. All four are distinct code paths:
  digital button, dpad, analog axis, analog trigger.

Virtual pads are shipped in the runtime rather than kept test-only, because
the same entry points are how replay and remote input would be fed in.

## Bugs found

1. **One physical pad appeared TWICE.** `sg_input_init` opens the pads
   present at startup, and initialising the subsystem ALSO queues a
   CONTROLLERDEVICEADDED for each of them, so the same device landed in two
   slots and `getGamepads()` returned it twice. `pad_open` now rejects a
   device whose instance id is already open. Caught by the input test
   reporting "pads already connected: 2" on a box with one controller.
2. **`Number.toString(radix)` is fenced** (SC2012: it runs in the embedded
   dynamic engine, which static builds never include). Hex formatting in the
   input demo is hand-rolled. Worth knowing before Phase 5 writes any
   debug UI.
3. **The manifest is all-or-nothing PER PROGRAM**, which only bit once the
   test programs stopped importing the canvas: a manifest listing skia
   bindings fails to build for a program with no skia declares. `gen-ffi.js`
   now walks the entry file's IMPORT GRAPH and emits only the declarations
   that program actually contains (65 bindings for the input test, 146 for
   the full demo). This was a latent Phase 0 finding that had never been
   exercised.

## The virtual trigger quirk (not a bug)

SDL's default virtual-controller mapping declares the trigger axes FULL
RANGE, so it rescales -32768..32767 onto the trigger's 0..32767: a raw
joystick value of 0 reads as HALF PULLED, and -1 is what releases it. A real
pad reports its resting trigger correctly. The test speaks the virtual
device's language rather than pretending otherwise, and says so in a comment
where it would otherwise look wrong.

## Design notes

- Keys are named the way the web names them (`isDown("ArrowLeft")`), never by
  scancode. `codegen/gen-keycodes.js` generates the 132-entry mapping from
  `SDL_scancode.h`: SDL scancodes ARE USB HID usage ids, the same physical-key
  basis W3C `KeyboardEvent.code` uses, so the two map 1:1 and the table is
  transcription a generator should own.
- Pads are addressed by SLOT, not by SDL instance id (unbounded, reused) and
  not by list position (shifts when a pad unplugs). A disconnected pad leaves
  its slot empty rather than compacting, so an index already handed to game
  code never silently refers to a different device.
- Gamepad records are POOLED, not rebuilt per frame: a game holding
  `gamepads()[0]` across frames sees it update, and 17 button records per pad
  per frame would be pure garbage.
- Losing window focus RELEASES everything held. Otherwise alt-tabbing
  mid-move leaves the key stuck down and the character runs into a wall
  forever. Same on pad disconnect.
- A key REPEAT is not a fresh press, so `wasPressed` stays a true edge.
- Text input is off by default (SDL emits TEXTINPUT for every keystroke and
  may show an IME) and drains as a QUEUE, because text is a sequence rather
  than a state. Multi-byte UTF-8 is decoded properly, including surrogate
  pairs for astral-plane input.

---

# Phase 4 Results: Audio

Run 2026-07-27, same host. webaudio-node's C++ graph runs NATIVE, driven from
an SDL audio thread. 16/16 offline checks; live playback verified on the real
device (PipeWire) via test/beeptest.ts.

## 4.1 The emscripten audit: better than hoped

6,641 lines across 25 files, and the engine uses **nothing** from emscripten
except the `EMSCRIPTEN_KEEPALIVE` attribute: zero `EM_ASM`, zero
`EMSCRIPTEN_BINDINGS`, zero `emscripten_*` calls, zero try/throw/catch. The
export surface is already `extern "C"` with plain scalar/pointer signatures,
and the graph API is already integer-handle-based
(`createAudioGraph`/`createNode`/`processGraph`), which maps almost directly
onto FFI format 1.

So the port is a RECOMPILE, and the vendored source stays BYTE-IDENTICAL to
upstream. Two stub headers do the whole job:

- `shim/emscripten.h` supplies KEEPALIVE as a visibility attribute.
- `shim/wasm_simd128.h` is EMPTY. Two files include it unconditionally even
  though every use is guarded by `#ifdef __wasm_simd128__`; off-target that
  macro is never defined, so the contents are never referenced, but the
  include still has to resolve and clang's real header explodes off-target.

Keeping upstream unpatched is what makes a webaudio-node bump a re-fetch
rather than a re-port, and it is what makes the parity test meaningful: both
sides run the same code, not a fork.

Not built: `audio_decoders.cpp` hard-includes opusfile and libxaac headers
with no guard, so it needs ~600 codec sources. Games ship wav/ogg; that file
is skipped and the header-only decoders (dr_wav/dr_mp3/dr_flac, stb_vorbis)
remain available.

**Trap:** `src/wasm/webaudio.cpp` is a single-module AMALGAMATION that
redefines every node and util. Linking it alongside the individual files is a
wall of duplicate symbols. The source list mirrors upstream's own build
script exactly.

## 4.3 Threading

SDL calls the audio callback on its own thread; the engine is not thread-safe
against concurrent mutation, and scriptc's runtime must never be touched off
the main thread. One lock-free SPSC ring bridges them: the main thread
enqueues command records, and the audio thread drains the WHOLE ring at a
QUANTUM BOUNDARY before rendering. Draining only between quanta is what makes
it correct without a mutex -- a command never lands mid-render.

Calls that must RETURN a value (create a node, register a buffer) run on the
main thread instead. That is safe because a fresh node is unconnected: the
audio thread cannot reach it until a connect command is drained.

**Bug this design caused, and the fix:** offline rendering has no callback, so
nothing drained the ring and every graph rendered silence. The C-level probe
had worked because it called the engine directly while the TS path queued its
whole graph. `sg_audio_render_offline` now drains first; it is the only
consumer in offline mode, so it is safe there.

## The argument-order trap

`scheduleParamEvent` is `(graph, node, param, kind, VALUE, TIME, timeConstant)`
-- value BEFORE time. The natural reading is the opposite, and getting it
backwards silently corrupts every envelope: a ramp to 0.8 at t=2 becomes a
ramp to 2 at t=0.8. Transcribed from the definition, not guessed.

## What the offline test actually checks

Rendering to a 32-bit float WAV checks the parts that can be wrong -- wiring,
parameter ids, scheduling, node behaviour -- and produces a file comparable
against the WASM build. Measured, not eyeballed:

| check | result |
| --- | --- |
| nothing connected | peak 0 (the control) |
| 440Hz sine at gain 0.5 | peak 0.5000, mean 0.3183 (= 2/pi x 0.5, a perfect sine) |
| gain 0.5 -> 0.1 | peak 0.1000 |
| 440Hz -> 880Hz | 87 -> 177 zero crossings, exactly double |
| disconnect() | peak 0 |

Zero crossings are the check that matters most: amplitude looks perfect when
a frequency lands in the wrong parameter slot, and only counting cycles
catches it.

## Fixed upstream

`disconnectNodes` was a no-op stub, so a disconnected node fed its destination
forever. `src/javascript/AudioNode.js` already called the engine with both the
"one destination" and "everything" shapes, so that path was dead code.
Implemented in monteslu/webaudio-node (commit 1a1aea7, pushed): removes one
edge per call, since connecting a pair twice is legal and disconnect() undoes
one connect(). Also added `disconnectOutput` and `disconnectFromParam`, which
AudioNode.js called but the engine never defined (they would have thrown).
Upstream suite: 68/68, including three new disconnect tests; verified the old
no-op body fails two of them.

## Live playback

`test/beeptest.ts` opens the real device and plays five effects. It reports
the ENGINE CLOCK, which only advances when the callback runs, so "the device
is silent" is distinguishable from "the device never started": 2.432s
advanced, 0 commands dropped. Deliberately NOT in scripts/test.sh -- it needs
a sound card and makes noise.

`runtime/audio/sfx.ts` synthesises blip/pickup/hit/dash/gameOver from
oscillators and filters; a game ships a few numbers rather than a sample
library. Effects are scheduled against `ctx.currentTime` rather than fired
immediately, because the audio thread renders AHEAD: "now" on the main thread
is already past for the mixer, and scheduling is what preserves an envelope's
shape.
