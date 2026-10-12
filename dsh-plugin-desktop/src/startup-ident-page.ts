/**
 * The startup ident's page: the owl built in green scan lines from the top
 * down, the way the tree builds in the Ladd Company ident before Blade
 * Runner, on a green ground line, with the product name and version underneath in the ident's
 * red serif capitals, all shown as if on
 * an old television (blur, bloom, grain, scanlines, flicker). JJ asked for
 * it on 8 Oct 2026 because a launch showed nothing for 6 s on warm data and
 * 37 s on a first run.
 *
 * The page carries everything inline and runs no network request. It reads
 * the owl's own pixels to place the lines: a pixel lights wherever the owl
 * is opaque and goes dark wherever the picture has an edge or a dark mark,
 * so the eyes, beak and wing read as holes, as the leaves do in the tree.
 */

/** The ident's two inks: the owl and ground line in green, the name and version in red. */
export const STARTUP_IDENT_GREEN = '#2f9174'
export const STARTUP_IDENT_RED = '#d42a22'

/** Logical canvas size; the window matches it. */
export const STARTUP_IDENT_WIDTH = 680
export const STARTUP_IDENT_HEIGHT = 480

/**
 * Build the ident document.
 * @param version - the product version printed under the name.
 * @param owl - data URI of the owl frame the lines trace.
 * @returns a complete HTML document for a `data:` URL.
 */
export function startupIdentHtml(version: string, owl: string): string {
  const safeVersion = version.replace(/[^0-9A-Za-z.+-]/g, '')
  const config = JSON.stringify({
    version: safeVersion,
    owl,
    green: STARTUP_IDENT_GREEN,
    red: STARTUP_IDENT_RED,
    flare: '#b8f5df',
    width: STARTUP_IDENT_WIDTH,
    height: STARTUP_IDENT_HEIGHT,
  })
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>IDEalize</title>
<style>
  html, body { margin: 0; height: 100%; background: #000; overflow: hidden; cursor: default; user-select: none; }
  body { -webkit-app-region: drag; }
  #screen { position: absolute; inset: 0; }
  canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
  #scan {
    position: absolute; inset: 0; pointer-events: none;
    background: repeating-linear-gradient(to bottom, rgba(0,0,0,0) 0, rgba(0,0,0,0) 2px, rgba(0,0,0,0.38) 2px, rgba(0,0,0,0.38) 3px);
  }
  #vignette {
    position: absolute; inset: 0; pointer-events: none;
    background: radial-gradient(ellipse 72% 78% at 50% 48%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.55) 82%, rgba(0,0,0,0.92) 100%);
  }
</style></head>
<body><div id="screen"><canvas id="tv"></canvas><div id="scan"></div><div id="vignette"></div></div>
<script>
(() => {
  const C = ${config};
  const W = C.width, H = C.height;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const tv = document.getElementById('tv');
  tv.width = W * dpr; tv.height = H * dpr;
  const out = tv.getContext('2d');
  const scene = document.createElement('canvas');
  scene.width = W * dpr; scene.height = H * dpr;
  const sx = scene.getContext('2d');
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Owl placement and the pixel grid, in logical pixels. The ident's tree
  // is drawn in horizontal scan lines of square-ish pixels: each row is a
  // CELL tall, with a dark gap under it.
  const OWL_H = 204, CELL = 3, ROW_INK = 2;
  const OWL_W = Math.round(OWL_H * 190 / 210);
  // The block runs from the owl's first lit row to the version's baseline
  // and sits in the middle of the panel both ways. The owl picture has blank
  // margins, so placement waits for the trace and centres on lit pixels.
  const RULE_W = Math.round(OWL_W * 1.7);
  let OWL_X = Math.round((W - OWL_W) / 2), OWL_Y = 0, RULE_Y = 0, NAME_Y = 0, VERSION_Y = 0;
  function place() {
    const top = rows[0].y;
    const left = Math.min(...rows.map((r) => r.min)), right = Math.max(...rows.map((r) => r.max));
    OWL_X = Math.round((W - (right - left)) / 2) - left;
    OWL_Y = Math.round((H - (OWL_H - top + 6 + 64)) / 2) - top;
    RULE_Y = OWL_Y + OWL_H + 6;
    NAME_Y = RULE_Y + 40; VERSION_Y = RULE_Y + 64;
  }

  // Build timing, ms. The picture is computed like a raster on an old
  // machine: it only changes on a fixed beat, each beat lands the next chunk
  // of the current row, and now and then the machine stalls for a few beats
  // as if working out the next part. The ground line is the raster's last
  // row, drawn the same way in the same green; then the name fades in.
  // JJ asked for slower, staccato drawing with the line as part of the
  // picture on 12 Oct 2026.
  const BEAT = 40, CHUNK_CELLS = 30, RULE_CHUNKS = 6, NAME_AT_EXTRA = 350, NAME_FADE = 700;

  let rows = [];
  let rule = [];
  let buildEnd = 0;

  // Give every run of every row, then every piece of the ground line, the
  // beat it lands on. A fixed seed keeps the rhythm the same on every launch.
  function schedule() {
    let seed = 11;
    const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    let clock = 0;
    const beat = () => {
      const r = rand();
      clock += BEAT * (r < 0.05 ? 5 : r < 0.2 ? 2 : 1);
      return clock;
    };
    for (const row of rows) {
      let at = beat(), cells = 0;
      for (const run of row.runs) {
        if (cells >= CHUNK_CELLS) { at = beat(); cells = 0; }
        run.at = at;
        cells += (run.end - run.start) / CELL;
      }
    }
    clock += BEAT * 4;
    rule = [];
    for (let k = 0; k < RULE_CHUNKS; k++) rule.push({ from: RULE_W * k / RULE_CHUNKS, to: RULE_W * (k + 1) / RULE_CHUNKS, at: beat() });
    buildEnd = clock;
  }

  function traceOwl(img) {
    const c = document.createElement('canvas');
    c.width = OWL_W; c.height = OWL_H;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0, OWL_W, OWL_H);
    const d = g.getImageData(0, 0, OWL_W, OWL_H).data;
    const lum = new Float32Array(OWL_W * OWL_H);
    const alpha = new Float32Array(OWL_W * OWL_H);
    for (let i = 0; i < OWL_W * OWL_H; i++) {
      const a = d[i * 4 + 3] / 255;
      alpha[i] = a;
      lum[i] = (0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]) * a;
    }
    const at = (x, y) => lum[Math.min(OWL_H - 1, Math.max(0, y)) * OWL_W + Math.min(OWL_W - 1, Math.max(0, x))];
    // A fixed seed keeps the holes in the same place on every launch.
    let seed = 7;
    const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const lit = (x, y) => {
      const i = y * OWL_W + x;
      if (alpha[i] < 0.55) return false;
      // Dark marks (eyes, feet) become holes.
      if (lum[i] < 70) return false;
      // Edges in the picture (eye rings, beak, wing, smile) become holes,
      // as the leaf shadows do in the tree.
      const gx = at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1);
      const gy = at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1);
      if (Math.hypot(gx, gy) > 140) return false;
      // Shaded areas (the wing) drop more pixels, giving it texture.
      const shade = 1 - Math.min(1, lum[i] / 230);
      return rand() > 0.04 + shade * 0.55;
    };
    rows = [];
    for (let y = 0; y + CELL <= OWL_H; y += CELL) {
      const cells = [];
      for (let x = 0; x + CELL <= OWL_W; x += CELL) {
        if (lit(x + 1, y + 1)) cells.push(x);
      }
      if (cells.length === 0) continue;
      // Runs of touching cells: a row lands one run at a time.
      const runs = [];
      for (const x of cells) {
        const last = runs[runs.length - 1];
        if (last !== undefined && x === last.end) last.end = x + CELL;
        else runs.push({ start: x, end: x + CELL });
      }
      rows.push({ y, runs, min: cells[0], max: cells[cells.length - 1] + CELL });
    }
    place();
    schedule();
  }

  function drawScene(time) {
    sx.setTransform(dpr, 0, 0, dpr, 0, 0);
    sx.clearRect(0, 0, W, H);
    // The build only moves on the beat; the chunk landed on this beat flares.
    const t = time === Infinity ? time : Math.floor(time / BEAT) * BEAT;
    const ink = (at) => (t - at < BEAT ? C.flare : C.green);

    // The owl, row by row from the top of the head down, each row landing
    // left to right a chunk at a time.
    outer: for (const row of rows) {
      for (const run of row.runs) {
        if (run.at > t) break outer;
        sx.fillStyle = ink(run.at);
        sx.fillRect(OWL_X + run.start, OWL_Y + row.y, run.end - run.start, ROW_INK);
      }
    }

    // The ground line: the raster's last row, left to right.
    const ruleX = Math.round((W - RULE_W) / 2);
    for (const piece of rule) {
      if (piece.at > t) break;
      sx.fillStyle = ink(piece.at);
      sx.fillRect(ruleX + piece.from, RULE_Y, piece.to - piece.from, ROW_INK);
    }

    const nameP = Math.min(1, Math.max(0, (t - buildEnd - NAME_AT_EXTRA) / NAME_FADE));
    if (nameP > 0) {
      sx.fillStyle = C.red;
      sx.textAlign = 'center';
      sx.textBaseline = 'alphabetic';
      sx.globalAlpha = nameP * (nameP < 1 ? (0.7 + 0.3 * Math.random()) : 1);
      sx.font = '600 31px "Times New Roman", Times, Georgia, serif';
      sx.letterSpacing = '1px';
      sx.fillText('IDEALIZE', W / 2, NAME_Y);
      sx.font = '600 13px "Times New Roman", Times, Georgia, serif';
      sx.letterSpacing = '3px';
      sx.fillText('VERSION ' + C.version, W / 2 + 1.5, VERSION_Y);
      sx.letterSpacing = '0px';
    }
    sx.globalAlpha = 1;
  }

  // Grain: a few precomputed noise tiles, one picked per frame.
  const TILE = 128;
  const tiles = [];
  for (let n = 0; n < 6; n++) {
    const c = document.createElement('canvas');
    c.width = TILE; c.height = TILE;
    const g = c.getContext('2d');
    const img = g.createImageData(TILE, TILE);
    for (let i = 0; i < TILE * TILE; i++) {
      const v = Math.random() * 255;
      img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    tiles.push(c);
  }

  let rollY = Math.random() * H;
  function present(t) {
    out.setTransform(1, 0, 0, 1, 0, 0);
    out.globalCompositeOperation = 'source-over';
    out.globalAlpha = 1;
    out.filter = 'none';
    out.fillStyle = '#0c0d0d';
    out.fillRect(0, 0, tv.width, tv.height);

    const flicker = still ? 1 : 0.9 + 0.1 * Math.random();
    const jitter = !still && Math.random() < 0.04 ? (Math.random() - 0.5) * 3 * dpr : 0;

    // Soft picture: the scene itself blurred, a wide bloom under it, and a
    // faint ghost to the right as on a badly tuned set.
    out.globalCompositeOperation = 'lighter';
    out.filter = 'blur(' + (14 * dpr) + 'px)';
    out.globalAlpha = 0.55 * flicker;
    out.drawImage(scene, jitter, 0);
    out.filter = 'blur(' + (1.3 * dpr) + 'px)';
    out.globalAlpha = 0.95 * flicker;
    out.drawImage(scene, jitter, 0);
    out.filter = 'blur(' + (2.5 * dpr) + 'px)';
    out.globalAlpha = 0.16 * flicker;
    out.drawImage(scene, jitter + 4 * dpr, 0);
    out.filter = 'none';

    // A faint bright band rolls slowly down the picture.
    if (!still) {
      rollY = (rollY + 0.6) % (H + 80);
      const band = out.createLinearGradient(0, (rollY - 40) * dpr, 0, (rollY + 40) * dpr);
      band.addColorStop(0, 'rgba(160,255,220,0)');
      band.addColorStop(0.5, 'rgba(160,255,220,0.03)');
      band.addColorStop(1, 'rgba(160,255,220,0)');
      out.globalAlpha = 1;
      out.fillStyle = band;
      out.fillRect(0, (rollY - 40) * dpr, tv.width, 80 * dpr);
    }

    // Grain over everything.
    out.globalCompositeOperation = 'screen';
    out.globalAlpha = 0.085;
    const tile = tiles[Math.floor(Math.random() * tiles.length)];
    const ox = Math.floor(Math.random() * TILE), oy = Math.floor(Math.random() * TILE);
    for (let y = -oy; y < tv.height; y += TILE) {
      for (let x = -ox; x < tv.width; x += TILE) out.drawImage(tile, x, y);
    }
    out.globalCompositeOperation = 'source-over';
    out.globalAlpha = 1;
  }

  const params = new URLSearchParams(location.hash.slice(1));
  const fixedT = params.has('t') ? Number(params.get('t')) : undefined;
  const img = new Image();
  img.onload = () => {
    traceOwl(img);
    const started = performance.now();
    const frame = (now) => {
      const t = fixedT !== undefined ? fixedT : (still ? Infinity : now - started);
      drawScene(t);
      present(t);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  };
  img.src = C.owl;
})();
</script></body></html>`
}
