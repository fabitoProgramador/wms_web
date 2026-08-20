/** Reglas del corte físico de inventario. No modifica el stock ni el mapa. */
const InventoryOperationModel = {
  WAREHOUSES: Object.freeze({ PROTER: 'PROTER', POSTTUNNEL: 'POST TUNEL' }),
  STATES: Object.freeze({ PROCESS: 'EN PROCESO', FINISHED: 'FINALIZADA' }),
  COUNT_STATES: Object.freeze({ PENDING: 'PENDIENTE', SCANNED: 'ESCANEADO', NOT_SCANNED: 'NO ESCANEADO' }),

  normalizeWarehouse(value) {
    const normalized = String(value || '').trim().toLocaleUpperCase('es-CL').replace(/\s+/g, ' ');
    return normalized === 'POSTTUNNEL' || normalized === 'POST TÚNEL' || normalized === 'POST TUNEL'
      ? this.WAREHOUSES.POSTTUNNEL
      : this.WAREHOUSES.PROTER;
  },

  id(prefix = 'INV') {
    const random = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    return `${prefix}-${random}`;
  },

  position(pallet) {
    if (!pallet || pallet.banda === null || pallet.banda === undefined) return null;
    return {
      almacen: pallet.ubicacion || '—',
      banda: pallet.banda,
      posicion: Number(pallet.posicion) || null,
      nivel: pallet.altura || null
    };
  },

  snapshotPallet(pallet) {
    return {
      palletId: pallet.id,
      idLote: pallet.id_lote_real || PalletModel.idLoteReal(pallet),
      numeroArticulo: pallet.numero_articulo || PalletModel.numeroArticulo(pallet),
      articulo: String(pallet.articulo || ''),
      numeroPallet: String(pallet.numero_pallet || ''),
      descripcion: pallet.descripcion || PalletModel.descripcion(pallet),
      almacen: pallet.ubicacion || '—',
      kilosSistema: Number(pallet.kilos_stock ?? pallet.kilos ?? PalletModel.kilos(pallet)) || 0,
      cajasSistema: Number(pallet.cajas) || 0,
      fechaFabricacion: pallet.fecha_fabricacion || '—',
      estadoCalidad: StockModel.normalizarEstadoCalidad(pallet.estado_calidad || pallet.est_calidad || pallet.calidad_estado),
      estado: pallet.estado || '—',
      ubicacionSnapshot: this.position(pallet),
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
      intentosReescaneo: []
    };
  },

  createSession(warehouse, user) {
    const almacen = this.normalizeWarehouse(warehouse);
    // El contrato real de WMS_WEB llama "ubicacion" al campo que en la
    // fuente externa corresponde conceptualmente a WSH Name.
    const pallets = StockModel.pallets().filter(pallet => pallet.ubicacion === almacen);
    const startedAt = new Date().toISOString();
    return {
      id: this.id('INV'),
      almacen,
      estado: this.STATES.PROCESS,
      iniciadoEn: startedAt,
      iniciadoPor: { id: user?.id || null, nombre: user?.name || 'Usuario WMS', rol: user?.role || 'Usuario' },
      finalizadoEn: null,
      finalizadoPor: null,
      totalSnapshot: pallets.length,
      snapshotVersion: startedAt,
      items: pallets.map(pallet => this.snapshotPallet(pallet)),
      auditoria: [{ id: this.id('AUD'), tipo: 'CORTE_INICIADO', fecha: startedAt, usuario: user?.name || 'Usuario WMS', detalle: { almacen, total: pallets.length } }],
      updatedAt: startedAt,
      version: 1
    };
  },

  clone(value) { return JSON.parse(JSON.stringify(value)); },

  metrics(session) {
    const items = session?.items || [];
    const scanned = items.filter(item => item.estadoConteo === this.COUNT_STATES.SCANNED).length;
    const pending = items.filter(item => item.estadoConteo === this.COUNT_STATES.PENDING).length;
    const notScanned = items.filter(item => item.estadoConteo === this.COUNT_STATES.NOT_SCANNED).length;
    const total = items.length;
    return { total, scanned, pending, notScanned, review: items.filter(item => item.requiereRevision).length, progress: total ? scanned / total * 100 : 0 };
  },

  findItem(session, pallet) {
    if (!session || !pallet) return null;
    const idLote = PalletModel.idLoteReal(pallet);
    return session.items.find(item => item.palletId === pallet.id || item.idLote === idLote) || null;
  },

  livePallet(item) {
    if (!item) return null;
    return MapaModel.getPallets().find(pallet => pallet.id === item.palletId || PalletModel.idLoteReal(pallet) === item.idLote) || null;
  },

  livePosition(item) { return this.position(this.livePallet(item)); },

  locationText(position) {
    if (!position) return 'Sin posición activa';
    return `${position.almacen} · Banda ${position.banda} · P${position.posicion || '—'} · ${position.nivel || '—'}`;
  },

  confirm(session, itemId, data = {}) {
    if (!session || session.estado !== this.STATES.PROCESS) return { ok: false, error: 'La sesión de inventario está cerrada.' };
    const item = session.items.find(entry => entry.palletId === itemId || entry.idLote === itemId);
    if (!item) return { ok: false, error: 'El pallet no pertenece al snapshot de este inventario.' };
    if (item.estadoConteo === this.COUNT_STATES.SCANNED) return { ok: false, alreadyScanned: true, error: 'PALLET YA SE ENCUENTRA ESCANEADO', item };
    const systemBoxes = Number(item.cajasSistema) || 0;
    const physicalBoxes = data.hasDifference ? Number(data.cajasFisicas) : systemBoxes;
    if (!Number.isInteger(physicalBoxes) || physicalBoxes < 0) return { ok: false, error: 'Ingresá una cantidad válida de cajas físicas.' };
    const difference = systemBoxes - physicalBoxes;
    const now = new Date().toISOString();
    item.estadoConteo = this.COUNT_STATES.SCANNED;
    item.cajasFisicas = physicalBoxes;
    item.diferenciaCajas = difference;
    item.requiereRevision = difference !== 0;
    item.kilosValidacion = difference !== 0 ? 'REQUIERE REVISIÓN' : 'SIN DIFERENCIA DECLARADA';
    item.confirmadoPor = data.user || null;
    item.confirmadoEn = now;
    item.dispositivo = data.device || null;
    item.ubicacionEscaneo = data.livePosition || null;
    item.origenCodigo = data.origenCodigo || null;
    item.codigoOriginal = data.codigoOriginal || null;
    session.updatedAt = now;
    session.version = (session.version || 0) + 1;
    session.auditoria.push({ id: this.id('AUD'), tipo: difference !== 0 ? 'CONTEO_CON_DIFERENCIA' : 'PALLET_ESCANEADO', fecha: now, usuario: data.user?.nombre || 'Usuario WMS', palletId: item.palletId, detalle: { cajasSistema: systemBoxes, cajasFisicas: physicalBoxes, diferencia: difference, ubicacionEscaneo: item.ubicacionEscaneo } });
    return { ok: true, session, item, difference };
  },

  registerRescan(session, item, user) {
    if (!session || !item) return;
    const attempt = { fecha: new Date().toISOString(), usuario: user?.nombre || user?.name || 'Usuario WMS' };
    item.intentosReescaneo ||= [];
    item.intentosReescaneo.push(attempt);
    session.auditoria.push({ id: this.id('AUD'), tipo: 'REESCANEO_IGNORADO', fecha: attempt.fecha, usuario: attempt.usuario, palletId: item.palletId });
    session.updatedAt = attempt.fecha;
  },

  close(session, user) {
    if (!session || session.estado !== this.STATES.PROCESS) return { ok: false, error: 'La sesión ya se encuentra finalizada.' };
    const now = new Date().toISOString();
    session.items.forEach(item => { if (item.estadoConteo === this.COUNT_STATES.PENDING) item.estadoConteo = this.COUNT_STATES.NOT_SCANNED; });
    session.estado = this.STATES.FINISHED;
    session.finalizadoEn = now;
    session.finalizadoPor = { id: user?.id || null, nombre: user?.name || 'Usuario WMS', rol: user?.role || 'Usuario' };
    session.updatedAt = now;
    session.version = (session.version || 0) + 1;
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
      item.kilosSistema, item.cajasSistema, item.fechaFabricacion,
      item.estadoConteo,
      item.cajasFisicas === null ? '' : item.cajasFisicas,
      item.kilosValidacion || (item.estadoConteo === this.COUNT_STATES.SCANNED ? 'SIN DIFERENCIA DECLARADA' : 'PENDIENTE'),
      item.diferenciaCajas === null ? '' : item.diferenciaCajas
    ]);
    return [headers, ...rows];
  }
};
