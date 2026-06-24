// Ball mode (press B) — raise wrist above nose to spawn a sticky ball at foot,
// kick it fast to launch it.
//
// Reads from pose.js globals: rawPoses, MAX_PEOPLE, KP, bodyState

let ballMode = false;

// ---- constants -------------------------------------------------------------

const RAISE_HOLD_FRAMES = 18;  // frames wrist must stay above nose (~0.3s at 60fps)
const KICK_SPEED_PX     = 22;  // canvas px/frame at ankle to trigger kick
const MAX_BALLS         = 10;
const BALL_RADIUS       = 22;
const BALL_HUES         = [45, 20, 70]; // warm gold / orange / lime per person slot

// ---- per-slot state --------------------------------------------------------

// Gesture state: tracks how long each wrist has been held above nose
const gestureSlots = Array.from({ length: 3 }, () => ({
  lFrames:  0,   // left wrist raised frames
  rFrames:  0,   // right wrist raised frames
  cooldown: 0,
}));

// Foot tracking state (raw pose → smoothed canvas position + velocity)
const footSlots = Array.from({ length: 3 }, () => ({
  left:  { x: 0, y: 0, rawX: 0, rawY: 0, vx: 0, vy: 0, speed: 0, visible: false },
  right: { x: 0, y: 0, rawX: 0, rawY: 0, vx: 0, vy: 0, speed: 0, visible: false },
}));

const balls = []; // active Ball instances

// ---- Ball class ------------------------------------------------------------

class Ball {
  constructor(x, y, slotIdx) {
    this.x            = x;
    this.y            = y;
    this.vx           = 0;
    this.vy           = 0;
    this.radius       = BALL_RADIUS;
    this.hue          = BALL_HUES[slotIdx % BALL_HUES.length];
    this.attached     = true;
    this.attachedFoot = null;  // 'left' | 'right' | null
    this.slotIdx      = slotIdx;
    this.age          = 0;
    this.restFrames   = 0;
    this.dead         = false;
    this.alpha        = 0;     // fade in on spawn
  }

  update(p) {
    this.age++;
    this.alpha = Math.min(1, this.alpha + 0.07);
    if (this.attached) return;

    this.vy += 0.42;           // gravity
    this.x  += this.vx;
    this.y  += this.vy;
    this.vx *= 0.994;

    // Floor
    if (this.y + this.radius > p.height) {
      this.y  = p.height - this.radius;
      this.vy = -Math.abs(this.vy) * 0.52;
      this.vx *= 0.80;
      if (Math.abs(this.vy) < 1.5) this.vy = 0;
    }

    // Walls
    if (this.x - this.radius < 0)       { this.x = this.radius;           this.vx =  Math.abs(this.vx) * 0.6; }
    if (this.x + this.radius > p.width) { this.x = p.width - this.radius; this.vx = -Math.abs(this.vx) * 0.6; }

    // At rest on floor → eventually die
    if (this.y + this.radius >= p.height - 2 && Math.abs(this.vy) < 0.2) {
      this.restFrames++;
      if (this.restFrames > 360) this.dead = true;
    } else {
      this.restFrames = 0;
    }

    if (this.y < -400 || this.age > 2400) this.dead = true;
  }

  draw(p) {
    const { x, y, radius, hue, attached, restFrames } = this;
    if (this.alpha < 0.01) return;

    // Fade out when dying at rest
    const fadeMul = restFrames > 240 ? 1 - (restFrames - 240) / 120 : 1;
    const a = this.alpha * fadeMul;

    p.push();
    p.noStroke();

    // Outer glow
    [2.8, 2.0, 1.4].forEach((r, i) => {
      p.fill(hue, 70, 100, (0.04 + i * 0.028) * a);
      p.ellipse(x, y, radius * r * 2, radius * r * 2);
    });

    // Main sphere
    p.fill(hue, 82, 90, 0.9 * a);
    p.ellipse(x, y, radius * 2, radius * 2);

    // Specular highlight
    p.fill(hue, 15, 100, 0.72 * a);
    p.ellipse(x - radius * 0.28, y - radius * 0.28, radius * 0.44, radius * 0.44);

    // Pulsing ring while attached (shows "ready to kick" state)
    if (attached) {
      const pulse = 1 + 0.18 * Math.sin(p.millis() * 0.008);
      p.noFill();
      p.stroke(hue, 65, 100, 0.45 * a);
      p.strokeWeight(1.5);
      p.ellipse(x, y, radius * 2.7 * pulse, radius * 2.7 * pulse);
    }

    p.pop();
  }
}

// ---- foot position update --------------------------------------------------

function updateFootState(kp, W, H, fs, p) {
  [[KP.L_ANKLE, 'left'], [KP.R_ANKLE, 'right']].forEach(([idx, side]) => {
    const ankle = kp[idx];
    const foot  = fs[side];

    if (ankle.score > 0.2) {
      const nx = (1 - ankle.x / W) * p.width;
      const ny = (ankle.y / H)     * p.height;

      // Raw velocity (before position smoothing) → used for kick detection
      const rawVx = nx - foot.rawX;
      const rawVy = ny - foot.rawY;
      foot.rawX = nx;
      foot.rawY = ny;

      // Smooth velocity to suppress jitter
      foot.vx += (rawVx - foot.vx) * 0.45;
      foot.vy += (rawVy - foot.vy) * 0.45;
      foot.speed = Math.sqrt(foot.vx * foot.vx + foot.vy * foot.vy);

      // Smoothed position for ball attachment
      foot.x += (nx - foot.x) * 0.38;
      foot.y += (ny - foot.y) * 0.38;
      foot.visible = true;
    } else {
      foot.vx = 0; foot.vy = 0; foot.speed = 0;
      foot.visible = false;
    }
  });
}

// ---- spawn -----------------------------------------------------------------

function spawnBall(p, slotIdx, fs) {
  // Pick the lower (more forward) foot, or whichever is visible
  let side = null;
  if      (fs.left.visible && fs.right.visible) side = fs.left.y >= fs.right.y ? 'left' : 'right';
  else if (fs.left.visible)  side = 'left';
  else if (fs.right.visible) side = 'right';

  const foot = side ? fs[side] : { x: p.width * 0.5, y: p.height * 0.85 };
  const ball = new Ball(foot.x, foot.y, slotIdx);
  ball.attachedFoot = side;
  if (!side) { ball.attached = false; ball.vy = -8; } // no feet visible → just drop it
  balls.push(ball);
}

// ---- charge arc indicator --------------------------------------------------

function drawChargeArc(p, wristX, wristY, progress) {
  if (progress < 0.05) return;
  p.push();
  p.noFill();
  p.stroke(50, 90, 100, 0.7 * progress);
  p.strokeWeight(2.5);
  p.arc(wristX, wristY, 40, 40, -p.HALF_PI, -p.HALF_PI + p.TWO_PI * progress);
  p.noStroke();
  p.fill(50, 85, 100, 0.4 * progress);
  p.ellipse(wristX, wristY, 7, 7);
  p.pop();
}

// ---- foot markers (empty target rings) ------------------------------------

function drawFootMarkers(p) {
  footSlots.forEach((fs, slotIdx) => {
    ['left', 'right'].forEach(side => {
      const foot = fs[side];
      if (!foot.visible) return;
      if (balls.some(b => b.attached && b.slotIdx === slotIdx && b.attachedFoot === side)) return;

      p.push();
      p.noFill();
      p.stroke(BALL_HUES[slotIdx % BALL_HUES.length], 55, 90, 0.28);
      p.strokeWeight(1.2);
      p.drawingContext.setLineDash([3, 6]);
      p.ellipse(foot.x, foot.y, BALL_RADIUS * 2.4, BALL_RADIUS * 2.4);
      p.drawingContext.setLineDash([]);
      p.pop();
    });
  });
}

// ---- main update called from sketch.js ------------------------------------

function updateBalls(p) {
  if (!ballMode) return;

  const video = document.getElementById('video');
  const W = video.videoWidth  || 640;
  const H = video.videoHeight || 480;

  rawPoses.forEach((pose, slotIdx) => {
    if (slotIdx >= MAX_PEOPLE) return;
    const kp = pose.keypoints;
    const gs = gestureSlots[slotIdx];
    const fs = footSlots[slotIdx];

    updateFootState(kp, W, H, fs, p);

    // --- Gesture detection --------------------------------------------------
    gs.cooldown = Math.max(0, gs.cooldown - 1);

    const nose = kp[KP.NOSE];
    if (nose.score > 0.2) {
      const noseCanvasY = (nose.y / H) * p.height;

      [[kp[KP.L_WRIST], 'lFrames'], [kp[KP.R_WRIST], 'rFrames']].forEach(([wrist, key]) => {
        if (wrist.score < 0.25) { gs[key] = 0; return; }
        const wristCanvasY = (wrist.y / H) * p.height;

        if (wristCanvasY < noseCanvasY - 15) {  // wrist above nose in canvas space
          gs[key]++;
          if (gs[key] >= RAISE_HOLD_FRAMES && gs.cooldown === 0 && balls.length < MAX_BALLS) {
            spawnBall(p, slotIdx, fs);
            gs[key]   = 0;
            gs.cooldown = 100;
          }
        } else {
          gs[key] = 0;
        }
      });
    }

    // --- Kick / foot-follow -------------------------------------------------
    balls.forEach(ball => {
      if (!ball.attached || ball.slotIdx !== slotIdx) return;

      const foot = ball.attachedFoot ? fs[ball.attachedFoot] : null;

      if (!foot || !foot.visible) {
        // Foot lost → release
        ball.attached = false;
        ball.vy = -3;
        return;
      }

      // Sticky: follow foot with gentle wobble
      const wobble = Math.sin(p.millis() * 0.009) * 4;
      ball.x = foot.x + wobble;
      ball.y = foot.y - BALL_RADIUS * 0.3 + Math.abs(wobble) * 0.4;

      // Kick!
      if (foot.speed > KICK_SPEED_PX) {
        ball.attached = false;
        ball.vx = foot.vx * 1.1;
        ball.vy = foot.vy * 1.1;
        if (ball.vy > -3) ball.vy -= 6; // guarantee some upward arc
      }
    });
  });

  // Release orphaned attached balls if person disappears
  if (rawPoses.length === 0) {
    balls.forEach(b => { if (b.attached) { b.attached = false; b.vy = -3; } });
  }

  // Physics update + reap dead balls
  for (let i = balls.length - 1; i >= 0; i--) {
    balls[i].update(p);
    if (balls[i].dead) balls.splice(i, 1);
  }
}

function drawBalls(p) {
  if (!ballMode) return;
  drawFootMarkers(p);
  balls.forEach(b => b.draw(p));

  // Charge arcs above wrists
  const video = document.getElementById('video');
  const W = video.videoWidth  || 640;
  const H = video.videoHeight || 480;

  rawPoses.forEach((pose, slotIdx) => {
    if (slotIdx >= MAX_PEOPLE) return;
    const kp = pose.keypoints;
    const gs = gestureSlots[slotIdx];

    [[kp[KP.L_WRIST], 'lFrames'], [kp[KP.R_WRIST], 'rFrames']].forEach(([wrist, key]) => {
      if (wrist.score < 0.25 || gs[key] === 0) return;
      const wx = (1 - wrist.x / W) * p.width;
      const wy = (wrist.y / H)     * p.height;
      drawChargeArc(p, wx, wy, gs[key] / RAISE_HOLD_FRAMES);
    });
  });
}
