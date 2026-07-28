/* A GPU-instanced particle burst system.
 *
 * Explosions, sparks, engine trails, pickup pops, dust. The things that
 * make a game feel like it is reacting to you rather than merely updating.
 *
 * ONE InstancedMesh backs the whole pool, so ten thousand particles cost
 * one draw call. A pool of separate Meshes would cost ten thousand, which
 * is the difference measured in examples/spinfield: 9.1 ms against 125 ms.
 *
 * Everything is a FIXED-SIZE POOL allocated up front. A burst that would
 * overflow recycles the oldest particles instead of allocating, so a long
 * session cannot creep in memory and a frame cannot stall on a GC.
 *
 * Usage:
 *
 *   const sparks = new ParticleSystem(scene, 600);
 *   sparks.material.blending = AdditiveBlending;   // glowing embers
 *   ...
 *   sparks.burst(x, y, z, 24, opts);   // on impact
 *   sparks.update(dt);                 // once per frame
 */
import { Scene } from "../three/core/Scene.js";
import { InstancedMesh } from "../three/objects/InstancedMesh.js";
import { BoxGeometry } from "../three/geometries/BoxGeometry.js";
import {
  MeshBasicMaterial, AdditiveBlending,
} from "../three/materials/Material.js";
import { Matrix4 } from "../three/math/Matrix4.js";
import { Vector3 } from "../three/math/Vector3.js";
import { Quaternion } from "../three/math/Quaternion.js";
import { Color } from "../three/math/Color.js";
import { Math as M } from "../web/globals.js";

/* Tunables for one burst. A class rather than an options object because
 * the dialect will not pass an object literal into a class-typed
 * parameter (SC2003); construct one, keep it, and mutate between calls. */
export class BurstOptions {
  /** Metres per second, before the random spread. */
  speed = 6;
  /** 0 = every particle at exactly `speed`, 1 = anywhere from 0 to 2x. */
  speedJitter = 0.6;
  /** Seconds a particle lives. */
  life = 0.7;
  lifeJitter = 0.4;
  /** Starting edge length. */
  size = 0.22;
  sizeJitter = 0.5;
  /** Downward acceleration. Negative floats things upward. */
  gravity = 9;
  /** Velocity retained per second: 1 = none, 0.1 = heavy air drag. */
  drag = 0.4;
  /** Spin, radians per second. */
  spin = 6;
  /** Colour at birth. */
  colorFrom: Color = new Color(0xffffff);
  /** Colour at death; particles lerp between the two. */
  colorTo: Color = new Color(0xff4400);
  /** Cone direction. Zero-length means a full sphere. */
  dirX = 0;
  dirY = 0;
  dirZ = 0;
  /** 0 = a tight beam along dir, 1 = a full hemisphere around it. */
  spread = 1;
  /** Shrink to nothing over the lifetime. */
  shrink = true;
}

export class ParticleSystem {
  readonly mesh: InstancedMesh;
  readonly material: MeshBasicMaterial;
  readonly capacity: number;

  /* Struct-of-arrays rather than an array of objects: the dialect boxes
   * class instances, and this is walked in full every frame. */
  private px: number[] = [];
  private py: number[] = [];
  private pz: number[] = [];
  private vx: number[] = [];
  private vy: number[] = [];
  private vz: number[] = [];
  private age: number[] = [];
  private ttl: number[] = [];
  private size: number[] = [];
  private spin: number[] = [];
  private gravity: number[] = [];
  private drag: number[] = [];
  private shrink: boolean[] = [];
  private r0: number[] = [];
  private g0: number[] = [];
  private b0: number[] = [];
  private r1: number[] = [];
  private g1: number[] = [];
  private b1: number[] = [];

  /** Next slot to claim. Wraps, recycling the oldest particle. */
  private cursor = 0;
  private seed = 0x9e3779b9;

  constructor(scene: Scene, capacity: number) {
    this.capacity = capacity;
    this.material = new MeshBasicMaterial(0xffffff);
    this.material.transparent = true;
    this.material.blending = AdditiveBlending;
    /* Depth WRITES stay off for particles (the renderer does that for
     * transparents), so a burst never occludes the scene behind it. */

    this.mesh = new InstancedMesh(new BoxGeometry(1, 1, 1),
                                  this.material, capacity);
    this.mesh.count = 0;
    scene.add(this.mesh);

    for (let i = 0; i < capacity; i++) {
      this.px.push(0); this.py.push(0); this.pz.push(0);
      this.vx.push(0); this.vy.push(0); this.vz.push(0);
      this.age.push(0); this.ttl.push(0);
      this.size.push(0); this.spin.push(0);
      this.gravity.push(0); this.drag.push(0);
      this.shrink.push(true);
      this.r0.push(1); this.g0.push(1); this.b0.push(1);
      this.r1.push(1); this.g1.push(1); this.b1.push(1);
      // Dead particles must not draw: zero scale until claimed.
      this.mesh.setMatrixAt(i, _zero);
    }
  }

  /* A deterministic LCG rather than Math.random: every run produces the
   * same bursts, so a screenshot is reproducible and a visual regression
   * is a real change rather than noise. */
  private rand(): number {
    this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff;
    return this.seed / 0x7fffffff;
  }

  private randSigned(): number { return this.rand() * 2 - 1; }

  /** Emit `count` particles from a point. */
  burst(x: number, y: number, z: number, count: number,
        o: BurstOptions): void {
    for (let n = 0; n < count; n++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.capacity;

      this.px[i] = x;
      this.py[i] = y;
      this.pz[i] = z;

      /* Direction: a uniform sphere, then bent toward the cone axis by
       * `spread`. Uniform means picking z uniformly and the angle around
       * it -- the naive "three random components, normalised" clumps
       * toward the cube's corners. */
      const u = this.randSigned();
      const th = this.rand() * M.PI * 2;
      const s = M.sqrt(1 - u * u);
      let dx = s * M.cos(th);
      let dy = s * M.sin(th);
      let dz = u;

      const dirLen = M.sqrt(o.dirX * o.dirX + o.dirY * o.dirY + o.dirZ * o.dirZ);
      if (dirLen > 0.0001) {
        // Blend the random direction toward the axis: spread 0 = pure axis.
        const ax = o.dirX / dirLen;
        const ay = o.dirY / dirLen;
        const az = o.dirZ / dirLen;
        dx = ax + (dx - ax) * o.spread;
        dy = ay + (dy - ay) * o.spread;
        dz = az + (dz - az) * o.spread;
        const l = M.sqrt(dx * dx + dy * dy + dz * dz);
        if (l > 0.0001) { dx /= l; dy /= l; dz /= l; }
      }

      const sp = o.speed * (1 + this.randSigned() * o.speedJitter);
      this.vx[i] = dx * sp;
      this.vy[i] = dy * sp;
      this.vz[i] = dz * sp;

      this.age[i] = 0;
      this.ttl[i] = M.max(0.05, o.life * (1 + this.randSigned() * o.lifeJitter));
      this.size[i] = M.max(0.01, o.size * (1 + this.randSigned() * o.sizeJitter));
      this.spin[i] = this.randSigned() * o.spin;
      this.gravity[i] = o.gravity;
      this.drag[i] = o.drag;
      this.shrink[i] = o.shrink;
      this.r0[i] = o.colorFrom.r; this.g0[i] = o.colorFrom.g; this.b0[i] = o.colorFrom.b;
      this.r1[i] = o.colorTo.r; this.g1[i] = o.colorTo.g; this.b1[i] = o.colorTo.b;
    }

    /* Draw the whole pool. Dead slots hold a ZERO-SCALE matrix, which
     * rasterises nothing, so this costs one instance of vertex work each
     * and no fill rate -- cheaper than compacting live particles to the
     * front of the buffer every frame. */
    this.mesh.count = this.capacity;
  }

  /** Advance every live particle. Call once per frame. */
  update(dt: number): void {
    if (this.mesh.count === 0) return;
    let anyAlive = false;

    for (let i = 0; i < this.capacity; i++) {
      const ttl = this.ttl[i];
      if (ttl <= 0) continue;

      const age = this.age[i] + dt;
      if (age >= ttl) {
        this.ttl[i] = 0;
        this.mesh.setMatrixAt(i, _zero);   // collapse: draws nothing
        continue;
      }
      this.age[i] = age;
      anyAlive = true;

      /* Exponential drag: velocity *= drag^dt. Frame-rate independent,
       * unlike the common `v -= v * k * dt`, which behaves differently at
       * 30 and 144 fps. */
      const damp = M.pow(this.drag[i], dt);
      let vx = this.vx[i] * damp;
      let vy = this.vy[i] * damp - this.gravity[i] * dt;
      let vz = this.vz[i] * damp;
      this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;

      const x = this.px[i] + vx * dt;
      const y = this.py[i] + vy * dt;
      const z = this.pz[i] + vz * dt;
      this.px[i] = x; this.py[i] = y; this.pz[i] = z;

      const t = age / ttl;
      let scale = this.size[i];
      if (this.shrink[i]) scale *= 1 - t;
      if (scale < 0.0005) scale = 0.0005;

      _pos.set(x, y, z);
      _quat.setFromAxisAngle(_spinAxis, this.spin[i] * age);
      _scl.set(scale, scale, scale);
      _m.compose(_pos, _quat, _scl);
      this.mesh.setMatrixAt(i, _m);

      /* Colour ramps birth -> death. With additive blending, fading the
       * colour toward black IS the fade-out: there is no alpha to animate
       * per instance. */
      const fade = 1 - t * t;
      _col.setRGB(
        (this.r0[i] + (this.r1[i] - this.r0[i]) * t) * fade,
        (this.g0[i] + (this.g1[i] - this.g0[i]) * t) * fade,
        (this.b0[i] + (this.b1[i] - this.b0[i]) * t) * fade);
      this.mesh.setColorAt(i, _col);
    }

    // Nothing alive: stop drawing entirely rather than uploading zeros.
    if (!anyAlive) this.mesh.count = 0;
  }
}

const _m = new Matrix4();
const _zero = new Matrix4().compose(
  new Vector3(0, 0, 0), new Quaternion(), new Vector3(0, 0, 0));
const _pos = new Vector3();
const _scl = new Vector3(1, 1, 1);
const _quat = new Quaternion();
const _col = new Color(0xffffff);
/* One shared tumble axis: per-particle axes cost three more arrays and are
 * indistinguishable at particle sizes. */
const _spinAxis = new Vector3(0.577, 0.577, 0.577);
