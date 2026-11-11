#!/usr/bin/env node
/**
 * Seed the approved baseline route guide for route 7823 into Firestore:
 *   businesses/{bid}/routes/{rid}/baselineGuide/current
 *
 * Source data: driver-app/src/data/baselineGuide7823.json — built
 * 2026-11-11 from Chris's final approved guide/card pack (baseline
 * schedule + final quantities, rounded tracking figures, no money).
 *
 * This writes with the Admin SDK (same channel the settlement ingest
 * backend uses to write guides), so it bypasses Firestore rules; run
 * it with a service account for the truck-ceo project:
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json \
 *     node scripts/seed-baseline-guide-7823.mjs --business <bid> --route <rid> --write
 *
 * <bid> is the Mateo's in Motion business doc id and <rid> the 7823
 * route doc id in that business (the ids the owner app shows/loads —
 * NOT the route number). Without --write the script only validates
 * the dataset and prints what it WOULD write (dry run).
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const require = createRequire(join(repoRoot, 'functions', 'package.json'));
const admin = require('firebase-admin');

const args = process.argv.slice(2);
const argValue = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const businessId = argValue('--business');
const routeId = argValue('--route');
const write = args.includes('--write');

const dataPath = join(repoRoot, 'driver-app', 'src', 'data', 'baselineGuide7823.json');
const guide = JSON.parse(readFileSync(dataPath, 'utf8'));

// --- Validate before anything touches Firestore ---------------------
const errors = [];
if (guide.kind !== 'baseline') errors.push('kind is not "baseline"');
if (guide.routeNumber !== '7823') errors.push(`routeNumber is ${guide.routeNumber}, expected 7823`);
for (const day of guide.days) {
  const sum = day.stops.reduce((s, st) => s + (st.pieces ?? 0), 0);
  if (!day.off && day.orderedTotal != null && sum !== day.orderedTotal) {
    errors.push(`${day.day}: stop pieces sum ${sum} != orderedTotal ${day.orderedTotal}`);
  }
  for (const st of day.stops) {
    const text = JSON.stringify(st);
    if (/\$|sales|revenue|margin/i.test(text)) {
      errors.push(`${day.day}/${st.storeName}: money-shaped content in a driver guide stop`);
    }
  }
}
if (errors.length) {
  console.error('Dataset validation FAILED:\n- ' + errors.join('\n- '));
  process.exit(1);
}
console.log(
  `Dataset OK: route ${guide.routeNumber}, version ${guide.version}, ` +
    `${guide.days.filter((d) => !d.off).length} delivery days, ` +
    `${guide.days.reduce((s, d) => s + d.stops.length, 0)} stop-days.`,
);

if (!businessId || !routeId) {
  console.error('\nMissing --business <bid> and/or --route <rid>. Nothing written.');
  process.exit(write ? 1 : 0);
}
const targetPath = `businesses/${businessId}/routes/${routeId}/baselineGuide/current`;
if (!write) {
  console.log(`\nDry run — would write the guide to:\n  ${targetPath}\nRe-run with --write to seed it.`);
  process.exit(0);
}

admin.initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID || 'truck-ceo' });
const db = admin.firestore();

// Guard: never seed a guide onto a route that is not 7823.
const routeSnap = await db.doc(`businesses/${businessId}/routes/${routeId}`).get();
if (!routeSnap.exists) {
  console.error(`Route doc not found at businesses/${businessId}/routes/${routeId}. Nothing written.`);
  process.exit(1);
}
const routeData = routeSnap.data();
if (routeData.routeNumber && String(routeData.routeNumber) !== '7823') {
  console.error(
    `Route doc's routeNumber is ${routeData.routeNumber}, not 7823 — refusing to seed the wrong route.`,
  );
  process.exit(1);
}

await db.doc(targetPath).set({
  ...guide,
  seededAt: admin.firestore.FieldValue.serverTimestamp(),
});
console.log(`Seeded baseline guide → ${targetPath}`);
process.exit(0);
