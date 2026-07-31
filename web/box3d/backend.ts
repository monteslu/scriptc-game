/* The native implementation of box3d-wasm's backend contract
 * (box3d-wasm src/backend.d.ts): FFI into Box3D built as a static library
 * at the same upstream SHA box3d-wasm pins. The shared frontend
 * (frontend.ts, vendored byte-identical) sits on these exactly as it sits
 * on dist/backend.js in a page.
 *
 * C side: shim/sg_box3d.c (slot tables for the 64-bit struct ids, scratch
 * row for reads). */

export function worldCreate(gx: number, gy: number, gz: number, enableSleep: number,
                            workerCount: number): number {
  return sgB3WorldCreate(gx, gy, gz, enableSleep, workerCount);
}
export function worldStep(w: number, dt: number, substeps: number): void {
  sgB3WorldStep(w, dt, substeps);
}
export function worldSetGravity(w: number, gx: number, gy: number, gz: number): void {
  sgB3WorldSetGravity(w, gx, gy, gz);
}
export function worldDestroy(w: number): void {
  sgB3WorldDestroy(w);
}
export function worldExplode(w: number, px: number, py: number, pz: number,
                             radius: number, falloff: number, impulsePerArea: number): void {
  sgB3WorldExplode(w, px, py, pz, radius, falloff, impulsePerArea);
}
export function bodyCreate(w: number, type: number, px: number, py: number, pz: number,
                           qx: number, qy: number, qz: number, qw: number): number {
  return sgB3BodyCreate(w, type, px, py, pz, qx, qy, qz, qw);
}
export function bodyDestroy(b: number): void {
  sgB3BodyDestroy(b);
}
export function bodyRead(b: number): void {
  sgB3BodyRead(b);
}
export function bodyTeleport(b: number, px: number, py: number, pz: number,
                             qx: number, qy: number, qz: number, qw: number): void {
  sgB3BodyTeleport(b, px, py, pz, qx, qy, qz, qw);
}
export function bodyConfig(b: number, gravityScale: number, lockAngular: number): void {
  sgB3BodyConfig(b, gravityScale, lockAngular);
}
export function getf(i: number): number {
  return sgB3Getf(i);
}
export function bodySetVelocity(b: number, vx: number, vy: number, vz: number): void {
  sgB3BodySetVelocity(b, vx, vy, vz);
}
export function bodySetAngularVelocity(b: number, wx: number, wy: number, wz: number): void {
  sgB3BodySetAngularVelocity(b, wx, wy, wz);
}
export function bodyImpulse(b: number, ix: number, iy: number, iz: number, wake: number): void {
  sgB3BodyImpulse(b, ix, iy, iz, wake);
}
export function shapeBox(b: number, hx: number, hy: number, hz: number,
                         density: number, friction: number, restitution: number): number {
  return sgB3ShapeBox(b, hx, hy, hz, density, friction, restitution);
}
export function shapeSphere(b: number, radius: number,
                            density: number, friction: number, restitution: number): number {
  return sgB3ShapeSphere(b, radius, density, friction, restitution);
}

/* ---- FFI ---- */
declare function sgB3WorldCreate(gx: number, gy: number, gz: number, enableSleep: number, workerCount: number): number;
declare function sgB3WorldStep(w: number, dt: number, substeps: number): void;
declare function sgB3WorldSetGravity(w: number, gx: number, gy: number, gz: number): void;
declare function sgB3WorldDestroy(w: number): void;
declare function sgB3WorldExplode(w: number, px: number, py: number, pz: number,
                                  radius: number, falloff: number, impulsePerArea: number): void;
declare function sgB3BodyCreate(w: number, type: number, px: number, py: number, pz: number,
                                qx: number, qy: number, qz: number, qw: number): number;
declare function sgB3BodyDestroy(b: number): void;
declare function sgB3BodyRead(b: number): void;
declare function sgB3BodyTeleport(b: number, px: number, py: number, pz: number,
                                  qx: number, qy: number, qz: number, qw: number): void;
declare function sgB3BodyConfig(b: number, gravityScale: number, lockAngular: number): void;
declare function sgB3Getf(i: number): number;
declare function sgB3BodySetVelocity(b: number, vx: number, vy: number, vz: number): void;
declare function sgB3BodySetAngularVelocity(b: number, wx: number, wy: number, wz: number): void;
declare function sgB3BodyImpulse(b: number, ix: number, iy: number, iz: number, wake: number): void;
declare function sgB3ShapeBox(b: number, hx: number, hy: number, hz: number,
                              density: number, friction: number, restitution: number): number;
declare function sgB3ShapeSphere(b: number, radius: number,
                                 density: number, friction: number, restitution: number): number;
