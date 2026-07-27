/* Generate the skiac wrapper layer from skia_c.hpp.
 *
 * ONE source of truth (the pinned header) produces three artifacts that
 * cannot drift from each other:
 *
 *   shim/sg_skia_gen.cpp        handle-flattened extern "C" wrappers
 *   runtime/canvas/skia-ffi.ts  the matching `declare` block + wrappers
 *   (the manifest is derived from the .ts by gen-ffi.js, as before)
 *
 * The parser is deliberately dumb: skia_c.hpp is machine-regular, and any
 * signature this cannot classify is REPORTED, never guessed. Unclassifiable
 * functions are listed in skia-allowlist.json's `manual` map with a reason
 * and get hand-written wrappers in sg_skia_extra.cpp.
 *
 * Two rules from Phase 0/1 are baked into every emitted TS wrapper:
 *   - it returns the FFI call DIRECTLY (never binds the result to a local),
 *   - nothing is ever aliased; the declaration is called by exactly one
 *     wrapper.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = process.argv[2] ?? "linux-x86_64";
const header = join(root, `vendor/${target}/include/skia_c.hpp`);

const allow = JSON.parse(readFileSync(join(root, "codegen/skia-allowlist.json"), "utf8"));
const DOMAINS = allow.domains;

/* ---- parse ---- */

const src = readFileSync(header, "utf8");
const externAt = src.indexOf('extern "C" {');
if (externAt < 0) throw new Error("no extern \"C\" block in skia_c.hpp");
// Strip comments so a trailing `// note` inside a parameter list cannot
// swallow the rest of the declaration (skiac_bitmap_get_shader does this).
const body = src
  .slice(externAt)
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\/\/[^\n]*/g, "");

const declRe = /^([A-Za-z_][\w *]*?)\s+(skiac_\w+)\s*\(([^;]*?)\)\s*;/gm;
const decls = new Map();
for (let m; (m = declRe.exec(body)); ) {
  const [, ret, name, params] = m;
  decls.set(name, { ret: norm(ret), params: splitParams(params) });
}

function norm(s) {
  return s.replace(/\s+/g, " ").trim();
}

/** Split a parameter list into normalized `type` strings (names removed). */
function splitParams(raw) {
  const list = norm(raw)
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p !== "" && p !== "void");
  return list.map((p) => {
    // Drop an array suffix (`uint8_t table_a[256]`) then the parameter name,
    // keeping any `*` since pointer-ness is what classification turns on.
    const noArray = p.replace(/\[\s*\d*\s*\]\s*$/, "*");
    return norm(noArray.replace(/\s*\b[A-Za-z_]\w*\s*$/, ""));
  });
}

/* ---- classify ---- */

/** Scalar C type -> { c, ffi, ts } or null if not a scalar. */
function scalar(t) {
  switch (t) {
    case "float":
    case "double":
    case "SkScalar":
      return { c: "double", ffi: "f64", cast: "(float)" };
    case "int":
    case "int32_t":
      return { c: "int32_t", ffi: "i32", cast: "(int)" };
    case "uint32_t":
    case "unsigned":
      return { c: "uint32_t", ffi: "u32", cast: "(uint32_t)" };
    case "size_t":
      return { c: "uint32_t", ffi: "u32", cast: "(size_t)" };
    case "uint8_t":
      return { c: "uint32_t", ffi: "u32", cast: "(uint8_t)" };
    case "bool":
      return { c: "uint32_t", ffi: "u32", cast: "!!" };
    default:
      return null;
  }
}

/** `skiac_foo*` -> domain name, else null. */
function handleDomain(t) {
  const m = /^(?:const\s+)?(skiac_\w+)\s*\*$/.exec(t);
  if (!m) return null;
  return DOMAINS[m[1]] ?? null;
}

const NAME_OVERRIDES = { skiac_path_effect_destroy: "path_effect_destroy" };

/** skiac_canvas_draw_rect -> sg_canvas_draw_rect / sgCanvasDrawRect */
function names(skiacName) {
  const base = NAME_OVERRIDES[skiacName] ?? skiacName.replace(/^skiac_/, "");
  const c = `sg_${base}`;
  const ts = "sg" + base.replace(/(^|_)([a-z0-9])/g, (_, __, ch) => ch.toUpperCase());
  return { c, ts };
}

/**
 * Build the wrapper plan for one skiac function, or return a reason string
 * explaining why it cannot be generated.
 */
function plan(skiacName) {
  const d = decls.get(skiacName);
  if (!d) return { error: "not found in skia_c.hpp" };

  const params = [];
  for (const [i, t] of d.params.entries()) {
    const dom = handleDomain(t);
    if (dom) {
      params.push({ kind: "handle", domain: dom, index: i });
      continue;
    }
    const s = scalar(t);
    if (s) {
      params.push({ kind: "scalar", ...s, index: i });
      continue;
    }
    return { error: `parameter ${i + 1} of type '${t}' is not a scalar or a known handle` };
  }

  // Return: void, a scalar, or a pointer we can put in a handle table.
  let ret;
  if (d.ret === "void") {
    ret = { kind: "void" };
  } else {
    const dom = handleDomain(d.ret + "*") ?? handleDomain(d.ret);
    if (dom) {
      ret = { kind: "handle", domain: dom };
    } else {
      const s = scalar(d.ret);
      if (!s) return { error: `return type '${d.ret}' is not a scalar or a known handle` };
      ret = { kind: "scalar", ...s };
    }
  }
  return { skiacName, params, ret, ...names(skiacName) };
}

/* ---- emit ---- */

const plans = [];
const problems = [];
for (const name of allow.generate) {
  const p = plan(name);
  if (p.error) problems.push(`${name}: ${p.error}`);
  else plans.push(p);
}

// A name in both lists is a contradiction, not a preference.
for (const name of Object.keys(allow.manual)) {
  if (allow.generate.includes(name)) {
    problems.push(`${name}: listed in BOTH generate and manual`);
  }
}

if (problems.length > 0) {
  console.error("gen-shim: refusing to emit; unclassifiable or contradictory entries:");
  for (const p of problems) console.error("  " + p);
  console.error(
    "\nMove each to skia-allowlist.json's `manual` map (with a reason) and\n" +
      "hand-write it in shim/sg_skia_extra.cpp.",
  );
  process.exit(1);
}

const BANNER = `/* GENERATED by codegen/gen-shim.js from skia_c.hpp. DO NOT EDIT.
 * Regenerate with: node codegen/gen-shim.js [target]
 */`;

/* --- the C side --- */

const cLines = [BANNER, "", '#include "sg_skia.h"', ""];

for (const p of plans) {
  const cParams = p.params
    .map((a, i) => (a.kind === "handle" ? `uint32_t h${i}` : `${a.c} a${i}`))
    .join(", ");
  // Every function takes at least one parameter: zero-arg FFI functions were
  // a suspected trouble spot in Phase 0 and the `unused` arg is free insurance.
  const sig = cParams === "" ? "int32_t unused" : cParams;
  const retC = p.ret.kind === "handle" ? "uint32_t" : p.ret.kind === "void" ? "int32_t" : p.ret.c;

  cLines.push(`extern "C" ${retC} ${p.c}(${sig}) {`);
  if (cParams === "") cLines.push("  (void)unused;");

  /* A `*_destroy` frees the native object, so its handle must be TAKEN (slot
   * released, generation bumped) rather than merely read: sg_table_get leaves
   * the slot occupied forever, which reads as a leak in the debug counters
   * and lets a stale handle resolve to freed memory. Only the FIRST handle
   * parameter is the destroyed object; any others are still borrowed. */
  const isDestroy = p.skiacName.endsWith("_destroy");
  const args = [];
  for (const [i, a] of p.params.entries()) {
    if (a.kind === "handle") {
      const ctype = Object.keys(DOMAINS).find((k) => DOMAINS[k] === a.domain);
      const accessor = isDestroy && i === 0 ? "sg_table_take" : "sg_table_get";
      cLines.push(`  ${ctype}* p${i} = (${ctype}*)${accessor}(${a.domain}, h${i});`);
      if (isDestroy && i === 0) {
        // A destroy must be IDEMPOTENT: double-free and stale-handle are the
        // same non-event, and skiac's destroys dereference their argument.
        cLines.push(`  if (!p${i}) return SG_OK;`);
      } else {
        // Elsewhere a NULL is only an error when the argument is not optional;
        // skiac reads a NULL paint as "no paint", and index 0 is never a live
        // handle, so h==0 is passed through as NULL deliberately.
        cLines.push(`  if (!p${i} && h${i} != 0) return ${p.ret.kind === "handle" ? "0" : "SG_EBADHANDLE"};`);
      }
      args.push(`p${i}`);
    } else {
      args.push(`${a.cast}a${i}`);
    }
  }

  const call = `${p.skiacName}(${args.join(", ")})`;
  if (p.ret.kind === "void") {
    cLines.push(`  ${call};`);
    cLines.push("  return SG_OK;");
  } else if (p.ret.kind === "handle") {
    cLines.push(`  return sg_table_alloc(${p.ret.domain}, (void*)${call});`);
  } else {
    cLines.push(`  return (${p.ret.c})${call};`);
  }
  cLines.push("}", "");
}

writeFileSync(join(root, "shim/sg_skia_gen.cpp"), cLines.join("\n"));

/* --- the TS side --- */

const tsLines = [
  BANNER.replace(/^\/\* /, "/* ").replace("DO NOT EDIT.", "DO NOT EDIT."),
  "",
  "/* Every wrapper returns its FFI call DIRECTLY. Binding the result to a",
  " * never-reassigned local made the compiler drop the call outright (see",
  " * docs/SPIKE-RESULTS.md); the generated shape is immune by construction.",
  " */",
  "",
];

const declLines = [];
const wrapLines = [];
for (const p of plans) {
  const tsParams = p.params.map((a, i) => `${a.kind === "handle" ? "h" : "a"}${i}: number`);
  const declParams = tsParams.length === 0 ? "unused: number" : tsParams.join(", ");
  const retTs = "number";
  declLines.push(`declare function ${p.ts}(${declParams}): ${retTs};`);

  const callArgs = tsParams.length === 0 ? "0" : p.params.map((a, i) => `${a.kind === "handle" ? "h" : "a"}${i}`).join(", ");
  const exportName = p.ts.replace(/^sg/, "");
  const exportLower = exportName.charAt(0).toLowerCase() + exportName.slice(1);
  wrapLines.push(
    `export function ${exportLower}(${tsParams.join(", ")}): ${retTs} { return ${p.ts}(${callArgs}); }`,
  );
}

tsLines.push(...declLines, "", ...wrapLines, "");
writeFileSync(join(root, "runtime/canvas/skia-ffi.ts"), tsLines.join("\n"));

console.log(
  `gen-shim: ${plans.length} generated, ${Object.keys(allow.manual).length} manual ` +
    `-> shim/sg_skia_gen.cpp, runtime/canvas/skia-ffi.ts`,
);
