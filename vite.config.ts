import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  root: 'admin',
  plugins: [react()],
  resolve: {
    alias: { '@shared': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    outDir: '../dist/client',
    emptyOutDir: true,
    // Vite 8 bundles with Rolldown: `codeSplitting.groups` replaces Rollup's `manualChunks`
    // (Rolldown only supports the deprecated function form). Framework + Bezier go into one
    // long-lived `vendor` chunk so the small per-page app chunks can change without busting it.
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'vendor',
              test: /[\\/]node_modules[\\/](@channel\.io[\\/]bezier-(react|icons)|react|react-dom|react-router|react-router-dom|scheduler)[\\/]/,
            },
          ],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8787',
      '/webhooks': 'http://localhost:8787',
      '/mcp': 'http://localhost:8787',
    },
  },
})
