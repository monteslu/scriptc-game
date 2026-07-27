# Risks, Kill Criteria, Open Questions

## Risk register

Ordered by (probability x impact). Each has a detection point in the plan
and a mitigation that is already designed in, not hoped for.

### R1: scriptc is v0.0.x from a Labs org (churn / abandonment)  [HIGH prob, MED impact]
scriptc is 0.0.17, weeks old, from vercel-labs (experiments, not products).
The FFI manifest is explicitly "format 1"; the language fences move
release to release.
- **Detection**: pinned version; pin bumps are deliberate and re-run
  everything.
- **Mitigation**: exact pin in versions.json; the npm tarball + emitted C
  (`--emit-ir` keeps `.scriptc/x.c`) mean a frozen toolchain keeps working
  offline indefinitely. Structural insulation: the shim + archives + the
  runtime's API layer are scriptc-agnostic assets; if scriptc dies, the
  same stack retargets to any TS-AOT successor, or worst case the runtime
  API rides back on Node + the original N-API packages (jsgame-shaped).
  The sunk cost unique to scriptc is the ffi.json + declare blocks:
  generated, therefore cheap.
- **Note**: abandonment is also an upside scenario in one way: the emitted
  C is inspectable, and a pinned compiler that already does what we need
  does not rot quickly.

### R2: Linux-host compiler support is second-class  [CLOSED, Phase 0]
scriptc installs and builds natively on the Linux dev box; no macOS build
host is needed for development. Cross-compilation for the release matrix is
still a Phase 6 question, but the dev loop is unblocked.

<details><summary>original entry</summary>

Docs bless macOS arm64 as primary; Linux/Windows are documented as
cross-compile TARGETS. The npm package has no os restriction and the
compiler is Node+clang, so Linux hosting should work, but it is not the
tested lane upstream.
- **Detection**: Phase 0.1, day one.
- **Mitigation**: cross lane from a macOS runner is documented-supported
  for static builds (which is all we use); dev loop on Linux can also run
  scriptc under a pinned container if host quirks appear.
</details>

### R3: FFI format 1 gaps are permanent  [LOW prob, LOW impact]
No callbacks, no bytes/string returns, no struct-by-value, no dlopen.
- **Mitigation**: the architecture never needs them (polled events, shim
  thread audio, native-side sinks, mailbox). Every future FFI improvement
  only deletes shim code. The one real casualty is getImageData ergonomics
  (debug-tier per-pixel reads); accepted and documented in API-SURFACE.md.

### R4: Refcount GC pauses or leak surprises in game-shaped workloads  [MED prob, MED impact]
Deterministic refcounting frees at drop points; cycle collection runs at
deterministic collection points. A 60fps loop is exactly the workload
where a mis-timed collection shows as a spike.
- **Detection**: Phase 0.5 (10-minute churn loop, RSS + frame-time
  histogram), re-measured with real examples in Phase 5.
- **Mitigation**: dialect style is zero-steady-state-allocation (pools,
  scratch objects) which drives collection work toward zero; frame-time
  histograms in CI catch regressions. If cycle collection points prove
  jittery, the pool architecture means cycles basically don't exist
  (id-based backrefs).

### R5: skiac symbols might live in the Rust staticlib  [CLOSED, Phase 1]
**Resolved without the mitigation.** `skia_c.o` sits inside `libcanvas.a`
as a single object with zero `napi_*` and zero Rust references, so
`fetch-archives.sh` extracts it and re-archives it alone as `libskiac.a`
(the script refuses via `nm` if that ever stops being true). No change to
build-libcanvas was needed.

The link problem that DID bite was a different one: Skia is built against
LLVM's libc++, so the shim compiles `-stdlib=libc++` and the manifest links
`c++`/`c++abi`, not `stdc++`. See SPIKE-RESULTS Phase 1.

<details><summary>original entry</summary>

`skia_c.hpp` declares the C surface, but its implementation
(`skia-c/*.cpp`) might be compiled into `libcanvas.a` (the Rust crate's
staticlib) rather than the Skia archives. Linking `libcanvas.a` drags in
napi symbol references we cannot satisfy.
- **Detection**: Phase 1.1 (`nm` over the archives, ~5 minutes).
- **Mitigation**: build-libcanvas (monteslu-owned) adds a `libskiac.a`
  artifact compiling `skia-c/*.cpp` standalone against the Skia headers.
  Small, additive CI change in a repo we control.
</details>

### R6: f64-only math is too slow for some game workload  [LOW prob, LOW impact]
No integer inference yet; scriptc claims systems-competitive performance
but the ceiling is unproven for particle-heavy 2D.
- **Detection**: Phase 1 measurements; a particle-storm example in Phase 5.
- **Mitigation**: v1 target is 2D games where logic is a small slice of
  frame budget (Skia does the heavy lifting natively). Escape hatch that
  needs no new machinery: hot kernels (particles, tilemap collision) can
  move into the shim as plain C functions operating on bytes-passed
  Float32Array views. Same trick as WASM-era optimization, minus the WASM.

### R7: Float32Array-view-as-bytes is fenced  [MED prob, LOW impact]
The bulk-upload trick (`new Uint8Array(f32.buffer)`) might not compile in
the static tier.
- **Detection**: Phase 0.4.
- **Mitigation**: per-element scalar setters into a shim-side staging
  buffer, or a TS byte-packing helper. Ugly, contained, replaceable later.

### R8: SDL static-link friction on Linux  [MED prob, LOW impact]
Static SDL2 still runtime-dlopens video/audio drivers; distro variance can
bite (X11 vs Wayland dev headers at SDL build time, etc.).
- **Mitigation**: build SDL with both X11 and Wayland backends enabled;
  this is well-trodden territory (every commercial Linux game ships this
  way); jsgame/libretro work already established local SDL competence.

### R9a: ANGLE / shared-library linking for the GL tier  [MED prob, MED impact]
Linux links `-lEGL -lGLESv2` cleanly (`system_libraries`; the exact shape
native-gles's binding.gyp uses, verified by spike 0.10). macOS/Windows GL
is ANGLE, which ships as SHARED libraries; scriptc's manifest documents
archives for `libraries` and linker-neutral names for `system_libraries`,
and dylib/import-lib-by-path linking is unverified.
- **Detection**: spike 0.10 (Linux) + Phase 8.1 (ANGLE platforms).
- **Mitigation**: scriptc drives clang's linker, so this is likely just
  flag plumbing; worst case the WebGL tier ships Linux-first while an
  upstream passthrough lands, and native-gles's existing ANGLE artifact +
  rpath layout is reused verbatim once it does.

### R10: Class accessors fenced in the static tier  [MED prob, LOW impact]
Getters/setters are undocumented either way in scriptc's docs; webgl-node's
port (`drawingBufferWidth`) and three-shaped ergonomics (`.position`) both
prefer them.
- **Detection**: spike 0.9, day one.
- **Mitigation**: methods everywhere; purely cosmetic.

### R11: threeTS-lite scope creep toward three-compatibility  [HIGH prob if unguarded, HIGH impact]
The library invites "just support X like three does" forever; three.js is
~150k lines and its dynamic corners are exactly what the dialect fences.
- **Mitigation**: the S/D/X scope table in WEBGL-AND-3D.md is the
  contract; anything not listed is X by default and needs a doc PR, not a
  code PR, first. Positioning is written down: three-shaped, NOT
  three-compatible, game-sized. The spinfield benchmark keeps the focus on
  the actual product (fast native 3D games), not API checkbox coverage.

### R9: Scope creep toward "run existing web games"  [HIGH prob if unguarded, HIGH impact]
The most seductive failure mode: quickjs `--dynamic` would let unmodified
JS "work", slowly, and the project would quietly become a worse jsgame.
- **Mitigation**: hard invariant in CI (assert-fully-static gate);
  positioning is written down (familiar, not compatible); jsgame-libretro
  remains the answer for real web JS and this doc says so.

## Kill criteria (cheap, early, explicit)

- Phase 0: FFI overhead > 1µs/call, or runtime instability with a foreign
  native thread, or scriptc unusable on both Linux host AND macOS cross
  lane. Any one of these: stop, write up, park.
- Phase 1: cannot hold 60fps vsync for the bouncing square, or memory
  grows without bound in a trivial loop. Stop, diagnose upstream, park if
  upstream.
- Later phases have no kill criteria: past Phase 1 the physics of the
  thing are proven and the remaining work is engineering volume.

## Open questions (tracked, none blocking Phase 0)

1. Does scriptc accept multiple `--ffi` flags, or must manifests be
   merged? (Build script merges regardless; cosmetic.)
2. Is `scriptc build` incremental / what is warm rebuild latency for a
   ~10k-line program? Sizes the dev-loop story (Phase 1 measurement).
3. Exact C++ runtime linkage per target for Skia (libstdc++ vs libc++ on
   Linux cross builds via zig): resolves in Phase 1.1/6.1 empirically.
4. Does skiac expose enough for canvas shadows without a looper, or do
   shadows need the image-filter path? (Phase 2.2 check; shadows are D
   until then.)
5. webaudio-node engine: are param-connections (node output -> AudioParam)
   implemented in the C++ core today? (Phase 4.1 audit; D if not.)
6. scriptc LICENSE terms for redistribution of compiler output (Phase
   0.8; expected permissive, verify).
7. Windows console-vs-gui subsystem for the exe (SDL apps want
   WinMain/gui); does scriptc expose a subsystem flag or do we need a
   linker arg passthrough? (Phase 6.1.)
8. Public name. monteslu decides; nothing publishes before that. Same for
   "threeTS-lite" (working label only).
9. Do TS overload declarations with one implementation compile in the
   static tier? Decides the WebGL tier's texImage2D/bufferData public
   shapes (Phase 8.3 compile experiment; explicit variant methods are the
   fallback).
10. Can Skia-Ganesh and the GL scene share one context per platform given
    build-libcanvas's `skia_gl_standard` split (gl desktop / gles ANGLE +
    ARM)? Only matters for the composite present model; the SDL GL window
    model avoids it (Phase 8.2).

## Explicit non-goals (v0.1)

- 3D / WebGL in v0.1: scheduled as Phases 8/9 (WEBGL-AND-3D.md), not
  ad hoc growth.
- Running unmodified web/npm games (jsgame-libretro's job, permanently).
  This includes unmodified three.js: threeTS-lite is three-shaped, never
  three-compatible.
- Mobile targets (SDL+Skia reach them, scriptc does not today; revisit
  when scriptc grows iOS/Android targets, tracked in R1's watch list).
- Editor/IDE product around the framework (templates + CLI only for v1).
