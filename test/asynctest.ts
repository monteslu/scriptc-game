/* Async ordering: does anything async-SHAPED actually settle on a later turn?
 *
 * This suite exists because of a real bug. `fetch(...).then(...)` in a game
 * never ran: the frame loop was one unbroken synchronous turn, so promise
 * continuations had nowhere to land, and the music simply never started. No
 * error, no warning, just silence. Nothing in the tree asserted the ordering
 * rule, so nothing caught it.
 *
 * The rule under test: an async-shaped API settles on a LATER turn even when
 * the underlying work already finished. Real code depends on this. It
 * attaches `onload` after setting `src`, chains `.then` after kicking off a
 * load, and assumes a flag set in a callback is not visible on the next line.
 * A shim that resolves synchronously breaks that code in ways that look like
 * heisenbugs, so the behaviour is asserted rather than trusted.
 *
 * Every check here would also pass in a browser. That is the point.
 */
import { Image, fetch, FontFace, AudioContextOrNull } from "../web/globals.js";
import { setGameDir } from "../host/resources.js";
import { drainTasks, hasTasks } from "../host/tasks.js";

let passed = 0;
let failed = 0;

function check(cond: boolean, label: string): void {
  if (cond) { passed += 1; }
  else { failed += 1; console.log(`  FAIL: ${label}`); }
}

/* Runs turns until `done` or the budget is spent. One turn = drain the task
 * queue, then yield so promise continuations can run, exactly what the host
 * frame loop does. */
async function pump(maxTurns: number): Promise<void> {
  for (let i = 0; i < maxTurns; i++) {
    drainTasks();
    await Promise.resolve(0);
  }
}

async function main(): Promise<void> {
  setGameDir("examples/dodge");
  console.log("==> async ordering");

  /* 1. onload attached AFTER src still fires.
   *
   * The decode is synchronous native work, so a naive implementation would
   * call onload from inside the setter, before this line even runs. */
  let fired = false;
  const img = new Image();
  img.src = "player.png";
  img.onload = () => { fired = true; };

  check(!fired, "onload has not fired during the same turn as src");
  check(hasTasks(), "src queued a task rather than calling back immediately");

  await pump(4);
  check(fired, "onload attached after src still fires on a later turn");
  check(img.complete, "complete is true once onload has run");
  check(img.width > 0, "dimensions are populated");

  /* 2. A flag set in onload is not visible on the line after src.
   *
   * Same rule from the other direction: this is the pattern that silently
   * breaks when a shim resolves eagerly. */
  let ready = false;
  const img2 = new Image();
  img2.onload = () => { ready = true; };
  img2.src = "coin.png";
  check(!ready, "flag set in onload is still false on the next line");
  await pump(4);
  check(ready, "flag becomes true after the queue is drained");

  /* 3. fetch().then lands on a later turn. The music bug, exactly. */
  let fetched = false;
  fetch("music.mp3").then((res) => {
    fetched = true;
    check(res.ok, "fetch of an existing file reports ok");
  });
  check(!fetched, "fetch().then has not run during the calling turn");
  await pump(6);
  check(fetched, "fetch().then runs on a later turn");

  /* 4. A MISSING file rejects/reports asynchronously too, not by throwing. */
  let missingSettled = false;
  let missingOk = true;
  fetch("definitely-not-here.json").then((res) => {
    missingSettled = true;
    missingOk = res.ok;
  });
  check(!missingSettled, "a missing fetch also defers");
  await pump(6);
  check(missingSettled, "a missing fetch still settles");
  check(!missingOk, "a missing fetch reports ok=false");

  /* 5. onerror is async as well, so error handling has the same shape. */
  let errored = false;
  const bad = new Image();
  bad.src = "no-such-image.png";
  bad.onerror = () => { errored = true; };
  check(!errored, "onerror has not fired synchronously");
  await pump(4);
  check(errored, "onerror attached after src still fires");

  /* 6. Ordering across two loads is deterministic: queued in order, run in
   * order. A game that loads a manifest then its contents depends on this. */
  const order: number[] = [];
  const a = new Image();
  const b = new Image();
  a.onload = () => { order.push(1); };
  b.onload = () => { order.push(2); };
  a.src = "player.png";
  b.src = "coin.png";
  await pump(4);
  check(order.length === 2, "both loads completed");
  check(order.length === 2 && order[0] === 1 && order[1] === 2,
        "callbacks ran in the order the loads were started");

  /* 7. decode() settles later. */
  let decoded = false;
  const img3 = new Image();
  img3.src = "hazard.png";
  img3.decode().then(() => { decoded = true; });
  check(!decoded, "decode() has not settled synchronously");
  await pump(4);
  check(decoded, "decode() settles on a later turn");

  /* 8. FontFace.load() settles later. */
  let fontLoaded = false;
  new FontFace("Probe", "url(DejaVuSans.ttf)").load().then(() => { fontLoaded = true; });
  check(!fontLoaded, "FontFace.load() has not settled synchronously");
  await pump(4);
  check(fontLoaded, "FontFace.load() settles on a later turn");

  /* 9. decodeAudioData settles later.
   *
   * Skipped without an audio device, since there is no graph to decode into;
   * the harness runs with SDL_AUDIODRIVER=dummy so it normally runs. */
  const audio = AudioContextOrNull();
  if (audio !== null) {
    let audioDecoded = false;
    fetch("music.mp3")
      .then((res) => res.arrayBuffer())
      .then((bytes) => audio.decodeAudioData(bytes))
      .then((buf) => { audioDecoded = true; check(buf.length > 0, "decoded buffer has frames"); })
      .catch(() => { check(false, "decodeAudioData of a real mp3 should not reject"); });
    check(!audioDecoded, "decodeAudioData chain has not settled synchronously");
    await pump(10);
    check(audioDecoded, "decodeAudioData settles on a later turn");
  } else {
    console.log("  (no audio device; decodeAudioData ordering not exercised)");
  }

  /* 10. CONTROL: the harness must be able to observe a FAILURE.
   *
   * Every check above passes when ordering is correct, which means a broken
   * pump() that never advanced would show the same green as a correct one
   * for the negative checks. This proves the positive checks can actually
   * fail: a callback that is never drained stays unfired. */
  let neverDrained = false;
  const ctl = new Image();
  ctl.src = "player.png";
  ctl.onload = () => { neverDrained = true; };
  // deliberately NO pump here
  check(!neverDrained, "CONTROL: an undrained callback stays unfired");
  await pump(4);
  check(neverDrained, "CONTROL: the same callback fires once drained");

  console.log(`\nasync test: ${passed}/${passed + failed} checks passed`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
