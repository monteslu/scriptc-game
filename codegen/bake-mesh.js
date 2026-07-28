/* bake-mesh: glTF/GLB/OBJ -> a static .sgm binary, at BUILD time.
 *
 * Usage:
 *   node codegen/bake-mesh.js <in.glb|in.gltf|in.obj> <out.sgm> [--scale N]
 *
 * WHY BAKE AT ALL. Parsing glTF at runtime means a JSON parser, base64
 * decoding, accessor/sparse-accessor handling, and a dozen component-type
 * and interleaving permutations -- a large amount of code in the dialect,
 * running on every launch, to arrive at buffers that never change. The
 * dynamic world (npm parsers, JSON, whatever a DCC tool emitted) stays on
 * the build machine; the binary that ships is exactly what the GPU wants.
 *
 * ZERO DEPENDENCIES, matching every other tool in codegen/: `node:` builtins
 * only. GLB is a documented container and the accessor rules are narrow
 * once you restrict to what a game mesh actually uses, so a parser is
 * cheaper than a dependency here.
 *
 * THE FORMAT (.sgm, little-endian throughout):
 *
 *   magic     u32   0x4D475300 ("\0SGM")
 *   version   u32   1
 *   flags     u32   bit0 has normals, bit1 has uvs, bit2 has colors,
 *                   bit3 indices are u32 rather than u16
 *   vertexCount u32
 *   indexCount  u32   0 = non-indexed
 *   -- then, each aligned to 4 bytes, in this order:
 *   positions f32 * 3 * vertexCount
 *   normals   f32 * 3 * vertexCount   (if flags bit0)
 *   uvs       f32 * 2 * vertexCount   (if flags bit1)
 *   colors    f32 * 3 * vertexCount   (if flags bit2)
 *   indices   u16|u32 * indexCount    (if indexCount > 0)
 *
 * The loader reads the header, then slices. No parsing, no branching per
 * vertex, no allocation beyond the four typed arrays.
 *
 * SCOPE: one merged mesh per file. A glTF scene graph, materials, cameras,
 * lights, skins and animations are all dropped -- a game builds its scene
 * in code and this is a geometry pipe. Multi-primitive meshes are merged,
 * with indices rebased, which is what you want for a static prop anyway.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { basename, extname, dirname, join } from "node:path";

const MAGIC = 0x4d475300;
const VERSION = 1;
const F_NORMAL = 1;
const F_UV = 2;
const F_COLOR = 4;
const F_U32 = 8;

/* ---- glTF accessor plumbing ---- */

const COMPONENT_SIZE = {
  5120: 1, // BYTE
  5121: 1, // UNSIGNED_BYTE
  5122: 2, // SHORT
  5123: 2, // UNSIGNED_SHORT
  5125: 4, // UNSIGNED_INT
  5126: 4, // FLOAT
};

const TYPE_COUNT = {
  SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16,
};

/* Read an accessor into a plain JS number array.
 *
 * Handles the cases a mesh actually uses: any component type, any stride
 * (interleaved buffers are normal in optimised glTF), and normalised
 * integer attributes. Sparse accessors are refused loudly rather than
 * silently producing a mesh with holes. */
function readAccessor(gltf, buffers, index) {
  const acc = gltf.accessors[index];
  if (acc.sparse) {
    throw new Error(
      `accessor ${index} is sparse; bake-mesh does not support sparse ` +
      `accessors. Re-export without them, or file this as a gap.`);
  }

  const comps = TYPE_COUNT[acc.type];
  if (comps === undefined) throw new Error(`unknown accessor type ${acc.type}`);
  const compSize = COMPONENT_SIZE[acc.componentType];
  if (compSize === undefined) {
    throw new Error(`unknown componentType ${acc.componentType}`);
  }

  const out = new Array(acc.count * comps);

  // An accessor with no bufferView reads as all zeros, per spec.
  if (acc.bufferView === undefined) return out.fill(0);

  const view = gltf.bufferViews[acc.bufferView];
  const buf = buffers[view.buffer];
  const base = (view.byteOffset || 0) + (acc.byteOffset || 0);
  // byteStride is a property of the VIEW; absent means tightly packed.
  const stride = view.byteStride || comps * compSize;

  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  for (let i = 0; i < acc.count; i++) {
    const at = base + i * stride;
    for (let c = 0; c < comps; c++) {
      const o = at + c * compSize;
      let v;
      switch (acc.componentType) {
        case 5126: v = dv.getFloat32(o, true); break;
        case 5125: v = dv.getUint32(o, true); break;
        case 5123: v = dv.getUint16(o, true); break;
        case 5122: v = dv.getInt16(o, true); break;
        case 5121: v = dv.getUint8(o); break;
        case 5120: v = dv.getInt8(o); break;
        default: throw new Error(`unreachable componentType`);
      }
      /* `normalized` means an integer attribute encodes a float in
       * [0,1] or [-1,1]. Colours and packed normals arrive this way. */
      if (acc.normalized) {
        switch (acc.componentType) {
          case 5121: v = v / 255; break;
          case 5123: v = v / 65535; break;
          case 5120: v = Math.max(v / 127, -1); break;
          case 5122: v = Math.max(v / 32767, -1); break;
          default: break;
        }
      }
      out[i * comps + c] = v;
    }
  }
  return out;
}

/* ---- GLB container ----
 *
 * A GLB is a 12-byte header then a sequence of chunks. The first chunk is
 * the JSON, the second (optional) is the binary blob that bufferViews with
 * no `uri` refer to. */
function parseGLB(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = dv.getUint32(0, true);
  if (magic !== 0x46546c67) throw new Error("not a GLB (bad magic)");
  const version = dv.getUint32(4, true);
  if (version !== 2) throw new Error(`GLB version ${version}, expected 2`);

  let offset = 12;
  let json = null;
  let bin = null;
  while (offset + 8 <= bytes.byteLength) {
    const len = dv.getUint32(offset, true);
    const type = dv.getUint32(offset + 4, true);
    const start = offset + 8;
    if (type === 0x4e4f534a) {          // 'JSON'
      json = JSON.parse(Buffer.from(bytes.buffer, bytes.byteOffset + start, len)
        .toString("utf8"));
    } else if (type === 0x004e4942) {   // 'BIN\0'
      bin = Buffer.from(bytes.buffer, bytes.byteOffset + start, len);
    }
    // Chunks are 4-byte aligned.
    offset = start + len + ((4 - (len % 4)) % 4);
  }
  if (json === null) throw new Error("GLB has no JSON chunk");
  return { gltf: json, bin };
}

/** Resolve every glTF buffer to a Node Buffer. */
function resolveBuffers(gltf, bin, dir) {
  const out = [];
  for (const b of gltf.buffers || []) {
    if (b.uri === undefined) {
      if (bin === null) throw new Error("buffer has no uri and no BIN chunk");
      out.push(bin);
    } else if (b.uri.startsWith("data:")) {
      const comma = b.uri.indexOf(",");
      out.push(Buffer.from(b.uri.slice(comma + 1), "base64"));
    } else {
      out.push(readFileSync(new URL(decodeURIComponent(b.uri), dir)));
    }
  }
  return out;
}

/* ---- OBJ ----
 *
 * Wavefront OBJ is a text format with SHARED index lists: a face references
 * position, uv and normal by separate indices, so the same position appears
 * with several different normals. GPUs need one index per vertex, so this
 * de-duplicates on the v/vt/vn triple and builds a real index buffer. */
/* Parse a .mtl into name -> [r,g,b] from its Kd (diffuse) lines.
 *
 * Only Kd matters here: the runtime shades with Lambert, so specular and
 * illumination models have nowhere to go, and a game mesh's colour IS its
 * diffuse. */
function parseMTL(text) {
  const out = new Map();
  let current = null;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("newmtl ")) {
      current = line.slice(7).trim();
      out.set(current, [1, 1, 1]);
    } else if (line.startsWith("Kd ") && current !== null) {
      const p = line.split(/\s+/);
      out.set(current, [+p[1], +p[2], +p[3]]);
    }
  }
  return out;
}

function parseOBJ(text, materials) {
  const positions = [];
  const uvs = [];
  const normals = [];
  const outPos = [];
  const outUV = [];
  const outNrm = [];
  const outCol = [];
  const indices = [];
  /* The dedup key includes the MATERIAL, so one shared position used by a
   * red panel and a grey panel becomes two vertices with two colours.
   * Without that the whole ship renders in whichever material happened to
   * be active first. */
  const seen = new Map();
  let activeColor = null;

  // OBJ indices are 1-based and may be NEGATIVE (relative to the end).
  const resolve = (i, len) => (i > 0 ? i - 1 : len + i);

  const emit = (token) => {
    const key = activeColor === null ? token : `${token}|${activeColor.join(",")}`;
    const cached = seen.get(key);
    if (cached !== undefined) return cached;

    const parts = token.split("/");
    const vi = resolve(parseInt(parts[0], 10), positions.length / 3);
    outPos.push(positions[vi * 3], positions[vi * 3 + 1], positions[vi * 3 + 2]);

    if (parts.length > 1 && parts[1] !== "") {
      const ti = resolve(parseInt(parts[1], 10), uvs.length / 2);
      outUV.push(uvs[ti * 2], uvs[ti * 2 + 1]);
    } else if (uvs.length > 0) {
      outUV.push(0, 0);
    }

    if (parts.length > 2 && parts[2] !== "") {
      const ni = resolve(parseInt(parts[2], 10), normals.length / 3);
      outNrm.push(normals[ni * 3], normals[ni * 3 + 1], normals[ni * 3 + 2]);
    } else if (normals.length > 0) {
      outNrm.push(0, 0, 0);
    }

    if (activeColor !== null) outCol.push(...activeColor);

    const id = outPos.length / 3 - 1;
    seen.set(key, id);
    return id;
  };

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const parts = line.split(/\s+/);
    const kind = parts[0];
    if (kind === "v") {
      positions.push(+parts[1], +parts[2], +parts[3]);
    } else if (kind === "vt") {
      uvs.push(+parts[1], +parts[2]);
    } else if (kind === "vn") {
      normals.push(+parts[1], +parts[2], +parts[3]);
    } else if (kind === "usemtl") {
      const m = materials ? materials.get(parts[1]) : undefined;
      activeColor = m === undefined ? null : m;
    } else if (kind === "f") {
      /* Fan-triangulate: an OBJ face may be a quad or an n-gon, and
       * every DCC tool emits them. */
      const verts = parts.slice(1).map(emit);
      for (let i = 1; i + 1 < verts.length; i++) {
        indices.push(verts[0], verts[i], verts[i + 1]);
      }
    }
  }

  return {
    positions: outPos,
    normals: outNrm.length > 0 ? outNrm : null,
    uvs: outUV.length > 0 ? outUV : null,
    /* Materials become VERTEX COLOURS. The runtime has no material library
     * and a baked mesh is one draw call, so a multi-material model would
     * otherwise flatten to a single colour -- losing exactly the panel
     * detail that makes a model look like a model. */
    colors: outCol.length > 0 ? outCol : null,
    indices,
  };
}

/* ---- glTF -> one merged mesh ---- */
function meshFromGLTF(gltf, buffers) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const colors = [];
  const indices = [];
  let sawNormal = false;
  let sawUV = false;
  let sawColor = false;

  /* Primitives that share a POSITION accessor share their VERTEX BUFFER
   * and index different subsets of it -- which is exactly how a
   * multi-material model is authored. Copying the buffer per primitive
   * quadrupled a 410-vertex ship to 1640, with three quarters of it
   * unreferenced. Keyed by accessor index, so a shared buffer is emitted
   * once and later primitives just rebase onto it.
   *
   * The exception is a per-primitive MATERIAL colour: two primitives
   * sharing positions but wearing different colours genuinely need their
   * own vertices, so the key carries the colour too. */
  const emitted = new Map();

  for (const mesh of gltf.meshes || []) {
    for (const prim of mesh.primitives || []) {
      // 4 = TRIANGLES. Strips/fans/lines are not what a baked prop is.
      const mode = prim.mode === undefined ? 4 : prim.mode;
      if (mode !== 4) {
        console.warn(`bake-mesh: skipping primitive with mode ${mode} ` +
                     `(only TRIANGLES is supported)`);
        continue;
      }
      const attrs = prim.attributes;
      if (attrs.POSITION === undefined) continue;

      /* The colour this primitive will contribute, resolved up front so
       * it can take part in the dedup key. */
      let primColor = null;
      if (attrs.COLOR_0 === undefined && prim.material !== undefined &&
          gltf.materials) {
        const m = gltf.materials[prim.material];
        const f = (m && m.pbrMetallicRoughness &&
                   m.pbrMetallicRoughness.baseColorFactor) || [1, 1, 1, 1];
        primColor = `${f[0]},${f[1]},${f[2]}`;
      }
      const shareKey = `${attrs.POSITION}|${attrs.NORMAL}|${attrs.TEXCOORD_0}|` +
                       `${attrs.COLOR_0}|${primColor}`;
      const shared = emitted.get(shareKey);

      if (shared !== undefined) {
        /* Same buffer, same colour: reuse the vertices already emitted and
         * only append this primitive's indices, rebased onto them. */
        if (prim.indices !== undefined) {
          for (const i of readAccessor(gltf, buffers, prim.indices)) {
            indices.push(shared + i);
          }
        } else {
          const n = gltf.accessors[attrs.POSITION].count;
          for (let i = 0; i < n; i++) indices.push(shared + i);
        }
        continue;
      }

      const base = positions.length / 3;
      emitted.set(shareKey, base);
      const pos = readAccessor(gltf, buffers, attrs.POSITION);
      const count = pos.length / 3;
      for (const v of pos) positions.push(v);

      /* Every primitive must contribute the same attributes, or the
       * merged buffers fall out of step. Missing ones are zero-filled so
       * the arrays stay parallel. */
      if (attrs.NORMAL !== undefined) {
        sawNormal = true;
        for (const v of readAccessor(gltf, buffers, attrs.NORMAL)) normals.push(v);
      } else {
        for (let i = 0; i < count * 3; i++) normals.push(0);
      }

      if (attrs.TEXCOORD_0 !== undefined) {
        sawUV = true;
        for (const v of readAccessor(gltf, buffers, attrs.TEXCOORD_0)) uvs.push(v);
      } else {
        for (let i = 0; i < count * 2; i++) uvs.push(0);
      }

      if (attrs.COLOR_0 !== undefined) {
        sawColor = true;
        const c = readAccessor(gltf, buffers, attrs.COLOR_0);
        const acc = gltf.accessors[attrs.COLOR_0];
        const stride = TYPE_COUNT[acc.type];
        // COLOR_0 may be VEC4; the alpha is dropped.
        for (let i = 0; i < count; i++) {
          colors.push(c[i * stride], c[i * stride + 1], c[i * stride + 2]);
        }
      } else if (prim.material !== undefined && gltf.materials) {
        /* No per-vertex colours, but the PRIMITIVE names a material.
         *
         * This is how a flat-shaded kit is actually authored: one
         * primitive per material, each with a baseColorFactor. Merging
         * them without reading that factor collapses a four-tone model to
         * a single colour and loses exactly the panel detail (dark
         * cockpit, coloured trim) that makes it read as a model.
         *
         * baseColorFactor is linear; the renderer shades in the same
         * space, so it is used as-is. */
        const mat = gltf.materials[prim.material];
        const f = (mat && mat.pbrMetallicRoughness &&
                   mat.pbrMetallicRoughness.baseColorFactor) || [1, 1, 1, 1];
        sawColor = true;
        for (let i = 0; i < count; i++) colors.push(f[0], f[1], f[2]);
      } else {
        for (let i = 0; i < count * 3; i++) colors.push(1);
      }

      if (prim.indices !== undefined) {
        for (const i of readAccessor(gltf, buffers, prim.indices)) {
          indices.push(base + i);
        }
      } else {
        for (let i = 0; i < count; i++) indices.push(base + i);
      }
    }
  }

  return {
    positions,
    normals: sawNormal ? normals : null,
    uvs: sawUV ? uvs : null,
    colors: sawColor ? colors : null,
    indices,
  };
}

/* Drop vertices no index references, and renumber what remains.
 *
 * A multi-material glTF shares ONE vertex buffer across its primitives and
 * indexes a subset per material. Since each material needs its own colour,
 * the buffer is emitted once per primitive -- so a 410-vertex ship with 4
 * materials carries 1640 vertices of which only the indexed ~840 are ever
 * drawn. The rest is dead weight in the file, in the upload, and in the
 * vertex shader.
 *
 * Non-indexed meshes are returned untouched: every vertex is referenced by
 * definition. */
function dropUnusedVertices(mesh) {
  if (!mesh.indices || mesh.indices.length === 0) return mesh;

  const used = new Map();
  const order = [];
  for (const i of mesh.indices) {
    if (!used.has(i)) { used.set(i, order.length); order.push(i); }
  }
  const before = mesh.positions.length / 3;
  if (order.length === before) return mesh;   // nothing to drop

  const take = (src, size) => {
    if (!src) return null;
    const out = [];
    for (const i of order) {
      for (let k = 0; k < size; k++) out.push(src[i * size + k]);
    }
    return out;
  };

  return {
    positions: take(mesh.positions, 3),
    normals: take(mesh.normals, 3),
    uvs: take(mesh.uvs, 2),
    colors: take(mesh.colors, 3),
    indices: mesh.indices.map((i) => used.get(i)),
    dropped: before - order.length,
  };
}

/* ---- write .sgm ---- */
function writeSGM(mesh, outPath, scale) {
  const vertexCount = mesh.positions.length / 3;
  const indexCount = mesh.indices ? mesh.indices.length : 0;

  if (vertexCount === 0) {
    throw new Error("mesh has no vertices; refusing to write an empty .sgm");
  }

  let flags = 0;
  if (mesh.normals) flags |= F_NORMAL;
  if (mesh.uvs) flags |= F_UV;
  if (mesh.colors) flags |= F_COLOR;
  /* u16 indices cap at 65535, so anything larger needs u32. Choosing per
   * file rather than always u32 halves the index data for the common
   * case. */
  const needU32 = vertexCount > 65535;
  if (needU32) flags |= F_U32;

  const headerBytes = 20;
  const posBytes = vertexCount * 3 * 4;
  const nrmBytes = mesh.normals ? vertexCount * 3 * 4 : 0;
  const uvBytes = mesh.uvs ? vertexCount * 2 * 4 : 0;
  const colBytes = mesh.colors ? vertexCount * 3 * 4 : 0;
  const idxBytes = indexCount * (needU32 ? 4 : 2);

  const total = headerBytes + posBytes + nrmBytes + uvBytes + colBytes + idxBytes;
  const out = Buffer.alloc(total);

  let o = 0;
  out.writeUInt32LE(MAGIC, o); o += 4;
  out.writeUInt32LE(VERSION, o); o += 4;
  out.writeUInt32LE(flags, o); o += 4;
  out.writeUInt32LE(vertexCount, o); o += 4;
  out.writeUInt32LE(indexCount, o); o += 4;

  for (let i = 0; i < vertexCount * 3; i++) {
    out.writeFloatLE(mesh.positions[i] * scale, o); o += 4;
  }
  if (mesh.normals) {
    // Normals are directions: scaled uniformly, they are unchanged.
    for (let i = 0; i < vertexCount * 3; i++) {
      out.writeFloatLE(mesh.normals[i], o); o += 4;
    }
  }
  if (mesh.uvs) {
    for (let i = 0; i < vertexCount * 2; i++) {
      out.writeFloatLE(mesh.uvs[i], o); o += 4;
    }
  }
  if (mesh.colors) {
    for (let i = 0; i < vertexCount * 3; i++) {
      out.writeFloatLE(mesh.colors[i], o); o += 4;
    }
  }
  for (let i = 0; i < indexCount; i++) {
    if (needU32) { out.writeUInt32LE(mesh.indices[i], o); o += 4; }
    else { out.writeUInt16LE(mesh.indices[i], o); o += 2; }
  }

  writeFileSync(outPath, out);
  return { vertexCount, indexCount, flags, total, needU32 };
}

/* ---- main ---- */
function main(argv) {
  const args = argv.slice(2);
  if (args.length < 2) {
    console.error("usage: node codegen/bake-mesh.js <in.glb|gltf|obj> <out.sgm> [--scale N]");
    process.exit(2);
  }
  const inPath = args[0];
  const outPath = args[1];
  let scale = 1;
  const si = args.indexOf("--scale");
  if (si >= 0 && args[si + 1] !== undefined) scale = parseFloat(args[si + 1]);

  const ext = extname(inPath).toLowerCase();
  let mesh;

  if (ext === ".obj") {
    /* An OBJ names its .mtl with `mtllib`; resolve it beside the model.
     * A missing file is not fatal -- the mesh just has no colours. */
    const objText = readFileSync(inPath, "utf8");
    let materials = null;
    const lib = /^mtllib\s+(.+)$/m.exec(objText);
    if (lib) {
      const mtlPath = join(dirname(inPath), lib[1].trim());
      if (existsSync(mtlPath)) {
        materials = parseMTL(readFileSync(mtlPath, "utf8"));
        console.log(`bake-mesh: ${basename(mtlPath)}: ${materials.size} materials`);
      } else {
        console.warn(`bake-mesh: ${lib[1].trim()} not found beside the model; ` +
                     `baking without colours`);
      }
    }
    mesh = parseOBJ(objText, materials);
  } else if (ext === ".glb") {
    const { gltf, bin } = parseGLB(readFileSync(inPath));
    mesh = meshFromGLTF(gltf, resolveBuffers(gltf, bin, new URL(`file://${process.cwd()}/`)));
  } else if (ext === ".gltf") {
    const gltf = JSON.parse(readFileSync(inPath, "utf8"));
    const dir = new URL(`file://${process.cwd()}/${inPath}`);
    mesh = meshFromGLTF(gltf, resolveBuffers(gltf, null, dir));
  } else {
    console.error(`bake-mesh: unknown extension "${ext}" (want .glb, .gltf or .obj)`);
    process.exit(2);
  }

  const trimmed = dropUnusedVertices(mesh);
  if (trimmed.dropped) {
    console.log(`bake-mesh: dropped ${trimmed.dropped} unreferenced vertices`);
  }
  const info = writeSGM(trimmed, outPath, scale);
  const parts = [];
  if (info.flags & F_NORMAL) parts.push("normals");
  if (info.flags & F_UV) parts.push("uvs");
  if (info.flags & F_COLOR) parts.push("colors");
  console.log(
    `bake-mesh: ${basename(inPath)} -> ${basename(outPath)}  ` +
    `${info.vertexCount} verts, ${info.indexCount} indices ` +
    `(${info.needU32 ? "u32" : "u16"}), ${parts.join("+") || "positions only"}, ` +
    `${info.total} bytes`);
}

main(process.argv);

export { parseOBJ, parseGLB, meshFromGLTF, writeSGM, readAccessor };
