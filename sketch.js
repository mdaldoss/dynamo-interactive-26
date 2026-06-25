// Main p5.js sketch — the visual world of Drift

// ---- Debug -----------------------------------------------------------------

let debugMode = false;

function toggleDebug() {
  debugMode = !debugMode;
  const video = document.getElementById('video');
  video.classList.toggle('debug-visible', debugMode);
  updateHint();
}

function toggleBallMode() {
  ballMode = !ballMode;
  updateHint();
}

function updateHint() {
  const parts = ['D · debug' + (debugMode ? ' ✓' : '')];
  parts.push('B · ball' + (ballMode ? ' ✓' : ''));
  document.getElementById('debug-hint').textContent = parts.join('   ');
  document.getElementById('debug-hint').style.opacity = (debugMode || ballMode) ? '0.7' : '0.25';
}

// ---- Entity slots ----------------------------------------------------------
// Fixed pool of MAX_PEOPLE slots; each fades in/out independently.
// Person colours are stable: slot 0 = blue, 1 = magenta, 2 = yellow-green.

const SLOT_HUES = [200, 320, 85]; // one hue per person slot (MAX_PEOPLE defined in pose.js)

function makeSlot(p, idx) {
  return {
    x:         p.width  * 0.5,
    y:         p.height * 0.4,
    size:      40,
    hue:       SLOT_HUES[idx],
    prevX:     p.width  * 0.5,
    prevY:     p.height * 0.4,
    fadeAlpha: 0,          // 0 = invisible, 1 = fully present
  };
}

let slots = null; // initialised in p.setup

function updateSlot(p, slot, state) {
  let targetX, targetY;

  if (state) {
    targetX = state.x * p.width;
    targetY = state.y * p.height;
  } else {
    // mouse fallback only for slot 0
    targetX = p.mouseX;
    targetY = p.mouseY;
  }

  slot.prevX = slot.x;
  slot.prevY = slot.y;
  slot.x += (targetX - slot.x) * 0.07;
  slot.y += (targetY - slot.y) * 0.07;

  const span       = state ? (state.armSpan || 0) : 0;
  const targetSize = 30 + span * 55;
  slot.size += (targetSize - slot.size) * 0.06;

  const vel  = state ? (state.velocity || 0) : 0;
  slot.hue   = (slot.hue + vel * 400 + 0.05) % 360;

  return vel;
}

// ---- Draw entity -----------------------------------------------------------

function drawEntitySlot(p, slot, t) {
  const { x, y, size, hue, fadeAlpha } = slot;
  if (fadeAlpha < 0.01) return;

  p.noStroke();

  // Glow rings
  [3.5, 2.5, 1.8, 1.2].forEach((r, i) => {
    p.fill(hue, 50, 100, (0.03 + i * 0.01) * fadeAlpha);
    p.ellipse(x, y, size * r * 2, size * r * 2);
  });

  // Pulsing core
  const pulse = 1 + 0.08 * Math.sin(t * 2.5);
  p.fill(hue, 35, 100, 0.85 * fadeAlpha);
  p.ellipse(x, y, size * 0.65 * pulse, size * 0.65 * pulse);

  // Inner bright point
  p.fill(hue, 10, 100, fadeAlpha);
  p.ellipse(x, y, size * 0.22 * pulse, size * 0.22 * pulse);

  // Tentacles
  p.strokeWeight(1.2);
  p.noFill();
  for (let i = 0; i < 7; i++) {
    const angle = (i / 7) * p.TWO_PI + t * 0.4;
    const len   = size * (0.9 + 0.35 * Math.sin(t * 1.8 + i * 1.3));
    const sx    = x + Math.cos(angle) * size * 0.28;
    const sy    = y + Math.sin(angle) * size * 0.28;
    const ex    = x + Math.cos(angle) * len;
    const ey    = y + Math.sin(angle) * len;

    p.stroke(hue, 55, 90, 0.18 * fadeAlpha);
    p.beginShape();
    for (let s = 0; s <= 1; s += 0.08) {
      const wx = p.lerp(sx, ex, s) + Math.sin(t * 3.1 + s * 9   + i * 0.9) * size * 0.12;
      const wy = p.lerp(sy, ey, s) + Math.cos(t * 2.3 + s * 7.5 + i * 1.1) * size * 0.12;
      p.curveVertex(wx, wy);
    }
    p.endShape();
  }
}

// ---- Trail -----------------------------------------------------------------

const TRAIL_MAX = 90;
const trails    = [[], [], []]; // one trail per slot

function updateTrail(slotIdx, slot) {
  const t = trails[slotIdx];
  t.push({ x: slot.x, y: slot.y, size: slot.size, hue: slot.hue, age: 0, fa: slot.fadeAlpha });
  if (t.length > TRAIL_MAX) t.shift();
}

function drawTrails(p) {
  p.noStroke();
  for (const t of trails) {
    for (const pt of t) {
      pt.age++;
      const alpha = (1 - pt.age / TRAIL_MAX) * 0.22 * pt.fa;
      const s     = pt.size * (1 - pt.age / TRAIL_MAX) * 0.6;
      p.fill(pt.hue, 55, 90, alpha);
      p.ellipse(pt.x, pt.y, s, s);
    }
  }
}

// ---- Background motes ------------------------------------------------------

class Mote {
  constructor(p, fromEntity = false, ex = 0, ey = 0, hue = 200) {
    this.p = p;
    if (fromEntity) {
      this.x    = ex + p.random(-12, 12);
      this.y    = ey + p.random(-12, 12);
      this.vx   = p.random(-0.8, 0.8);
      this.vy   = p.random(-1.2, -0.2);
      this.size = p.random(2, 6);
      this.hue  = (hue + p.random(-20, 20) + 360) % 360;
      this.alpha = p.random(0.35, 0.7);
      this.decay = p.random(0.015, 0.035);
      this.life  = 1;
    } else {
      this.reset();
      this.y = p.random(p.height);
    }
  }

  reset() {
    const p   = this.p;
    this.x    = p.random(p.width);
    this.y    = p.height + p.random(20);
    this.vx   = p.random(-0.15, 0.15);
    this.vy   = p.random(-0.35, -0.08);
    this.size = p.random(1, 3.5);
    this.hue  = p.random(180, 260);
    this.alpha = p.random(0.08, 0.35);
    this.decay = p.random(0.0005, 0.0018);
    this.life  = 1;
  }

  update() { this.x += this.vx; this.y += this.vy; this.life -= this.decay; }

  draw() {
    const p = this.p;
    p.noStroke();
    p.fill(this.hue, 55, 90, this.alpha * Math.max(this.life, 0));
    p.ellipse(this.x, this.y, this.size, this.size);
  }

  isDead() { return this.life <= 0 || this.y < -10; }
}

// ---- Debug skeleton renderer -----------------------------------------------

// Map a raw keypoint (video px) to canvas coordinates, mirroring X to match
// how the entity is plotted (pose.js already mirrors X in bodyState).
function kpToCanvas(kp, video, p) {
  const W = video.videoWidth  || 640;
  const H = video.videoHeight || 480;
  return { x: (1 - kp.x / W) * p.width, y: (kp.y / H) * p.height, score: kp.score || 0 };
}

function drawDebugOverlay(p) {
  const video = document.getElementById('video');

  p.push();
  p.textFont('monospace');

  if (!rawPoses || rawPoses.length === 0) {
    p.noStroke();
    p.fill(0, 80, 100, 0.7);
    p.textSize(13);
    p.textAlign(p.CENTER);
    p.text('no pose detected', p.width * 0.5, 44);
    p.pop();
    return;
  }

  rawPoses.forEach((pose, pIdx) => {
    const kp  = pose.keypoints;
    const slotHue = SLOT_HUES[pIdx % SLOT_HUES.length];

    // Skeleton connections
    p.strokeWeight(1.5);
    p.noFill();
    for (const [a, b] of SKELETON_CONNECTIONS) {
      if (kp[a].score < 0.2 || kp[b].score < 0.2) continue;
      const pa = kpToCanvas(kp[a], video, p);
      const pb = kpToCanvas(kp[b], video, p);
      const alpha = Math.min(kp[a].score, kp[b].score);
      p.stroke(slotHue, 55, 90, alpha * 0.7);
      p.line(pa.x, pa.y, pb.x, pb.y);
    }

    // Keypoints — colour by confidence: green > yellow > orange
    p.noStroke();
    for (const k of kp) {
      if (k.score < 0.1) continue;
      const { x, y } = kpToCanvas(k, video, p);
      const dotHue   = k.score > 0.65 ? 120 : k.score > 0.35 ? 55 : 25;
      p.fill(dotHue, 85, 100, Math.min(k.score * 1.5, 1));
      p.ellipse(x, y, 4 + k.score * 5, 4 + k.score * 5);
    }

    // Person label above nose (or best keypoint)
    const anchor = kp[0].score > 0.2 ? kp[0] : kp.reduce((b, k) => k.score > b.score ? k : b, kp[0]);
    const { x: lx, y: ly } = kpToCanvas(anchor, video, p);
    p.noStroke();
    p.fill(slotHue, 60, 100, 0.85);
    p.textSize(11);
    p.textAlign(p.CENTER);
    p.text(`person ${pIdx + 1}`, lx, ly - 18);
  });

  // Stats strip at bottom-left
  p.noStroke();
  p.fill(0, 0, 100, 0.3);
  p.textSize(11);
  p.textAlign(p.LEFT);
  const n = rawPoses.length;
  p.text(`${n} person${n !== 1 ? 's' : ''} · multipose`, 16, p.height - 50);
  p.text(`[D] toggle debug`, 16, p.height - 34);

  p.pop();
}

// ---- Main sketch -----------------------------------------------------------

const BG_MOTE_COUNT = 280;
const MOTE_CAP      = 700;

new p5(function(p) {
  let motes   = [];
  let started = false;

  const startScreen = document.getElementById('start-screen');

  function begin() {
    if (started) return;
    started = true;
    startScreen.style.opacity = '0';
    setTimeout(() => { startScreen.style.display = 'none'; }, 1600);
    startAudio();
  }

  p.setup = function() {
    const cnv = p.createCanvas(p.windowWidth, p.windowHeight);
    cnv.mousePressed(begin);

    p.colorMode(p.HSB, 360, 100, 100, 1);

    slots = Array.from({ length: MAX_PEOPLE }, (_, i) => makeSlot(p, i));

    for (let i = 0; i < BG_MOTE_COUNT; i++) motes.push(new Mote(p));

    updateHint();
    document.getElementById('debug-hint').style.opacity = '0.25';
  };

  p.draw = function() {
    if (!started) { p.background(220, 25, 3); return; }

    const t = p.millis() * 0.001;

    p.background(220, 28, 3, 0.18);

    // Slow ambient hue wash
    p.noStroke();
    p.fill(215 + 10 * Math.sin(t * 0.15), 20, 8, 0.04);
    p.rect(0, 0, p.width, p.height);

    // Background motes
    for (let i = motes.length - 1; i >= 0; i--) {
      const m = motes[i];
      m.update(); m.draw();
      if (m.isDead()) {
        if (motes.length <= BG_MOTE_COUNT) motes[i] = new Mote(p);
        else motes.splice(i, 1);
      }
    }
    while (motes.length < BG_MOTE_COUNT) motes.push(new Mote(p));

    // Trails then entities
    drawTrails(p);

    let totalVel = 0;
    let totalSpan = 0;

    for (let i = 0; i < MAX_PEOPLE; i++) {
      const slot  = slots[i];
      const state = bodyStates[i];

      // Decide whether this slot should be visible
      const shouldBePresent = (state != null) || (i === 0 && !bodyState.ready);
      slot.fadeAlpha += ((shouldBePresent ? 1 : 0) - slot.fadeAlpha) * 0.04;

      if (slot.fadeAlpha < 0.01) continue;

      const vel = updateSlot(p, slot, state || null);
      updateTrail(i, slot);
      drawEntitySlot(p, slot, t);

      // Burst motes on fast movement
      if (vel > 0.003 && motes.length < MOTE_CAP) {
        const n = Math.min(Math.floor(vel * 200), 6);
        for (let j = 0; j < n; j++) motes.push(new Mote(p, true, slot.x, slot.y, slot.hue));
      }

      totalVel  = Math.max(totalVel,  vel);
      totalSpan = Math.max(totalSpan, state ? (state.armSpan || 0) : 0);
    }

    updateAudio(totalVel, totalSpan);

    // Ball mode — update physics then draw (before debug so debug is always on top)
    updateBalls(p);
    drawBalls(p);

    if (debugMode) drawDebugOverlay(p);
  };

  p.keyPressed = function() {
    if (p.key === ' ' || p.key === 'Enter') { begin(); return; }
    if (p.key === 'd' || p.key === 'D')     { toggleDebug(); return; }
    if (p.key === 'b' || p.key === 'B')     { toggleBallMode(); }
  };

  p.mousePressed = function(e) {
    if (e && e.target && e.target.closest('#camera-controls')) return;
    begin();
  };

  p.windowResized = function() { p.resizeCanvas(p.windowWidth, p.windowHeight); };
});
