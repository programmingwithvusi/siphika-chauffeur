import { defineConfig, loadEnv } from 'vite';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

// Fix: __dirname is not available in ESM (import syntax).
// Derive it from import.meta.url so resolve() works correctly
// on all Node versions regardless of CJS/ESM detection.
const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, '..');

// ─── Vite plugin: inject cordova.js loader post-build ────────────────────
// Appending via transformIndexHtml (order:'post') means Vite never sees
// the cordova.js src during its own transform phase → no "can't be bundled"
// warning. The loader guards on file:// so it is a no-op in the browser.
// ─────────────────────────────────────────────────────────────────────────
function injectCordovaLoader() {
  const script = [
    '<script>',
    '(function(){',
    "  if(window.location.protocol==='file:'){",
    "    var s=document.createElement('script');",
    "    s.src='cordova.js';",
    "    s.onerror=function(){console.warn('[Siphika] cordova.js failed to load.');};",
    '    document.head.appendChild(s);',
    '  }',
    '}());',
    '</script>',
  ].join('');

  return {
    name: 'inject-cordova-loader',
    transformIndexHtml: {
      order: 'post',
      handler: (html) => html.replace('</body>', script + '</body>'),
    },
  };
}

// ─── Plugin: replace __MAPS_KEY__ placeholder with env variable ───────────
// The API key lives ONLY in .env.local (git-ignored).
// This plugin substitutes the placeholder at build time so the real key
// never exists in src/ — only in the built www/ output.
function injectMapsKey(env) {
  const key = env.VITE_MAPS_KEY || '';
  if (!key) {
    console.warn(
      '\n[Siphika] WARNING: VITE_MAPS_KEY is not set.\n' +
        '   Create a file called .env.local in the project root:\n' +
        '   VITE_MAPS_KEY=AIzaSy...\n' +
        '   Maps will not work without a valid key.\n',
    );
  }
  return {
    name: 'inject-maps-key',
    transformIndexHtml: {
      order: 'pre',
      handler: (html) => html.replace(/_MAPS_KEY_/g, key || 'MISSING_KEY'),
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    root: 'src',
    base: './', // relative paths — mandatory for file:// on-device
    plugins: [injectMapsKey(env), injectCordovaLoader()],

    build: {
      outDir: resolve(__dirname, 'www'),
      emptyOutDir: true,

      rollupOptions: {
        input: resolve(__dirname, 'src/index.html'),
        external: ['cordova'],
        output: {
          entryFileNames: 'assets/app.js',
          chunkFileNames: 'assets/[name]-[hash].js',
          assetFileNames: 'assets/[name][extname]',
        },
      },

      minify: 'terser',
      terserOptions: {
        compress: { drop_console: false },
        mangle: { keep_fnames: true },
      },

      // Chrome 90 = Android WebView on API 24+
      // Safari 15 = iOS 15+ WKWebView
      target: ['chrome90', 'safari15'],
    },

    optimizeDeps: { exclude: ['cordova'] },

    server: {
      port: 5173,
      open: true,
      host: '0.0.0.0', // accessible from Android emulator via 10.0.2.2
    },
  };
});
