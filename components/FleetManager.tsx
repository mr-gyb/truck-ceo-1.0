import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { collection, doc, setDoc } from 'firebase/firestore';
import { db } from '../services/firebaseConfig';
import { useAuth } from '../contexts/AuthContext';
import { FirestoreService } from '../services/firestoreService';
import { Employee, RouteTerritory, Truck } from '../types';

const truckLabel = (t: Truck): string =>
  t.plate && t.plate.trim() ? t.plate.trim() : t.id;

const driverLabel = (e: Employee): string =>
  e.name && e.name.trim() ? e.name.trim() : e.id;

export const FleetManager: React.FC = () => {
  const { userProfile } = useAuth();
  const businessId = userProfile?.businessId ?? null;
  const isOwner = userProfile?.role === 'business_owner';

  const service = useMemo(
    () => (businessId ? new FirestoreService(businessId) : null),
    [businessId]
  );

  const [routes, setRoutes] = useState<RouteTerritory[]>([]);
  const [trucks, setTrucks] = useState<Truck[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [savingRouteId, setSavingRouteId] = useState<string | null>(null);
  const [savedRouteId, setSavedRouteId] = useState<string | null>(null);
  const savedTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [newTruckLabel, setNewTruckLabel] = useState('');
  const [addingTruck, setAddingTruck] = useState(false);
  const [editingTruckId, setEditingTruckId] = useState<string | null>(null);
  const [truckDraft, setTruckDraft] = useState('');

  const [newDriverName, setNewDriverName] = useState('');
  const [newDriverPhone, setNewDriverPhone] = useState('');
  const [addingDriver, setAddingDriver] = useState(false);
  const [editingDriverId, setEditingDriverId] = useState<string | null>(null);
  const [driverNameDraft, setDriverNameDraft] = useState('');
  const [driverPhoneDraft, setDriverPhoneDraft] = useState('');

  const loadAll = useCallback(async () => {
    if (!service) return;
    setLoading(true);
    setError(null);
    try {
      const [r, t, e] = await Promise.all([
        service.getRoutes(),
        service.getTrucks(),
        service.getEmployees(),
      ]);
      setRoutes(r);
      setTrucks(t);
      setEmployees(e);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load fleet data.');
    } finally {
      setLoading(false);
    }
  }, [service]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    return () => {
      if (savedTimeout.current) clearTimeout(savedTimeout.current);
    };
  }, []);

  const drivers = useMemo(
    () => employees.filter((e) => e.role === 'driver'),
    [employees]
  );

  // ===== Route assignments =====
  const handleAssignmentChange = async (
    route: RouteTerritory,
    field: 'truck' | 'driver',
    value: string
  ) => {
    if (!service) return;
    const nextTruckId = field === 'truck' ? value : route.assignedTruckId ?? '';
    const nextDriverId = field === 'driver' ? value : route.assignedDriverId ?? '';
    // Merge write: only the two assignment fields, nothing else on the doc.
    const patch = {
      assignedTruckId: nextTruckId === '' ? null : nextTruckId,
      assignedDriverId: nextDriverId === '' ? null : nextDriverId,
    };
    setSavingRouteId(route.id);
    try {
      await service.updateRoute(route.id, patch);
      setRoutes((prev) =>
        prev.map((r) => (r.id === route.id ? { ...r, ...patch } : r))
      );
      setSavedRouteId(route.id);
      if (savedTimeout.current) clearTimeout(savedTimeout.current);
      savedTimeout.current = setTimeout(() => setSavedRouteId(null), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save assignment.');
    } finally {
      setSavingRouteId(null);
    }
  };

  // ===== Trucks =====
  const handleAddTruck = async () => {
    if (!businessId || !newTruckLabel.trim() || addingTruck) return;
    setAddingTruck(true);
    setError(null);
    try {
      // Minimal doc on purpose: only the label the backend actually uses.
      await setDoc(doc(collection(db, `businesses/${businessId}/trucks`)), {
        plate: newTruckLabel.trim(),
      });
      setNewTruckLabel('');
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add truck.');
    } finally {
      setAddingTruck(false);
    }
  };

  const handleSaveTruck = async (truckId: string) => {
    if (!service || !truckDraft.trim()) return;
    try {
      await service.updateTruck(truckId, { plate: truckDraft.trim() });
      setTrucks((prev) =>
        prev.map((t) => (t.id === truckId ? { ...t, plate: truckDraft.trim() } : t))
      );
      setEditingTruckId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update truck.');
    }
  };

  const handleDeleteTruck = async (truck: Truck) => {
    if (!service) return;
    if (!window.confirm(`Delete truck "${truckLabel(truck)}"? Routes assigned to it will become unassigned.`)) return;
    try {
      await service.deleteTruck(truck.id);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete truck.');
    }
  };

  // ===== Drivers =====
  const handleAddDriver = async () => {
    if (!businessId || !newDriverName.trim() || addingDriver) return;
    setAddingDriver(true);
    setError(null);
    try {
      // Employee record only — never touches auth accounts.
      await setDoc(doc(collection(db, `businesses/${businessId}/employees`)), {
        name: newDriverName.trim(),
        role: 'driver',
        phone: newDriverPhone.trim() === '' ? null : newDriverPhone.trim(),
      });
      setNewDriverName('');
      setNewDriverPhone('');
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add driver.');
    } finally {
      setAddingDriver(false);
    }
  };

  const handleSaveDriver = async (driverId: string) => {
    if (!service || !driverNameDraft.trim()) return;
    try {
      await service.updateEmployee(driverId, {
        name: driverNameDraft.trim(),
        phone: driverPhoneDraft.trim() === '' ? null : driverPhoneDraft.trim(),
      });
      setEmployees((prev) =>
        prev.map((e) =>
          e.id === driverId
            ? {
                ...e,
                name: driverNameDraft.trim(),
                phone: driverPhoneDraft.trim() === '' ? null : driverPhoneDraft.trim(),
              }
            : e
        )
      );
      setEditingDriverId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update driver.');
    }
  };

  const handleDeleteDriver = async (driver: Employee) => {
    if (!service) return;
    if (!window.confirm(`Delete driver "${driverLabel(driver)}"? Routes assigned to them will become unassigned.`)) return;
    try {
      await service.deleteEmployee(driver.id);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete driver.');
    }
  };

  // ===== Owner gate =====
  if (!isOwner) {
    return (
      <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-500">
        <div className="bg-white p-8 rounded-[2rem] border border-gray-100 shadow-sm text-center">
          <i className="fas fa-lock text-3xl text-gray-200 mb-3"></i>
          <p className="text-[10px] font-black uppercase tracking-[0.25em] text-gray-400">
            Fleet management is available to business owners
          </p>
        </div>
      </div>
    );
  }

  if (!businessId) {
    return (
      <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-500">
        <div className="bg-white p-8 rounded-[2rem] border border-gray-100 shadow-sm text-center">
          <p className="text-[10px] font-black uppercase tracking-[0.25em] text-gray-400">
            No business linked to this account yet
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-500">
      {/* Header */}
      <div className="bg-black text-white p-8 rounded-[2.5rem] shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-32 h-32 bg-[#FFD700]/10 rounded-full blur-3xl"></div>
        <div className="relative z-10">
          <h2 className="text-2xl font-black uppercase tracking-tighter mb-1">Fleet Manager</h2>
          <p className="text-gray-500 text-[10px] font-black uppercase tracking-[0.3em]">
            Trucks · Drivers · Route Assignments
          </p>
        </div>
      </div>

      {error && (
        <div className="bg-white p-5 rounded-[2rem] border border-red-100 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-widest text-red-500">{error}</p>
        </div>
      )}

      {loading ? (
        <div className="bg-white p-8 rounded-[2rem] border border-gray-100 shadow-sm text-center">
          <p className="text-[10px] font-black uppercase tracking-[0.25em] text-gray-400">
            Loading fleet…
          </p>
        </div>
      ) : (
        <>
          {/* ===== Route assignments ===== */}
          <section className="space-y-4">
            <div className="flex justify-between items-center px-2">
              <h3 className="font-black text-black text-[10px] uppercase tracking-[0.25em]">
                Route Assignments
              </h3>
              <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest">
                {routes.length} {routes.length === 1 ? 'route' : 'routes'}
              </span>
            </div>

            {routes.length === 0 ? (
              <div className="bg-white p-8 rounded-[2rem] border-2 border-dashed border-gray-100 text-center">
                <i className="fas fa-route text-3xl text-gray-200 mb-3"></i>
                <p className="text-[10px] font-black uppercase tracking-[0.25em] text-gray-400">
                  No routes yet
                </p>
              </div>
            ) : (
              routes.map((route) => {
                const validTruckId = trucks.some((t) => t.id === route.assignedTruckId)
                  ? route.assignedTruckId ?? ''
                  : '';
                const validDriverId = drivers.some((d) => d.id === route.assignedDriverId)
                  ? route.assignedDriverId ?? ''
                  : '';
                return (
                  <div
                    key={route.id}
                    className="bg-white p-6 rounded-[2rem] border border-gray-100 shadow-sm space-y-4"
                  >
                    <div className="flex items-center justify-between">
                      <h4 className="font-black text-sm uppercase tracking-tight">{route.name}</h4>
                      {savedRouteId === route.id && (
                        <span className="text-[9px] font-black text-green-600 uppercase tracking-widest">
                          <i className="fas fa-check mr-1"></i>Saved
                        </span>
                      )}
                      {savingRouteId === route.id && (
                        <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest">
                          Saving…
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <label className="block">
                        <span className="text-[9px] font-black uppercase tracking-[0.2em] text-gray-400">
                          Truck
                        </span>
                        <select
                          value={validTruckId}
                          disabled={savingRouteId === route.id}
                          onChange={(e) => handleAssignmentChange(route, 'truck', e.target.value)}
                          className="mt-1 w-full bg-gray-50 border border-gray-100 rounded-2xl px-4 py-3 text-sm font-bold uppercase tracking-wide focus:outline-none focus:border-black"
                        >
                          <option value="">Unassigned</option>
                          {trucks.map((t) => (
                            <option key={t.id} value={t.id}>
                              {truckLabel(t)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="block">
                        <span className="text-[9px] font-black uppercase tracking-[0.2em] text-gray-400">
                          Driver
                        </span>
                        <select
                          value={validDriverId}
                          disabled={savingRouteId === route.id}
                          onChange={(e) => handleAssignmentChange(route, 'driver', e.target.value)}
                          className="mt-1 w-full bg-gray-50 border border-gray-100 rounded-2xl px-4 py-3 text-sm font-bold uppercase tracking-wide focus:outline-none focus:border-black"
                        >
                          <option value="">Unassigned</option>
                          {drivers.map((d) => (
                            <option key={d.id} value={d.id}>
                              {driverLabel(d)}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  </div>
                );
              })
            )}
          </section>

          {/* ===== Trucks ===== */}
          <section className="space-y-4">
            <div className="flex justify-between items-center px-2">
              <h3 className="font-black text-black text-[10px] uppercase tracking-[0.25em]">
                Trucks
              </h3>
              <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest">
                {trucks.length} {trucks.length === 1 ? 'truck' : 'trucks'}
              </span>
            </div>

            <div className="bg-white p-6 rounded-[2rem] border border-gray-100 shadow-sm flex gap-2">
              <input
                value={newTruckLabel}
                onChange={(e) => setNewTruckLabel(e.target.value)}
                placeholder="Truck label (e.g. plate #)"
                className="flex-1 bg-gray-50 border border-gray-100 rounded-2xl px-4 py-3 text-sm font-bold placeholder:text-gray-300 placeholder:font-bold placeholder:uppercase placeholder:text-[10px] placeholder:tracking-widest focus:outline-none focus:border-black"
              />
              <button
                onClick={handleAddTruck}
                disabled={addingTruck || !newTruckLabel.trim()}
                className="bg-black text-[#FFD700] px-5 rounded-2xl text-[10px] font-black uppercase tracking-widest active:scale-95 transition-all disabled:opacity-30"
              >
                {addingTruck ? 'Adding…' : <><i className="fas fa-plus mr-1"></i>Add</>}
              </button>
            </div>

            {trucks.length === 0 ? (
              <div className="bg-white p-8 rounded-[2rem] border-2 border-dashed border-gray-100 text-center">
                <i className="fas fa-truck text-3xl text-gray-200 mb-3"></i>
                <p className="text-[10px] font-black uppercase tracking-[0.25em] text-gray-400">
                  No trucks yet — add your first
                </p>
              </div>
            ) : (
              trucks.map((truck) => (
                <div
                  key={truck.id}
                  className="bg-white p-5 rounded-[2rem] border border-gray-100 shadow-sm flex items-center gap-3"
                >
                  <div className="w-11 h-11 rounded-2xl bg-black text-[#FFD700] flex items-center justify-center shrink-0">
                    <i className="fas fa-truck"></i>
                  </div>
                  {editingTruckId === truck.id ? (
                    <input
                      value={truckDraft}
                      onChange={(e) => setTruckDraft(e.target.value)}
                      autoFocus
                      className="flex-1 bg-gray-50 border border-gray-100 rounded-2xl px-4 py-2.5 text-sm font-bold focus:outline-none focus:border-black"
                    />
                  ) : (
                    <span className="flex-1 font-black text-sm uppercase tracking-tight">
                      {truckLabel(truck)}
                    </span>
                  )}
                  {editingTruckId === truck.id ? (
                    <>
                      <button
                        onClick={() => handleSaveTruck(truck.id)}
                        disabled={!truckDraft.trim()}
                        className="text-[10px] font-black uppercase tracking-widest text-green-600 disabled:opacity-30"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditingTruckId(null)}
                        className="text-[10px] font-black uppercase tracking-widest text-gray-400"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => {
                          setEditingTruckId(truck.id);
                          setTruckDraft(truckLabel(truck));
                        }}
                        className="text-gray-400 hover:text-black transition-colors"
                        aria-label="Edit truck"
                      >
                        <i className="fas fa-pen"></i>
                      </button>
                      <button
                        onClick={() => handleDeleteTruck(truck)}
                        className="text-gray-400 hover:text-red-500 transition-colors"
                        aria-label="Delete truck"
                      >
                        <i className="fas fa-trash"></i>
                      </button>
                    </>
                  )}
                </div>
              ))
            )}
          </section>

          {/* ===== Drivers ===== */}
          <section className="space-y-4">
            <div className="flex justify-between items-center px-2">
              <h3 className="font-black text-black text-[10px] uppercase tracking-[0.25em]">
                Drivers
              </h3>
              <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest">
                {drivers.length} {drivers.length === 1 ? 'driver' : 'drivers'}
              </span>
            </div>

            <div className="bg-white p-6 rounded-[2rem] border border-gray-100 shadow-sm space-y-2">
              <div className="flex gap-2">
                <input
                  value={newDriverName}
                  onChange={(e) => setNewDriverName(e.target.value)}
                  placeholder="Driver name"
                  className="flex-1 bg-gray-50 border border-gray-100 rounded-2xl px-4 py-3 text-sm font-bold placeholder:text-gray-300 placeholder:font-bold placeholder:uppercase placeholder:text-[10px] placeholder:tracking-widest focus:outline-none focus:border-black"
                />
                <input
                  value={newDriverPhone}
                  onChange={(e) => setNewDriverPhone(e.target.value)}
                  placeholder="Phone (optional)"
                  inputMode="tel"
                  className="flex-1 bg-gray-50 border border-gray-100 rounded-2xl px-4 py-3 text-sm font-bold placeholder:text-gray-300 placeholder:font-bold placeholder:uppercase placeholder:text-[10px] placeholder:tracking-widest focus:outline-none focus:border-black"
                />
              </div>
              <button
                onClick={handleAddDriver}
                disabled={addingDriver || !newDriverName.trim()}
                className="w-full bg-black text-[#FFD700] py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest active:scale-95 transition-all disabled:opacity-30"
              >
                {addingDriver ? 'Adding…' : <><i className="fas fa-plus mr-1"></i>Add driver</>}
              </button>
              <p className="text-[9px] font-bold uppercase tracking-widest text-gray-300 text-center">
                Employee record only — never touches login accounts
              </p>
            </div>

            {drivers.length === 0 ? (
              <div className="bg-white p-8 rounded-[2rem] border-2 border-dashed border-gray-100 text-center">
                <i className="fas fa-id-card text-3xl text-gray-200 mb-3"></i>
                <p className="text-[10px] font-black uppercase tracking-[0.25em] text-gray-400">
                  No drivers yet — add your first
                </p>
              </div>
            ) : (
              drivers.map((driver) => (
                <div
                  key={driver.id}
                  className="bg-white p-5 rounded-[2rem] border border-gray-100 shadow-sm flex items-center gap-3"
                >
                  <div className="w-11 h-11 rounded-2xl bg-black text-[#FFD700] flex items-center justify-center shrink-0">
                    <i className="fas fa-user"></i>
                  </div>
                  {editingDriverId === driver.id ? (
                    <div className="flex-1 space-y-2">
                      <input
                        value={driverNameDraft}
                        onChange={(e) => setDriverNameDraft(e.target.value)}
                        autoFocus
                        className="w-full bg-gray-50 border border-gray-100 rounded-2xl px-4 py-2.5 text-sm font-bold focus:outline-none focus:border-black"
                      />
                      <input
                        value={driverPhoneDraft}
                        onChange={(e) => setDriverPhoneDraft(e.target.value)}
                        placeholder="Phone (optional)"
                        inputMode="tel"
                        className="w-full bg-gray-50 border border-gray-100 rounded-2xl px-4 py-2.5 text-sm font-bold focus:outline-none focus:border-black"
                      />
                    </div>
                  ) : (
                    <div className="flex-1 min-w-0">
                      <p className="font-black text-sm uppercase tracking-tight truncate">
                        {driverLabel(driver)}
                      </p>
                      {driver.phone ? (
                        <p className="text-[10px] font-bold text-gray-400 tracking-widest">
                          {driver.phone}
                        </p>
                      ) : (
                        <p className="text-[10px] font-bold uppercase tracking-widest text-gray-300">
                          No phone on file
                        </p>
                      )}
                    </div>
                  )}
                  {editingDriverId === driver.id ? (
                    <>
                      <button
                        onClick={() => handleSaveDriver(driver.id)}
                        disabled={!driverNameDraft.trim()}
                        className="text-[10px] font-black uppercase tracking-widest text-green-600 disabled:opacity-30"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditingDriverId(null)}
                        className="text-[10px] font-black uppercase tracking-widest text-gray-400"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => {
                          setEditingDriverId(driver.id);
                          setDriverNameDraft(driverLabel(driver));
                          setDriverPhoneDraft(driver.phone ?? '');
                        }}
                        className="text-gray-400 hover:text-black transition-colors"
                        aria-label="Edit driver"
                      >
                        <i className="fas fa-pen"></i>
                      </button>
                      <button
                        onClick={() => handleDeleteDriver(driver)}
                        className="text-gray-400 hover:text-red-500 transition-colors"
                        aria-label="Delete driver"
                      >
                        <i className="fas fa-trash"></i>
                      </button>
                    </>
                  )}
                </div>
              ))
            )}
          </section>
        </>
      )}
    </div>
  );
};
