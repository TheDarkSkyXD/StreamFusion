import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import react from '@vitejs/plugin-react'
export default defineConfig({
  base: process.env.PROTOTYPE_BASE ?? './',
  plugins: [tanstackStart({ router: { basepath: '/' }, spa: { enabled: true, prerender: { outputPath: '/index.html' } } }), react()],
})
