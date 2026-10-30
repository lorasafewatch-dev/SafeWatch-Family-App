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
            {
              src: 'pwa-icon.svg',
              sizes: 'any',
              type: 'image/svg+xml',
              purpose: 'any maskable'
            }
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
