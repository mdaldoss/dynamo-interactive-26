// Body tracking via TensorFlow.js MoveNet (multipose)
//
// Exports:
//   bodyState   — first person (or default), backward-compat with sketch.js
//   bodyStates  — array, one entry per detected person (up to MAX_PEOPLE)
//   rawPoses    — raw MoveNet output, used by the debug skeleton renderer

const MAX_PEOPLE = 3;

// Shared state objects — sketch.js reads these every frame
const bodyState = { x: 0.5, y: 0.4, armSpan: 0, velocity: 0, ready: false };
const bodyStates = [];  // populated with up to MAX_PEOPLE entries
let   rawPoses   = [];  // raw poseDetection output (keypoints in video px)

// MoveNet keypoint indices
const KP = { NOSE:0, L_EYE:1, R_EYE:2, L_EAR:3, R_EAR:4,
             L_SHOULDER:5, R_SHOULDER:6, L_ELBOW:7, R_ELBOW:8,
             L_WRIST:9, R_WRIST:10, L_HIP:11, R_HIP:12,
             L_KNEE:13, R_KNEE:14, L_ANKLE:15, R_ANKLE:16 };

// Skeleton edges — used by the debug renderer in sketch.js
const SKELETON_CONNECTIONS = [
  [KP.NOSE, KP.L_EYE], [KP.NOSE, KP.R_EYE],
  [KP.L_EYE, KP.L_EAR], [KP.R_EYE, KP.R_EAR],
  [KP.L_SHOULDER, KP.R_SHOULDER],
  [KP.L_SHOULDER, KP.L_ELBOW], [KP.L_ELBOW, KP.L_WRIST],
  [KP.R_SHOULDER, KP.R_ELBOW], [KP.R_ELBOW, KP.R_WRIST],
  [KP.L_SHOULDER, KP.L_HIP],  [KP.R_SHOULDER, KP.R_HIP],
  [KP.L_HIP,      KP.R_HIP],
  [KP.L_HIP,  KP.L_KNEE], [KP.L_KNEE, KP.L_ANKLE],
  [KP.R_HIP,  KP.R_KNEE], [KP.R_KNEE, KP.R_ANKLE],
];

// ---------- helpers ---------------------------------------------------------

// Convert one pose's keypoints to a normalised body state.
// `prev` is the previous state for this person slot (for smoothing + velocity).
// Returns null if no keypoint is reliable enough to anchor a position.
function poseToBodyState(kp, W, H, prev) {
  // Position anchor: prefer nose → shoulder midpoint → hip midpoint → best single kp
  let rawX, rawY;

  if (kp[KP.NOSE].score > 0.25) {
    rawX = 1 - kp[KP.NOSE].x / W;
    rawY = kp[KP.NOSE].y / H;

  } else if (kp[KP.L_SHOULDER].score > 0.25 && kp[KP.R_SHOULDER].score > 0.25) {
    rawX = 1 - ((kp[KP.L_SHOULDER].x + kp[KP.R_SHOULDER].x) * 0.5) / W;
    rawY = ((kp[KP.L_SHOULDER].y + kp[KP.R_SHOULDER].y) * 0.5) / H;

  } else if (kp[KP.L_HIP].score > 0.25 && kp[KP.R_HIP].score > 0.25) {
    rawX = 1 - ((kp[KP.L_HIP].x + kp[KP.R_HIP].x) * 0.5) / W;
    rawY = ((kp[KP.L_HIP].y + kp[KP.R_HIP].y) * 0.5) / H;

  } else {
    // Last resort: any keypoint above a low threshold
    const best = kp.reduce((b, k) => (k.score > b.score ? k : b), { score: 0 });
    if (best.score < 0.2) return null; // nothing usable
    rawX = 1 - best.x / W;
    rawY = best.y / H;
  }

  // Reuse existing state object for smooth interpolation
  const s = prev || {
    x: rawX, y: rawY, armSpan: 0, velocity: 0,
    ready: false, _prevX: rawX, _prevY: rawY,
  };

  const alpha = 0.18;
  s.x += (rawX - s.x) * alpha;
  s.y += (rawY - s.y) * alpha;

  const dx = s.x - s._prevX;
  const dy = s.y - s._prevY;
  s.velocity = Math.sqrt(dx * dx + dy * dy);
  s._prevX = s.x;
  s._prevY = s.y;

  // Arm span: wrist distance relative to shoulder width
  // Falls back gracefully when wrists/shoulders are off-screen
  const lW = kp[KP.L_WRIST], rW = kp[KP.R_WRIST];
  const lS = kp[KP.L_SHOULDER], rS = kp[KP.R_SHOULDER];
  if (lW.score > 0.25 && rW.score > 0.25 && lS.score > 0.25 && rS.score > 0.25) {
    const wristSpan    = Math.abs(rW.x - lW.x) / W;
    const shoulderSpan = Math.abs(rS.x - lS.x) / W;
    const normalised   = shoulderSpan > 0.01
      ? Math.min(wristSpan / (shoulderSpan * 3), 1)
      : 0;
    s.armSpan += (normalised - s.armSpan) * 0.1;
  }
  // If arms not visible, armSpan slowly decays to neutral
  else {
    s.armSpan += (0.3 - s.armSpan) * 0.02;
  }

  s.ready = true;
  return s;
}

// ---------- init ------------------------------------------------------------

(async function initPose() {
  const video  = document.getElementById('video');
  const status = document.getElementById('status');

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
    });
    video.srcObject = stream;
    await new Promise(resolve => { video.onloadedmetadata = resolve; });
    await video.play();

    await tf.ready();

    const detector = await poseDetection.createDetector(
      poseDetection.SupportedModels.MoveNet,
      { modelType: poseDetection.movenet.modelType.MULTIPOSE_LIGHTNING }
    );

    status.textContent = 'move your body';
    setTimeout(() => { status.style.opacity = '0'; }, 4000);

    // Persist state objects across frames (one slot per person index)
    const stateSlots = [];

    async function loop() {
      try {
        const poses = await detector.estimatePoses(video, { maxPoses: MAX_PEOPLE });
        rawPoses = poses;

        const W = video.videoWidth  || 640;
        const H = video.videoHeight || 480;

        // Build/update bodyStates array
        bodyStates.length = 0;
        for (let i = 0; i < Math.min(poses.length, MAX_PEOPLE); i++) {
          const updated = poseToBodyState(poses[i].keypoints, W, H, stateSlots[i]);
          if (updated) {
            stateSlots[i] = updated;
            bodyStates.push(updated);
          }
        }
        // Clear stale state slots beyond current detections
        stateSlots.length = bodyStates.length;

        // Update legacy single bodyState for backward compat
        if (bodyStates.length > 0) {
          Object.assign(bodyState, bodyStates[0]);
        } else {
          bodyState.ready = false;
        }
      } catch (_) {}

      requestAnimationFrame(loop);
    }

    loop();

  } catch (_) {
    status.textContent = 'no camera — using mouse';
    setTimeout(() => { status.style.opacity = '0'; }, 3000);
  }
}());
