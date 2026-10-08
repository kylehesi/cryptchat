// Renders the CryptChat logo and app icons (dot-matrix purple eagle head, glowing X eye)
// with Chromium canvas. Regenerate with:  npm run icons
// (writes tools/icon/out/*, builds build/icon.ico; copy out/logo.png → assets/logo.png and
//  out/icon-256.png → build/icon.png if those changed)
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const OUT = process.argv[process.argv.length - 1];

// Runs inside the page. Draws the eagle as thick strokes on a mask, then re-draws it as glowing dots.
const pageCode = (opts) => `(() => {
const o = ${JSON.stringify(opts)};
const W = o.w, H = o.h;

// ---- 1. Silhouette mask in a 1000x620 design space --------------------------------------
const mask = document.createElement('canvas');
mask.width = W; mask.height = H;
const m = mask.getContext('2d');
const s = Math.min(W / o.viewW, H / o.viewH);
m.setTransform(s, 0, 0, s, (W - o.viewW * s) / 2 - o.viewX * s, (H - o.viewH * s) / 2 - o.viewY * s);
m.lineCap = 'round'; m.lineJoin = 'round';
m.strokeStyle = '#fff'; m.fillStyle = '#fff';
const stroke = (w, pts) => {
  m.lineWidth = w; m.beginPath(); m.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 6) m.bezierCurveTo(pts[i], pts[i+1], pts[i+2], pts[i+3], pts[i+4], pts[i+5]);
  m.stroke();
};
const taper = (pts, w0, w1, steps = 28) => {
  // stroke whose width goes from w0 to w1 along a single cubic
  const [x0,y0,c1x,c1y,c2x,c2y,x1,y1] = pts;
  const at = (t) => { const u = 1 - t; return [u*u*u*x0 + 3*u*u*t*c1x + 3*u*t*t*c2x + t*t*t*x1, u*u*u*y0 + 3*u*u*t*c1y + 3*u*t*t*c2y + t*t*t*y1]; };
  for (let i = 0; i < steps; i++) {
    const a = at(i / steps), b = at((i + 1) / steps);
    m.lineWidth = w0 + (w1 - w0) * (i / steps);
    m.beginPath(); m.moveTo(a[0], a[1]); m.lineTo(b[0], b[1]); m.stroke();
  }
};

// crown: from the back of the head over the top to the beak hook
stroke(40, [430,215, 470,160, 560,138, 640,140,  700,142, 745,175, 770,225,  795,270, 805,330, 795,392]);
// beak: a thick hooked band inside the crown's front curve
taper([712,232, 752,250, 776,300, 782,372], 26, 34);
// mouth line
stroke(24, [590,328, 660,320, 730,328, 780,350]);
// feather streaks sweeping back-left (longest in the middle, like the reference)
taper([505,190, 440,212, 365,262, 300,328], 32, 9);
taper([480,250, 405,275, 315,342, 238,412], 34, 7);
taper([510,302, 440,328, 355,392, 282,462], 32, 7);
taper([530,352, 500,385, 462,438, 442,490], 28, 7);
// neck swooshes: two "((" curves
taper([585,362, 525,398, 505,470, 562,535], 32, 12);
taper([640,362, 588,398, 578,468, 640,535], 28, 10);
// eye brackets  -[ X ]-
m.lineWidth = 16;
for (const [x0, x1, y] of [[500,565,214],[640,700,214],[530,565,265],[640,670,265],[560,575,240],[630,645,240]]) { m.beginPath(); m.moveTo(x0,y); m.lineTo(x1,y); m.stroke(); }
// carve the gap between beak and mouth line, and around the eye
m.globalCompositeOperation = 'destination-out';
m.lineWidth = 10;
m.beginPath(); m.moveTo(600,305); m.bezierCurveTo(660,298, 730,305, 780,330); m.stroke();
m.beginPath(); m.arc(605,240,26,0,Math.PI*2); m.fill();
m.globalCompositeOperation = 'source-over';
m.setTransform(1,0,0,1,0,0);

// ---- 2. Dot matrix ----------------------------------------------------------------------
const out = document.createElement('canvas');
out.width = W; out.height = H;
const g = out.getContext('2d');
if (o.bg) {
  const r = o.radius * W;
  g.fillStyle = o.bg; g.beginPath(); g.roundRect(0, 0, W, H, r); g.fill();
  const vg = g.createRadialGradient(W/2, H/2, 0, W/2, H/2, Math.max(W,H)*0.7);
  vg.addColorStop(0, 'rgba(60,20,90,0.25)'); vg.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = vg; g.beginPath(); g.roundRect(0, 0, W, H, r); g.fill();
}
if (o.solid) {
  // Tiny sizes: dots would turn to mush, so draw the silhouette solid with a glow.
  const tint = document.createElement('canvas');
  tint.width = W; tint.height = H;
  const t = tint.getContext('2d');
  t.drawImage(mask, 0, 0);
  t.globalCompositeOperation = 'source-in';
  t.fillStyle = '#c66bff'; t.fillRect(0, 0, W, H);
  g.save();
  g.shadowColor = 'rgba(176,64,255,1)'; g.shadowBlur = Math.max(1.5, W * 0.05);
  g.drawImage(tint, 0, 0);
  g.restore();
} else {
  const data = m.getImageData(0, 0, W, H).data;
  const pitch = o.pitch * s, dot = pitch * 0.33;
  const dots = new Path2D();
  for (let y = pitch / 2; y < H; y += pitch) for (let x = pitch / 2; x < W; x += pitch) {
    if (data[(Math.floor(y) * W + Math.floor(x)) * 4 + 3] > 128) { dots.moveTo(x + dot, y); dots.arc(x, y, dot, 0, Math.PI * 2); }
  }
  g.save();
  g.shadowColor = 'rgba(176,64,255,0.95)'; g.shadowBlur = pitch * 2.2;
  g.fillStyle = '#b44dff'; g.fill(dots);
  g.shadowBlur = pitch * 0.8; g.fillStyle = '#ecd2ff'; g.fill(dots);
  g.restore();
}

// ---- 3. Eye: glowing X + star flare -------------------------------------------------------
const ex = ((605 - o.viewX) * s) + (W - o.viewW * s) / 2, ey = ((240 - o.viewY) * s) + (H - o.viewH * s) / 2;
const k = 20 * s;
g.save();
g.lineCap = 'round';
g.shadowColor = 'rgba(210,140,255,1)'; g.shadowBlur = 30 * s;
g.strokeStyle = '#ffffff'; g.lineWidth = Math.max(1.4, 10 * s);
g.beginPath(); g.moveTo(ex-k,ey-k); g.lineTo(ex+k,ey+k); g.moveTo(ex+k,ey-k); g.lineTo(ex-k,ey+k); g.stroke();
const flare = g.createRadialGradient(ex, ey, 0, ex, ey, 70 * s);
flare.addColorStop(0, 'rgba(255,240,255,0.55)'); flare.addColorStop(1, 'rgba(180,70,255,0)');
g.fillStyle = flare; g.beginPath(); g.arc(ex, ey, 70 * s, 0, Math.PI*2); g.fill();
if (!o.solid) {
  g.strokeStyle = 'rgba(255,235,255,0.7)'; g.lineWidth = 1.6 * s; g.shadowBlur = 8 * s;
  for (const [dx, dy, len] of [[1,0,62],[0,1,48],[0.7,0.7,30],[0.7,-0.7,30]]) {
    g.beginPath(); g.moveTo(ex - dx*len*s, ey - dy*len*s); g.lineTo(ex + dx*len*s, ey + dy*len*s); g.stroke();
  }
}
g.restore();
return out.toDataURL('image/png');
})()`;

const JOBS = [
  // wide logo for README (like the reference: dark background, eagle centered)
  { file: 'logo.png', w: 1200, h: 720, viewX: 180, viewY: 80, viewW: 680, viewH: 500, pitch: 7, bg: '#0b0b0d', radius: 0 },
  // square app icon sizes
  ...[256, 128, 64, 48, 32, 16].map((size) => ({
    file: `icon-${size}.png`, w: size, h: size, viewX: 215, viewY: 105, viewW: 610, viewH: 460,
    pitch: 9, solid: size <= 64, bg: '#0b0b0d', radius: 0.18,
  })),
];

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html,<body></body>');
  fs.mkdirSync(OUT, { recursive: true });
  for (const job of JOBS) {
    const url = await win.webContents.executeJavaScript(pageCode(job));
    fs.writeFileSync(path.join(OUT, job.file), Buffer.from(url.split(',')[1], 'base64'));
    console.log('wrote', job.file);
  }
  app.quit();
});
