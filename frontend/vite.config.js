import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const viewer3d = fileURLToPath(new URL('../viewer3d/src', import.meta.url))

export default defineConfig(({ mode }) => {
  // Read the repo-root .env but expose only the domain-locked Showcase SDK key to the browser.
  // The Matterport API key/token and every other secret must never reach the bundle.
  const env = loadEnv(mode, '..', '')
  return {
    plugins: [react()],
    resolve: { alias: { '@viewer3d': viewer3d } },
    define: { __MP_SDK_KEY__: JSON.stringify(env.MATTERPORT_SDK_KEY ?? '') },
    server: { port: 5173, fs: { allow: ['..'] } },
  }
})
