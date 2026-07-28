/* WebGLRenderer: the forward renderer.
 *
 * API-compatible with three for what a game calls: `new WebGLRenderer()`,
 * `setSize`, `setClearColor`, `render(scene, camera)`.
 *
 * Three things are deliberately different inside, and all three are the
 * dialect's fences turning into better architecture:
 *
 *   PROGRAM CACHE keyed by a FEATURE BITMASK (a number), not by a string of
 *   concatenated #defines. Two materials wanting the same features share
 *   one compiled program, and the lookup is an integer compare.
 *
 *   NO UNIFORM REFLECTION. three walks a string-keyed uniform map per draw.
 *   Here each material class knows its uniforms statically, so binding is a
 *   fixed sequence of typed setters.
 *
 *   GEOMETRY OWNS ITS GL STATE. The VAO, vertex buffers and index buffer
 *   live on the BufferGeometry and are created once, on first draw.
 */
import { WebGL2RenderingContext } from "../../web/webgl/context.js";
import {
  WebGLProgram, WebGLUniformLocation, WebGLVertexArrayObject, WebGLBuffer,
  WebGLTexture,
} from "../../web/webgl/objects.js";
import {
  COLOR_BUFFER_BIT, DEPTH_BUFFER_BIT, DEPTH_TEST, CULL_FACE, BACK, FRONT,
  ARRAY_BUFFER, ELEMENT_ARRAY_BUFFER, STATIC_DRAW, TRIANGLES, FLOAT,
  UNSIGNED_SHORT, VERTEX_SHADER, FRAGMENT_SHADER, TEXTURE_2D, TEXTURE0,
  RGBA, UNSIGNED_BYTE, TEXTURE_MIN_FILTER, TEXTURE_MAG_FILTER, LINEAR,
  CLAMP_TO_EDGE, REPEAT, TEXTURE_WRAP_S, TEXTURE_WRAP_T, COMPILE_STATUS,
  LINK_STATUS, BLEND, SRC_ALPHA, ONE_MINUS_SRC_ALPHA, ONE, LEQUAL, DEPTH_FUNC,
  POINTS as GL_POINTS, LINES, LINE_LOOP, LINE_STRIP, DYNAMIC_DRAW,
} from "../../web/webgl/constants.js";
import { Scene } from "../core/Scene.js";
import { PerspectiveCamera } from "../core/PerspectiveCamera.js";
import { Object3D } from "../core/Object3D.js";

import { Mesh } from "../objects/Mesh.js";
import { BufferGeometry } from "../core/BufferGeometry.js";
import {
  Material, MeshLambertMaterial, AdditiveBlending,
  FEAT_MAP, FEAT_VERTEX_COLORS, FEAT_LAMBERT,
  FEAT_EMISSIVE, FEAT_INSTANCED, FEAT_POINTS, FEAT_SPRITE,
  PointsMaterial, SpriteMaterial, DoubleSide, BackSide,
} from "../materials/Material.js";
import { InstancedMesh } from "../objects/InstancedMesh.js";
import { Sprite, Line, LineSegments, LineLoop, Points } from "../objects/Sprite.js";
import {
  Light, AmbientLight, DirectionalLight, PointLight,
  LIGHT_AMBIENT, LIGHT_DIRECTIONAL, LIGHT_POINT,
} from "../lights/Light.js";
import { Texture } from "../textures/Texture.js";
import { Matrix4 } from "../math/Matrix4.js";
import { Matrix3 } from "../math/Matrix3.js";
import { Vector3 } from "../math/Vector3.js";
import { Color } from "../math/Color.js";

/* Fixed light maxima. A game-sized budget keeps the shader branch-free and
 * the uniform block small; three's unbounded arrays are what force its
 * shaders to be regenerated per light count. */
const MAX_DIR_LIGHTS = 4;
const MAX_POINT_LIGHTS = 8;

/** One compiled program plus the uniform locations it uses. */
class Program {
  features = 0;
  /* The spec objects, not raw GL names: gl.useProgram takes a WebGLProgram
   * and gl.uniform*  take a WebGLUniformLocation. Keeping the wrappers here
   * means the renderer calls the same API a browser exposes. */
  glProgram: WebGLProgram | null = null;
  uModelViewMatrix: WebGLUniformLocation | null = null;
  uProjectionMatrix: WebGLUniformLocation | null = null;
  uNormalMatrix: WebGLUniformLocation | null = null;
  uColor: WebGLUniformLocation | null = null;
  uOpacity: WebGLUniformLocation | null = null;
  uMap: WebGLUniformLocation | null = null;
  uMapTransform: WebGLUniformLocation | null = null;
  uEmissive: WebGLUniformLocation | null = null;
  uAmbient: WebGLUniformLocation | null = null;
  uDirCount: WebGLUniformLocation | null = null;
  uDirDirections: WebGLUniformLocation | null = null;
  uDirColors: WebGLUniformLocation | null = null;
  uPointCount: WebGLUniformLocation | null = null;
  uPointPositions: WebGLUniformLocation | null = null;
  uPointColors: WebGLUniformLocation | null = null;
  uPointFalloff: WebGLUniformLocation | null = null;
  uPointSize: WebGLUniformLocation | null = null;
  uSizeAttenuation: WebGLUniformLocation | null = null;
  uSpriteCenter: WebGLUniformLocation | null = null;
  uSpriteRotation: WebGLUniformLocation | null = null;
  uSpriteScale: WebGLUniformLocation | null = null;
}

export class WebGLRenderer {
  private gl: WebGL2RenderingContext;
  private programs: Program[] = [];

  private width = 0;
  private height = 0;
  private clearColor: Color = new Color(0x000000);

  /* Scratch reused every draw. A 200-object scene allocates nothing here. */
  private modelView: Matrix4 = new Matrix4();
  private normalMatrix: Matrix3 = new Matrix3();
  private mat4Buf: Buffer = Buffer.alloc(64);
  private mat3Buf: Buffer = Buffer.alloc(36);
  private vec3Buf: Buffer = Buffer.alloc(MAX_POINT_LIGHTS * 12);
  private colorBuf: Buffer = Buffer.alloc(MAX_POINT_LIGHTS * 12);
  private falloffBuf: Buffer = Buffer.alloc(MAX_POINT_LIGHTS * 8);

  /* Collected per frame by walking the scene once. */
  private opaque: Mesh[] = [];
  private transparent: Mesh[] = [];
  private dirLights: Light[] = [];
  private pointLights: Light[] = [];
  private ambient: Color = new Color(0x000000);

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    gl.enable(DEPTH_TEST);
    gl.depthFunc(LEQUAL);
    gl.enable(CULL_FACE);
  }

  setSize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.gl.viewport(0, 0, width, height);
  }

  setClearColor(color: number): void {
    this.clearColor.setHex(color);
  }

  /* ---- shader assembly ----
   *
   * One template, with the feature bits deciding which lines are present.
   * GLSL 300 es, which is what WebGL2 requires. */

  private vertexSource(features: number): string {
    let s = "#version 300 es\n";
    s += "in vec3 position;\n";
    s += "in vec3 normal;\n";
    if ((features & FEAT_MAP) !== 0) s += "in vec2 uv;\n";
    if ((features & FEAT_VERTEX_COLORS) !== 0) s += "in vec3 color;\n";
    /* A mat4 attribute occupies four consecutive locations (4..7), one per
     * column, each with a divisor of 1 so it advances per INSTANCE. */
    if ((features & FEAT_INSTANCED) !== 0) s += "in mat4 instanceMatrix;\n";
    if ((features & FEAT_INSTANCED) !== 0) s += "in vec3 instanceColor;\n";
    s += "uniform mat4 modelViewMatrix;\n";
    s += "uniform mat4 projectionMatrix;\n";
    s += "uniform mat3 normalMatrix;\n";
    if ((features & FEAT_POINTS) !== 0) {
      s += "uniform float pointSize;\n";
      s += "uniform float sizeAttenuation;\n";
    }
    if ((features & FEAT_SPRITE) !== 0) {
      s += "uniform vec2 spriteCenter;\n";
      s += "uniform float spriteRotation;\n";
      s += "uniform vec2 spriteScale;\n";
    }
    s += "out vec3 vNormal;\n";
    s += "out vec3 vViewPosition;\n";
    if ((features & FEAT_MAP) !== 0) s += "out vec2 vUv;\n";
    if ((features & FEAT_VERTEX_COLORS) !== 0) s += "out vec3 vColor;\n";
    if ((features & FEAT_INSTANCED) !== 0) s += "out vec3 vInstanceColor;\n";
    s += "void main() {\n";

    if ((features & FEAT_SPRITE) !== 0) {
      /* Billboard: take the sprite's world POSITION from the model-view
       * matrix but drop its rotation, so the quad is built in view space
       * and always faces the camera. `center` shifts the anchor within the
       * quad; `rotation` spins it in screen space. */
      /* The sprite's view-space POSITION is the translation column of
       * modelViewMatrix. Reading it directly rather than transforming the
       * origin keeps the object's scale out of it: the scale belongs on
       * the quad offset below, and applying it to the position too made
       * every sprite a sliver. */
      s += "  vec4 mvPosition = vec4(modelViewMatrix[3].xyz, 1.0);\n";
      s += "  vec2 offset = position.xy - (spriteCenter - vec2(0.5));\n";
      s += "  offset *= spriteScale;\n";
      s += "  float sr = sin(spriteRotation);\n";
      s += "  float cr = cos(spriteRotation);\n";
      s += "  offset = vec2(offset.x * cr - offset.y * sr,\n";
      s += "                offset.x * sr + offset.y * cr);\n";
      s += "  mvPosition.xy += offset;\n";
      s += "  vNormal = vec3(0.0, 0.0, 1.0);\n";
    } else if ((features & FEAT_INSTANCED) !== 0) {
      s += "  vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);\n";
      /* The instance matrix rotates the normal too. Using its 3x3 directly
       * is correct for the rigid + uniform-scale transforms instancing is
       * used for; non-uniform per-instance scale would need a per-instance
       * inverse-transpose, which is not worth the bandwidth here. */
      s += "  vNormal = normalize(normalMatrix * mat3(instanceMatrix) * normal);\n";
    } else {
      s += "  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);\n";
      s += "  vNormal = normalize(normalMatrix * normal);\n";
    }

    s += "  vViewPosition = -mvPosition.xyz;\n";
    if ((features & FEAT_MAP) !== 0) s += "  vUv = uv;\n";
    if ((features & FEAT_VERTEX_COLORS) !== 0) s += "  vColor = color;\n";
    if ((features & FEAT_INSTANCED) !== 0) s += "  vInstanceColor = instanceColor;\n";
    s += "  gl_Position = projectionMatrix * mvPosition;\n";
    if ((features & FEAT_POINTS) !== 0) {
      /* With attenuation the pixel size falls off as 1/distance, matching
       * three's PointsMaterial; without it the size is constant on screen. */
      s += "  gl_PointSize = mix(pointSize,\n";
      s += "                     pointSize / max(0.0001, -mvPosition.z),\n";
      s += "                     sizeAttenuation);\n";
    }
    s += "}\n";
    return s;
  }

  private fragmentSource(features: number): string {
    let s = "#version 300 es\n";
    s += "precision highp float;\n";
    s += "in vec3 vNormal;\n";
    s += "in vec3 vViewPosition;\n";
    if ((features & FEAT_MAP) !== 0) s += "in vec2 vUv;\n";
    if ((features & FEAT_VERTEX_COLORS) !== 0) s += "in vec3 vColor;\n";
    if ((features & FEAT_INSTANCED) !== 0) s += "in vec3 vInstanceColor;\n";
    s += "uniform vec3 diffuse;\n";
    s += "uniform float opacity;\n";
    if ((features & FEAT_MAP) !== 0) {
      s += "uniform sampler2D map;\n";
      s += "uniform vec4 mapTransform;\n";   // xy = repeat, zw = offset
    }
    if ((features & FEAT_EMISSIVE) !== 0) s += "uniform vec3 emissive;\n";
    if ((features & FEAT_LAMBERT) !== 0) {
      s += "uniform vec3 ambientLightColor;\n";
      s += `uniform int dirLightCount;\n`;
      s += `uniform vec3 dirLightDirections[${MAX_DIR_LIGHTS}];\n`;
      s += `uniform vec3 dirLightColors[${MAX_DIR_LIGHTS}];\n`;
      s += `uniform int pointLightCount;\n`;
      s += `uniform vec3 pointLightPositions[${MAX_POINT_LIGHTS}];\n`;
      s += `uniform vec3 pointLightColors[${MAX_POINT_LIGHTS}];\n`;
      /* x = distance (0 = no cutoff), y = decay exponent. */
      s += `uniform vec2 pointLightFalloff[${MAX_POINT_LIGHTS}];\n`;
    }
    s += "out vec4 fragColor;\n";
    s += "void main() {\n";
    s += "  vec4 base = vec4(diffuse, opacity);\n";
    /* A point sprite has no uv attribute: gl_PointCoord gives the position
     * within the point, which is the only sensible texture coordinate. It
     * runs top-down like a texture source, so v is flipped to match. */
    if ((features & FEAT_MAP) !== 0 && (features & FEAT_POINTS) !== 0) {
      s += "  base *= texture(map, vec2(gl_PointCoord.x, 1.0 - gl_PointCoord.y) * mapTransform.xy + mapTransform.zw);\n";
    } else if ((features & FEAT_MAP) !== 0) {
      s += "  base *= texture(map, vUv * mapTransform.xy + mapTransform.zw);\n";
    }
    if ((features & FEAT_VERTEX_COLORS) !== 0) s += "  base.rgb *= vColor;\n";
    if ((features & FEAT_INSTANCED) !== 0) s += "  base.rgb *= vInstanceColor;\n";

    if ((features & FEAT_LAMBERT) !== 0) {
      s += "  vec3 n = normalize(vNormal);\n";
      s += "  vec3 lit = ambientLightColor;\n";
      s += `  for (int i = 0; i < ${MAX_DIR_LIGHTS}; i++) {\n`;
      s += "    if (i >= dirLightCount) break;\n";
      s += "    lit += dirLightColors[i] * max(dot(n, dirLightDirections[i]), 0.0);\n";
      s += "  }\n";
      s += `  for (int i = 0; i < ${MAX_POINT_LIGHTS}; i++) {\n`;
      s += "    if (i >= pointLightCount) break;\n";
      s += "    vec3 toLight = pointLightPositions[i] + vViewPosition;\n";
      s += "    float dist = length(toLight);\n";
      /* three's falloff, so a PointLight's `distance` and `decay` mean what
       * the three docs say rather than being ignored.
       *
       * The previous formula was a fixed 1/(1 + 0.1*d^2), which reaches
       * 0.008 at d=35 -- an object 35 units from a light rendered
       * essentially black however the light was configured. That is why the
       * asteroid belt in examples/orbits was unlit.
       *
       *   atten = 1/max(d,eps)^decay, windowed to reach exactly 0 at
       *   `distance` so a light has a bounded region of influence.
       *
       * distance == 0 means no cutoff, matching three. */
      s += "    float lightDist = pointLightFalloff[i].x;\n";
      s += "    float lightDecay = pointLightFalloff[i].y;\n";
      s += "    float atten = 1.0 / max(pow(max(dist, 0.01), lightDecay), 0.0001);\n";
      s += "    if (lightDist > 0.0) {\n";
      s += "      float w = clamp(1.0 - pow(dist / lightDist, 4.0), 0.0, 1.0);\n";
      s += "      atten *= w * w;\n";
      s += "    }\n";
      s += "    lit += pointLightColors[i] * max(dot(n, toLight / dist), 0.0) * atten;\n";
      s += "  }\n";
      s += "  base.rgb *= lit;\n";
    }
    if ((features & FEAT_EMISSIVE) !== 0) s += "  base.rgb += emissive;\n";

    s += "  fragColor = base;\n";
    s += "}\n";
    return s;
  }

  /** The program for a feature set, compiled once and reused. */
  private getProgram(features: number): Program | null {
    for (let i = 0; i < this.programs.length; i++) {
      if (this.programs[i].features === features) return this.programs[i];
    }

    const gl = this.gl;
    const vs = gl.createShader(VERTEX_SHADER);
    gl.shaderSource(vs, this.vertexSource(features));
    gl.compileShader(vs);
    if (gl.getShaderParameter(vs, COMPILE_STATUS) === 0) {
      console.log(`three: vertex shader failed: ${gl.getShaderInfoLog(vs)}`);
      return null;
    }

    const fs = gl.createShader(FRAGMENT_SHADER);
    gl.shaderSource(fs, this.fragmentSource(features));
    gl.compileShader(fs);
    if (gl.getShaderParameter(fs, COMPILE_STATUS) === 0) {
      console.log(`three: fragment shader failed: ${gl.getShaderInfoLog(fs)}`);
      return null;
    }

    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    /* Bind attribute locations BEFORE linking so every program agrees:
     * position 0, normal 1, uv 2, color 3. That lets one VAO serve any
     * material. */
    gl.bindAttribLocation(prog, 0, "position");
    gl.bindAttribLocation(prog, 1, "normal");
    gl.bindAttribLocation(prog, 2, "uv");
    gl.bindAttribLocation(prog, 3, "color");
    /* A mat4 attribute consumes locations 4,5,6,7 -- one per column -- so
     * instanceColor cannot start before 8. Binding these unconditionally
     * keeps every program's layout identical whether or not it instances. */
    gl.bindAttribLocation(prog, 4, "instanceMatrix");
    gl.bindAttribLocation(prog, 8, "instanceColor");
    gl.linkProgram(prog);
    if (gl.getProgramParameter(prog, LINK_STATUS) === 0) {
      console.log(`three: program link failed: ${gl.getProgramInfoLog(prog)}`);
      return null;
    }

    const p = new Program();
    p.features = features;
    p.glProgram = prog;
    const loc = (n: string): WebGLUniformLocation | null => gl.getUniformLocation(prog, n);
    p.uModelViewMatrix = loc("modelViewMatrix");
    p.uProjectionMatrix = loc("projectionMatrix");
    p.uNormalMatrix = loc("normalMatrix");
    p.uColor = loc("diffuse");
    p.uOpacity = loc("opacity");
    p.uMap = loc("map");
    p.uMapTransform = loc("mapTransform");
    p.uEmissive = loc("emissive");
    p.uAmbient = loc("ambientLightColor");
    p.uDirCount = loc("dirLightCount");
    p.uDirDirections = loc("dirLightDirections[0]");
    p.uDirColors = loc("dirLightColors[0]");
    p.uPointCount = loc("pointLightCount");
    p.uPointPositions = loc("pointLightPositions[0]");
    p.uPointColors = loc("pointLightColors[0]");
    p.uPointFalloff = loc("pointLightFalloff[0]");
    p.uPointSize = loc("pointSize");
    p.uSizeAttenuation = loc("sizeAttenuation");
    p.uSpriteCenter = loc("spriteCenter");
    p.uSpriteRotation = loc("spriteRotation");
    p.uSpriteScale = loc("spriteScale");
    this.programs.push(p);
    return p;
  }

  /** Upload a geometry's buffers once, then reuse its VAO. */
  private prepareGeometry(geo: BufferGeometry): void {
    if (geo.glVAO !== null) {
      /* Already uploaded. Dynamic geometry re-uploads just the positions;
       * everything else stays as it was. */
      if (geo.positionNeedsUpdate && geo.position !== null &&
          geo.glPositionBuffer !== null) {
        const g = this.gl;
        g.bindBuffer(ARRAY_BUFFER, geo.glPositionBuffer);
        g.bufferData(ARRAY_BUFFER, geo.position.toFloat32Buffer(), DYNAMIC_DRAW);
        geo.positionNeedsUpdate = false;
      }
      return;
    }
    const gl = this.gl;

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    geo.glVAO = vao;

    if (geo.position !== null) {
      const buf = gl.createBuffer();
      gl.bindBuffer(ARRAY_BUFFER, buf);
      gl.bufferData(ARRAY_BUFFER, geo.position.toFloat32Buffer(), STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, FLOAT, false, 0, 0);
      geo.glPositionBuffer = buf;
    }
    if (geo.normal !== null) {
      const buf = gl.createBuffer();
      gl.bindBuffer(ARRAY_BUFFER, buf);
      gl.bufferData(ARRAY_BUFFER, geo.normal.toFloat32Buffer(), STATIC_DRAW);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 3, FLOAT, false, 0, 0);
      geo.glNormalBuffer = buf;
    }
    if (geo.uv !== null) {
      const buf = gl.createBuffer();
      gl.bindBuffer(ARRAY_BUFFER, buf);
      gl.bufferData(ARRAY_BUFFER, geo.uv.toFloat32Buffer(), STATIC_DRAW);
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(2, 2, FLOAT, false, 0, 0);
      geo.glUVBuffer = buf;
    }
    if (geo.color !== null) {
      const buf = gl.createBuffer();
      gl.bindBuffer(ARRAY_BUFFER, buf);
      gl.bufferData(ARRAY_BUFFER, geo.color.toFloat32Buffer(), STATIC_DRAW);
      gl.enableVertexAttribArray(3);
      gl.vertexAttribPointer(3, 3, FLOAT, false, 0, 0);
      geo.glColorBuffer = buf;
    }
    if (geo.index !== null) {
      const buf = gl.createBuffer();
      gl.bindBuffer(ELEMENT_ARRAY_BUFFER, buf);
      gl.bufferData(ELEMENT_ARRAY_BUFFER, geo.index.toUint16Buffer(), STATIC_DRAW);
      geo.glIndexBuffer = buf;
    }
  }

  /** Upload or refresh a texture. Canvas sources re-upload when dirty. */
  private prepareTexture(tex: Texture): void {
    const gl = this.gl;
    if (tex.glTexture === null) {
      const t = gl.createTexture();
      tex.glTexture = t;
      gl.bindTexture(TEXTURE_2D, t);
      gl.texParameteri(TEXTURE_2D, TEXTURE_MIN_FILTER, tex.minFilter === 1003 ? 9728 : LINEAR);
      gl.texParameteri(TEXTURE_2D, TEXTURE_MAG_FILTER, tex.magFilter === 1003 ? 9728 : LINEAR);
      gl.texParameteri(TEXTURE_2D, TEXTURE_WRAP_S,
                       tex.wrapS === 1000 ? REPEAT : CLAMP_TO_EDGE);
      gl.texParameteri(TEXTURE_2D, TEXTURE_WRAP_T,
                       tex.wrapT === 1000 ? REPEAT : CLAMP_TO_EDGE);
      tex.needsUpdate = true;
    }

    if (!tex.needsUpdate) return;
    gl.bindTexture(TEXTURE_2D, tex.glTexture);
    if (tex.image !== null && tex.image.complete) {
      gl.texImage2DFromImage(TEXTURE_2D, 0, tex.image);
      tex.needsUpdate = false;
    } else if (tex.canvas !== null) {
      /* An offscreen 2D canvas as a texture: this is what makes a HUD drawn
       * with the Canvas API usable in 3D. The pixels go surface-to-texture
       * natively, never entering TS. */
      gl.texImage2DFromCanvas(TEXTURE_2D, 0, tex.canvas);
      tex.needsUpdate = false;
    }
  }

  /* Walk the scene once, sorting what it finds. Doing this in one pass
   * rather than per-material is what keeps a big scene cheap. */
  private collect(scene: Scene, camera: PerspectiveCamera): void {
    /* `arr.length = 0` is a property assignment the dialect refuses
     * (SC1090); splice is the supported clear and does not reallocate. */
    this.opaque.splice(0, this.opaque.length);
    this.transparent.splice(0, this.transparent.length);
    this.dirLights.splice(0, this.dirLights.length);
    this.pointLights.splice(0, this.pointLights.length);
    this.ambient.setRGB(0, 0, 0);

    /* Walked by hand rather than through traverseVisible + a downcast:
     * narrowing an Object3D to a Mesh is SC1090 ("values where Mesh is
     * expected"). Object3D keeps typed self-references instead, which the
     * subclass constructors fill in, so this reads the concrete object
     * without a cast. */
    for (let i = 0; i < scene.meshes.length; i++) {
      const mesh = scene.meshes[i];
      if (!mesh.visible || !mesh.material.visible) continue;
      if (mesh.material.transparent) this.transparent.push(mesh);
      else this.opaque.push(mesh);
    }
    for (let i = 0; i < scene.lights.length; i++) {
      const light = scene.lights[i];
      if (!light.visible) continue;
      if (light.lightType === LIGHT_AMBIENT) {
        // Read-modify-write: `this.ambient.r += x` is a compound assignment
        // through a field, which the dialect refuses (SC1090).
        const amb = this.ambient;
        amb.r = amb.r + light.color.r * light.intensity;
        amb.g = amb.g + light.color.g * light.intensity;
        amb.b = amb.b + light.color.b * light.intensity;
      } else if (light.lightType === LIGHT_DIRECTIONAL) {
        if (this.dirLights.length < MAX_DIR_LIGHTS) this.dirLights.push(light);
      } else if (light.lightType === LIGHT_POINT) {
        /* Take the point lights that MATTER, not the first eight added.
         *
         * First-come meant a scene with more than MAX_POINT_LIGHTS gave
         * every slot to whatever was constructed earliest -- static lamps
         * -- so transient lights (a muzzle flash, a laser bolt) usually
         * got nothing and lit only occasionally, seemingly at random.
         *
         * Ranking by intensity/distance-to-camera keeps the lights the
         * viewer can actually see. Zero-intensity lights are skipped
         * outright, which is how a pool of recycled bolt lights stays
         * cheap: only the live ones compete. */
        if (light.intensity <= 0) continue;
        if (this.pointLights.length < MAX_POINT_LIGHTS) {
          this.pointLights.push(light);
        } else {
          _v.setFromMatrixPosition(light.matrixWorld);
          const score = lightScore(light, _v, camera);
          let worst = 0;
          let worstScore = 1e30;
          for (let k = 0; k < this.pointLights.length; k++) {
            const c = this.pointLights[k];
            _v.setFromMatrixPosition(c.matrixWorld);
            const s = lightScore(c, _v, camera);
            if (s < worstScore) { worstScore = s; worst = k; }
          }
          if (score > worstScore) this.pointLights[worst] = light;
        }
      }
    }
  }

  render(scene: Scene, camera: PerspectiveCamera): void {
    const gl = this.gl;

    scene.updateMatrixWorld(false);
    camera.updateMatrixWorld(false);
    this.collect(scene, camera);

    const bg = scene.background === null ? this.clearColor : scene.background;
    gl.clearColor(bg.r, bg.g, bg.b, 1);
    gl.clear(COLOR_BUFFER_BIT | DEPTH_BUFFER_BIT);

    this.renderList(this.opaque, camera, false);

    /* Instanced, lines and points draw with depth writes ON, between the
     * opaque and transparent passes: they are opaque geometry that simply
     * uses a different primitive or a different transform source. */
    gl.disable(BLEND);
    gl.depthMask(true);
    for (let i = 0; i < scene.instanced.length; i++) {
      const im = scene.instanced[i];
      if (!im.visible || !im.material.visible) continue;
      this.renderInstanced(im, camera);
    }
    for (let i = 0; i < scene.lines.length; i++) {
      const ln = scene.lines[i];
      if (!ln.visible || !ln.material.visible) continue;
      this.renderLine(ln, camera);
    }
    for (let i = 0; i < scene.points.length; i++) {
      const pt = scene.points[i];
      if (!pt.visible || !pt.material.visible) continue;
      this.renderPoints(pt, camera);
    }

    /* Transparent after opaque, with depth WRITES off so overlapping
     * surfaces blend rather than occluding each other. */
    this.renderList(this.transparent, camera, true);

    /* Sprites last and blended: they are billboarded quads, almost always
     * with a cut-out texture, so they must composite over the finished
     * scene. Depth TEST stays on so a sprite behind geometry is hidden. */
    if (scene.sprites.length > 0) {
      gl.enable(BLEND);
      gl.blendFunc(SRC_ALPHA, ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      for (let i = 0; i < scene.sprites.length; i++) {
        const sp = scene.sprites[i];
        if (!sp.visible || !sp.material.visible) continue;
        this.renderSprite(sp, camera);
      }
      gl.depthMask(true);
    }
  }

  private renderList(list: Mesh[], camera: PerspectiveCamera,
                     isTransparent: boolean): void {
    const gl = this.gl;
    if (list.length === 0) return;

    if (isTransparent) {
      gl.enable(BLEND);
      gl.blendFunc(SRC_ALPHA, ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
    } else {
      gl.disable(BLEND);
      gl.depthMask(true);
    }

    for (let i = 0; i < list.length; i++) {
      this.renderMesh(list[i], camera);
    }

    if (isTransparent) gl.depthMask(true);
  }

  private renderMesh(mesh: Mesh, camera: PerspectiveCamera): void {
    const gl = this.gl;
    const program = this.getProgram(mesh.material.featureBits());
    if (program === null) return;

    this.prepareGeometry(mesh.geometry);
    gl.useProgram(program.glProgram);
    gl.bindVertexArray(mesh.geometry.glVAO);
    this.bindCommon(program, mesh.material, mesh.matrixWorld, camera);

    const count = mesh.geometry.getDrawCount();
    if (mesh.geometry.index !== null) {
      gl.drawElements(TRIANGLES, count, UNSIGNED_SHORT, 0);
    } else {
      gl.drawArrays(TRIANGLES, 0, count);
    }
  }

  /* Everything a draw needs that does not depend on the primitive: the
   * three matrices, the material uniforms, lights and face culling.
   * Factored out so instanced/sprite/line/point draws cannot drift from
   * the mesh path. */
  private bindCommon(program: Program, material: Material,
                     worldMatrix: Matrix4, camera: PerspectiveCamera): void {
    const gl = this.gl;

    // modelView = view * world
    this.modelView.multiplyMatrices(camera.matrixWorldInverse, worldMatrix);
    this.modelView.toBuffer(this.mat4Buf, 0);
    gl.uniformMatrix4fv(program.uModelViewMatrix, false, this.mat4Buf);

    camera.projectionMatrix.toBuffer(this.mat4Buf, 0);
    gl.uniformMatrix4fv(program.uProjectionMatrix, false, this.mat4Buf);

    /* The normal matrix is the inverse-transpose of modelView's 3x3, which
     * is what keeps normals correct under non-uniform scale. */
    this.normalMatrix.getNormalMatrix(this.modelView.elements);
    this.normalMatrix.toBuffer(this.mat3Buf, 0);
    gl.uniformMatrix3fv(program.uNormalMatrix, false, this.mat3Buf);

    gl.uniform3f(program.uColor, material.color.r, material.color.g, material.color.b);
    gl.uniform1f(program.uOpacity, material.opacity);

    if (material.map !== null) {
      this.prepareTexture(material.map);
      gl.activeTexture(TEXTURE0);
      gl.bindTexture(TEXTURE_2D, material.map.glTexture);
      gl.uniform1i(program.uMap, 0);
      gl.uniform4f(program.uMapTransform, material.map.repeatX,
                   material.map.repeatY, material.map.offsetX,
                   material.map.offsetY);
    }

    if ((program.features & FEAT_LAMBERT) !== 0) {
      this.bindLights(program, camera);
    }
    if ((program.features & FEAT_EMISSIVE) !== 0) {
      gl.uniform3f(program.uEmissive,
                   material.emissive.r, material.emissive.g, material.emissive.b);
    }

    if (material.side === DoubleSide) gl.disable(CULL_FACE);
    else {
      gl.enable(CULL_FACE);
      gl.cullFace(material.side === BackSide ? FRONT : BACK);
    }

    /* Per-DRAW, not per-list: blending is a material property, so one
     * additive glow among normal-blended transparents must not inherit
     * whichever mode the list set last.
     *
     * SRC_ALPHA, ONE adds light instead of covering, so overlapping glows
     * brighten and the dark parts of a sprite disappear against a dark
     * background with no cutout. */
    if (material.transparent) {
      if (material.blending === AdditiveBlending) gl.blendFunc(SRC_ALPHA, ONE);
      else gl.blendFunc(SRC_ALPHA, ONE_MINUS_SRC_ALPHA);
    }

    /* material.depthTest was declared but NEVER READ, so a HUD quad that
     * asked to ignore depth was still occluded by whatever it happened to
     * be inside -- in examples/station, the ceiling slab, which made the
     * whole HUD vanish. three honours this per material; so does this now. */
    if (material.depthTest) gl.enable(DEPTH_TEST);
    else gl.disable(DEPTH_TEST);
  }

  /* ---- instanced ----
   *
   * One draw call for N transforms. The instance matrix lives in a buffer
   * bound to attribute locations 4..7 (one column each) with a divisor of
   * 1, so it advances per instance while position/normal/uv advance per
   * vertex.
   *
   * The VAO is per-INSTANCEDMESH rather than per-geometry: two
   * InstancedMeshes may share a geometry but never share instance buffers,
   * so binding geometry.glVAO would give the second one the first one's
   * transforms. */
  private renderInstanced(mesh: InstancedMesh, camera: PerspectiveCamera): void {
    const gl = this.gl;
    if (mesh.count === 0) return;
    const program = this.getProgram(mesh.material.featureBits() | FEAT_INSTANCED);
    if (program === null) return;

    this.prepareGeometry(mesh.geometry);
    this.prepareInstanceBuffers(mesh);

    gl.useProgram(program.glProgram);
    gl.bindVertexArray(mesh.glInstancedVAO);
    this.bindCommon(program, mesh.material, mesh.matrixWorld, camera);

    const count = mesh.geometry.getDrawCount();
    if (mesh.geometry.index !== null) {
      gl.drawElementsInstanced(TRIANGLES, count, UNSIGNED_SHORT, 0, mesh.count);
    } else {
      gl.drawArraysInstanced(TRIANGLES, 0, count, mesh.count);
    }
  }

  /* Builds (once) the VAO that combines the shared geometry attributes with
   * this mesh's per-instance buffers, and re-uploads whenever the game sets
   * needsUpdate. */
  private prepareInstanceBuffers(mesh: InstancedMesh): void {
    const gl = this.gl;
    const geo = mesh.geometry;

    /* Rebuild when the GEOMETRY changed, not only when the VAO is absent.
     * A VAO captures the buffers bound when it was made, so a mesh whose
     * geometry is assigned later (a model loading over a placeholder) would
     * otherwise keep drawing the placeholder's buffers. */
    if (mesh.glInstancedVAO !== null && mesh.glVAOGeometry !== geo) {
      mesh.glInstancedVAO = null;
      mesh.glMatrixBuffer = null;
      mesh.glColorBuffer = null;
      mesh.uploadedCount = -1;
      mesh.uploadedColorCount = -1;
    }

    if (mesh.glInstancedVAO === null) {
      mesh.glVAOGeometry = geo;
      mesh.glInstancedVAO = gl.createVertexArray();
      gl.bindVertexArray(mesh.glInstancedVAO);

      /* Re-point this VAO at the geometry's EXISTING buffers. The buffers
       * are shared (uploaded once by prepareGeometry); only the attribute
       * bindings are per-VAO, so nothing is uploaded twice here. */
      if (geo.glPositionBuffer !== null) {
        gl.bindBuffer(ARRAY_BUFFER, geo.glPositionBuffer);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 3, FLOAT, false, 0, 0);
      }
      if (geo.glNormalBuffer !== null) {
        gl.bindBuffer(ARRAY_BUFFER, geo.glNormalBuffer);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 3, FLOAT, false, 0, 0);
      }
      if (geo.glUVBuffer !== null) {
        gl.bindBuffer(ARRAY_BUFFER, geo.glUVBuffer);
        gl.enableVertexAttribArray(2);
        gl.vertexAttribPointer(2, 2, FLOAT, false, 0, 0);
      }
      if (geo.glColorBuffer !== null) {
        gl.bindBuffer(ARRAY_BUFFER, geo.glColorBuffer);
        gl.enableVertexAttribArray(3);
        gl.vertexAttribPointer(3, 3, FLOAT, false, 0, 0);
      }
      if (geo.glIndexBuffer !== null) {
        gl.bindBuffer(ELEMENT_ARRAY_BUFFER, geo.glIndexBuffer);
      }

      mesh.glMatrixBuffer = gl.createBuffer();
      gl.bindBuffer(ARRAY_BUFFER, mesh.glMatrixBuffer);
      gl.bufferData(ARRAY_BUFFER, mesh.instanceMatrix.prefixFloat32Buffer(mesh.count), DYNAMIC_DRAW);
      /* Four columns at locations 4,5,6,7. Stride is the whole matrix (16
       * floats = 64 bytes); each column starts one vec4 further in. */
      for (let c = 0; c < 4; c++) {
        gl.enableVertexAttribArray(4 + c);
        gl.vertexAttribPointer(4 + c, 4, FLOAT, false, 64, c * 16);
        gl.vertexAttribDivisor(4 + c, 1);
      }

      if (mesh.instanceColor !== null) {
        mesh.glColorBuffer = gl.createBuffer();
        gl.bindBuffer(ARRAY_BUFFER, mesh.glColorBuffer);
        gl.bufferData(ARRAY_BUFFER, mesh.instanceColor.prefixFloat32Buffer(mesh.count), DYNAMIC_DRAW);
        gl.enableVertexAttribArray(8);
        gl.vertexAttribPointer(8, 3, FLOAT, false, 0, 0);
        gl.vertexAttribDivisor(8, 1);
      } else {
        /* No per-instance tint: supply a constant white so the shader's
         * multiply is a no-op. A disabled attribute reads as (0,0,0,1),
         * which would render every instance black. */
        gl.disableVertexAttribArray(8);
        gl.vertexAttrib3f(8, 1, 1, 1);
      }

      mesh.instanceMatrix.needsUpdate = false;
      mesh.uploadedCount = mesh.count;
      if (mesh.instanceColor !== null) {
        mesh.instanceColor.needsUpdate = false;
        mesh.uploadedColorCount = mesh.count;
      }
      return;
    }

    /* The prefix upload sizes the GL buffer to `count`, so a LATER increase
     * in count would read past the end. Re-upload whenever the drawn count
     * differs from what is currently in the buffer, not only when the game
     * sets needsUpdate. */
    if (mesh.instanceMatrix.needsUpdate || mesh.uploadedCount !== mesh.count) {
      gl.bindBuffer(ARRAY_BUFFER, mesh.glMatrixBuffer);
      gl.bufferData(ARRAY_BUFFER, mesh.instanceMatrix.prefixFloat32Buffer(mesh.count), DYNAMIC_DRAW);
      mesh.instanceMatrix.needsUpdate = false;
      mesh.uploadedCount = mesh.count;
    }
    if (mesh.instanceColor !== null &&
        (mesh.instanceColor.needsUpdate || mesh.uploadedColorCount !== mesh.count)) {
      /* setColorAt allocates the colour array lazily, so the buffer and its
       * attribute may not exist yet even though the VAO does. */
      if (mesh.glColorBuffer === null) {
        gl.bindVertexArray(mesh.glInstancedVAO);
        mesh.glColorBuffer = gl.createBuffer();
        gl.bindBuffer(ARRAY_BUFFER, mesh.glColorBuffer);
        gl.bufferData(ARRAY_BUFFER, mesh.instanceColor.prefixFloat32Buffer(mesh.count), DYNAMIC_DRAW);
        gl.enableVertexAttribArray(8);
        gl.vertexAttribPointer(8, 3, FLOAT, false, 0, 0);
        gl.vertexAttribDivisor(8, 1);
      } else {
        gl.bindBuffer(ARRAY_BUFFER, mesh.glColorBuffer);
        gl.bufferData(ARRAY_BUFFER, mesh.instanceColor.prefixFloat32Buffer(mesh.count), DYNAMIC_DRAW);
      }
      mesh.instanceColor.needsUpdate = false;
      mesh.uploadedColorCount = mesh.count;
    }
  }

  /* ---- sprites ---- */
  private renderSprite(sprite: Sprite, camera: PerspectiveCamera): void {
    const gl = this.gl;
    const material = sprite.material;
    const program = this.getProgram(material.featureBits());
    if (program === null) return;

    this.prepareGeometry(sprite.geometry);
    gl.useProgram(program.glProgram);
    gl.bindVertexArray(sprite.geometry.glVAO);
    this.bindCommon(program, material, sprite.matrixWorld, camera);

    gl.uniform2f(program.uSpriteCenter, sprite.center.x, sprite.center.y);
    /* Scale comes from the object transform, but the billboard is built in
     * VIEW space from a unit quad, so the world matrix's scale has to be
     * passed separately rather than multiplied into the position. */
    gl.uniform2f(program.uSpriteScale, sprite.scale.x, sprite.scale.y);
    let rotation = 0;
    if (material instanceof SpriteMaterial) rotation = material.rotation;
    gl.uniform1f(program.uSpriteRotation, rotation);

    const count = sprite.geometry.getDrawCount();
    if (sprite.geometry.index !== null) {
      gl.drawElements(TRIANGLES, count, UNSIGNED_SHORT, 0);
    } else {
      gl.drawArrays(TRIANGLES, 0, count);
    }
  }

  /* ---- lines ---- */
  private renderLine(line: Line, camera: PerspectiveCamera): void {
    const gl = this.gl;
    const program = this.getProgram(line.material.featureBits());
    if (program === null) return;

    this.prepareGeometry(line.geometry);
    gl.useProgram(program.glProgram);
    gl.bindVertexArray(line.geometry.glVAO);
    this.bindCommon(program, line.material, line.matrixWorld, camera);

    /* LineSegments is disconnected pairs, LineLoop closes back to the
     * start, plain Line is an open strip. */
    let mode = LINE_STRIP;
    if (line instanceof LineSegments) mode = LINES;
    else if (line instanceof LineLoop) mode = LINE_LOOP;

    const count = line.geometry.getDrawCount();
    if (line.geometry.index !== null) {
      gl.drawElements(mode, count, UNSIGNED_SHORT, 0);
    } else {
      gl.drawArrays(mode, 0, count);
    }
  }

  /* ---- points ---- */
  private renderPoints(points: Points, camera: PerspectiveCamera): void {
    const gl = this.gl;
    const material = points.material;
    const program = this.getProgram(material.featureBits());
    if (program === null) return;

    this.prepareGeometry(points.geometry);
    gl.useProgram(program.glProgram);
    gl.bindVertexArray(points.geometry.glVAO);
    this.bindCommon(program, material, points.matrixWorld, camera);

    let size = 1;
    let attenuate = 1;
    if (material instanceof PointsMaterial) {
      size = material.size;
      attenuate = material.sizeAttenuation ? 1 : 0;
    }
    /* gl_PointSize is in PIXELS, and the attenuation branch divides by view
     * depth, so the uniform is scaled by the viewport height to keep a
     * given world size looking the same at any resolution. */
    gl.uniform1f(program.uPointSize,
                 attenuate === 1 ? size * this.height * 0.5 : size);
    gl.uniform1f(program.uSizeAttenuation, attenuate);

    const count = points.geometry.getDrawCount();
    gl.drawArrays(GL_POINTS, 0, count);
  }

  /* Lights are uploaded in VIEW space, so the shader needs no world-space
   * camera position. */
  private bindLights(program: Program, camera: PerspectiveCamera): void {
    const gl = this.gl;
    gl.uniform3f(program.uAmbient, this.ambient.r, this.ambient.g, this.ambient.b);

    gl.uniform1i(program.uDirCount, this.dirLights.length);
    for (let i = 0; i < this.dirLights.length; i++) {
      const l = this.dirLights[i];
      _v.setFromMatrixPosition(l.matrixWorld);
      // Direction only: transformDirection normalises and drops translation.
      _v.transformDirection(camera.matrixWorldInverse);
      this.vec3Buf.writeFloatLE(_v.x, i * 12);
      this.vec3Buf.writeFloatLE(_v.y, i * 12 + 4);
      this.vec3Buf.writeFloatLE(_v.z, i * 12 + 8);
      this.colorBuf.writeFloatLE(l.color.r * l.intensity, i * 12);
      this.colorBuf.writeFloatLE(l.color.g * l.intensity, i * 12 + 4);
      this.colorBuf.writeFloatLE(l.color.b * l.intensity, i * 12 + 8);
    }
    if (this.dirLights.length > 0) {
      gl.uniform3fv(program.uDirDirections, this.vec3Buf);
      gl.uniform3fv(program.uDirColors, this.colorBuf);
    }

    gl.uniform1i(program.uPointCount, this.pointLights.length);
    for (let i = 0; i < this.pointLights.length; i++) {
      const l = this.pointLights[i];
      _v.setFromMatrixPosition(l.matrixWorld).applyMatrix4(camera.matrixWorldInverse);
      this.vec3Buf.writeFloatLE(_v.x, i * 12);
      this.vec3Buf.writeFloatLE(_v.y, i * 12 + 4);
      this.vec3Buf.writeFloatLE(_v.z, i * 12 + 8);
      this.colorBuf.writeFloatLE(l.color.r * l.intensity, i * 12);
      this.colorBuf.writeFloatLE(l.color.g * l.intensity, i * 12 + 4);
      this.colorBuf.writeFloatLE(l.color.b * l.intensity, i * 12 + 8);
      this.falloffBuf.writeFloatLE(l.distance, i * 8);
      this.falloffBuf.writeFloatLE(l.decay, i * 8 + 4);
    }
    if (this.pointLights.length > 0) {
      gl.uniform3fv(program.uPointPositions, this.vec3Buf);
      gl.uniform3fv(program.uPointColors, this.colorBuf);
      gl.uniform2fv(program.uPointFalloff, this.falloffBuf);
    }
  }
}

const _v = new Vector3();

/* How much a point light matters from here: brighter and nearer wins.
 *
 * Ranked on SQUARED distance, which orders identically to the real
 * distance and avoids a sqrt per light per frame. The +1 keeps a light
 * sitting on the camera from dividing by zero.
 *
 * This exists because MAX_POINT_LIGHTS is 8 and a scene can hold far more:
 * taking the first eight ADDED gave every slot to whatever was constructed
 * earliest (static lamps), so transient lights -- a muzzle flash, a laser
 * bolt -- usually got nothing and appeared to light only at random. */
function lightScore(light: Light, pos: Vector3,
                    camera: PerspectiveCamera): number {
  const dx = pos.x - camera.position.x;
  const dy = pos.y - camera.position.y;
  const dz = pos.z - camera.position.z;
  return light.intensity / (1 + dx * dx + dy * dy + dz * dz);
}
