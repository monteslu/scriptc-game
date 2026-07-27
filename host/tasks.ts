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

/** Runs `fn` on a later turn. The primitive the async rule rests on. */
export function queueTask(fn: Task): void {
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
