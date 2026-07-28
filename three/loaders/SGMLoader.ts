/* SGMLoader: load a baked .sgm mesh into a BufferGeometry.
 *
 * The runtime half of `codegen/bake-mesh.js`. The format is documented
 * there; the short version is a 20-byte header followed by tightly packed
 * f32 attribute blocks and a u16/u32 index block.
 *
 * Usage mirrors three's loaders, minus the callback-triple:
 *
 *   const loader = new SGMLoader();
 *   loader.load("ship.sgm").then((geometry) => {
 *     scene.addMesh(new Mesh(geometry, material));
 *   });
 *
 * WHY THIS IS SMALL. Everything variable about glTF -- accessor types,
 * interleaving, sparse storage, base64 data URIs, the scene graph -- was
 * resolved at build time. What arrives here is exactly the buffers the GPU
 * wants, in a fixed order, so the loader is a header read and four loops.
 * That is the point of baking rather than parsing glTF at runtime.
 *
 * ERRORS ARE LOUD. A truncated or wrong-magic file rejects with a message
 * naming the file and what was wrong, rather than returning a geometry with
 * zero vertices that renders as nothing and looks like a shader bug.
 */
import { BufferGeometry } from "../core/BufferGeometry.js";
import { BufferAttribute } from "../core/BufferAttribute.js";
import { fetch } from "../../web/globals.js";

const MAGIC = 0x4d475300;
const VERSION = 1;
const F_NORMAL = 1;
const F_UV = 2;
const F_COLOR = 4;
const F_U32 = 8;
const HEADER_BYTES = 20;

export class SGMLoader {
  /* Fetch and parse. Rejects on a bad file rather than resolving with an
   * empty geometry: a mesh that silently fails to load is indistinguishable
   * from a material or camera bug, and costs far more to track down. */
  load(url: string): Promise<BufferGeometry> {
    return fetch(url)
      .then((res) => res.arrayBuffer())
      .then((bytes) => this.parse(bytes, url));
  }

  /** Parse an already-fetched buffer. Throws on malformed input. */
  parse(bytes: Buffer, label: string): BufferGeometry {
    if (bytes.length < HEADER_BYTES) {
      throw new Error(`${label}: too short to be an .sgm ` +
                      `(${bytes.length} bytes, need at least ${HEADER_BYTES})`);
    }

    const magic = bytes.readUInt32LE(0);
    if (magic !== MAGIC) {
      throw new Error(`${label}: not an .sgm file (bad magic ${magic}; ` +
                      `expected ${MAGIC}). Bake it with codegen/bake-mesh.js.`);
    }

    const version = bytes.readUInt32LE(4);
    if (version !== VERSION) {
      throw new Error(`${label}: .sgm version ${version}, this build reads ${VERSION}. ` +
                      `Re-run codegen/bake-mesh.js.`);
    }

    const flags = bytes.readUInt32LE(8);
    const vertexCount = bytes.readUInt32LE(12);
    const indexCount = bytes.readUInt32LE(16);

    const hasNormal = (flags & F_NORMAL) !== 0;
    const hasUV = (flags & F_UV) !== 0;
    const hasColor = (flags & F_COLOR) !== 0;
    const u32 = (flags & F_U32) !== 0;

    /* Check the length BEFORE reading, so a truncated file gives one clear
     * error rather than a run of zeros or an out-of-range read. */
    const expected = HEADER_BYTES +
      vertexCount * 3 * 4 +
      (hasNormal ? vertexCount * 3 * 4 : 0) +
      (hasUV ? vertexCount * 2 * 4 : 0) +
      (hasColor ? vertexCount * 3 * 4 : 0) +
      indexCount * (u32 ? 4 : 2);
    if (bytes.length < expected) {
      throw new Error(`${label}: truncated .sgm (${bytes.length} bytes, ` +
                      `header describes ${expected})`);
    }

    const geo = new BufferGeometry();
    let o = HEADER_BYTES;

    const positions: number[] = [];
    for (let i = 0; i < vertexCount * 3; i++) {
      positions.push(bytes.readFloatLE(o));
      o += 4;
    }
    geo.setAttribute("position", new BufferAttribute(positions, 3, false));

    if (hasNormal) {
      const normals: number[] = [];
      for (let i = 0; i < vertexCount * 3; i++) {
        normals.push(bytes.readFloatLE(o));
        o += 4;
      }
      geo.setAttribute("normal", new BufferAttribute(normals, 3, false));
    }

    if (hasUV) {
      const uvs: number[] = [];
      for (let i = 0; i < vertexCount * 2; i++) {
        uvs.push(bytes.readFloatLE(o));
        o += 4;
      }
      geo.setAttribute("uv", new BufferAttribute(uvs, 2, false));
    }

    if (hasColor) {
      const colors: number[] = [];
      for (let i = 0; i < vertexCount * 3; i++) {
        colors.push(bytes.readFloatLE(o));
        o += 4;
      }
      geo.setAttribute("color", new BufferAttribute(colors, 3, false));
    }

    if (indexCount > 0) {
      const indices: number[] = [];
      for (let i = 0; i < indexCount; i++) {
        if (u32) {
          indices.push(bytes.readUInt32LE(o));
          o += 4;
        } else {
          indices.push(bytes.readUInt16LE(o));
          o += 2;
        }
      }
      geo.setIndex(new BufferAttribute(indices, 1, false));
    }

    /* A baked mesh with no normals cannot be lit, and the renderer's shader
     * reads a normal attribute unconditionally. Generating them here means
     * an OBJ exported without normals still works rather than rendering
     * black. */
    if (!hasNormal) geo.computeVertexNormals();

    return geo;
  }
}
