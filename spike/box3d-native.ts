/* End-to-end proof of the box3d seam: the box3d-wasm idiom, compiled
 * native, running Erin Catto's engine as a static library. This file is
 * written so it would run UNCHANGED against box3d-wasm in a page (only
 * the import specifier is satisfied differently, which is the seam).
 *
 * Expected: the box falls from y=5 onto the ground slab and settles near
 * y=0.5 (half extent above the slab top), asleep. */
import { Math } from "../web/globals.js";
import Box3D from "../web/box3d.js";

const b3 = await Box3D();

const world = new b3.World({ gravity: { x: 0, y: -10, z: 0 } });

const ground = world.createBody({ type: "static", position: { x: 0, y: -0.5, z: 0 } });
ground.createBox({ halfExtents: { x: 20, y: 0.5, z: 20 } });

const body = world.createBody({ type: "dynamic", position: { x: 0, y: 5, z: 0 } });
body.createBox({ halfExtents: { x: 0.5, y: 0.5, z: 0.5 }, density: 1, friction: 0.5 });

for (let i = 0; i < 120; i++) {
  world.step(1 / 60, 4);
}

const p = body.getPosition();
const settled = p.y > 0.4 && p.y < 0.6 && Math.abs(p.x) < 0.01 && Math.abs(p.z) < 0.01;
console.log(settled ? "SETTLED" : "WRONG");
console.log(p.y);

/* Prove the sim is live, not a lucky constant: shove it and step. */
body.applyLinearImpulseToCenter({ x: 3, y: 0, z: 0 }, true);
for (let i = 0; i < 60; i++) {
  world.step(1 / 60, 4);
}
const p2 = body.getPosition();
console.log(p2.x > 0.2 ? "MOVED" : "STUCK");

world.destroy();
