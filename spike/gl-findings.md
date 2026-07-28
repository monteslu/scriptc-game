# Phase 8 spike: what the GL tier actually costs

Measured against `/usr/include/GLES3/gl3.h` (246 entry points) and a real
scriptc FFI build, not estimated.

## The load-bearing assumption HOLDS

Raw GLES3 binds straight through scriptc's FFI with **zero shim code**:

    declare function glCreateShader(type: number): number;

with `system_libraries: ["GLESv2", "EGL"]` links and calls successfully.
Verified end to end (`spike/gltest.ts` builds, runs, `glGetError` returns).
That is the whole premise of the plan's "most of the ~246 entry points bind
straight from the manifest with zero shim code".

## The surface splits three ways

| Category | Count | Shim needed |
| --- | --- | --- |
| Pure scalar passthrough | 105 | none, straight from the manifest |
| Float args, no pointers | 18 | thin: f32 narrowing only |
| Pointer args | 123 | yes |

## The plan missed one thing: there is no f32

scriptc's FFI accepts `f64/bool/u8/u32/i32/string/bytes`. GL is full of
`GLfloat`, so `glClearColor(f32,f32,f32,f32)` is rejected outright:

    error SC5001: 'functions[2].params[0]' must be one of
    f64/bool/u8/u32/i32/string/bytes, got "f32"

Passing them as `f64` links and runs, but the ABI is then wrong: the callee
reads 32-bit floats off a 64-bit-float call. The 18 float-only entry points
therefore need a narrowing shim (`sg_gl_clear_color(double,double,double,
double)` calling `glClearColor((GLfloat)r, ...)`), which is mechanical and
generatable.

Worth raising upstream: an `f32` FFI class would delete that shim layer
entirely and is a small addition next to `f64`.

## Revised estimate

The plan's "~600-line shim" covers out-params, info logs, readback and
GLsync. Add ~18 trivial float wrappers to that. Still small; the bulk of
Phase 8 remains the 1,275-line webgl2-context.mjs port, as planned.


## 8.1 codegen: done and verified

`codegen/gen-gl.js` parses the pinned GLES3 header and emits two artifacts
that cannot drift from it:

    shim/sg_gl_gen.cpp   18 narrowing wrappers (float entry points only)
    host/gl-ffi.ts       118 declarations

Split of the 246 entry points:

| Bucket | Count | What it means |
| --- | --- | --- |
| passthrough | 100 | direct declare, no C wrapper at all |
| narrow | 18 | double -> GLfloat wrapper (the missing f32) |
| manual | 128 | pointers; hand-written as WebGL2 needs them |

Verified end to end rather than by inspection: the generated C compiles,
the generated declarations build through scriptc against a real manifest,
and the resulting binary runs, calling both a passthrough entry point and a
narrowing wrapper (`spike/glgen-test.ts`).

### Two things the generator got right by refusing to guess

`GLsync` is the one GL object that is a pointer rather than a `u32` name,
so the five entry points touching it (`glFenceSync`, `glIsSync`,
`glDeleteSync`, `glClientWaitSync`, `glWaitSync`) cannot cross the FFI as
scalars. The first run REPORTED them as unclassifiable instead of emitting
something plausible; they are routed to manual, for the handle table the
plan already calls for.

The manifest is all-or-nothing per program: every entry needs a matching
declaration, so a manifest listing all 118 against a program declaring 4
fails with 114 errors. `gen-ffi.js` already handles exactly this by walking
the entry file's import graph, so the GL manifest folds into the existing
mechanism rather than needing a new one.

### Next

8.2 (context/present model) and 8.3 (the webgl2-context.mjs port) are the
remaining bulk. The 128 manual entry points are NOT all needed up front:
they get written as the WebGL2 layer reaches them, which is what keeps the
shim near the plan's ~600-line estimate.

## 8.2 context and present: decided, and both lanes verified

The plan left this open ("SDL GL window vs pbuffer composite, per
platform"). Both were tested; the answer is **both, chosen by whether a
display exists**, and neither needs new invention.

### Windowed: one window serves 2D and GL

The 2D path draws Skia raster into an SDL *renderer* texture. The worry was
that the renderer owns the GL context, so a WebGL2 game would need its own
window. It does not:

- `SDL_GL_CreateContext` on a renderer-backed window **succeeds** (the
  renderer's own backend already reports `opengl`).
- Raw `glClear` and `SDL_RenderPresent` interleave correctly when
  `SDL_RenderFlush` is called between them, which is SDL's documented seam
  for exactly this.
- Requesting `SDL_GL_CONTEXT_PROFILE_ES` 3.0 yields a real
  **OpenGL ES 3.2** context with working ES3-only entry points
  (`glGenVertexArrays` returns a name, no error), rather than the desktop
  4.6 compatibility context the default request gives.

So a game can use Canvas 2D, WebGL2, or both, in one window. That also
means the existing present path is untouched by this phase.

### Headless: EGL device platform + pbuffer

`SDL_VIDEODRIVER=dummy` cannot create a GL context at all ("Invalid
window"), so the CI lane cannot reuse the 2D headless trick.

EGL's device platform needs no display server and works here today:
3 EGL devices enumerated, EGL 1.5, an **OpenGL ES 3.2** context on a
pbuffer, and `glReadPixels` returning the expected clear colour
(25/51/76/255 for a 0.1/0.2/0.3 clear -- standard float-to-byte rounding).

This is the same shape as native-gles's `egl_context.cpp`, which already
does device enumeration and pbuffer creation, so the plan's "compile
native-gles's N-API-free egl_context.cpp into the shim" holds.

Note xvfb is the other option and CI already installs it for the browser
proof. EGL is preferable: no X server, no display at all, and it is the
path that keeps the readback lane honest about being GPU work.

### Consequence for the conformance lane

Readback-hash parity (the 8.4 gate) runs on the pbuffer lane, which needs
no display, so it fits CI as-is.
