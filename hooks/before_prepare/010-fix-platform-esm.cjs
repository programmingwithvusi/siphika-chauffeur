#!/usr/bin/env node
// Cordova generates platforms/*/cordova/*.js as CommonJS, but this project's
// root package.json sets "type": "module" for Vite/ESM elsewhere. Node picks
// module format by walking up to the nearest package.json, so without an
// override here Cordova's own loader crashes with
// "ReferenceError: module is not defined in ES module scope".
// Fix: drop a package.json forcing CommonJS into every platform folder,
// every time prepare/build/run fires — self-heals after a fresh platform add.
const fs = require('fs');
const path = require('path');

const platformsDir = path.join(__dirname, '..', '..', 'platforms');
if (!fs.existsSync(platformsDir)) process.exit(0);

for (const platform of fs.readdirSync(platformsDir)) {
  const platformDir = path.join(platformsDir, platform);
  if (!fs.statSync(platformDir).isDirectory()) continue;
  const pkgPath = path.join(platformDir, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    fs.writeFileSync(
      pkgPath,
      JSON.stringify({ type: 'commonjs' }, null, 2) + '\n',
    );
  }
}
