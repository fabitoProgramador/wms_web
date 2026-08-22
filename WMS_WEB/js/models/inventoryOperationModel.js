/**
 * Reglas de presentación/estado offline de Operación Inventario.
 *
 * IMPORTANTE: este modelo ya no consulta StockModel ni fabrica un stock de
 * negocio. Online, el snapshot nace en Supabase. Offline, recibe únicamente
 * pallets provenientes del último snapshot backend confirmado.
 */
const InventoryOperationModel = {
  WAREHOUSES: Object.freeze({ PROTER: 'PROTER', POSTTUNNEL: 'POST TUNEL' }),
  STATES: Object.freeze({ PROCESS: 'EN PROCESO', FINISHED: 'FINALIZADA' }),
  COUNT_STATES: Object.freeze({ PENDING: 'PENDIENTE', SCANNED: 'ESCANEADO', NOT_SCANNED: 'NO ESCANEADO' }),

  normalizeWarehouse(value) {
    const normalized = String(value || '').trim().toLocaleUpperCase('es-CL').replace(/\s+/g, ' ');
    return normalized === 'POSTTUNNEL' || normalized === 'POST TÚNEL' || normalized === 'POST TUNEL' || normalized === 'PTUN02'
      ? this.WAREHOUSES.POSTTUNNEL
      : this.WAREHOUSES.PROTER;
  },

  id(prefix = 'INV') {
    const uuid = globalThis.crypto?.randomUUID?.();
    if (uuid) return `${prefix}-${uuid}`;
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  },

  clone(value) { return JSON.parse(JSON.stringify(value)); },

  position(pallet) {
    if (!pallet || pallet.banda === null || pallet.banda === undefined) return null;
    return {
      almacen: pallet.ubicacion || pallet.camara || '—',
      banda: pallet.banda,
      posicion: Number(pallet.posicion) || null,
      nivel: pallet.altura || pallet.nivel || null,
      ...(pallet.segmento_id != null ? { segmento_id: Number(pallet.segmento_id) } : {})
    };
  },

  snapshotPallet(pallet = {}, warehouse = null) {
    const idLote = String(pallet.id_lote_real || pallet.id_lote || pallet.lote || '').trim();
    const articulo = String(pallet.articulo || pallet.itemcode || idLote.slice(4, 9) || '').slice(-5);
    const ubicacion = this.position(pallet);
    return {
      palletId: idLote,
      idLote,
      numeroArticulo: pallet.numero_articulo || pallet.itemcode || '',
      articulo,
      numeroPallet: String(pallet.numero_pallet || idLote.slice(9) || ''),
      descripcion: pallet.descripcion || pallet.itemname || 'Sin descripción SAP disponible',
      almacen: this.normalizeWarehouse(warehouse || pallet.almacen_sap || pallet.ubicacion),
      whscodeSnapshot: pallet.whscode || null,
      whsnameSnapshot: pallet.whsname || null,
      datosSapSnapshot: pallet.no_existe_padre !== true,
      noExisteSapSnapshot: pallet.no_existe_padre === true,
      kilosSistema: pallet.kilos_logicos ?? pallet.kilos ?? null,
      cajasSistema: pallet.cajas_logicas ?? pallet.cajas ?? null,
      fechaFabricacion: pallet.fecha_fabricacion || null,
      estadoCalidad: pallet.calidad_estado || pallet.estado_sap || null,
      estadoSapSnapshot: pallet.estado_sap || null,
      estadoWmsSnapshot: pallet.estado_wms || pallet.estado_wms_registrado || null,
      estadoOperativoSnapshot: pallet.estado_mapa || pallet.estado || null,
      estado: pallet.estado_mapa || pallet.estado_wms || pallet.estado_sap || '—',
      ubicacionesSnapshot: ubicacion ? [ubicacion] : [],
      ubicacionSnapshot: ubicacion,
      estadoConteo: this.COUNT_STATES.PENDING,
      cajasFisicas: null,
      diferenciaCajas: null,
      kilosValidacion: null,
      requiereRevision: false,
      confirmadoPor: null,
      confirmadoEn: null,
      dispositivo: null,
      ubicacionEscaneo: null,
      origenCodigo: null,
      codigoOriginal: null,
      intentosReescaneo: [],
      esExtra: false
    };
  },

  createSession(warehouse, user, pallets = [], origin = 'OFFLINE') {
    const almacen = this.normalizeWarehouse(warehouse);
    const startedAt = new Date().toISOString();
    const byLot = new Map();
    (Array.isArray(pallets) ? pallets : []).forEach(pallet => {
      const item = this.snapshotPallet(pallet, almacen);
      if (!item.idLote) return;
      const prev = byLot.get(item.idLote);
      if (!prev) byLot.set(item.idLote, item);
      else if (item.ubicacionSnapshot) {
        prev.ubicacionesSnapshot ||= [];
        const key = JSON.stringify(item.ubicacionSnapshot);
        if (!prev.ubicacionesSnapshot.some(x => JSON.stringify(x) === key)) prev.ubicacionesSnapshot.push(item.ubicacionSnapshot);
        prev.ubicacionSnapshot ||= item.ubicacionSnapshot;
      }
    });
    const items = [...byLot.values()];
    return {
      id: this.id('INV'),
      almacen,
      origen: String(origin || 'OFFLINE').toUpperCase(),
      estado: this.STATES.PROCESS,
      iniciadoEn: startedAt,
      iniciadoPor: { id: user?.id || null, nombre: user?.name || 'Usuario WMS', rol: user?.role || 'Usuario' },
      finalizadoEn: null,
      finalizadoPor: null,
      totalSnapshot: items.length,
      snapshotVersion: startedAt,
      items,
      auditoria: [{ id: this.id('AUD'), tipo: 'CORTE_INICIADO', fecha: startedAt, usuario: user?.name || 'Usuario WMS', detalle: { almacen, total: items.length, origen: String(origin || 'OFFLINE').toUpperCase() } }],
      updatedAt: startedAt,
      version: 1
    };
  },

  itemFromResolved(resolved = {}) {
    const pallet = resolved.pallet || {};
    const corte = resolved.itemCorte || {};
    const idLote = String(resolved.idLote || pallet.id_lote_real || pallet.id_lote || '').trim();
    return {
      palletId: idLote,
      idLote,
      numeroArticulo: pallet.itemcode || pallet.numero_articulo || '',
      articulo: String(pallet.itemcode || pallet.articulo || idLote.slice(4, 9) || '').slice(-5),
      numeroPallet: String(pallet.numero_pallet || idLote.slice(9) || ''),
      descripcion: resolved.descripcionArticulo || pallet.itemname || pallet.descripcion || 'Sin descripción SAP disponible',
      almacen: resolved.almacenInventario || '—',
      kilosSistema: corte.kilosSistema ?? pallet.kilos ?? null,
      cajasSistema: corte.cajasSistema ?? pallet.cajas ?? null,
      fechaFabricacion: resolved.fechaFabricacionActual || null,
      estadoCalidad: null,
      estado: pallet.estado_mapa || pallet.estado_wms || pallet.estado_sap || '—',
      ubicacionesSnapshot: [],
      ubicacionSnapshot: null,
      estadoConteo: corte.estadoConteo || this.COUNT_STATES.PENDING,
      cajasFisicas: corte.cajasFisicas ?? null,
      diferenciaCajas: corte.diferenciaCajas ?? null,
      kilosValidacion: null,
      requiereRevision: Boolean(corte.requiereRevision),
      confirmadoPor: null,
      confirmadoEn: null,
      dispositivo: null,
      ubicacionEscaneo: null,
      origenCodigo: resolved.origenCodigo || null,
      codigoOriginal: resolved.codigoOriginal || null,
      intentosReescaneo: [],
      esExtra: Boolean(resolved.esExtraCandidato || corte.esExtra),
      datosSapSnapshot: pallet.no_existe_padre !== true,
      noExisteSapSnapshot: pallet.no_existe_padre === true
    };
  },

  metrics(session) {
    const items = session?.items || [];
    const scanned = items.filter(item => item.estadoConteo === this.COUNT_STATES.SCANNED).length;
    const pending = items.filter(item => item.estadoConteo === this.COUNT_STATES.PENDING).length;
    const notScanned = items.filter(item => item.estadoConteo === this.COUNT_STATES.NOT_SCANNED).length;
    const total = Number(session?.totalSnapshot ?? items.filter(x => !x.esExtra).length ?? items.length) || 0;
    return {
      total,
      scanned,
      pending,
      notScanned,
      review: items.filter(item => item.requiereRevision).length,
      progress: total ? Math.min(100, scanned / total * 100) : 0
    };
  },

  findItem(session, pallet) {
    if (!session || !pallet) return null;
    const idLote = String(pallet.id_lote_real || pallet.id_lote || pallet.lote || '').trim();
    return (session.items || []).find(item => item.palletId === idLote || item.idLote === idLote) || null;
  },

  livePallet(item) {
    if (!item || typeof MapaModel === 'undefined') return null;
    return MapaModel.getPallets().find(pallet => String(pallet.id_lote_real || pallet.lote || '') === String(item.idLote)) || null;
  },

  livePosition(item) { return this.position(this.livePallet(item)); },

  locationText(position) {
    if (!position) return 'Sin posición activa';
    return `${position.almacen || position.camara || '—'} · Banda ${position.banda ?? '—'} · P${position.posicion || '—'} · ${position.nivel || position.altura || '—'}`;
  },

  confirm(session, itemId, data = {}) {
    if (!session || session.estado !== this.STATES.PROCESS) return { ok: false, error: 'La sesión de inventario está cerrada.' };
    const item = (session.items || []).find(entry => entry.palletId === itemId || entry.idLote === itemId);
    if (!item) return { ok: false, error: 'El pallet no pertenece al snapshot de este inventario.' };
    if (item.estadoConteo === this.COUNT_STATES.SCANNED) return { ok: false, alreadyScanned: true, error: 'PALLET YA SE ENCUENTRA ESCANEADO', item };

    const hasReference = item.cajasSistema !== null && item.cajasSistema !== undefined;
    if (!hasReference && !data.hasDifference) return { ok: false, error: 'Este pallet no tiene referencia SAP de cajas. Ingrese las cajas físicas encontradas.' };
    const systemBoxes = hasReference ? Number(item.cajasSistema) : null;
    const physicalBoxes = data.hasDifference ? Number(data.cajasFisicas) : systemBoxes;
    if (!Number.isFinite(physicalBoxes) || physicalBoxes < 0) return { ok: false, error: 'Ingresá una cantidad válida de cajas físicas.' };

    const difference = systemBoxes === null ? null : systemBoxes - physicalBoxes;
    const now = new Date().toISOString();
    item.estadoConteo = this.COUNT_STATES.SCANNED;
    item.cajasFisicas = physicalBoxes;
    item.diferenciaCajas = difference;
    item.requiereRevision = systemBoxes === null || difference !== 0;
    item.kilosValidacion = systemBoxes === null ? 'SIN REFERENCIA SAP' : (difference !== 0 ? 'REQUIERE REVISIÓN' : 'SIN DIFERENCIA DECLARADA');
    item.confirmadoPor = data.user || null;
    item.confirmadoEn = now;
    item.dispositivo = data.device || null;
    item.ubicacionEscaneo = data.livePosition || null;
    item.origenCodigo = data.origenCodigo || null;
    item.codigoOriginal = data.codigoOriginal || null;
    session.updatedAt = now;
    session.version = (session.version || 0) + 1;
    session.auditoria ||= [];
    session.auditoria.push({ id: this.id('AUD'), tipo: item.requiereRevision ? 'CONTEO_CON_DIFERENCIA' : 'PALLET_ESCANEADO', fecha: now, usuario: data.user?.nombre || 'Usuario WMS', palletId: item.palletId, detalle: { cajasSistema: systemBoxes, cajasFisicas: physicalBoxes, diferencia: difference, ubicacionEscaneo: item.ubicacionEscaneo } });
    return { ok: true, session, item, difference };
  },

  registerRescan(session, item, user) {
    if (!session || !item) return null;
    const attempt = { fecha: new Date().toISOString(), usuario: user?.nombre || user?.name || 'Usuario WMS' };
    item.intentosReescaneo ||= [];
    item.intentosReescaneo.push(attempt);
    session.auditoria ||= [];
    session.auditoria.push({ id: this.id('AUD'), tipo: 'REESCANEO_IGNORADO', fecha: attempt.fecha, usuario: attempt.usuario, palletId: item.palletId });
    session.updatedAt = attempt.fecha;
    return attempt;
  },

  close(session, user) {
    if (!session || session.estado !== this.STATES.PROCESS) return { ok: false, error: 'La sesión ya se encuentra finalizada.' };
    const now = new Date().toISOString();
    (session.items || []).forEach(item => { if (item.estadoConteo === this.COUNT_STATES.PENDING) item.estadoConteo = this.COUNT_STATES.NOT_SCANNED; });
    session.estado = this.STATES.FINISHED;
    session.finalizadoEn = now;
    session.finalizadoPor = { id: user?.id || null, nombre: user?.name || 'Usuario WMS', rol: user?.role || 'Usuario' };
    session.updatedAt = now;
    session.version = (session.version || 0) + 1;
    session.auditoria ||= [];
    session.auditoria.push({ id: this.id('AUD'), tipo: 'INVENTARIO_CERRADO', fecha: now, usuario: user?.name || 'Usuario WMS', detalle: this.metrics(session) });
    return { ok: true, session };
  },

  bands(warehouse) {
    return this.normalizeWarehouse(warehouse) === this.WAREHOUSES.POSTTUNNEL
      ? ['01', '02', ...Array.from({ length: 18 }, (_, index) => index + 1)]
      : Array.from({ length: 30 }, (_, index) => index);
  },

  exportRows(session) {
    const headers = ['ID LOTE', 'N° ARTÍCULO', 'DESCRIPCIÓN', 'ALMACÉN', 'KILOS SISTEMA', 'CAJAS SISTEMA', 'FEC. FABRIC.', 'ESTADO CONTEO', 'CAJAS FÍSICAS', 'KILOS FÍSICOS / VALIDACIÓN', 'DIFERENCIA CAJAS'];
    const rows = (session?.items || []).map(item => [
      item.idLote, item.numeroArticulo, item.descripcion, session.almacen,
      item.kilosSistema ?? '', item.cajasSistema ?? '', item.fechaFabricacion || '',
      item.estadoConteo,
      item.cajasFisicas === null ? '' : item.cajasFisicas,
      item.kilosValidacion || (item.estadoConteo === this.COUNT_STATES.SCANNED ? 'SIN DIFERENCIA DECLARADA' : 'PENDIENTE'),
      item.diferenciaCajas === null ? '' : item.diferenciaCajas
    ]);
    return [headers, ...rows];
  }
};
