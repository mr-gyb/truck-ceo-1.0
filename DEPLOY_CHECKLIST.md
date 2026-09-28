# TruckCEO AI Assistant — Deploy Checklist

**Owner: Chris. Deadline: Sat 2026-10-03 (5-day build).**
Do these in order. Anything marked AGENT is handled by the agents; the rest needs your clicks.

---

## Step 1 — Paste `firestore.rules` (Firebase console) — YOU

1. Open [Firebase console](https://console.firebase.google.com) → project **truck-ceo** → **Build → Firestore Database → Rules** tab.
2. Copy the **entire** `firestore.rules` file from the repo (`mr-gyb/truck-ceo-1.0`, repo root) and paste it over what's there.
3. **Publish.**
4. This paste has been owed since 2026-09-26 — the new assistant rules (threads, inbox, brain config) ride along with it.

## Step 2 — Widen the deployer service account (GCP console, ~2 min) — YOU

The GitHub deployer needs permission to ship Cloud Functions (first time only).

1. Open [GCP console](https://console.cloud.google.com) → **IAM & Admin → IAM** (project: `truck-ceo`).
2. Find `github-actions-deployer@truck-ceo.iam.gserviceaccount.com` → click the pencil (Edit).
3. **Add** these three roles → **Save**:
   - `Cloud Functions Developer` (`roles/cloudfunctions.developer`)
   - `Cloud Run Admin` (`roles/run.admin`)
   - `Service Account User` (`roles/iam.serviceAccountUser`)

Or via gcloud (any terminal with access):
```bash
for role in roles/cloudfunctions.developer roles/run.admin roles/iam.serviceAccountUser; do
  gcloud projects add-iam-policy-binding truck-ceo \
    --member="serviceAccount:github-actions-deployer@truck-ceo.iam.gserviceaccount.com" \
    --role="$role"
done
```

## Step 3 — Create the model provider secrets — YOU (needed by Wed 9/30)

The key moves server-side; it never goes in the repo or the app bundle again.
**Primary is Gemini** (the backend shipped on it — day-1 ship target).
Meta Muse Spark and OpenAI are verified config-flip backups.

**3a. Gemini key (REQUIRED for day-1):**
1. Go to **https://aistudio.google.com/apikey** → create an API key → **copy it**.
2. [GCP console](https://console.cloud.google.com) → **Security → Secret Manager** (project: `truck-ceo`) → **Create secret**.
3. Name: `GEMINI_API_KEY` → paste the key → **Create**.
   Or via CLI:
   ```bash
   firebase functions:secrets:set GEMINI_API_KEY --project truck-ceo
   ```

**3b. Backup provider keys (optional until you flip):**
- Meta Muse Spark (`META_MODEL_API_KEY`): **https://dev.meta.ai/** → **Start building** →
  create your account → add a payment method → **API keys** page → **Create API key**.
  (Meta's docs say "supported countries or territories" — US-only availability was
  not conclusively confirmed from the official pages.) Model: `muse-spark-1.3`
  (Standard tier — Meta does **not** train on prompts; never use the `-contributor`
  variant). Pricing: **$1.25 / $4.25 per million input/output tokens** (cached $0.15).
- OpenAI (`OPENAI_API_KEY`): **https://platform.openai.com/** → **API keys** →
  create a key. Default model: `gpt-5-mini` (~$0.25 / $2.00 per million in/out).

Set them the same way when you want them:
```bash
firebase functions:secrets:set META_MODEL_API_KEY --project truck-ceo
firebase functions:secrets:set OPENAI_API_KEY --project truck-ceo
```

Cost: at driver-chat volumes any provider is single-digit dollars/month.
Keep the $10/mo budget alert (see Rollback).

## Step 4 — Push to `main`, watch Actions — AGENT (+ your upload)

1. Agents finish `functions/` backend code and the app rewire (parallel tracks).
2. Everything goes up via **web upload to GitHub** (git push from the VM is still broken) → GitHub repo → **Actions** tab → watch **"Deploy to Firebase Hosting on merge"**.
3. Green run = hosting **and** functions deployed. The predeploy step compiles `functions/` automatically.

## Step 5 — Verify the endpoint — YOU (2 min)

1. Open the app (`app.truckceos.com`), log in as owner, open the assistant widget.
2. Ask: **"who drives 2286"** → expect **Luis**. Ask: **"who drives Stratford"** → expect **vacant since Friely departed** (the old app still says Friely — this is the proof the new brain is live).
3. Or curl it (grab an ID token from the browser devtools console after login: `firebase.auth().currentUser.getIdToken()`):
   ```bash
   curl -X POST https://app.truckceos.com/api/askAssistant \
     -H "Authorization: Bearer <ID_TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{"message":"who drives route 2286?"}'
   ```
   Expect a JSON reply naming Luis. A 403 = rules problem; a 500 = function problem — ping the agents.

## Step 6 — Generate invite codes, text the drivers — YOU (in-app + SMS)

1. In the app (owner view), generate **one invite code per route**: 1510, 2080, 2286, 6286, 0721/1612, 13445. **Skip 7823 (Stratford) — vacant.**
2. Text each driver their code with the template below.

> ### ⚠️ DRAFT — needs Chris's approval before sending
> Hi {FirstName}, this is GYBs with Mateo's in Motion. Your TruckCEO app is ready — open the app, choose Join as Driver, and enter your invite code: {CODE}. Your daily checklist, photos, and driver score now live there instead of Discord. Reply here if anything doesn't work. — GYBs

Replace `{FirstName}` and `{CODE}` per driver. Discord stays for chatter; the app is now the system of record for EOD/photos.

---

## Rollback

- Function misbehaves → Firebase console → **Functions** → `askAssistant` → delete/disable. The widget falls back to its current state.
- Bad hosting deploy → Firebase console → **Hosting** → release history → **Roll back**.
- Recommended: set a **$10/mo budget alert** (GCP console → Billing → Budgets & alerts) — expected cost is single-digit dollars/month.

## Flipping providers (no code change needed)

`src/index.ts` reads the `MODEL_PROVIDER` env var (`gemini` | `meta` | `openai`,
default `gemini`). To flip after deploy:
1. Make sure the matching secret exists (Step 3b).
2. Set `MODEL_PROVIDER` on the Cloud Run service: Firebase/GCP console →
   **Cloud Run → askAssistant → Edit & deploy new revision → Variables** →
   add `MODEL_PROVIDER=meta` (or `openai`) → deploy. Or via the functions config
   at deploy time, then redeploy functions.
3. Test with the Step 5 checks. Flip back to `gemini` the same way.

Only the active provider's key is read at runtime; the other secrets sit idle.
Each provider keeps the same 9 tools, scoping, threads, and escalation —
only the chat-completions transport changes.

## Seeding the brain

On first call, the function reads `appConfig/assistantBrain` in Firestore;
if missing, it falls back to `functions/brain.seed.json` (version 1, dated
2026-09-28). After that, GYBs updates the live doc directly — no deploys
needed for knowledge changes.
