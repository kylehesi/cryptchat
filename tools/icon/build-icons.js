// Builds the README logo and the app icons from a source image of the logo.
//
//   npm run icons                          (re-crops assets/logo.png)
//   electron tools/icon/build-icons.js <source-image>
//
// Finds the purple artwork by scanning pixels (grey/white marks such as watermarks are not
// purple, so they are never inside the crop), then writes:
//   assets/logo.png     wide crop for the README
//   build/icon.png      256 px app icon
//   build/icon.ico      16–256 px, for the window/taskbar
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { writeIco } = require('./make-ico');

const ROOT = path.join(__dirname, '..', '..');
const SOURCE = path.resolve(process.argv[process.argv.length - 1]);
const ICON_SIZES = [256, 128, 64, 48, 32, 16];

// Runs in the page; returns data URLs.
const pageCode = (src, sizes) => `(async () => {
  const img = new Image();
  img.src = ${JSON.stringify(src)};
  await img.decode();
  const W = img.naturalWidth, H = img.naturalHeight;
  const base = document.createElement('canvas');
  base.width = W; base.height = H;
  const b = base.getContext('2d');
  b.drawImage(img, 0, 0);
  const px = b.getImageData(0, 0, W, H).data;

  // Bounding box of clearly purple pixels (blue and red well above green).
  let x0 = W, y0 = H, x1 = 0, y1 = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4, r = px[i], g = px[i + 1], bl = px[i + 2];
    if (bl > 120 && r > 80 && bl - g > 60 && r - g > 30) {
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  const bw = x1 - x0, bh = y1 - y0, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;

  // Background colour = median-ish sample from the crop corners, used to pad past the edges.
  const bgAt = (x, y) => { const i = (Math.round(y) * W + Math.round(x)) * 4; return [px[i], px[i+1], px[i+2]]; };
  const corners = [bgAt(Math.max(0, x0 - 20), Math.max(0, y0 - 20)), bgAt(Math.min(W - 1, x1 + 20), Math.max(0, y0 - 20)),
                   bgAt(Math.max(0, x0 - 20), Math.min(H - 1, y1 + 20))];
  const bg = corners.reduce((a, c) => a.map((v, k) => v + c[k] / corners.length), [0, 0, 0]).map(Math.round);
  const bgCss = 'rgb(' + bg.join(',') + ')';

  const crop = (w, h, outW, outH, round, filter) => {
    const c = document.createElement('canvas');
    c.width = outW; c.height = outH;
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    if (round) { g.beginPath(); g.roundRect(0, 0, outW, outH, round * outW); g.clip(); }
    g.fillStyle = bgCss; g.fillRect(0, 0, outW, outH);
    if (filter) g.filter = filter;
    g.drawImage(base, cx - w / 2, cy - h / 2, w, h, 0, 0, outW, outH);
    return c;
  };
  const toUrl = (c) => c.toDataURL('image/png');

  // README logo: artwork + 18% margin, at source resolution.
  const lw = Math.round(bw * 1.36), lh = Math.round(bh * 1.36);
  const out = { box: [x0, y0, x1, y1], bg: bgCss, logo: toUrl(crop(lw, lh, lw, lh, 0)) };

  // Icons: square around the artwork. Downscale in halving steps for clean small sizes, and
  // lift brightness at tiny sizes where the dots average out to a dim blur.
  const side = Math.max(bw, bh) * 1.12;
  let master = crop(side, side, 512, 512, 0.18);
  out.icons = {};
  for (const size of ${JSON.stringify(sizes)}) {
    let src = master;
    while (src.width / 2 >= size * 1.5) {
      const half = document.createElement('canvas');
      half.width = src.width / 2; half.height = src.height / 2;
      const h = half.getContext('2d'); h.imageSmoothingQuality = 'high';
      h.drawImage(src, 0, 0, half.width, half.height);
      src = half;
    }
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    if (size <= 48) g.filter = 'brightness(1.6) saturate(1.3) contrast(1.15)';
    g.drawImage(src, 0, 0, size, size);
    out.icons[size] = toUrl(c);
  }
  return out;
})()`;

const decode = (url) => Buffer.from(url.split(',')[1], 'base64');

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true, webSecurity: false } });
  await win.loadURL('about:blank');
  const result = await win.webContents.executeJavaScript(pageCode(pathToFileURL(SOURCE).href, ICON_SIZES));

  fs.mkdirSync(path.join(ROOT, 'assets'), { recursive: true });
  fs.mkdirSync(path.join(ROOT, 'build'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'assets', 'logo.png'), decode(result.logo));
  fs.writeFileSync(path.join(ROOT, 'build', 'icon.png'), decode(result.icons[256]));
  writeIco(path.join(ROOT, 'build', 'icon.ico'), ICON_SIZES.map((size) => decode(result.icons[size])));

  console.log(`artwork box ${result.box.join(',')}  background ${result.bg}`);
  console.log('wrote assets/logo.png, build/icon.png, build/icon.ico');
  app.quit();
});
