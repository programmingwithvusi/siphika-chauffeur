import { defineConfig, loadEnv } from 'vite';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = resolve(fileURLToPath(import.meta.url), '..');

// ─── Plugin: inject cordova.js loader post-build ──────────────────────────
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
    base: './',
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
      target: ['chrome90', 'safari15'],
    },
    optimizeDeps: { exclude: ['cordova'] },
    server: { port: 5173, open: true, host: '0.0.0.0' },
  };
});
