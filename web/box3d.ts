/* The native entry of the box3d seam.
 *
 * A game writes exactly the box3d-wasm idiom:
 *
 *     import Box3D from "../../web/box3d.js";
 *     const b3 = await Box3D();
 *     const world = new b3.World({ gravity: { x: 0, y: -10, z: 0 } });
 *
 * IN A BROWSER the import map points this specifier at box3d-wasm's iso
 * entry (dist/iso.mjs) and the page runs Erin Catto's engine as wasm.
 * HERE the identical API comes from the SHARED frontend -- box3d/frontend.ts
 * is a byte-for-byte vendored copy of box3d-wasm's src/frontend.ts (hash
 * pinned in versions.json) -- over the FFI backend (box3d/backend.ts) into
 * Box3D compiled native at the same upstream SHA box3d-wasm pins. Same
 * source, same engine bytes, same binding personality, two worlds.
 *
 * THE ASYNC RULE (web/globals.ts): Box3D() settles on a later turn even
 * though nothing loads natively, because the browser's factory does. */
import { B3 } from "./box3d/frontend.js";

export * from "./box3d/frontend.js";

/** The box3d-wasm default export, natively. Threads are real here: Box3D's
 * in-tree scheduler spins up pthreads when a world asks for workers. */
export default function Box3D(): Promise<B3> {
  const b3 = new B3();
  b3.threaded = true;
  b3.maxWorkers = 8;   // B3_MAX_WORKERS is 64; 8 is a sane game default
  return Promise.resolve(b3);
}
