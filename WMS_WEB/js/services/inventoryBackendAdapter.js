/**
 * Adaptador permanente de Operación Inventario -> Supabase.
 * El servicio offline conserva sesiones/snapshot/cola; el backend es quien
 * crea el corte autoritativo cuando hay conexión y valida cada sincronización.
 */
const InventoryBackendAdapter = {
  instalado: false,

  async rpc(nombre, parametros = {}) {
    const response = await SupabaseService.rpc('inventario', nombre, parametros);
    if (!response.ok) {
      return { ok: false, error: response.error || `No fue posible ejecutar inventario.${nombre}.`, red: Boolean(response.red), permiso: Boolean(response.permiso), estado: response.estado || null };
    }
    return { ok: true, data: response.datos };
  },

  uuid() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 3 | 8)).toString(16);
    });
  },

  async sendInventoryOperation(operation) {
    const payload = JSON.parse(JSON.stringify(operation || {}));
    if (String(payload.type || '').toUpperCase() === 'CREAR_SESION') {
      payload.payload ||= {};
      payload.payload.session ||= {};
      if (!payload.payload.session.origen) payload.payload.session.origen = navigator.onLine ? 'ONLINE' : 'OFFLINE';
    }
    const r = await this.rpc('sincronizarOperacion', { p_operacion: payload });
    if (!r.ok) return r;
    return r.data;
  },

  async createOnlineSession({ id, almacen, user } = {}) {
    const key = `IOP-${this.uuid()}`;
    const shell = {
      id,
      almacen,
      origen: 'ONLINE',
      estado: 'EN PROCESO',
      iniciadoEn: new Date().toISOString(),
      iniciadoPor: { id: user?.id || null, nombre: user?.name || 'Usuario WMS', rol: user?.role || 'Usuario' },
      items: [],
      auditoria: [],
      version: 1
    };
    return this.sendInventoryOperation({
      id: key,
      idempotencyKey: key,
      type: 'CREAR_SESION',
      sessionId: id,
      warehouse: almacen,
      createdAt: new Date().toISOString(),
      payload: { session: shell }
    });
  },

  async fetchSessions() {
    const r = await this.rpc('sesiones', { p_limite: 50, p_incluir_anulados: false });
    if (!r.ok) throw new Error(r.error || 'No fue posible consultar inventarios.');
    return Array.isArray(r.data?.items) ? r.data.items : [];
  },

  async fetchSession(id) {
    const r = await this.rpc('sesion', { p_cliente_id: id });
    if (!r.ok) throw new Error(r.error || 'No fue posible consultar el inventario.');
    return r.data || null;
  },

  async getActiveInventorySession(warehouse) {
    const r = await this.rpc('activo', { p_almacen: warehouse });
    if (!r.ok) throw new Error(r.error || 'No fue posible consultar el corte activo.');
    return r.data || null;
  },

  async resolveCode(sessionId, code) {
    const r = await this.rpc('resolverCodigo', { p_cliente_id: sessionId, p_codigo: String(code || '').trim() });
    if (!r.ok) return r;
    return r.data;
  },

  palletVisual(row = {}) {
    const posiciones = Array.isArray(row.posiciones) ? row.posiciones : [];
    const first = posiciones[0] || null;
    const idLote = String(row.id_lote || '').trim();
    const article = row.itemcode || idLote.slice(4, 9);
    const visual = row.codigo_visual_legible || row.codigo_visual || idLote;
    return {
      id: first?.segmento_id ? `SEG-${first.segmento_id}` : `CAT-${idLote}`,
      id_lote_real: idLote,
      lote: idLote,
      articulo: String(article || '').slice(-5),
      numero_articulo: row.itemcode || '',
      numero_pallet: row.numero_pallet || idLote.slice(9),
      descripcion: row.itemname || 'Sin descripción SAP disponible',
      cajas: row.cajas ?? null,
      kilos: row.kilos ?? null,
      estado: row.estado_mapa || row.estado_wms || row.estado_sap || 'SIN INFORMACIÓN',
      estado_sap: row.estado_sap || null,
      estado_wms: row.estado_wms || null,
      _codigo_visual_manual: String(visual || ''),
      ubicacion: first?.camara || row.almacen_sap || 'CATALOGO',
      banda: first?.banda ?? null,
      posicion: first?.posicion ?? null,
      altura: first?.altura ?? first?.nivel ?? null,
      segmento_id: first?.segmento_id ?? null,
      no_existe_padre: Boolean(row.no_existe_padre),
      _posiciones_backend: posiciones,
      _backend_catalog: !first,
      _backend_proter: first?.camara === 'PROTER',
      _backend_postunel: first?.camara === 'POST TUNEL'
    };
  },

  async resolveOperational(session, code, source = 'MANUAL') {
    if (navigator.onLine && SupabaseService.haySesion() && session?.id) {
      const remote = await this.resolveCode(session.id, code);
      if (remote?.ok) {
        const pallet = this.palletVisual(remote.pallet || { id_lote: remote.idLote });
        return { ...remote, pallet, source, canalEntrada: GrueroCodeResolver.inputChannel(source), origenCodigo: remote.origenCodigo || remote.pallet?.origen_codigo || 'PALLET', codigoOriginal: remote.codigoOriginal || code, backend: true };
      }
      if (!remote?.red) return remote;
    }
    const cached = GrueroCodeResolver.resolverCodigo(code, source);
    return cached.ok ? { ...cached, offline: true } : cached;
  },

  install() {
    if (this.instalado) return;
    window.WmsInventoryAdapter = {
      sendInventoryOperation: op => this.sendInventoryOperation(op),
      fetchSessions: () => this.fetchSessions(),
      fetchSession: id => this.fetchSession(id),
      getActiveInventorySession: warehouse => this.getActiveInventorySession(warehouse),
      resolveCode: (sessionId, code) => this.resolveCode(sessionId, code)
    };

    if (typeof InventoryOperationController !== 'undefined') {
      const C = InventoryOperationController;
      const originalInit = C.init.bind(C);
      C.init = async function(root) {
        await originalInit(root);
        if (this.session?.id && (!Array.isArray(this.session.items) || !this.session.items.length) && navigator.onLine) {
          const full = await InventoryOperationService.getSession(this.session.id);
          if (full?.id) {
            this.session = full;
            this.warehouse = full.almacen;
            this.band = InventoryOperationModel.bands(this.warehouse)[0];
            await this.render();
          }
        }
      };

      C.startView = async function() {
        const sessions = await InventoryOperationService.sessions();
        const active = sessions.filter(session => session.estado === InventoryOperationModel.STATES.PROCESS);
        const selectedBusy = active.find(session => session.almacen === this.warehouse);
        const count = await InventoryOperationService.previewCount(this.warehouse);
        const countText = navigator.onLine && !count ? 'Al iniciar' : this.fmt(count);
        return `<div class="io-start-layout"><article class="io-start-card panel-surface"><div class="io-start-intro"><span class="io-step">01</span><div><h2>Crear corte de inventario</h2><p>Online el snapshot se congela en Supabase; offline usa exclusivamente el último snapshot backend confirmado.</p></div>${this.warehouseToggle(active)}</div><div class="io-start-meta"><div><span>ALMACÉN SELECCIONADO</span><b>${this.esc(this.warehouse)}</b></div><div><span>PALLETS DEL CORTE</span><b>${this.esc(countText)}</b></div><div><span>ESTADO</span><b class="${selectedBusy ? 'busy' : ''}">${selectedBusy ? 'CORTE ACTIVO' : 'DISPONIBLE'}</b></div></div><button class="io-start-button" ${selectedBusy ? 'disabled' : ''} onclick="InventoryOperationController.startCut()"><span>▣</span><div><b>${selectedBusy ? 'CÁMARA CON INVENTARIO ACTIVO' : 'INICIAR CORTE DE INVENTARIO'}</b><small>${selectedBusy ? `Responsable: ${this.esc(selectedBusy.iniciadoPor?.nombre || 'Usuario WMS')}` : 'Supabase valida la cámara antes de congelar el snapshot'}</small></div></button></article>${this.recentSessions(sessions)}</div>`;
      };

      C.startCut = async function() {
        const availability = await InventoryOperationService.availability(this.warehouse);
        if (!availability.available) return this.showNotice('Cámara con inventario activo', `${this.warehouse} ya tiene un corte iniciado por ${availability.session?.iniciadoPor?.nombre || 'otro usuario'}. No se creó una sesión duplicada.`, 'warning');
        const count = await InventoryOperationService.previewCount(this.warehouse);
        if (!navigator.onLine && !count) return this.toast(`No existe snapshot backend confirmado para ${this.warehouse}; no se puede iniciar el corte offline.`, 'error');
        const detail = navigator.onLine
          ? 'Supabase congelará el snapshot autoritativo usando SAP y las posiciones físicas registradas en mapa.'
          : `Se congelará el último snapshot backend confirmado con ${this.fmt(count)} pallet(s).`;
        this.showDecision({ icon: '▣', eyebrow: 'CONFIRMAR CORTE', title: `Iniciar inventario en ${this.warehouse}`, message: `${detail} El stock oficial no será modificado.`, confirmLabel: 'INICIAR INVENTARIO', tone: 'success', action: () => this.createConfirmedCut() });
      };

      C.createConfirmedCut = async function() {
        const result = await InventoryOperationService.createSession(this.warehouse);
        if (!result.ok) return this.showNotice('No fue posible iniciar el corte', result.error || 'La cámara ya tiene un inventario activo.', 'warning');
        this.session = result.session;
        this.band = InventoryOperationModel.bands(this.warehouse)[0];
        this.view = 'scan';
        await this.render();
        const total = Number(this.session.totalSnapshot ?? this.session.items?.filter(x => !x.esExtra).length ?? 0);
        this.toast(`Corte ${this.session.id} creado con ${this.fmt(total)} pallet(s)${result.offline ? ' desde snapshot offline backend' : ' por Supabase'}.`);
      };

      C.resolveCode = async (code, source = 'MANUAL') => {
        if (!C.session || C.session.estado !== InventoryOperationModel.STATES.PROCESS) return;
        const resolved = await this.resolveOperational(C.session, code, source);
        if (!resolved?.ok) {
          C.candidate = null;
          C.render();
          return C.toast(resolved?.error || 'Código no reconocido.', 'error');
        }
        const idLote = String(resolved.idLote || resolved.pallet?.id_lote_real || resolved.pallet?.id_lote || '');
        let item = C.session.items?.find(x => x.idLote === idLote || x.palletId === idLote) || null;
        if (!item && resolved.esExtraCandidato && resolved.puedeContar) {
          item = InventoryOperationModel.itemFromResolved(resolved);
          C.session.items ||= [];
          C.session.items.push(item);
        }
        if (!item) {
          C.candidate = null;
          C.render();
          return C.toast(`El pallet ${idLote || 'consultado'} no pertenece al corte ${C.session.almacen}.`, 'error');
        }
        if (item.estadoConteo === InventoryOperationModel.COUNT_STATES.SCANNED) {
          await InventoryOperationService.registerRescan(C.session, item, C.userAudit());
          C.candidate = { item, pallet: resolved.pallet, resolved, duplicate: true };
        } else {
          C.candidate = { item, pallet: resolved.pallet, resolved, duplicate: false, hasDifference: false, cajasFisicas: null };
        }
        C.view = 'scan';
        C.render();
      };

      const originalMountBand = C.mountBand.bind(C);
      C.mountBand = function() {
        originalMountBand();
        if (navigator.onLine && typeof MapaOfflineService !== 'undefined') {
          MapaOfflineService.refreshFromServer().then(r => { if (r?.ok && AppController.activeView === 'operacion_inventario') originalMountBand(); }).catch(() => {});
        }
      };
    }
    this.instalado = true;
  }
};
