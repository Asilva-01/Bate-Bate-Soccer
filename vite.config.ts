import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalizedId = id.replaceAll('\\', '/');
          if (normalizedId.includes('/node_modules/three/')) return 'three';
          if (normalizedId.includes('/node_modules/@dimforge/rapier3d-compat/')) return 'rapier';
        },
      },
    },
  },
});
