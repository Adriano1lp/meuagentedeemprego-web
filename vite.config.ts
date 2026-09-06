/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

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
        description: 'Autenticacao e aceite de termos do Meu Agente de Emprego',
        lang: 'pt-BR',
        theme_color: '#FFE16A',
        background_color: '#FFF6E9',
        display: 'standalone',
        start_url: '/',
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
