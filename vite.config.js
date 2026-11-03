import { defineConfig } from 'vite';

// Keep this project separate from other locally running games.
export default defineConfig({
  server: { host: '127.0.0.1', port: 5181, strictPort: true },
  preview: { host: '127.0.0.1', port: 5181, strictPort: true },
});
