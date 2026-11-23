import { resolve } from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
  appType: 'mpa',
  input: {
    index: resolve(import.meta.dirname, 'index.html'),
    register: resolve(import.meta.dirname, 'register.html'),
    login: resolve(import.meta.dirname, 'login.html'),
    dashboard: resolve(import.meta.dirname, 'dashboard.html'),
    studio: resolve(import.meta.dirname, 'studio.html'),
    marketplace: resolve(import.meta.dirname, 'marketplace.html'),
    'voice-details': resolve(import.meta.dirname, 'voice-details.html'),
    'my-library': resolve(import.meta.dirname, 'my-library.html'),
    admin: resolve(import.meta.dirname, 'admin.html'),
  },
  build: {
    outDir: 'dist',
  },
})
