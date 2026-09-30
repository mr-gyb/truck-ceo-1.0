/**
 * TruckCEO in-app AI assistant — askAssistant (Gemini-primary, provider abstraction)
 *
 * Backend intelligence for the TruckCEO app. Exposes a single HTTPS callable
 * surface `/api/askAssistant` (Firebase rewrite) backed by a chat model with
 * 16 server-side tools:
 *
 * Reads:  get_business_overview, get_route_summary, get_driver_score,
 *         get_eod_history, get_open_alerts, get_onboarding_status
 * Writes: log_eod_note, create_alert, update_employee_status, escalate_to_gybs,
 *         update_business_profile, create_route, create_truck, add_team_member,
 *         complete_onboarding, request_data_feed_connection
 *
 * Setup mode: when the frontend passes `setupMode: true` (owner signing in
 * with incomplete setup), the assistant runs a guided onboarding interview —
 * business → routes → trucks → team → data feeds — doing every backend write
 * itself via the onboarding tools above. All onboarding writes are
 * owner-only. No tool accepts or stores credentials of any kind: data-feed
 * connections are queued for GYBs (or the platform's own OAuth), never
 * collected in chat.
 *
 * MODEL PROVIDER: selected via env MODEL_PROVIDER ("gemini" | "meta" | "openai",
 * default "gemini"). Gemini is the day-1 ship target; Meta Muse Spark and
 * OpenAI are verified config-flip backups. The provider layer swaps ONLY the
 * chat-completions + tool-call transport — see src/providers/. All tools,
 * auth, role/route scoping, thread persistence, rate limits, and escalation
 * below are provider-independent.
 *
 * Secrets (Secret Manager): GEMINI_API_KEY, META_MODEL_API_KEY, OPENAI_API_KEY.
 * Only the ACTIVE provider's key is required at runtime.
 *
 * Security model:
 * - Requires Firebase ID-token auth on every call.
 * - Role/route scoping enforced server-side (drivers only see assigned routes,
 *   never driver pay; managers scoped to their business; owner sees all).
 * - Knowledge base ("brain") seeded from brain.seed.json; per-role redaction.
 * - Rate limit: 20 calls / 15 min per user.
 * - Ordering is RECOMMEND-ONLY: no order-placement tools exist.
 * - No profit estimates until bakery settlement feeds are connected.
 */
import { onRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";
import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import { getProvider, PROVIDER_MODELS } from "./providers";
import type { ChatProvider, NeutralTool } from "./providers/types";

admin.initializeApp();
const db = admin.firestore();

// ─── Config ────────────────────────────────────────────────────────────────
const MODEL_PROVIDER = (process.env.MODEL_PROVIDER || "gemini").toLowerCase();
const MAX_TOOL_ROUNDS = 6;
const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

// ─── Types ─────────────────────────────────────────────────────────────────
interface UserCtx {
  uid: string;
  role: "owner" | "business_manager" | "driver";
  businessIds: string[];
  routeIds: string[];
  name: string;
  // Employee document id under businesses/{bid}/employees (drivers only).
  // NEVER use the Firebase UID as an employee id — see execUpdateEmployeeStatus.
  employeeId?: string;
}

interface ToolResult {
  ok: boolean;
  data?: any;
  error?: string;
}

interface TurnResult {
  text: string;
  toolCalls: Array<{ name: string; args: any; ok: boolean }>;
  escalated: boolean;
}

// ─── Brain (knowledge base) ────────────────────────────────────────────────
let brainCache: any = null;
let brainCacheAt = 0;

async function loadBrain(): Promise<any> {
  const now = Date.now();
  if (brainCache && now - brainCacheAt < 10 * 60 * 1000) return brainCache;
  // 1) Firestore override
  try {
    const snap = await db.collection("appConfig").doc("assistantBrain").get();
    if (snap.exists) {
      brainCache = snap.data();
      brainCacheAt = now;
      return brainCache;
    }
  } catch (e) {
    logger.warn("loadBrain: appConfig/assistantBrain read failed, trying seed file", e);
  }
  // 2) Seed file (functions/brain.seed.json)
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const seed = require("../brain.seed.json");
    brainCache = seed;
    brainCacheAt = now;
    return brainCache;
  } catch (e) {
    logger.error("loadBrain: seed file missing", e);
    throw new Error("Assistant knowledge base unavailable");
  }
}

/** Strip owner-sensitive fields before handing the brain to non-owner roles. */
function redactBrainForMember(brain: any, ctx: UserCtx): any {
  if (ctx.role === "owner") return brain;
  const redacted = JSON.parse(JSON.stringify(brain));
  // Never expose driver pay or per-route profit internals to drivers/managers.
  if (redacted.compensation) delete redacted.compensation;
  if (redacted.routes) {
    for (const r of Object.values(redacted.routes) as any[]) {
      delete r.driverPay;
      delete r.weeklyProfit;
    }
  }
  return redacted;
}

// ─── Live business data (per-tenant Firestore reads) ───────────────────────
// The global brain is REFERENCE data about one operation. The live route list
// below is the ground truth for what exists in the signed-in user's business
// RIGHT NOW — newly created routes appear here immediately, and no other
// business's routes ever leak in.
interface LiveRoute {
  id: string;
  routeNumber: string;
  name: string;
  bakery: string | null;
}
const liveRouteCache = new Map<string, { at: number; routes: LiveRoute[] }>();
const LIVE_ROUTE_TTL_MS = 60_000;

async function listLiveRoutes(bid: string): Promise<LiveRoute[]> {
  const now = Date.now();
  const cached = liveRouteCache.get(bid);
  if (cached && now - cached.at < LIVE_ROUTE_TTL_MS) return cached.routes;
  try {
    const snap = await db.collection(`businesses/${bid}/routes`).get();
    const routes: LiveRoute[] = snap.docs.map((d) => {
      const x = d.data() as any;
      return {
        id: d.id,
        routeNumber: String(x.routeNumber ?? ""),
        name: String(x.name ?? ""),
        bakery: x.bakery != null ? String(x.bakery) : null,
      };
    });
    liveRouteCache.set(bid, { at: now, routes });
    return routes;
  } catch (e) {
    logger.warn("listLiveRoutes: read failed", e);
    return cached ? cached.routes : [];
  }
}

function matchLiveRoute(routes: LiveRoute[], input: string): LiveRoute | null {
  const raw = input.trim();
  const q = raw.toLowerCase();
  if (!q) return null;
  const digits = q.replace(/\D/g, "");
  for (const r of routes) {
    if (r.routeNumber.toLowerCase() === q) return r;
    if (digits && r.routeNumber.replace(/\D/g, "") === digits) return r;
    if (r.id === raw) return r;
  }
  for (const r of routes) {
    if (q.length >= 3 && r.name.toLowerCase().includes(q)) return r;
  }
  return null;
}

// ─── Auth / user context / rate limit ──────────────────────────────────────
async function getUserCtx(req: any): Promise<UserCtx | null> {
  const authz = req.headers.authorization || "";
  const m = authz.match(/^Bearer (.+)$/);
  if (!m) return null;
  let decoded: admin.auth.DecodedIdToken;
  try {
    decoded = await admin.auth().verifyIdToken(m[1]);
  } catch {
    return null;
  }
  const uid = decoded.uid;
  // Canonical identity lives in the top-level `users` collection, written by
  // the app's AuthContext on sign-up and on invite-code join:
  //   owner signup -> { role: 'business_owner', businessId }
  //   invite join  -> { role: 'team_member' | 'business_manager', businessId, employeeId, routeIds }
  // (Employee records live under businesses/{bid}/employees keyed by
  // employeeId — never look them up by Firebase UID.)
  const userSnap = await db.collection("users").doc(uid).get();
  if (!userSnap.exists) return null;
  const u = userSnap.data() as any;
  let role: UserCtx["role"];
  if (u.role === "business_owner") role = "owner";
  else if (u.role === "business_manager") role = "business_manager";
  else if (u.role === "team_member") role = "driver";
  else return null;
  const businessIds: string[] = [];
  if (typeof u.businessId === "string" && u.businessId) businessIds.push(u.businessId);
  if (Array.isArray(u.businessIds)) {
    for (const b of u.businessIds) {
      if (typeof b === "string" && b && !businessIds.includes(b)) businessIds.push(b);
    }
  }
  const routeIds: string[] = Array.isArray(u.routeIds)
    ? u.routeIds.filter((r: any) => typeof r === "string" && r)
    : [];
  return {
    uid,
    role,
    businessIds,
    routeIds,
    name: u.displayName || u.name || decoded.name || "there",
    employeeId:
      typeof u.employeeId === "string" && u.employeeId ? u.employeeId : undefined,
  };
}

async function checkRateLimit(uid: string): Promise<boolean> {
  const ref = db.collection("assistantRateLimits").doc(uid);
  const now = Date.now();
  const snap = await ref.get();
  let entry = snap.exists ? (snap.data() as any) : { count: 0, windowStart: now };
  if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    entry = { count: 0, windowStart: now };
  }
  entry.count += 1;
  await ref.set(entry);
  return entry.count <= RATE_LIMIT_MAX;
}

function assertRouteAccess(ctx: UserCtx, routeDocId: string | null | undefined): boolean {
  if (ctx.role === "owner") return true;
  // Drivers/managers: the route must be one of their assigned route doc ids.
  // A null doc id means the route couldn't be matched to business data — deny.
  if (!routeDocId) return false;
  return ctx.routeIds.includes(routeDocId);
}

// ─── Route identity resolution ─────────────────────────────────────────────
async function resolveRoute(brain: any, input: string | undefined): Promise<any | null> {
  if (!input) return null;
  const q = input.trim().toLowerCase();
  const routes = brain.routes || {};
  // direct route-number match
  for (const [num, r] of Object.entries(routes) as any) {
    if (num === q || num === q.replace(/\D/g, "")) return { number: num, ...r };
  }
  // territory / driver name match
  for (const [num, r] of Object.entries(routes) as any) {
    const hay = `${r.territory || ""} ${r.driver || ""}`.toLowerCase();
    if (q.length >= 3 && hay.includes(q)) return { number: num, ...r };
  }
  return null;
}

// ─── Route identity resolution (brain + Firestore) ──────────────────────────
interface ResolvedRoute {
  number: string; // route number, e.g. "2080" (or doc id when the doc has none)
  docId: string | null; // businesses/{bid}/routes doc id, null when unmatched
  name: string | null; // Firestore route name
  brain: any; // brain route record (null when resolved from live data only)
  live: LiveRoute | null; // the live Firestore route doc, when matched there
}

/**
 * Resolve a user-supplied route reference (number, territory, driver name) to
 * the brain record AND the matching Firestore route document.
 *
 * Route docs carry no routeNumber field (see RouteFormModal), so matching is:
 *   1. doc.data().routeNumber == number (when the field exists)
 *   2. doc id == number
 *   3. doc name contains the number's digits (>= 3 digits)
 *   4. doc name contains the brain territory (case-insensitive)
 */
async function resolveRouteDoc(
  ctx: UserCtx,
  brain: any,
  input: string | undefined
): Promise<ResolvedRoute | null> {
  const bid = ctx.businessIds[0];
  // 1) Live business routes FIRST — newly created routes resolve immediately,
  //    and resolution never depends on the reference brain.
  if (bid && input) {
    const live = await listLiveRoutes(bid);
    const m = matchLiveRoute(live, input);
    if (m) {
      if (!assertRouteAccess(ctx, m.id)) return null;
      const b = redactBrainForMember(brain, ctx);
      return {
        number: m.routeNumber !== "" ? m.routeNumber : m.id,
        docId: m.id,
        name: m.name || null,
        brain: (b.routes || {})[m.routeNumber] || null,
        live: m,
      };
    }
  }
  // 2) Reference-brain fallback (legacy reference data only).
  const route = await resolveRoute(brain, input);
  if (!route) return null;
  const number = String(route.number);
  let docId: string | null = null;
  let name: string | null = null;
  if (bid) {
    try {
      const snap = await db.collection(`businesses/${bid}/routes`).get();
      const digits = number.replace(/\D/g, "");
      const territory = String(route.territory || "").toLowerCase();
      for (const d of snap.docs) {
        const data = d.data() as any;
        const rn = data.routeNumber != null ? String(data.routeNumber) : "";
        const nm = String(data.name || "");
        const nmLower = nm.toLowerCase();
        if (
          d.id === number ||
          (rn !== "" && (rn === number || rn.replace(/\D/g, "") === digits)) ||
          (digits.length >= 3 && nm.replace(/\D/g, "").includes(digits)) ||
          (territory.length >= 3 && nmLower.includes(territory))
        ) {
          docId = d.id;
          name = nm || null;
          break;
        }
      }
    } catch (e) {
      logger.warn("resolveRouteDoc: routes read failed", e);
    }
  }
  return { number, docId, name, brain: route, live: null };
}

// ─── Tools (provider-neutral definitions) ──────────────────────────────────
const TOOLS: NeutralTool[] = [
  {
    name: "get_business_overview",
    description:
      "Get the whole-operation overview: businesses, route count, weekly revenue baseline, " +
      "open alerts count, and driver count. Use for 'how is the business doing' questions.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "get_route_summary",
    description:
      "Get a summary for one route: territory, driver, business, truck, recent EOD notes " +
      "and any open alerts. Route can be a route number (e.g. '2080'), territory ('Stamford'), " +
      "or driver name.",
    parameters: {
      type: "object",
      properties: {
        route: { type: "string", description: "Route number, territory, or driver name" },
      },
      required: ["route"],
    },
  },
  {
    name: "get_driver_score",
    description:
      "Get the gamified Driver Score (0-100) breakdown for a route's driver: sales vs target, " +
      "stale rate, planogram compliance, fuel efficiency, data discipline. " +
      "Only sales-independent components are live until money feeds connect — say so.",
    parameters: {
      type: "object",
      properties: {
        route: { type: "string", description: "Route number, territory, or driver name" },
        week: { type: "string", description: "Week label, e.g. '2026-W39'. Defaults to current week." },
      },
      required: ["route"],
    },
  },
  {
    name: "get_eod_history",
    description: "Get recent end-of-day reports for a route, newest first.",
    parameters: {
      type: "object",
      properties: {
        route: { type: "string", description: "Route number, territory, or driver name" },
        limit: { type: "number", description: "How many reports (default 5, max 14)" },
      },
      required: ["route"],
    },
  },
  {
    name: "get_open_alerts",
    description: "List open operational alerts, optionally filtered to one route.",
    parameters: {
      type: "object",
      properties: {
        route: { type: "string", description: "Route number (optional)" },
      },
    },
  },
  {
    name: "log_eod_note",
    description:
      "Append a note to today's end-of-day report for a route. Use when the user dictates " +
      "EOD details (end location, pieces left, stales pulled, tomorrow's outlook).",
    parameters: {
      type: "object",
      properties: {
        route: { type: "string", description: "Route number, territory, or driver name" },
        note: { type: "string", description: "The EOD note text" },
      },
      required: ["route", "note"],
    },
  },
  {
    name: "create_alert",
    description:
      "Create an operational alert (e.g. truck issue, store problem, staffing gap). " +
      "Severity: info | warning | urgent.",
    parameters: {
      type: "object",
      properties: {
        route: { type: "string", description: "Route number (optional)" },
        title: { type: "string", description: "Short alert title" },
        detail: { type: "string", description: "Longer description" },
        severity: { type: "string", description: "info | warning | urgent (default warning)" },
      },
      required: ["title"],
    },
  },
  {
    name: "update_employee_status",
    description:
      "Add a status note to an employee record (e.g. 'called out sick', 'on vacation', " +
      "'back on route'). employeeId is the employee document id.",
    parameters: {
      type: "object",
      properties: {
        employeeId: { type: "string", description: "Employee document id" },
        statusNote: { type: "string", description: "The status note" },
      },
      required: ["employeeId", "statusNote"],
    },
  },
  {
    name: "escalate_to_gybs",
    description:
      "Escalate to GYBs (the human/AI ops team) when the request is out of scope: ordering " +
      "decisions, anything touching money or payroll, hiring/firing, or anything you're " +
      "unsure about. Writes to agentInbox for pickup. ALWAYS use this instead of guessing.",
    parameters: {
      type: "object",
      properties: {
        summary: { type: "string", description: "What the user needs, with context" },
      },
      required: ["summary"],
    },
  },
  // ── Onboarding tools (setup mode — owner only) ──────────────────────────
  {
    name: "get_onboarding_status",
    description:
      "Check what is still missing for setup: business name, route count, truck count, " +
      "team count, and pending data-feed requests. Call this first in setup mode.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "update_business_profile",
    description:
      "Set the business display name (owner only). Confirm with the user before calling.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Business display name" },
      },
      required: ["name"],
    },
  },
  {
    name: "create_route",
    description:
      "Create a route: bakery route number, territory name, bakery (owner only). " +
      "Confirm the details with the user before calling.",
    parameters: {
      type: "object",
      properties: {
        routeNumber: { type: "string", description: "Bakery route number, e.g. '2080'" },
        territory: { type: "string", description: "Territory name, e.g. 'Stamford / Greenwich'" },
        bakery: { type: "string", description: "Bakery, e.g. 'Bimbo', 'Flowers', or 'Other'" },
      },
      required: ["routeNumber", "territory"],
    },
  },
  {
    name: "create_truck",
    description:
      "Create a truck with a label/identifier and optionally assign it to a route " +
      "(owner only). Confirm the details with the user before calling.",
    parameters: {
      type: "object",
      properties: {
        label: { type: "string", description: "Truck label, plate, or identifier" },
        route: { type: "string", description: "Route number or name to assign it to (optional)" },
      },
      required: ["label"],
    },
  },
  {
    name: "add_team_member",
    description:
      "Add a team member (driver) and generate their invite code (owner only). " +
      "Returns the invite code — read it to the owner so they can text it to the driver. " +
      "Confirm the details with the user before calling.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Team member's name" },
        role: { type: "string", description: "Role: 'driver' (default) or 'business_manager'" },
        phone: { type: "string", description: "Phone number (optional)" },
        route: { type: "string", description: "Route number or name they drive (optional)" },
      },
      required: ["name"],
    },
  },
  {
    name: "complete_onboarding",
    description:
      "Mark setup complete. The backend enforces: business named, at least one " +
      "route exists, and data feeds requested or explicitly skipped — it refuses " +
      "otherwise. Call only when the interview is genuinely finished. " +
      "Sets the same flags as the manual wizard so the banner and wizard don't reappear.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "request_data_feed_connection",
    description:
      "Queue a data-feed connection request for GYBs to wire (owner only). " +
      "Use when the user wants a platform connected (bakery portals, telematics, " +
      "accounting). NEVER collect usernames, passwords, or API keys — there are no " +
      "credential fields; the secure connection happens outside chat.",
    parameters: {
      type: "object",
      properties: {
        platform: {
          type: "string",
          description: "Platform to connect, e.g. 'Bimbo ION', 'Flowers IDP', 'Samsara'",
        },
      },
      required: ["platform"],
    },
  },
  {
    name: "skip_setup_step",
    description:
      "Record that the owner declined a setup interview step (owner only). " +
      "Call when the user says skip / no / not now / later for trucks, team, or " +
      "data_feeds. This lets the interview move on honestly instead of pretending " +
      "the step was done.",
    parameters: {
      type: "object",
      properties: {
        step: {
          type: "string",
          description: "One of: trucks, team, data_feeds",
        },
      },
      required: ["step"],
    },
  },
];

// ─── Tool executors ────────────────────────────────────────────────────────
async function execBusinessOverview(ctx: UserCtx, brain: any): Promise<ToolResult> {
  const b = redactBrainForMember(brain, ctx);
  const businesses = b.businesses || {};
  const bid = ctx.businessIds[0];
  let routeCount = 0;
  let driverCount: number | null = null;
  let openAlerts = 0;
  if (bid) {
    try {
      const [rSnap, eSnap, aSnap] = await Promise.all([
        db.collection(`businesses/${bid}/routes`).get(),
        db.collection(`businesses/${bid}/employees`).get(),
        db.collection(`businesses/${bid}/alerts`).where("status", "==", "open").get(),
      ]);
      routeCount = rSnap.docs.filter(
        (d) => ctx.role === "owner" || ctx.routeIds.includes(d.id)
      ).length;
      driverCount = eSnap.docs.filter((d) => (d.data() as any).role === "driver").length;
      openAlerts = aSnap.size;
    } catch (e) {
      logger.warn("execBusinessOverview: Firestore read failed", e);
    }
  }
  return {
    ok: true,
    data: {
      businesses: Object.entries(businesses).map(([id, x]: any) => ({
        id,
        name: x.name,
        bakery: x.bakery,
      })),
      routeCount,
      weeklyBaseline: b.weeklyBaseline || null,
      openAlerts,
      driverCount,
      note: "Financials are baseline-level until bakery settlement feeds connect.",
    },
  };
}

async function execRouteSummary(
  ctx: UserCtx,
  brain: any,
  args: any
): Promise<ToolResult> {
  const route = await resolveRouteDoc(ctx, brain, args.route);
  if (!route) return { ok: false, error: `Couldn't find a route matching "${args.route}".` };
  if (!assertRouteAccess(ctx, route.docId)) {
    return { ok: false, error: "You don't have access to that route." };
  }
  const bid = ctx.businessIds[0];
  // Prefer live Firestore fields; the reference brain only fills gaps.
  const live = route.live;
  const brainRoute = route.brain || {};
  // recent EOD reports — the app's real collection
  let eod: any[] = [];
  if (bid && route.docId) {
    try {
      const snap = await db
        .collection(`businesses/${bid}/routes/${route.docId}/eod`)
        .orderBy("date", "desc")
        .limit(3)
        .get();
      eod = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    } catch (e) {
      logger.warn("execRouteSummary: eod read failed", e);
    }
  }
  // open operational alerts for route
  let alerts: any[] = [];
  if (bid) {
    try {
      let q: admin.firestore.Query = db
        .collection(`businesses/${bid}/alerts`)
        .where("status", "==", "open");
      if (route.docId) q = q.where("routeId", "==", route.docId);
      const snap = await q.get();
      alerts = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    } catch (e) {
      logger.warn("execRouteSummary: alerts read failed", e);
    }
  }
  return {
    ok: true,
    data: {
      routeNumber: route.number,
      territory: live?.name || route.name || brainRoute.territory || null,
      bakery: live?.bakery || brainRoute.bakery || null,
      driver: brainRoute.driver || null,
      business: brainRoute.business || null,
      truck: brainRoute.truck || null,
      vacant: !!brainRoute.vacant,
      routeDocId: route.docId,
      recentEod: eod,
      openAlerts: alerts,
      source: live ? "live" : "reference",
    },
  };
}
function scoreComponents() {
  // Weights per approved Driver Score design; sales-dependent parts marked pending.
  return [
    { key: "salesVsTarget", label: "Sales vs target", weight: 30, status: "pending_money_feed" },
    { key: "staleRate", label: "Stale rate", weight: 25, status: "pending_money_feed" },
    { key: "planogram", label: "Planogram compliance", weight: 15, status: "pending_money_feed" },
    { key: "fuel", label: "Fuel efficiency", weight: 15, status: "pending_money_feed" },
    { key: "dataDiscipline", label: "Data discipline", weight: 15, status: "live" },
  ];
}

async function execDriverScore(ctx: UserCtx, brain: any, args: any): Promise<ToolResult> {
  const route = await resolveRouteDoc(ctx, brain, args.route);
  if (!route) return { ok: false, error: `Couldn't find a route matching "${args.route}".` };
  if (!assertRouteAccess(ctx, route.docId)) {
    return { ok: false, error: "You don't have access to that route." };
  }
  const bid = ctx.businessIds[0];
  // Data discipline: EOD completion rate for the route over last 14 days.
  let discipline: any = { status: "no_data" };
  if (bid && route.docId) {
    try {
      const since = new Date();
      since.setDate(since.getDate() - 14);
      const sinceId = since.toISOString().slice(0, 10); // yyyy-mm-dd, string-comparable
      const snap = await db
        .collection(`businesses/${bid}/routes/${route.docId}/eod`)
        .where("date", ">=", sinceId)
        .get();
      const days = snap.size;
      const score = Math.min(100, Math.round((days / 12) * 100)); // ~6-day weeks
      discipline = { status: "ok", eodReportsLast14d: days, componentScore: score };
    } catch (e) {
      logger.warn("execDriverScore: eod read failed", e);
    }
  }
  return {
    ok: true,
    data: {
      routeNumber: route.number,
      driver: route.brain?.driver || null,
      week: args.week || "current",
      components: scoreComponents(),
      dataDiscipline: discipline,
      note: "Sales, stale, planogram and fuel components go live when bakery money feeds connect. Data discipline is live now.",
    },
  };
}

async function execEodHistory(ctx: UserCtx, _brain: any, args: any): Promise<ToolResult> {
  const brain = await loadBrain();
  const route = await resolveRouteDoc(ctx, brain, args.route);
  if (!route) return { ok: false, error: `Couldn't find a route matching "${args.route}".` };
  if (!assertRouteAccess(ctx, route.docId)) {
    return { ok: false, error: "You don't have access to that route." };
  }
  const bid = ctx.businessIds[0];
  if (!bid || !route.docId) {
    return { ok: false, error: "That route isn't linked to business data yet." };
  }
  const limit = Math.min(Math.max(parseInt(args.limit) || 5, 1), 14);
  try {
    const snap = await db
      .collection(`businesses/${bid}/routes/${route.docId}/eod`)
      .orderBy("date", "desc")
      .limit(limit)
      .get();
    return { ok: true, data: { routeNumber: route.number, reports: snap.docs.map((d) => ({ id: d.id, ...d.data() })) } };
  } catch (e) {
    logger.warn("execEodHistory: read failed", e);
    return { ok: false, error: "Couldn't load EOD history right now." };
  }
}

async function execOpenAlerts(ctx: UserCtx, brain: any, args: any): Promise<ToolResult> {
  const bid = ctx.businessIds[0];
  if (!bid) return { ok: false, error: "No business linked to your account." };
  let routeDocId: string | null = null;
  if (args.route) {
    const route = await resolveRouteDoc(ctx, brain, args.route);
    if (!route) return { ok: false, error: `Couldn't find a route matching "${args.route}".` };
    if (!assertRouteAccess(ctx, route.docId)) {
      return { ok: false, error: "You don't have access to that route." };
    }
    routeDocId = route.docId;
  }
  const alerts: any[] = [];
  try {
    // Operational alerts — canonical store, written by create_alert.
    let q: admin.firestore.Query = db
      .collection(`businesses/${bid}/alerts`)
      .where("status", "==", "open");
    if (routeDocId) q = q.where("routeId", "==", routeDocId);
    else if (ctx.role !== "owner" && ctx.routeIds.length)
      q = q.where("routeId", "in", ctx.routeIds.slice(0, 10));
    const snap = await q.orderBy("createdAt", "desc").limit(20).get();
    for (const d of snap.docs) alerts.push({ id: d.id, kind: "operational", ...d.data() });
  } catch (e) {
    logger.warn("execOpenAlerts: operational alerts read failed", e);
  }
  try {
    // Promo alerts — the app's saleAlerts. Included so nothing open is missed.
    const snap = await db.collection(`businesses/${bid}/saleAlerts`).get();
    for (const d of snap.docs) alerts.push({ id: d.id, kind: "promo", ...d.data() });
  } catch (e) {
    logger.warn("execOpenAlerts: saleAlerts read failed", e);
  }
  return { ok: true, data: { alerts: alerts.slice(0, 30) } };
}

async function execLogEodNote(
  ctx: UserCtx,
  brain: any,
  args: any,
  threadId: string
): Promise<ToolResult> {
  const route = await resolveRouteDoc(ctx, brain, args.route);
  if (!route) return { ok: false, error: `Couldn't find a route matching "${args.route}".` };
  if (!assertRouteAccess(ctx, route.docId)) {
    return { ok: false, error: "You don't have access to that route." };
  }
  if (!args.note || !String(args.note).trim()) {
    return { ok: false, error: "Note text is required." };
  }
  const bid = ctx.businessIds[0];
  if (!bid || !route.docId) {
    return { ok: false, error: "That route isn't linked to business data yet." };
  }
  const today = new Date().toISOString().slice(0, 10);
  try {
    // Additive-only: arrayUnion on the app's own day doc
    // (businesses/{bid}/routes/{rid}/eod/{yyyy-mm-dd}). Merge keeps every
    // driver-submitted field (piecesLeft, stalesPulled, ...) intact.
    const ref = db.collection(`businesses/${bid}/routes/${route.docId}/eod`).doc(today);
    await ref.set(
      {
        date: today,
        assistantNotes: admin.firestore.FieldValue.arrayUnion({
          text: String(args.note).trim(),
          by: ctx.uid,
          byName: ctx.name,
          at: new Date().toISOString(),
          via: "assistant",
          threadId,
        }),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return { ok: true, data: { routeNumber: route.number, date: today, saved: true } };
  } catch (e) {
    logger.warn("execLogEodNote: write failed", e);
    return { ok: false, error: "Couldn't save the EOD note right now." };
  }
}

async function execCreateAlert(ctx: UserCtx, brain: any, args: any): Promise<ToolResult> {
  const bid = ctx.businessIds[0];
  if (!bid) return { ok: false, error: "No business linked to your account." };
  let routeDocId: string | null = null;
  let routeNumber: string | null = null;
  if (args.route) {
    const route = await resolveRouteDoc(ctx, brain, args.route);
    if (!route) return { ok: false, error: `Couldn't find a route matching "${args.route}".` };
    if (!assertRouteAccess(ctx, route.docId)) {
      return { ok: false, error: "You don't have access to that route." };
    }
    routeDocId = route.docId;
    routeNumber = route.number;
  } else if (ctx.role === "driver" && ctx.routeIds.length === 1) {
    routeDocId = ctx.routeIds[0];
  }
  const severity = ["info", "warning", "urgent"].includes(args.severity)
    ? args.severity
    : "warning";
  try {
    // Canonical store: businesses/{bid}/alerts (operational alerts only —
    // promo requests live in saleAlerts). The app loads this collection too.
    const ref = await db.collection(`businesses/${bid}/alerts`).add({
      title: String(args.title).slice(0, 120),
      detail: args.detail ? String(args.detail).slice(0, 2000) : "",
      severity,
      routeId: routeDocId,
      routeNumber,
      status: "open",
      createdBy: ctx.uid,
      createdByName: ctx.name,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      via: "assistant",
    });
    return { ok: true, data: { alertId: ref.id, severity, routeId: routeDocId } };
  } catch (e) {
    logger.warn("execCreateAlert: write failed", e);
    return { ok: false, error: "Couldn't create the alert right now." };
  }
}

async function execUpdateEmployeeStatus(ctx: UserCtx, args: any): Promise<ToolResult> {
  const bid = ctx.businessIds[0];
  if (!bid) return { ok: false, error: "No business linked to your account." };
  // Only owner/managers may write employee status notes; drivers may only note themselves.
  // Employee identity is the employee DOCUMENT id — never the Firebase UID
  // (users/{uid}.employeeId holds it; see getUserCtx).
  const empRef = db.collection(`businesses/${bid}/employees`).doc(args.employeeId);
  const snap = await empRef.get();
  if (!snap.exists) return { ok: false, error: "Employee not found." };
  if (ctx.role === "driver" && args.employeeId !== ctx.employeeId) {
    return { ok: false, error: "You can only update your own status." };
  }
  try {
    await empRef.set(
      {
        statusNotes: admin.firestore.FieldValue.arrayUnion({
          text: String(args.statusNote).slice(0, 500),
          by: ctx.uid,
          byName: ctx.name,
          at: new Date().toISOString(),
          via: "assistant",
        }),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return { ok: true, data: { employeeId: args.employeeId, saved: true } };
  } catch (e) {
    logger.warn("execUpdateEmployeeStatus: write failed", e);
    return { ok: false, error: "Couldn't save the status note right now." };
  }
}

async function execEscalate(ctx: UserCtx, args: any, threadId: string): Promise<ToolResult> {
  try {
    await db.collection("agentInbox").add({
      type: "assistant_escalation",
      summary: String(args.summary).slice(0, 2000),
      fromUid: ctx.uid,
      fromName: ctx.name,
      fromRole: ctx.role,
      businessId: ctx.businessIds[0] || null, // Firestore rules filter inbox reads on this
      threadId,
      status: "open",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { ok: true, data: { escalated: true } };
  } catch (e) {
    logger.warn("execEscalate: write failed", e);
    return { ok: false, error: "Couldn't reach GYBs right now — please tell Chris directly." };
  }
}

// ─── Onboarding tools (setup mode — owner only) ────────────────────────────

/** All onboarding writes are owner-only. Returns an error result when not owner. */
function requireOwner(ctx: UserCtx): ToolResult | null {
  if (ctx.role !== "owner") {
    return { ok: false, error: "Only the business owner can change setup." };
  }
  if (!ctx.businessIds[0]) {
    return { ok: false, error: "No business linked to your account." };
  }
  return null;
}

/**
 * Find a Firestore route doc by route number or name (direct Firestore match,
 * not the brain — setup routes may not be in the brain yet).
 */
async function findRouteDoc(
  bid: string,
  ref: string
): Promise<{ id: string; data: any } | null> {
  const q = ref.trim().toLowerCase();
  const digits = ref.replace(/\D/g, "");
  try {
    const snap = await db.collection(`businesses/${bid}/routes`).get();
    for (const d of snap.docs) {
      const data = d.data() as any;
      const rn = data.routeNumber != null ? String(data.routeNumber) : "";
      const nm = String(data.name || "").toLowerCase();
      if (
        d.id === ref ||
        (rn !== "" && (rn === ref || rn.replace(/\D/g, "") === digits)) ||
        (digits.length >= 3 && nm.replace(/\D/g, "").includes(digits)) ||
        (q.length >= 3 && nm.includes(q))
      ) {
        return { id: d.id, data };
      }
    }
  } catch (e) {
    logger.warn("findRouteDoc: routes read failed", e);
  }
  return null;
}

async function execOnboardingStatus(ctx: UserCtx): Promise<ToolResult> {
  const denied = requireOwner(ctx);
  if (denied) return denied;
  const bid = ctx.businessIds[0];
  try {
    const [bSnap, rSnap, tSnap, eSnap, fSnap, uSnap] = await Promise.all([
      db.collection("businesses").doc(bid).get(),
      db.collection(`businesses/${bid}/routes`).get(),
      db.collection(`businesses/${bid}/trucks`).get(),
      db.collection(`businesses/${bid}/employees`).get(),
      db.collection(`businesses/${bid}/dataFeedRequests`).where("status", "==", "requested").get(),
      db.collection("users").doc(ctx.uid).get(),
    ]);
    const businessName = bSnap.exists ? (bSnap.data() as any).name || null : null;
    const routeCount = rSnap.size;
    const truckCount = tSnap.size;
    const teamCount = eSnap.size;
    const missing: string[] = [];
    if (!businessName) missing.push("business name");
    if (routeCount === 0) missing.push("routes");
    if (truckCount === 0) missing.push("trucks");
    if (teamCount === 0) missing.push("team");
    return {
      ok: true,
      data: {
        businessName,
        routeCount,
        truckCount,
        teamCount,
        pendingDataFeedRequests: fSnap.size,
        onboardingCompleted: uSnap.exists
          ? !!(uSnap.data() as any).onboardingCompleted
          : false,
        missing,
      },
    };
  } catch (e) {
    logger.warn("execOnboardingStatus: read failed", e);
    return { ok: false, error: "Couldn't check setup status right now." };
  }
}

async function execUpdateBusinessProfile(ctx: UserCtx, args: any): Promise<ToolResult> {
  const denied = requireOwner(ctx);
  if (denied) return denied;
  const name = String(args.name || "").trim();
  if (!name) return { ok: false, error: "A business name is required." };
  try {
    await db.collection("businesses").doc(ctx.businessIds[0]).set(
      { name: name.slice(0, 120), updatedAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true }
    );
    return { ok: true, data: { name } };
  } catch (e) {
    logger.warn("execUpdateBusinessProfile: write failed", e);
    return { ok: false, error: "Couldn't save the business name right now." };
  }
}

async function execCreateRoute(ctx: UserCtx, args: any): Promise<ToolResult> {
  const denied = requireOwner(ctx);
  if (denied) return denied;
  const routeNumber = String(args.routeNumber || "").trim();
  const territory = String(args.territory || "").trim();
  if (!routeNumber || !territory) {
    return { ok: false, error: "Route number and territory are required." };
  }
  const bid = ctx.businessIds[0];
  try {
    const ref = await db.collection(`businesses/${bid}/routes`).add({
      name: territory.slice(0, 120),
      routeNumber: routeNumber.slice(0, 24),
      bakery: args.bakery ? String(args.bakery).slice(0, 60) : null,
      stores: [],
      createdBy: ctx.uid,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      via: "assistant",
    });
    // The new route must be visible to the assistant immediately.
    liveRouteCache.delete(bid);
    return { ok: true, data: { routeId: ref.id, routeNumber, territory } };
  } catch (e) {
    logger.warn("execCreateRoute: write failed", e);
    return { ok: false, error: "Couldn't create the route right now." };
  }
}

async function execCreateTruck(ctx: UserCtx, args: any): Promise<ToolResult> {
  const denied = requireOwner(ctx);
  if (denied) return denied;
  const label = String(args.label || "").trim();
  if (!label) return { ok: false, error: "A truck label or plate is required." };
  const bid = ctx.businessIds[0];
  try {
    const ref = await db.collection(`businesses/${bid}/trucks`).add({
      plate: label.slice(0, 24),
      type: "Box truck",
      mileage: 0,
      lastService: "",
      healthStatus: "good",
      issues: [],
      maintenanceHistory: [],
      registrationExpiry: "",
      insuranceExpiry: "",
      dimensions: { height: 13.5, length: 26, weight: 26000 },
      upkeep: { tires: 100, oil: 100, brakes: 100 },
      createdBy: ctx.uid,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      via: "assistant",
    });
    // Optional route assignment: link the route doc back to this truck.
    let assignedRoute: string | null = null;
    if (args.route) {
      const match = await findRouteDoc(bid, String(args.route));
      if (match) {
        await db
          .collection(`businesses/${bid}/routes`)
          .doc(match.id)
          .set({ assignedTruckId: ref.id }, { merge: true });
        assignedRoute = match.data.name || match.id;
      }
    }
    return { ok: true, data: { truckId: ref.id, label, assignedRoute } };
  } catch (e) {
    logger.warn("execCreateTruck: write failed", e);
    return { ok: false, error: "Couldn't create the truck right now." };
  }
}

const INVITE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

async function execAddTeamMember(ctx: UserCtx, args: any): Promise<ToolResult> {
  const denied = requireOwner(ctx);
  if (denied) return denied;
  const name = String(args.name || "").trim();
  if (!name) return { ok: false, error: "A name is required." };
  const role = args.role === "business_manager" ? "business_manager" : "driver";
  const bid = ctx.businessIds[0];
  try {
    // Optional route link.
    let routeId: string | null = null;
    let routeName: string | null = null;
    if (args.route) {
      const match = await findRouteDoc(bid, String(args.route));
      if (match) {
        routeId = match.id;
        routeName = match.data.name || match.id;
      }
    }
    const empRef = await db.collection(`businesses/${bid}/employees`).add({
      name: name.slice(0, 120),
      role,
      phone: args.phone ? String(args.phone).slice(0, 32) : null,
      hoursThisWeek: 0,
      engagementScore: 0,
      status: "active",
      salesHistory: [],
      attendance: [],
      vacationDaysUsed: 0,
      sickDaysUsed: 0,
      assignedRoutes: routeId ? [routeId] : [],
      createdBy: ctx.uid,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      via: "assistant",
    });
    if (routeId) {
      await db
        .collection(`businesses/${bid}/employees`)
        .doc(empRef.id)
        .set({ userId: null, email: null }, { merge: true });
      await db
        .collection(`businesses/${bid}/routes`)
        .doc(routeId)
        .set({ assignedDriverId: empRef.id }, { merge: true });
    }
    // Invite code — same scheme as the owner-side DriverInvite component:
    // written to top-level `inviteCodes/{code}` (redeemed at join) and
    // mirrored under businesses/{bid}/invites/{code}.
    let code = "";
    for (let attempt = 0; attempt < 5 && !code; attempt++) {
      let candidate = "";
      for (let i = 0; i < 6; i++) {
        candidate += INVITE_CHARS[Math.floor(Math.random() * INVITE_CHARS.length)];
      }
      const exists = await db.collection("inviteCodes").doc(candidate).get();
      if (!exists.exists) code = candidate;
    }
    if (!code) {
      logger.warn("execAddTeamMember: invite code collision retries exhausted");
      return {
        ok: true,
        data: {
          employeeId: empRef.id,
          name,
          role,
          routeName,
          inviteCode: null,
          note: "Team member added, but the invite code needs generating from Routes → Driver Invite.",
        },
      };
    }
    const payload = {
      code,
      businessId: bid,
      routeId,
      routeName,
      createdBy: ctx.uid,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      usedCount: 0,
    };
    await db.collection("inviteCodes").doc(code).set(payload);
    await db.collection(`businesses/${bid}/invites`).doc(code).set(payload);
    return {
      ok: true,
      data: { employeeId: empRef.id, name, role, routeName, inviteCode: code },
    };
  } catch (e) {
    logger.warn("execAddTeamMember: write failed", e);
    return { ok: false, error: "Couldn't add the team member right now." };
  }
}

async function execCompleteOnboarding(
  ctx: UserCtx,
  threadId: string
): Promise<ToolResult> {
  const denied = requireOwner(ctx);
  if (denied) return denied;
  const bid = ctx.businessIds[0];
  // GUARD: never mark setup complete unless the essentials actually exist.
  // (The interview once claimed "done" with nothing written — this enforces it.)
  const progress = await getSetupProgress(bid, threadId);
  if (!progress.businessNamed) {
    return { ok: false, error: "Business name is still missing — can't complete setup yet." };
  }
  if (progress.routes === 0) {
    return { ok: false, error: "No routes exist yet — can't complete setup yet." };
  }
  if (progress.feedsRequested === 0 && !progress.feedsSkipped) {
    return {
      ok: false,
      error:
        "Data feeds haven't been addressed yet — ask which platforms to connect " +
        "(or record an explicit skip) before completing setup.",
    };
  }
  try {
    // Same flags the manual wizard sets — banner and wizard stay hidden after.
    await db.collection("users").doc(ctx.uid).set(
      {
        onboardingCompleted: true,
        onboardingCompletedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return { ok: true, data: { completed: true } };
  } catch (e) {
    logger.warn("execCompleteOnboarding: write failed", e);
    return { ok: false, error: "Couldn't mark setup complete right now." };
  }
}

// Live setup state for one business + interview thread. Ground truth the
// interview prompt is built on — the model must trust this over memory.
interface SetupProgress {
  businessNamed: boolean;
  businessName: string | null;
  routes: number;
  trucks: number;
  team: number;
  feedsRequested: number;
  feedsSkipped: boolean;
  trucksSkipped: boolean;
  teamSkipped: boolean;
}

async function getSetupProgress(bid: string, threadId: string): Promise<SetupProgress> {
  const empty: SetupProgress = {
    businessNamed: false,
    businessName: null,
    routes: 0,
    trucks: 0,
    team: 0,
    feedsRequested: 0,
    feedsSkipped: false,
    trucksSkipped: false,
    teamSkipped: false,
  };
  if (!bid) return empty;
  try {
    const [bSnap, rSnap, tSnap, eSnap, fSnap, thSnap] = await Promise.all([
      db.collection("businesses").doc(bid).get(),
      db.collection(`businesses/${bid}/routes`).get(),
      db.collection(`businesses/${bid}/trucks`).get(),
      db.collection(`businesses/${bid}/employees`).get(),
      db.collection(`businesses/${bid}/dataFeedRequests`).where("status", "==", "requested").get(),
      threadId
        ? db.collection(`businesses/${bid}/assistantThreads`).doc(threadId).get()
        : Promise.resolve(null as any),
    ]);
    // Count only docs that actually exist (phantom refs from failed writes don't count).
    const realDocs = (s: admin.firestore.QuerySnapshot) =>
      s.docs.filter((d) => {
        try {
          return d.exists;
        } catch {
          return true;
        }
      }).length;
    const skips = thSnap && thSnap.exists ? ((thSnap.data() as any).setupSkips || {}) : {};
    const name = bSnap.exists ? String((bSnap.data() as any).name || "").trim() : "";
    return {
      businessNamed: name.length > 0,
      businessName: name || null,
      routes: realDocs(rSnap),
      trucks: realDocs(tSnap),
      team: realDocs(eSnap),
      feedsRequested: fSnap.size,
      feedsSkipped: !!skips.data_feeds,
      trucksSkipped: !!skips.trucks,
      teamSkipped: !!skips.team,
    };
  } catch (e) {
    logger.warn("getSetupProgress: read failed", e);
    return empty;
  }
}

async function execSkipSetupStep(
  ctx: UserCtx,
  args: any,
  threadId: string
): Promise<ToolResult> {
  const denied = requireOwner(ctx);
  if (denied) return denied;
  const step = String(args.step || "").trim().toLowerCase();
  if (!["trucks", "team", "data_feeds"].includes(step)) {
    return { ok: false, error: "step must be one of: trucks, team, data_feeds." };
  }
  const bid = ctx.businessIds[0];
  try {
    // Dot-notation so concurrent skips merge instead of overwriting each other.
    await db
      .collection(`businesses/${bid}/assistantThreads`)
      .doc(threadId)
      .set(
        {
          [`setupSkips.${step}`]: true,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    return { ok: true, data: { step, skipped: true } };
  } catch (e) {
    logger.warn("execSkipSetupStep: write failed", e);
    return { ok: false, error: "Couldn't record the skip right now." };
  }
}

async function execRequestDataFeed(ctx: UserCtx, args: any): Promise<ToolResult> {
  const denied = requireOwner(ctx);
  if (denied) return denied;
  const platform = String(args.platform || "").trim();
  if (!platform) return { ok: false, error: "A platform name is required." };
  const bid = ctx.businessIds[0];
  try {
    // Queued for GYBs to wire — never credentials; no credential fields exist.
    await db.collection(`businesses/${bid}/dataFeedRequests`).add({
      platform: platform.slice(0, 120),
      status: "requested",
      requestedBy: ctx.uid,
      requestedByName: ctx.name,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      via: "assistant",
    });
    // Also drop it in the ops inbox so the GYBs loop picks it up.
    await db.collection("agentInbox").add({
      type: "data_feed_request",
      summary: `Data feed connection requested: ${platform} (business ${bid})`,
      fromUid: ctx.uid,
      fromName: ctx.name,
      fromRole: ctx.role,
      businessId: bid,
      status: "open",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { ok: true, data: { platform, status: "requested" } };
  } catch (e) {
    logger.warn("execRequestDataFeed: write failed", e);
    return { ok: false, error: "Couldn't queue the connection request right now." };
  }
}

async function runTool(
  ctx: UserCtx,
  name: string,
  args: any,
  brain: any,
  threadId: string
): Promise<ToolResult> {
  let result: ToolResult;
  switch (name) {
    case "get_business_overview":
      result = await execBusinessOverview(ctx, brain);
      break;
    case "get_route_summary":
      result = await execRouteSummary(ctx, brain, args);
      break;
    case "get_driver_score":
      result = await execDriverScore(ctx, brain, args);
      break;
    case "get_eod_history":
      result = await execEodHistory(ctx, brain, args);
      break;
    case "get_open_alerts":
      result = await execOpenAlerts(ctx, brain, args);
      break;
    case "log_eod_note":
      result = await execLogEodNote(ctx, brain, args, threadId);
      break;
    case "create_alert":
      result = await execCreateAlert(ctx, brain, args);
      break;
    case "update_employee_status":
      result = await execUpdateEmployeeStatus(ctx, args);
      break;
    case "escalate_to_gybs":
      result = await execEscalate(ctx, args, threadId);
      break;
    case "get_onboarding_status":
      result = await execOnboardingStatus(ctx);
      break;
    case "update_business_profile":
      result = await execUpdateBusinessProfile(ctx, args);
      break;
    case "create_route":
      result = await execCreateRoute(ctx, args);
      break;
    case "create_truck":
      result = await execCreateTruck(ctx, args);
      break;
    case "add_team_member":
      result = await execAddTeamMember(ctx, args);
      break;
    case "complete_onboarding":
      result = await execCompleteOnboarding(ctx, threadId);
      break;
    case "request_data_feed_connection":
      result = await execRequestDataFeed(ctx, args);
      break;
    case "skip_setup_step":
      result = await execSkipSetupStep(ctx, args, threadId);
      break;
    default:
      result = { ok: false, error: `Unknown tool: ${name}` };
  }
  // Observability: every tool call leaves a trace (name + outcome only —
  // never argument values, which may contain names or other PII).
  logger.info("assistant tool", {
    tool: name,
    ok: result.ok,
    ...(result.ok ? {} : { error: result.error }),
  });
  return result;
}

// ─── Prompt building ───────────────────────────────────────────────────────
async function buildScopedContext(ctx: UserCtx, brain: any): Promise<any> {
  const b = redactBrainForMember(brain, ctx);
  const bid = ctx.businessIds[0];
  const live = bid ? await listLiveRoutes(bid) : [];
  const visibleLive =
    ctx.role === "owner"
      ? live
      : live.filter(
          (r) =>
            ctx.routeIds.includes(r.id) ||
            (r.routeNumber !== "" && ctx.routeIds.includes(r.routeNumber))
        );
  return {
    thisBusiness: {
      businessId: bid || null,
      // LIVE — the actual routes in THIS business right now. This is the only
      // source of truth for "what routes / trucks / team does this business have".
      routes: visibleLive,
    },
    reference: {
      // Background knowledge about a reference operation (formulas, operating
      // rules, baselines). NEVER present these as belonging to this business.
      businesses: b.businesses,
      drivers: b.drivers,
      operatingRules: b.operatingRules,
      flowersFormula: b.flowersFormula,
      weeklyBaseline: b.weeklyBaseline,
    },
  };
}

function buildSystemPrompt(ctx: UserCtx, brain: any, scoped: any, setupMode: boolean): string {
  const roleLine =
    ctx.role === "owner"
      ? "You are assisting Chris, the owner of the whole operation."
      : ctx.role === "business_manager"
        ? `You are assisting ${ctx.name}, a business manager (businesses: ${(ctx.businessIds || []).join(", ") || "assigned"}).`
        : `You are assisting ${ctx.name}, a driver. They can ONLY see their assigned route(s): ${(ctx.routeIds || []).join(", ") || "none assigned"}.`;

  const setupSection = setupMode
    ? `

SETUP MODE — guided onboarding interview. The owner just signed in and their
setup is incomplete. You are running the interview; they just answer.
- FIRST: call get_onboarding_status to see exactly what is missing, then greet
  the owner warmly by name and explain you'll get them set up in a few minutes.
- Interview order: (1) business name, (2) routes — for each: bakery route
  number, territory name, bakery (Bimbo / Flowers / other), (3) trucks —
  label/plate and which route it serves, (4) team — for each: name, role
  (driver), route; after adding a team member, READ the invite code to the
  owner and tell them to text it to that driver so they can join, (5) data
  feeds — ask which platforms they want connected. For bakery portals
  (Bimbo ION, Flowers iPlan, Flowers IDP), direct the owner to the Data Hub:
  each source card has a "Connect securely" button that opens the secure
  vault form — that is the ONLY way bakery logins are collected. For
  non-bakery platforms (telematics, accounting), use
  request_data_feed_connection.
- Ask ONE question at a time and wait for the answer. Keep a mental checklist;
  move on only when the current item is answered. The user may answer in
  English or Spanish — mirror their language entirely.
- CONFIRM BEFORE EVERY WRITE: state exactly what you will create
  ("I'll add route 2080 for Stamford — correct?") and call the write tool only
  after they confirm. Never batch unconfirmed writes.
- HONESTY ABOUT WRITES (hard rule): only tell the user something was created,
  added, set, or done AFTER the matching tool returns ok:true IN THIS
  conversation. Never claim a write succeeded from memory or assumption. If a
  tool returns ok:false, say exactly what failed and ask how to proceed — never
  paper over it with a cheerful "done".
- After the user answers a step, CALL THE TOOL for it — do not just acknowledge
  the answer and move on. Every interview step must end in a tool call
  (the write tool, or skip_setup_step).
- If the user declines a step, call skip_setup_step IMMEDIATELY — do not ask
  again and do not wait for a magic phrase. A decline sounds like ANY of:
  "skip", "not now", "no", "nope", "nah", "later", "maybe later", "pass",
  "I don't need this right now", "not interested", or any similar brush-off —
  for trucks, team, or data_feeds. When in doubt whether it was a decline,
  treat it as one and call skip_setup_step. Never mark a declined step as done,
  and never leave a declined step unrecorded.
- CREDENTIALS: NEVER ask for, accept, or store passwords, logins, or API keys.
  If the user offers one, politely refuse: explain you can't take passwords in
  chat, and offer the secure path instead — for bakery portals (Bimbo ION,
  Flowers iPlan, Flowers IDP) point them to the Data Hub "Connect securely"
  button, which saves the login to a secure vault only GYBs can reach; for
  other platforms use the platform's own login/OAuth, or
  request_data_feed_connection so GYBs wires it during setup. No credential
  fields exist on any tool; never invent them.
- When the business is named, at least one route exists, and data feeds are
  requested or explicitly skipped (trucks/team may be skipped), call
  complete_onboarding, congratulate them, and summarize what was set up.
  The tool enforces these requirements and will refuse if they aren't met —
  if it refuses, go back and finish the missing step instead of arguing.
  Mention they can change anything later by just chatting, or use MENU →
  Setup guide for the manual step-by-step wizard.
- If the user goes off-topic, answer briefly and steer back to the interview.`
    : "";

  return `You are the TruckCEO in-app AI assistant — the operational brain for a bread-route distribution business in CT / lower NY.

${roleLine}

KNOWLEDGE — two separate parts, never mix them:
1. THIS BUSINESS — live database state for the signed-in user's business RIGHT
   NOW. This is the ONLY source of truth for what routes, trucks, and team
   members THIS business has:
${JSON.stringify(scoped.thisBusiness).slice(0, 6000)}
2. REFERENCE — background knowledge about a reference operation (formulas,
   operating rules, baselines):
${JSON.stringify(scoped.reference).slice(0, 8000)}

CRITICAL — data honesty: the REFERENCE section describes a different/reference
operation. NEVER present its routes, drivers, trucks, territories, or numbers
as belonging to this business. When asked what routes, team, or trucks THIS
business has, use ONLY section 1. If section 1 shows zero routes, say the
business has none set up yet — never fill the gap with reference data.

HARD RULES — never break these:
1. ORDERING IS RECOMMEND-ONLY. You may suggest order quantities, but you NEVER place, change, or confirm orders. There are no order tools — if asked to place an order, explain you can only recommend and escalate_to_gybs if they insist.
2. DRIVER PRIVACY: drivers must NEVER see driver pay (their own or others'). The knowledge above is already redacted — never invent pay figures.
3. NEVER estimate route net profit until bakery settlement feeds are connected. Say it's pending the money feed.
4. SCOPE: drivers only get their assigned routes. If asked about another route, refuse politely and offer their own.
5. ESCALATE, don't guess: ordering decisions, money/payroll, hiring/firing, or anything uncertain → escalate_to_gybs. Say you've handed it to GYBs.
6. Be concise, plain-spoken, and practical. This is a driver/operator audience, not analysts. Short answers, no jargon. Keep answers short enough to be read aloud comfortably — responses may be spoken back as audio.
7. When you take an action (log a note, create an alert, update a status), confirm what you did in one line.
8. In the reference operation, Stratford Flowers route 7823 is currently VACANT (driver departed) — don't attribute a driver to it. This applies to the reference data only, not to the signed-in user's business.
9. LANGUAGE: the user may write in English or Spanish — many drivers are Spanish-speaking. Always detect the user's language and respond ENTIRELY in that same language. Be natural and conversational in both; never mix languages in one reply unless the user does.
${setupSection}

TOOLS: use them for live data (routes, scores, EOD, alerts) and for writes. You can chain multiple tool calls. After tool results, answer in natural language.`;
}

// ─── Assistant turn (provider-dispatched) ───────────────────────────────────
async function runAssistantTurn(
  provider: ChatProvider,
  apiKey: string,
  model: string,
  ctx: UserCtx,
  brain: any,
  threadId: string,
  history: Array<{ role: "user" | "model"; text: string }>,
  message: string,
  setupMode: boolean
): Promise<TurnResult> {
  const scoped = await buildScopedContext(ctx, brain);
  let systemInstruction = buildSystemPrompt(ctx, brain, scoped, setupMode);

  // In setup mode, ground every turn in live database state so the interview
  // can never drift from reality (e.g. claiming a write that never landed).
  if (setupMode && ctx.businessIds[0]) {
    try {
      const p = await getSetupProgress(ctx.businessIds[0], threadId);
      const next = !p.businessNamed
        ? "ask for the business name"
        : p.routes === 0
          ? "ask for the first route (number, territory, bakery)"
          : p.trucks === 0 && !p.trucksSkipped
            ? "ask for a truck (label/plate and route)"
            : p.team === 0 && !p.teamSkipped
              ? "ask for a team member (name, role, route)"
              : p.feedsRequested === 0 && !p.feedsSkipped
                ? "ask which data-feed platforms to connect"
                : "interview is complete — call complete_onboarding";
      systemInstruction +=
        `\n\nSETUP PROGRESS — live database state (ground truth; trust this over ` +
        `your conversation memory):\n` +
        `- Business named: ${p.businessNamed ? `yes ("${p.businessName}")` : "NO"}\n` +
        `- Routes: ${p.routes} | Trucks: ${p.trucks}${p.trucksSkipped ? " (skipped)" : ""} | ` +
        `Team: ${p.team}${p.teamSkipped ? " (skipped)" : ""}\n` +
        `- Data feeds: ${p.feedsRequested > 0 ? `${p.feedsRequested} requested` : p.feedsSkipped ? "skipped" : "NOT YET ADDRESSED"}\n` +
        `Your next required step: ${next}.`;
    } catch (e) {
      logger.warn("runAssistantTurn: setup progress check failed", e);
    }
  }

  const turn = await provider.runTurn({
    apiKey,
    model,
    systemInstruction,
    history,
    message,
    tools: TOOLS,
    maxRounds: MAX_TOOL_ROUNDS,
    executeTool: (name, args) => runTool(ctx, name, args, brain, threadId),
  });

  const escalated = turn.toolCalls.some(
    (t) => t.name === "escalate_to_gybs" && t.ok
  );
  let finalText = turn.text;
  if (escalated && !/gybs/i.test(finalText)) {
    finalText +=
      "\n\nI've handed this to GYBs — you'll see the follow-up right here in this thread.";
  }
  return { text: finalText, toolCalls: turn.toolCalls, escalated };
}

// ─── Thread persistence ────────────────────────────────────────────────────
// Threads live under the business so the app UI shares the exact same history:
//   businesses/{bid}/assistantThreads/{tid}/messages
// (see services/assistantService.ts -> loadLatestThread). Message docs use
// `createdAt`; threads carry createdAt/updatedAt.
async function loadThreadHistory(
  bid: string,
  threadId: string,
  limit = 20
): Promise<Array<{ role: "user" | "model"; text: string }>> {
  try {
    const snap = await db
      .collection(`businesses/${bid}/assistantThreads`)
      .doc(threadId)
      .collection("messages")
      .orderBy("createdAt", "desc")
      .limit(limit)
      .get();
    return snap.docs
      .map((d) => {
        const m = d.data() as any;
        return {
          role: m.role === "assistant" ? ("model" as const) : ("user" as const),
          text: String(m.text || "").slice(0, 4000),
        };
      })
      .reverse();
  } catch (e) {
    logger.warn("loadThreadHistory failed", e);
    return [];
  }
}

async function saveThreadMessage(
  bid: string,
  threadId: string,
  role: "user" | "assistant",
  text: string,
  extra: any = {}
): Promise<void> {
  const ref = db.collection(`businesses/${bid}/assistantThreads`).doc(threadId);
  await ref.set(
    { updatedAt: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true }
  );
  await ref.collection("messages").add({
    role,
    text: String(text).slice(0, 8000),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    ...extra,
  });
}

// ─── HTTP entrypoint ───────────────────────────────────────────────────────
export const askAssistant = onRequest(
  {
    region: "us-central1",
    cors: true,
    timeoutSeconds: 120,
    memory: "512MiB",
    // NOTE: META_MODEL_API_KEY dropped from deploy secrets — Meta was dropped as a
    // provider backup (no key provisioned). Re-add here if a Meta key is ever created.
    secrets: ["GEMINI_API_KEY", "OPENAI_API_KEY"],
  },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).json({ error: "POST only" });
      return;
    }

    // Auth
    const ctx = await getUserCtx(req);
    if (!ctx) {
      res.status(401).json({ error: "Sign in to use the assistant." });
      return;
    }

    // Rate limit
    if (!(await checkRateLimit(ctx.uid))) {
      res.status(429).json({ error: "Slow down a little — try again in a few minutes." });
      return;
    }

    const { message, threadId: clientThreadId, setupMode: clientSetupMode } = req.body || {};
    if (!message || !String(message).trim()) {
      res.status(400).json({ error: "Message is required." });
      return;
    }

    // Setup mode is an owner-only interview flow: the frontend passes
    // setupMode=true when an owner signs in with incomplete setup. Never
    // honor it for other roles (it unlocks owner-only write tools).
    const setupMode = clientSetupMode === true && ctx.role === "owner";
    // The frontend auto-opens the panel and sends this trigger so the
    // assistant greets the owner and starts the interview. Map it to a clean
    // instruction so the raw marker never lands in thread history.
    const SETUP_TRIGGER = "__setup_start__";
    const effectiveMessage =
      String(message).trim() === SETUP_TRIGGER && setupMode
        ? "Start the guided setup interview."
        : String(message);

    try {
      // Brain
      let brain: any = null;
      try {
        brain = await loadBrain();
      } catch (e) {
        logger.error("askAssistant: brain unavailable", e);
      }
      if (!brain) {
        res.status(503).json({ error: "Assistant knowledge is loading — try again shortly." });
        return;
      }

      // Provider selection — only the ACTIVE provider's key is required at runtime.
      let provider: ChatProvider;
      try {
        provider = getProvider(MODEL_PROVIDER);
      } catch (e: any) {
        logger.error("askAssistant: bad MODEL_PROVIDER", MODEL_PROVIDER);
        res.status(500).json({ error: "Assistant is misconfigured." });
        return;
      }
      const apiKey = process.env[provider.keyEnvVar];
      if (!apiKey) {
        logger.error(
          `askAssistant: ${provider.keyEnvVar} secret not available (MODEL_PROVIDER=${MODEL_PROVIDER})`
        );
        res.status(503).json({ error: "Assistant is temporarily unavailable." });
        return;
      }
      // Model: env override wins so a future model retirement never needs a code change.
      const model = process.env.MODEL_NAME || PROVIDER_MODELS[MODEL_PROVIDER];

      // Thread — persisted under the business so the app UI shares the same
      // history (services/assistantService.ts reads businesses/{bid}/assistantThreads).
      const bid = ctx.businessIds[0];
      if (!bid) {
        res.status(403).json({ error: "No business is linked to your account." });
        return;
      }
      let threadId: string | null =
        typeof clientThreadId === "string" && clientThreadId ? clientThreadId : null;
      if (threadId) {
        // Never let a client-supplied id reach into another business's threads.
        const tSnap = await db
          .collection(`businesses/${bid}/assistantThreads`)
          .doc(threadId)
          .get();
        if (!tSnap.exists) threadId = null;
      }
      if (!threadId) {
        threadId = (
          await db.collection(`businesses/${bid}/assistantThreads`).add({
            uid: ctx.uid,
            businessId: bid,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          })
        ).id;
      }
      const history = await loadThreadHistory(bid, threadId);

      await saveThreadMessage(bid, threadId, "user", effectiveMessage);

      // Turn
      // Gemini is primary; OpenAI is the provisioned backup. If the primary
      // fails with a transient error (429/503/500) even after its own retries,
      // fail over to the backup once rather than failing the whole turn.
      let turn: TurnResult;
      let providerName = MODEL_PROVIDER;
      let modelName = model;
      try {
        turn = await runAssistantTurn(
          provider,
          apiKey,
          model,
          ctx,
          brain,
          threadId,
          history,
          effectiveMessage,
          setupMode
        );
      } catch (e: any) {
        const status = e?.status ?? e?.error?.code;
        const transient = status === 429 || status === 503 || status === 500;
        const fallbackKey = process.env.OPENAI_API_KEY;
        if (!transient || MODEL_PROVIDER === "openai" || !fallbackKey) throw e;
        logger.warn(
          `askAssistant: primary ${MODEL_PROVIDER} failed (${status}), failing over to openai`
        );
        const fbProvider = getProvider("openai");
        const fbModel = process.env.OPENAI_MODEL || PROVIDER_MODELS["openai"];
        turn = await runAssistantTurn(
          fbProvider,
          fallbackKey,
          fbModel,
          ctx,
          brain,
          threadId,
          history,
          effectiveMessage,
          setupMode
        );
        providerName = "openai";
        modelName = fbModel;
      }

      await saveThreadMessage(bid, threadId, "assistant", turn.text, {
        toolCalls: turn.toolCalls.map((t) => ({ name: t.name, ok: t.ok })),
        escalated: turn.escalated,
        provider: providerName,
        model: modelName,
      });

      res.status(200).json({
        text: turn.text,
        toolCalls: turn.toolCalls,
        threadId,
        escalated: turn.escalated,
      });
    } catch (e: any) {
      logger.error("askAssistant failed", e);
      // Never leak provider internals to the client.
      res.status(500).json({ error: "Something went wrong — please try again." });
    }
  }
);

// ─── Secure bakery-credential vault ─────────────────────────────────────────
/**
 * POST /api/saveFeedCredentials — owner-only secure capture for bakery portal
 * logins (Bimbo ION, Flowers iPlan, Flowers IDP).
 *
 * The credential is stored in Google Secret Manager (backend-only, readable by
 * GYBs agent loops — never by clients). Firestore only gets a non-secret
 * status doc at businesses/{bid}/connections/{slug} so the Data Hub can show
 * "Pending — GYBs wiring". The password NEVER touches Firestore and is NEVER
 * logged. Chat has no credential fields and must never accept passwords.
 */
const FEED_PLATFORMS: Record<string, string> = {
  "bimbo-ion": "Bimbo ION",
  "flowers-iplan": "Flowers iPlan",
  "flowers-idp": "Flowers IDP Portal",
};

const secretClient = new SecretManagerServiceClient();

/** Return the full resource name of the secret, creating it (automatic replication) if missing. */
async function getOrCreateFeedSecret(secretId: string, parent: string): Promise<string> {
  const name = `${parent}/secrets/${secretId}`;
  try {
    await secretClient.getSecret({ name });
  } catch (e: any) {
    if (e?.code === 5) {
      // NOT_FOUND — create with automatic replication.
      await secretClient.createSecret({
        parent,
        secretId,
        secret: { replication: { automatic: {} } },
      });
    } else {
      throw e;
    }
  }
  return name;
}

export const saveFeedCredentials = onRequest(
  {
    region: "us-central1",
    cors: true,
    timeoutSeconds: 30,
    memory: "256MiB",
  },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).json({ error: "POST only" });
      return;
    }

    // Auth: Firebase ID token (same helper as the assistant).
    // Everything below is inside try/catch so a failure always returns JSON
    // (never a blank non-JSON 500 the app can't parse).
    try {
      const ctx = await getUserCtx(req);
      if (!ctx) {
        res.status(401).json({ error: "Sign in to connect a data feed." });
        return;
      }

      // Owner only.
      const denied = requireOwner(ctx);
      if (denied) {
        res
          .status(403)
          .json({ error: denied.error || "Only the business owner can connect data feeds." });
        return;
      }

      // Rate limit.
      if (!(await checkRateLimit(ctx.uid))) {
        res.status(429).json({ error: "Slow down a little — try again in a few minutes." });
        return;
      }

    const { platform, username, password } = req.body || {};
    const label = FEED_PLATFORMS[String(platform || "")];
    if (!label) {
      res.status(400).json({ error: "Unknown platform." });
      return;
    }
    const u = typeof username === "string" ? username.trim().slice(0, 320) : "";
    const p = typeof password === "string" ? password.slice(0, 512) : "";
    if (!u || !p) {
      res.status(400).json({ error: "Username and password are required." });
      return;
    }

    const bid = ctx.businessIds[0];
    const slug = String(platform);
    let projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || "";
    if (!projectId && process.env.FIREBASE_CONFIG) {
      try {
        projectId = JSON.parse(process.env.FIREBASE_CONFIG).projectId || "";
      } catch {
        projectId = "";
      }
    }
    if (!projectId) {
      logger.error("saveFeedCredentials: no project id in environment");
      res.status(500).json({ error: "Couldn't save the credentials right now — try again." });
      return;
    }

    try {
      // Secret Manager: one secret per business+platform; every save adds a
      // new version so old credentials are rotated, never overwritten.
      const parent = `projects/${projectId}`;
      const secretName = await getOrCreateFeedSecret(`truckceo-feed-${bid}-${slug}`, parent);
      await secretClient.addSecretVersion({
        parent: secretName,
        payload: {
          data: Buffer.from(
            JSON.stringify({
              username: u,
              password: p,
              savedBy: ctx.uid,
              savedAt: new Date().toISOString(),
            }),
            "utf8"
          ),
        },
      });

      // Firestore: status doc only — NEVER credentials. Both username and
      // password live only in Secret Manager; nothing identifying goes here.
      await db
        .collection(`businesses/${bid}/connections`)
        .doc(slug)
        .set(
          {
            platform: slug,
            label,
            status: "pending",
            requestedBy: ctx.uid,
            requestedAt: admin.firestore.FieldValue.serverTimestamp(),
            secretName,
          },
          { merge: true }
        );

      logger.info("saveFeedCredentials: saved", { platform: slug, business: bid });
      res.status(200).json({ ok: true, platform: slug, status: "pending" });
    } catch (e: any) {
      // Log the cause (message + code only — never credential values) so a
      // vault failure is diagnosable in Cloud Logging instead of a blank 500.
      logger.error("saveFeedCredentials failed", {
        platform: slug,
        message: e?.message || String(e),
        code: e?.code,
      });
      res.status(500).json({ error: "Couldn't save the credentials right now — try again." });
    }
    } catch (e: any) {
      // Outer safety net: something in auth/validation threw — always answer
      // with JSON so the app never sees a blank non-JSON 500.
      logger.error("saveFeedCredentials failed before vault write", {
        message: e?.message || String(e),
      });
      if (!res.headersSent) {
        res.status(500).json({ error: "Couldn't save the credentials right now — try again." });
      }
    }
  }
);
