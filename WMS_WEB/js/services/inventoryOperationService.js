/** Persistencia offline-first y sincronización idempotente de inventarios. */
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

  readFallback(key) {
    try { const data = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(data) ? data : []; }
    catch (_) { return []; }
  },
  writeFallback(key, rows) { localStorage.setItem(key, JSON.stringify(rows)); },

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
      if (db) await new Promise((resolve, reject) => {
        const request = db.transaction(store, 'readwrite').objectStore(store).put(value);
        request.onsuccess = resolve;
        request.onerror = () => reject(request.error);
      }), stored = true;
    } catch (_) {}
    if (!stored) {
      const rows = this.readFallback(fallbackKey).filter(item => item.id !== value.id);
      rows.push(value); this.writeFallback(fallbackKey, rows);
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

  sessions() { return this.all(this.SESSIONS, this.FALLBACK_SESSIONS).then(rows => rows.sort((a, b) => String(b.iniciadoEn).localeCompare(String(a.iniciadoEn)))); },
  getSession(id) { return this.get(this.SESSIONS, id, this.FALLBACK_SESSIONS); },
  queue() { return this.all(this.QUEUE, this.FALLBACK_QUEUE).then(rows => rows.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))); },

  async activeSessionForWarehouse(warehouse, excludeId = null) {
    const normalized = InventoryOperationModel.normalizeWarehouse(warehouse);
    const adapter = this.adapter();
    if (navigator.onLine && adapter && typeof adapter.getActiveInventorySession === 'function') {
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
      const session = InventoryOperationModel.createSession(normalized, UserModel.getCurrentUser());
      await this.persistSession(session);
      await this.enqueue(this.operation('CREAR_SESION', session, { session: InventoryOperationModel.clone(session) }));
      return { ok: true, session };
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
    InventoryOperationModel.registerRescan(session, item, user);
    await this.persistSession(session);
    return item;
  },

  async closeSession(session) {
    const result = InventoryOperationModel.close(session, UserModel.getCurrentUser());
    if (!result.ok) return result;
    await this.persistSession(session);
    await this.enqueue(this.operation('CERRAR_INVENTARIO', session, { session: InventoryOperationModel.clone(session) }));
    return result;
  },

  /**
   * Elimina un corte de inventario, esté en proceso o finalizado.
   *
   * Tres cosas importan acá:
   *
   * 1. Se encola PRIMERO la operación y recién después se borra en local. La
   *    operación 'ELIMINAR_INVENTARIO' viaja con una copia completa de la
   *    sesión, así que el servidor recibe qué se borró, quién lo borró y
   *    cuándo, aunque el equipo esté sin conexión en ese momento.
   *
   * 2. Se purgan las operaciones pendientes de ESE corte que todavía no se
   *    sincronizaron. Si no, la cola seguiría empujando conteos de una sesión
   *    que ya no existe y el servidor volvería a crearla.
   *
   * 3. No toca stock ni posiciones: un corte es sólo un conteo. Borrarlo
   *    elimina el recuento, nunca el inventario real de la cámara.
   */
  async deleteSession(sessionId) {
    const session = await this.getSession(sessionId);
    if (!session) return { ok: false, error: 'El corte ya no existe.' };

    await this.enqueue(this.operation('ELIMINAR_INVENTARIO', session, {
      session: InventoryOperationModel.clone(session),
      eliminadoPor: UserModel.getCurrentUser(),
      eliminadoEn: new Date().toISOString()
    }));

    const pendientes = await this.queue();
    for (const op of pendientes) {
      if (op.sessionId === sessionId && op.type !== 'ELIMINAR_INVENTARIO') {
        await this.remove(this.QUEUE, op.id, this.FALLBACK_QUEUE);
      }
    }

    await this.remove(this.SESSIONS, sessionId, this.FALLBACK_SESSIONS);
    this.broadcast({ type: 'SESSION_DELETED', sessionId });
    this.emit();
    if (navigator.onLine) this.sync();
    return { ok: true, session };
  },

  adapter() { return window.WmsInventoryAdapter || null; },
  serverReady() {
    const adapter = this.adapter();
    return Boolean(adapter && (adapter.sendInventoryOperation || adapter.createSession || adapter.confirmCount || adapter.closeSession));
  },

  async send(adapter, operation) {
    if (typeof adapter.sendInventoryOperation === 'function') return adapter.sendInventoryOperation(operation);
    if (operation.type === 'CREAR_SESION' && typeof adapter.createSession === 'function') return adapter.createSession(operation.payload.session, operation.idempotencyKey);
    if (operation.type === 'CONFIRMAR_CONTEO' && typeof adapter.confirmCount === 'function') return adapter.confirmCount(operation.sessionId, operation.payload.item, operation.idempotencyKey);
    if (operation.type === 'CERRAR_INVENTARIO' && typeof adapter.closeSession === 'function') return adapter.closeSession(operation.sessionId, operation.payload.session, operation.idempotencyKey);
    return { ok: false, error: 'El adaptador central no implementa esta operación.' };
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
      const item = { ...original, status: 'SINCRONIZANDO', attempts: (original.attempts || 0) + 1, updatedAt: new Date().toISOString() };
      await this.put(this.QUEUE, item, this.FALLBACK_QUEUE);
      try {
        const response = await this.send(adapter, item);
        if (response?.conflict) {
          await this.put(this.QUEUE, { ...item, status: 'CONFLICTO', lastError: response.error || 'La sesión remota cambió.' }, this.FALLBACK_QUEUE);
          continue;
        }
        if (!response?.ok) throw new Error(response?.error || 'El servidor rechazó la operación.');
        if (response.session) await this.mergeRemoteSession(response.session);
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
    const local = await this.getSession(remote.id);
    if (!local || Number(remote.version || 0) >= Number(local.version || 0)) return this.persistSession(remote, false);
    return local;
  },

  async refreshRemote() {
    const adapter = this.adapter();
    if (!navigator.onLine || !adapter) return { ok: false, offline: !navigator.onLine, unconfigured: !adapter };
    try {
      let remote = [];
      if (typeof adapter.fetchSessions === 'function') remote = await adapter.fetchSessions();
      else if (typeof adapter.listSessions === 'function') remote = await adapter.listSessions();
      if (!Array.isArray(remote)) return { ok: false, unconfigured: true };
      for (const session of remote) await this.mergeRemoteSession(session);
      this.emit();
      return { ok: true, count: remote.length };
    } catch (error) { return { ok: false, error: error.message || 'No fue posible consultar las sesiones centrales.' }; }
  },

  async status() {
    const rows = await this.queue();
    return { online: navigator.onLine, serverReady: this.serverReady(), pending: rows.filter(row => row.status !== 'CONFLICTO').length, conflicts: rows.filter(row => row.status === 'CONFLICTO').length, syncing: Boolean(this._syncing) };
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
    window.addEventListener('online', () => this.sync());
    window.addEventListener('offline', () => this.emit());
    if (navigator.onLine) { await this.refreshRemote(); this.sync(); }
  }
};
