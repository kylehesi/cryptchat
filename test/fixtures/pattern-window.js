// A harmless window for screen-share tests, so they never capture the real desktop.
// Left half: dense static code text. Right half: 60 fps motion. Window title: CC_TEST_PATTERN.
// Run as its own Electron process: electron test/fixtures/pattern-window.js
const { app, BrowserWindow } = require('electron');

const html = `<!doctype html><title>CC_TEST_PATTERN</title>
<style>
  html, body { margin: 0; height: 100%; background: #0d1117; overflow: hidden; }
  #code { position: absolute; inset: 0 50% 0 0; padding: 10px; font: 12px/15px Consolas, monospace;
          color: #c9d1d9; white-space: pre; overflow: hidden; }
  .k { color: #ff7b72 } .s { color: #a5d6ff } .c { color: #8b949e } .f { color: #d2a8ff }
  canvas { position: absolute; left: 50%; top: 0; }
</style>
<div id="code"></div><canvas id="motion"></canvas>
<script>
  const rows = [];
  for (let i = 1; i <= 80; i++) {
    rows.push('<span class="c">' + String(i).padStart(3) + '</span>  <span class="k">const</span> value' + i +
      ' = <span class="f">compute</span>(<span class="s">"item-' + (i * 7919 % 1000) + '"</span>, ' + (i * 31 % 97) +
      ', { retry: ' + (i % 3) + ', mode: <span class="s">"' + ['fast', 'safe', 'strict'][i % 3] + '"</span> });');
  }
  document.getElementById('code').innerHTML = rows.join('\\n');
  const canvas = document.getElementById('motion');
  const g = canvas.getContext('2d');
  const resize = () => { canvas.width = innerWidth / 2; canvas.height = innerHeight; };
  resize(); addEventListener('resize', resize);
  const balls = Array.from({ length: 40 }, (_, i) => ({ x: (i * 97) % 700, y: (i * 53) % 800, vx: 2 + i % 7, vy: 1.5 + i % 5, r: 8 + i % 20, h: i * 9 }));
  let frame = 0;
  (function draw() {
    frame++;
    const grad = g.createLinearGradient(0, 0, canvas.width, canvas.height);
    grad.addColorStop(0, 'hsl(' + (frame % 360) + ',60%,20%)'); grad.addColorStop(1, 'hsl(' + ((frame + 180) % 360) + ',60%,30%)');
    g.fillStyle = grad; g.fillRect(0, 0, canvas.width, canvas.height);
    for (const b of balls) {
      b.x += b.vx; b.y += b.vy;
      if (b.x < 0 || b.x > canvas.width) b.vx *= -1;
      if (b.y < 0 || b.y > canvas.height) b.vy *= -1;
      g.fillStyle = 'hsl(' + b.h + ',80%,60%)'; g.beginPath(); g.arc(b.x, b.y, b.r, 0, 7); g.fill();
    }
    g.fillStyle = '#fff'; g.font = 'bold 28px Consolas'; g.fillText('FRAME ' + frame, 20, 50);
    requestAnimationFrame(draw);
  })();
</script>`;

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 1280, height: 720, useContentSize: true, x: 20, y: 20, backgroundColor: '#0d1117',
    autoHideMenuBar: true, webPreferences: { backgroundThrottling: false },
  });
  win.loadURL('data:text/html,' + encodeURIComponent(html));
});
