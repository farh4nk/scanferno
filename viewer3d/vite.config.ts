import { defineConfig, loadEnv } from 'vite'

const API = process.env.SCANFERNO_API ?? 'http://localhost:8000'
const API_PATHS = ['/buildings', '/calls', '/dispatch', '/fixtures', '/health']

export default defineConfig(({ mode }) => {
  // Read the repo-root .env, but expose only the Showcase SDK key: the Matterport API key/token and
  // every other secret in that file must never reach the browser bundle.
  const env = loadEnv(mode, '..', '')
  return {
    define: {
      __MP_SDK_KEY__: JSON.stringify(env.MATTERPORT_SDK_KEY ?? ''),
    },
    server: {
      port: 5173,
      proxy: Object.fromEntries(API_PATHS.map((p) => [p, { target: API, changeOrigin: true }])),
    },
  }
})
