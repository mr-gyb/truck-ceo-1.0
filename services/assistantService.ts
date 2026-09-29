/// <reference types="vite/client" />
import { auth, db } from './firebaseConfig';
import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
} from 'firebase/firestore';

// ---------------------------------------------------------------------------
// TruckCEO in-app assistant transport.
//
// The chat widget NEVER talks to a model API from the browser. Every message
// goes to the backend brain service (Cloud Function `askAssistant`), which
// verifies the Firebase ID token, loads the role-scoped business context,
// runs the model with real tools, and logs the thread to Firestore.
// ---------------------------------------------------------------------------

const ASSISTANT_URL =
  (import.meta.env.VITE_ASSISTANT_URL as string | undefined) ||
  '/api/askAssistant';

export interface AssistantToolCall {
  name: string;
  result: string;
  ok?: boolean;
}

export interface AssistantResponse {
  text: string;
  toolCalls: AssistantToolCall[];
  threadId: string;
  escalated: boolean;
}

export interface ThreadMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  toolCalls?: AssistantToolCall[];
  escalated?: boolean;
  createdAt?: unknown;
}

async function getIdToken(): Promise<string> {
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in');
  return user.getIdToken();
}

/**
 * Send one chat message to the backend brain service.
 * Returns the assistant's reply, any tool-call confirmations, the thread id,
 * and whether the request was escalated to GYBs.
 *
 * Pass `opts.setupMode` when the owner is in the guided setup interview —
 * the backend switches to the setup system prompt (owner-only write tools).
 */
export async function sendAssistantMessage(
  message: string,
  threadId?: string,
  opts?: { setupMode?: boolean }
): Promise<AssistantResponse> {
  const token = await getIdToken();

  const res = await fetch(ASSISTANT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      message,
      threadId: threadId ?? null,
      setupMode: opts?.setupMode === true,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `Assistant request failed (${res.status})${body ? `: ${body.slice(0, 200)}` : ''}`
    );
  }

  const data = await res.json();
  return {
    text: typeof data.text === 'string' ? data.text : '',
    toolCalls: Array.isArray(data.toolCalls) ? data.toolCalls : [],
    threadId: typeof data.threadId === 'string' ? data.threadId : (threadId ?? ''),
    escalated: Boolean(data.escalated),
  };
}

/**
 * Load the most recently updated assistant thread for a business, with its
 * messages oldest-first. Returns null when no thread exists yet.
 *
 * Reads: businesses/{bid}/assistantThreads (order by updatedAt desc, limit 1)
 *        + messages subcollection (order by createdAt asc).
 * Tenant isolation is enforced by Firestore rules (same-business only).
 */
export async function loadLatestThread(
  businessId: string
): Promise<{ threadId: string; messages: ThreadMessage[] } | null> {
  const threadsRef = collection(db, `businesses/${businessId}/assistantThreads`);
  const latestQuery = query(threadsRef, orderBy('updatedAt', 'desc'), limit(1));
  const threadSnap = await getDocs(latestQuery);
  if (threadSnap.empty) return null;

  const threadDoc = threadSnap.docs[0];
  const messagesRef = collection(
    db,
    `businesses/${businessId}/assistantThreads/${threadDoc.id}/messages`
  );
  const messagesQuery = query(messagesRef, orderBy('createdAt', 'asc'));
  const messagesSnap = await getDocs(messagesQuery);

  const messages: ThreadMessage[] = messagesSnap.docs.map((d) => ({
    id: d.id,
    ...(d.data() as Omit<ThreadMessage, 'id'>),
  }));

  return { threadId: threadDoc.id, messages };
}
