import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Missing #root element');

// PWA: register the service worker (production builds only — in dev it
// would fight Vite's HMR). Scope is /driver/, matching the hosting path.
const env = (import.meta as unknown as { env?: { PROD?: boolean } }).env;
if (env?.PROD !== false && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/driver/sw.js', { scope: '/driver/' }).catch(() => {
      // Installability is progressive enhancement; the app runs without it.
    });
  });
}

createRoot(rootEl).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
