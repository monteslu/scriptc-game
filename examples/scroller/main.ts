/* scroller: a tilemap platformer with a scrolling camera.
 *
 * The last shape the other examples do not cover: a world larger than the
 * screen, tile collision, gravity with coyote time and a jump buffer, and a
 * camera that follows with a dead zone. Everything is drawn from a tile
 * grid rather than from sprites, except the player.
 *
 * Browser code throughout; `./browser/test.sh scroller` runs this file in a
 * page.
 */
import {
  window, document, navigator, KeyboardEvent, Image, FontFace, AudioContext,
  Math, Gamepad,
} from "../../web/globals.js";
import { createGameLoop, LoopOptions } from "../../engine/loop.js";
import { blip, pickup, hit } from "../../engine/sfx.js";

const TILE = 32;
const GRAVITY = 0.0022;         // px per ms^2
const MOVE_SPEED = 0.26;        // px per ms
const AIR_CONTROL = 0.65;
const JUMP_VELOCITY = -0.72;
const MAX_FALL = 1.1;
const COYOTE_MS = 90;           // grace after walking off an edge
const JUMP_BUFFER_MS = 110;     // grace for pressing jump before landing
const CAMERA_DEADZONE = 130;
const FONT = "DejaVu Sans";

const BTN_A = 0;
const BTN_START = 9;
const BTN_DPAD_LEFT = 14;
const BTN_DPAD_RIGHT = 15;
const AXIS_LEFT_X = 0;
const DEADZONE = 0.25;

/* The level. '#' solid, '=' one-way platform, 'o' coin, '^' spike,
 * '@' spawn, '.' empty. Wider than the screen, which is the point. */
const LEVEL: string[] = [
  "................................................................",
  "................................................................",
  "..........................o.o.o.................................",
  ".........................========...............................",
  "................................................................",
  "..............o.o...............................o.o.o...........",
  ".............=====.....o.o.................===========..........",
  "..............................................................o.",
  "....@...............###.......===...........................####",
  "...####........o..................o.o...........................",
  "..#####.......====...##......................o..o...............",
  ".#######...................###.............========.............",
  "########.....^^....########............^^^......................",
  "##########################...####################...############",
  "################################################################",
];

function isSolid(ch: string): boolean { return ch === "#"; }
function isPlatform(ch: string): boolean { return ch === "="; }

window.addEventListener("load", () => {
  const canvas = document.getElementById("game-canvas");
  const ctx = canvas.getContext("2d")!;
  const W = canvas.width;
  const H = canvas.height;

  new FontFace(FONT, "url(DejaVuSans.ttf)").load().then((face) => {
    document.fonts.add(face);
  });

  const player = new Image();
  player.src = "player.png";

  const audio = new AudioContext();
  const live = audio.state === "running";

  const rows = LEVEL.length;
  const cols = LEVEL[0].length;
  const worldW = cols * TILE;
  const worldH = rows * TILE;

  /* The level is mutable (coins get eaten), so it is copied into a grid of
   * single characters rather than read from the string table each frame. */
  const grid: string[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) grid.push(LEVEL[r].charAt(c));
  }
  const at = (c: number, r: number): string => {
    if (c < 0 || c >= cols || r < 0 || r >= rows) return "#";   // walls outside
    return grid[r * cols + c];
  };
  const setAt = (c: number, r: number, ch: string): void => {
    if (c < 0 || c >= cols || r < 0 || r >= rows) return;
    grid[r * cols + c] = ch;
  };

  const PW = 22;                 // player collision box, not the sprite size
  const PH = 28;

  let px = 0;
  let py = 0;
  let vx = 0;
  let vy = 0;
  let prevPx = 0;
  let prevPy = 0;
  let facing = 1;
  let onGround = false;
  let coyoteMs = 0;
  let jumpBufferMs = 0;
  let coins = 0;
  let deaths = 0;
  let camX = 0;
  let camY = 0;

  let spawnX = TILE * 2;
  let spawnY = TILE * 2;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (at(c, r) === "@") {
        spawnX = c * TILE;
        spawnY = r * TILE;
        setAt(c, r, ".");
      }
    }
  }

  function respawn(): void {
    px = spawnX;
    py = spawnY;
    prevPx = px;
    prevPy = py;
    vx = 0;
    vy = 0;
    onGround = false;
  }
  respawn();
  camX = px - W / 2;
  camY = py - H / 2;

  const held = new Map<string, boolean>();
  const tapped = new Map<string, boolean>();
  window.addEventListener("keydown", (e: KeyboardEvent) => {
    held.set(e.code, true);
    tapped.set(e.code, true);
  });
  window.addEventListener("keyup", (e: KeyboardEvent) => { held.set(e.code, false); });
  const down = (c: string): boolean => held.get(c) === true;
  const tap = (c: string): boolean => tapped.get(c) === true;

  function pad(): Gamepad | null {
    const pads = navigator.getGamepads();
    for (let i = 0; i < pads.length; i++) {
      if (pads[i] !== null) return pads[i];
    }
    return null;
  }

  function sfx(fn: (c: AudioContext, v: number) => void, vol: number): void {
    if (live) fn(audio, vol);
  }

  /* Does the box at (x, y) overlap any solid tile?
   *
   * Only the tiles the box actually spans are tested, rather than the whole
   * grid: a 64x15 level is 960 tiles and this runs twice per axis per step. */
  function boxHitsSolid(x: number, y: number): boolean {
    const c0 = Math.floor(x / TILE);
    const c1 = Math.floor((x + PW - 1) / TILE);
    const r0 = Math.floor(y / TILE);
    const r1 = Math.floor((y + PH - 1) / TILE);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        if (isSolid(at(c, r))) return true;
      }
    }
    return false;
  }

  /* One-way platforms only stop a DOWNWARD move, and only when the player
   * was above them before the step. Otherwise you could not jump up
   * through one, which is the whole point of a one-way platform. */
  function landsOnPlatform(x: number, yFrom: number, yTo: number): number {
    if (yTo <= yFrom) return -1;
    const c0 = Math.floor(x / TILE);
    const c1 = Math.floor((x + PW - 1) / TILE);
    const rFrom = Math.floor((yFrom + PH - 1) / TILE);
    const rTo = Math.floor((yTo + PH - 1) / TILE);
    for (let r = rFrom; r <= rTo; r++) {
      for (let c = c0; c <= c1; c++) {
        if (isPlatform(at(c, r))) {
          const top = r * TILE;
          // Only if the feet were above the platform's surface before.
          if (yFrom + PH <= top + 6) return top - PH;
        }
      }
    }
    return -1;
  }

  function collectAndHazards(): void {
    const c0 = Math.floor(px / TILE);
    const c1 = Math.floor((px + PW - 1) / TILE);
    const r0 = Math.floor(py / TILE);
    const r1 = Math.floor((py + PH - 1) / TILE);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const ch = at(c, r);
        if (ch === "o") {
          setAt(c, r, ".");
          coins += 1;
          sfx(pickup, 0.5);
        } else if (ch === "^") {
          deaths += 1;
          sfx(hit, 0.6);
          respawn();
          return;
        }
      }
    }
  }

  function update(dt: number): void {
    prevPx = px;
    prevPy = py;

    const p = pad();
    let ix = 0;
    if (p !== null) {
      const ax = p.axes[AXIS_LEFT_X];
      const m = ax < 0 ? -ax : ax;
      if (m > DEADZONE) ix = ax < 0 ? -1 : 1;
      if (p.buttons[BTN_DPAD_LEFT].pressed) ix = -1;
      if (p.buttons[BTN_DPAD_RIGHT].pressed) ix = 1;
    }
    if (down("ArrowLeft") || down("KeyA")) ix = -1;
    if (down("ArrowRight") || down("KeyD")) ix = 1;
    if (ix !== 0) facing = ix;

    const jumpPressed = tap("Space") || tap("ArrowUp") || tap("KeyW") ||
      (p !== null && p.buttons[BTN_A].pressed);
    if (jumpPressed) jumpBufferMs = JUMP_BUFFER_MS;
    if (tap("KeyR") || (p !== null && p.buttons[BTN_START].pressed)) respawn();
    tapped.clear();

    const control = onGround ? 1 : AIR_CONTROL;
    vx = ix * MOVE_SPEED * control;

    /* Coyote time and the jump buffer are what make a platformer feel fair
     * rather than precise: a jump pressed just after leaving the ledge, or
     * just before landing, still works. Without them every missed jump
     * feels like the game cheated. */
    if (onGround) coyoteMs = COYOTE_MS;
    else if (coyoteMs > 0) coyoteMs -= dt;
    if (jumpBufferMs > 0) jumpBufferMs -= dt;

    if (jumpBufferMs > 0 && coyoteMs > 0) {
      vy = JUMP_VELOCITY;
      onGround = false;
      coyoteMs = 0;
      jumpBufferMs = 0;
      sfx(jumpSfx, 0.35);
    }

    vy += GRAVITY * dt;
    if (vy > MAX_FALL) vy = MAX_FALL;

    // Axis-separated movement: resolve X, then Y. Moving both at once and
    // resolving afterwards makes corners catch.
    const nextX = px + vx * dt;
    if (!boxHitsSolid(nextX, py)) {
      px = nextX;
    } else {
      // Step up to the wall instead of stopping short of it.
      const dir = vx > 0 ? 1 : -1;
      let probe = px;
      while (!boxHitsSolid(probe + dir, py)) probe += dir;
      px = probe;
      vx = 0;
    }

    const nextY = py + vy * dt;
    onGround = false;
    if (!boxHitsSolid(px, nextY)) {
      const landY = landsOnPlatform(px, py, nextY);
      if (landY >= 0) {
        py = landY;
        vy = 0;
        onGround = true;
      } else {
        py = nextY;
      }
    } else {
      const dir = vy > 0 ? 1 : -1;
      let probe = py;
      while (!boxHitsSolid(px, probe + dir)) probe += dir;
      py = probe;
      if (vy > 0) onGround = true;
      vy = 0;
    }

    if (px < 0) { px = 0; vx = 0; }
    if (px > worldW - PW) { px = worldW - PW; vx = 0; }
    if (py > worldH) { deaths += 1; sfx(hit, 0.6); respawn(); return; }

    collectAndHazards();

    /* Camera with a dead zone: it only moves once the player leaves a band
     * in the middle, so small hops do not swing the whole screen. */
    const targetLeft = px - CAMERA_DEADZONE;
    const targetRight = px + PW - (W - CAMERA_DEADZONE);
    if (px - camX < CAMERA_DEADZONE) camX = targetLeft;
    if (px + PW - camX > W - CAMERA_DEADZONE) camX = targetRight;
    camY += ((py + PH / 2 - H / 2) - camY) * Math.min(1, dt * 0.006);

    if (camX < 0) camX = 0;
    if (camX > worldW - W) camX = worldW - W;
    if (camY < 0) camY = 0;
    if (camY > worldH - H) camY = worldH - H;
  }

  function jumpSfx(c: AudioContext, v: number): void {
    blip(c, 520, 0.09, v, "square");
  }

  function render(alpha: number): void {
    const dx = prevPx + (px - prevPx) * alpha;
    const dy = prevPy + (py - prevPy) * alpha;

    ctx.fillStyle = "#0f1626";
    ctx.fillRect(0, 0, W, H);

    /* Parallax hills: drawn at a fraction of the camera offset, which is
     * what sells depth for the price of two arcs. */
    ctx.fillStyle = "#161f33";
    for (let i = 0; i < 8; i++) {
      const hx = i * 240 - (camX * 0.25) % 240;
      ctx.beginPath();
      ctx.arc(hx, H - 40, 150, Math.PI, 0, false);
      ctx.fill("nonzero");
    }
    ctx.fillStyle = "#1b2740";
    for (let i = 0; i < 10; i++) {
      const hx = i * 170 - (camX * 0.5) % 170;
      ctx.beginPath();
      ctx.arc(hx, H - 10, 105, Math.PI, 0, false);
      ctx.fill("nonzero");
    }

    // Only the tiles on screen: the level is wider than the viewport.
    const c0 = Math.max(0, Math.floor(camX / TILE));
    const c1 = Math.min(cols - 1, Math.floor((camX + W) / TILE));
    const r0 = Math.max(0, Math.floor(camY / TILE));
    const r1 = Math.min(rows - 1, Math.floor((camY + H) / TILE));

    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const ch = at(c, r);
        const x = c * TILE - camX;
        const y = r * TILE - camY;
        if (ch === "#") {
          ctx.fillStyle = "#33507a";
          ctx.fillRect(x, y, TILE, TILE);
          ctx.fillStyle = "#42639a";
          ctx.fillRect(x, y, TILE, 5);
        } else if (ch === "=") {
          ctx.fillStyle = "#5d7fb8";
          ctx.fillRect(x, y, TILE, 8);
        } else if (ch === "o") {
          ctx.fillStyle = "#ffd257";
          ctx.beginPath();
          ctx.arc(x + TILE / 2, y + TILE / 2, 7, 0, Math.PI * 2, false);
          ctx.fill("nonzero");
        } else if (ch === "^") {
          ctx.fillStyle = "#e5484d";
          ctx.beginPath();
          ctx.moveTo(x, y + TILE);
          ctx.lineTo(x + TILE / 2, y + 8);
          ctx.lineTo(x + TILE, y + TILE);
          ctx.closePath();
          ctx.fill("nonzero");
        }
      }
    }

    const sx = dx - camX;
    const sy = dy - camY;
    if (player.complete) {
      const size = 36;
      ctx.save();
      ctx.translate(sx + PW / 2, sy + PH / 2);
      // The art faces up; rotate it to face the direction of travel.
      ctx.rotate(facing > 0 ? Math.PI / 2 : -Math.PI / 2);
      ctx.drawImage(player, -size / 2, -size / 2, size, size);
      ctx.restore();
    } else {
      ctx.fillStyle = "#6ee7ff";
      ctx.fillRect(sx, sy, PW, PH);
    }

    ctx.fillStyle = "#e8eef5";
    ctx.font = `18px ${FONT}`;
    ctx.textAlign = "left";
    ctx.fillText(`coins ${coins}`, 16, 30);
    ctx.fillStyle = "#8b96a5";
    ctx.font = `12px ${FONT}`;
    ctx.fillText(`deaths ${deaths}`, 16, 50);
    ctx.textAlign = "right";
    ctx.fillText("arrows / WASD move   space jump   R respawn", W - 16, H - 14);
    ctx.textAlign = "left";
  }

  const loop = new LoopOptions();
  loop.update = update;
  loop.render = render;
  createGameLoop(loop);
});
