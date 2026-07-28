/* Does the whole threeTS-lite stack compile? */
import { Scene } from "../three/core/Scene.js";
import { PerspectiveCamera } from "../three/core/PerspectiveCamera.js";
import { Mesh } from "../three/objects/Mesh.js";
import { BoxGeometry } from "../three/geometries/BoxGeometry.js";
import { MeshLambertMaterial } from "../three/materials/Material.js";
import { AmbientLight, DirectionalLight } from "../three/lights/Light.js";
import { WebGLRenderer } from "../three/renderer/WebGLRenderer.js";
import { WebGL2RenderingContext } from "../web/webgl/context.js";
import { initHeadless, shutdownHeadless } from "../host/gl-ffi.js";

if (initHeadless(640, 480) !== 0) { console.log("no headless GL"); process.exit(0); }
const gl = new WebGL2RenderingContext(640, 480);
const renderer = new WebGLRenderer(gl);
renderer.setSize(640, 480);

const scene = new Scene();
const camera = new PerspectiveCamera(60, 640 / 480, 0.1, 100);
camera.position.set(0, 0, 5);

const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshLambertMaterial());
scene.addMesh(mesh);
scene.addLight(new AmbientLight(0x404040, 1));
const sun = new DirectionalLight(0xffffff, 1);
sun.position.set(3, 5, 2);
scene.addLight(sun);

renderer.render(scene, camera);
console.log(`hash=${gl.hashPixels(0, 0, 640, 480)}  err=${gl.getError()}`);
shutdownHeadless();
console.log("threeTS-lite compiles and renders");
