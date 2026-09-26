import React, { useEffect, useRef, useState } from 'react';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  query,
  orderBy,
  limit,
  where,
  serverTimestamp
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../services/firebaseConfig';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../hooks/useToast';
import { ToastContainer } from './ToastContainer';
import { DriverEod, RoutePhoto, RouteUpdate, RouteTerritory, PhotoMoment } from '../types';

type Tab = 'feed' | 'eod' | 'photos' | 'score';

const toDayId = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const mondayOfWeek = () => {
  const d = new Date();
  const day = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - day);
  return toDayId(d);
};

const tsToDate = (ts: any): Date | null => {
  if (!ts) return null;
  if (typeof ts.toDate === 'function') return ts.toDate();
  if (ts instanceof Date) return ts;
  return null;
};

const fmtTime = (ts: any) => {
  const d = tsToDate(ts);
  if (!d) return '';
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

const fmtDay = (ts: any) => {
  const d = tsToDate(ts);
  if (!d) return '';
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
};

const MOMENT_LABEL: Record<PhotoMoment, string> = { start: 'Start of day', work: 'Work day', end: 'End of day' };

export const DriverHome: React.FC = () => {
  const { userProfile, logout } = useAuth();
  const { toasts, showToast, removeToast } = useToast();
  const [tab, setTab] = useState<Tab>('feed');
  const [route, setRoute] = useState<RouteTerritory | null>(null);
  const [routeLoading, setRouteLoading] = useState(true);

  const businessId = userProfile?.businessId;
  const routeId = userProfile?.routeIds?.[0];
  const driverName = userProfile?.displayName || 'Driver';

  useEffect(() => {
    if (!businessId || !routeId) {
      setRouteLoading(false);
      return;
    }
    getDoc(doc(db, `businesses/${businessId}/routes`, routeId))
      .then((snap) => {
        if (snap.exists()) setRoute({ id: snap.id, ...snap.data() } as RouteTerritory);
      })
      .catch((e) => console.error(e))
      .finally(() => setRouteLoading(false));
  }, [businessId, routeId]);

  if (!businessId || !routeId) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center p-6">
        <div className="bg-white rounded-[2.5rem] p-10 max-w-sm text-center">
          <i className="fas fa-link text-[#FFD700] text-4xl mb-4"></i>
          <h2 className="font-black uppercase tracking-tight text-xl mb-2">No route linked</h2>
          <p className="text-gray-500 text-sm font-bold mb-6">
            Your account isn't connected to a route yet. Ask your owner for a new invite code.
          </p>
          <button
            onClick={logout}
            className="w-full py-4 bg-black text-[#FFD700] rounded-2xl font-black uppercase tracking-widest text-sm active:scale-95 transition-all"
          >
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: 'feed', label: 'Feed', icon: 'fa-stream' },
    { id: 'eod', label: 'End of Day', icon: 'fa-clipboard-check' },
    { id: 'photos', label: 'Photos', icon: 'fa-camera' },
    { id: 'score', label: 'Score', icon: 'fa-trophy' }
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <ToastContainer toasts={toasts} onRemove={removeToast} />

      {/* Header */}
      <header className="bg-black text-white px-5 pt-6 pb-5 sticky top-0 z-10">
        <div className="max-w-md mx-auto flex items-center justify-between">
          <div>
            <div className="text-[9px] font-black text-[#FFD700] uppercase tracking-[0.25em]">TruckCEO · Driver</div>
            <h1 className="text-xl font-black uppercase tracking-tight mt-1">
              {routeLoading ? 'Loading…' : route?.name || 'My Route'}
            </h1>
            <div className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-0.5">
              {driverName} · {new Date().toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}
            </div>
          </div>
          <button
            onClick={logout}
            className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center text-gray-300 active:scale-95"
            aria-label="Sign out"
          >
            <i className="fas fa-sign-out-alt"></i>
          </button>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-md mx-auto px-4 pt-4 pb-28">
        {tab === 'feed' && businessId && (
          <FeedTab businessId={businessId} routeId={routeId} driverName={driverName} showToast={showToast} />
        )}
        {tab === 'eod' && businessId && (
          <EodTab businessId={businessId} routeId={routeId} driverName={driverName} showToast={showToast} />
        )}
        {tab === 'photos' && businessId && (
          <PhotosTab businessId={businessId} routeId={routeId} driverName={driverName} showToast={showToast} />
        )}
        {tab === 'score' && businessId && (
          <ScoreTab businessId={businessId} routeId={routeId} />
        )}
      </main>

      {/* Bottom tab bar */}
      <nav className="fixed bottom-0 left-0 right-0 bg-black border-t border-white/10 z-10">
        <div className="max-w-md mx-auto grid grid-cols-4">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`py-3.5 flex flex-col items-center gap-1 transition-all ${
                tab === t.id ? 'text-[#FFD700]' : 'text-gray-500'
              }`}
            >
              <i className={`fas ${t.icon} text-lg`}></i>
              <span className="text-[8px] font-black uppercase tracking-widest">{t.label}</span>
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
};

/* ================= FEED ================= */

const FeedTab: React.FC<{ businessId: string; routeId: string; driverName: string; showToast: (m: string, t: 'success' | 'error') => void }> = ({
  businessId, routeId, driverName, showToast
}) => {
  const [items, setItems] = useState<any[]>([]);
  const [text, setText] = useState('');
  const [posting, setPosting] = useState(false);
  const { currentUser } = useAuth();

  const load = async () => {
    const base = `businesses/${businessId}/routes/${routeId}`;
    const [u, p, e] = await Promise.all([
      getDocs(query(collection(db, `${base}/updates`), orderBy('createdAt', 'desc'), limit(20))),
      getDocs(query(collection(db, `${base}/photos`), orderBy('uploadedAt', 'desc'), limit(20))),
      getDocs(query(collection(db, `${base}/eod`), orderBy('submittedAt', 'desc'), limit(7)))
    ]);
    const merged: any[] = [
      ...u.docs.map((d) => ({ kind: 'update', ...(d.data() as RouteUpdate) })),
      ...p.docs.map((d) => ({ kind: 'photo', ...(d.data() as RoutePhoto) })),
      ...e.docs.map((d) => ({ kind: 'eod', ...(d.data() as DriverEod) }))
    ];
    merged.sort((a, b) => {
      const ta = tsToDate(a.kind === 'update' ? a.createdAt : a.kind === 'photo' ? a.uploadedAt : a.submittedAt)?.getTime() || 0;
      const tb = tsToDate(b.kind === 'update' ? b.createdAt : b.kind === 'photo' ? b.uploadedAt : b.submittedAt)?.getTime() || 0;
      return tb - ta;
    });
    setItems(merged.slice(0, 40));
  };

  useEffect(() => {
    load().catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const postUpdate = async () => {
    if (!text.trim() || !currentUser) return;
    setPosting(true);
    try {
      await addDoc(collection(db, `businesses/${businessId}/routes/${routeId}/updates`), {
        text: text.trim(),
        createdAt: serverTimestamp(),
        authorName: driverName,
        authorId: currentUser.uid
      });
      setText('');
      await load();
      showToast('Update posted', 'success');
    } catch (err) {
      console.error(err);
      showToast('Could not post update', 'error');
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-3xl p-4 border border-gray-100 shadow-sm">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Order update, display win, anything…"
          className="w-full p-3 bg-gray-50 rounded-2xl font-bold text-sm outline-none focus:ring-2 focus:ring-[#FFD700]"
        />
        <button
          onClick={postUpdate}
          disabled={posting || !text.trim()}
          className="mt-2 w-full py-3 bg-black text-[#FFD700] rounded-2xl text-[10px] font-black uppercase tracking-widest active:scale-95 transition-all disabled:opacity-40"
        >
          {posting ? 'Posting…' : 'Post Update'}
        </button>
      </div>

      {items.map((item, i) => (
        <div key={i} className="bg-white rounded-3xl p-4 border border-gray-100 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-black uppercase tracking-widest">{item.authorName || item.driverName}</span>
            <span className="text-[10px] text-gray-400 font-bold">
              {item.kind === 'update' ? fmtTime(item.createdAt) : item.kind === 'photo' ? fmtTime(item.uploadedAt) : fmtDay(item.submittedAt)}
            </span>
          </div>
          {item.kind === 'photo' && (
            <>
              <img src={item.downloadUrl} alt="" className="w-full rounded-2xl mb-2 max-h-64 object-cover" />
              <span className="text-[9px] font-black uppercase tracking-widest bg-gray-100 rounded-full px-3 py-1">
                {MOMENT_LABEL[item.moment as PhotoMoment] || 'Photo'}
              </span>
            </>
          )}
          {item.kind === 'update' && <p className="text-sm font-bold">{item.text}</p>}
          {item.kind === 'eod' && (
            <div className="text-sm">
              <span className="text-[9px] font-black uppercase tracking-widest bg-black text-[#FFD700] rounded-full px-3 py-1">End of day</span>
              <p className="font-bold mt-2">{item.stopsCompleted} stops · {item.piecesLeft} pcs left · {item.stalesPulled} stales</p>
              <p className="text-gray-500 font-bold text-xs mt-1">{item.outlook}</p>
            </div>
          )}
        </div>
      ))}

      {items.length === 0 && (
        <div className="bg-white rounded-3xl p-10 text-center border-2 border-dashed border-gray-200">
          <i className="fas fa-stream text-3xl text-gray-300 mb-3"></i>
          <p className="text-gray-400 text-xs font-black uppercase tracking-widest">Nothing posted today yet</p>
        </div>
      )}
    </div>
  );
};

/* ================= END OF DAY ================= */

const EodTab: React.FC<{ businessId: string; routeId: string; driverName: string; showToast: (m: string, t: 'success' | 'error') => void }> = ({
  businessId, routeId, driverName, showToast
}) => {
  const dayId = toDayId(new Date());
  const [existing, setExisting] = useState<DriverEod | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [f, setF] = useState({ piecesLeft: '', stalesPulled: '', stopsCompleted: '', endLocation: '', outlook: '' });
  const { currentUser } = useAuth();

  useEffect(() => {
    getDoc(doc(db, `businesses/${businessId}/routes/${routeId}/eod`, dayId))
      .then((snap) => {
        if (snap.exists()) {
          const data = snap.data() as DriverEod;
          setExisting(data);
          setF({
            piecesLeft: String(data.piecesLeft),
            stalesPulled: String(data.stalesPulled),
            stopsCompleted: data.stopsCompleted,
            endLocation: data.endLocation,
            outlook: data.outlook
          });
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const complete = [f.piecesLeft, f.stalesPulled, f.stopsCompleted, f.endLocation, f.outlook].filter((v) => v.trim() !== '').length;

  const submit = async () => {
    if (complete < 5 || !currentUser) return;
    setSaving(true);
    try {
      await setDoc(doc(db, `businesses/${businessId}/routes/${routeId}/eod`, dayId), {
        date: dayId,
        piecesLeft: Number(f.piecesLeft),
        stalesPulled: Number(f.stalesPulled),
        stopsCompleted: f.stopsCompleted.trim(),
        endLocation: f.endLocation.trim(),
        outlook: f.outlook.trim(),
        submittedAt: serverTimestamp(),
        submittedBy: currentUser.uid,
        driverName
      });
      const snap = await getDoc(doc(db, `businesses/${businessId}/routes/${routeId}/eod`, dayId));
      if (snap.exists()) setExisting(snap.data() as DriverEod);
      showToast(existing ? 'End of day updated' : 'End of day submitted', 'success');
    } catch (err) {
      console.error(err);
      showToast('Could not submit', 'error');
    } finally {
      setSaving(false);
    }
  };

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setF((prev) => ({ ...prev, [k]: e.target.value }));

  if (loading) {
    return <div className="text-center py-16 text-gray-400 font-black uppercase tracking-widest text-xs">Loading…</div>;
  }

  const inputCls =
    'w-full p-4 bg-gray-50 border-2 border-gray-200 rounded-2xl focus:ring-2 focus:ring-[#FFD700] focus:border-[#FFD700] outline-none font-bold transition-all';

  return (
    <div className="bg-white rounded-[2rem] p-6 border border-gray-100 shadow-sm">
      <div className="flex items-center justify-between mb-1">
        <h2 className="font-black uppercase tracking-tight text-lg">End-of-day checklist</h2>
        {existing && (
          <span className="text-[9px] font-black uppercase tracking-widest bg-green-100 text-green-700 rounded-full px-3 py-1">
            Submitted
          </span>
        )}
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden my-3">
        <div className="h-full bg-black transition-all" style={{ width: `${(complete / 5) * 100}%` }}></div>
      </div>
      <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest mb-5">
        {complete} of 5 complete — all fields required
      </p>

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ml-2">Pieces left <span className="text-red-500">*</span></label>
            <input type="number" inputMode="numeric" placeholder="0" value={f.piecesLeft} onChange={set('piecesLeft')} className={inputCls} />
          </div>
          <div>
            <label className="block text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ml-2">Stales pulled <span className="text-red-500">*</span></label>
            <input type="number" inputMode="numeric" placeholder="0" value={f.stalesPulled} onChange={set('stalesPulled')} className={inputCls} />
          </div>
        </div>
        <div>
          <label className="block text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ml-2">Stops completed <span className="text-red-500">*</span></label>
          <input placeholder="e.g. 14 / 16" value={f.stopsCompleted} onChange={set('stopsCompleted')} className={inputCls} />
        </div>
        <div>
          <label className="block text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ml-2">End location <span className="text-red-500">*</span></label>
          <input placeholder="e.g. Depot" value={f.endLocation} onChange={set('endLocation')} className={inputCls} />
        </div>
        <div>
          <label className="block text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ml-2">Tomorrow's outlook <span className="text-red-500">*</span></label>
          <textarea rows={2} placeholder="Anything the next run should know" value={f.outlook} onChange={set('outlook')} className={inputCls} />
        </div>
        <button
          onClick={submit}
          disabled={complete < 5 || saving}
          className={`w-full py-4 rounded-2xl font-black uppercase tracking-widest text-sm transition-all active:scale-95 ${
            complete === 5 ? 'bg-black text-[#FFD700] shadow-xl' : 'bg-gray-100 text-gray-400'
          } disabled:opacity-70`}
        >
          {saving ? 'Submitting…' : complete === 5 ? (existing ? 'Update end of day' : 'Submit end of day') : 'Complete all required fields'}
        </button>
      </div>
    </div>
  );
};

/* ================= PHOTOS ================= */

const PhotosTab: React.FC<{ businessId: string; routeId: string; driverName: string; showToast: (m: string, t: 'success' | 'error') => void }> = ({
  businessId, routeId, driverName, showToast
}) => {
  const [moment, setMoment] = useState<PhotoMoment>('work');
  const [photos, setPhotos] = useState<RoutePhoto[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { currentUser } = useAuth();

  const load = async () => {
    const snap = await getDocs(
      query(collection(db, `businesses/${businessId}/routes/${routeId}/photos`), orderBy('uploadedAt', 'desc'), limit(60))
    );
    setPhotos(snap.docs.map((d) => ({ id: d.id, ...(d.data() as RoutePhoto) })));
  };

  useEffect(() => {
    load().catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !currentUser) return;
    setUploading(true);
    try {
      const dayId = toDayId(new Date());
      const safeName = file.name.replace(/[^a-zA-Z0-9.]/g, '_');
      const path = `driver-photos/${businessId}/${routeId}/${dayId}/${currentUser.uid}_${Date.now()}_${safeName}`;
      await uploadBytes(ref(storage, path), file);
      const url = await getDownloadURL(ref(storage, path));
      await addDoc(collection(db, `businesses/${businessId}/routes/${routeId}/photos`), {
        storagePath: path,
        downloadUrl: url,
        moment,
        storeId: null,
        storeName: null,
        aiStatus: 'pending',
        category: null,
        compliance: null,
        uploadedAt: serverTimestamp(),
        uploadedBy: currentUser.uid,
        driverName
      });
      await load();
      showToast('Photo added — AI will sort it', 'success');
    } catch (err) {
      console.error(err);
      showToast('Upload failed', 'error');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const moments: { id: PhotoMoment; label: string }[] = [
    { id: 'start', label: 'Start of day' },
    { id: 'work', label: 'Work day' },
    { id: 'end', label: 'End of day' }
  ];

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-[2rem] p-5 border border-gray-100 shadow-sm">
        <h2 className="font-black uppercase tracking-tight mb-1">Add a photo</h2>
        <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mb-4">Pick the moment — we sort the rest</p>
        <div className="grid grid-cols-3 gap-2 mb-3">
          {moments.map((m) => (
            <button
              key={m.id}
              onClick={() => setMoment(m.id)}
              className={`py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all active:scale-95 ${
                moment === m.id ? 'bg-black text-[#FFD700]' : 'bg-gray-100 text-gray-500'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={onFile} className="hidden" />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="w-full py-4 border-2 border-dashed border-gray-300 rounded-2xl font-black uppercase tracking-widest text-xs text-gray-600 active:scale-95 transition-all disabled:opacity-50"
        >
          <i className={`fas ${uploading ? 'fa-spinner fa-spin' : 'fa-camera'} mr-2`}></i>
          {uploading ? 'Uploading…' : 'Snap photo'}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {photos.map((p) => (
          <div key={p.id} className="bg-white rounded-2xl overflow-hidden border border-gray-100 shadow-sm">
            <img src={p.downloadUrl} alt="" className="w-full h-36 object-cover" />
            <div className="p-2.5">
              <div className="text-[9px] font-black uppercase tracking-widest">{MOMENT_LABEL[p.moment] || 'Photo'}</div>
              <div className="text-[9px] text-gray-400 font-bold mt-0.5">
                {p.aiStatus === 'pending' ? 'AI sorting…' : p.storeName || ''}
              </div>
            </div>
          </div>
        ))}
      </div>

      {photos.length === 0 && (
        <div className="bg-white rounded-3xl p-10 text-center border-2 border-dashed border-gray-200">
          <i className="fas fa-camera text-3xl text-gray-300 mb-3"></i>
          <p className="text-gray-400 text-xs font-black uppercase tracking-widest">No photos yet today</p>
        </div>
      )}
    </div>
  );
};

/* ================= SCORE ================= */

const ScoreTab: React.FC<{ businessId: string; routeId: string }> = ({ businessId, routeId }) => {
  const [discipline, setDiscipline] = useState<number | null>(null);

  useEffect(() => {
    getDocs(
      query(
        collection(db, `businesses/${businessId}/routes/${routeId}/eod`),
        where('date', '>=', mondayOfWeek())
      )
    )
      .then((snap) => {
        // 6-day work week (Mon–Sat)
        setDiscipline(Math.min(100, Math.round((snap.size / 6) * 100)));
      })
      .catch(console.error);
  }, [businessId, routeId]);

  const factors: { label: string; max: number; value: number | null; note?: string }[] = [
    { label: 'Sales vs target', max: 30, value: null, note: 'Connects with money feed' },
    { label: 'Stale rate', max: 25, value: null, note: 'Connects with money feed' },
    { label: 'Planogram compliance', max: 15, value: null, note: 'Needs planogram data' },
    { label: 'Fuel efficiency', max: 15, value: null, note: 'Connects with money feed' },
    { label: 'Data discipline', max: 15, value: discipline === null ? null : Math.round((discipline / 100) * 15) }
  ];

  const total = factors.reduce((s, f) => s + (f.value || 0), 0);
  const tier = total >= 90 ? 'GOLD' : total >= 80 ? 'SILVER' : 'BRONZE';

  return (
    <div className="space-y-4">
      <div className="bg-black text-white rounded-[2rem] p-8 text-center shadow-xl">
        <div className="text-[10px] font-black text-[#FFD700] uppercase tracking-[0.3em] mb-2">Driver Score · This Week</div>
        <div className="text-6xl font-black text-[#FFD700]">{total}</div>
        <div className="text-xs font-black uppercase tracking-[0.25em] text-gray-400 mt-2">{tier}</div>
        <div className="h-2 bg-white/10 rounded-full overflow-hidden mt-4">
          <div className="h-full bg-[#FFD700] transition-all" style={{ width: `${total}%` }}></div>
        </div>
        <div className="text-[9px] text-gray-500 font-bold uppercase tracking-widest mt-2">
          {total >= 90 ? 'Gold pace' : total >= 80 ? `${90 - total} pts to Gold` : `${80 - total} pts to Silver`}
        </div>
      </div>

      <div className="bg-white rounded-[2rem] p-6 border border-gray-100 shadow-sm">
        <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.25em] mb-4">How you score</h3>
        <div className="space-y-4">
          {factors.map((f) => (
            <div key={f.label}>
              <div className="flex justify-between items-baseline mb-1.5">
                <span className="text-xs font-black uppercase tracking-widest">{f.label}</span>
                <span className="text-xs font-black text-gray-500">
                  {f.value === null ? `— / ${f.max}` : `${f.value} / ${f.max}`}
                </span>
              </div>
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-black transition-all"
                  style={{ width: f.value === null ? '0%' : `${(f.value / f.max) * 100}%` }}
                ></div>
              </div>
              {f.note && <div className="text-[9px] text-gray-400 font-bold uppercase tracking-widest mt-1">{f.note}</div>}
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-[2rem] p-6 border border-gray-100 shadow-sm">
        <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.25em] mb-3">How it pays</h3>
        <ul className="text-xs font-bold text-gray-600 space-y-2">
          <li><i className="fas fa-medal text-[#FFD700] mr-2"></i>90+ Gold and 80+ Silver earn weekly bonuses</li>
          <li><i className="fas fa-arrow-up text-[#FFD700] mr-2"></i>Hold Silver+ for 8 weeks to unlock the top pay tier</li>
          <li><i className="fas fa-gas-pump text-[#FFD700] mr-2"></i>Beat your fuel benchmark and share the savings</li>
        </ul>
      </div>
    </div>
  );
};
