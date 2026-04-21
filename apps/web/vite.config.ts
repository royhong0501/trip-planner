import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiBaseUrl = (env.VITE_API_BASE_URL ?? '').trim() || 'http://localhost:3000';

  return {
    base: '/',
    server: {
      host: '::',
      port: 5173,
      hmr: { overlay: false },
      proxy: {
        // Dev-time: same-origin calls to /api go straight to the Express server,
        // so cookies can use SameSite=Lax without the cross-origin special case.
        '/api': {
          target: apiBaseUrl,
          changeOrigin: true,
          secure: false,
          ws: false,
        },
      },
    },
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
      dedupe: ['react', 'react-dom', 'react/jsx-runtime'],
    },
    build: {
      outDir: 'dist',
      reportCompressedSize: false,
    },
  };
});
