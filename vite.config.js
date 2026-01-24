import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // listen on all addresses (0.0.0.0)
    port: 5173,
    proxy: {
      // Proxy API requests to Express server
      '/api': {
        target: 'http://localhost:5555',
        changeOrigin: true,
        secure: false,
      },
      // Proxy WebSocket connections
      '/ws': {
        target: 'ws://localhost:5555',
        ws: true,
        changeOrigin: true,
      },
    },
  },
})
