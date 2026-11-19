import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { validateDeploymentEnv } from '../shared/deploymentEnv.js'

export default defineConfig(({ command, mode }) => {
  if (command === 'build') validateDeploymentEnv(loadEnv(mode, process.cwd(), 'VITE_'));
  return {
    resolve: { dedupe: ['react', 'react-dom', 'leaflet', 'react-leaflet', 'lucide-react'] },
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.ico', 'icons/*.svg', 'icons/*-v2.png', 'sos-push-worker.js'],
        workbox: { importScripts: ['/sos-push-worker.js'] },
        devOptions: {
          enabled: false
        },
        manifest: {
          name: 'SafeWatch Family App',
          short_name: 'SafeWatch',
          description: 'Family Monitoring for Seniors',
          theme_color: '#edf8ef',
          background_color: '#edf8ef',
          display: 'standalone',
          icons: [
            { src: 'icons/family-192-v2.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: 'icons/family-512-v2.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
            { src: 'icons/family-maskable-512-v2.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
          ]
        }
      })
    ],
    server: {
      port: 5173,
      host: '127.0.0.1'
    }
  }
})
