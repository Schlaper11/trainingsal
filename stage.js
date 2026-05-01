'use strict';

/* ─────────────────────────────────────────────
   LIGHT TYPE DEFINITIONS
   ───────────────────────────────────────────── */
// DMX channel layout per type:
//  par:     ch1=Intensity, ch2=R, ch3=G, ch4=B
//  spot:    ch1=Intensity, ch2=Pan, ch3=Tilt
//  rgb:     ch1=R, ch2=G, ch3=B
//  moving:  ch1=Pan, ch2=Tilt, ch3=R, ch4=G, ch5=B
const LIGHT_TYPES = {
  par:     { label: 'PAR',          dmxChannels: 4, hasRgb: true,  hasPanTilt: false },
  spot:    { label: 'Spot',         dmxChannels: 3, hasRgb: false, hasPanTilt: true  },
  rgb:     { label: 'RGB Flood',    dmxChannels: 3, hasRgb: true,  hasPanTilt: false },
  moving:  { label: 'Moving Head',  dmxChannels: 5, hasRgb: true,  hasPanTilt: true  },
};

const FIXTURE_BODY_RADIUS = 10; // visual radius of fixture circle on canvas
const FIXTURE_HIT_RADIUS  = 14; // click hit-test radius (slightly larger for usability)

/* ─────────────────────────────────────────────
   STATE
   ───────────────────────────────────────────── */
let lights       = [];
let nextId       = 1;
let selectedId   = null;
let showBeams    = true;
let showLabels   = true;

/* ─────────────────────────────────────────────
   DOM HELPERS
   ───────────────────────────────────────────── */
const $  = (id)       => document.getElementById(id);
const el = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };

/* ─────────────────────────────────────────────
   HEADER COUNTS
   ───────────────────────────────────────────── */
function updateHeader() {
  $('light-count').textContent = lights.length;
  const used = lights.reduce((sum, l) => sum + LIGHT_TYPES[l.type].dmxChannels, 0);
  $('dmx-used').textContent = used;
}

/* ─────────────────────────────────────────────
   TOAST
   ───────────────────────────────────────────── */
let toastTimer = null;
function showToast(msg) {
  const toast = $('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2400);
}

/* ─────────────────────────────────────────────
   CHANNEL STRIP BUILDER
   ───────────────────────────────────────────── */
function buildStripEl(light) {
  const def = LIGHT_TYPES[light.type];
  const strip = el('div', 'channel-strip');
  strip.id = `strip-${light.id}`;
  if (light.id === selectedId) strip.classList.add('selected');

  // ── Header ──
  const header = el('div', 'strip-header');
  const nameEl = el('div', 'strip-name');
  nameEl.textContent = light.name;
  nameEl.title = light.name;
  const delBtn = el('button', 'strip-delete-btn');
  delBtn.textContent = '✕';
  delBtn.title = 'Licht entfernen';
  delBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    deleteLight(light.id);
  });
  header.appendChild(nameEl);
  header.appendChild(delBtn);
  strip.appendChild(header);

  // Select on click
  strip.addEventListener('click', () => selectLight(light.id));

  // ── Type badge ──
  const badge = el('div', `strip-type type-${light.type}`);
  badge.textContent = def.label;
  strip.appendChild(badge);

  // ── DMX address ──
  const dmxRow = el('div', 'strip-dmx');
  dmxRow.innerHTML = 'DMX: ';
  const dmxInput = el('input', 'dmx-input');
  dmxInput.type = 'number';
  dmxInput.min = '1';
  dmxInput.max = '512';
  dmxInput.value = light.dmx;
  dmxInput.addEventListener('change', (e) => {
    const val = Math.max(1, Math.min(512, parseInt(e.target.value, 10) || 1));
    dmxInput.value = val;
    light.dmx = val;
    drawStage();
  });
  dmxRow.appendChild(dmxInput);
  const chSpan = el('span');
  chSpan.textContent = `+${def.dmxChannels}ch`;
  chSpan.style.fontSize = '.65rem';
  chSpan.style.color = 'var(--text-dim)';
  dmxRow.appendChild(chSpan);
  strip.appendChild(dmxRow);

  // ── Intensity (all types) ──
  const intSec = el('div', 'strip-intensity');
  const intLabel = el('label');
  intLabel.textContent = '☀️ Intensität';
  intSec.appendChild(intLabel);
  const intWrap = el('div', 'intensity-fader-wrap');
  const intFader = el('input', 'fader-v');
  intFader.type  = 'range';
  intFader.min   = '0';
  intFader.max   = '255';
  intFader.step  = '1';
  intFader.value = light.intensity;
  const intVal = el('div', 'intensity-val');
  intVal.textContent = light.intensity;
  intFader.addEventListener('input', (e) => {
    light.intensity = parseInt(e.target.value, 10);
    intVal.textContent = light.intensity;
    drawStage();
  });
  intWrap.appendChild(intFader);
  intSec.appendChild(intWrap);
  intSec.appendChild(intVal);
  strip.appendChild(intSec);

  // ── RGB (par, rgb, moving) ──
  if (def.hasRgb) {
    const colorSec = el('div', 'strip-color');
    const colorLabel = el('label');
    colorLabel.textContent = '🎨 Farbe';
    colorSec.appendChild(colorLabel);

    // Color preview row with color picker
    const previewRow = el('div', 'color-preview-row');
    const preview = el('div', 'color-preview');
    preview.id = `color-preview-${light.id}`;
    preview.style.background = rgbToCss(light.r, light.g, light.b);
    preview.style.setProperty('--swatch-color', rgbToCss(light.r, light.g, light.b));

    const colorPicker = el('input');
    colorPicker.type  = 'color';
    colorPicker.value = rgbToHex(light.r, light.g, light.b);
    colorPicker.addEventListener('input', (e) => {
      const [r, g, b] = hexToRgb(e.target.value);
      light.r = r; light.g = g; light.b = b;
      syncRgbSliders(light);
      updateColorPreview(light);
      drawStage();
    });
    previewRow.appendChild(preview);
    previewRow.appendChild(colorPicker);
    colorSec.appendChild(previewRow);

    // RGB sliders
    const sliders = el('div', 'rgb-sliders');
    [['r', 'R', light.r], ['g', 'G', light.g], ['b', 'B', light.b]].forEach(([ch, lbl, initVal]) => {
      const row = el('div', 'rgb-row');
      const label = el('span', `rgb-label ${ch}`);
      label.textContent = lbl;
      const slider = el('input', `rgb-slider ${ch}`);
      slider.type = 'range';
      slider.min = '0';
      slider.max = '255';
      slider.step = '1';
      slider.value = initVal;
      slider.id = `rgb-${ch}-${light.id}`;
      const valEl = el('span', 'rgb-val');
      valEl.id = `rgb-${ch}-val-${light.id}`;
      valEl.textContent = initVal;
      slider.addEventListener('input', (e) => {
        light[ch] = parseInt(e.target.value, 10);
        valEl.textContent = light[ch];
        syncColorPicker(light, colorPicker);
        updateColorPreview(light);
        drawStage();
      });
      row.appendChild(label);
      row.appendChild(slider);
      row.appendChild(valEl);
      sliders.appendChild(row);
    });
    colorSec.appendChild(sliders);
    strip.appendChild(colorSec);
  }

  // ── Pan / Tilt (spot, moving) ──
  if (def.hasPanTilt) {
    const ptSec = el('div', 'strip-pantilt');
    const ptLabel = el('label');
    ptLabel.textContent = '🔄 Pan / Tilt';
    ptSec.appendChild(ptLabel);

    [['Pan', 'pan', light.pan], ['Tilt', 'tilt', light.tilt]].forEach(([lbl, prop, initVal]) => {
      const row = el('div', 'pt-row');
      const label = el('span', 'pt-label');
      label.textContent = lbl;
      const slider = el('input', 'pt-slider');
      slider.type = 'range';
      slider.min  = '0';
      slider.max  = '255';
      slider.step = '1';
      slider.value = initVal;
      slider.id = `pt-${prop}-${light.id}`;
      const valEl = el('span', 'pt-val');
      valEl.textContent = initVal;
      valEl.id = `pt-${prop}-val-${light.id}`;
      slider.addEventListener('input', (e) => {
        light[prop] = parseInt(e.target.value, 10);
        valEl.textContent = light[prop];
        drawStage();
      });
      row.appendChild(label);
      row.appendChild(slider);
      row.appendChild(valEl);
      ptSec.appendChild(row);
    });
    strip.appendChild(ptSec);
  }

  return strip;
}

/* ─────────────────────────────────────────────
   COLOR UTILITIES
   ───────────────────────────────────────────── */
function rgbToCss(r, g, b) {
  return `rgb(${r},${g},${b})`;
}

function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function updateColorPreview(light) {
  const preview = $(`color-preview-${light.id}`);
  if (!preview) return;
  const css = rgbToCss(light.r, light.g, light.b);
  preview.style.background = css;
  preview.style.setProperty('--swatch-color', css);
}

function syncRgbSliders(light) {
  ['r', 'g', 'b'].forEach(ch => {
    const slider = $(`rgb-${ch}-${light.id}`);
    const valEl  = $(`rgb-${ch}-val-${light.id}`);
    if (slider) { slider.value = light[ch]; }
    if (valEl)  { valEl.textContent = light[ch]; }
  });
}

function syncColorPicker(light, pickerEl) {
  pickerEl.value = rgbToHex(light.r, light.g, light.b);
}

/* ─────────────────────────────────────────────
   LIGHT MANAGEMENT
   ───────────────────────────────────────────── */
function addLight(name, type, dmxAddr) {
  const light = {
    id:        nextId++,
    name:      name || `Licht ${light.id}`,
    type,
    dmx:       Math.max(1, Math.min(512, dmxAddr || 1)),
    intensity: 200,
    r:         255,
    g:         200,
    b:         100,
    pan:       128,
    tilt:      128,
  };
  lights.push(light);
  renderStrip(light);
  updateHeader();
  drawStage();
  return light;
}

function renderStrip(light) {
  const container = $('channel-strips');
  const stripEl = buildStripEl(light);
  container.appendChild(stripEl);
}

function deleteLight(id) {
  const idx = lights.findIndex(l => l.id === id);
  if (idx === -1) return;
  lights.splice(idx, 1);
  const stripEl = $(`strip-${id}`);
  if (stripEl) stripEl.remove();
  if (selectedId === id) selectedId = null;
  updateHeader();
  drawStage();
  showToast('Licht entfernt.');
}

function selectLight(id) {
  // Deselect previous
  if (selectedId !== null) {
    const prev = $(`strip-${selectedId}`);
    if (prev) prev.classList.remove('selected');
  }
  selectedId = (selectedId === id) ? null : id;
  if (selectedId !== null) {
    const next = $(`strip-${selectedId}`);
    if (next) next.classList.add('selected');
  }
  drawStage();
}

/* ─────────────────────────────────────────────
   STAGE CANVAS
   ───────────────────────────────────────────── */
const canvas = $('stage-canvas');
const ctx2d  = canvas.getContext('2d');

function lightPosition(index, total) {
  const margin   = 60;
  const usable   = canvas.width - margin * 2;
  const spacing  = total > 1 ? usable / (total - 1) : 0;
  const x = total === 1 ? canvas.width / 2 : margin + index * spacing;
  const y = 40;
  return { x, y };
}

function drawStage() {
  const W = canvas.width;
  const H = canvas.height;
  ctx2d.clearRect(0, 0, W, H);

  // Background gradient
  const bg = ctx2d.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#06080e');
  bg.addColorStop(1, '#0d1020');
  ctx2d.fillStyle = bg;
  ctx2d.fillRect(0, 0, W, H);

  // Stage floor line
  ctx2d.save();
  ctx2d.strokeStyle = '#2a2d3e';
  ctx2d.lineWidth   = 2;
  ctx2d.setLineDash([8, 6]);
  ctx2d.beginPath();
  ctx2d.moveTo(20, H - 30);
  ctx2d.lineTo(W - 20, H - 30);
  ctx2d.stroke();
  ctx2d.setLineDash([]);
  ctx2d.restore();

  // Truss bar
  ctx2d.save();
  ctx2d.strokeStyle = '#3a3f5c';
  ctx2d.lineWidth   = 6;
  ctx2d.lineCap     = 'round';
  ctx2d.beginPath();
  ctx2d.moveTo(20, 40);
  ctx2d.lineTo(W - 20, 40);
  ctx2d.stroke();
  ctx2d.restore();

  if (lights.length === 0) {
    ctx2d.fillStyle = '#3a3f5c';
    ctx2d.font = '14px "Segoe UI", sans-serif';
    ctx2d.textAlign = 'center';
    ctx2d.fillText('Keine Lichter – klicke auf "+ Licht hinzufügen"', W / 2, H / 2);
    return;
  }

  lights.forEach((light, index) => {
    const { x, y } = lightPosition(index, lights.length);
    const isSelected = light.id === selectedId;

    // Beam
    if (showBeams && light.intensity > 0) {
      const alpha = light.intensity / 255;
      const def   = LIGHT_TYPES[light.type];
      let beamR = light.r;
      let beamG = light.g;
      let beamB = light.b;
      if (!def.hasRgb) {
        // White beam for spot
        beamR = 255; beamG = 255; beamB = 255;
      }

      let panAngle  = 0;
      let tiltAngle = 0;
      if (def.hasPanTilt) {
        // pan: -40 to +40 degrees from center
        panAngle  = ((light.pan  / 255) - 0.5) * 80 * (Math.PI / 180);
        // tilt: affects spread/direction
        tiltAngle = ((light.tilt / 255) - 0.5) * 40 * (Math.PI / 180);
      }

      const floorY  = H - 30;
      const spread  = 35 + (light.tilt !== undefined ? (light.tilt / 255) * 20 : 20);
      const centerX = x + Math.tan(panAngle) * (floorY - y);
      const floorX1 = centerX - spread;
      const floorX2 = centerX + spread;

      ctx2d.save();
      const grad = ctx2d.createLinearGradient(x, y, centerX, floorY);
      grad.addColorStop(0,   `rgba(${beamR},${beamG},${beamB},${alpha * 0.7})`);
      grad.addColorStop(0.7, `rgba(${beamR},${beamG},${beamB},${alpha * 0.18})`);
      grad.addColorStop(1,   `rgba(${beamR},${beamG},${beamB},0)`);
      ctx2d.fillStyle = grad;
      ctx2d.beginPath();
      ctx2d.moveTo(x, y);
      ctx2d.lineTo(floorX1, floorY);
      ctx2d.lineTo(floorX2, floorY);
      ctx2d.closePath();
      ctx2d.fill();
      ctx2d.restore();
    }

    // Fixture body
    ctx2d.save();
    if (isSelected) {
      ctx2d.shadowColor  = '#6c63ff';
      ctx2d.shadowBlur   = 14;
    }
    ctx2d.fillStyle = isSelected ? '#6c63ff' : '#3a3f5c';
    ctx2d.beginPath();
    ctx2d.arc(x, y, FIXTURE_BODY_RADIUS + 3, 0, Math.PI * 2);
    ctx2d.fill();

    // Lens glow
    const lensAlpha = light.intensity / 255;
    const def = LIGHT_TYPES[light.type];
    let lR = light.r, lG = light.g, lB = light.b;
    if (!def.hasRgb) { lR = 255; lG = 255; lB = 255; }
    ctx2d.fillStyle = lensAlpha > 0
      ? `rgba(${lR},${lG},${lB},${0.4 + lensAlpha * 0.6})`
      : '#1e2030';
    ctx2d.beginPath();
    ctx2d.arc(x, y, FIXTURE_BODY_RADIUS, 0, Math.PI * 2);
    ctx2d.fill();
    ctx2d.restore();

    // Label
    if (showLabels) {
      ctx2d.save();
      ctx2d.font = '10px "Segoe UI", sans-serif';
      ctx2d.textAlign = 'center';
      ctx2d.fillStyle = isSelected ? '#e8eaf6' : '#7c84a8';
    ctx2d.fillText(light.name, x, y - FIXTURE_BODY_RADIUS - 7);
      ctx2d.restore();
    }
  });
}

/* ─────────────────────────────────────────────
   MODAL
   ───────────────────────────────────────────── */
function openModal() {
  // Pre-fill a default DMX address (next free slot)
  const usedChannels = lights.reduce((sum, l) => sum + LIGHT_TYPES[l.type].dmxChannels, 0);
  const nextAddr = Math.min(512, usedChannels + 1);
  $('new-dmx').value  = nextAddr;
  $('new-name').value = '';
  $('add-modal').classList.remove('hidden');
  $('new-name').focus();
}

function closeModal() {
  $('add-modal').classList.add('hidden');
}

function confirmAddLight() {
  const name = $('new-name').value.trim() || `Licht ${nextId}`;
  const type = $('new-type').value;
  const dmx  = parseInt($('new-dmx').value, 10) || 1;
  addLight(name, type, dmx);
  closeModal();
  showToast(`"${name}" hinzugefügt.`);
}

/* ─────────────────────────────────────────────
   EVENT WIRING
   ───────────────────────────────────────────── */
$('btn-add-light').addEventListener('click', openModal);
$('btn-modal-cancel').addEventListener('click', closeModal);
$('btn-modal-add').addEventListener('click', confirmAddLight);

// Close modal on overlay click
$('add-modal').addEventListener('click', (e) => {
  if (e.target === $('add-modal')) closeModal();
});

// Enter key confirms modal
$('add-modal').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') confirmAddLight();
  if (e.key === 'Escape') closeModal();
});

$('btn-auto-addr').addEventListener('click', () => {
  let addr = 1;
  lights.forEach(light => {
    light.dmx = addr;
    const input = document.querySelector(`#strip-${light.id} .dmx-input`);
    if (input) input.value = addr;
    addr += LIGHT_TYPES[light.type].dmxChannels;
  });
  updateHeader();
  showToast('DMX-Adressen automatisch vergeben.');
});

$('btn-all-off').addEventListener('click', () => {
  lights.forEach(light => {
    light.intensity = 0;
    const fader = document.querySelector(`#strip-${light.id} .fader-v`);
    const valEl = document.querySelector(`#strip-${light.id} .intensity-val`);
    if (fader) fader.value = 0;
    if (valEl)  valEl.textContent = 0;
  });
  drawStage();
  showToast('Alle Lichter ausgeschaltet.');
});

$('show-beams').addEventListener('change', (e) => {
  showBeams = e.target.checked;
  drawStage();
});

$('show-labels').addEventListener('change', (e) => {
  showLabels = e.target.checked;
  drawStage();
});

canvas.addEventListener('click', (e) => {
  if (lights.length === 0) return;
  const rect  = canvas.getBoundingClientRect();
  const scaleX = canvas.width  / rect.width;
  const scaleY = canvas.height / rect.height;
  const mx = (e.clientX - rect.left) * scaleX;
  const my = (e.clientY - rect.top)  * scaleY;

  let hit = null;
  lights.forEach((light, index) => {
    const { x, y } = lightPosition(index, lights.length);
    const dist = Math.hypot(mx - x, my - y);
    if (dist <= FIXTURE_HIT_RADIUS) hit = light.id;
  });

  if (hit !== null) selectLight(hit);
});

/* ─────────────────────────────────────────────
   ENTRY POINT
   ───────────────────────────────────────────── */
updateHeader();
drawStage();
