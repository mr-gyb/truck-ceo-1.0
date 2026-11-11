import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Mirrors the TruckCEO owner app's Vite setup (port 3000, React plugin),
// minus the Gemini defines the driver app does not use.
// base '/driver/': the app ships as part of the truck-ceo.web.app hosting
// site at the /driver/ subpath (see driver-app integration in
// truck-ceo-1.0: firebase.json rewrite + workflow build step), so every
// emitted asset URL must be rooted there.
export default defineConfig({
  base: '/driver/',
  server: {
    port: 3001,
    host: '0.0.0.0',
  },
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Firebase ships in its own fingerprinted chunk: it changes far
        // less often than app code, and the server gives .js a 1-year
        // cache header — so an app deploy no longer forces drivers to
        // re-download ~1 MB of Firebase on a depot connection.
        manualChunks: (id) => {
          if (
            id.includes('node_modules/firebase') ||
            id.includes('node_modules/@firebase') ||
            id.includes('node_modules/@grpc') ||
            id.includes('node_modules/protobufjs')
          ) {
            return 'vendor-firebase';
          }
          return undefined;
        },
      },
    },
  },
});
