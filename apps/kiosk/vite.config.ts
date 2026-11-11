import { cpSync, createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import basicSsl from '@vitejs/plugin-basic-ssl';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const here = fileURLToPath(new URL('.', import.meta.url));
const templatesDir = resolve(here, '../../templates');

const mime: Record<string, string> = {
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

/**
 * Templates live outside the app (repo-root /templates) and are loaded at
 * runtime. In dev they are served from disk at /templates; on build they are
 * copied next to the bundle. The application code never imports them.
 */
function templates(): Plugin {
  return {
    name: 'accurova-templates',
    configureServer(server) {
      server.middlewares.use('/templates', (req, res, next) => {
        const rel = normalize(decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/'));
        const file = join(templatesDir, rel);
        if (!file.startsWith(templatesDir) || !existsSync(file) || !statSync(file).isFile()) {
          res.statusCode = 404;
          res.end('Not found');
          return;
        }
        const type = mime[extname(file).toLowerCase()];
        if (!type) return next();
        res.setHeader('Content-Type', type);
        res.setHeader('Cache-Control', 'no-cache');
        createReadStream(file).pipe(res);
      });
    },
    closeBundle() {
      cpSync(templatesDir, resolve(here, 'dist/templates'), { recursive: true });
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    tailwindcss(),
    templates(),
    // Cameras need a secure context. `npm run dev:lan` serves HTTPS with a
    // self-signed certificate so a tablet on the same Wi-Fi can open the page.
    ...(mode === 'lan' ? [basicSsl()] : []),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Accurova Photobooth',
        short_name: 'Photobooth',
        description: 'Self-service AI photo booth by Accurova.',
        display: 'standalone',
        orientation: 'any',
        background_color: '#111318',
        theme_color: '#111318',
        start_url: '/',
        icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg}'],
        globIgnores: ['templates/**'],
        navigateFallbackDenylist: [/^\/templates\//, /^\/api\//],
        // Template JSON must always be fresh; assets can be cached for offline resilience.
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/templates/') && url.pathname.endsWith('.json'),
            handler: 'NetworkFirst',
            options: { cacheName: 'template-config', networkTimeoutSeconds: 4 },
          },
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/templates/'),
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'template-assets' },
          },
        ],
      },
    }),
  ],
  server: { port: 5173 },
}));
