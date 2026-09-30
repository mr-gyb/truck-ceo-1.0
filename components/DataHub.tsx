import React, { useEffect, useState } from 'react';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../services/firebaseConfig';
import { useAuth } from '../contexts/AuthContext';
import { SecureConnectModal } from './SecureConnectModal';
import { CSVUploader } from './CSVUploader';
import { View, InviteCode } from '../types';

interface DataHubProps {
  onNavigate?: (view: View) => void;
}

/* ------------------------------------------------------------------ */
/* Data connections                                                    */
/* ------------------------------------------------------------------ */

interface SourceDef {
  /** connections/{id} doc id — only read for bakery sources */
  id: string;
  name: string;
  icon: string;
  /** true = FontAwesome brand icon (fab), false = solid (fas) */
  brand: boolean;
  /** one line: what data this feeds the app */
  blurb: string;
  /** bakery sources sync through a supervised agent loop, never a live API */
  bakery: boolean;
  /** static honest status for non-bakery sources (no Firestore doc read) */
  staticStatus?: string;
}

const SOURCES: SourceDef[] = [
  {
    id: 'bimbo-ion',
    name: 'Bimbo ION',
    icon: 'fa-bread-slice',
    brand: false,
    blurb: 'Ordering, sales and product data for Bimbo routes',
    bakery: true,
  },
  {
    id: 'flowers-iplan',
    name: 'Flowers iPlan',
    icon: 'fa-clipboard-list',
    brand: false,
    blurb: 'Ordering and promo data for Flowers routes',
    bakery: true,
  },
  {
    id: 'flowers-idp',
    name: 'Flowers IDP Portal',
    icon: 'fa-file-invoice-dollar',
    brand: false,
    blurb: 'Settlement and wholesale billing data',
    bakery: true,
  },
  {
    id: 'discord',
    name: 'Discord',
    icon: 'fa-discord',
    brand: true,
    blurb: 'Route photos, EOD notes and team chatter',
    bakery: false,
    staticStatus: 'Active — team chatter tracked',
  },
  {
    id: 'gdrive',
    name: 'Google Drive',
    icon: 'fa-google-drive',
    brand: true,
    blurb: 'Business documents and shared files',
    bakery: false,
    staticStatus: 'Coming soon',
  },
];

interface ConnectionState {
  status?: string;
  lastSyncAt?: unknown;
}

const ConnectionCard: React.FC<{
  source: SourceDef;
  conn?: ConnectionState;
  isOwner: boolean;
  onConnect?: () => void;
}> = ({ source, conn, isOwner, onConnect }) => {
  // Honest status: static for Discord/Drive; for bakery sources the optional
  // connections/{id} doc refines it, otherwise "Not synced yet".
  // A 'pending' doc (secure credentials saved, GYBs wiring in progress)
  // renders the pending pill.
  const rawStatus = source.staticStatus ?? conn?.status ?? 'Not synced yet';
  const pillText = rawStatus === 'pending' ? 'Pending — GYBs wiring' : rawStatus;
  const isLive =
    pillText.toLowerCase().startsWith('active') ||
    pillText.toLowerCase().startsWith('connected') ||
    pillText.toLowerCase().startsWith('synced');
  const syncedAt = toDate(conn?.lastSyncAt);

  return (
    <div className="bg-white p-5 rounded-3xl border border-gray-100 flex items-start justify-between gap-4">
      <div className="flex items-start gap-4 min-w-0">
        <div className="w-12 h-12 shrink-0 rounded-2xl flex items-center justify-center text-xl bg-gray-50 text-black">
          <i className={`${source.brand ? 'fab' : 'fas'} ${source.icon} font-black`}></i>
        </div>
        <div className="min-w-0">
          <h4 className="font-black text-sm uppercase tracking-tight">{source.name}</h4>
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mt-0.5">
            {source.blurb}
          </p>
          {source.bakery && (
            <>
              <p className="text-[9px] font-bold uppercase tracking-widest text-gray-400 mt-1.5">
                <i className="fas fa-shield-halved mr-1 text-[#FFD700]"></i>
                Bakery logins are entered through the secure form — never in chat.
              </p>
              {isOwner && onConnect && (
                <button
                  onClick={onConnect}
                  className="mt-2 px-4 py-2.5 bg-black text-[#FFD700] rounded-xl text-[10px] font-black uppercase tracking-widest active:scale-95 transition-all flex items-center gap-2"
                >
                  <i className="fas fa-lock"></i> Connect securely
                </button>
              )}
            </>
          )}
          {syncedAt && (
            <p className="text-[9px] font-bold uppercase tracking-widest text-gray-400 mt-1">
              Last sync {fmtDateTime(syncedAt)}
            </p>
          )}
        </div>
      </div>
      <span
        className={`shrink-0 px-3 py-1.5 rounded-full text-[8px] font-black uppercase tracking-widest border ${
          isLive
            ? 'bg-[#FFD700]/10 border-[#FFD700]/40 text-black'
            : 'bg-gray-50 border-gray-200 text-gray-400'
        }`}
      >
        {pillText}
      </span>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Invite links (owner only)                                           */
/* ------------------------------------------------------------------ */

type InviteRole = 'team_member' | 'business_manager';

interface LinkInvite extends InviteCode {
  role: InviteRole;
  kind: 'link';
}

const JOIN_BASE = 'https://truck-ceo.web.app/join';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomLinkCode(): string {
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return code;
}

function toDate(v: unknown): Date | null {
  if (!v) return null;
  if (typeof (v as { toDate?: unknown }).toDate === 'function') {
    return (v as { toDate: () => Date }).toDate();
  }
  const d = new Date(v as string | number);
  return isNaN(d.getTime()) ? null : d;
}

function fmtDate(d: Date | null): string {
  if (!d) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtDateTime(d: Date | null): string {
  if (!d) return '';
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString(
    'en-US',
    { hour: 'numeric', minute: '2-digit' }
  )}`;
}

const InviteCard: React.FC<{
  role: InviteRole;
  title: string;
  icon: string;
  blurb: string;
  footnote: string;
  businessId: string;
  userId: string;
}> = ({ role, title, icon, blurb, footnote, businessId, userId }) => {
  const [invites, setInvites] = useState<LinkInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

  const fetchInvites = async () => {
    try {
      const snap = await getDocs(
        query(collection(db, `businesses/${businessId}/invites`), where('kind', '==', 'link'))
      );
      const all = snap.docs.map((d) => d.data() as LinkInvite);
      setInvites(all.filter((c) => c.role === role));
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInvites();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId, role]);

  const generate = async () => {
    setGenerating(true);
    setNotice('');
    try {
      const code = randomLinkCode();
      const payload = {
        code,
        businessId,
        role,
        kind: 'link',
        routeId: '',
        routeName: '',
        createdBy: userId,
        createdAt: new Date(),
        usedCount: 0,
      };
      // Same dual-write shape as the per-route driver codes in DriverInvite.
      const batch = writeBatch(db);
      batch.set(doc(db, 'inviteCodes', code), payload);
      batch.set(doc(db, `businesses/${businessId}/invites`, code), payload);
      await batch.commit();
      await fetchInvites();
      setNotice(
        role === 'team_member'
          ? 'Employee link created — share it with your driver.'
          : 'Partner link created — share it with your partner.'
      );
    } catch (e) {
      console.error(e);
      setNotice('Could not create the link. Try again.');
    } finally {
      setGenerating(false);
    }
  };

  const revoke = async (code: string) => {
    try {
      const batch = writeBatch(db);
      batch.delete(doc(db, 'inviteCodes', code));
      batch.delete(doc(db, `businesses/${businessId}/invites`, code));
      await batch.commit();
      setInvites((prev) => prev.filter((c) => c.code !== code));
    } catch (e) {
      console.error(e);
      setNotice('Could not revoke the link. Try again.');
    }
  };

  const copyLink = async (code: string) => {
    const link = `${JOIN_BASE}/${code}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(code);
      setTimeout(() => setCopied((p) => (p === code ? null : p)), 2000);
    } catch {
      setNotice('Copy blocked by the browser — long-press the link to copy it.');
    }
  };

  return (
    <div className="bg-white p-6 rounded-3xl border border-gray-100 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-11 h-11 shrink-0 rounded-2xl bg-black text-[#FFD700] flex items-center justify-center text-lg">
            <i className={`fas ${icon}`}></i>
          </div>
          <div className="min-w-0">
            <h4 className="font-black text-sm uppercase tracking-tight">{title}</h4>
            <p className="text-[9px] font-bold uppercase tracking-widest text-gray-400 mt-0.5">
              {blurb}
            </p>
          </div>
        </div>
        <button
          onClick={generate}
          disabled={generating}
          className="shrink-0 px-5 py-2.5 bg-black text-[#FFD700] rounded-xl text-[9px] font-black uppercase tracking-widest active:scale-95 transition-all disabled:opacity-50 flex items-center gap-2"
        >
          <i className={`fas ${generating ? 'fa-spinner fa-spin' : 'fa-plus'}`}></i>
          Generate
        </button>
      </div>

      {loading ? (
        <p className="text-[9px] font-black uppercase tracking-widest text-gray-300 text-center py-2">
          Loading links…
        </p>
      ) : invites.length === 0 ? (
        <div className="border-2 border-dashed border-gray-100 rounded-2xl p-6 text-center">
          <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">
            No invite links yet — generate one above
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {invites.map((c) => (
            <div key={c.code} className="bg-gray-50 rounded-2xl p-4 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-black tracking-[0.25em] text-sm">{c.code}</span>
                <span className="text-[8px] font-bold text-gray-400 uppercase tracking-widest">
                  {c.createdAt ? `Created ${fmtDate(toDate(c.createdAt))} · ` : ''}used{' '}
                  {c.usedCount || 0}x
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0 bg-white border border-gray-100 rounded-xl px-3 py-2.5 truncate text-[11px] font-bold text-gray-500">
                  {JOIN_BASE}/{c.code}
                </div>
                <button
                  onClick={() => copyLink(c.code)}
                  aria-label="Copy invite link"
                  className="w-10 h-10 shrink-0 bg-black text-[#FFD700] rounded-xl flex items-center justify-center active:scale-95 transition-all"
                >
                  <i className={`fas ${copied === c.code ? 'fa-check' : 'fa-copy'} text-sm`}></i>
                </button>
                <button
                  onClick={() => revoke(c.code)}
                  aria-label="Revoke invite link"
                  className="w-10 h-10 shrink-0 bg-red-50 text-red-600 rounded-xl flex items-center justify-center hover:bg-red-100 active:scale-95 transition-all"
                >
                  <i className="fas fa-ban text-sm"></i>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {notice && (
        <p className="text-[9px] font-black uppercase tracking-widest text-gray-500 text-center">
          {notice}
        </p>
      )}

      <p className="text-[9px] font-bold uppercase tracking-widest text-gray-400 text-center">
        {footnote}
      </p>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* DataHub                                                             */
/* ------------------------------------------------------------------ */

export const DataHub: React.FC<DataHubProps> = ({ onNavigate }) => {
  const { userProfile, currentUser } = useAuth();
  const businessId = userProfile?.businessId;
  const isOwner = userProfile?.role === 'business_owner';
  const [connections, setConnections] = useState<Record<string, ConnectionState>>({});
  const [connectFor, setConnectFor] = useState<SourceDef | null>(null);

  // Optional per-source sync state: businesses/{businessId}/connections/{sourceId}
  // (fields: status, lastSyncAt). Missing doc => "Not synced yet".
  useEffect(() => {
    if (!businessId) return;
    (async () => {
      const out: Record<string, ConnectionState> = {};
      await Promise.all(
        SOURCES.filter((s) => s.bakery).map(async (s) => {
          try {
            const snap = await getDoc(doc(db, `businesses/${businessId}/connections`, s.id));
            if (snap.exists()) {
              const d = snap.data() as ConnectionState;
              out[s.id] = { status: d.status, lastSyncAt: d.lastSyncAt };
            }
          } catch (e) {
            console.error(e);
          }
        })
      );
      setConnections(out);
    })();
  }, [businessId]);

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-500">
      {/* Header Section */}
      <div className="bg-black text-white p-8 rounded-[2.5rem] shadow-2xl relative overflow-hidden">
        <div className="absolute bottom-0 right-0 w-32 h-32 bg-[#FFD700]/10 rounded-full -mr-16 -mb-16 blur-3xl"></div>
        <div className="relative z-10">
          <h2 className="text-2xl font-black uppercase tracking-tighter mb-1">Data Resource Hub</h2>
          <p className="text-gray-500 text-[10px] font-black uppercase tracking-[0.3em]">
            Sync. Store. Analyze.
          </p>
        </div>
      </div>

      {/* Data Connections */}
      <section className="space-y-4">
        <div className="flex justify-between items-center px-2">
          <h3 className="font-black text-black text-[10px] uppercase tracking-[0.25em]">
            Data Connections
          </h3>
          <span className="text-[9px] font-black text-[#FFD700] uppercase tracking-widest">
            5 Sources
          </span>
        </div>

        <div className="grid grid-cols-1 gap-3">
          {SOURCES.map((s) => (
            <ConnectionCard
              key={s.id}
              source={s}
              conn={connections[s.id]}
              isOwner={isOwner}
              onConnect={s.bakery ? () => setConnectFor(s) : undefined}
            />
          ))}
        </div>
      </section>

      {/* Secure bakery credential capture */}
      {connectFor && (
        <SecureConnectModal
          platform={connectFor.id}
          platformName={connectFor.name}
          onClose={() => setConnectFor(null)}
          onSaved={() => {
            setConnections((prev) => ({
              ...prev,
              [connectFor.id]: { status: 'pending' },
            }));
            setConnectFor(null);
          }}
        />
      )}

      {/* Invite Links — owners only */}
      {isOwner && businessId && currentUser && (
        <section className="space-y-4">
          <div className="flex justify-between items-center px-2">
            <h3 className="font-black text-black text-[10px] uppercase tracking-[0.25em]">
              Invite Links
            </h3>
            <span className="text-[9px] font-black text-[#FFD700] uppercase tracking-widest">
              Owner Only
            </span>
          </div>

          <InviteCard
            role="team_member"
            title="Employee invite — driver view"
            icon="fa-id-card"
            blurb="Gives a driver access to the driver app"
            footnote="The driver opens the app, picks “I'm a Driver” and enters the code. Assign their route after they join."
            businessId={businessId}
            userId={currentUser.uid}
          />

          <InviteCard
            role="business_manager"
            title="Partner invite — business view"
            icon="fa-handshake"
            blurb="Gives a partner business-view access"
            footnote="Share the link with a partner to grant business-view access."
            businessId={businessId}
            userId={currentUser.uid}
          />
        </section>
      )}

      {/* Data Import — real CSV parsing via CSVService (owner-gated inside CSVUploader) */}
      {isOwner && (
        <section className="space-y-4">
          <div className="flex justify-between items-center px-2">
            <h3 className="font-black text-black text-[10px] uppercase tracking-[0.25em]">
              Data Import
            </h3>
            <span className="text-[9px] font-black text-[#FFD700] uppercase tracking-widest">
              CSV Upload
            </span>
          </div>

          <div className="grid grid-cols-1 gap-4">
            <CSVUploader
              type="products"
              title="Import Products"
              description="Upload product catalog from CSV"
              icon="fa-boxes-stacked"
            />
            <CSVUploader
              type="routes"
              title="Import Routes"
              description="Upload route territories from CSV"
              icon="fa-route"
            />
            <CSVUploader
              type="stores"
              title="Import Stores"
              description="Upload store locations from CSV"
              icon="fa-store"
            />
          </div>
        </section>
      )}

      {/* Data Management Section */}
      <section className="space-y-4 pb-6">
        <div className="flex justify-between items-center px-2">
          <h3 className="font-black text-black text-[10px] uppercase tracking-[0.25em]">
            Data Management
          </h3>
          <span className="text-[9px] font-black text-[#FFD700] uppercase tracking-widest">
            Quick Access
          </span>
        </div>

        <button
          onClick={() => onNavigate?.('routes_management')}
          className="w-full bg-white p-6 rounded-3xl border border-gray-100 flex items-center justify-between group hover:border-black transition-all active:scale-95"
        >
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-xl bg-black text-[#FFD700] shadow-xl transition-colors">
              <i className="fas fa-route font-black"></i>
            </div>
            <div className="text-left">
              <h4 className="font-black text-sm uppercase tracking-tight">Routes & Stores</h4>
              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                Manage territories & locations
              </p>
            </div>
          </div>
          <i className="fas fa-chevron-right text-gray-400 group-hover:text-black transition-colors"></i>
        </button>
      </section>
    </div>
  );
};
