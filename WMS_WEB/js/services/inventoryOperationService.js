/**
 * Persistencia offline-first de Operación Inventario.
 *
 * - Online: Supabase crea el snapshot autoritativo y lo devuelve completo.
 * - Offline: se permite iniciar únicamente desde el último snapshot backend
 *   confirmado de Mapa; nunca desde StockModel ni desde datos demo.
 * - Cada cambio se encola con idempotencyKey y se sincroniza al recuperar red.
 */
const InventoryOperationService = {
  DB: 'wms_inventory_operation', VERSION: 1,
  SESSIONS: 'sessions', QUEUE: 'queue',
  FALLBACK_SESSIONS: 'wms_inventory_sessions', FALLBACK_QUEUE: 'wms_inventory_queue',
  _syncing: null, _initialized: false, _listeners: new Set(), _channel: null,

  open() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) return resolve(null);
      const request = indexedDB.open(this.DB, this.VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(this.SESSIONS)) db.createObjectStore(this.SESSIONS, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(this.QUEUE)) db.createObjectStore(this.QUEUE, { keyPath: 'id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  },

  readFallback(key) { try { const data = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(data) ? data : []; } catch (_) { return []; } },
  writeFallback(key, rows) { try { localStorage.setItem(key, JSON.stringify(rows)); } catch (_) {} },

  async all(store, fallbackKey) {
    try {
      const db = await this.open();
      if (db) return await new Promise((resolve, reject) => {
        const request = db.transaction(store, 'readonly').objectStore(store).getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
      });
    } catch (_) {}
    return this.readFallback(fallbackKey);
  },

  async get(store, id, fallbackKey) {
    try {
      const db = await this.open();
      if (db) return await new Promise((resolve, reject) => {
        const request = db.transaction(store, 'readonly').objectStore(store).get(id);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      });
    } catch (_) {}
    return this.readFallback(fallbackKey).find(item => item.id === id) || null;
  },

  async put(store, value, fallbackKey) {
    let stored = false;
    try {
      const db = await this.open();
      if (db) {
        await new Promise((resolve, reject) => {
          const request = db.transaction(store, 'readwrite').objectStore(store).put(value);
          request.onsuccess = resolve;
          request.onerror = () => reject(request.error);
        });
        stored = true;
      }
    } catch (_) {}
    if (!stored) {
      const rows = this.readFallback(fallbackKey).filter(item => item.id !== value.id);
      rows.push(value);
      this.writeFallback(fallbackKey, rows);
    }
    return value;
  },

  async remove(store, id, fallbackKey) {
    try {
      const db = await this.open();
      if (db) await new Promise((resolve, reject) => {
        const request = db.transaction(store, 'readwrite').objectStore(store).delete(id);
        request.onsuccess = resolve;
        request.onerror = () => reject(request.error);
      });
    } catch (_) {}
    this.writeFallback(fallbackKey, this.readFallback(fallbackKey).filter(item => item.id !== id));
  },

  adapter() { return window.WmsInventoryAdapter || null; },
  serverReady() {
    const a = this.adapter();
    return Boolean(a && (a.sendInventoryOperation || a.createOnlineSession || a.createSession));
  },

  async sessions() {
    const rows = await this.all(this.SESSIONS, this.FALLBACK_SESSIONS);
    return rows.sort((a, b) => String(b.iniciadoEn || '').localeCompare(String(a.iniciadoEn || '')));
  },

  async getSession(id) {
    let local = await this.get(this.SESSIONS, id, this.FALLBACK_SESSIONS);
    if (navigator.onLine && this.adapter()?.fetchSession && (!Array.isArray(local?.items) || !local.items.length)) {
      try {
        const remote = await this.adapter().fetchSession(id);
        if (remote?.id) { await this.persistSession(remote, false); local = remote; }
      } catch (_) {}
    }
    return local || null;
  },

  queue() { return this.all(this.QUEUE, this.FALLBACK_QUEUE).then(rows => rows.sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')))); },

  logicalWarehouse(value) {
    const raw = String(value || '').trim().toUpperCase().replace('Ú', 'U');
    if (['POST TUNEL', 'POSTTUNEL', 'PTUN02'].includes(raw)) return 'POST TUNEL';
    if (['PROTER', 'CAM302'].includes(raw)) return 'PROTER';
    return null;
  },

  offlineCandidates(warehouse) {
    const target = InventoryOperationModel.normalizeWarehouse(warehouse);
    const rows = typeof MapaModel !== 'undefined' ? MapaModel.getPallets() : [];
    const confirmed = rows.filter(p => p?._backend_catalog || p?._backend_proter || p?._backend_postunel);
    const byLot = new Map();
    confirmed.forEach(p => {
      const id = String(p.id_lote_real || p.lote || '').trim();
      if (!id) return;
      const physical = this.logicalWarehouse(p.ubicacion) === target;
      const sap = this.logicalWarehouse(p.almacen_sap || p.whscode || p.whsname) === target;
      if (!physical && !sap) return;
      const prev = byLot.get(id);
      if (!prev || physical) byLot.set(id, p);
    });
    return [...byLot.values()];
  },

  async previewCount(warehouse) {
    const active = await this.activeSessionForWarehouse(warehouse);
    if (active) return Number(active.totalSnapshot ?? active.metrics?.total ?? active.items?.length ?? 0);
    return this.offlineCandidates(warehouse).length;
  },

  async activeSessionForWarehouse(warehouse, excludeId = null) {
    const normalized = InventoryOperationModel.normalizeWarehouse(warehouse);
    const adapter = this.adapter();
    if (navigator.onLine && adapter?.getActiveInventorySession) {
      try {
        const remote = await adapter.getActiveInventorySession(normalized);
        if (remote?.id) await this.mergeRemoteSession(remote);
      } catch (_) {}
    }
    const rows = await this.sessions();
    return rows.find(session => session.id !== excludeId && session.estado === InventoryOperationModel.STATES.PROCESS && InventoryOperationModel.normalizeWarehouse(session.almacen) === normalized) || null;
  },

  async availability(warehouse, excludeId = null) {
    if (navigator.onLine) await this.refreshRemote();
    const active = await this.activeSessionForWarehouse(warehouse, excludeId);
    return { available: !active, session: active, warehouse: InventoryOperationModel.normalizeWarehouse(warehouse) };
  },

  async persistSession(session, broadcast = true) {
    if (!session?.id) return null;
    await this.put(this.SESSIONS, session, this.FALLBACK_SESSIONS);
    if (broadcast) this.broadcast({ type: 'SESSION_UPDATED', sessionId: session.id });
    this.emit();
    return session;
  },

  operation(type, session, payload = {}) {
    const id = InventoryOperationModel.id('IOP');
    return { id, idempotencyKey: id, type, sessionId: session.id, warehouse: session.almacen, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), status: 'PENDIENTE_SYNC', attempts: 0, payload };
  },

  async enqueue(operation) {
    await this.put(this.QUEUE, operation, this.FALLBACK_QUEUE);
    this.emit();
    if (navigator.onLine) this.sync();
    return operation;
  },

  async createSession(warehouse) {
    const normalized = InventoryOperationModel.normalizeWarehouse(warehouse);
    const create = async () => {
      const availability = await this.availability(normalized);
      if (!availability.available) return { ok: false, conflict: true, session: availability.session, error: `${normalized} ya tiene un inventario activo.` };
      const user = UserModel.getCurrentUser();

      // Online: no se crea ningún snapshot de negocio en el navegador. Supabase
      // genera el corte con SAP + Posiciones_Mapa y devuelve la sesión completa.
      if (navigator.onLine && this.adapter()?.createOnlineSession) {
        const clientId = InventoryOperationModel.id('INV');
        try {
          const remote = await this.adapter().createOnlineSession({ id: clientId, almacen: normalized, user });
          if (remote?.ok && remote.session?.id) {
            await this.persistSession(remote.session);
            return { ok: true, session: remote.session, backend: true };
          }
          if (remote?.conflict) return remote;
          if (!remote?.red && remote?.error) return { ok: false, error: remote.error };
        } catch (_) {}
      }

      // Sin servidor alcanzable: sólo se admite el último snapshot confirmado.
      const pallets = this.offlineCandidates(normalized);
      if (!pallets.length) return { ok: false, offline: true, error: `No existe snapshot backend confirmado para iniciar ${normalized} sin conexión.` };
      const session = InventoryOperationModel.createSession(normalized, user, pallets, 'OFFLINE');
      await this.persistSession(session);
      await this.enqueue(this.operation('CREAR_SESION', session, { session: InventoryOperationModel.clone(session) }));
      return { ok: true, session, offline: true };
    };
    if (navigator.locks?.request) return navigator.locks.request(`wms-inventory-${normalized}`, { mode: 'exclusive' }, create);
    return create();
  },

  async confirm(session, item, data) {
    const result = InventoryOperationModel.confirm(session, item.palletId, data);
    if (!result.ok) return result;
    await this.persistSession(session);
    await this.enqueue(this.operation('CONFIRMAR_CONTEO', session, { item: InventoryOperationModel.clone(result.item), sessionVersion: session.version }));
    return result;
  },

  async registerRescan(session, item, user) {
    const attempt = InventoryOperationModel.registerRescan(session, item, user);
    await this.persistSession(session);
    if (attempt) await this.enqueue(this.operation('REESCANEO_IGNORADO', session, { item: InventoryOperationModel.clone(item), intento: attempt }));
    return item;
  },

  async closeSession(session) {
    const result = InventoryOperationModel.close(session, UserModel.getCurrentUser());
    if (!result.ok) return result;
    await this.persistSession(session);
    await this.enqueue(this.operation('CERRAR_INVENTARIO', session, { session: InventoryOperationModel.clone(session) }));
    return result;
  },

  async deleteSession(sessionId) {
    const session = await this.getSession(sessionId);
    if (!session) return { ok: false, error: 'El corte ya no existe.' };
    const deletion = this.operation('ELIMINAR_INVENTARIO', session, {
      session: InventoryOperationModel.clone(session),
      eliminadoPor: UserModel.getCurrentUser(),
      eliminadoEn: new Date().toISOString()
    });
    await this.put(this.QUEUE, deletion, this.FALLBACK_QUEUE);
    const pendientes = await this.queue();
    for (const op of pendientes) {
      if (op.sessionId === sessionId && op.id !== deletion.id) await this.remove(this.QUEUE, op.id, this.FALLBACK_QUEUE);
    }
    await this.remove(this.SESSIONS, sessionId, this.FALLBACK_SESSIONS);
    this.broadcast({ type: 'SESSION_DELETED', sessionId });
    this.emit();
    if (navigator.onLine) this.sync();
    return { ok: true, session };
  },

  async send(adapter, operation) {
    if (typeof adapter?.sendInventoryOperation === 'function') return adapter.sendInventoryOperation(operation);
    return { ok: false, error: 'El adaptador central de Inventario no está configurado.' };
  },

  async sync() {
    if (this._syncing) return this._syncing;
    this._syncing = this._sync().finally(() => { this._syncing = null; this.emit(); });
    this.emit();
    return this._syncing;
  },

  async _sync() {
    const rows = await this.queue();
    if (!navigator.onLine) return { ok: false, offline: true, pending: rows.length };
    const adapter = this.adapter();
    if (!this.serverReady()) return { ok: false, unconfigured: true, pending: rows.length };
    let synced = 0;
    for (const original of rows) {
      if (original.status === 'CONFLICTO') continue;
      const item = { ...original, status: 'SINCRONIZANDO', attempts: (original.attempts || 0) + 1, updatedAt: new Date().toISOString() };
      await this.put(this.QUEUE, item, this.FALLBACK_QUEUE);
      try {
        const response = await this.send(adapter, item);
        if (response?.conflict) {
          await this.put(this.QUEUE, { ...item, status: 'CONFLICTO', lastError: response.error || 'La sesión remota cambió.' }, this.FALLBACK_QUEUE);
          continue;
        }
        if (!response?.ok) throw new Error(response?.error || 'El servidor rechazó la operación.');
        if (response.session?.id) await this.mergeRemoteSession(response.session);
        await this.remove(this.QUEUE, item.id, this.FALLBACK_QUEUE);
        synced += 1;
      } catch (error) {
        await this.put(this.QUEUE, { ...item, status: 'REINTENTO', lastError: error.message || 'Error de red', updatedAt: new Date().toISOString() }, this.FALLBACK_QUEUE);
      }
    }
    await this.refreshRemote();
    return { ok: true, synced, pending: (await this.queue()).length };
  },

  async mergeRemoteSession(remote) {
    if (!remote?.id) return null;
    const local = await this.get(this.SESSIONS, remote.id, this.FALLBACK_SESSIONS);
    if (!local || Number(remote.version || 0) >= Number(local.version || 0) || !Array.isArray(local.items)) return this.persistSession(remote, false);
    return local;
  },

  async refreshRemote() {
    const adapter = this.adapter();
    if (!navigator.onLine || !adapter?.fetchSessions) return { ok: false, offline: !navigator.onLine, unconfigured: !adapter };
    try {
      const summaries = await adapter.fetchSessions();
      for (const summary of summaries) {
        const local = await this.get(this.SESSIONS, summary.id, this.FALLBACK_SESSIONS);
        // No sustituir una sesión completa por un resumen sin items.
        const merged = local && Array.isArray(local.items)
          ? { ...local, ...summary, items: local.items, auditoria: local.auditoria || [] }
          : summary;
        await this.persistSession(merged, false);
      }
      this.emit();
      return { ok: true, count: summaries.length };
    } catch (error) {
      return { ok: false, error: error.message || 'No fue posible consultar las sesiones centrales.' };
    }
  },

  async status() {
    const rows = await this.queue();
    return {
      online: navigator.onLine,
      serverReady: this.serverReady(),
      pending: rows.filter(row => row.status !== 'CONFLICTO').length,
      conflicts: rows.filter(row => row.status === 'CONFLICTO').length,
      syncing: Boolean(this._syncing)
    };
  },

  subscribe(listener) { this._listeners.add(listener); return () => this._listeners.delete(listener); },
  emit() { this._listeners.forEach(listener => { try { listener(); } catch (_) {} }); },
  broadcast(message) { try { this._channel?.postMessage(message); } catch (_) {} },

  async initialize() {
    if (this._initialized) return;
    this._initialized = true;
    try {
      this._channel = 'BroadcastChannel' in window ? new BroadcastChannel('wms-inventory-operation') : null;
      if (this._channel) this._channel.onmessage = () => this.emit();
    } catch (_) {}
    window.addEventListener('storage', event => { if ([this.FALLBACK_SESSIONS, this.FALLBACK_QUEUE].includes(event.key)) this.emit(); });
    window.addEventListener('online', () => { this.refreshRemote(); this.sync(); });
    window.addEventListener('offline', () => this.emit());
    if (navigator.onLine) { await this.refreshRemote(); this.sync(); }
  }
};
