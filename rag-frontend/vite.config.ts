import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // If you renamed vite.config.ts to vite.config.js, make sure this is consistent
})