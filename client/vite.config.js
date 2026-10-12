import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const API = process.env.API_URL || 'http://localhost:4000'

export default defineConfig({
  plugins: [react()],
  server: {
    // Allow importing the poster renderer shared with the API server.
    fs: { allow: ['..'] },
    proxy: {
      '/api': API,
      '/uploads': API,
    },
  },
})
