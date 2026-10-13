/*
  The film's opening: the desktop app's startup ident (dsh-plugin-desktop/src/
  startup-ident-page.ts), the owl built in green scan lines on an old
  television, ported to draw any frame on demand. Its random flicker and
  jitter are seeded by the frame number so a recording is repeatable.
  The film starts on the blank set, which is also how the site shows the film
  before it plays; the ident builds, holds, and the set switches off.
*/
window.Ident = (() => {
  const GREEN = '#2f9174', RED = '#d42a22', FLARE = '#b8f5df';
  const DPR = 2.25, W = 1920 / DPR, H = 480;          // the ident's logical size, at 16:9
  const OWL_H = 204, CELL = 3, ROW_INK = 2, OWL_W = Math.round(OWL_H * 190 / 210);
  const RULE_W = Math.round(OWL_W * 1.7);
  const BEAT = 40, CHUNK_CELLS = 30, RULE_CHUNKS = 6, NAME_AT_EXTRA = 350, NAME_FADE = 700;
  const LEAD = 12;      // frames of blank set before the build starts
  const HOLD = 1300;    // ms the finished ident holds
  const OFF = 12;       // frames for the switch-off
  const MS = 40;        // one film frame at 25 fps

  let rows = [], rule = [], buildEnd = 0;
  let OWL_X = 0, OWL_Y = 0, RULE_Y = 0, NAME_Y = 0, VERSION_Y = 0;
  let tv, out, scene, sx, flat, fx;

  function seeded(seed) { return () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }; }

  function place() {
    const top = rows[0].y;
    const left = Math.min(...rows.map(r => r.min)), right = Math.max(...rows.map(r => r.max));
    OWL_X = Math.round((W - (right - left)) / 2) - left;
    OWL_Y = Math.round((H - (OWL_H - top + 6 + 64)) / 2) - top;
    RULE_Y = OWL_Y + OWL_H + 6;
    NAME_Y = RULE_Y + 40; VERSION_Y = RULE_Y + 64;
  }

  function schedule() {
    const rand = seeded(11);
    let clock = 0;
    const beat = () => { const r = rand(); clock += BEAT * (r < 0.05 ? 5 : r < 0.2 ? 2 : 1); return clock; };
    for (const row of rows) {
      let at = beat(), cells = 0;
      for (const run of row.runs) {
        if (cells >= CHUNK_CELLS) { at = beat(); cells = 0; }
        run.at = at; cells += (run.end - run.start) / CELL;
      }
    }
    clock += BEAT * 4;
    rule = [];
    for (let k = 0; k < RULE_CHUNKS; k++) rule.push({ from: RULE_W * k / RULE_CHUNKS, to: RULE_W * (k + 1) / RULE_CHUNKS, at: beat() });
    buildEnd = clock;
  }

  function trace(img) {
    const c = document.createElement('canvas'); c.width = OWL_W; c.height = OWL_H;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0, OWL_W, OWL_H);
    const d = g.getImageData(0, 0, OWL_W, OWL_H).data;
    const lum = new Float32Array(OWL_W * OWL_H), alpha = new Float32Array(OWL_W * OWL_H);
    for (let i = 0; i < OWL_W * OWL_H; i++) {
      const a = d[i * 4 + 3] / 255; alpha[i] = a;
      lum[i] = (0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]) * a;
    }
    const at = (x, y) => lum[Math.min(OWL_H - 1, Math.max(0, y)) * OWL_W + Math.min(OWL_W - 1, Math.max(0, x))];
    const rand = seeded(7);
    const lit = (x, y) => {
      const i = y * OWL_W + x;
      if (alpha[i] < 0.55 || lum[i] < 70) return false;
      const gx = at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1);
      const gy = at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1);
      if (Math.hypot(gx, gy) > 140) return false;
      const shade = 1 - Math.min(1, lum[i] / 230);
      return rand() > 0.04 + shade * 0.55;
    };
    rows = [];
    for (let y = 0; y + CELL <= OWL_H; y += CELL) {
      const cells = [];
      for (let x = 0; x + CELL <= OWL_W; x += CELL) if (lit(x + 1, y + 1)) cells.push(x);
      if (!cells.length) continue;
      const runs = [];
      for (const x of cells) {
        const last = runs[runs.length - 1];
        if (last && x === last.end) last.end = x + CELL; else runs.push({ start: x, end: x + CELL });
      }
      rows.push({ y, runs, min: cells[0], max: cells[cells.length - 1] + CELL });
    }
    place(); schedule();
  }

  function drawScene(time, rand) {
    sx.setTransform(DPR, 0, 0, DPR, 0, 0);
    sx.clearRect(0, 0, W, H);
    if (time < 0) return;
    const t = Math.floor(time / BEAT) * BEAT;
    const ink = at => (t - at < BEAT ? FLARE : GREEN);
    outer: for (const row of rows) for (const run of row.runs) {
      if (run.at > t) break outer;
      sx.fillStyle = ink(run.at);
      sx.fillRect(OWL_X + run.start, OWL_Y + row.y, run.end - run.start, ROW_INK);
    }
    const ruleX = Math.round((W - RULE_W) / 2);
    for (const piece of rule) {
      if (piece.at > t) break;
      sx.fillStyle = ink(piece.at);
      sx.fillRect(ruleX + piece.from, RULE_Y, piece.to - piece.from, ROW_INK);
    }
    const nameP = Math.min(1, Math.max(0, (t - buildEnd - NAME_AT_EXTRA) / NAME_FADE));
    if (nameP > 0) {
      sx.fillStyle = RED; sx.textAlign = 'center'; sx.textBaseline = 'alphabetic';
      sx.globalAlpha = nameP * (nameP < 1 ? 0.7 + 0.3 * rand() : 1);
      sx.font = '600 31px "Times New Roman", Times, Georgia, serif'; sx.letterSpacing = '1px';
      sx.fillText('IDEALIZE', W / 2, NAME_Y);
      sx.font = '600 13px "Times New Roman", Times, Georgia, serif'; sx.letterSpacing = '3px';
      sx.fillText('FOR EVERYTHING AI', W / 2 + 1.5, VERSION_Y);
      sx.letterSpacing = '0px';
    }
    sx.globalAlpha = 1;
  }

  // The set's picture: blur, bloom, ghost and a rolling band, as in the app.
  function present(f, rand) {
    const o = fx;
    o.setTransform(1, 0, 0, 1, 0, 0); o.globalCompositeOperation = 'source-over'; o.globalAlpha = 1; o.filter = 'none';
    o.fillStyle = '#0c0d0d'; o.fillRect(0, 0, 1920, 1080);
    const flicker = 0.9 + 0.1 * rand();
    const jitter = rand() < 0.04 ? (rand() - 0.5) * 3 * DPR : 0;
    o.globalCompositeOperation = 'lighter';
    o.filter = `blur(${14 * DPR}px)`; o.globalAlpha = 0.55 * flicker; o.drawImage(scene, jitter, 0);
    o.filter = `blur(${1.3 * DPR}px)`; o.globalAlpha = 0.95 * flicker; o.drawImage(scene, jitter, 0);
    o.filter = `blur(${2.5 * DPR}px)`; o.globalAlpha = 0.16 * flicker; o.drawImage(scene, jitter + 4 * DPR, 0);
    o.filter = 'none';
    const rollY = (f * 0.6 * 2.4 + 140) % (H + 80);   // the app's band speed at 60 fps, per 25 fps frame
    const band = o.createLinearGradient(0, (rollY - 40) * DPR, 0, (rollY + 40) * DPR);
    band.addColorStop(0, 'rgba(160,255,220,0)'); band.addColorStop(0.5, 'rgba(160,255,220,0.03)'); band.addColorStop(1, 'rgba(160,255,220,0)');
    o.globalAlpha = 1; o.fillStyle = band; o.fillRect(0, (rollY - 40) * DPR, 1920, 80 * DPR);
    // the whole set breathes a little brighter and darker, as an old tube does
    o.globalCompositeOperation = 'source-over';
    o.globalAlpha = 0.05 * rand(); o.fillStyle = '#9fe8cf'; o.fillRect(0, 0, 1920, 1080);
    // No grain in the video: noise does not compress. The site lays live grain over the set instead.
    o.globalCompositeOperation = 'source-over'; o.globalAlpha = 1;
  }

  const api = {
    LEAD, OFF, INTRO: 0,
    async init(canvas, owlSrc) {
      tv = canvas; tv.width = 1920; tv.height = 1080; out = tv.getContext('2d');
      scene = document.createElement('canvas'); scene.width = 1920; scene.height = 1080; sx = scene.getContext('2d');
      flat = document.createElement('canvas'); flat.width = 1920; flat.height = 1080; fx = flat.getContext('2d');
      const img = new Image(); img.src = owlSrc; await img.decode(); trace(img);
      const nameDone = buildEnd + NAME_AT_EXTRA + NAME_FADE;
      api.INTRO = LEAD + Math.ceil((nameDone + HOLD) / MS) + OFF;
      api.NAME_AT = LEAD + Math.ceil((buildEnd + NAME_AT_EXTRA) / MS);
    },
    draw(f) {
      const rand = seeded(1000 + f * 7919);
      drawScene((f - LEAD) * MS, rand);
      present(f, rand);
      // the switch-off: the picture squeezes to a bright line, the line to a dot, then black
      const p = (f - (api.INTRO - OFF)) / OFF;
      out.setTransform(1, 0, 0, 1, 0, 0); out.globalCompositeOperation = 'source-over'; out.globalAlpha = 1; out.filter = 'none';
      if (p < 0) { out.drawImage(flat, 0, 0); return; }
      out.fillStyle = '#000'; out.fillRect(0, 0, 1920, 1080);
      const ease = t => t * t * (3 - 2 * t);
      if (p < 0.5) {
        const k = ease(p / 0.5), h = Math.max(4, 1080 * (1 - k));
        out.filter = `brightness(${1 + 2.5 * k})`;
        out.drawImage(flat, 0, 540 - h / 2, 1920, h);
        out.filter = 'none';
        out.globalAlpha = k; out.fillStyle = '#d9fff1'; out.fillRect(0, 540 - Math.min(h, 6) / 2, 1920, Math.min(h, 6)); out.globalAlpha = 1;
      } else if (p < 1) {
        const k = ease((p - 0.5) / 0.5), w = Math.max(6, 1920 * (1 - k));
        out.shadowColor = '#b8f5df'; out.shadowBlur = 40;
        out.fillStyle = '#ecfff8'; out.fillRect(960 - w / 2, 537, w, 6);
        out.beginPath(); out.arc(960, 540, 8 * (1 - k) + 3, 0, Math.PI * 2); out.fill();
        out.shadowBlur = 0;
      }
    },
  };
  return api;
})();
