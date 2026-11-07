# TruckCEO Data Intake — Design (Phase 0 + Flowers IDP parser)

Status: built locally 2026-11-06 on branch `feature/flowers-intake-2026-11-06`.
**Not deployed, not pushed.** Deploy needs the user's separate word.
Plan: `~/workspace/goals/truckceo-driver-interface-rollout/files/truckceo-data-intake-build-plan-2026-11-06.md`
(Flowers first per the user's 2026-11-06 resequence; Bimbo deferred.)

## One knowledge base per business

TruckCEO's intake is one knowledge base per business, not settlements only.
The settlement record is the financial spine; every other source registers
in the same ingestion registry and attaches to the same routes / weeks /
stores so the assistant can reason across sources (stales % from the
settlement × order quantity from iPlan × documentation from Discord, per
route-week).

### Ingestion registry

`businesses/{bid}/ingestionRegistry/{ingestId}` — one entry per ingested
item, any source. Fields (`IngestionRegistryEntry` in
`functions/src/settlements/types.ts`):

- `sourceType` — e.g. `flowers_master_statement`, `flowers_sbt_shrink`,
  `iplan_weekly_orders`, `discord_daily_activity`
- `grain` — `route-week` | `route-day` | `business-week`
- `provenance` — `{kind: file|portal|message|connector, fileName, storagePath,
  portal, messageId, channelId}` (file name / portal / message id)
- `routeNumber`, `weekEnding` (route-week) or `date` (route-day)
- `parserVersion`, `status` (`received → parsed → validated → needs_review`),
  `recordPath`, `discrepancy`, `ingestedAt`

Registry ids are deterministic (`{sourceType}_{routeNumber|master}_{weekEnding}`),
so re-uploads and re-forwards are idempotent and never duplicate a record.

### GROUNDING RULE (binding on the assistant)

The assistant answers **only from ingested records**, cites the record it
used (registry id / record path), and reports missing data as missing.
It never estimates or invents a number that is not in a record. This closes
the fabrication bug found in the 2026-11-06 TruckCEO audit, where the
assistant invented route data for an empty test business.

### Records

| Record | Firestore path | Grain | Status |
|---|---|---|---|
| Settlement | `businesses/{bid}/routes/{rid}/settlements/{weekEnding}` | route-week | **built + parser** |
| Master settlement (tie-out record) | same, under the master route doc | business-week | **built + parser** |
| SBT Shrink | `businesses/{bid}/routes/{rid}/shrinkReports/{weekEnding}` keyed by COVERED week | route-week | **built + parser** |
| Margin Detail store rows | merged into the settlement record's `storeRows` | route-week | **built + parser** |
| Stales / Always Fresh detail | `businesses/{bid}/routes/{rid}/stalesReports/{weekEnding}` | route-week | type designed, parser = next phase (B) |
| Load Summary | `businesses/{bid}/routes/{rid}/loadSummaries/{weekEnding}` | route-week | type designed, phase B |
| Route Margin Totals | `businesses/{bid}/routes/{rid}/marginTotals/{weekEnding}` | route-week | type designed, phase B |
| iPlan weekly orders (read-only intake; ordering stays recommend-only) | `businesses/{bid}/routes/{rid}/orders/{weekEnding}` | route-week | type designed, phase C |
| Discord daily activity (roll call / steps / EOD) | `businesses/{bid}/routes/{rid}/activity/{date}` | route-day | type designed, phase D |
| Drive documents | document layer (chunked + indexed) | — | phase E |

Route mapping fields added to routes (frontend `types.ts` `RouteTerritory`
+ `RouteSupplierMapping`): `supplier`, `settlementAccount`, `vendorId`.
`storeNumber` added to `Store`. Route identity is ALWAYS the route number;
supplier text labels are carried as `routeLabelPrinted` for audit only
(Flowers prints 7823 as "MILFORD CT" — 7823 is Stratford).

Flowers money semantics (locked): "Total net" / Total Product Charged is
the wholesale bill owed TO Flowers — a cost, never revenue. A Flowers
statement carries no revenue line. `computed.netProfit` stays `null` until
Phase 3 cost layering applies the business's cost defaults — never
estimated in the parser.

### Reconcile validation

A record is `validated` only when every check ties to the cent; otherwise
`needs_review` with the exact discrepancies recorded on the record and in
its registry entry.

- Statements: accountability walk (product block + SBT block) == printed
  New Distributor Balance; discount lines == printed margin total; NDB +
  margin == printed combined; expense lines == printed total; weekly
  balance == combined + expenses (route statements) or == page-2
  Associated Route Balance sum (master statements).
- Margin Detail: per-date `Subtotal by Customer` rows summed per customer
  == `Subtotal by Route` (qty, wholesale, sales); all `Subtotal by Invoice`
  rows == route totals.
- Shrink: item rows == `Customer Total` per customer (qty + $);
  customer totals == distributor total.
- Cross-document (pipeline-level, verified in the acceptance run): same-week
  route statements' Total Product Charged sum == master Total Product
  Charged; a statement's SBT Shrink line == −(prior covered week's shrink
  report perpetual shrink $), all 5 testable weeks.

## IDP report catalog inventory

What the Flowers IDP (OnBase) portal holds, from (a) the 33 fixture PDFs
pulled and verified 2026-11-06 and (b) portal menus observed during that
verified pull. Exact names as shown:

**Parsed in this build (fixtures in hand):**
1. **Distributor Statement** — Master statement ("Master Distrib Number",
   page 2 "Associated Route Balance") and per-route statements. Statements list.
2. **Customer Margin Detail** — Reports → Load Reports.
3. **Scan Based Trading Shrink Report in Units** — Reports → PBS Reports
   (the SBT shrink report; posts one week after the week it covers).

**Seen in the portal (Load Reports menu, 2026-11-06 pull) — parsers are phase B:**
4. **Load Summary**
5. **Route Margin Totals**

**Named in the build plan but NOT yet observed in the portal:**
6. A dedicated stales / **Always Fresh** detail report — no fixture and no
   menu sighting yet. Confirm the exact portal name and location in the
   next IDP session before speccing the stales feed (phase B). The
   settlement's stales line + margin-detail data are the interim source.

## Acceptance results (2026-11-06, fixtures = the 33 verified portal PDFs)

Harness: `functions/test/run-acceptance.ts` (dev-only). All 33 fixtures
parse to `validated` (19/19 statements, 8/8 shrink, 6/6 margin detail);
all acceptance assertions pass, including Master W43 charged $57,310.44 ==
7823 $13,527.03 + 13445 $17,665.28 + 7814 $26,118.13; weighted stales
7823 13.7% (W41 25.3%, W43 3.9%), 13445 8.6%, 7814 W43 6.0%; Territory
Payment $572.25 (W38–42 masters) → $1,219.99 (W43); Margin Detail 7814 W43
route subtotal 5,262 pcs / $23,711.29.

## Pre-deploy build (completed 2026-11-07; deploy itself is the parent step)

1. **PDF text-extraction adapter — BUILT + GATE PASSED.**
   `functions/src/settlements/pdfText.ts` (pdfjs-dist): clusters text
   items into visual rows (baseline tolerance 0.6 × smaller font height,
   x-overlap veto) and rebuilds columns from x positions (char width =
   page median per-char width of letter runs; word-boundary rule keeps
   adjacent runs from merging into one token). Gate harness
   `functions/test/run-acceptance-adapter.ts` (same assertions as the
   pdftotext harness): **33/33 fixtures `validated` (19/19 statements,
   8/8 shrink, 6/6 margin detail), all 18 assertions pass with identical
   totals** — Master W43 $57,310.44 tie-out, stales 13.7 / 8.6 / 6.0,
   Territory Payment $572.25 → $1,219.99, margin subtotals exact. Log:
   `~/workspace/goals/truckceo-driver-interface-rollout/files/truckceo-flowers-adapter-acceptance-2026-11-07.txt`.
2. **Ingest wrapper — BUILT.** `functions/src/settlements/ingest.ts`.
   Processing entry point is `reprocessSettlement` (owner-only callable),
   exported from `functions/src/index.ts` and invoked by the upload
   surface immediately after each PDF lands in Storage (Plan B — see
   "Deploy attempts & Plan B" below; the `onSettlementUpload` Storage
   trigger is written but deliberately not exported/deployed).
   Route/business resolve from the document's printed numbers, never
   the file name; masters land under the master route number (13438).
   Records + registry entries write via Admin SDK batch; margin-detail
   store rows also merge onto the week's settlement record when present.
   Parse failures, discrepancies, and unresolvable routes queue to
   `dataFeedRequests` + `agentInbox`. `reprocessSettlement` returns the
   IngestResult (status, docType, routeNumber, weekEnding, and — for
   statements — total product charged), which the uploader renders
   per file. Owner upload surface: `components/SettlementUploader.tsx`,
   mounted in DataHub's Data Import section. NOTE: Firestore write
   paths are compile-verified, not emulator-tested (no firebase CLI on
   the build VM) — first live upload should be one known fixture with a
   registry spot-check.
3. **Firestore rules**: the settlements/registry blocks are in
   `firestore.rules` (a `marginDetails` block was added 2026-11-07 for
   the margin provenance copies) but rules are NOT auto-deployed
   (per the file's own header) — publish via console with the deploy.
4. **Merge path**: this branch sits on the local tree whose `main` has
   diverged from remote; remote main is the source of truth. Land via the
   established GitHub web-upload flow after review — do not push local main.
5. **Node 22**: already set in the working tree (firebase.json runtime
   nodejs22, functions engines node 22) — rides along with the next deploy.

## Deploy attempts & Plan B (2026-11-07)

Deploy = GitHub Actions `firebase deploy --only functions` (the repo's
established path; no firebase CLI on the build VM). Attempts with the
original surface (callables + the new gen2 Storage trigger
`onSettlementUpload`):

- **Runs 78–84 — FAILED** at the functions step: `Error: Can't find the
  storage bucket region`. App build, functions `npm ci`, and packaging
  all passed; the deploy failed immediately on the storage trigger's
  bucket-region lookup. Hosting/rules steps never ran.
- **Bucket pin — did NOT fix it.** `STORAGE_BUCKET =
  'truck-ceo.firebasestorage.app'` was pinned on the trigger
  (commit 6d2f601); **run 85 failed with the identical error** in 54s.
- Pre-feature runs (Oct 13, #74–77) deployed functions fine — the only
  new deploy surface is the storage trigger, whose deploy requires
  firebase-tools to resolve the bucket region through the deploy
  credential. The console/IAM route to fix that lookup is closed by the
  user's decision (no 2SV enrolment, no console sign-in).

**Plan B (adopted 2026-11-07): no storage trigger in the deployed
surface.** `functions/src/index.ts` exports only `askAssistant`,
`saveFeedCredentials`, and `reprocessSettlement` (verified against the
compiled `lib/index.js`: 2 HTTPS + 1 callable, no event trigger). The
trigger code remains intact in `functions/src/settlements/ingest.ts`
(exported from that module, not re-exported by the entry point), and
`ingestSettlementObject` — the shared core — is untouched. Processing
flow: SettlementUploader uploads the PDF, then invokes the owner-only
`reprocessSettlement({ storagePath })` callable and renders its
IngestResult per file (validated / needs review / failed, with route,
week ending, and charged total for statements). Same end-to-end result
as the trigger for app uploads; the honest trade-off is that a PDF
placed in Storage outside the app does not auto-process until someone
runs reprocess on it (the uploader path covers the real workflow).

**Re-enabling the trigger later requires:** (1) the bucket-region
lookup succeeding for the deploy credential — i.e., the default
bucket's location resolvable via the Storage API with the deployer
service account's permissions, which likely needs the GCP console/IAM
work currently gated by the no-2SV decision; (2) adding
`onSettlementUpload` back to the export line in
`functions/src/index.ts`; (3) a functions redeploy, confirming the
trigger is created. No other code changes — the uploader's callable
invocation can stay as the belt-and-suspenders path.

## Standing display rule (user, 2026-11-07)

Wherever routes are listed or dashboarded in the TruckCEO app, routes
display grouped in this order:

1. **Flowers** (Mateo's in Motion): 7823 Stratford, 13445 Milford,
   7814 Stamford
2. **CNR Bimbo** (CNR Distributors): 1510 Norwalk, 2080 Stamford,
   2286 Ridgefield, 6286 Danbury
3. **LMB Bimbo** (LMB): 0721 Yonkers, 1612 Ossining

Totals shown on dashboards are the **combined grand total across all
businesses/routes**, not a per-business subtotal. (The owner dashboard
already opens in its Global view — `currentRoute = null` — and sums EOD
stats across every route in the business; selecting a route in the
Territory Filter is an explicit drill-down, not the default total.)

Display ordering only — no stored data changes. Implemented centrally in
`services/routeOrdering.ts` (`ROUTE_DISPLAY_GROUPS`, `routeDisplayRank`,
`sortRoutesForDisplay`), applied in `FirestoreService.getRoutes()` — the
one fetch every route list flows through (DataContext owner + team-member
loads, FleetManager's own fetch) — so Routes management, the route
switcher, fleet assignment, and dashboard route lists all inherit the
order. Unknown route numbers sort after the known nine (Flowers before
Bimbo, then by name) so a new route never jumps the queue.
