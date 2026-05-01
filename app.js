/**
 * MixMaster – app.js
 * Audio mixing training game using the Web Audio API.
 *
 * Architecture overview
 * ─────────────────────
 *  AudioContext
 *    └─ sourceNode (OscillatorNode × multiple, or BufferSourceNode)
 *         └─ lowFilter  (BiquadFilter shelf)
 *              └─ midFilter  (BiquadFilter peaking)
 *                   └─ highFilter (BiquadFilter shelf)
 *                        └─ pannerNode (StereoPannerNode)
 *                             └─ compressorNode (DynamicsCompressorNode)
 *                                  └─ gainNode  (GainNode – volume)
 *                                       └─ reverbNode (ConvolverNode)
 *                                            └─ reverbGain / dryGain (mix)
 *                                                 └─ analyser (AnalyserNode)
 *                                                      └─ destination
 */

'use strict';

/* ─────────────────────────────────────────────
   LEVEL DEFINITIONS
   Each level defines:
     label        – channel name shown on UI
     icon         – emoji
     mission      – task description
     hint         – tip shown in mission card
     target        – the "correct" mix values
     initialMix   – where the sliders start (the "problem" to fix)
     scoreThreshold – points needed to advance
   ───────────────────────────────────────────── */
const LEVELS = [
  {
    label: '🎤 Gesang',
    mission: 'Level 1 – Der schmutzige Gesang',
    hint: 'Der Gesang klingt dumpf und zu leise. Erhöhe die Höhen und passe die Lautstärke an!',
    target:     { high: 4,   mid: 1,  low: -3,  vol: 100, reverb: 10, comp: 40, pan: 0 },
    initialMix: { high: -8,  mid: 0,  low: 6,   vol: 70,  reverb: 0,  comp: 0,  pan: 0 },
    scoreThreshold: 70,
    synthConfig: { type: 'voice', baseFreq: 220 },
  },
  {
    label: '🎸 E-Gitarre',
    mission: 'Level 2 – Brutale Gitarre',
    hint: 'Die Gitarre übersteuert. Reduziere die Mitten und erhöhe den Kompressor!',
    target:     { high: 2,   mid: -5, low: 1,   vol: 90,  reverb: 15, comp: 60, pan: -20 },
    initialMix: { high: 0,   mid: 8,  low: 0,   vol: 110, reverb: 0,  comp: 0,  pan: 0 },
    scoreThreshold: 70,
    synthConfig: { type: 'guitar', baseFreq: 110 },
  },
  {
    label: '🥁 Schlagzeug',
    mission: 'Level 3 – Dünner Snare-Sound',
    hint: 'Der Snare klingt zu dünn. Erhöhe die Tiefen leicht und passe die Mitten an!',
    target:     { high: 3,   mid: 2,  low: 5,   vol: 95,  reverb: 5,  comp: 70, pan: 0 },
    initialMix: { high: 0,   mid: 0,  low: -10, vol: 100, reverb: 0,  comp: 0,  pan: 0 },
    scoreThreshold: 70,
    synthConfig: { type: 'drums', baseFreq: 60 },
  },
  {
    label: '🎹 Keyboard',
    mission: 'Level 4 – Schlammiges Keyboard',
    hint: 'Zu viel Bass macht den Klang schwammig. Kürze die Tiefen und gib etwas Reverb dazu!',
    target:     { high: 5,   mid: 0,  low: -7,  vol: 100, reverb: 30, comp: 30, pan: 20 },
    initialMix: { high: 0,   mid: 0,  low: 10,  vol: 120, reverb: 0,  comp: 0,  pan: 0 },
    scoreThreshold: 70,
    synthConfig: { type: 'keys', baseFreq: 261 },
  },
  {
    label: '🎤 Full-Band Mix',
    mission: 'Level 5 – Der perfekte Mix',
    hint: 'Alles klingt unausgewogen. Finde den goldenen Mix – achte auf alles!',
    target:     { high: 3,   mid: -2, low: 2,   vol: 100, reverb: 20, comp: 50, pan: 0 },
    initialMix: { high: -5,  mid: 5,  low: -5,  vol: 85,  reverb: 0,  comp: 0,  pan: 10 },
    scoreThreshold: 80,
    synthConfig: { type: 'full', baseFreq: 110 },
  },
];

/* ─────────────────────────────────────────────
   STATE
   ───────────────────────────────────────────── */
let ctx          = null;   // AudioContext – created on first user gesture
let currentLevel = 0;
let score        = 0;
let highscore    = parseInt(localStorage.getItem('mm_highscore') || '0', 10);
let isPlaying    = false;
let isRef        = false;
let animFrame    = null;

// Audio nodes (rebuilt each play)
let sourceNodes  = [];
let lowFilter, midFilter, highFilter;
let pannerNode, compressorNode, gainNode;
let dryGain, reverbGain, reverbNode;
let analyserNode;

/* ─────────────────────────────────────────────
   DOM REFS
   ───────────────────────────────────────────── */
const $ = (id) => document.getElementById(id);
const eqHigh    = $('eq-high');
const eqMid     = $('eq-mid');
const eqLow     = $('eq-low');
const faderVol  = $('fader-vol');
const fxReverb  = $('fx-reverb');
const fxComp    = $('fx-comp');
const fxPan     = $('fx-pan');
const canvas    = $('visualiser');
const canvasCtx = canvas.getContext('2d');

/* ─────────────────────────────────────────────
   AUDIO CONTEXT INITIALISATION
   ───────────────────────────────────────────── */
function initAudio() {
  if (ctx) return;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
}

/* ─────────────────────────────────────────────
   SYNTH BUILDER
   Generates a sound that resembles the given type
   using oscillators, noise, and filters.
   ───────────────────────────────────────────── */
function buildSynth(synthConfig) {
  const nodes = [];
  const merger = ctx.createChannelMerger(1);

  const addOsc = (type, freq, gain, detune = 0) => {
    const osc = ctx.createOscillator();
    const g   = ctx.createGain();
    osc.type      = type;
    osc.frequency.value = freq;
    osc.detune.value    = detune;
    g.gain.value  = gain;
    osc.connect(g);
    g.connect(merger);
    osc.start();
    nodes.push(osc);
  };

  const addNoise = (gainVal, hpFreq = 0) => {
    const bufLen = ctx.sampleRate * 2;
    const buffer = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const data   = buffer.getChannelData(0);
    for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;
    const src  = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop   = true;
    const g    = ctx.createGain();
    g.gain.value = gainVal;
    if (hpFreq > 0) {
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = hpFreq;
      src.connect(hp); hp.connect(g);
    } else {
      src.connect(g);
    }
    g.connect(merger);
    src.start();
    nodes.push(src);
  };

  switch (synthConfig.type) {
    case 'voice':
      // Simulate a sung note with harmonics + slight noise (breath)
      addOsc('sine',     synthConfig.baseFreq,       0.55);
      addOsc('sine',     synthConfig.baseFreq * 2,   0.20);
      addOsc('sine',     synthConfig.baseFreq * 3,   0.10);
      addOsc('sine',     synthConfig.baseFreq * 4,   0.06);
      addNoise(0.015, 2000);
      // Vibrato via LFO
      {
        const lfo = ctx.createOscillator();
        const lfoGain = ctx.createGain();
        lfo.frequency.value = 5.5;
        lfoGain.gain.value  = 5;
        lfo.connect(lfoGain);
        lfoGain.connect(nodes[0].frequency); // modulate fundamental
        lfo.start();
        nodes.push(lfo);
      }
      break;

    case 'guitar':
      addOsc('sawtooth', synthConfig.baseFreq,       0.35);
      addOsc('sawtooth', synthConfig.baseFreq * 2,   0.20, -5);
      addOsc('square',   synthConfig.baseFreq * 3,   0.10, 3);
      addNoise(0.04, 1000);
      break;

    case 'drums':
      addNoise(0.5, 200);   // snare noise
      addOsc('sine',  synthConfig.baseFreq,       0.6);  // kick body
      addOsc('triangle', synthConfig.baseFreq * 4, 0.25); // snare tone
      break;

    case 'keys':
      addOsc('sine',     synthConfig.baseFreq,       0.45);
      addOsc('sine',     synthConfig.baseFreq * 2,   0.25);
      addOsc('sine',     synthConfig.baseFreq * 4,   0.12);
      addOsc('triangle', synthConfig.baseFreq * 3,   0.08);
      break;

    default: // full band
      addOsc('sawtooth', synthConfig.baseFreq,       0.25);
      addOsc('sine',     synthConfig.baseFreq * 2,   0.20);
      addOsc('square',   synthConfig.baseFreq / 2,   0.20);
      addNoise(0.06, 800);
      break;
  }

  return { merger, nodes };
}

/* ─────────────────────────────────────────────
   IMPULSE RESPONSE for reverb (synthesised)
   ───────────────────────────────────────────── */
function makeImpulse(duration = 2, decay = 2) {
  const len  = ctx.sampleRate * duration;
  const buf  = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++)
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

/* ─────────────────────────────────────────────
   BUILD FULL AUDIO CHAIN
   ───────────────────────────────────────────── */
function buildChain(mix) {
  const { merger, nodes } = buildSynth(LEVELS[currentLevel].synthConfig);
  sourceNodes = nodes;

  // EQ filters
  lowFilter  = ctx.createBiquadFilter();
  lowFilter.type = 'lowshelf';
  lowFilter.frequency.value = 100;
  lowFilter.gain.value = mix.low;

  midFilter  = ctx.createBiquadFilter();
  midFilter.type = 'peaking';
  midFilter.frequency.value = 1000;
  midFilter.Q.value = 1;
  midFilter.gain.value = mix.mid;

  highFilter = ctx.createBiquadFilter();
  highFilter.type = 'highshelf';
  highFilter.frequency.value = 8000;
  highFilter.gain.value = mix.high;

  // Stereo panner
  pannerNode = ctx.createStereoPanner
    ? ctx.createStereoPanner()
    : (() => { const n = ctx.createPanner(); n.panningModel = 'equalpower'; return n; })();
  if (pannerNode.pan) pannerNode.pan.value = mix.pan / 100;

  // Compressor
  compressorNode = ctx.createDynamicsCompressor();
  compressorNode.threshold.value = -24 - mix.comp * 0.3;
  compressorNode.knee.value      = 10;
  compressorNode.ratio.value     = 1 + mix.comp / 20;
  compressorNode.attack.value    = 0.003;
  compressorNode.release.value   = 0.25;

  // Volume gain
  gainNode = ctx.createGain();
  gainNode.gain.value = mix.vol / 100;

  // Reverb
  reverbNode  = ctx.createConvolver();
  reverbNode.buffer = makeImpulse();
  reverbGain  = ctx.createGain();
  reverbGain.gain.value = mix.reverb / 100;
  dryGain     = ctx.createGain();
  dryGain.gain.value   = 1 - mix.reverb / 200;

  // Analyser
  analyserNode = ctx.createAnalyser();
  analyserNode.fftSize = 512;

  // Wire it all up
  merger
    .connect(lowFilter)
    .connect(midFilter)
    .connect(highFilter)
    .connect(pannerNode)
    .connect(compressorNode)
    .connect(gainNode);

  // Dry path
  gainNode.connect(dryGain);
  dryGain.connect(analyserNode);

  // Wet path
  gainNode.connect(reverbNode);
  reverbNode.connect(reverbGain);
  reverbGain.connect(analyserNode);

  analyserNode.connect(ctx.destination);
}

/* ─────────────────────────────────────────────
   APPLY CURRENT SLIDER VALUES to audio nodes
   ───────────────────────────────────────────── */
function applyMixToNodes() {
  if (!lowFilter) return;
  const t = ctx.currentTime;
  lowFilter.gain.setTargetAtTime(parseFloat(eqLow.value),   t, 0.02);
  midFilter.gain.setTargetAtTime(parseFloat(eqMid.value),   t, 0.02);
  highFilter.gain.setTargetAtTime(parseFloat(eqHigh.value), t, 0.02);
  gainNode.gain.setTargetAtTime(parseFloat(faderVol.value) / 100, t, 0.02);
  if (pannerNode.pan) pannerNode.pan.setTargetAtTime(parseFloat(fxPan.value) / 100, t, 0.02);
  const compVal = parseFloat(fxComp.value);
  compressorNode.threshold.setTargetAtTime(-24 - compVal * 0.3, t, 0.02);
  compressorNode.ratio.setTargetAtTime(1 + compVal / 20, t, 0.02);
  const revVal = parseFloat(fxReverb.value);
  reverbGain.gain.setTargetAtTime(revVal / 100,       t, 0.02);
  dryGain.gain.setTargetAtTime(1 - revVal / 200, t, 0.02);
}

/* ─────────────────────────────────────────────
   SET SLIDERS to a given mix object
   ───────────────────────────────────────────── */
function setSlidersTo(mix) {
  eqHigh.value   = mix.high;
  eqMid.value    = mix.mid;
  eqLow.value    = mix.low;
  faderVol.value = mix.vol;
  fxReverb.value = mix.reverb;
  fxComp.value   = mix.comp;
  fxPan.value    = mix.pan;
  updateAllBadges();
}

/* ─────────────────────────────────────────────
   STOP AUDIO
   ───────────────────────────────────────────── */
function stopAudio() {
  sourceNodes.forEach(n => {
    try { n.stop(); } catch (_) { /* already stopped */ }
  });
  sourceNodes = [];
  isPlaying = false;
  isRef = false;
  if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }
  drawIdle();
}

/* ─────────────────────────────────────────────
   PLAY – either reference or user mix
   ───────────────────────────────────────────── */
function playMix(mix, asReference = false) {
  initAudio();
  if (isPlaying) stopAudio();
  isRef = asReference;
  isPlaying = true;
  buildChain(mix);
  setSlidersTo(mix);
  applyMixToNodes();
  startVisualiser();

  // If reference: auto-stop after 5 s, then restore user sliders
  if (asReference) {
    $('btn-play-ref').disabled = true;
    const savedUser = readSliders();
    setTimeout(() => {
      stopAudio();
      setSlidersTo(savedUser);
      $('btn-play-ref').disabled = false;
    }, 5000);
  }
}

/* ─────────────────────────────────────────────
   READ CURRENT SLIDER VALUES
   ───────────────────────────────────────────── */
function readSliders() {
  return {
    high:   parseFloat(eqHigh.value),
    mid:    parseFloat(eqMid.value),
    low:    parseFloat(eqLow.value),
    vol:    parseFloat(faderVol.value),
    reverb: parseFloat(fxReverb.value),
    comp:   parseFloat(fxComp.value),
    pan:    parseFloat(fxPan.value),
  };
}

/* ─────────────────────────────────────────────
   SCORING
   Returns 0–100 based on how close user mix is to target.
   ───────────────────────────────────────────── */
function calcScore(user, target) {
  const weights = {
    high:   20,
    mid:    20,
    low:    20,
    vol:    20,
    reverb: 10,
    comp:   5,
    pan:    5,
  };
  const ranges = {
    high:   40,  // -20 to +20
    mid:    40,
    low:    40,
    vol:    150,
    reverb: 100,
    comp:   100,
    pan:    200,
  };
  let total = 0;
  let maxTotal = 0;
  for (const key of Object.keys(weights)) {
    const diff = Math.abs(user[key] - target[key]);
    const pct  = Math.max(0, 1 - diff / (ranges[key] / 2));
    total    += pct * weights[key];
    maxTotal += weights[key];
  }
  return Math.round((total / maxTotal) * 100);
}

/* ─────────────────────────────────────────────
   BREAKDOWN DETAILS for result overlay
   ───────────────────────────────────────────── */
function buildBreakdown(user, target) {
  const items = [
    { key: 'high',   label: 'Höhen',       unit: 'dB',  range: 40  },
    { key: 'mid',    label: 'Mitten',       unit: 'dB',  range: 40  },
    { key: 'low',    label: 'Tiefen',       unit: 'dB',  range: 40  },
    { key: 'vol',    label: 'Lautstärke',   unit: '%',   range: 150 },
    { key: 'reverb', label: 'Reverb',       unit: '%',   range: 100 },
    { key: 'comp',   label: 'Kompressor',   unit: '%',   range: 100 },
    { key: 'pan',    label: 'Panorama',     unit: '',    range: 200 },
  ];

  return items.map(it => {
    const diff = Math.abs(user[it.key] - target[it.key]);
    const pct  = Math.round(Math.max(0, 1 - diff / (it.range / 2)) * 100);
    const color = pct >= 80 ? '#39d353' : pct >= 50 ? '#f0c040' : '#e05252';
    return `
      <div class="breakdown-row">
        <span style="min-width:90px">${it.label}</span>
        <div class="breakdown-bar-bg">
          <div class="breakdown-bar" style="width:${pct}%;background:${color}"></div>
        </div>
        <span style="min-width:36px;text-align:right;color:${color}">${pct}%</span>
      </div>`;
  }).join('');
}

/* ─────────────────────────────────────────────
   SUBMIT
   ───────────────────────────────────────────── */
function submitMix() {
  stopAudio();
  const user   = readSliders();
  const target = LEVELS[currentLevel].target;
  const pct    = calcScore(user, target);

  // Update score
  score += pct;
  if (score > highscore) {
    highscore = score;
    localStorage.setItem('mm_highscore', highscore);
  }
  updateScoreUI();

  // Choose emoji & title
  let emoji, title, msg;
  if (pct >= 90) {
    emoji = '🏆'; title = 'Perfektion!';
    msg = `Unglaublich! Du bist ein echter Mix-Engineer. ${pct} von 100 Punkten!`;
  } else if (pct >= 75) {
    emoji = '🎉'; title = 'Super gemacht!';
    msg = `Großartig! Mit ${pct}/100 bist du fast am Ziel – weiter so!`;
  } else if (pct >= 55) {
    emoji = '👍'; title = 'Guter Ansatz!';
    msg = `${pct}/100 – schon nah dran. Hör dir den Referenz-Mix nochmal an und versuche es erneut!`;
  } else {
    emoji = '🔧'; title = 'Noch Übung nötig';
    msg = `${pct}/100 – kein Problem, Mix-Engineering braucht Praxis. Tipp: Höre zuerst die Referenz!`;
  }

  $('result-emoji').textContent   = emoji;
  $('result-title').textContent   = title;
  $('result-msg').textContent     = msg;
  $('result-breakdown').innerHTML = buildBreakdown(user, target);

  // Show / hide "next" button
  const passed = pct >= LEVELS[currentLevel].scoreThreshold;
  $('btn-next').style.display = passed ? '' : 'none';

  // Add retry button if not passing
  let retryBtn = document.getElementById('btn-retry');
  if (!passed) {
    if (!retryBtn) {
      retryBtn = document.createElement('button');
      retryBtn.id = 'btn-retry';
      retryBtn.className = 'btn btn-reset';
      retryBtn.textContent = '↺ Nochmal versuchen';
      retryBtn.style.marginTop = '.6rem';
      retryBtn.onclick = () => {
        $('result-overlay').classList.add('hidden');
      };
      const resultBox = $('result-box');
      if (resultBox) resultBox.appendChild(retryBtn);
    }
    retryBtn.style.display = '';
  } else if (retryBtn) {
    retryBtn.style.display = 'none';
  }

  $('result-overlay').classList.remove('hidden');
}

/* ─────────────────────────────────────────────
   LOAD LEVEL
   ───────────────────────────────────────────── */
function loadLevel(idx) {
  if (idx >= LEVELS.length) {
    showFinale();
    return;
  }
  currentLevel = idx;
  const lvl = LEVELS[idx];

  $('level-display').textContent  = idx + 1;
  $('mission-title').textContent  = lvl.mission;
  $('mission-desc').textContent   = lvl.hint;
  $('channel-label').textContent  = lvl.label;

  setSlidersTo(lvl.initialMix);
  stopAudio();
  $('result-overlay').classList.add('hidden');
}

/* ─────────────────────────────────────────────
   FINALE (all levels done)
   ───────────────────────────────────────────── */
function showFinale() {
  $('result-emoji').textContent   = '🎓';
  $('result-title').textContent   = 'Mix-Master abgeschlossen!';
  $('result-msg').textContent     = `Du hast alle Level bestanden! Gesamtpunktzahl: ${score}`;
  $('result-breakdown').innerHTML = '';
  $('btn-next').textContent       = '🔁 Von vorne';
  $('btn-next').onclick           = () => {
    currentLevel = 0;
    score = 0;
    updateScoreUI();
    loadLevel(0);
    $('result-overlay').classList.add('hidden');
    $('btn-next').textContent = 'Weiter ▶';
    $('btn-next').onclick     = onNextLevel;
  };
  $('result-overlay').classList.remove('hidden');
}

/* ─────────────────────────────────────────────
   NEXT LEVEL handler
   ───────────────────────────────────────────── */
function onNextLevel() {
  loadLevel(currentLevel + 1);
}

/* ─────────────────────────────────────────────
   SCORE UI
   ───────────────────────────────────────────── */
function updateScoreUI() {
  $('score-display').textContent     = score;
  $('highscore-display').textContent = highscore;
}

/* ─────────────────────────────────────────────
   VALUE BADGE UPDATES
   ───────────────────────────────────────────── */
function updateAllBadges() {
  $('eq-high-val').textContent  = formatDb(eqHigh.value);
  $('eq-mid-val').textContent   = formatDb(eqMid.value);
  $('eq-low-val').textContent   = formatDb(eqLow.value);
  $('fader-vol-val').textContent = `${faderVol.value} %`;
  $('fx-reverb-val').textContent = `${fxReverb.value} %`;
  $('fx-comp-val').textContent   = `${fxComp.value} %`;
  $('fx-pan-val').textContent    = formatPan(fxPan.value);
}

function formatDb(v) {
  const n = parseFloat(v);
  return (n >= 0 ? '+' : '') + n.toFixed(1) + ' dB';
}
function formatPan(v) {
  const n = parseInt(v, 10);
  if (n === 0) return 'C';
  return n < 0 ? `L${Math.abs(n)}` : `R${n}`;
}

/* ─────────────────────────────────────────────
   VISUALISER
   ───────────────────────────────────────────── */
function startVisualiser() {
  const w = canvas.width;
  const h = canvas.height;
  const bufLen = analyserNode.frequencyBinCount;
  const dataArr = new Uint8Array(bufLen);

  function draw() {
    animFrame = requestAnimationFrame(draw);
    analyserNode.getByteTimeDomainData(dataArr);

    canvasCtx.fillStyle = '#0a0c13';
    canvasCtx.fillRect(0, 0, w, h);

    // Waveform
    canvasCtx.lineWidth   = 2;
    canvasCtx.strokeStyle = isRef ? '#ff6584' : '#6c63ff';
    canvasCtx.shadowColor = isRef ? '#ff658466' : '#6c63ff88';
    canvasCtx.shadowBlur  = 8;
    canvasCtx.beginPath();

    const sliceW = w / bufLen;
    let x = 0;
    for (let i = 0; i < bufLen; i++) {
      const v = dataArr[i] / 128.0;
      const y = (v * h) / 2;
      i === 0 ? canvasCtx.moveTo(x, y) : canvasCtx.lineTo(x, y);
      x += sliceW;
    }
    canvasCtx.lineTo(w, h / 2);
    canvasCtx.stroke();
    canvasCtx.shadowBlur = 0;

    // VU meter
    let sum = 0;
    dataArr.forEach(v => { sum += Math.abs(v - 128); });
    const rms = sum / bufLen / 128;
    const meterW = Math.min(100, Math.round(rms * 300));
    $('meter-bar').style.width = meterW + '%';
  }
  draw();
}

function drawIdle() {
  const w = canvas.width;
  const h = canvas.height;
  canvasCtx.fillStyle = '#0a0c13';
  canvasCtx.fillRect(0, 0, w, h);
  canvasCtx.strokeStyle = '#2a2d3e';
  canvasCtx.lineWidth = 1.5;
  canvasCtx.beginPath();
  canvasCtx.moveTo(0, h / 2);
  canvasCtx.lineTo(w, h / 2);
  canvasCtx.stroke();
  $('meter-bar').style.width = '0%';
}

/* ─────────────────────────────────────────────
   SLIDER LIVE UPDATE while playing
   ───────────────────────────────────────────── */
function onSliderInput() {
  updateAllBadges();
  if (isPlaying && !isRef) applyMixToNodes();
}

/* ─────────────────────────────────────────────
   EVENT LISTENERS
   ───────────────────────────────────────────── */
[eqHigh, eqMid, eqLow, faderVol, fxReverb, fxComp, fxPan].forEach(el =>
  el.addEventListener('input', onSliderInput)
);

$('btn-play-track').addEventListener('click', () => {
  initAudio();
  if (isPlaying && !isRef) { stopAudio(); return; }
  const mix = readSliders();
  playMix(mix, false);
});

$('btn-play-ref').addEventListener('click', () => {
  const refMix = LEVELS[currentLevel].target;
  playMix(refMix, true);
});

$('btn-stop').addEventListener('click', stopAudio);

$('btn-submit').addEventListener('click', submitMix);

$('btn-reset').addEventListener('click', () => {
  stopAudio();
  setSlidersTo(LEVELS[currentLevel].initialMix);
});

$('btn-next').addEventListener('click', onNextLevel);

$('btn-start').addEventListener('click', () => {
  $('tutorial-overlay').style.display = 'none';
  loadLevel(0);
});

/* ─────────────────────────────────────────────
   INIT
   ───────────────────────────────────────────── */
updateScoreUI();
updateAllBadges();
drawIdle();
// Level is loaded after tutorial dismissal
