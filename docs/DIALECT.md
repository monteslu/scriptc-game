# The Dialect: scriptc-clean TypeScript for game code

Game code and the runtime library compile in scriptc's **static tier**. That
tier is a strict, statically-compilable dialect of TypeScript. This document
is the working list of fences that matter for game code, each with the
rewrite pattern, so that neither humans nor agents rediscover them one
compile error at a time. The authoritative source is always `scriptc build`
itself: every rejection is an SC-coded diagnostic with a rewrite hint, and
the compiler is newer than this page.

Positioning reminder (the gtlua lesson): this is **familiar, not
compatible**. We never claim "TypeScript support"; we claim a typed dialect
that web developers already mostly write.

## Hard rules with rewrites

### 1. No `any`. `unknown` + checked casts instead.

```ts
// rejected (SC2011 without --dynamic, and we never ship --dynamic):
function load(cfg: any) {}
// dialect:
const cfg = JSON.parse(text) as GameConfig;   // checked cast: throws with
                                              // a path on mismatch. Good.
```

`unknown` may ride locals/params/returns but never class fields, array
elements, or union arms.

### 2. `===`/`!==` only; `let`/`const` only.

`==`, `!=`, and `var` are compile errors. Mechanical.

### 3. Arrays are dense; out-of-bounds is a TRAP, not undefined.

The single biggest habit-breaker. `arr[i]` beyond length aborts the
process (not catchable).

```ts
// JS habit, traps when empty:
const top = stack.pop() ?? fallback;     // pop() on empty traps
// dialect:
const top = stack.length > 0 ? stack.pop() : fallback;

// sparse/holey patterns are out entirely:
const grid: number[] = [];
grid[99] = 1;                            // trap
// dialect: preallocate
const grid: number[] = new Array<number>(100).fill(0);
```

Game-relevant consequence: entity pools, tilemaps, and ring buffers are
preallocated and length-checked. This matches how you write fast game code
anyway; the dialect just refuses the slow sloppy version.

### 4. Record shapes are exact structs; width-subtyping copies.

```ts
interface Point { x: number; y: number }
const p = { x: 1, y: 2, z: 3 };
usePoint(p);            // SC2002: extra field 'z' does not flow
```

And where a strict subset IS accepted, it is **copied**: mutations through
the narrow reference do not affect the original. Dialect pattern: define
the exact interfaces you pass around; do not rely on structural width or
aliasing through narrowed types. For shared mutable state, pass the class
instance (nominal), not a record literal.

### 5. Generics: top-level generic FUNCTIONS only.

No generic classes, generic methods, or generic arrows; no using generic
functions or stdlib methods as values.

```ts
// rejected:
class Pool<T> {...}
const f = Math.floor;                    // stdlib method as value
// dialect:
class SpritePool {...}                   // concrete per type, or codegen
function poolGet<T>(items: T[], n: number): T {...}  // top-level generic fn OK
const y = Math.floor(x);                 // call directly
```

Runtime consequence: the framework's pools/registries are concrete classes
(SpritePool, SoundPool), not `Pool<T>`. Mild boilerplate, zero runtime cost.

### 6. Optional class fields are fenced; `undefined`/`null` only as union arms.

```ts
// rejected:
class Enemy { target?: Vec2 }
// dialect options:
class Enemy { target: Vec2 | null = null }   // union arm, explicit
class Enemy { targetId = -1 }                // sentinel index into a pool
```

(Optional record fields and optional/default/rest parameters DO compile.)

### 7. Union discipline.

Narrow before member access on mixed unions; whole-union printing is fine.
Discriminated unions compile well and are the dialect's preferred way to do
game events/messages:

```ts
type Msg =
  | { kind: "spawn"; x: number; y: number }
  | { kind: "hit"; id: number; dmg: number };
switch (msg.kind) { ... }               // compiles, dispatches statically
```

### 8. Beware tuple inference.

`Promise.all([a(), b()])` infers a tuple; tuple edges are fenced. Type the
array first (`const jobs: Promise<number>[] = [...]`). Games rarely need
this (the loop is sync), but loaders might.

### 9. Map/Set keys are strings and numbers only.

Object-keyed maps become id-keyed: every pooled object carries a numeric
id. Again, standard fast-game-code shape.

### 10. Labeled break/continue: out. Top-level await: out (wrap in main()).

### 11. No prototype tricks, no dynamic property access without types.

`obj[key]` where key is a runtime string over a typed record: fenced.
Dialect: switch on the key, or use a Map, or restructure. This is the fence
that killed the three.js idea; framework and game code are designed inside
it from day one.

## Divergences to internalize (compile fine, behave differently)

- **Runtime traps are not catchable** (OOB, pop-on-empty). Ship-blocking
  bugs surface as aborts with a message, not silent undefined. CI plays
  every example with scripted input to shake these out.
- **`Object.keys`/`JSON.stringify` report declaration order**, not
  insertion order. Only matters for save-file golden tests: canonicalize.
- **Strings are UTF-8 internally** with UTF-16 semantics on the API; only
  relational compares (code-point order) and surrogate-splitting differ.
  Irrelevant for game code in practice.
- **Refcounting + deterministic cycle collection.** Two consequences:
  1. Per-frame garbage is cheap-ish but not free: the dialect style is
     zero-allocation steady-state anyway (pools, preallocated scratch
     vectors, reused arrays). The runtime provides `Vec2`-style scratch
     objects and documents the pattern.
  2. Reference cycles (entity <-> component backrefs) are collected at
     deterministic points, but the cheap pattern is id-based backrefs
     (`parentId: number`), which the pool architecture gives for free.
- **Numbers are f64 everywhere**; integer inference is scriptc roadmap.
  Bitwise ops work (ToInt32 semantics); don't chase int tricks for speed
  yet, profile first.
- **`process.argv[0]` is "scriptc"**, argv[1] is the binary path; asset
  resolution uses this (see API-SURFACE.md).

## Tooling

- `tsconfig.json` in the template pins `lib: es2025` and the strictness
  flags that match scriptc's world; the editor then agrees with the
  compiler about MOST things. scriptc's own ambient declarations differ
  deliberately in places (JSON.parse returns unknown, pop() returns T);
  the template ships a `scriptc-env.d.ts` mirroring the documented ones.
- ESLint preset (`eslint-config` in the template): no-explicit-any, eqeqeq,
  no-var, no-labels, no-restricted-syntax entries for generic
  classes/methods, optional class properties, `obj[expr]` computed access
  on non-array non-Map receivers. Advisory; `scriptc build` is the gate.
- `scriptc coverage` runs in CI on every example: the report must show
  100% static (no island, no deferred sites). A nonzero dynamic count
  fails CI, keeping the "fully native, always" invariant honest.

## What this dialect is NOT

- Not a subset anyone ports existing web games into mechanically. Porting
  is a rewrite with familiar names (same as gtlua's P8 positioning).
- Not JS. This project's runtime and game code are TS because TS is
  scriptc's input language and the annotations are the compilation
  contract. Dev tooling here (codegen, build scripts) remains plain JS
  ESM since nothing compiles it.
- Not frozen. When scriptc lands integer inference, generic classes, or
  callback FFI, fences lift; this doc tracks the pinned scriptc version in
  versions.json and gets re-audited on every pin bump.
