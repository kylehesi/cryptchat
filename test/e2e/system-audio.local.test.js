// System audio capture excludes our own playback (the echo fix), through the app's real capture
// path (capture.js handler + restrictOwnAudio). Local only: needs real loopback audio, so fake
// media devices are OFF here. This test makes no call, but the app's boot probe still opens the
// real microphone for a moment, as it always does on start.
//
// Plays a 1 kHz tone inside the app ("own") and a 2.5 kHz tone from PowerShell ("another app"),
// then checks which ones the captured system audio contains.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { e2e, ROOT } = require('./harness');

function writeTone(file, hz, seconds) {
  const rate = 44100;
  const data = Buffer.alloc(rate * seconds * 2);
  for (let i = 0; i < rate * seconds; i++) data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * hz * i) / rate) * 0.05 * 32767), i * 2);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVE', 8); header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([header, data]));
}

// Captures system audio exactly like ScreenShare.start() does and measures both tones.
const measure = (restrictOwnAudio) => `(async () => {
  const source = (await window.cc.capture.listSources()).find((s) => s.name === 'CC_TEST_PATTERN');
  if (!source || !(await window.cc.capture.select(source.id, true))) throw new Error('could not select the test window');
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: { restrictOwnAudio: ${restrictOwnAudio}, echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2 } });
  const ctx = new AudioContext();
  const osc = ctx.createOscillator(); osc.frequency.value = 1000;
  const gain = ctx.createGain(); gain.gain.value = 0.05; osc.connect(gain).connect(ctx.destination); osc.start();
  const an = ctx.createAnalyser(); an.fftSize = 4096; ctx.createMediaStreamSource(new MediaStream(stream.getAudioTracks())).connect(an);
  const bins = new Float32Array(an.frequencyBinCount);
  const at = (hz) => { const i = Math.round(hz / (ctx.sampleRate / an.fftSize)); return Math.max(bins[i - 1], bins[i], bins[i + 1]); };
  await new Promise((r) => setTimeout(r, 500));
  let own = -200, other = -200;
  for (let i = 0; i < 20; i++) { await new Promise((r) => setTimeout(r, 100)); an.getFloatFrequencyData(bins); own = Math.max(own, at(1000)); other = Math.max(other, at(2500)); }
  osc.stop(); stream.getTracks().forEach((track) => track.stop()); await ctx.close();
  return { own: Math.round(own), other: Math.round(other) };
})()`;

e2e('system audio (local)', async (t) => {
  const { a } = t;
  const pattern = spawn(process.execPath, [path.join(ROOT, 'test', 'fixtures', 'pattern-window.js')], { stdio: 'ignore' });
  const wav = path.join(t.tmp, 'tone2500.wav');
  writeTone(wav, 2500, 4);
  const play = async () => {
    const player = spawn('powershell.exe', ['-NoProfile', '-Command', `(New-Object System.Media.SoundPlayer '${wav}').PlaySync()`], { stdio: 'ignore' });
    await t.sleep(1500); // PowerShell takes a moment to start playing
    return player;
  };
  const done = (player) => new Promise((resolve) => (player.exitCode !== null ? resolve() : player.on('exit', resolve)));
  try {
    await t.sleep(2500);

    // Control run: without the constraint, our own tone IS captured (so the measurement works).
    let player = await play();
    const plain = await t.js(a, measure(false));
    await done(player);
    t.ok(plain.own > -70, `without restrictOwnAudio our own tone is captured (${plain.own} dB)`);
    t.ok(plain.other > -70, `another app's tone is captured (${plain.other} dB)`);

    // The app's setting: own playback (= the peer's voice in a call) is excluded.
    player = await play();
    const fixed = await t.js(a, measure(true));
    await done(player);
    t.ok(fixed.own < -90, `with restrictOwnAudio our own tone is gone (${fixed.own} dB)`);
    t.ok(fixed.other > -70, `another app's tone is still captured (${fixed.other} dB)`);
  } finally {
    pattern.kill();
  }
}, { timeoutMs: 90000, fakeMedia: false });
