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
