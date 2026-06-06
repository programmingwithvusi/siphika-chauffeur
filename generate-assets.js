/**
 * generate-assets.js
 * Generates all required Siphika icon and splash PNGs using sharp.
 * Run once: node generate-assets.js
 *
 * Outputs:
 *   res/android/   — adaptive icon foreground + background + legacy densities
 *   res/ios/       — all required App Store / Xcode icon sizes
 *   res/splash/    — Android 12+ animated-icon PNG + iOS universal splash
 */

const sharp  = require('sharp');
const path   = require('path');
const fs     = require('fs');

// ── Siphika brand colours ─────────────────────────────────
const GOLD   = { r: 201, g: 168, b:  76, alpha: 1 };
const BG     = { r:  10, g:  10, b:  12, alpha: 1 };

// ── Helper: make output dir ───────────────────────────────
function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

// ── Helper: build an SVG icon at any size ─────────────────
function iconSVG(size) {
  const cx     = size / 2;
  const cy     = size / 2;
  const r      = size * 0.44;          // outer circle radius
  const stroke = Math.max(1, size * 0.018);
  const carH   = size * 0.24;         // car body height
  const carW   = size * 0.52;
  const carTop = cy - size * 0.06;
  const cabH   = size * 0.12;
  const cabW   = size * 0.30;
  const wheelR = size * 0.065;
  const wheelY = carTop + carH - wheelR * 0.4;
  const w1x    = cx - carW * 0.22;
  const w2x    = cx + carW * 0.22;

  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"
    xmlns="http://www.w3.org/2000/svg">
  <!-- Background -->
  <rect width="${size}" height="${size}" fill="rgb(${BG.r},${BG.g},${BG.b})"/>
  <!-- Outer circle -->
  <circle cx="${cx}" cy="${cy}" r="${r}"
    stroke="rgb(${GOLD.r},${GOLD.g},${GOLD.b})" stroke-width="${stroke}" fill="none"/>
  <!-- Car roof / cabin -->
  <rect
    x="${cx - cabW/2}" y="${carTop - cabH}"
    width="${cabW}" height="${cabH}" rx="${cabH*0.3}"
    fill="none"
    stroke="rgb(${GOLD.r},${GOLD.g},${GOLD.b})" stroke-width="${stroke}"/>
  <!-- Car body -->
  <rect
    x="${cx - carW/2}" y="${carTop}"
    width="${carW}" height="${carH}" rx="${carH*0.18}"
    fill="none"
    stroke="rgb(${GOLD.r},${GOLD.g},${GOLD.b})" stroke-width="${stroke}"/>
  <!-- Left wheel -->
  <circle cx="${w1x}" cy="${wheelY}" r="${wheelR}"
    fill="rgb(${GOLD.r},${GOLD.g},${GOLD.b})"/>
  <!-- Right wheel -->
  <circle cx="${w2x}" cy="${wheelY}" r="${wheelR}"
    fill="rgb(${GOLD.r},${GOLD.g},${GOLD.b})"/>
</svg>`;
}

// ── Helper: build a splash SVG ────────────────────────────
function splashSVG(w, h) {
  const cx = w / 2;
  const cy = h / 2;
  const iconSize = Math.min(w, h) * 0.35;
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"
    xmlns="http://www.w3.org/2000/svg">
  <rect width="${w}" height="${h}" fill="rgb(${BG.r},${BG.g},${BG.b})"/>
  <!-- Subtle radial glow -->
  <radialGradient id="glow" cx="50%" cy="45%" r="40%">
    <stop offset="0%"   stop-color="rgb(${GOLD.r},${GOLD.g},${GOLD.b})" stop-opacity="0.10"/>
    <stop offset="100%" stop-color="rgb(${BG.r},${BG.g},${BG.b})"        stop-opacity="0"/>
  </radialGradient>
  <rect width="${w}" height="${h}" fill="url(#glow)"/>
  <!-- Centred icon -->
  <g transform="translate(${cx - iconSize/2}, ${cy - iconSize/2 - h*0.04})">
    ${iconSVG(iconSize).replace(/<svg[^>]*>/, '').replace('</svg>', '')}
  </g>
  <!-- Brand name -->
  <text
    x="${cx}" y="${cy + iconSize/2 - h*0.04 + Math.min(w,h)*0.08}"
    text-anchor="middle"
    font-family="serif"
    font-size="${Math.min(w,h) * 0.055}"
    letter-spacing="${Math.min(w,h) * 0.012}"
    fill="rgb(${GOLD.r},${GOLD.g},${GOLD.b})">SIPHIKA</text>
  <!-- Tagline -->
  <text
    x="${cx}" y="${cy + iconSize/2 - h*0.04 + Math.min(w,h)*0.115}"
    text-anchor="middle"
    font-family="serif"
    font-size="${Math.min(w,h) * 0.022}"
    letter-spacing="${Math.min(w,h) * 0.005}"
    fill="rgba(${GOLD.r},${GOLD.g},${GOLD.b},0.55)">CHAUFFEUR SERVICES</text>
</svg>`;
}

// ── Helper: SVG → PNG via sharp ───────────────────────────
async function svgToPng(svgString, outPath, size) {
  await sharp(Buffer.from(svgString))
    .resize(size, size)
    .png()
    .toFile(outPath);
  console.log(`  ✓  ${path.relative(process.cwd(), outPath)}  (${size}×${size})`);
}

async function svgToPngRect(svgString, outPath, w, h) {
  await sharp(Buffer.from(svgString))
    .resize(w, h)
    .png()
    .toFile(outPath);
  console.log(`  ✓  ${path.relative(process.cwd(), outPath)}  (${w}×${h})`);
}

// ─────────────────────────────────────────────────────────
async function main() {

  // ── Android ─────────────────────────────────────────────
  console.log('\n📱  Generating Android assets…');
  const droidDir = path.join(__dirname, 'res', 'android');
  mkdirp(droidDir);

  // Adaptive icon foreground (108×108dp safe zone — use 432px for xxxhdpi)
  const adaptiveSizes = [
    { name: 'adaptive-icon-foreground-mdpi.png',    size: 108 },
    { name: 'adaptive-icon-foreground-hdpi.png',    size: 162 },
    { name: 'adaptive-icon-foreground-xhdpi.png',   size: 216 },
    { name: 'adaptive-icon-foreground-xxhdpi.png',  size: 324 },
    { name: 'adaptive-icon-foreground-xxxhdpi.png', size: 432 },
  ];
  for (const { name, size } of adaptiveSizes) {
    await svgToPng(iconSVG(size), path.join(droidDir, name), size);
  }

  // Adaptive icon backgrounds — MUST be PNG files, not hex strings.
  // config.xml background="#0A0A0C" is silently ignored by AAPT and causes:
  //   "resource mipmap/ic_launcher_background not found"
  // We generate a solid #0A0A0C PNG for each density instead.
  console.log('  Generating adaptive icon backgrounds…');
  const bgSizes = [
    { name: 'adaptive-icon-background-mdpi.png',    px: 108 },
    { name: 'adaptive-icon-background-hdpi.png',    px: 162 },
    { name: 'adaptive-icon-background-xhdpi.png',   px: 216 },
    { name: 'adaptive-icon-background-xxhdpi.png',  px: 324 },
    { name: 'adaptive-icon-background-xxxhdpi.png', px: 432 },
  ];
  for (const { name, px } of bgSizes) {
    await sharp({
      create: {
        width:      px,
        height:     px,
        channels:   4,
        background: { r: BG.r, g: BG.g, b: BG.b, alpha: 1 },
      }
    }).png().toFile(path.join(droidDir, name));
    console.log(`  ✓  res/android/${name}  (${px}×${px})`);
  }

  // Legacy / fallback icons (still used by some launchers)
  const legacySizes = [
    { name: 'icon-ldpi.png',    size: 36  },
    { name: 'icon-mdpi.png',    size: 48  },
    { name: 'icon-hdpi.png',    size: 72  },
    { name: 'icon-xhdpi.png',   size: 96  },
    { name: 'icon-xxhdpi.png',  size: 144 },
    { name: 'icon-xxxhdpi.png', size: 192 },
  ];
  for (const { name, size } of legacySizes) {
    await svgToPng(iconSVG(size), path.join(droidDir, name), size);
  }

  // Android 12+ Splash — AndroidWindowSplashScreenAnimatedIcon
  // Must be 1:1, max 288×288dp — use 288px (mdpi=1x baseline)
  await svgToPng(iconSVG(288), path.join(droidDir, 'splash-icon.png'), 288);

  // ── iOS ──────────────────────────────────────────────────
  console.log('\n🍎  Generating iOS assets…');
  const iosDir = path.join(__dirname, 'res', 'ios');
  mkdirp(iosDir);

  const iosSizes = [
    // iPhone
    { name: 'icon-20.png',      size: 20  },
    { name: 'icon-20@2x.png',   size: 40  },
    { name: 'icon-20@3x.png',   size: 60  },
    { name: 'icon-29.png',      size: 29  },
    { name: 'icon-29@2x.png',   size: 58  },
    { name: 'icon-29@3x.png',   size: 87  },
    { name: 'icon-40.png',      size: 40  },
    { name: 'icon-40@2x.png',   size: 80  },
    { name: 'icon-40@3x.png',   size: 120 },
    { name: 'icon-60@2x.png',   size: 120 },
    { name: 'icon-60@3x.png',   size: 180 },
    // iPad
    { name: 'icon-76.png',      size: 76  },
    { name: 'icon-76@2x.png',   size: 152 },
    { name: 'icon-83.5@2x.png', size: 167 },
    // App Store
    { name: 'icon-1024.png',    size: 1024 },
  ];
  for (const { name, size } of iosSizes) {
    await svgToPng(iconSVG(size), path.join(iosDir, name), size);
  }

  // iOS Launch Image — universal storyboard uses a single 2732×2732 asset
  console.log('\n🖼   Generating iOS splash…');
  const iosSplash = splashSVG(2732, 2732);
  await svgToPngRect(iosSplash,
    path.join(iosDir, 'Default@2x~universal~anyany.png'), 2732, 2732);

  // ── Splash dir (shared) ──────────────────────────────────
  console.log('\n🖼   Generating shared splash assets…');
  const splashDir = path.join(__dirname, 'res', 'splash');
  mkdirp(splashDir);

  // Android port splash (legacy, kept for older Cordova splash plugin)
  const androidSplashes = [
    { name: 'splash-port-hdpi.png',   w: 480,  h: 800  },
    { name: 'splash-port-xhdpi.png',  w: 720,  h: 1280 },
    { name: 'splash-port-xxhdpi.png', w: 960,  h: 1600 },
  ];
  for (const { name, w, h } of androidSplashes) {
    await svgToPngRect(splashSVG(w, h), path.join(splashDir, name), w, h);
  }

  console.log('\n✅  All assets generated successfully.\n');
  console.log('Next steps:');
  console.log('  1. Review res/android/ and res/ios/ in your image editor');
  console.log('  2. Replace with your real brand assets if desired');
  console.log('  3. Run: npm run build && cordova prepare\n');
}

main().catch(err => {
  console.error('\n❌  Asset generation failed:', err.message);
  process.exit(1);
});
