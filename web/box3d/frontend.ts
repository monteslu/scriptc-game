/* The box3d API frontend: ONE source for every host.
 *
 * This file is the public API personality (classes, options objects,
 * defaults) written against the flat backend contract in backend.d.ts. It
 * is deliberately written in the scriptc dialect subset of TypeScript (no
 * `any`, no string-keyed access, explicit undefined checks, no defaulted
 * params used as values) so the SAME file compiles two ways:
 *
 *   wasm    tsc strips types; dist/backend.js drives the emscripten
 *           module's b3f_* exports (csrc/flat.cpp)
 *   native  a host (e.g. scriptc-game) vendors this file byte-identical
 *           and supplies its own backend over FFI into Box3D built as a
 *           static library at the same upstream SHA
 *
 * Vectors are plain {x, y, z} and quaternions {x, y, z, w}, so values pass
 * directly to and from three.js and friends.
 *
 * v0 surface: world, bodies, box + sphere shapes, step/read/impulse. The
 * embind API (glue.cpp) remains the published default until this reaches
 * parity.
 */
import * as B from "./backend.js";

export interface Vec3 { x: number; y: number; z: number; }
export interface Quat { x: number; y: number; z: number; w: number; }

export interface WorldOpts {
  gravity?: Vec3;
  enableSleep?: boolean;
  /** Thread count on hosts that have workers; clamped to maxWorkers. */
  workerCount?: number;
}

export interface MotionLocks {
  angularX?: boolean;
  angularY?: boolean;
  angularZ?: boolean;
}

export interface BodyOpts {
  /** "static" | "kinematic" | "dynamic"; static when omitted. */
  type?: string;
  position?: Vec3;
  rotation?: Quat;
  linearVelocity?: Vec3;
  /** 0 floats free of world gravity; 1 (default) falls normally. */
  gravityScale?: number;
  motionLocks?: MotionLocks;
}

export interface BoxOpts {
  halfExtents: Vec3;
  density?: number;
  friction?: number;
  restitution?: number;
}

export interface ExplodeOpts {
  position: Vec3;
  radius: number;
  /** Impulse fades to zero this far beyond the radius. */
  falloff?: number;
  impulsePerArea?: number;
}

export interface SphereOpts {
  radius: number;
  density?: number;
  friction?: number;
  restitution?: number;
}

export class Shape {
  private handle: number;
  constructor(handle: number) { this.handle = handle; }
}

export class Body {
  private handle: number;

  constructor(handle: number) { this.handle = handle; }

  /** Backend slot id; hosts and World internals only. */
  rawHandle(): number { return this.handle; }

  createBox(opts: BoxOpts): Shape {
    const d = opts.density === undefined ? -1 : opts.density;
    const f = opts.friction === undefined ? -1 : opts.friction;
    const r = opts.restitution === undefined ? -1 : opts.restitution;
    return new Shape(B.shapeBox(
      this.handle, opts.halfExtents.x, opts.halfExtents.y, opts.halfExtents.z, d, f, r));
  }

  createSphere(opts: SphereOpts): Shape {
    const d = opts.density === undefined ? -1 : opts.density;
    const f = opts.friction === undefined ? -1 : opts.friction;
    const r = opts.restitution === undefined ? -1 : opts.restitution;
    return new Shape(B.shapeSphere(this.handle, opts.radius, d, f, r));
  }

  getPosition(): Vec3 {
    B.bodyRead(this.handle);
    return { x: B.getf(0), y: B.getf(1), z: B.getf(2) };
  }

  getRotation(): Quat {
    B.bodyRead(this.handle);
    return { x: B.getf(3), y: B.getf(4), z: B.getf(5), w: B.getf(6) };
  }

  getLinearVelocity(): Vec3 {
    B.bodyRead(this.handle);
    return { x: B.getf(8), y: B.getf(9), z: B.getf(10) };
  }

  /** Teleport (no sweep); rotation is kept. For respawns, not motion. */
  setPosition(v: Vec3): void {
    const q = this.getRotation();
    B.bodyTeleport(this.handle, v.x, v.y, v.z, q.x, q.y, q.z, q.w);
  }

  /** Teleport with a full pose. */
  setTransform(v: Vec3, q: Quat): void {
    B.bodyTeleport(this.handle, v.x, v.y, v.z, q.x, q.y, q.z, q.w);
  }

  isAwake(): boolean {
    B.bodyRead(this.handle);
    return B.getf(7) !== 0;
  }

  setLinearVelocity(v: Vec3): void {
    B.bodySetVelocity(this.handle, v.x, v.y, v.z);
  }

  setAngularVelocity(v: Vec3): void {
    B.bodySetAngularVelocity(this.handle, v.x, v.y, v.z);
  }

  applyLinearImpulseToCenter(v: Vec3, wake: boolean): void {
    B.bodyImpulse(this.handle, v.x, v.y, v.z, wake ? 1 : 0);
  }

  destroy(): void { B.bodyDestroy(this.handle); }
}

export class World {
  private handle: number;

  constructor(opts: WorldOpts) {
    const g = opts.gravity === undefined ? { x: 0, y: -10, z: 0 } : opts.gravity;
    const sleep = opts.enableSleep === undefined ? true : opts.enableSleep;
    const workers = opts.workerCount === undefined ? 1 : opts.workerCount;
    this.handle = B.worldCreate(g.x, g.y, g.z, sleep ? 1 : 0, workers);
  }

  createBody(opts: BodyOpts): Body {
    const t = opts.type === "dynamic" ? 2 : opts.type === "kinematic" ? 1 : 0;
    const p = opts.position === undefined ? { x: 0, y: 0, z: 0 } : opts.position;
    const q = opts.rotation === undefined ? { x: 0, y: 0, z: 0, w: 1 } : opts.rotation;
    const body = new Body(B.bodyCreate(this.handle, t, p.x, p.y, p.z, q.x, q.y, q.z, q.w));
    if (opts.linearVelocity !== undefined) body.setLinearVelocity(opts.linearVelocity);
    const gs = opts.gravityScale === undefined ? 1 : opts.gravityScale;
    const ml = opts.motionLocks;
    const lockAng = ml !== undefined &&
      (ml.angularX === true || ml.angularY === true || ml.angularZ === true);
    if (gs !== 1 || lockAng) B.bodyConfig(body.rawHandle(), gs, lockAng ? 1 : 0);
    return body;
  }

  step(dt: number, subSteps: number): void {
    B.worldStep(this.handle, dt, subSteps);
  }

  setGravity(g: Vec3): void {
    B.worldSetGravity(this.handle, g.x, g.y, g.z);
  }

  /** Radial blast affecting every body in range (spheres/capsules/hulls). */
  explode(opts: ExplodeOpts): void {
    const falloff = opts.falloff === undefined ? opts.radius * 0.5 : opts.falloff;
    const ipa = opts.impulsePerArea === undefined ? 10 : opts.impulsePerArea;
    B.worldExplode(this.handle, opts.position.x, opts.position.y, opts.position.z,
                   opts.radius, falloff, ipa);
  }

  destroy(): void { B.worldDestroy(this.handle); }
}

/** What Box3D() resolves to: the module surface. Hosts with threads set
 * threaded/maxWorkers after construction. */
export class B3 {
  World = World;
  threaded = false;
  maxWorkers = 1;
}
