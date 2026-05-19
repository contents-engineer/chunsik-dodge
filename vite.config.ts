import { defineConfig } from 'vite'

export default defineConfig({
  base: '/',
  server: { port: 5179, host: true },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'three-vendor': ['three'],
        },
      },
    },
  },
})
