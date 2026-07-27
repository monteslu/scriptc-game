/* Generate ffi/core.ffi.json from runtime/ffi.ts.
 *
 * The manifest is all-or-nothing (every entry needs a declaration and vice
 * versa), so deriving it from the declarations removes the whole class of
 * drift. The ABI class of each parameter comes from the C signature, which
 * this reads out of shim/*.cpp rather than guessing from the TS types: TS
 * has only `number`, so the manifest is the ABI authority and the C source
 * is the only truth about widths.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** camelCase FFI name -> snake_case C symbol (sgCanvasDrawRect -> sg_canvas_draw_rect) */
function symbolOf(name) {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

/** Map a C type to its format-1 ABI class. */
function abiClass(cType, isReturn) {
  const t = cType.trim().replace(/\s+/g, " ");
  if (t === "void") return isReturn ? "void" : null;
  if (t === "double") return "f64";
  if (t === "uint32_t") return "u32";
  if (t === "int32_t") return "i32";
  if (t === "uint8_t") return "u8";
  if (t === "bool") return "bool";
  return null;
}

/* A `string` or `bytes` param is ONE TS argument that expands to the C pair
 * `(const uint8_t*, size_t)`. Collapsing the pair here is what keeps the
 * arity check below meaningful: TS sees one param, C sees two. Which of the
 * two classes it is cannot be read off the C types (they are identical), so
 * the TS declaration's type picks: `string` -> string, `Buffer` -> bytes. */
const SPAN_PTR = /^const (uint8_t|char) ?\*$/;
function collapseSpans(cParams) {
  const out = [];
  for (let i = 0; i < cParams.length; i++) {
    const t = cParams[i].trim().replace(/\s+/g, " ");
    const next = (cParams[i + 1] ?? "").trim().replace(/\s+/g, " ");
    if (SPAN_PTR.test(t) && next === "size_t") {
      out.push("__span__");
      i++; // the size_t is part of the same TS argument
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
]
  .map((f) => readFileSync(join(root, f), "utf8"))
  .join("\n");

const cSigs = new Map();
const sigRe = /extern\s+"C"\s+([A-Za-z_][A-Za-z0-9_ ]*?)\s+(sg_[a-z0-9_]+)\s*\(([^)]*)\)/g;
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
  : ["runtime/ffi.ts", "runtime/canvas/skia-ffi.ts"].map((f) => join(root, f));

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
const declRe = /^declare function (sg[A-Za-z0-9]*)\s*\(([^)]*)\)\s*:\s*([A-Za-z]+);/gm;

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
        ? `${name}: parameter ${badParam + 1} is a (const uint8_t*, size_t) span, so its TS type must be 'string' or 'Buffer'`
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

/* Skia ships ~28 MUTUALLY dependent archives (libsvg needs SkColorMatrix
 * and SkParse from libskia; libskia pulls codec/image archives back), and
 * GNU ld resolves each static archive exactly once, left to right. The
 * manifest is a flat path list with nowhere to put --start-group, and it
 * rejects duplicate paths, so ordering cannot be fixed from here. Instead
 * scripts/build-shim.sh merges every Skia member plus skia_c.o and the
 * shim objects into ONE archive: within a single archive the linker
 * iterates to a fixpoint, so mutual dependencies resolve regardless of
 * member order. */
const manifest = {
  ffi_format: 1,
  functions,
  libraries: [`${vendor}/libsggfx.a`],
  /* libc++, NOT libstdc++: build-libcanvas compiles Skia against LLVM's
   * libc++ (every symbol is `std::__1::`), so linking libstdc++ leaves
   * thousands of undefined std:: references. c++abi and unwind follow it.
   * shim/*.cpp is compiled -stdlib=libc++ for the same reason. */
  system_libraries: [
    "SDL2", "m", "pthread", "dl",
    "c++", "c++abi",
    "GL", "fontconfig", "freetype",
  ],
};

mkdirSync(join(root, "ffi"), { recursive: true });
const out = join(root, "ffi/core.ffi.json");
writeFileSync(out, JSON.stringify(manifest, null, 2) + "\n");
console.log(`gen-ffi: ${functions.length} bindings -> ffi/core.ffi.json`);
