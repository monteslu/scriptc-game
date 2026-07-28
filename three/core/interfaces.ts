/* The renderer's view of a scene node.
 *
 * These exist because the dialect cannot downcast: `Object3D` narrowed to
 * `Mesh` is SC1090. three does that implicitly through `isMesh` flags, so
 * the equivalent here is a node holding a TYPED SELF-REFERENCE, and these
 * interfaces are what that reference is typed as.
 *
 * They live in their own file, rather than in Object3D.ts, because they
 * name types from objects/, materials/ and textures/ -- all of which import
 * Object3D. A leaf module both sides can import is what keeps that from
 * being a cycle (SC1016).
 *
 * Every member the renderer touches is here. A missing one shows up as a
 * compile error at the call site, not as a silent behaviour change.
 */
import { Matrix4 } from "../math/Matrix4.js";
import { Color } from "../math/Color.js";
import { BufferAttribute } from "./BufferAttribute.js";
import {
  WebGLVertexArrayObject, WebGLBuffer, WebGLTexture,
} from "../../web/webgl/objects.js";
import { Image } from "../../web/canvas/image.js";
import { Context2D } from "../../web/canvas/context.js";

export interface TextureLike {
  image: Image | null;
  canvas: Context2D | null;
  minFilter: number;
  magFilter: number;
  wrapS: number;
  wrapT: number;
  needsUpdate: boolean;
  glTexture: WebGLTexture | null;
}

export interface MaterialLike {
  visible: boolean;
  transparent: boolean;
  opacity: number;
  side: number;
  color: Color;
  emissive: Color;
  map: TextureLike | null;
  featureBits(): number;
}

export interface GeometryLike {
  position: BufferAttribute | null;
  normal: BufferAttribute | null;
  uv: BufferAttribute | null;
  color: BufferAttribute | null;
  index: BufferAttribute | null;
  boundingRadius: number;
  glVAO: WebGLVertexArrayObject | null;
  glPositionBuffer: WebGLBuffer | null;
  glNormalBuffer: WebGLBuffer | null;
  glUVBuffer: WebGLBuffer | null;
  glColorBuffer: WebGLBuffer | null;
  glIndexBuffer: WebGLBuffer | null;
  getDrawCount(): number;
}

export interface MeshLike {
  geometry: GeometryLike;
  material: MaterialLike;
  matrixWorld: Matrix4;
}

export interface LightLike {
  lightType: number;
  color: Color;
  intensity: number;
  matrixWorld: Matrix4;
}
