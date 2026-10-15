/// <reference types="vitest/config" />
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const rootDir = fileURLToPath(new URL('.', import.meta.url));

function productionHttpsCsp() {
  return {
    name: 'production-https-csp',
    transformIndexHtml(html: string) {
      if (process.env.NODE_ENV !== 'production') {
        return html;
      }
      return html.replace(
        '<head>',
        '<head>\n    <meta http-equiv="Content-Security-Policy" content="upgrade-insecure-requests">',
      );
    },
  };
}

const apiProxyTarget = (
  process.env.VITE_API_BASE_URL ?? 'https://meu-agente-de-emprego.onrender.com'
).replace(/\/$/, '');

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(rootDir, 'src'),
    },
  },
  server: {
    proxy: {
      '/__mae_api': {
        target: apiProxyTarget,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/__mae_api/, ''),
      },
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    productionHttpsCsp(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'pwa-192.png', 'pwa-512.png'],
      manifest: {
        name: 'Meu Agente de Emprego',
        short_name: 'MAE',
        description:
          'Analise de vaga com o seu curriculo, historico e carta de apresentacao.',
        lang: 'pt-BR',
        theme_color: '#1c2433',
        background_color: '#f7f5f1',
        display: 'standalone',
        start_url: '/app',
        scope: '/',
        icons: [
          {
            src: 'pwa-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'pwa-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        // SPA: / , /entrar, /app, /app/historico e /app/perfil caem no index.
        navigateFallback: 'index.html',
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
  },
});
