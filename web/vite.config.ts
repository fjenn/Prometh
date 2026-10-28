import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // The backend's same-origin check needs the browser's Host header.
  server: { proxy: { '/api': { target: 'http://127.0.0.1:8787', changeOrigin: false } } },
  worker: { format: 'es' },
  build: { target: 'es2022', sourcemap: false, chunkSizeWarningLimit: 8000 },
})
