/* The three.js "creating a scene" example, as close to verbatim as the
 * dialect allows. Each deviation is marked DIFF and counted. */
import { window, document } from "../../web/globals.js";
import { Scene } from "../../three/core/Scene.js";
import { PerspectiveCamera } from "../../three/core/PerspectiveCamera.js";
import { BoxGeometry } from "../../three/geometries/BoxGeometry.js";
import { MeshLambertMaterial } from "../../three/materials/Material.js";
import { Mesh } from "../../three/objects/Mesh.js";
import { PointLight } from "../../three/lights/Light.js";
import { Raycaster } from "../../three/core/Raycaster.js";
import { Vector3 } from "../../three/math/Vector3.js";

window.addEventListener("load", () => {
  const scene = new Scene();
  const camera = new PerspectiveCamera(75, 16 / 9, 0.1, 1000);
  const geometry = new BoxGeometry(1, 1, 1);

  const material = new MeshLambertMaterial(0x00ff00);  // DIFF: hex, not {color:}

  const cube = new Mesh(geometry, material);
  scene.add(cube);                              // SAME as three

  camera.position.z = 5;                        // SAME
  cube.position.set(1, 2, 3);                   // SAME
  cube.rotateX(0.01);                           // DIFF: rotation.x += 0.01
  cube.scale.setScalar(2);                      // SAME as three

  const light = new PointLight(0xffffff, 1, 100);  // SAME signature
  light.position.set(5, 5, 5);                  // SAME
  scene.add(light);                             // SAME as three

  // Every drawable kind through the ONE add(), as in three.
  const rc = new Raycaster();
  rc.setFromCamera(0, 0, camera);               // DIFF: two numbers not Vector2
  const hits = rc.intersectObjects(scene.children);  // SAME as three

  console.log(`IDIOM cube.position.x=${cube.position.x} camera.position.z=${camera.position.z} hits=${hits.length}`);
  console.log(`IDIOM color=${material.color.getHex()} light.distance=${light.distance}`);
});
