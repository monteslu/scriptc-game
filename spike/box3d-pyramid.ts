/* Probe: station's crate pyramid, exactly as main.ts spawns it. Proves the
 * stack settles STANDING (three layers, nobody slid off) and that a bolt
 * impulse knocks the cap crate away. Numbers mirror examples/station:
 * skip bbox 0.7 x 0.5 x 1.2 scaled by 1.8, floor slab, same spacing. */
import Box3D, { Body } from "../web/box3d.js";

const b3 = await Box3D();
const world = new b3.World({ gravity: { x: 0, y: -6, z: 0 } });

const FLOOR = 15.9;
const ground = world.createBody({ type: "static", position: { x: 0, y: FLOOR - 1, z: -93 } });
ground.createBox({ halfExtents: { x: 10, y: 1, z: 40 } });

const hx = 0.35 * 1.8;
const hy = 0.25 * 1.8;
const hz = 0.6 * 1.8;
const STEP_X = hx * 2 + 0.04;
const STEP_Y = hy * 2 + 0.04;
const STEP_Z = hz * 2 + 0.04;
const PYR_Z = -93;

const bodies: Body[] = [];
const spawnY: number[] = [];
for (let layer = 0; layer < 3; layer++) {
  const n = 3 - layer;
  const y = FLOOR + hy + layer * STEP_Y;
  const offX = (n - 1) * 0.5 * STEP_X;
  const offZ = (n - 1) * 0.5 * STEP_Z;
  for (let ix = 0; ix < n; ix++) {
    for (let iz = 0; iz < n; iz++) {
      const b = world.createBody({
        type: "dynamic",
        position: { x: ix * STEP_X - offX, y, z: PYR_Z + iz * STEP_Z - offZ },
      });
      b.createBox({ halfExtents: { x: hx, y: hy, z: hz },
                    density: 0.7, friction: 0.5, restitution: 0.3 });
      bodies.push(b);
      spawnY.push(y);
    }
  }
}

for (let i = 0; i < 600; i++) world.step(1 / 60, 4);

let maxDrift = 0;
let asleep = 0;
for (let i = 0; i < bodies.length; i++) {
  const p = bodies[i].getPosition();
  const dy = p.y - spawnY[i];
  const drift = dy < 0 ? -dy : dy;
  if (drift > maxDrift) maxDrift = drift;
  if (!bodies[i].isAwake()) asleep += 1;
}
console.log(maxDrift < 0.1 ? "PYRAMID-STANDS" : "PYRAMID-COLLAPSED");
console.log(maxDrift);
console.log(asleep);

/* A blast at the pyramid face must scatter a bunch of them. */
world.explode({ position: { x: 0, y: FLOOR + 1.5, z: PYR_Z + 2.5 },
                radius: 3.5, falloff: 2.5, impulsePerArea: 4 });
for (let i = 0; i < 90; i++) world.step(1 / 60, 4);
let scattered = 0;
for (let i = 0; i < bodies.length; i++) {
  const p2 = bodies[i].getPosition();
  const dy2 = p2.y - spawnY[i];
  if (dy2 > 0.5 || dy2 < -0.5 || p2.x > 1.5 || p2.x < -1.5) scattered += 1;
}
console.log("scattered:");
console.log(scattered);

/* The cap crate takes a bolt: it must move. */
const cap = bodies[bodies.length - 1];
cap.applyLinearImpulseToCenter({ x: 0, y: 1.2, z: -6 }, true);
for (let i = 0; i < 120; i++) world.step(1 / 60, 4);
const cp = cap.getPosition();
console.log(cp.z < PYR_Z - 1 ? "CAP-KNOCKED-OFF" : "CAP-STUCK");

world.destroy();
export {};
