/** Cola offline-first de Operaciones Gruero. Nunca confunde persistencia local
 * con confirmación del servidor. El adaptador remoto debe responder {ok:true}
 * o {conflict:true,...}; cada movimiento lleva idempotencyKey y estado previo. */
const GrueroSyncService = {
  DB: 'wms_gruero_offline', STORE: 'movimientos', FALLBACK: 'wms_gruero_pending',
  CONFLICTS: 'wms_gruero_conflicts', HISTORY: 'wms_gruero_history', _syncing: null,

  async db() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) return resolve(null);
      const request = indexedDB.open(this.DB, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(this.STORE)) request.result.createObjectStore(this.STORE, { keyPath: 'id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  },
  readLocal(key) { try { const value = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(value) ? value : []; } catch (_) { return []; } },
  writeLocal(key, items) { localStorage.setItem(key, JSON.stringify(items)); },
  fallback() { return this.readLocal(this.FALLBACK); },
  saveFallback(items) { this.writeLocal(this.FALLBACK, items); },
  conflicts() { return this.readLocal(this.CONFLICTS); },
  history() { return this.readLocal(this.HISTORY); },

  async idbList() {
    const db = await this.db();
    if (!db) return [];
    return new Promise((resolve, reject) => {
      const request = db.transaction(this.STORE, 'readonly').objectStore(this.STORE).getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  },
  async list() {
    let indexed = [];
    try { indexed = await this.idbList(); } catch (_) {}
    const merged = new Map([...this.fallback(), ...indexed].map(item => [item.id, item]));
    return [...merged.values()].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  },
  async put(item) {
    let stored = false;
    try {
      const db = await this.db();
      if (db) await new Promise((resolve, reject) => {
        const request = db.transaction(this.STORE, 'readwrite').objectStore(this.STORE).put(item);
        request.onsuccess = resolve; request.onerror = () => reject(request.error);
      }), stored = true;
    } catch (_) {}
    if (!stored) {
      const all = this.fallback().filter(entry => entry.id !== item.id); all.push(item); this.saveFallback(all);
    } else this.saveFallback(this.fallback().filter(entry => entry.id !== item.id));
    return item;
  },
  async remove(id) {
    try {
      const db = await this.db();
      if (db) await new Promise((resolve, reject) => {
        const request = db.transaction(this.STORE, 'readwrite').objectStore(this.STORE).delete(id);
        request.onsuccess = resolve; request.onerror = () => reject(request.error);
      });
    } catch (_) {}
    this.saveFallback(this.fallback().filter(item => item.id !== id));
  },
  async enqueue(action) {
    const id = `GM-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    return this.put({ id, idempotencyKey: id, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), status: 'pending_local', attempts: 0, lastError: null, ...action });
  },
  addConflict(item, server) {
    const all = this.conflicts().filter(entry => entry.id !== item.id);
    all.push({ ...item, status: 'conflict', server, detectedAt: new Date().toISOString() });
    this.writeLocal(this.CONFLICTS, all.slice(-100));
  },
  addHistory(item, server) {
    const all = this.history();
    all.push({ ...item, status: 'server_confirmed', confirmedAt: new Date().toISOString(), server });
    this.writeLocal(this.HISTORY, all.slice(-250));
  },
  summary(items) {
    return {
      pending: items.filter(item => item.status !== 'conflict').length,
      retry: items.filter(item => item.status === 'retry').length,
      conflicts: this.conflicts().length,
      confirmed: this.history().length
    };
  },
  async sync() {
    if (this._syncing) return this._syncing;
    this._syncing = this._sync().finally(() => { this._syncing = null; });
    return this._syncing;
  },
  async _sync() {
    const queued = await this.list();
    const eligible = queued.filter(item => item.status !== 'conflict');
    if (!navigator.onLine) return { ok: false, offline: true, ...this.summary(queued) };
    if (!window.WmsSyncAdapter?.sendMovement) return { ok: false, unconfigured: true, ...this.summary(queued) };
    let synced = 0;
    for (const original of eligible) {
      const item = { ...original, status: 'syncing', attempts: (original.attempts || 0) + 1, updatedAt: new Date().toISOString() };
      await this.put(item);
      try {
        const result = await window.WmsSyncAdapter.sendMovement(item);
        if (result?.conflict) {
          const conflict = { ...item, status: 'conflict', lastError: result.error || 'El estado remoto cambió.' };
          await this.put(conflict); this.addConflict(conflict, result); continue;
        }
        if (!result?.ok) throw new Error(result?.error || 'El servidor rechazó el movimiento.');
        this.addHistory(item, result); await this.remove(item.id); synced += 1;
      } catch (error) {
        await this.put({ ...item, status: 'retry', lastError: error.message || 'Error de red', updatedAt: new Date().toISOString() });
      }
    }
    const remaining = await this.list();
    return { ok: remaining.length === 0, synced, ...this.summary(remaining) };
  }
};
