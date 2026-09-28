# truckceo-functions — `askAssistant` backend brain

Cloud Function (gen2, Node 20, `us-central1`) behind the TruckCEO in-app AI
assistant. The app POSTs `{ message, threadId? }` with a Firebase ID token;
the function verifies auth, enforces role/route scoping server-side, loads the
knowledge brain, runs the selected model provider with 9 real server-side
tools, persists the thread, and files out-of-scope requests to the top-level
`agentInbox` for GYBs.

## Layout

- `src/index.ts` — auth, brain cache/seed, role scoping, all 9 tool executors,
  prompt building, thread persistence, HTTP entrypoint. Provider-independent.
- `src/providers/` — model-provider abstraction. Swaps ONLY the
  chat-completions + tool-call transport:
  - `types.ts` — `NeutralTool`, `ChatProvider`, turn types
  - `gemini.ts` — **primary (day-1 ship target)**: `@google/genai`
    `generateContent` + `functionDeclarations`, model `gemini-2.5-flash`
  - `meta.ts` — verified backup: Meta Muse Spark `muse-spark-1.3` via the
    OpenAI-compatible client pointed at `https://api.meta.ai/v1`
  - `openai.ts` — verified backup: OpenAI Chat Completions + function calling,
    model `gpt-5-mini`
  - `openaiCompatible.ts` — shared transport used by `meta.ts` / `openai.ts`
  - `index.ts` — `getProvider(name)` registry; `MODEL_PROVIDER` selects it
- `package.json` / `tsconfig.json` — Node 20, CommonJS, `npm run build` → `lib/`
- `.env.example` — local emulator keys (dev only; prod uses Secrets)

## Model provider selection

`src/index.ts` reads `MODEL_PROVIDER` (`gemini` | `meta` | `openai`, default
`gemini`). To flip providers at deploy time: set the env var and make sure the
matching secret exists (see below), then redeploy functions. No code change.

| Provider | Env value | Secret | Default model | Key signup |
|---|---|---|---|---|
| Gemini (primary, day-1) | `gemini` | `GEMINI_API_KEY` | `gemini-2.5-flash` | https://aistudio.google.com/apikey |
| Meta Muse Spark (backup) | `meta` | `META_MODEL_API_KEY` | `muse-spark-1.3` | https://dev.meta.ai/ → Start building → payment method → create API key |
| OpenAI (backup) | `openai` | `OPENAI_API_KEY` | `gpt-5-mini` | https://platform.openai.com/ → API keys |

How to set the env var for Cloud Functions gen2 (applies at deploy):

```bash
firebase functions:config:set askassistant.model_provider=gemini --project truck-ceo
```

or set `MODEL_PROVIDER` in the Cloud Run service's env vars after deploy
(Console → Cloud Run → askAssistant → Edit → Variables), then redeploy.

## Secrets

All three secret names are wired via
`secrets: ["GEMINI_API_KEY", "META_MODEL_API_KEY", "OPENAI_API_KEY"]` in
`src/index.ts`. **Only the active provider's key is required at runtime** —
the function reads `process.env[<provider>.keyEnvVar]` and returns a generic
503 if it's missing. Create the secret for the provider you ship; create
placeholder values for the others so the deploy-time secret binding succeeds.

```bash
firebase functions:secrets:set GEMINI_API_KEY --project truck-ceo
firebase functions:secrets:set META_MODEL_API_KEY --project truck-ceo
firebase functions:secrets:set OPENAI_API_KEY --project truck-ceo
```

The key must never appear in the repo, the client bundle, or CI env vars.

Provider notes:
- Meta: use the **Standard** tier (`muse-spark-1.3`) — never trains on
  prompts. Do NOT use the `-contributor` variant (discounted, but Meta may
  train on your data). Pricing: $1.25/M input, $4.25/M output, $0.15/M cached
  input. Official docs: https://dev.meta.ai/docs/models
- OpenAI: `gpt-5-mini` is the default mini-tier with function calling. Newer
  cost-sensitive alternative: `gpt-6-luna`.

## Deploy

`firebase.json` registration + the GitHub workflow change are handled at the
repo root. This package needs:

```json
// firebase.json
{ "functions": [{ "source": "functions", "codebase": "default", "ignore": ["node_modules", ".git", "lib", "*.log"] }] }
```

```bash
cd functions && npm ci && npm run build
firebase deploy --only functions --project truck-ceo
# CI: deploy --only hosting,functions (service account needs
# roles/cloudfunctions.developer + run.admin + iam.serviceAccountUser)
```

Local emulator: `npm run serve` (uses `.env` — copy from `.env.example`).

## Firestore surface this function uses

Reads: `employees/{uid}`, `appConfig/assistantBrain` (+ `brain.seed.json`
fallback), `alerts`, `eodReports`, `assistantThreads/{tid}/messages`,
`assistantRateLimits/{uid}`.

Writes: `assistantThreads/{tid}` + `messages` subcollection (thread history),
`eodReports/{routeId_YYYY-MM-DD}` (EOD notes via `arrayUnion`),
`alerts` (operational alerts), `employees/{id}` (`statusNotes` only),
top-level `agentInbox` (escalations).

Rules needed: `assistantThreads` readable by the owning user; `agentInbox`
owner-read, function-write; `appConfig` not client-readable; `alerts` /
`eodReports` tenant-isolated like other business collections.

## Hard rules enforced in code

- No order placement/modification tools exist — ordering stays recommend-only.
- Driver pay is stripped from the brain + all tool output for non-owners.
- Every tool re-checks role/route scope server-side; the model can't widen access.
- Rate limit: 20 calls / 15 min per user (Firestore-backed).
- Never estimates route net profit until bakery settlement feeds connect.
- All errors return generic messages; details go to Cloud Logging only.
