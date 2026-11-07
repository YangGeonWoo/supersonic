/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  // GitHub Pages 하위 경로(/저장소이름/)에서도 동작하도록 상대 경로로 빌드
  base: './',
  plugins: [react()],
  build: {
    // 3D 페이지의 Three.js 번들(약 560 kB, gzip 144 kB)은 3D 페이지에서만 받으므로 경고 기준을 올린다
    chunkSizeWarningLimit: 700,
    // 2D(index.html)와 3D(3d.html) 두 페이지. Three.js는 3D 페이지 번들에만 들어간다
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        three: resolve(__dirname, '3d.html'),
      },
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
