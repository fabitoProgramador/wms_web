/**
 * Centro de Etiquetas: Supabase como fuente de verdad + snapshot offline.
 *
 * Online:
 *   - Producción, búsqueda/reimpresión e historial vienen de RPCs públicos.
 *   - Las etiquetas anticipadas/no consolidadas las construye el backend.
 * Offline:
 *   - Se usa únicamente el último snapshot backend confirmado de etiquetas y
 *     catálogo de artículos. Nunca CATALOGO_ARTICULOS ni letras inventadas.
 *   - Las impresiones se realizan igual y su auditoría queda en cola hasta
 *     recuperar conexión.
 */
const LabelService = {
  DB: 'wms_label_offline', VERSION: 1, SNAPSHOTS: 'snapshots', QUEUE: 'queue', ACTIVE: 'active',
  cache: { production: [], history: [], catalog: [], resolved: {}, reconciliation: {}, metadata: null },
  initialized: false, syncing: false,
  companyName: 'Fruticola Olmue',

  uuid() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 3 | 8)).toString(16);
    });
  },

  open() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) return resolve(null);
      const request = indexedDB.open(this.DB, this.VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(this.SNAPSHOTS)) db.createObjectStore(this.SNAPSHOTS, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(this.QUEUE)) db.createObjectStore(this.QUEUE, { keyPath: 'id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  },

  async idbGet(store, id) {
    const db = await this.open();
    if (!db) return null;
    return new Promise((resolve, reject) => {
      const req = db.transaction(store, 'readonly').objectStore(store).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  },

  async idbAll(store) {
    const db = await this.open();
    if (!db) return [];
    return new Promise((resolve, reject) => {
      const req = db.transaction(store, 'readonly').objectStore(store).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  },

  async idbPut(store, value) {
    const db = await this.open();
    if (!db) return value;
    return new Promise((resolve, reject) => {
      const req = db.transaction(store, 'readwrite').objectStore(store).put(value);
      req.onsuccess = () => resolve(value);
      req.onerror = () => reject(req.error);
    });
  },

  async idbRemove(store, id) {
    const db = await this.open();
    if (!db) return;
    return new Promise((resolve, reject) => {
      const req = db.transaction(store, 'readwrite').objectStore(store).delete(id);
      req.onsuccess = resolve;
      req.onerror = () => reject(req.error);
    });
  },

  officialLot(value) { return String(value || '').trim().replace(/[\s-]+/g, '').toUpperCase(); },
  shortReference(value) {
    const match = String(value || '').trim().toUpperCase().replace(/[\s-]+/g, '').match(/^([A-ZÑ]{1,2})(\d{1,4})$/);
    return match ? { letra: match[1], numero: match[2] } : null;
  },

  toLabel(pallet = {}) {
    const lotCode = String(pallet.lotCode || pallet.id_lote_real || pallet.id_lote || pallet.lote || '').trim();
    const consolidated = pallet.consolidated !== undefined ? Boolean(pallet.consolidated) : pallet.no_existe_padre !== true;
    const articleRaw = String(pallet.articleRawCode || pallet.articulo || pallet.itemcode || lotCode.slice(4, 9) || '').slice(-5);
    const articleCode = pallet.articleCode || pallet.numero_articulo || pallet.itemcode || (lotCode ? `${lotCode.slice(0, 2)}${articleRaw}` : articleRaw);
    const ref = pallet.reference || pallet.codigo_visual_legible_backend || pallet.codigo_visual_backend || pallet._codigo_visual_manual || lotCode;
    return {
      companyName: pallet.companyName || this.companyName,
      articleCode,
      articleRawCode: articleRaw,
      articleDescription: pallet.articleDescription || pallet.descripcion || pallet.itemname || 'Sin descripción SAP disponible',
      lotCode,
      barcodeValue: pallet.barcodeValue || lotCode,
      symbology: pallet.symbology || PalletLabelTemplate.DEFAULT_SYMBOLOGY,
      reference: ref,
      source: consolidated ? 'pallet' : 'anticipated',
      consolidated
    };
  },

  async rpc(nombre, params = {}) {
    const r = await SupabaseService.rpc('etiquetas', nombre, params);
    if (!r.ok) return { ok: false, error: r.error, red: Boolean(r.red), permiso: Boolean(r.permiso), estado: r.estado };
    return { ok: true, data: r.datos };
  },

  async saveSnapshot() {
    await this.idbPut(this.SNAPSHOTS, { id: this.ACTIVE, data: this.cache, savedAt: new Date().toISOString() }).catch(() => {});
  },

  hydrateLetters() {
    if (typeof LETRAS_POR_ARTICULO !== 'object') return;
    Object.keys(LETRAS_POR_ARTICULO).forEach(key => delete LETRAS_POR_ARTICULO[key]);
    (this.cache.catalog || []).forEach(item => {
      const code = String(item.codigo || '').trim();
      const letter = String(item.letra || '').trim().toUpperCase();
      if (code && letter) LETRAS_POR_ARTICULO[code] = letter;
    });
  },

  async initialize() {
    if (this.initialized) return this.cache;
    const saved = await this.idbGet(this.SNAPSHOTS, this.ACTIVE).catch(() => null);
    if (saved?.data) this.cache = { ...this.cache, ...saved.data };
    this.hydrateLetters();
    this.initialized = true;
    if (navigator.onLine && SupabaseService.haySesion()) await this.refresh().catch(() => {});
    window.addEventListener('online', () => { this.refresh().catch(() => {}); this.syncQueue(); });
    return this.cache;
  },

  async refresh() {
    if (!SupabaseService.haySesion()) return { ok: false, sinSesion: true };
    const [prod, hist, catalog] = await Promise.all([
      this.rpc('produccion', { p_limite: 100 }),
      this.rpc('historial', { p_id_lote: null, p_limite: 200, p_offset: 0 }),
      SupabaseService.rpc('mapa', 'catalogoCodigos', { p_busqueda: '', p_historial_limite: 0 })
    ]);
    if (!prod.ok && prod.red) return prod;
    if (prod.ok) {
      this.cache.production = Array.isArray(prod.data?.items) ? prod.data.items.map(x => this.toLabel(x)) : [];
      this.cache.metadata = { almacenOrigen: prod.data?.almacen_origen || null, snapshotVersion: prod.data?.snapshot_version || null, cacheKey: prod.data?.cache_key || null, generadoEn: prod.data?.generado_en || null };
      this.cache.reconciliation = prod.data?.reconciliacion || this.cache.reconciliation;
    }
    if (hist.ok) {
      this.cache.history = Array.isArray(hist.data?.items) ? hist.data.items : [];
      this.cache.reconciliation = hist.data?.reconciliacion || this.cache.reconciliation;
    }
    if (catalog.ok) this.cache.catalog = Array.isArray(catalog.datos?.items) ? catalog.datos.items : [];
    this.hydrateLetters();
    await this.saveSnapshot();
    await this.syncQueue();
    return { ok: true, cache: this.cache };
  },

  production(limit = 24) { return (this.cache.production || []).slice(0, limit); },
  history() { return this.cache.history || []; },
  reconciliation() { return this.cache.reconciliation || { revisados: 0, consolidados: 0, discrepancias: 0 }; },

  catalogItem(article) { return (this.cache.catalog || []).find(x => String(x.codigo || '') === String(article || '')) || null; },
  articleForLetter(letter) { return (this.cache.catalog || []).find(x => String(x.letra || '').toUpperCase() === String(letter || '').toUpperCase()) || null; },

  anticipatedFromLot(value, reference = null) {
    const lotCode = this.officialLot(value);
    if (!/^\d{12,13}$/.test(lotCode)) return null;
    const article = lotCode.slice(4, 9);
    const master = this.catalogItem(article);
    if (!master?.descripcion) return null;
    return {
      companyName: this.companyName,
      articleCode: `${lotCode.slice(0, 2)}${article}`,
      articleRawCode: article,
      articleDescription: master.descripcion,
      lotCode,
      barcodeValue: lotCode,
      symbology: PalletLabelTemplate.DEFAULT_SYMBOLOGY,
      reference: reference || lotCode,
      source: 'anticipated',
      consolidated: false
    };
  },

  resolvedCache(value) {
    const query = String(value || '').trim();
    if (!query) return { ok: false, error: 'Ingresá o escaneá un ID de lote o referencia de pallet.' };
    const compact = this.officialLot(query);
    const memo = this.cache.resolved?.[compact] || this.cache.resolved?.[query.toUpperCase()];
    if (memo) return { ok: true, label: memo, offline: true };

    const existing = this.production(100).find(x => x.lotCode === compact)
      || this.history().map(x => this.toLabel(x)).find(x => x.lotCode === compact);
    if (existing?.lotCode) return { ok: true, label: existing, offline: true };

    if (typeof MapaModel !== 'undefined') {
      const resolved = MapaModel.resolverPallet(query);
      if (resolved?.ok) {
        const label = this.toLabel({ ...resolved.pallet, consolidated: resolved.pallet.no_existe_padre !== true });
        if (label.articleDescription && label.articleDescription !== 'Sin descripción SAP disponible') return { ok: true, label, offline: true };
      }
    }

    const short = this.shortReference(query);
    if (short) {
      const master = this.articleForLetter(short.letra);
      if (!master) return { ok: false, error: 'Sin conexión: la referencia visual no existe en el catálogo backend guardado. Use el ID de lote completo.' };
      const n = String(Number(short.numero));
      if (!/^\d+$/.test(n) || Number(n) < 1 || Number(n) > 9999) return { ok: false, error: 'Número de pallet fuera de rango.' };
      const suffix = n.padStart(3, '0');
      const temporada = String(IDENTIDAD_PLANTA?.temporadaActual || '26');
      const planta = String(IDENTIDAD_PLANTA?.codigoPlantaLote || '30');
      const lotCode = `${temporada}${planta}${master.codigo}${suffix}`;
      const anticipated = this.anticipatedFromLot(lotCode, `${short.letra}${Number(short.numero)}`);
      if (anticipated) return { ok: true, label: anticipated, offline: true };
    }

    const anticipated = this.anticipatedFromLot(compact);
    if (anticipated) return { ok: true, label: anticipated, offline: true };
    return { ok: false, error: 'Sin conexión: el código no existe en el último snapshot backend de etiquetas/artículos.' };
  },

  async resolveOperacional(value) {
    const query = String(value || '').trim();
    if (navigator.onLine && SupabaseService.haySesion()) {
      const remote = await this.rpc('resolver', { p_codigo: query });
      if (remote.ok && remote.data?.ok && remote.data?.label) {
        const label = this.toLabel(remote.data.label);
        this.cache.resolved ||= {};
        this.cache.resolved[this.officialLot(query)] = label;
        this.cache.resolved[label.lotCode] = label;
        this.cache.reconciliation = remote.data.reconciliacion || this.cache.reconciliation;
        await this.saveSnapshot();
        return { ...remote.data, ok: true, label };
      }
      if (remote.ok && remote.data?.ok === false) return remote.data;
      if (!remote.red) return { ok: false, error: remote.error || 'No fue posible resolver la etiqueta.' };
    }
    return this.resolvedCache(query);
  },

  // Compatibilidad para consumidores que sólo pueden resolver sin await.
  resolve(value) { return this.resolvedCache(value); },
  consolidated(lotCode) {
    const found = this.production(100).find(x => x.lotCode === this.officialLot(lotCode));
    return found || null;
  },

  optimisticHistory(label, copies, extra = {}) {
    const previous = this.history().filter(x => x.lotCode === label.lotCode && x.result !== 'revisar').length;
    return {
      id: `LOCAL-${this.uuid()}`,
      fecha: new Date().toLocaleString('es-CL'),
      timestamp: Date.now(),
      lotCode: label.lotCode,
      articleCode: label.articleCode,
      articleDescription: label.articleDescription,
      reference: label.reference || label.lotCode,
      copies: Number(copies) || 0,
      kind: previous ? 'reimpresion' : 'inicial',
      source: label.source || 'pallet',
      consolidated: label.source !== 'anticipated',
      result: extra.result || 'impresa',
      formato: extra.formato || null,
      dpi: extra.dpi || null,
      destino: extra.destino || null,
      usuario: (UserModel.getCurrentUser() || {}).name || 'Usuario WMS',
      pendingSync: true
    };
  },

  async recordPrint(label, copies, extra = {}) {
    const entry = this.optimisticHistory(label, copies, extra);
    this.cache.history = [entry, ...this.history().filter(x => x.id !== entry.id)];
    const id = this.uuid();
    await this.idbPut(this.QUEUE, {
      id,
      operacionUuid: id,
      createdAt: new Date().toISOString(),
      job: {
        lotCode: label.lotCode,
        copies: Number(copies) || 1,
        destino: extra.destino || 'no-impresa',
        formato: extra.formato || null,
        dpi: extra.dpi || null,
        impresora: LabelFormatService.config().printer || null,
        impreso_local_en: new Date().toISOString()
      }
    }).catch(() => {});
    await this.saveSnapshot();
    if (navigator.onLine) this.syncQueue();
    return entry;
  },

  async syncQueue() {
    if (this.syncing || !navigator.onLine || !SupabaseService.haySesion()) return;
    this.syncing = true;
    try {
      const rows = await this.idbAll(this.QUEUE).catch(() => []);
      let changed = false;
      for (const row of rows) {
        const r = await this.rpc('registrarImpresion', { p_trabajos: [row.job], p_operacion_uuid: row.operacionUuid });
        if (!r.ok || r.data?.ok === false) continue;
        await this.idbRemove(this.QUEUE, row.id).catch(() => {});
        changed = true;
      }
      if (changed) {
        const hist = await this.rpc('historial', { p_id_lote: null, p_limite: 200, p_offset: 0 });
        if (hist.ok) {
          this.cache.history = Array.isArray(hist.data?.items) ? hist.data.items : [];
          this.cache.reconciliation = hist.data?.reconciliacion || this.cache.reconciliation;
          await this.saveSnapshot();
        }
      }
    } finally { this.syncing = false; }
  },

  install() {
    if (typeof LabelController === 'undefined' || LabelController.__backendInstalled) return;
    LabelController.__backendInstalled = true;
    LabelController.search = async event => {
      event.preventDefault();
      LabelController.query = document.getElementById('labelLotSearch')?.value || '';
      const result = await this.resolveOperacional(LabelController.query);
      LabelController.selected = result.ok ? result.label : null;
      LabelController.render();
      NotificationService.show(result.ok
        ? `Etiqueta preparada para ${result.label.lotCode}${result.label.source === 'anticipated' ? ' · pallet aún no consolidado' : ''}.`
        : (result.error || 'No fue posible resolver la etiqueta.'), { type: result.ok ? 'success' : 'error' });
    };
  }
};
