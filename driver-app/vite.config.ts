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
});
