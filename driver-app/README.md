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

**Baseline route guide (2026-11-11):** a route can carry its FINAL
approved guide/card pack in the app at
`businesses/{bid}/routes/{rid}/baselineGuide/current` (types:
`BaselineGuide` in `src/types.ts`; read: `getBaselineGuide` in
`src/services/driverService.ts`; merge logic: `src/services/baselineGuide.ts`).
When a guide is loaded for the active route, the Today tab runs the
guide's day: stops in the guide's run order with the day's guide pieces,
load labels, and inventory flags pre-filled; the depot step shows the
guide's depot frame; off days show a day-off state; the pieces-loaded
field pre-fills from the guide's truck total. Routes without a guide
run on the registry exactly as before. NO MONEY ever — pieces and stale
only; guide data strips the paper card's dollar figures.

Pilot: route 7823. The dataset lives at `src/data/baselineGuide7823.json`
(typed wrapper: `baselineGuide7823.ts`) and is seeded by the owner with
`scripts/seed-baseline-guide-7823.mjs` in the main repo root (Admin SDK;
dry-run by default, `--write` to seed). Revising a guide = updating the
Firestore doc (or re-seeding) — no app deploy needed. Firestore rules
carry a matching `baselineGuide/{docId}` block in the main repo's
`firestore.rules` (console-published, like the rest of the rules).

**Launch wiring (2026-11-08):** this app ships as part of the main
`truck-ceo-1.0` repo (folder `driver-app/`) on the same Firebase Hosting
site, at **https://truck-ceo.web.app/driver/**. The main repo's GitHub
Actions workflow builds it with the same `VITE_FIREBASE_*` web config as
the owner app and copies its dist into `dist/driver/`; `firebase.json`
routes `/driver/**` to it. It goes live on the next Actions deploy of the
main repo. Standalone local builds use a gitignored `.env` with the same
values.
