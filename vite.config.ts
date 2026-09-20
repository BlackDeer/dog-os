import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Served from https://blackdeer.github.io/dog-os/
export default defineConfig({
  base: '/dog-os/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Dog OS',
        short_name: 'Dog OS',
        description: 'A screen for dogs: channels, games and training.',
        display: 'fullscreen',
        orientation: 'any',
        background_color: '#05070d',
        theme_color: '#05070d',
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,json,mjs}'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        runtimeCaching: [
          {
            // pose model + wasm runtime: big, versioned by URL, cache on first use
            urlPattern: /\/(models|ort)\/.*\.(onnx|wasm)$/,
            handler: 'CacheFirst',
            options: { cacheName: 'models', expiration: { maxEntries: 8 } },
          },
          {
            urlPattern: /^https:\/\/huggingface\.co\/.*/,
            handler: 'CacheFirst',
            options: { cacheName: 'hf-models', expiration: { maxEntries: 20 } },
          },
        ],
      },
    }),
  ],
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['onnxruntime-web'] },
})
