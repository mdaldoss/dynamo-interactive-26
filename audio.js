// Ambient generative audio — deep drone that responds to movement
// Must be started after a user gesture (browser policy)

let audioCtx = null;
let audioNodes = null;

function startAudio() {
  if (audioCtx) return;

  audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  const masterGain = audioCtx.createGain();
  masterGain.gain.value = 0.0;
  masterGain.connect(audioCtx.destination);

  // Fade in slowly
  masterGain.gain.setTargetAtTime(0.6, audioCtx.currentTime + 1, 3.0);

  // Reverb via convolver (simple impulse response approximation using two delays)
  function makeReverb(duration = 2.5, decay = 2.0) {
    const rate   = audioCtx.sampleRate;
    const length = rate * duration;
    const impulse = audioCtx.createBuffer(2, length, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = impulse.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
      }
    }
    const conv = audioCtx.createConvolver();
    conv.buffer = impulse;
    return conv;
  }

  const reverb    = makeReverb();
  const reverbGain = audioCtx.createGain();
  reverbGain.gain.value = 0.5;
  reverb.connect(reverbGain);
  reverbGain.connect(masterGain);

  // Three-layer drone: root, fifth, octave — slightly detuned for beating effect
  const layers = [
    { freq: 55.0,   detune:  0, gainVal: 0.5, type: 'sine'     },  // A1 root
    { freq: 55.2,   detune:  0, gainVal: 0.3, type: 'sine'     },  // A1 + beating
    { freq: 82.5,   detune: -3, gainVal: 0.3, type: 'sine'     },  // E2 fifth
    { freq: 110.0,  detune:  0, gainVal: 0.2, type: 'triangle' },  // A2 octave
  ];

  const oscillators = layers.map(({ freq, detune, gainVal, type }) => {
    const osc    = audioCtx.createOscillator();
    const gain   = audioCtx.createGain();
    const filter = audioCtx.createBiquadFilter();

    osc.type              = type;
    osc.frequency.value   = freq;
    osc.detune.value      = detune;
    gain.gain.value       = gainVal * 0.05;
    filter.type           = 'lowpass';
    filter.frequency.value = 300;
    filter.Q.value        = 1;

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(masterGain);
    gain.connect(reverb);
    osc.start();

    return { osc, gain, filter };
  });

  // Slow LFO on master pitch feel (subtle amplitude modulation)
  const lfo = audioCtx.createOscillator();
  const lfoGain = audioCtx.createGain();
  lfo.frequency.value  = 0.07;
  lfoGain.gain.value   = 0.015;
  lfo.connect(lfoGain);
  lfoGain.connect(masterGain.gain);
  lfo.start();

  audioNodes = { oscillators, masterGain };
}

let lastAudioTime = 0;

function updateAudio(velocity, armSpan) {
  if (!audioNodes || !audioCtx) return;

  const now = audioCtx.currentTime;
  if (now - lastAudioTime < 0.08) return;
  lastAudioTime = now;

  audioNodes.oscillators.forEach(({ gain, filter }, i) => {
    const baseGain = [0.5, 0.3, 0.3, 0.2][i] * 0.05;

    // Movement boosts gain and opens the filter
    const velBoost    = Math.min(velocity * 8, 0.06);
    const spanBoost   = armSpan * 0.02;
    const targetGain  = Math.min(baseGain + velBoost + spanBoost, 0.12);
    const targetFreq  = 200 + armSpan * 600 + velocity * 3000;

    gain.gain.setTargetAtTime(targetGain, now, 0.4);
    filter.frequency.setTargetAtTime(Math.min(targetFreq, 2000), now, 0.3);
  });
}
