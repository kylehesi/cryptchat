// Test runner:  npm test            unit + e2e (local tests too)
//               npm run test:unit   unit only (plain Node, a few seconds)
//               npm run test:e2e    e2e only
// In CI (env CI set) or with --quick, *.local.test.js are skipped: they need real desktop capture
// or a local TURN server. Pass file names to run only those, e.g. `node test/run.js chat voice`.
'use strict';

const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2);
const onlyUnit = args.includes('--unit');
const onlyE2e = args.includes('--e2e');
const quick = args.includes('--quick') || Boolean(process.env.CI);
const filters = args.filter((arg) => !arg.startsWith('--'));
const electron = require('electron'); // in plain Node this is the path to electron.exe
const E2E_DIR = path.join(__dirname, 'e2e');

function runUnit() {
  console.log('== unit ==');
  const result = spawnSync(process.execPath, ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', '--test', 'test/unit/*.test.mjs'], {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit',
  });
  return result.status === 0;
}

function runE2eFile(file) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(electron, [path.join(E2E_DIR, file)], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });
    child.on('exit', (code) => {
      // Chromium prints its own [pid:...:ERROR:...] noise on stderr; show only our lines.
      const lines = output.split(/\r?\n/).filter((line) => line && !/^\[\d+:\d+\//.test(line));
      const verdict = lines.find((line) => /^(PASS|FAIL|SKIP) /.test(line));
      if (code === 0 && verdict?.startsWith('PASS')) console.log(`  ✔ ${verdict.slice(5)}`);
      else if (code === 0 && verdict?.startsWith('SKIP')) console.log(`  - ${verdict.slice(5)}`);
      else console.log(`  ✖ ${file} (exit ${code}, ${((Date.now() - started) / 1000).toFixed(0)} s)\n${lines.map((line) => `      ${line}`).join('\n')}`);
      resolve({ file, ok: code === 0, skipped: verdict?.startsWith('SKIP') ?? false });
    });
  });
}

async function runE2e() {
  let files = fs.readdirSync(E2E_DIR).filter((file) => file.endsWith('.test.js')).sort();
  if (quick) files = files.filter((file) => !file.endsWith('.local.test.js'));
  if (filters.length) files = files.filter((file) => filters.some((filter) => file.includes(filter)));
  console.log(`== e2e (${files.length} files${quick ? ', local-only tests skipped' : ''}) ==`);
  const results = [];
  for (const file of files) results.push(await runE2eFile(file)); // one at a time: shared mic/audio devices
  return results.every((result) => result.ok);
}

(async () => {
  let ok = true;
  if (!onlyE2e) ok = runUnit() && ok;
  if (!onlyUnit) ok = (await runE2e()) && ok;
  console.log(ok ? '\nALL TESTS PASSED' : '\nSOME TESTS FAILED');
  process.exit(ok ? 0 : 1);
})();
