/* loader: a loading screen, then a scene, using the OPTIONAL engine.
 *
 * This example is the counterpart to `minimal`, which uses no engine at all.
 * Here both engine modules do their job:
 *
 *   engine/assets.js  declare every asset, draw a progress bar, start when done
 *   engine/loop.js    fixed-step update + interpolated render
 *
 * Everything underneath is still web API. The loader is `new Image()`,
 * `fetch` and `decodeAudioData`; the loop is `requestAnimationFrame`. Nothing
 * here reaches past the browser surface, so the file runs in a page too.
 *
 * One asset is DELIBERATELY missing, to show that a bad path does not hang
 * the loading screen: it is reported by name and the game starts anyway.
 */
import {
  window, document, AudioContext, FontFace,
} from "../../web/globals.js";
import { createResourceLoader } from "../../engine/assets.js";
import { createGameLoop, LoopOptions } from "../../engine/loop.js";

class Spinner {
  name: string = "";
  x: number = 0;
  y: number = 0;
  angle: number = 0;
  speed: number = 0;
  size: number = 0;
}

window.addEventListener("load", () => {
  const canvas = document.getElementById("game-canvas");
  const ctx = canvas.getContext("2d")!;
  const W = canvas.width;
  const H = canvas.height;

  // Webfont, the spec way. Text before it resolves renders nothing, exactly
  // as an unloaded webfont does in a page.
  new FontFace("DejaVu Sans", "url(DejaVuSans.ttf)").load().then((face) => {
    document.fonts.add(face);
  });

  const audio = new AudioContext();
  const loader = createResourceLoader(audio);

  loader.addImage("player", "player.png");
  loader.addImage("coin", "coin.png");
  loader.addImage("hazard", "hazard.png");
  loader.addSound("music", "music.mp3");
  // Deliberately absent: proves one bad path does not stall the batch.
  loader.addImage("missing", "not-here.png");

  let loading = true;
  let missingReport = "";

  /* The loading screen is drawn by the same loop that later draws the game,
   * so the progress bar animates instead of freezing on one frame. */
  const spinners: Spinner[] = [];

  loader.load().then((res) => {
    const failed = res.failed();
    if (failed.length > 0) {
      missingReport = `missing: ${failed.join(", ")}`;
    }

    const names = ["player", "coin", "hazard"];
    for (let i = 0; i < names.length; i++) {
      const s = new Spinner();
      s.name = names[i];
      s.x = W * (0.25 + 0.25 * i);
      s.y = H * 0.5;
      s.speed = 0.0015 + 0.0008 * i;
      s.size = 64;
      spinners.push(s);
    }

    const track = res.getSound("music");
    if (track !== null) {
      const src = audio.createBufferSource();
      src.buffer = track;
      src.loop = true;
      const gain = audio.createGain();
      gain.gain.value = 0.35;
      src.connect(gain);
      gain.connect(audio.destination);
      src.start(0);
    }

    loading = false;
  });

  function update(dt: number): void {
    if (loading) return;
    for (let i = 0; i < spinners.length; i++) {
      // Bound to a local first: the dialect has no compound assignment
      // through an indexed receiver (SC1090).
      const s = spinners[i];
      s.angle = s.angle + s.speed * dt;
    }
  }

  function render(alpha: number): void {
    ctx.clear("#0d1117");

    if (loading) {
      const pct = loader.getPercentComplete();
      const barW = W * 0.6;
      const barX = (W - barW) / 2;
      const barY = H / 2 - 8;

      ctx.fillStyle = "#c9d1d9";
      ctx.font = "20px DejaVu Sans";
      ctx.textAlign = "center";
      ctx.fillText("loading", W / 2, barY - 24);

      ctx.strokeStyle = "#30363d";
      ctx.lineWidth = 2;
      ctx.strokeRect(barX, barY, barW, 16);
      ctx.fillStyle = "#58a6ff";
      ctx.fillRect(barX, barY, barW * pct, 16);
      return;
    }

    for (let i = 0; i < spinners.length; i++) {
      const s = spinners[i];
      const img = loader.getImage(s.name);
      if (img === null) continue;
      ctx.save();
      ctx.translate(s.x, s.y);
      // alpha smooths rotation between fixed steps.
      ctx.rotate(s.angle + s.speed * alpha * 16);
      // drawImageScaled, not drawImage(img,x,y,w,h): the dialect has no
      // overloads, so each drawImage arity is its own method name.
      ctx.drawImageScaled(img, -s.size / 2, -s.size / 2, s.size, s.size);
      ctx.restore();
    }

    ctx.fillStyle = "#c9d1d9";
    ctx.font = "18px DejaVu Sans";
    ctx.textAlign = "center";
    ctx.fillText("loaded via engine/assets.js", W / 2, H - 56);

    if (missingReport !== "") {
      ctx.fillStyle = "#f85149";
      ctx.font = "14px DejaVu Sans";
      ctx.fillText(missingReport, W / 2, H - 30);
    }
  }

  const loop = new LoopOptions();
  loop.update = update;
  loop.render = render;
  createGameLoop(loop);
});
