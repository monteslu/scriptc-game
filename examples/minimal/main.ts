/* The smallest browser-shaped game: no engine, no host, no node APIs.
 *
 * Everything below the import line is code that runs in a browser unchanged.
 * The `load` listener is the same thing you would write in a page: module
 * bodies run before the document is ready in BOTH worlds, so setup that
 * needs the canvas belongs here. */
import { window, document, requestAnimationFrame } from "../../web/globals.js";

window.addEventListener("load", () => {
  const canvas = document.getElementById("game-canvas");
  const ctx = canvas.getContext("2d")!;
  let x = 0;

  function frame(time: number): void {
    // The spec has no ctx.clear(): fill the canvas instead.
    ctx.fillStyle = "#101820";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    x = (x + 3) % canvas.width;
    ctx.fillStyle = "#58a6ff";
    ctx.fillRect(x, canvas.height / 2 - 20, 40, 40);
    ctx.fillStyle = "#8ee27a";
    ctx.fillRect(0, canvas.height - 6, x, 6);
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
});
