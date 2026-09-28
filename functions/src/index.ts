/**
 * TruckCEO in-app AI assistant — askAssistant (Gemini-primary, provider abstraction)
 *
 * Backend intelligence for the TruckCEO app. Exposes a single HTTPS callable
 * surface `/api/askAssistant` (Firebase rewrite) backed by a chat model with
 * 9 server-side tools:
 *
 * Reads:  get_business_overview, get_route_summary, get_driver_score,
 *         get_eod_history, get_open_alerts
 * Writes: log_eod_note, create_alert, update_employee_status, escalate_to_gybs
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

// ─── Auth / user context / rate limit ──────────────────────────────────────
async function getUserCtx(req: any): Promise<UserCtx | null> {
  const auth = req.headers.authorization || "";
  const m = auth.match(/^Bearer (.+)$/);
  if (!m) return null;
  let decoded: admin.auth.DecodedIdToken;
  try {
    decoded = await admin.auth().verifyIdToken(m[1]);
  } catch {
    return null;
  }
  const uid = decoded.uid;
  const empSnap = await db.collection("employees").doc(uid).get();
  if (!empSnap.exists) return null;
  const emp = empSnap.data() as any;
  const role = emp.role;
  if (!["owner", "business_manager", "driver"].includes(role)) return null;
  return {
    uid,
    role,
    businessIds: emp.businessIds || [],
    routeIds: emp.routeIds || [],
    name: emp.name || decoded.name || "there",
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

function assertRouteAccess(ctx: UserCtx, routeId: string | undefined): boolean {
  if (!routeId) return true; // tool decides scoping
  if (ctx.role === "owner") return true;
  return ctx.routeIds.includes(routeId);
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
];

// ─── Tool executors ────────────────────────────────────────────────────────
async function execBusinessOverview(ctx: UserCtx, brain: any): Promise<ToolResult> {
  const b = redactBrainForMember(brain, ctx);
  const businesses = b.businesses || {};
  const routes = b.routes || {};
  const routeNums = Object.keys(routes);
  const visibleRoutes =
    ctx.role === "owner" ? routeNums : routeNums.filter((n) => ctx.routeIds.includes(n));
  let openAlerts = 0;
  try {
    const snap = await db.collection("alerts").where("status", "==", "open").get();
    openAlerts = snap.size;
  } catch (e) {
    logger.warn("execBusinessOverview: alerts read failed", e);
  }
  return {
    ok: true,
    data: {
      businesses: Object.entries(businesses).map(([id, x]: any) => ({
        id,
        name: x.name,
        bakery: x.bakery,
      })),
      routeCount: visibleRoutes.length,
      weeklyBaseline: b.weeklyBaseline || null,
      openAlerts,
      driverCount: b.drivers ? Object.keys(b.drivers).length : null,
      note: "Financials are baseline-level until bakery settlement feeds connect.",
    },
  };
}

async function execRouteSummary(
  ctx: UserCtx,
  brain: any,
  args: any
): Promise<ToolResult> {
  const route = await resolveRoute(brain, args.route);
  if (!route) return { ok: false, error: `Couldn't find a route matching "${args.route}".` };
  if (!assertRouteAccess(ctx, route.number)) {
    return { ok: false, error: "You don't have access to that route." };
  }
  const b = redactBrainForMember(brain, ctx);
  const brainRoute = (b.routes || {})[route.number] || {};
  // recent EOD notes
  let eod: any[] = [];
  try {
    const snap = await db
      .collection("eodReports")
      .where("routeId", "==", route.number)
      .orderBy("createdAt", "desc")
      .limit(3)
      .get();
    eod = snap.docs.map((d) => d.data());
  } catch (e) {
    logger.warn("execRouteSummary: eod read failed", e);
  }
  // open alerts for route
  let alerts: any[] = [];
  try {
    const snap = await db
      .collection("alerts")
      .where("status", "==", "open")
      .where("routeId", "==", route.number)
      .get();
    alerts = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (e) {
    logger.warn("execRouteSummary: alerts read failed", e);
  }
  return {
    ok: true,
    data: {
      routeNumber: route.number,
      territory: brainRoute.territory,
      driver: brainRoute.driver,
      business: brainRoute.business,
      truck: brainRoute.truck,
      vacant: !!brainRoute.vacant,
      recentEod: eod,
      openAlerts: alerts,
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
  const route = await resolveRoute(brain, args.route);
  if (!route) return { ok: false, error: `Couldn't find a route matching "${args.route}".` };
  if (!assertRouteAccess(ctx, route.number)) {
    return { ok: false, error: "You don't have access to that route." };
  }
  // Data discipline: EOD completion rate for the route over last 14 days.
  let discipline: any = { status: "no_data" };
  try {
    const since = new Date();
    since.setDate(since.getDate() - 14);
    const snap = await db
      .collection("eodReports")
      .where("routeId", "==", route.number)
      .where("createdAt", ">=", since)
      .get();
    const days = snap.size;
    const score = Math.min(100, Math.round((days / 12) * 100)); // ~6-day weeks
    discipline = { status: "ok", eodReportsLast14d: days, componentScore: score };
  } catch (e) {
    logger.warn("execDriverScore: eod read failed", e);
  }
  return {
    ok: true,
    data: {
      routeNumber: route.number,
      driver: route.driver,
      week: args.week || "current",
      components: scoreComponents(),
      dataDiscipline: discipline,
      note: "Sales, stale, planogram and fuel components go live when bakery money feeds connect. Data discipline is live now.",
    },
  };
}

async function execEodHistory(ctx: UserCtx, _brain: any, args: any): Promise<ToolResult> {
  const brain = await loadBrain();
  const route = await resolveRoute(brain, args.route);
  if (!route) return { ok: false, error: `Couldn't find a route matching "${args.route}".` };
  if (!assertRouteAccess(ctx, route.number)) {
    return { ok: false, error: "You don't have access to that route." };
  }
  const limit = Math.min(Math.max(parseInt(args.limit) || 5, 1), 14);
  try {
    const snap = await db
      .collection("eodReports")
      .where("routeId", "==", route.number)
      .orderBy("createdAt", "desc")
      .limit(limit)
      .get();
    return { ok: true, data: { routeNumber: route.number, reports: snap.docs.map((d) => ({ id: d.id, ...d.data() })) } };
  } catch (e) {
    logger.warn("execEodHistory: read failed", e);
    return { ok: false, error: "Couldn't load EOD history right now." };
  }
}

async function execOpenAlerts(ctx: UserCtx, brain: any, args: any): Promise<ToolResult> {
  let routeNumber: string | undefined;
  if (args.route) {
    const route = await resolveRoute(brain, args.route);
    if (!route) return { ok: false, error: `Couldn't find a route matching "${args.route}".` };
    if (!assertRouteAccess(ctx, route.number)) {
      return { ok: false, error: "You don't have access to that route." };
    }
    routeNumber = route.number;
  }
  try {
    let q: admin.firestore.Query = db.collection("alerts").where("status", "==", "open");
    if (routeNumber) q = q.where("routeId", "==", routeNumber);
    else if (ctx.role !== "owner" && ctx.routeIds.length)
      q = q.where("routeId", "in", ctx.routeIds.slice(0, 10));
    const snap = await q.orderBy("createdAt", "desc").limit(20).get();
    return { ok: true, data: { alerts: snap.docs.map((d) => ({ id: d.id, ...d.data() })) } };
  } catch (e) {
    logger.warn("execOpenAlerts: read failed", e);
    return { ok: false, error: "Couldn't load alerts right now." };
  }
}

async function execLogEodNote(
  ctx: UserCtx,
  brain: any,
  args: any,
  threadId: string
): Promise<ToolResult> {
  const route = await resolveRoute(brain, args.route);
  if (!route) return { ok: false, error: `Couldn't find a route matching "${args.route}".` };
  if (!assertRouteAccess(ctx, route.number)) {
    return { ok: false, error: "You don't have access to that route." };
  }
  if (!args.note || !String(args.note).trim()) {
    return { ok: false, error: "Note text is required." };
  }
  const today = new Date().toISOString().slice(0, 10);
  try {
    const ref = db.collection("eodReports").doc(`${route.number}_${today}`);
    await ref.set(
      {
        routeId: route.number,
        date: today,
        notes: admin.firestore.FieldValue.arrayUnion({
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
  let routeNumber: string | undefined;
  if (args.route) {
    const route = await resolveRoute(brain, args.route);
    if (!route) return { ok: false, error: `Couldn't find a route matching "${args.route}".` };
    if (!assertRouteAccess(ctx, route.number)) {
      return { ok: false, error: "You don't have access to that route." };
    }
    routeNumber = route.number;
  } else if (ctx.role === "driver" && ctx.routeIds.length === 1) {
    routeNumber = ctx.routeIds[0];
  }
  const severity = ["info", "warning", "urgent"].includes(args.severity)
    ? args.severity
    : "warning";
  try {
    const ref = await db.collection("alerts").add({
      title: String(args.title).slice(0, 120),
      detail: args.detail ? String(args.detail).slice(0, 2000) : "",
      severity,
      routeId: routeNumber || null,
      status: "open",
      createdBy: ctx.uid,
      createdByName: ctx.name,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      via: "assistant",
    });
    return { ok: true, data: { alertId: ref.id, severity, routeId: routeNumber || null } };
  } catch (e) {
    logger.warn("execCreateAlert: write failed", e);
    return { ok: false, error: "Couldn't create the alert right now." };
  }
}

async function execUpdateEmployeeStatus(ctx: UserCtx, args: any): Promise<ToolResult> {
  // Only owner/managers may write employee status notes; drivers may only note themselves.
  const empRef = db.collection("employees").doc(args.employeeId);
  const snap = await empRef.get();
  if (!snap.exists) return { ok: false, error: "Employee not found." };
  if (ctx.role === "driver" && args.employeeId !== ctx.uid) {
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

async function runTool(
  ctx: UserCtx,
  name: string,
  args: any,
  brain: any,
  threadId: string
): Promise<ToolResult> {
  switch (name) {
    case "get_business_overview":
      return execBusinessOverview(ctx, brain);
    case "get_route_summary":
      return execRouteSummary(ctx, brain, args);
    case "get_driver_score":
      return execDriverScore(ctx, brain, args);
    case "get_eod_history":
      return execEodHistory(ctx, brain, args);
    case "get_open_alerts":
      return execOpenAlerts(ctx, brain, args);
    case "log_eod_note":
      return execLogEodNote(ctx, brain, args, threadId);
    case "create_alert":
      return execCreateAlert(ctx, brain, args);
    case "update_employee_status":
      return execUpdateEmployeeStatus(ctx, args);
    case "escalate_to_gybs":
      return execEscalate(ctx, args, threadId);
    default:
      return { ok: false, error: `Unknown tool: ${name}` };
  }
}

// ─── Prompt building ───────────────────────────────────────────────────────
function buildScopedContext(ctx: UserCtx, brain: any): any {
  const b = redactBrainForMember(brain, ctx);
  const routes = b.routes || {};
  const visible =
    ctx.role === "owner"
      ? routes
      : Object.fromEntries(
          Object.entries(routes).filter(([n]) => ctx.routeIds.includes(n))
        );
  return {
    businesses: b.businesses,
    routes: visible,
    drivers: b.drivers,
    operatingRules: b.operatingRules,
    flowersFormula: b.flowersFormula,
    weeklyBaseline: b.weeklyBaseline,
  };
}

function buildSystemPrompt(ctx: UserCtx, brain: any, scoped: any): string {
  const roleLine =
    ctx.role === "owner"
      ? "You are assisting Chris, the owner of the whole operation."
      : ctx.role === "business_manager"
        ? `You are assisting ${ctx.name}, a business manager (businesses: ${(ctx.businessIds || []).join(", ") || "assigned"}).`
        : `You are assisting ${ctx.name}, a driver. They can ONLY see their assigned route(s): ${(ctx.routeIds || []).join(", ") || "none assigned"}.`;

  return `You are the TruckCEO in-app AI assistant — the operational brain for a bread-route distribution business in CT / lower NY.

${roleLine}

KNOWLEDGE (authoritative, from the business brain):
${JSON.stringify(scoped).slice(0, 12000)}

HARD RULES — never break these:
1. ORDERING IS RECOMMEND-ONLY. You may suggest order quantities, but you NEVER place, change, or confirm orders. There are no order tools — if asked to place an order, explain you can only recommend and escalate_to_gybs if they insist.
2. DRIVER PRIVACY: drivers must NEVER see driver pay (their own or others'). The knowledge above is already redacted — never invent pay figures.
3. NEVER estimate route net profit until bakery settlement feeds are connected. Say it's pending the money feed.
4. SCOPE: drivers only get their assigned routes. If asked about another route, refuse politely and offer their own.
5. ESCALATE, don't guess: ordering decisions, money/payroll, hiring/firing, or anything uncertain → escalate_to_gybs. Say you've handed it to GYBs.
6. Be concise, plain-spoken, and practical. This is a driver/operator audience, not analysts. Short answers, no jargon. Keep answers short enough to be read aloud comfortably — responses may be spoken back as audio.
7. When you take an action (log a note, create an alert, update a status), confirm what you did in one line.
8. Stratford Flowers route 7823 is currently VACANT (driver departed) — don't attribute a driver to it.
9. LANGUAGE: the user may write in English or Spanish — many drivers are Spanish-speaking. Always detect the user's language and respond ENTIRELY in that same language. Be natural and conversational in both; never mix languages in one reply unless the user does.

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
  message: string
): Promise<TurnResult> {
  const scoped = buildScopedContext(ctx, brain);
  const systemInstruction = buildSystemPrompt(ctx, brain, scoped);

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
async function loadThreadHistory(
  threadId: string,
  limit = 20
): Promise<Array<{ role: "user" | "model"; text: string }>> {
  try {
    const snap = await db
      .collection("assistantThreads")
      .doc(threadId)
      .collection("messages")
      .orderBy("at", "desc")
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
  threadId: string,
  role: "user" | "assistant",
  text: string,
  extra: any = {}
): Promise<void> {
  const ref = db.collection("assistantThreads").doc(threadId);
  await ref.set(
    { updatedAt: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true }
  );
  await ref.collection("messages").add({
    role,
    text: String(text).slice(0, 8000),
    at: admin.firestore.FieldValue.serverTimestamp(),
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

    const { message, threadId: clientThreadId } = req.body || {};
    if (!message || !String(message).trim()) {
      res.status(400).json({ error: "Message is required." });
      return;
    }

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
      const model = PROVIDER_MODELS[MODEL_PROVIDER];

      // Thread
      const threadId =
        clientThreadId ||
        (await db.collection("assistantThreads").add({
          uid: ctx.uid,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        })).id;
      const history = await loadThreadHistory(threadId);

      await saveThreadMessage(threadId, "user", String(message));

      // Turn
      const turn = await runAssistantTurn(
        provider,
        apiKey,
        model,
        ctx,
        brain,
        threadId,
        history,
        String(message)
      );

      await saveThreadMessage(threadId, "assistant", turn.text, {
        toolCalls: turn.toolCalls.map((t) => ({ name: t.name, ok: t.ok })),
        escalated: turn.escalated,
        provider: MODEL_PROVIDER,
        model,
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
