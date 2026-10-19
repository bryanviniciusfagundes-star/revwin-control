import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// base './' permite publicar em qualquer subpasta do GitHub Pages
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
});
