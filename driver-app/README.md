# TruckCEO Driver App

The lean driver-facing companion to Truck CEO: a driver signs in and sees only
their assigned route — today's stops in order, target times, photo prompts,
and a locked end-of-day checklist. Modeled on the DoorDash / Uber driver apps.

- **Stack:** React 19 + Vite 6 + TypeScript + Firebase 12 — same stack and
  same Firebase project as the TruckCEO owner app (`~/workspace/build/truck-ceo-1.0`).
- **Plan:** `~/workspace/goals/truckceo-driver-interface-rollout/files/driver-app-plan-2026-11-08.md`
- **Setup:** copy `.env.example` to `.env` and fill the `VITE_FIREBASE_*`
  values from the TruckCEO project's web-client config. Without them the app
  still loads and shows an honest "not connected" state.
- **Run:** `npm install`, then `npm run dev` (port 3001).
- **Build check:** `npm run build` (TypeScript check + Vite build).

Rules baked in: no placeholder data (honest empty states only); per-store
target times are nullable fields — the UI says "Target time not set yet"
rather than inventing times.

**Launch wiring (2026-11-08):** this app ships as part of the main
`truck-ceo-1.0` repo (folder `driver-app/`) on the same Firebase Hosting
site, at **https://truck-ceo.web.app/driver/**. The main repo's GitHub
Actions workflow builds it with the same `VITE_FIREBASE_*` web config as
the owner app and copies its dist into `dist/driver/`; `firebase.json`
routes `/driver/**` to it. It goes live on the next Actions deploy of the
main repo. Standalone local builds use a gitignored `.env` with the same
values.
