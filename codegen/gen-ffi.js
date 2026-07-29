/* Generate ffi/core.ffi.json from host/ffi.ts.
 *
 * The manifest is all-or-nothing (every entry needs a declaration and vice
 * versa), so deriving it from the declarations removes the whole class of
 * drift. The ABI class of each parameter comes from the C signature, which
 * this reads out of shim/*.cpp rather than guessing from the TS types: TS
 * has only `number`, so the manifest is the ABI authority and the C source
 * is the only truth about widths.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** camelCase FFI name -> snake_case C symbol (sgCanvasDrawRect -> sg_canvas_draw_rect) */
function symbolOf(name) {
  /* Raw GL entry points ARE their own symbol: glClear is exported by
   * libGLESv2 as glClear, not gl_clear. Only the sg* shim names follow the
   * camelCase -> snake_case convention. */
  if (/^gl[A-Z]/.test(name)) return name;
  return name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

/* GL's typedefs, which the GL shim signatures use directly rather than
 * spelling out uint32_t. Same widths, different names. */
const GL_TYPES = {
  GLenum: "uint32_t", GLuint: "uint32_t", GLbitfield: "uint32_t",
  GLint: "int32_t", GLsizei: "int32_t", GLfixed: "int32_t",
  GLboolean: "uint8_t", GLubyte: "uint8_t",
  /* 64-bit GL types cross as f64: exact to 2^53, which covers every buffer
   * size and offset a game will produce. */
  GLintptr: "double", GLsizeiptr: "double",
  GLint64: "double", GLuint64: "double",
};

/** Map a C type to its format-1 ABI class. */
function abiClass(cType, isReturn) {
  let t = cType.trim().replace(/\s+/g, " ");
  if (t in GL_TYPES) t = GL_TYPES[t];
  if (t === "void") return isReturn ? "void" : null;
  if (t === "double") return "f64";
  if (t === "uint32_t") return "u32";
  if (t === "int32_t") return "i32";
  if (t === "uint8_t") return "u8";
  if (t === "bool") return "bool";
  return null;
}

/* A `string` or `bytes` param is ONE TS argument that expands to the C pair
 * `(const uint8_t*, <len>)`. Collapsing the pair here is what keeps the
 * arity check below meaningful: TS sees one param, C sees two. Which of the
 * two classes it is cannot be read off the C types (they are identical), so
 * the TS declaration's type picks: `string` -> string, `Buffer` -> bytes.
 *
 * The length is uint32_t, NOT size_t, and that is load-bearing rather than
 * stylistic. size_t is 64-bit on every native target here but 32-bit on
 * wasm32, so an IR generated for x86_64 passes an i64 where a wasm build of
 * the same shim expects an i32. That mismatch links with only a warning and
 * then reads out of bounds at runtime. size_t is still accepted so an
 * out-of-tree shim written the old way keeps working. */
const SPAN_PTR = /^const (uint8_t|char) ?\*$/;
const SPAN_LEN = /^(uint32_t|size_t)$/;
function collapseSpans(cParams) {
  const out = [];
  for (let i = 0; i < cParams.length; i++) {
    const t = cParams[i].trim().replace(/\s+/g, " ");
    const next = (cParams[i + 1] ?? "").trim().replace(/\s+/g, " ");
    if (SPAN_PTR.test(t) && SPAN_LEN.test(next)) {
      out.push("__span__");
      i++; // the length is part of the same TS argument
    } else {
      out.push(cParams[i]);
    }
  }
  return out;
}

// Parse the C signatures the shim exports.
const shimSrc = [
  "shim/sg_core.cpp",
  "shim/sg_tables.c",
  "shim/sg_skia_gen.cpp",
  "shim/sg_skia_extra.cpp",
  "shim/sg_input.cpp",
  "shim/sg_audio.cpp",
  "shim/sg_audio_decode.cpp",
  /* The GL tier. Generated and hand-written halves both export C symbols
   * the WebGL layer declares. */
  "shim/sg_gl_gen.cpp",
  "shim/sg_gl_extra.cpp",
]
  .filter((f) => existsSync(join(root, f)))
  .map((f) => readFileSync(join(root, f), "utf8"))
  .concat(
    /* SG_EXTRA_SHIM: absolute paths, colon-separated, to C/C++ sources
     * OUTSIDE this repo that also export sg_ symbols. A consumer that
     * relinks this tier against a different host (wasmcart-scriptc builds
     * the canvas tier into a cart) has shim sources of its own, and without
     * this the manifest refuses to emit: "no C signature found". */
    (process.env.SG_EXTRA_SHIM ?? "")
      .split(":")
      .filter((f) => f && existsSync(f))
      .map((f) => readFileSync(f, "utf8")),
  )
  .join("\n");

const cSigs = new Map();

/* Raw GL entry points live in libGLESv2, not in shim/*.cpp, so their
 * signatures cannot be parsed from our sources. gen-gl.js writes them to a
 * sidecar when it parses the GLES3 header; without it, a program using the
 * GL tier reports every one as "no C signature found". */
const glSigPath = join(root, "codegen/gl-signatures.json");
if (existsSync(glSigPath)) {
  const glSigs = JSON.parse(readFileSync(glSigPath, "utf8"));
  for (const [symbol, sig] of Object.entries(glSigs)) cSigs.set(symbol, sig);
}
/* Two spellings, both used in the tree: `extern "C" TYPE sg_foo(...)` per
 * function (the Skia shims) and one `extern "C" { ... }` block wrapping many
 * (the GL shim). Matching only the first silently dropped every symbol in a
 * block, which surfaces much later as "sg_foo is not defined" at RUNTIME,
 * so both are matched here.
 *
 * The block form is found by taking any top-level definition of an sg_
 * symbol; a name is only reachable from TS if it is extern "C" anyway, and
 * a static helper would not be declared on the TS side. */
const sigRe = /(?:extern\s+"C"\s+|^)([A-Za-z_][A-Za-z0-9_ ]*?)\s+(sg_[a-z0-9_]+)\s*\(([^)]*)\)/gm;
for (let m; (m = sigRe.exec(shimSrc)); ) {
  const [, ret, symbol, params] = m;
  const paramList = params
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p && p !== "void")
    // Strip the parameter NAME but keep any `*`: pointer-ness is what
    // distinguishes a span's `const uint8_t*` from a scalar `uint8_t`.
    .map((p) => p.replace(/\s*([A-Za-z_][A-Za-z0-9_]*)$/, "").trim());
  cSigs.set(symbol, { ret: ret.trim(), params: collapseSpans(paramList) });
}

/* Parse the TS declarations.
 *
 * The manifest is ALL-OR-NOTHING PER PROGRAM: every entry must have a
 * matching `declare` in the compiled program, and a program only contains
 * what it transitively imports. A test that never touches the canvas has no
 * skia declares, so a manifest listing them fails to build.
 *
 * So the declaration set is the union over the entry file's IMPORT GRAPH,
 * not over the whole repo. With no entry given (a bare `gen-ffi.js` run),
 * every declaration file is scanned, which is the right default for
 * regenerating the full manifest.
 */
const entry = process.argv[3];
const declFiles = entry
  ? reachableFiles(resolve(entry))
  : ["host/ffi.ts", "host/skia-ffi.ts"].map((f) => join(root, f));

/** Every .ts file reachable from `start` through relative imports. */
function reachableFiles(start) {
  const seen = new Set();
  const queue = [start];
  while (queue.length > 0) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue; // a missing import is the compiler's error to report, not ours
    }
    seen.add(file);
    // Relative specifiers only: bare ones are node builtins, which cannot
    // contain FFI declarations.
    const importRe = /from\s+["'](\.[^"']*)["']/g;
    for (let m; (m = importRe.exec(text)); ) {
      // Source imports are written ".js" (ESM style) but resolve to ".ts".
      const spec = m[1].replace(/\.js$/, ".ts");
      queue.push(resolve(dirname(file), spec));
    }
  }
  return [...seen];
}

const tsSrc = declFiles.map((f) => readFileSync(f, "utf8")).join("\n");
/* camelCase (sgCanvasClear) is the established spelling and maps to its C
 * symbol through symbolOf(). The GL tier declares raw GL entry points too
 * (glClear, glDrawArrays), whose symbol IS the declared name. Both are
 * matched; symbolOf leaves an all-lowercase name alone. */
const declRe = /^declare function ((?:sg|gl)[A-Za-z0-9_]*)\s*\(([^)]*)\)\s*:\s*([A-Za-z]+);/gm;

const functions = [];
const problems = [];
for (let m; (m = declRe.exec(tsSrc)); ) {
  const [, name, tsParams, tsReturn] = m;
  const symbol = symbolOf(name);
  const sig = cSigs.get(symbol);
  if (!sig) {
    problems.push(`${name}: no C signature found for symbol ${symbol}`);
    continue;
  }
  const tsParamList = tsParams.trim() === "" ? [] : tsParams.split(",");
  if (tsParamList.length !== sig.params.length) {
    problems.push(
      `${name}: TS declares ${tsParamList.length} param(s), C symbol ${symbol} takes ${sig.params.length}`,
    );
    continue;
  }
  const params = sig.params.map((p, i) => {
    if (p !== "__span__") return abiClass(p, false);
    const tsType = (tsParamList[i].split(":")[1] ?? "").trim();
    if (tsType === "string") return "string";
    if (tsType === "Buffer") return "bytes";
    return null; // reported below as "no ABI class"
  });
  const returns = abiClass(sig.ret, true);
  const badParam = params.findIndex((p) => p === null);
  if (badParam >= 0) {
    const c = sig.params[badParam];
    problems.push(
      c === "__span__"
        ? `${name}: parameter ${badParam + 1} is a (const uint8_t*, uint32_t) span, so its TS type must be 'string' or 'Buffer'`
        : `${name}: parameter ${badParam + 1} type '${c}' has no ABI class`,
    );
    continue;
  }
  if (returns === null) {
    problems.push(`${name}: return type '${sig.ret}' has no ABI class`);
    continue;
  }
  // TS-side sanity: a `void` C return must be `void` in TS and vice versa.
  const tsIsVoid = tsReturn === "void";
  if (tsIsVoid !== (returns === "void")) {
    problems.push(`${name}: TS returns '${tsReturn}' but C returns '${sig.ret}'`);
    continue;
  }
  functions.push({ name, symbol, params, returns });
}

if (problems.length > 0) {
  console.error("gen-ffi: refusing to emit a manifest with unresolved signatures:");
  for (const p of problems) console.error("  " + p);
  process.exit(1);
}

const target = process.argv[2] ?? "linux-x86_64";
const vendor = `../vendor/${target}`;

/* What Skia and SDL need from the SYSTEM, per platform.
 *
 * Skia links against platform graphics and text stacks rather than bundling
 * them, so this list is genuinely different per OS: fontconfig/freetype and
 * GL on Linux, the equivalent frameworks on macOS, and the Win32 GDI/user
 * libraries on Windows. Getting it wrong surfaces as thousands of undefined
 * symbols at link time, not as a clean error. */
function systemLibraries(t) {
  if (t.startsWith("macos")) {
    /* Frameworks are NOT here, and cannot be: system_libraries is validated
     * against /^[A-Za-z0-9_+.-]+$/ and every entry becomes -l<name>, so
     * "-framework CoreText" has no spelling in this manifest.
     *
     * shim/sg_core.cpp carries them instead, as Mach-O LC_LINKER_OPTION
     * load commands compiled into libsggfx.a. The linker reads them
     * straight out of the archive, which is the same mechanism Rust's
     * #[link(kind = "framework")] uses. Verified working on a real Mac:
     * the linked binary carries CoreText/CoreGraphics/CoreFoundation with
     * nothing on the command line.
     *
     * SDL2 is NOT here either: -l<name> only searches the toolchain's
     * default paths, and the modern ld (Xcode 15+) searches neither
     * /opt/homebrew/lib (arm64 Homebrew) nor /usr/local/lib (intel
     * Homebrew), so `-lSDL2` fails with "ld: library 'SDL2' not found".
     * The dylib joins `libraries` by full path instead (sdl2DylibPath). */
    return [
      "m", "pthread",
      // libc++ is the system default; c++abi lives inside it on Darwin.
      "c++",
    ];
  }
  if (t.startsWith("windows")) {
    /* SDL2 is NOT here: the VC release is unpacked to a workspace path the
     * linker does not search, so -lSDL2 fails the same way it does on
     * macOS. SDL2.lib joins `libraries` by full path instead
     * (windowsSdl2Lib), via SDL2_LIB from the CI step that unpacks it. */
    /* Skia on Windows uses GDI for fonts and opengl32 for the GL surface;
     * the rest are the usual Win32 support libraries its codecs and
     * threading pull in. No libc++: the MSVC toolchain supplies its own. */
    return [
      "gdi32", "user32", "opengl32", "ole32", "oleaut32", "uuid",
      "advapi32", "shell32", "winmm", "imm32", "setupapi", "version",
    ];
  }
  if (t.startsWith("android")) {
    /* Android is GLES, not desktop GL (SKIA_GL_STANDARD is "gles" in the
     * build-libcanvas output), and log is what Skia's own logging needs.
     * There is no fontconfig: Skia falls back to its bundled FreeType. */
    return [
      "SDL2", "m",
      "c++", "c++abi",
      "GLESv3", "EGL", "log", "android",
    ];
  }
  // Linux (x86_64 and aarch64).
  return [
    "SDL2", "m", "pthread", "dl",
    /* libc++, NOT libstdc++: build-libcanvas compiles Skia against LLVM's
     * libc++ (every symbol is `std::__1::`), so linking libstdc++ leaves
     * thousands of undefined std:: references. shim/*.cpp is compiled
     * -stdlib=libc++ for the same reason. */
    "c++", "c++abi",
    "GL", "fontconfig", "freetype",
  ];
}

/* macOS SDL2, linked by full path because -lSDL2 cannot find it (see the
 * macos branch of systemLibraries above). The prefix is resolved through
 * pkg-config at generation time rather than hardcoded: Homebrew installs
 * under /opt/homebrew on arm64 and /usr/local on intel, and both CI lanes
 * `brew install sdl2 pkg-config`. A dylib's position in the link line does
 * not matter (unlike archives, it resolves symbols lazily), so it rides at
 * the end of `libraries`. */
/* ANGLE's dylibs on macOS, by FULL PATH.
 *
 * Apple deprecated OpenGL and never shipped GLES3, so there is no system
 * libGLESv2/libEGL to link: every macOS CI run failed at the link step
 * even after the Khronos headers were vendored. ANGLE is the standard
 * answer -- it is what native-gles uses, what Chrome ships, and what
 * translates GLES3 onto Metal.
 *
 * They join `libraries` rather than `system_libraries` for the same
 * reason SDL2 does: system_libraries becomes a bare -l<name>, which only
 * searches the toolchain's default paths, and ANGLE is unpacked into the
 * workspace.
 *
 * ANGLE_LIB is set by the CI step that downloads it; a local build
 * without it gets a clear error rather than an undefined-symbol wall. */
function angleDylibs(target) {
  const dir = process.env.ANGLE_LIB;
  if (!dir) {
    throw new Error(
      "gen-ffi: ANGLE_LIB is not set. macOS has no system GLES3, so a GL " +
      "program needs ANGLE: run scripts/fetch-angle.sh and export ANGLE_LIB.",
    );
  }
  const out = [];
  for (const name of ["libGLESv2.dylib", "libEGL.dylib"]) {
    const p = join(dir, name);
    if (!existsSync(p)) {
      throw new Error(`gen-ffi: no ${name} in '${dir}' (scripts/fetch-angle.sh)`);
    }
    out.push(p);
  }
  return out;
}

function sdl2DylibPath() {
  let libdir;
  try {
    libdir = execFileSync("pkg-config", ["--variable=libdir", "sdl2"], {
      encoding: "utf8",
    }).trim();
  } catch (err) {
    throw new Error(
      `gen-ffi: pkg-config could not locate sdl2 (brew install sdl2 pkg-config): ${err.message}`,
    );
  }
  const dylib = join(libdir, "libSDL2.dylib");
  if (!existsSync(dylib)) {
    throw new Error(`gen-ffi: no libSDL2.dylib in '${libdir}' (brew install sdl2)`);
  }
  return dylib;
}

/* Windows SDL2, linked by full path for the same reason macOS is: the
 * import library sits wherever CI unpacked the VC release, which is not a
 * default search path. SDL2_LIB is set by the workflow step that unpacks
 * it. */
function windowsSdl2Lib() {
  const dir = process.env.SDL2_LIB;
  if (!dir) {
    throw new Error("gen-ffi: SDL2_LIB is unset (the Windows lane unpacks the SDL2 VC release)");
  }
  const lib = join(dir, "SDL2.lib");
  if (!existsSync(lib)) {
    throw new Error(`gen-ffi: no SDL2.lib in '${dir}'`);
  }
  return lib;
}

/* Skia ships ~28 MUTUALLY dependent archives (libsvg needs SkColorMatrix
 * and SkParse from libskia; libskia pulls codec/image archives back), and
 * GNU ld resolves each static archive exactly once, left to right. The
 * manifest is a flat path list with nowhere to put --start-group, and it
 * rejects duplicate paths, so ordering cannot be fixed from here. Instead
 * scripts/build-shim.sh merges every Skia member plus skia_c.o and the
 * shim objects into ONE archive: within a single archive the linker
 * iterates to a fixpoint, so mutual dependencies resolve regardless of
 * member order. */
/* Does this program reach the GL bindings? gen-ffi already walks the entry
 * file's import graph, so the answer is just whether gl-ffi.ts is in it. */
const usesGl = declFiles.some((f) => f.endsWith("gl-ffi.ts"));

const manifest = {
  ffi_format: 1,
  functions,
  /* libwebaudio.a is SEPARATE from libsggfx.a on purpose: it is fetched and
   * built from webaudio-node by scripts/build-webaudio.sh, and keeping it its
   * own archive means a webaudio bump does not force the 30-second Skia merge.
   * Order matters to the linker, and sggfx (which calls into the engine) must
   * come first. */
  /* The GL tier's archive joins only when a program actually imports the
   * WebGL layer: a 2D game should not link libGLESv2. Detected from the
   * declaration set, which is already the reachable-from-entry union. */
  libraries: [
    ...(usesGl ? [`${vendor}/libsggl.a`] : []),
    /* ANGLE first: libsggl calls into it, and the linker takes each
     * archive once, left to right. */
    ...(usesGl && target.startsWith("macos") ? angleDylibs(target) : []),
    `${vendor}/libsggfx.a`,
    `${vendor}/libwebaudio.a`,
    ...(target.startsWith("macos") ? [sdl2DylibPath()] : []),
    ...(target.startsWith("windows") ? [windowsSdl2Lib()] : []),
  ],
  /* GLESv2/EGL are system libraries on Linux and Android. On macOS they
   * come from ANGLE by full path (see angleDylibs), so naming them here
   * as well would make the linker search for a second, nonexistent copy. */
  system_libraries: usesGl && !target.startsWith("macos")
    ? [...systemLibraries(target), "GLESv2", "EGL"]
    : systemLibraries(target),
};

mkdirSync(join(root, "ffi"), { recursive: true });
const out = join(root, "ffi/core.ffi.json");
writeFileSync(out, JSON.stringify(manifest, null, 2) + "\n");
console.log(`gen-ffi: ${functions.length} bindings -> ffi/core.ffi.json`);
