/* dodge: a playable game, written as browser code.
 *
 * Move with the left stick or the dpad (WASD / arrows also work). Blocks
 * fall; touching one costs a life and rumbles the pad. Catch the coins.
 * A/space dashes. Start/Enter restarts. M toggles music. ESC quits.
 *
 * THE POINT OF THIS FILE: everything below the import is code that runs in a
 * browser. Images load with `new Image()` and `onload`. Sound is Web Audio.
 * Input is `navigator.getGamepads()` and keydown/keyup listeners. The loop is
 * `requestAnimationFrame`. There is no framework class to extend, no
 * filesystem call, and no engine import -- see examples/dodge/README.md.
 *
 * Assets live in public/, which is the web root, so "player.png" resolves the
 * same way it would from a page served out of this directory.
 */
import {
  window, document, navigator, requestAnimationFrame,
  Image, KeyboardEvent, AudioContextOrNull, FontFace, fetch, AudioBuffer,
  Math, Gamepad, GamepadEffectParameters,
} from "../../web/globals.js";
import { pickup, hit, dash as dashSfx, gameOver } from "../../engine/sfx.js";

const TAU = Math.PI * 2;

/* Standard Gamepad indices.
 *
 * The Gamepad spec defines the layout by INDEX and names no constants, so a
 * game that wants readable names declares them -- exactly as
 * simple-jsgame-starter does in its own utils.js. Browser code and this code
 * are identical here.
 *   w3c.github.io/gamepad/#remapping */
const BTN_A = 0;
const BTN_START = 9;
const BTN_DPAD_UP = 12;
const BTN_DPAD_DOWN = 13;
const BTN_DPAD_LEFT = 14;
const BTN_DPAD_RIGHT = 15;
const AXIS_LEFT_X = 0;
const AXIS_LEFT_Y = 1;

const PLAYER_R = 14;
const PLAYER_SPEED = 0.34;      // px per ms
const DASH_SPEED = 0.95;
const DASH_MS = 140;
const DASH_COOLDOWN_MS = 620;

/* Sticks never rest at exactly zero, so anything under the deadzone is
 * treated as centred; past it the value is rescaled so the usable range
 * still runs a full 0..1 and slow movement stays possible. */
const DEADZONE = 0.22;

/* Music sits UNDER the effects: at equal volume a looping track masks the
 * feedback a player needs to hear. */
const MUSIC_VOLUME = 0.5;
const SFX_VOLUME = 0.9;

const FONT = "DejaVu Sans";

function applyDeadzone(v: number): number {
  const mag = v < 0 ? -v : v;
  if (mag < DEADZONE) return 0;
  const scaled = (mag - DEADZONE) / (1 - DEADZONE);
  return v < 0 ? -scaled : scaled;
}

class Faller {
  x = 0; y = 0; vy = 0; size = 0; coin = false; alive = false;
}

window.onLoad(() => {
  const canvas = document.getElementById("game-canvas");
  const ctx = canvas.getContext("2d")!;
  const W = canvas.width;
  const H = canvas.height;

  /* ---- assets ----
   * `new Image()` + onload, exactly as in a page. The handler fires on a
   * later turn, so `loaded` is still false on the next line -- which is why
   * the draw checks it rather than assuming. */
  let ready = 0;
  const player = new Image();
  const hazard = new Image();
  const coin = new Image();
  player.onload = () => { ready += 1; };
  hazard.onload = () => { ready += 1; };
  coin.onload = () => { ready += 1; };
  player.src = "player.png";
  hazard.src = "hazard.png";
  coin.src = "coin.png";

  /* The CSS Font Loading API, as in a page. Text draws once this resolves;
   * before then the HUD simply renders nothing, which is what a browser does
   * with an unloaded webfont. */
  new FontFace(FONT, "url(DejaVuSans.ttf)").load().then((face) => {
    document.fonts.add(face);
  });

  const audio = AudioContextOrNull();
  let musicGain: ReturnType<typeof makeMusicBus> | null = null;
  let musicOn = true;

  function makeMusicBus() {
    return audio!.createGain();
  }

  if (audio !== null) {
    /* The spec dance, identical in a browser:
     *   fetch -> arrayBuffer -> decodeAudioData -> BufferSource */
    fetch("music.mp3")
      .then((res) => res.arrayBuffer())
      .then((bytes) => audio.decodeAudioData(bytes))
      .then((track: AudioBuffer) => {
      const bus = audio.createGain();
      bus.gain.value = MUSIC_VOLUME;
      bus.connect(audio.destination);
      const src = audio.createBufferSource();
      src.buffer = track;
      src.loop = true;
      src.connect(bus);
      src.start(0);
      musicGain = bus;
    });
  }

  /* ---- input ---- */
  const held = new Map<string, boolean>();
  const tapped = new Map<string, boolean>();
  window.addEventListener("keydown", (e: KeyboardEvent) => {
    held.set(e.code, true);
    tapped.set(e.code, true);
  });
  window.addEventListener("keyup", (e: KeyboardEvent) => { held.set(e.code, false); });

  function down(code: string): boolean { return held.get(code) === true; }
  function tap(code: string): boolean { return tapped.get(code) === true; }

  function pad(): Gamepad | null {
    const pads = navigator.getGamepads();
    for (let i = 0; i < pads.length; i++) {
      if (pads[i] !== null) return pads[i];
    }
    return null;
  }

  function rumble(weak: number, strong: number, ms: number): void {
    const p = pad();
    if (p === null || !p.vibrationActuator.canPlay("dual-rumble")) return;
    const fx = new GamepadEffectParameters();
    fx.duration = ms;
    fx.weakMagnitude = weak;
    fx.strongMagnitude = strong;
    p.vibrationActuator.playEffect("dual-rumble", fx);
  }

  /* ---- state ---- */
  let px = W / 2;
  let py = H - 90;
  let heading = -Math.PI / 2;
  let lives = 3;
  let score = 0;
  let best = 0;
  let over = false;
  let dashMs = 0;
  let cooldownMs = 0;
  let invulnMs = 0;
  let spawnMs = 0;
  let spawnEvery = 620;
  let elapsed = 0;
  let coinAnimMs = 0;
  let last = 0;

  const fallers: Faller[] = [];
  for (let i = 0; i < 64; i++) fallers.push(new Faller());

  /* Deterministic pseudo-randomness: Math.random is unavailable in the
   * static tier, and a fixed seed also makes screenshots reproducible. */
  let seed = 0x2f6e2b1;
  function rand(): number {
    let x = seed;
    x ^= (x << 13) & 0xffffffff;
    x ^= x >>> 17;
    x ^= (x << 5) & 0xffffffff;
    seed = x >>> 0;
    return seed / 4294967296;
  }

  function restart(): void {
    px = W / 2; py = H - 90;
    lives = 3; score = 0; over = false;
    elapsed = 0; spawnEvery = 620;
    dashMs = 0; cooldownMs = 0; invulnMs = 0;
    for (let i = 0; i < fallers.length; i++) fallers[i].alive = false;
  }

  function spawn(): void {
    for (let i = 0; i < fallers.length; i++) {
      const f = fallers[i];
      if (f.alive) continue;
      f.alive = true;
      f.coin = rand() < 0.22;
      f.size = f.coin ? 16 : 22 + rand() * 26;
      f.x = f.size + rand() * (W - f.size * 2);
      f.y = -30;
      f.vy = (f.coin ? 0.2 : 0.16) + rand() * 0.22 + elapsed * 0.000008;
      return;
    }
  }

  function update(dt: number): void {
    const p = pad();

    if (over) {
      const restartPressed =
        tap("Enter") || tap("Space") ||
        (p !== null && (p.buttons[BTN_START].pressed || p.buttons[BTN_A].pressed));
      if (restartPressed) restart();
      return;
    }

    let ix = 0;
    let iy = 0;
    if (p !== null) {
      ix = applyDeadzone(p.axes[AXIS_LEFT_X]);
      iy = applyDeadzone(p.axes[AXIS_LEFT_Y]);
      if (p.buttons[BTN_DPAD_LEFT].pressed) ix = -1;
      if (p.buttons[BTN_DPAD_RIGHT].pressed) ix = 1;
      if (p.buttons[BTN_DPAD_UP].pressed) iy = -1;
      if (p.buttons[BTN_DPAD_DOWN].pressed) iy = 1;
    }
    if (down("ArrowLeft") || down("KeyA")) ix = -1;
    if (down("ArrowRight") || down("KeyD")) ix = 1;
    if (down("ArrowUp") || down("KeyW")) iy = -1;
    if (down("ArrowDown") || down("KeyS")) iy = 1;

    // Normalise so diagonals are not faster than the cardinals.
    const mag = Math.sqrt(ix * ix + iy * iy);
    if (mag > 1) { ix /= mag; iy /= mag; }

    if (ix !== 0 || iy !== 0) {
      /* Ease toward travel through the SHORTEST arc: lerping raw angles
       * spins the long way round when crossing +/-PI. */
      const target = Math.atan2(iy, ix);
      let delta = target - heading;
      while (delta > Math.PI) delta -= TAU;
      while (delta < -Math.PI) delta += TAU;
      heading += delta * Math.min(1, dt * 0.02);
    }

    if (cooldownMs > 0) cooldownMs -= dt;
    const dashPressed =
      tap("Space") ||
      (p !== null && p.buttons[BTN_A].pressed && dashMs <= 0 && cooldownMs <= 0);
    if (dashPressed && cooldownMs <= 0 && (ix !== 0 || iy !== 0)) {
      dashMs = DASH_MS;
      cooldownMs = DASH_COOLDOWN_MS;
      rumble(0.25, 0.15, 70);
      if (audio !== null) dashSfx(audio, SFX_VOLUME * 0.8);
    }

    let speed = PLAYER_SPEED;
    if (dashMs > 0) { speed = DASH_SPEED; dashMs -= dt; }

    px += ix * speed * dt;
    py += iy * speed * dt;
    if (px < PLAYER_R) px = PLAYER_R;
    if (px > W - PLAYER_R) px = W - PLAYER_R;
    if (py < PLAYER_R) py = PLAYER_R;
    if (py > H - PLAYER_R) py = H - PLAYER_R;

    elapsed += dt;
    if (spawnEvery > 190) spawnEvery -= dt * 0.02;
    spawnMs -= dt;
    if (spawnMs <= 0) { spawnMs = spawnEvery; spawn(); }
    if (invulnMs > 0) invulnMs -= dt;

    for (let i = 0; i < fallers.length; i++) {
      const f = fallers[i];
      if (!f.alive) continue;
      f.y += f.vy * dt;
      if (f.y > H + 40) { f.alive = false; continue; }

      const half = f.size / 2;
      const dx = px - f.x;
      const dy = py - f.y;
      const near = (dx < 0 ? -dx : dx) < half + PLAYER_R &&
                   (dy < 0 ? -dy : dy) < half + PLAYER_R;
      if (!near) continue;

      if (f.coin) {
        f.alive = false;
        score += 10;
        rumble(0.15, 0, 45);
        if (audio !== null) pickup(audio, SFX_VOLUME);
      } else if (invulnMs <= 0) {
        f.alive = false;
        lives -= 1;
        invulnMs = 1100;
        rumble(0.9, 1, 260);
        if (audio !== null) hit(audio, SFX_VOLUME);
        if (lives <= 0) {
          over = true;
          if (score > best) best = score;
          rumble(1, 1, 520);
          if (audio !== null) gameOver(audio, SFX_VOLUME * 0.9);
        }
      }
    }

    score += dt * 0.004;
    coinAnimMs += dt;
  }

  function draw(): void {
    ctx.clear("#0d1117");

    ctx.strokeStyle = "#161d27";
    ctx.lineWidth = 1;
    for (let gx = 0; gx <= W; gx += 50) {
      ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke();
    }
    for (let gy = 0; gy <= H; gy += 50) {
      ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke();
    }

    for (let i = 0; i < fallers.length; i++) {
      const f = fallers[i];
      if (!f.alive) continue;
      if (f.coin) {
        if (coin.bitmap !== null) {
          // One strip, four 16px frames: the source rect picks the frame.
          const frameIdx = Math.floor(coinAnimMs / 90) % 4;
          ctx.drawImageRect(coin.bitmap, frameIdx * 16, 0, 16, 16,
                            f.x - f.size / 2, f.y - f.size / 2, f.size, f.size);
        } else {
          ctx.fillStyle = "#ffd257";
          ctx.beginPath();
          ctx.arc(f.x, f.y, f.size / 2, 0, TAU, false);
          ctx.fill("nonzero");
        }
      } else if (hazard.bitmap !== null) {
        ctx.drawImageScaled(hazard.bitmap, f.x - f.size / 2, f.y - f.size / 2,
                            f.size, f.size);
      } else {
        ctx.fillStyle = "#e5484d";
        ctx.fillRect(f.x - f.size / 2, f.y - f.size / 2, f.size, f.size);
      }
    }

    const blink = invulnMs > 0 && (invulnMs % 200) > 100;
    if (!blink) {
      if (player.bitmap !== null) {
        /* 3.2x the collision radius, not 2x: the art has transparent margin
         * and a narrow nose, so a frame sized to the hitbox renders a ship
         * visibly smaller than the hazards it dodges. */
        const size = PLAYER_R * 3.2;
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(heading + Math.PI / 2);   // the art faces up
        ctx.drawImageScaled(player.bitmap, -size / 2, -size / 2, size, size);
        ctx.restore();
        if (dashMs > 0) {
          ctx.globalAlpha = 0.45;
          ctx.fillStyle = "#8ee27a";
          ctx.beginPath();
          ctx.arc(px, py, PLAYER_R, 0, TAU, false);
          ctx.fill("nonzero");
          ctx.globalAlpha = 1;
        }
      } else {
        ctx.fillStyle = dashMs > 0 ? "#8ee27a" : "#58a6ff";
        ctx.beginPath();
        ctx.arc(px, py, PLAYER_R, 0, TAU, false);
        ctx.fill("nonzero");
      }
    }

    drawHud();
    if (over) drawGameOver();
  }

  function drawHud(): void {
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "#e6edf3";
    ctx.font = `20px ${FONT}`;
    ctx.fillText(`score ${Math.floor(score)}`, 16, 32);

    ctx.fillStyle = "#e5484d";
    for (let i = 0; i < lives; i++) {
      ctx.beginPath();
      ctx.arc(24 + i * 26, 52, 8, 0, TAU, false);
      ctx.fill("nonzero");
    }

    const dashReady = cooldownMs <= 0;
    ctx.fillStyle = "#1c2430";
    ctx.fillRect(W - 156, 24, 140, 12);
    ctx.fillStyle = dashReady ? "#8ee27a" : "#3d5570";
    const frac = dashReady ? 1 : 1 - cooldownMs / DASH_COOLDOWN_MS;
    ctx.fillRect(W - 156, 24, 140 * frac, 12);
    ctx.fillStyle = "#7d8590";
    ctx.font = `12px ${FONT}`;
    ctx.textAlign = "right";
    ctx.fillText(dashReady ? "dash ready" : "dash", W - 16, 52);

    ctx.textAlign = "left";
    ctx.fillStyle = "#4d5866";
    const p = pad();
    ctx.fillText(p === null ? "keyboard: arrows/WASD, space to dash" : `pad: ${p.id}`,
                 16, H - 14);
    ctx.textAlign = "right";
    ctx.fillText(musicOn ? "M: music on" : "M: music off", W - 16, H - 14);
    ctx.textAlign = "left";
  }

  function drawGameOver(): void {
    ctx.fillStyle = "rgba(5,8,12,0.78)";
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = "center";
    ctx.fillStyle = "#e6edf3";
    ctx.font = `44px ${FONT}`;
    ctx.fillText("game over", W / 2, H / 2 - 30);
    ctx.font = `22px ${FONT}`;
    ctx.fillStyle = "#8ee27a";
    ctx.fillText(`score ${Math.floor(score)}   best ${Math.floor(best)}`, W / 2, H / 2 + 12);
    ctx.font = `16px ${FONT}`;
    ctx.fillStyle = "#7d8590";
    ctx.fillText("start / enter to play again    ESC to quit", W / 2, H / 2 + 52);
    ctx.textAlign = "left";
  }

  function frame(time: number): void {
    let dt = last === 0 ? 16 : time - last;
    last = time;
    if (dt > 250) dt = 250;

    if (tap("KeyM")) {
      musicOn = !musicOn;
      if (musicGain !== null) musicGain.gain.value = musicOn ? MUSIC_VOLUME : 0;
    }

    update(dt);
    draw();

    // Taps are edges: clear them after the frame that observed them.
    tapped.clear();
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
});
