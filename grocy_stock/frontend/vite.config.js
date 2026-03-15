import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Use relative base so assets work correctly under any HA ingress path
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  },
});
