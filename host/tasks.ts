/* The task queue: "later turn" for everything async-shaped.
 *
 * Lives in host/ rather than web/globals.ts so that web modules which need to
 * defer (audio decode, image load) can import it WITHOUT importing globals --
 * globals imports them, and the cycle is a hard compiler error (SC1016:
 * "circular imports ... are not supported yet").
 *
 * One queue serves requestAnimationFrame, promise settlement and every
 * callback shim, so "later turn" means the same thing everywhere and the
 * host drains it in one place.
 */
type Task = () => void;

let tasks: Task[] = [];

/* INLINE MODE: run a queued task immediately instead of on a later turn.
 *
 * The async rule this file exists to enforce -- "anything promise-shaped
 * settles on a LATER turn, even when the work already finished" -- assumes
 * the host can suspend a continuation and resume it. A build that cannot
 * park a fiber (no ucontext, no JS glue: a wasm cart) has no way to run a
 * continuation that attached before the promise settled, so deferring is
 * not a fidelity win there, it is a guarantee that the continuation never
 * runs at all.
 *
 * A synchronous backend should still present an async API. Inline mode
 * keeps the API exactly as it is -- game code still writes
 * `fetch(...).then(...)` -- and only removes the artificial delay, so the
 * promise is already settled when `.then` attaches and the continuation
 * runs without needing to park.
 *
 * Off by default. Native builds keep browser ordering. */
let inlineTasks = false;

/** Enables inline mode. A host with no fiber suspension calls this once. */
export function setInlineTasks(on: boolean): void { inlineTasks = on; }

/** Runs `fn` on a later turn, or immediately in inline mode. */
export function queueTask(fn: Task): void {
  if (inlineTasks) { fn(); return; }
  tasks.push(fn);
}

/** Drains queued tasks. Host-only; a game never calls this. */
export function drainTasks(): void {
  // Swap-then-run so a task queueing another task does not spin forever
  // inside one drain: the new work lands on the next drain, like a browser.
  const batch = tasks;
  tasks = [];
  for (let i = 0; i < batch.length; i++) batch[i]();
}

export function hasTasks(): boolean { return tasks.length > 0; }


/* Whether the frame is presented by GL rather than by the 2D blit.
 *
 * Lives here, not in runtime.ts, for the same reason the task queue does:
 * web/globals.ts sets it when a game takes a WebGL2 context, and
 * runtime.ts reads it, so a shared leaf module is what keeps that from
 * being a circular import (SC1016). */
let glPresent = false;
export function setGLPresent(): void { glPresent = true; }
export function usesGLPresent(): boolean { return glPresent; }
