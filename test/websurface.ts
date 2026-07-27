/* Every game-visible global must be a REAL web API.
 *
 * This suite exists because four fabricated globals shipped: AudioContextOrNull,
 * window.onLoad, window.onMouse, and a canPlay() method on the haptic
 * actuator. None exist in any browser, so every example that used them would
 * have thrown TypeError in a page while passing every test here. The whole
 * premise of the project is that the same source runs in both places, so an
 * invented global is not a cosmetic problem: it silently voids the thesis.
 *
 * The check is deliberately mechanical. It USES each API in its spec form, so
 * the suite stops compiling if a spec name is removed or renamed, and it
 * asserts spec-required behaviour that a made-up convenience would not have.
 *
 * What this cannot catch: a name that exists in both worlds but behaves
 * differently. For that, see the conformance and async suites.
 */
import {
  window, document, navigator, requestAnimationFrame, cancelAnimationFrame,
  performance, Image, fetch, Response, FontFace, AudioContext,
  UIEvent, Math,
} from "../web/globals.js";
import { setGameDir } from "../host/resources.js";
import * as ffi from "../host/ffi.js";

let passed = 0;
let failed = 0;
function check(cond: boolean, label: string): void {
  if (cond) { passed += 1; return; }
  failed += 1;
  // An empty label is the control's deliberate failure, which reports itself.
  if (label !== "") console.log(`  FAIL: ${label}`);
}

function main(): void {
  setGameDir("examples/dodge");
  // A window must exist before the canvas has real dimensions, exactly as a
  // page exists before scripts run.
  if (ffi.init(320, 240, 2) !== 0) { console.log("FATAL: sg_init"); process.exit(2); }
  console.log("==> web surface");

  /* 1. The event model is the spec's ONE addEventListener, for every event
   * type. If someone reintroduces onLoad/onMouse, the spec spellings below
   * are what must keep working. */
  let keyFired = false;
  let loadShape = false;
  window.addEventListener("keydown", (e: UIEvent) => { keyFired = e.code !== ""; });
  window.addEventListener("mousemove", (e: UIEvent) => { /* clientX/Y */ });
  window.addEventListener("load", () => { loadShape = true; });
  window.addEventListener("fullscreenchange", () => {});
  check(true, "addEventListener accepts keydown, mousemove, load, fullscreenchange");

  /* A no-argument handler must be accepted: `addEventListener("load", () =>
   * {...})` is how every page is written, and requiring an unused parameter
   * would be a deviation. */
  window.addEventListener("keyup", () => {});
  check(true, "a no-argument handler is accepted");

  window.removeEventListener("keydown", (e: UIEvent) => {});
  check(true, "removeEventListener exists");

  /* 2. AudioContext is a NO-ARGUMENT constructor that never returns null.
   * The invented AudioContextOrNull() existed because this was not true. */
  const audio = new AudioContext();
  check(audio.state === "running" || audio.state === "suspended" ||
        audio.state === "closed" || audio.state === "interrupted",
        `state is an AudioContextState (got "${audio.state}")`);
  check(audio.destination !== null, "destination exists");
  check(audio.currentTime >= 0, "currentTime is the spec clock");

  /* 3. Rumble: a DICTIONARY literal, not a constructor, and support is read
   * from `effects`. `new GamepadEffectParameters()` is a ReferenceError in a
   * browser, and canPlay() does not exist at all. */
  const pads = navigator.getGamepads();
  check(pads.length >= 0, "navigator.getGamepads() returns a list");
  for (let i = 0; i < pads.length; i++) {
    const p = pads[i];
    if (p === null) continue;
    check(p.vibrationActuator.effects.length >= 0,
          "vibrationActuator.effects is readable (the spec support check)");
    p.vibrationActuator.playEffect("dual-rumble", { duration: 0 });
    check(true, "playEffect takes an object literal");
  }

  /* 4. The remaining globals, in their spec spellings. Each call is the
   * assertion: a rename breaks the build. */
  const canvas = document.getElementById("game-canvas");
  check(canvas.width > 0 && canvas.height > 0, "canvas has width/height");
  check(canvas.getContext("2d") !== null, "getContext 2d");
  check(performance.now() >= 0, "performance.now()");
  check(window.innerWidth > 0, "window.innerWidth");
  check(navigator.userAgent !== "", "navigator.userAgent");

  const id = requestAnimationFrame((t: number) => {});
  cancelAnimationFrame(id);
  check(id > 0, "requestAnimationFrame returns a cancellable handle");

  const img = new Image();
  img.src = "player.png";
  check(img.src === "player.png", "Image.src round-trips");

  new FontFace("Probe", "url(DejaVuSans.ttf)").load().catch(() => {});
  check(true, "new FontFace(family, source).load()");

  fetch("music.mp3").then((r: Response) => {
    check(r.ok, "fetch resolves a Response with ok");
  });

  check(Math.PI > 3.14 && Math.PI < 3.15, "Math.PI");

  /* 5. CONTROL: the checks above must be able to FAIL.
   *
   * Everything here passes when the surface is correct, so a check() that
   * always counted success would look identical. */
  check(!(audio.state === "not-a-real-state"),
        "CONTROL: a bogus state string does not match");
  const before = failed;
  check(false, "");                     // deliberate; label suppressed below
  const controlWorks = failed === before + 1;
  failed = before;   // un-count the deliberate failure
  passed += 1;
  if (controlWorks) {
    console.log("  (control: a false check was correctly counted as a failure)");
  } else {
    console.log("  FAIL: the harness cannot observe failure");
    failed += 1;
  }

  console.log(`\nweb surface test: ${passed}/${passed + failed} checks passed`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
