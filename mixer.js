/**
 * Live Mischpult – mixer.js
 * Real-time multi-channel audio mixer using the Web Audio API.
 *
 * Architecture per channel:
 *   source (OscillatorNode | MediaStreamSource | silent)
 *     └─ gainNode (channel volume)
 *          └─ muteGain (0 when muted, unless solo active)
 *               └─ masterGain
 *                    └─ analyserL / analyserR (stereo split)
 *                         └─ destination
 */

'use strict';

/* ─────────────────────────────────────────────
   CHANNEL DEFINITIONS
   ───────────────────────────────────────────── */
const CHANNEL_DEFS = [
  { name: 'Gitarre',   icon: '🎸', color: '#ff8844', defaultType: 'guitar'  },
  { name: 'Bass',      icon: '🎸', color: '#aa66ff', defaultType: 'bass'    },
  { name: 'Drums',     icon: '🥁', color: '#ff4466', defaultType: 'drums'   },
  { name: 'Keys',      icon: '🎹', color: '#44aaff', defaultType: 'keys'    },
  { name: 'Sänger 1',  icon: '🎤', color: '#44ffaa', defaultType: 'mic'     },
  { name: 'Sänger 2',  icon: '🎤', color: '#66ff66', defaultType: 'synth'   },
  { name: 'Trompete',  icon: '🎺', color: '#ffdd44', defaultType: 'brass'   },
  { name: 'Streicher', icon: '🎻', color: '#ff66bb', defaultType: 'strings' },
  { name: 'FX / Pad',  icon: '🌊', color: '#44ddff', defaultType: 'pad'     },
];

/* Oscillator configs per type (frequency sets for chord) */
const SOURCE_CONFIGS = {
  guitar:  { freqs: [82, 110, 165, 220],       type: 'sawtooth', lfo: true  },
  bass:    { freqs: [41, 55],                  type: 'sawtooth', lfo: false },
  drums:   { freqs: [60, 90],                  type: 'square',   lfo: true,  isNoise: true },
  keys:    { freqs: [261, 329, 392, 523],      type: 'sine',     lfo: false },
  mic:     { freqs: [440, 554, 659],           type: 'triangle', lfo: false },
  synth:   { freqs: [220, 277, 330, 440],      type: 'sawtooth', lfo: true  },
  brass:   { freqs: [233, 311, 466],           type: 'sawtooth', lfo: false },
  strings: { freqs: [196, 247, 294, 370, 440], type: 'sawtooth', lfo: true  },
  pad:     { freqs: [130, 164, 196, 261],      type: 'sine',     lfo: true  },
  none:    null,
  mic_input: null, // live microphone
};

/* ─────────────────────────────────────────────
   STATE
   ───────────────────────────────────────────── */
let ctx = null;
let masterGainNode = null;
let masterMuteNode = null;
let splitterNode   = null;
let analyserL      = null;
let analyserR      = null;
let micStream      = null;
let micSourceNode  = null;
let audioStarted   = false;
let animFrameId    = null;

/* Per-channel state objects */
const channels = [];

/* LED count for meters */
const CH_LEDS  = 20;
const MST_LEDS = 24;

/* ─────────────────────────────────────────────
   DOM HELPERS
   ───────────────────────────────────────────── */
const $  = (id) => document.getElementById(id);
const el = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };

/* ─────────────────────────────────────────────
   BUILD METER LEDS
   ───────────────────────────────────────────── */
function buildLeds(container, count) {
  container.innerHTML = '';
  const leds = [];
  for (let i = 0; i < count; i++) {
    const led = el('div', 'peak-led');
    // top ~15% = red, next ~20% = yellow, rest = green
    const pct = (count - 1 - i) / (count - 1); // 0=bottom, 1=top
    if      (pct >= 0.85) led.dataset.zone = 'red';
    else if (pct >= 0.65) led.dataset.zone = 'yellow';
    else                   led.dataset.zone = 'green';
    container.appendChild(led);
    leds.push(led);
  }
  return leds; // index 0 = bottom
}

/* ─────────────────────────────────────────────
   BUILD CHANNEL STRIP HTML
   ───────────────────────────────────────────── */
function buildChannelStrip(def, index) {
  const strip = el('div', 'channel');
  strip.id = `ch-${index}`;

  // ── Top section ──
  const top = el('div', 'channel-top');

  // Input selector
  const sel = el('select', 'input-selector');
  sel.id = `ch-sel-${index}`;
  const sourceOptions = [
    { value: 'none',      label: '— Aus' },
    { value: 'guitar',    label: '🎸 Gitarre' },
    { value: 'bass',      label: '🎸 Bass' },
    { value: 'drums',     label: '🥁 Drums' },
    { value: 'keys',      label: '🎹 Keys' },
    { value: 'synth',     label: '🎛️ Synth' },
    { value: 'brass',     label: '🎺 Blech' },
    { value: 'strings',   label: '🎻 Streicher' },
    { value: 'pad',       label: '🌊 Pad' },
    { value: 'mic_input', label: '🎙️ Mikrofon' },
  ];
  sourceOptions.forEach(opt => {
    const o = el('option');
    o.value = opt.value;
    o.textContent = opt.label;
    if (opt.value === def.defaultType) o.selected = true;
    sel.appendChild(o);
  });
  top.appendChild(sel);

  // Channel name
  const nameEl = el('div', 'channel-name');
  nameEl.textContent = def.name;
  nameEl.style.color = def.color;
  top.appendChild(nameEl);
  strip.appendChild(top);

  // ── Peak meter ──
  const meter = el('div', 'peak-meter');
  meter.id = `ch-meter-${index}`;
  strip.appendChild(meter);

  // ── Fader section ──
  const faderSec = el('div', 'fader-section');
  const track = el('div', 'fader-track');
  const faderIn = el('input', 'fader-input');
  faderIn.type = 'range';
  faderIn.id   = `ch-fader-${index}`;
  faderIn.setAttribute('orient', 'vertical');
  faderIn.min   = '0';
  faderIn.max   = '120';
  faderIn.step  = '1';
  faderIn.value = '80';
  track.appendChild(faderIn);
  faderSec.appendChild(track);

  const dbLabel = el('div', 'fader-db-label');
  dbLabel.id = `ch-db-${index}`;
  dbLabel.textContent = volToDb(80);
  faderSec.appendChild(dbLabel);
  strip.appendChild(faderSec);

  // ── Mute / Solo buttons ──
  const btns = el('div', 'channel-btns');
  const muteBtn = el('button', 'btn-mute');
  muteBtn.id = `ch-mute-${index}`;
  muteBtn.textContent = 'MUTE';
  const soloBtn = el('button', 'btn-solo');
  soloBtn.id = `ch-solo-${index}`;
  soloBtn.textContent = 'SOLO';
  btns.appendChild(muteBtn);
  btns.appendChild(soloBtn);
  strip.appendChild(btns);

  return strip;
}

/* ─────────────────────────────────────────────
   VOLUME ↔ dB conversion
   ───────────────────────────────────────────── */
function faderToGain(val) {
  // 0-120 range: 0=silence, 100=0dB, 120=+3.5dB
  if (val === 0) return 0;
  return Math.pow(val / 100, 2);
}

function volToDb(val) {
  if (val === 0) return '-∞ dB';
  const db = 20 * Math.log10(faderToGain(val));
  if (db >= 0) return `+${db.toFixed(1)} dB`;
  return `${db.toFixed(1)} dB`;
}

/* ─────────────────────────────────────────────
   AUDIO CONTEXT INIT
   ───────────────────────────────────────────── */
async function initAudioContext() {
  if (ctx) return;
  ctx = new (window.AudioContext || window.webkitAudioContext)();

  // Master chain: masterMute → masterGain → splitter → analysers → destination
  masterMuteNode = ctx.createGain();
  masterMuteNode.gain.value = 1;

  masterGainNode = ctx.createGain();
  masterGainNode.gain.value = faderToGain(100);
  masterMuteNode.connect(masterGainNode);

  splitterNode = ctx.createChannelSplitter(2);
  masterGainNode.connect(splitterNode);

  analyserL = ctx.createAnalyser();
  analyserL.fftSize = 256;
  analyserR = ctx.createAnalyser();
  analyserR.fftSize = 256;

  splitterNode.connect(analyserL, 0);
  splitterNode.connect(analyserR, 1);

  const mergerNode = ctx.createChannelMerger(2);
  analyserL.connect(mergerNode, 0, 0);
  analyserR.connect(mergerNode, 0, 1);
  mergerNode.connect(ctx.destination);

  // Build per-channel audio nodes
  channels.forEach((ch, i) => initChannelAudio(ch, i));
}

/* ─────────────────────────────────────────────
   PER-CHANNEL AUDIO INIT
   ───────────────────────────────────────────── */
function initChannelAudio(ch, index) {
  // Gain chain: sourceNode(s) → channelGain → channelMute → masterMute
  ch.gainNode = ctx.createGain();
  ch.gainNode.gain.value = faderToGain(ch.faderVal);

  ch.muteNode = ctx.createGain();
  ch.muteNode.gain.value = 1;
  ch.gainNode.connect(ch.muteNode);
  ch.muteNode.connect(masterMuteNode);

  // Per-channel analyser for peak meter
  ch.analyser = ctx.createAnalyser();
  ch.analyser.fftSize = 256;
  ch.gainNode.connect(ch.analyser);

  startChannelSource(ch);
}

/* ─────────────────────────────────────────────
   SOURCE MANAGEMENT
   ───────────────────────────────────────────── */
function startChannelSource(ch) {
  stopChannelSource(ch);

  const type = ch.inputType;
  const cfg  = SOURCE_CONFIGS[type];
  if (!cfg) return; // none or mic_input handled separately

  if (type === 'mic_input') {
    connectMicToChannel(ch);
    return;
  }

  ch.oscNodes = [];
  ch.lfoNode  = null;

  // Create oscillators (one per frequency)
  cfg.freqs.forEach(freq => {
    const osc = ctx.createOscillator();
    osc.type = cfg.type;
    osc.frequency.value = freq;

    // slight detune (±4 cents) for richness / ensemble effect
    osc.detune.value = (Math.random() - 0.5) * 8;

    if (cfg.isNoise) {
      // noise-like: add random freq modulation
      const noiseOsc = ctx.createOscillator();
      noiseOsc.type = 'square';
      noiseOsc.frequency.value = freq * 0.5;
      const noiseGain = ctx.createGain();
      noiseGain.gain.value = 0.15;
      noiseOsc.connect(noiseGain);
      noiseGain.connect(osc.frequency);
      noiseOsc.start();
      ch.oscNodes.push(noiseOsc);
    }

    // Divide gain equally across oscillators to prevent clipping when combined
    const oscGain = ctx.createGain();
    oscGain.gain.value = 0.25 / cfg.freqs.length;
    osc.connect(oscGain);
    oscGain.connect(ch.gainNode);

    osc.start();
    ch.oscNodes.push(osc, oscGain);
  });

  // LFO for tremolo / vibrato effect (0.8–2.3 Hz for natural modulation)
  if (cfg.lfo) {
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.8 + Math.random() * 1.5;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.03; // subtle tremolo depth
    lfo.connect(lfoGain);
    lfoGain.connect(ch.gainNode.gain);
    lfo.start();
    ch.lfoNode = lfo;
    ch.oscNodes.push(lfoGain);
  }
}

function stopChannelSource(ch) {
  if (ch.oscNodes) {
    ch.oscNodes.forEach(n => { try { n.stop(); } catch(_){} try { n.disconnect(); } catch(_){} });
    ch.oscNodes = [];
  }
  if (ch.lfoNode) {
    try { ch.lfoNode.stop(); } catch(_){}
    try { ch.lfoNode.disconnect(); } catch(_){}
    ch.lfoNode = null;
  }
  if (ch.micSource) {
    try { ch.micSource.disconnect(); } catch(_){}
    ch.micSource = null;
  }
}

async function connectMicToChannel(ch) {
  try {
    if (!micStream) {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    }
    ch.micSource = ctx.createMediaStreamSource(micStream);
    ch.micSource.connect(ch.gainNode);
  } catch(e) {
    $('mic-notice').classList.remove('hidden');
    // fall back to synth
    ch.inputType = 'synth';
    $(`ch-sel-${ch.index}`).value = 'synth';
    startChannelSource(ch);
  }
}

/* ─────────────────────────────────────────────
   MUTE / SOLO LOGIC
   ───────────────────────────────────────────── */
function updateMuteGains() {
  const anySolo = channels.some(c => c.solo);
  channels.forEach(ch => {
    let shouldHear = true;
    if (anySolo) shouldHear = ch.solo;
    else         shouldHear = !ch.muted;
    ch.muteNode.gain.setTargetAtTime(shouldHear ? 1 : 0, ctx.currentTime, 0.01);

    // Visual
    const strip = $(`ch-${ch.index}`);
    strip.classList.toggle('muted', !shouldHear);
    strip.classList.toggle('soloed', ch.solo);
  });
}

/* ─────────────────────────────────────────────
   LEVEL METERING
   ───────────────────────────────────────────── */
const pcmBuf = new Uint8Array(256);

function rmsFromAnalyser(analyser) {
  analyser.getByteTimeDomainData(pcmBuf);
  let sum = 0;
  for (let i = 0; i < analyser.fftSize; i++) {
    const v = (pcmBuf[i] - 128) / 128;
    sum += v * v;
  }
  return Math.sqrt(sum / analyser.fftSize);
}

function updateMeter(leds, rms, peak) {
  // Scale RMS to LED count (×3.5 maps typical speech/music RMS to full meter)
  const level = Math.min(1, rms * 3.5);
  const lit = Math.round(level * leds.length);
  leds.forEach((led, i) => {
    led.classList.toggle('lit', i < lit);
  });
}

function animLoop() {
  animFrameId = requestAnimationFrame(animLoop);

  // Channel meters
  channels.forEach(ch => {
    if (!ch.analyser || !ch.leds) return;
    const rms = rmsFromAnalyser(ch.analyser);
    // Decay factor 0.92 per frame (~60 fps) gives a smooth ~0.3 s peak fallback
    ch.peakRms = Math.max(ch.peakRms * 0.92, rms);
    updateMeter(ch.leds, ch.peakRms);
  });

  // Master meters
  if (analyserL && analyserR) {
    const rmsL = rmsFromAnalyser(analyserL);
    const rmsR = rmsFromAnalyser(analyserR);
    masterState.peakL = Math.max(masterState.peakL * 0.92, rmsL);
    masterState.peakR = Math.max(masterState.peakR * 0.92, rmsR);
    updateMeter(masterState.ledsL, masterState.peakL);
    updateMeter(masterState.ledsR, masterState.peakR);

    // Clip indicator: RMS >= 0.9 indicates near-digital-full (clipping risk)
    const clipping = masterState.peakL > 0.9 || masterState.peakR > 0.9;
    $('clip-led').classList.toggle('active', clipping);
    if (clipping) masterState.clipTimeout = Date.now() + 1500; // hold for 1.5 s
    if (Date.now() < masterState.clipTimeout) $('clip-led').classList.add('active');
  }
}

const masterState = { peakL: 0, peakR: 0, ledsL: [], ledsR: [], clipTimeout: 0 };

/* ─────────────────────────────────────────────
   INITIALISE UI & EVENT LISTENERS
   ───────────────────────────────────────────── */
function buildUI() {
  const container = $('channels');

  CHANNEL_DEFS.forEach((def, i) => {
    const strip = buildChannelStrip(def, i);
    container.appendChild(strip);

    const ch = {
      index:     i,
      def,
      inputType: def.defaultType,
      faderVal:  80,
      muted:     false,
      solo:      false,
      peakRms:   0,
      gainNode:  null,
      muteNode:  null,
      analyser:  null,
      oscNodes:  [],
      lfoNode:   null,
      micSource: null,
      leds:      [],
    };
    channels.push(ch);

    // Build LEDs
    const meterEl = $(`ch-meter-${i}`);
    ch.leds = buildLeds(meterEl, CH_LEDS);

    // Fader event
    $(`ch-fader-${i}`).addEventListener('input', e => {
      ch.faderVal = parseInt(e.target.value, 10);
      $(`ch-db-${i}`).textContent = volToDb(ch.faderVal);
      if (ctx && ch.gainNode) {
        ch.gainNode.gain.setTargetAtTime(faderToGain(ch.faderVal), ctx.currentTime, 0.02);
      }
    });

    // Mute event
    $(`ch-mute-${i}`).addEventListener('click', () => {
      if (!audioStarted) return;
      ch.muted = !ch.muted;
      $(`ch-mute-${i}`).classList.toggle('active', ch.muted);
      updateMuteGains();
    });

    // Solo event
    $(`ch-solo-${i}`).addEventListener('click', () => {
      if (!audioStarted) return;
      ch.solo = !ch.solo;
      $(`ch-solo-${i}`).classList.toggle('active', ch.solo);
      updateMuteGains();
    });

    // Input selector event
    $(`ch-sel-${i}`).addEventListener('change', e => {
      ch.inputType = e.target.value;
      if (audioStarted) startChannelSource(ch);
    });
  });

  // Master meter LEDs
  masterState.ledsL = buildLeds($('master-meter-l'), MST_LEDS);
  masterState.ledsR = buildLeds($('master-meter-r'), MST_LEDS);

  // Master fader
  $('master-fader').addEventListener('input', e => {
    const val = parseInt(e.target.value, 10);
    $('master-db').textContent = volToDb(val);
    if (ctx && masterGainNode) {
      masterGainNode.gain.setTargetAtTime(faderToGain(val), ctx.currentTime, 0.02);
    }
  });

  // Master mute
  $('master-mute').addEventListener('click', () => {
    if (!audioStarted) return;
    const btn = $('master-mute');
    const active = btn.classList.toggle('active');
    if (ctx && masterMuteNode) {
      masterMuteNode.gain.setTargetAtTime(active ? 0 : 1, ctx.currentTime, 0.02);
    }
  });

  // Start audio button
  $('btn-start-audio').addEventListener('click', async () => {
    if (audioStarted) return;
    await initAudioContext();
    if (ctx.state === 'suspended') await ctx.resume();
    audioStarted = true;
    $('btn-start-audio').textContent = '✅ Audio läuft';
    $('btn-start-audio').disabled = true;
    animLoop();
  });

  // Panic button: mute all
  $('btn-panic').addEventListener('click', () => {
    if (!audioStarted) return;
    channels.forEach(ch => {
      ch.muted = true;
      $(`ch-mute-${ch.index}`).classList.add('active');
    });
    updateMuteGains();
  });
}

/* ─────────────────────────────────────────────
   ENTRY POINT
   ───────────────────────────────────────────── */
buildUI();
