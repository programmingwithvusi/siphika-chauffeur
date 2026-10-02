#!/usr/bin/env node
// cordova-plugin-google-signin applies Google's Gradle plugin
// (com.google.gms.google-services), which hard-requires
// platforms/android/app/google-services.json to exist — Cordova's own
// plugin system has no built-in way to copy it there, and that folder is
// regenerated on every fresh `cordova platform add`. Fix: keep the real
// file at the project root (gitignored — see .gitignore), and copy it in
// here, every time prepare/build/run fires, same self-healing pattern as
// 010-fix-platform-esm.cjs.
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', '..', 'google-services.json');
const androidAppDir = path.join(
  __dirname,
  '..',
  '..',
  'platforms',
  'android',
  'app',
);

if (!fs.existsSync(androidAppDir)) process.exit(0);

if (!fs.existsSync(src)) {
  console.warn(
    '[Siphika] google-services.json not found at the project root — ' +
      'the Android build will fail at :app:processDebugGoogleServices. ' +
      'Download it from Firebase Console (Project Settings > General > ' +
      'your Android app) and place it at the project root.',
  );
  process.exit(0);
}

fs.copyFileSync(src, path.join(androidAppDir, 'google-services.json'));
