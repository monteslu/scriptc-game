# WebGL Tier and threeTS-lite (3D Roadmap)

Two stacked phases, added after the v0.1 (2D) plan:

- **Phase 8: WebGL2 tier.** A `WebGL2RenderingContext`-shaped TS class over
  raw GLES3 FFI, porting webgl-node's semantics layer into the dialect.
- **Phase 9: threeTS-lite.** A scriptc-clean, three.js-shaped 3D library on
  top of that context, because three.js itself can never compile statically
  (plain JS + dynamic patterns; see the original research in README.md).

Research inputs (2026-07-27): webgl-node and native-gles source (local
checkouts), scriptc FFI format 1 docs, build-libcanvas GPU-surface notes.

---

## Why raw GL is an even better FFI fit than canvas

The canvas tier needed handle tables because Skia hands back pointers. GL
does not: **GL object names are already `GLuint`**, i.e. exactly scriptc's
`u32`. Buffers, textures, framebuffers, renderbuffers, programs, shaders,
VAOs, samplers, queries, transform feedbacks, uniform locations (`GLint`):
all integers, all pass through FFI unmodified with no shim state at all.
The sole pointer-typed GL object in ES3 is `GLsync`; it gets the one tiny
handle table of the tier.

Signature classes across the ~246 GLES3 entry points:

| Class | Examples | FFI treatment |
| --- | --- | --- |
| Scalars only (the vast majority) | glEnable, glBlendFunc, glDrawArrays, glUniform1f, glVertexAttribPointer (offset form) | Direct manifest binding, zero shim code |
| Bulk data IN | glBufferData, glBufferSubData, glTexImage2D/3D, glTexSubImage2D, glUniform*fv/iv, glUniformMatrix*fv, glCompressedTexImage2D | `bytes` param (borrowed, read-only: exactly GL upload semantics) |
| String IN | glShaderSource, glBindAttribLocation, glGetUniformLocation, glGetAttribLocation | `string` param (shim reassembles length-delimited to NUL-terminated where GL wants it) |
| Small out-params | glGetIntegerv, glGetFloatv, glGetShaderiv, glGetProgramiv, glGetActiveUniform (sizes/types), glGetVertexAttribiv | Shim calls into an internal scratch array; TS reads via `sg_gl_geti(slot) -> i32` / `sg_gl_getf(slot) -> f64` |
| String OUT | glGetShaderInfoLog, glGetProgramInfoLog, glGetString, glGetActiveUniform (name) | Existing string mailbox |
| Bulk data OUT | glReadPixels, glGetBufferSubData | Native-side sinks: save-to-file, per-pixel debug reads, or (for tests) shim-side hash of the readback (`sg_gl_read_hash(x,y,w,h) -> u32` pairs) |
| Excluded | glMapBufferRange / glUnmapBuffer, glGetBufferPointerv | native-gles already nulls these across its own boundary; use glBufferSubData. Same policy, same doc note |
| Pointer object | glFenceSync/glClientWaitSync/glDeleteSync | One GLsync handle table |

Codegen: same `codegen/` pattern as the Skia tier, but the source of truth
is the GLES 3.0 XML registry (gl.xml) or native-gles's `gl_bindings.cpp`
function list; classification by signature is mechanical, out-param and
string-out functions come from a small override list. Estimated shim code:
under 600 hand-written lines plus generated pass-throughs (many functions
need NO wrapper at all: scalar-only GL functions bind straight from the
manifest to libGLESv2 symbols with zero shim involvement, something the
Skia tier never got to do).

## Linking

native-gles's own binding.gyp is the proof of shape: it links plain
`-lEGL -lGLESv2` (system drivers on Linux/ARM, ANGLE's libEGL/libGLESv2 on
macOS/Windows). In scriptc manifest terms:

- Linux: `"system_libraries": ["EGL", "GLESv2"]`. Done.
- macOS/Windows: ANGLE ships as SHARED libraries (dylib/dll + import lib).
  scriptc's manifest documents archives/objects for `libraries` and
  linker-neutral names for `system_libraries`; linking against an import
  lib / dylib by path is a Phase 8 verification item (expected to work
  since scriptc just drives clang's linker; worst case a one-line
  `-L`/`-l` passthrough feature request, or Linux-first for the tier while
  that settles). The ANGLE binaries themselves already come from
  native-gles's fetch scripts; reuse the same artifacts and rpath layout.

## Context creation and present

Two proven models exist in this codebase family; the tier's first task
picks per-platform:

1. **SDL GL window (preferred for games).** `SDL_GL_CreateContext` with
   GLES3 attributes (Mesa exposes GLES3 on desktop Linux; ANGLE via
   SDL's EGL path elsewhere), render straight into the default
   framebuffer, `SDL_GL_SwapWindow` for vsync present. No pbuffer, no
   copy, no second context. The 2D canvas HUD composites as a GL texture:
   the Skia raster surface's pixels upload once per frame via
   glTexSubImage2D (bytes IN: supported direction) onto a fullscreen quad.
   HUD-sized uploads are small; this works everywhere and keeps ONE GL
   context in the process.
2. **EGL pbuffer + composite (webgl-node's model).** Offscreen EGL context
   via native-gles's N-API-free `egl_context.cpp` (compiled into the shim
   as-is), used when headless (CI conformance) or when the Skia-Ganesh
   composite path lands (build-libcanvas's GPU surface +
   `drawImage(webglCanvas)` GPU-to-GPU, the jsgame composite model).
   Dialect warning carried over from build-libcanvas: Skia archives are
   built `gl` on desktop and `gles` on ANGLE/ARM; sharing one context
   between Skia-Ganesh and a GLES-dialect scene requires matching builds.
   Resolution deferred to the phase; model 1 has no such constraint.

### Two traps in the 2D-canvas-as-texture path

Both of these are silent: the frame renders, it is just wrong. Both were
hit building `examples/runner` and both are fixed in the tree.

**A canvas is 300x150 until you say otherwise.** `document.createElement(
"canvas")` returns the HTML default size, exactly as in a browser. A HUD
that draws in 512x256 coordinates without assigning `width`/`height` first
draws into a surface roughly half that size and clips at the right edge,
with no error and a plausible-looking result. Assigning either dimension
reallocates the backing surface and clears it to transparent black, per
spec:

```ts
const hud = document.createElement("canvas");
hud.width = 512;                 // REQUIRED: the default is 300x150
hud.height = 256;
```

**Texture sources are top-down; GL is bottom-up.** A Skia surface's first
row is the top of the image, while GL texture space puts v=0 at the
bottom. Uploading rows as-is renders the HUD vertically mirrored, which on
text is obvious and on a symmetric panel is not. `texImage2DFromCanvas`
flips rows natively (`sg_gl_tex_image_from_surface`); the browser shim
does the same through `UNPACK_FLIP_Y_WEBGL`, saved and restored so it
cannot leak into other uploads. Call the helper rather than
`texImage2D` directly and the orientation is handled in both tiers.

Headless CI uses model 2 (pbuffer, dummy-video SDL not even needed) with
readback-hash assertions; that is exactly native-gles's designed-for mode.

## Porting webgl-node (Phase 8 core work)

webgl-node measured: 1,974 lines total. `webgl2-context.mjs` (1,275 lines)
is the semantics layer: binding tracking for getParameter, WebGL pixel-store
emulation (UNPACK_FLIP_Y etc.), uniform type introspection, wrapper-object
identity. `constants.mjs` (638 lines) is the GL enum table.
`webgl-objects.mjs` (40 lines) wraps GLuints in classes.

Port assessment, file by file:

- `constants.mjs`: regenerates into a TS `const` module (or const enum
  world) mechanically. The context-instance constant properties trick
  (assigning all enums onto `this` in a loop) is dialect-hostile
  (dynamic property write loop); replaced by generated class fields or,
  cleaner, module-level constants plus the standard `gl.TRIANGLES`
  spelling via generated readonly fields. Codegen problem, not a rewrite.
- `webgl-objects.mjs`: 14 one-line wrapper classes: ports verbatim
  (`class WebGLBuffer { constructor(readonly _id: number) {} }` shape).
- `webgl2-context.mjs`: the real port. Mostly mechanical
  (`enable(cap) { glEnable(cap) }` becomes a call to the FFI declaration).
  The dialect-sensitive spots, found by inspection:
  - **Overloaded entry points** (texImage2D 6/9/10-arg, bufferData with
    size-or-data, readPixels offset-or-buffer): TS overload declarations
    with a single implementation are a scriptc question mark; the safe
    dialect shape is distinct methods internally (`texImage2D9`,
    `texImage2DFromImage`) with thin public dispatch on argument count
    where scriptc accepts it, or documented explicit variants where it
    does not. Decided by compile experiment early in the phase.
  - **getParameter's union return** (number | boolean | Float32Array |
    wrapper | string): fenced as one method. Dialect shape: keep
    `getParameter(pname)` for the wrapper/number cases three-lite actually
    hits (switch on pname, per-arm static types), add typed variants
    (`getParameterF32(pname, out)`) for array cases. webgl-node's own
    binding-tracking design (JS-side bound-object bookkeeping instead of
    querying GL) ports perfectly and is what makes this feasible.
  - **Typed-array views**: uniformMatrix4fv takes Float32Array with
    srcOffset/srcLength; crosses as bytes-view (Phase 0.4 spike result
    governs).
  - **getters** (`drawingBufferWidth`): scriptc accessor support is
    unverified; Phase 0 gains a spike (0.9). Fallback: methods.
- `canvas-mock.mjs`: irrelevant here (the framework IS the canvas).

Estimated port: 6 agent-days including conformance (below), because the
reference implementation is owned, debugged, and 267 call sites map 1:1
onto the FFI surface.

### WebGL tier conformance

- Reuse webgl-node's own test suite scenarios as the spec: run each scene
  under Node+webgl-node and under the scriptc build, assert identical
  readback hashes (shim-side hash keeps bulk data native).
- A curated subset of the Khronos WebGL 2 conformance tests (the
  non-DOM-dependent ones) as a stretch lane, the same way webgl-node
  validated itself.

---

## threeTS-lite (Phase 9)

**Positioning: three-shaped, not three-compatible** (the gtlua rule
applied to 3D). Familiar names (`Scene`, `PerspectiveCamera`, `Mesh`,
`BufferGeometry`, `MeshStandardMaterial`), familiar composition, but a
from-scratch dialect-TS implementation sized for games, written against
the WebGL2 tier. three.js remains MIT (attribution in NOTICE), and its
source plus `@types/three` are the behavioral reference; as of this
research three.js itself still ships plain JS (types live in
DefinitelyTyped), so there is no upstream TS source to lean on, which is
why this library exists.

### Why not port three.js mechanically

Re-stating the original research conclusion for this doc's readers:
three.js hits every major fence: `any` throughout, string-keyed dynamic
property access (uniforms, material props), generic-ish containers,
optional class fields everywhere, prototype extension points, sparse
semantics. A mechanical port fights the dialect line by line for ~150k
lines. A shaped rewrite of the ~15% games use wins on every axis,
including binary size.

### Scope tiers

**v0 (in Phase 9):**

- `math/`: Vector2/3/4, Quaternion, Euler, Matrix3/4, Color, Box3, Sphere,
  Ray, Plane, Frustum, MathUtils. Pure TS, no FFI, ports near-verbatim
  from three's math folder (it is already class-per-file, allocation-
  disciplined, and `any`-free in practice). f64 math, converted to f32 at
  upload. ~3k lines.
- `core/`: Object3D (id-based parenting per DIALECT pool rules:
  `parentId`/children array of refs is fine, backref as id), Scene, Group,
  PerspectiveCamera, OrthographicCamera, BufferGeometry,
  BufferAttribute as CONCRETE classes (Float32BufferAttribute,
  Uint16BufferAttribute: three already ships these names, sidestepping
  the generic-class fence), Raycaster (mesh-bounds + triangle tiers).
  ~2.5k lines.
- `renderer/`: forward renderer: program cache keyed by material feature
  bits (a number, not a string-of-defines), VAO per geometry, uniform
  upload via typed setters (no reflection-driven dynamic uniform dicts:
  each material class knows its uniforms statically: the fence becomes an
  architecture improvement), frustum culling, opaque/transparent sort,
  render targets (for post later). ~4k lines.
- `materials/`: MeshBasicMaterial (color/map/vertexColors), 
  MeshLambertMaterial, MeshStandardMaterial-lite (albedo/metal-rough,
  no IBL in v0), SpriteMaterial, LineBasicMaterial, PointsMaterial.
  GLSL 300 es shader templates assembled by feature bits. ~2k lines.
- `lights/`: Ambient, Directional, Point, Hemisphere; per-light-count
  shader variants (small fixed maxes, game-sized). ~0.5k.
- `objects/`: Mesh, InstancedMesh (instanced arrays are core in ES3),
  Sprite, Line, LineSegments, Points, SkinnedMesh EXCLUDED from v0.
- `textures/`: Texture (image/canvas source, mips, wrap/filter), 
  CubeTexture, DataTexture, RenderTarget textures.
- `loaders/`: a binary geometry+scene format of our own (baked by a
  plain-JS Node tool in `codegen/` from glTF via existing npm parsers AT
  BUILD TIME: the dynamic-npm world stays on the build machine, the
  binary stays static), plus runtime OBJ for simplicity. Direct runtime
  glTF: D.

## What shipped, and where it differs from three

Everything below is implemented and exercised by `examples/spinfield` and
`examples/orbits`. The API is three's; the differences are all forced by
the dialect and are listed here rather than left to be discovered.

| three | here | why |
| --- | --- | --- |
| `scene.add(anything)` | `addMesh` / `addInstancedMesh` / `addSprite` / `addLine` / `addPoints` / `addLight` | the renderer needs a concrete type per drawable kind; the dialect will not narrow `Object3D` back down (SC1090). `add()` still works for transform parenting. |
| `geometry.attributes.position` | `geometry.position` | no dynamic property access; `setAttribute("position", ...)` still works |
| `attribute.needsUpdate = true` | `geometry.updatePosition()` | the attribute is a named field, so the flag lives on the geometry |
| `texture.offset.set(x, y)` | `texture.setOffset(x, y)` | same for `repeat`; no Vector2 property objects with setters |
| `material.rotation` on a Sprite | same | screen-space spin, as in three |
| `mesh.instanceMatrix.needsUpdate` | same | works exactly as three's |

### InstancedMesh

One draw call for N transforms. `setMatrixAt(i, matrix)` /
`getMatrixAt(i, target)` / `setColorAt(i, color)` match three, including
`count` being lowerable below the allocated capacity for pooling.

The renderer uploads only the **drawn prefix** (`count` instances), not the
whole allocation. This matters: uploading all 10000 slots while drawing 250
cost 2.27 ms/frame against 0.72 ms for the same 250 as individual meshes,
which made instancing look like a pessimisation at small counts. With the
prefix upload it is 0.121 ms. Measured numbers are in the spinfield table
below.

`scripts/instancing-parity.sh` renders the same field both ways and requires
the two to be **pixel-identical**, with a control that deliberately breaks
one cube and must be detected.

### Sprite

A camera-facing textured quad. The billboard is built in the vertex shader
from the translation column of `modelViewMatrix`, deliberately NOT by
transforming the origin through it: the matrix carries the object's scale,
and applying that to the position as well as the quad offset turned every
sprite into a sliver.

Sprite sheets work through `texture.setRepeat` / `setOffset` (a 4-frame
strip is `repeat=(0.25, 1)` with the offset stepping by 0.25). Without that,
a sheet renders as every frame squeezed onto one quad, which reads as a
squashed sprite rather than an obvious error.

### Points and Line

`PointsMaterial.size` is in pixels and `sizeAttenuation` decides whether it
shrinks with distance. Point sprites have no `uv` attribute, so a mapped
PointsMaterial samples `gl_PointCoord`.

`LineBasicMaterial.linewidth` exists for API compatibility but **does
nothing**: WebGL ignores widths above 1 on essentially every desktop
driver. Thick lines need quad geometry.

### PointLight falloff

`distance` and `decay` are honoured, matching three's formula
(`1/d^decay`, windowed to reach 0 at `distance`). They were previously
ignored in favour of a fixed `1/(1 + 0.1*d^2)`, which attenuates to 0.008 at
35 units: anything that far from a light rendered black no matter how it was
configured.

Worth knowing when tuning a scene: `decay = 2` is physically correct but
assumes real-world distances. At game scale a light 35 units away needs an
intensity in the hundreds to be visible, and anything near it then blows
out. `examples/orbits` uses `decay = 1`, which is exactly what the parameter
is exposed for.

### Raycaster

`setFromCamera(ndcX, ndcY, camera)`, `intersectObject`, `intersectObjects`,
results sorted nearest-first with `distance`, `point`, `normal` and
barycentric-interpolated `uv`. Two tiers, as in three: a bounding-sphere
reject, then triangles tested in the mesh's LOCAL space (one matrix inverse
per mesh, rather than transforming every triangle to world space).

three takes a `Vector2` for the NDC coordinate; this takes the two numbers,
because that is what every call site actually has. Converting a mouse event
is the caller's job, exactly as in three:

```ts
const ndcX = (e.clientX / canvas.width) * 2 - 1;
const ndcY = -(e.clientY / canvas.height) * 2 + 1;   // note the y flip
raycaster.setFromCamera(ndcX, ndcY, camera);
```

**`mesh.raycastable`, not `mesh.visible`.** These are different questions.
A collider box that follows a billboard sprite has to be pickable without
ever being drawn, and gating the raycaster on `visible` means every collider
renders as a solid block over the thing it stands in for (which is exactly
what happened in `examples/orbits`: white boxes covering every mine).
Sprites need colliders at all because a `Sprite` is built in the vertex
shader and has no world-space geometry for a ray to hit.

`firstHitOnly` skips the sort and returns on the first triangle found, for
"is anything in the way?" queries.

Not covered: Sprite/Points/Line intersection (three tests those against a
threshold) and per-instance hits on an InstancedMesh.

A hit count can surprise you: a centre ray through a `PlaneGeometry` reports
**two** hits, because a plane is two triangles sharing the diagonal the ray
runs down. three reports both, and so does this. `test/raytest.ts` checks 64
values against real three.js output.

### Loaders: bake, do not parse

`codegen/bake-mesh.js` converts glTF/GLB/OBJ into a `.sgm` binary at BUILD
time; `three/loaders/SGMLoader.ts` loads it at runtime.

```
node codegen/bake-mesh.js model.glb game/public/model.sgm [--scale N]
```

```ts
new SGMLoader().load("model.sgm").then((geometry) => {
  scene.addMesh(new Mesh(geometry, material));
});
```

Everything variable about glTF (accessor component types, interleaved
`byteStride`, normalized integer attributes, base64 data URIs, the scene
graph) is resolved on the build machine. What ships is a 20-byte header
followed by exactly the buffers the GPU wants, so the loader is a header
read and four loops rather than a JSON parser and an accessor engine.

The baker is zero-dependency, matching every other tool in `codegen/`:
`node:` builtins only. OBJ gets real de-duplication on the v/vt/vn triple
(a shared position with three different normals becomes three vertices) and
fan triangulation for quads and n-gons.

Refusals are loud on both sides: a sparse accessor is rejected by the baker
by name, and a truncated or wrong-magic `.sgm` throws from the loader rather
than yielding an empty geometry that renders as nothing and reads as a
shader bug.

Out of scope, deliberately: materials, cameras, lights, skins and
animations. A game builds its scene in code; this is a geometry pipe.

## Benchmark: spinfield

Identical per-cube math both ways, so the only difference measured is how
transforms reach the GPU. `SG_NO_VSYNC=1 ./build/spinfield`:

```
  instanced n=  250  mean    0.121 ms   p95    0.146   8268 fps
  per-mesh  n=  250  mean    0.700 ms   p95    0.760   1429 fps
  instanced n= 1000  mean    0.604 ms   p95    0.655   1655 fps
  per-mesh  n= 1000  mean    3.465 ms   p95    3.686    289 fps
  instanced n= 2500  mean    2.199 ms   p95    2.787    455 fps
  per-mesh  n= 2500  mean   12.872 ms   p95   18.587     78 fps
  instanced n=10000  mean    9.147 ms   p95   13.137    109 fps
  per-mesh  n=10000  mean  125.158 ms   p95  146.503      8 fps
```

Instancing wins at every count, by 5.8x at 250 and 13.7x at 10000. The
per-mesh path is not a strawman: it is the same renderer, the same
geometry and the same material, drawn one object at a time.

**D (post-v0):** shadow maps (directional first), fog, skinning + 
animation clips, IBL/environment, post-processing chain, GLTFLoader at
runtime, LOD, morph targets.

**X:** WebGPU/WebGL1 paths, NodeMaterial graphs, the editor ecosystem,
DOM-coupled anything (TextureLoader-from-URL etc.: assets come via `fetch`
and `new Image()`, resolved against the web root).

### Dialect adaptations (the design deltas from three)

| three.js pattern | threeTS-lite shape |
| --- | --- |
| `object.userData: any` | `userData: Map<string, string \| number \| boolean>` or user subclassing (classes are nominal; subclass Mesh freely) |
| `material[prop] = v` dynamic | Static fields per material class; feature bits recompute on set |
| Uniform dicts `{ uMap: { value } }` | Typed uniform slots on the material; renderer calls typed setters |
| `traverse(cb)` | Fine as-is: TS-to-TS closures/callbacks are fully supported in scriptc; only FFI callbacks are impossible. onBeforeRender-style hooks stay |
| `BufferAttribute<TypedArray>` generic feel | Concrete Float32/Uint16/Uint32 attribute classes (three's own names) |
| Optional fields (`material.map?`) | `map: Texture \| null = null` union arms |
| `Object3D.parent` backref cycle | Id/index backref (pool rule); children remain direct refs |
| Sparse/holey arrays never | Preallocated pools; render lists reused per frame |
| `dispose()` events via EventDispatcher | Plain `dispose()` methods; a tiny typed signal class where events matter |

### Performance thesis

Scene-graph update (matrix compose, frustum cull) is exactly the code AOT
compilation is for; it runs as native machine code instead of V8-JIT JS,
with draw submission as direct C calls into the driver (cheaper per call
than N-API). The open question is only steady-state allocation discipline
(covered by the dialect style) and f64 math (three.js also computes in
f64; uploads convert). A `examples/spinfield/` stress scene (10k cubes,
instanced and non-instanced lanes) is the phase's exit benchmark, compared
head-to-head against the same scene on Node + three.js + webgl-node, on
the same machine. Target: parity or better on frame time; startup and
memory will not be close (in our favor).

### Sizing

~12-15k lines of dialect TS + shader templates. The largest single work
item in the project; phased entry criteria exist so it never starts on
sand: Phase 8 conformance green + Phase 0.9 accessor answer + the 2D tier
shipped (v0.1) so the framework surface is stable under it.

---

## Plan integration

- **Phase 0 additions**: 0.9 class accessor spike (getters/setters in the
  static tier: webgl-node port + three-shape both prefer them; methods are
  the fallback), 0.10 shared-library linking spike (`system_libraries`
  with `-lEGL -lGLESv2` on Linux).
- **Phase 8 (WebGL2 tier, ~6 days)**: GL FFI codegen + shim out-param/
  mailbox/glue (~600 lines), context/present model decision, webgl-node
  port, conformance vs webgl-node, headless pbuffer lane. Gate: readback
  hashes identical to webgl-node across the scenario suite.
- **Phase 9 (threeTS-lite, ~10 days)**: v0 scope above, asset bake tool,
  spinfield benchmark, two 3D examples. Gate: benchmark parity vs
  Node+three+webgl-node and a playable 3D example on all Linux targets.
- Phase 7's GPU-present stretch item becomes optional: the SDL GL window
  model (option 1) delivers the 3D tier without Skia-Ganesh coupling, and
  Ganesh composite becomes a refinement for canvas-heavy games.
