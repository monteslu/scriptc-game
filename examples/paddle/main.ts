/* paddle: two-player bat and ball, with a CPU opponent.
 *
 * The classic, and a deliberately different shape from `dodge`: fixed-step
 * physics through the optional engine loop, swept collision instead of
 * per-frame overlap checks, and no image assets at all (everything is
 * drawn with paths and rects).
 *
 * Browser code throughout. The only non-web line is the import that
 * supplies the globals; in a page an import map satisfies it and this file
 * runs unchanged. `./browser/test.sh paddle` proves that.
 */
import {
  window, document, navigator, KeyboardEvent, AudioContext, Math, Gamepad,
} from "../../web/globals.js";
import { createGameLoop, LoopOptions } from "../../engine/loop.js";
import { blip, pickup, gameOver } from "../../engine/sfx.js";

const PADDLE_W = 12;
const PADDLE_H = 84;
const PADDLE_INSET = 28;
const PADDLE_SPEED = 0.52;      // px per ms
const BALL_R = 8;
const BALL_START_SPEED = 0.34;
const BALL_MAX_SPEED = 0.92;
const SPEEDUP_PER_HIT = 1.045;
const WIN_SCORE = 7;
const CPU_REACTION = 0.78;      // 1 = perfect tracking, 0 = motionless
const FONT = "DejaVu Sans";

/* Standard Gamepad indices. The spec defines the layout by INDEX and names
 * no constants, so a game that wants names declares its own. */
const BTN_A = 0;
const BTN_START = 9;
const BTN_DPAD_UP = 12;
const BTN_DPAD_DOWN = 13;
const AXIS_LEFT_Y = 1;
const DEADZONE = 0.2;

function deadzone(v: number): number {
  const m = v < 0 ? -v : v;
  if (m < DEADZONE) return 0;
  const s = (m - DEADZONE) / (1 - DEADZONE);
  return v < 0 ? -s : s;
}

function clamp(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

window.addEventListener("load", () => {
  const canvas = document.getElementById("game-canvas");
  const ctx = canvas.getContext("2d")!;
  const W = canvas.width;
  const H = canvas.height;

  const audio = new AudioContext();
  const hasAudio = audio.state === "running";

  const held = new Map<string, boolean>();
  const tapped = new Map<string, boolean>();
  window.addEventListener("keydown", (e: KeyboardEvent) => {
    held.set(e.code, true);
    tapped.set(e.code, true);
  });
  window.addEventListener("keyup", (e: KeyboardEvent) => { held.set(e.code, false); });
  const down = (c: string): boolean => held.get(c) === true;
  const tap = (c: string): boolean => tapped.get(c) === true;

  /* ---- state ---- */
  let leftY = H / 2 - PADDLE_H / 2;
  let rightY = leftY;
  let prevLeftY = leftY;
  let prevRightY = rightY;

  let ballX = W / 2;
  let ballY = H / 2;
  let prevBallX = ballX;
  let prevBallY = ballY;
  let ballVX = 0;
  let ballVY = 0;

  let leftScore = 0;
  let rightScore = 0;
  let over = false;
  let serveDelay = 0;
  let twoPlayer = false;
  let rallyHits = 0;

  /* Deterministic PRNG: Math.random is unavailable in the static tier, and
   * a fixed seed also makes a screenshot reproducible. */
  let seed = 0x9e3779b9;
  function rand(): number {
    let x = seed;
    x ^= (x << 13) & 0xffffffff;
    x ^= x >>> 17;
    x ^= (x << 5) & 0xffffffff;
    seed = x >>> 0;
    return seed / 4294967296;
  }

  function serve(towardLeft: boolean): void {
    ballX = W / 2;
    ballY = H / 2;
    prevBallX = ballX;
    prevBallY = ballY;
    // A shallow angle, so the serve is returnable but not straight.
    const angle = (rand() - 0.5) * 0.7;
    ballVX = (towardLeft ? -1 : 1) * BALL_START_SPEED * Math.cos(angle);
    ballVY = BALL_START_SPEED * Math.sin(angle);
    serveDelay = 700;
    rallyHits = 0;
  }

  function restart(): void {
    leftScore = 0;
    rightScore = 0;
    over = false;
    leftY = H / 2 - PADDLE_H / 2;
    rightY = leftY;
    serve(rand() < 0.5);
  }

  serve(rand() < 0.5);

  function pad(index: number): Gamepad | null {
    const pads = navigator.getGamepads();
    let seen = 0;
    for (let i = 0; i < pads.length; i++) {
      const p = pads[i];
      if (p === null) continue;
      if (seen === index) return p;
      seen += 1;
    }
    return null;
  }

  /* Paddle input: keyboard, or a gamepad if one is plugged in. Player two
   * is the CPU until a second pad appears or the arrow keys are used. */
  function paddleInput(which: number): number {
    const p = pad(which);
    if (p !== null) {
      let v = deadzone(p.axes[AXIS_LEFT_Y]);
      if (p.buttons[BTN_DPAD_UP].pressed) v = -1;
      if (p.buttons[BTN_DPAD_DOWN].pressed) v = 1;
      if (v !== 0) return v;
    }
    if (which === 0) {
      if (down("KeyW")) return -1;
      if (down("KeyS")) return 1;
    } else {
      if (down("ArrowUp")) return -1;
      if (down("ArrowDown")) return 1;
    }
    return 0;
  }

  function sfx(fn: (c: AudioContext, v: number) => void, vol: number): void {
    if (hasAudio) fn(audio, vol);
  }

  /* Swept collision against a paddle face.
   *
   * Checking overlap once per frame lets a fast ball tunnel straight
   * through a 12px bat: at 0.92 px/ms and a 16ms step it moves ~15px, so
   * the ball can be in front on one frame and behind on the next with no
   * frame in between where they overlap. This tests whether the ball
   * CROSSED the face during the step instead. */
  function sweptHit(faceX: number, py: number, movingLeft: boolean): boolean {
    const edge = movingLeft ? faceX + PADDLE_W / 2 + BALL_R
                            : faceX - PADDLE_W / 2 - BALL_R;
    const crossed = movingLeft ? (prevBallX >= edge && ballX <= edge)
                               : (prevBallX <= edge && ballX >= edge);
    if (!crossed) return false;
    // Where was the ball vertically at the moment it crossed?
    const span = ballX - prevBallX;
    const t = span === 0 ? 0 : (edge - prevBallX) / span;
    const yAt = prevBallY + (ballY - prevBallY) * t;
    return yAt >= py - BALL_R && yAt <= py + PADDLE_H + BALL_R;
  }

  function bounceOffPaddle(py: number, towardRight: boolean): void {
    // Where on the bat it landed decides the angle: the edges steer hard,
    // the middle returns flat. This is the whole skill of the game.
    const rel = (ballY - (py + PADDLE_H / 2)) / (PADDLE_H / 2);
    const steer = clamp(rel, -1, 1);
    const speed = Math.min(
      BALL_MAX_SPEED,
      Math.sqrt(ballVX * ballVX + ballVY * ballVY) * SPEEDUP_PER_HIT);
    const angle = steer * 0.9;
    ballVX = (towardRight ? 1 : -1) * speed * Math.cos(angle);
    ballVY = speed * Math.sin(angle);
    rallyHits += 1;
    sfx(pickup, 0.35);
  }

  function update(dt: number): void {
    if (over) {
      const p = pad(0);
      const restartPressed = tap("Enter") || tap("Space") ||
        (p !== null && (p.buttons[BTN_START].pressed || p.buttons[BTN_A].pressed));
      tapped.clear();          // edges are consumed by the frame that saw them
      if (restartPressed) restart();
      return;
    }
    tapped.clear();

    prevLeftY = leftY;
    prevRightY = rightY;
    prevBallX = ballX;
    prevBallY = ballY;

    // A second human takes over player two the moment they press a key.
    if (down("ArrowUp") || down("ArrowDown") || pad(1) !== null) twoPlayer = true;

    leftY = clamp(leftY + paddleInput(0) * PADDLE_SPEED * dt, 0, H - PADDLE_H);

    if (twoPlayer) {
      rightY = clamp(rightY + paddleInput(1) * PADDLE_SPEED * dt, 0, H - PADDLE_H);
    } else {
      /* The CPU tracks the ball's centre, but only while the ball is
       * heading its way and only at a fraction of full speed. Perfect
       * tracking is unbeatable and no fun; this loses to a hard angle. */
      if (ballVX > 0) {
        const want = ballY - PADDLE_H / 2;
        const delta = want - rightY;
        const step = PADDLE_SPEED * CPU_REACTION * dt;
        rightY += clamp(delta, -step, step);
      }
      rightY = clamp(rightY, 0, H - PADDLE_H);
    }

    if (serveDelay > 0) { serveDelay -= dt; return; }

    ballX += ballVX * dt;
    ballY += ballVY * dt;

    // Top and bottom walls.
    if (ballY < BALL_R) { ballY = BALL_R; ballVY = -ballVY; sfx(blip2, 0.25); }
    if (ballY > H - BALL_R) { ballY = H - BALL_R; ballVY = -ballVY; sfx(blip2, 0.25); }

    if (ballVX < 0 && sweptHit(PADDLE_INSET, leftY, true)) {
      ballX = PADDLE_INSET + PADDLE_W / 2 + BALL_R;
      bounceOffPaddle(leftY, true);
    } else if (ballVX > 0 && sweptHit(W - PADDLE_INSET, rightY, false)) {
      ballX = W - PADDLE_INSET - PADDLE_W / 2 - BALL_R;
      bounceOffPaddle(rightY, false);
    }

    if (ballX < -BALL_R * 4) {
      rightScore += 1;
      if (rightScore >= WIN_SCORE) { over = true; sfx(gameOver, 0.7); }
      else { serve(false); sfx(hit2, 0.5); }
    } else if (ballX > W + BALL_R * 4) {
      leftScore += 1;
      if (leftScore >= WIN_SCORE) { over = true; sfx(gameOver, 0.7); }
      else { serve(true); sfx(hit2, 0.5); }
    }
  }

  // Wall and score tones, distinct from the paddle hit.
  function blip2(c: AudioContext, v: number): void { blip(c, 420, 0.05, v, "square"); }
  function hit2(c: AudioContext, v: number): void { blip(c, 180, 0.22, v, "sawtooth"); }

  function render(alpha: number): void {
    ctx.fillStyle = "#0b1016";
    ctx.fillRect(0, 0, W, H);

    // Centre line, dashed the way the original did it.
    ctx.strokeStyle = "#1e2a38";
    ctx.lineWidth = 4;
    ctx.setLineDash([12, 14]);
    ctx.beginPath();
    ctx.moveTo(W / 2, 0);
    ctx.lineTo(W / 2, H);
    ctx.stroke();
    ctx.setLineDash([]);

    const ly = prevLeftY + (leftY - prevLeftY) * alpha;
    const ry = prevRightY + (rightY - prevRightY) * alpha;
    const bx = prevBallX + (ballX - prevBallX) * alpha;
    const by = prevBallY + (ballY - prevBallY) * alpha;

    ctx.fillStyle = "#6ee7ff";
    ctx.fillRect(PADDLE_INSET - PADDLE_W / 2, ly, PADDLE_W, PADDLE_H);
    ctx.fillStyle = twoPlayer ? "#ffb86b" : "#8b96a5";
    ctx.fillRect(W - PADDLE_INSET - PADDLE_W / 2, ry, PADDLE_W, PADDLE_H);

    if (serveDelay <= 0) {
      ctx.fillStyle = "#f2f6fb";
      ctx.beginPath();
      ctx.arc(bx, by, BALL_R, 0, Math.PI * 2, false);
      ctx.fill("nonzero");
    }

    ctx.font = `48px ${FONT}`;
    ctx.fillStyle = "#2f3f52";
    ctx.textAlign = "right";
    ctx.fillText(`${leftScore}`, W / 2 - 30, 62);
    ctx.textAlign = "left";
    ctx.fillText(`${rightScore}`, W / 2 + 30, 62);

    ctx.font = `13px ${FONT}`;
    ctx.fillStyle = "#4a5666";
    ctx.textAlign = "left";
    ctx.fillText("W / S", 16, H - 14);
    ctx.textAlign = "right";
    ctx.fillText(twoPlayer ? "up / down" : "cpu", W - 16, H - 14);

    if (rallyHits >= 4) {
      ctx.textAlign = "center";
      ctx.fillStyle = "#3d4d61";
      ctx.fillText(`rally ${rallyHits}`, W / 2, H - 14);
    }
    ctx.textAlign = "left";

    if (over) {
      ctx.fillStyle = "rgba(6,10,15,0.8)";
      ctx.fillRect(0, 0, W, H);
      ctx.textAlign = "center";
      ctx.fillStyle = "#f2f6fb";
      ctx.font = `40px ${FONT}`;
      ctx.fillText(leftScore > rightScore ? "left wins" : "right wins", W / 2, H / 2 - 10);
      ctx.font = `16px ${FONT}`;
      ctx.fillStyle = "#7d8590";
      ctx.fillText("enter to play again", W / 2, H / 2 + 28);
      ctx.textAlign = "left";
    }
  }

  const loop = new LoopOptions();
  loop.update = update;
  loop.render = render;
  createGameLoop(loop);
});
