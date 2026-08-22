/**
 * Puente remoto para Operaciones.
 *
 * Regla: las vistas migradas de Movimientos, Despacho y Aprobaciones nunca
 * leen ni escriben StockModel/MapaModel/localStorage. Toda regla de estado,
 * requisito, decisión gerencial, pedido e idempotencia vive en Supabase.
 */
const OperacionesBackendModel = {
  RECLASIFICACION_DESTINOS: ['RECHAZO','VERIFICACIÓN','SIN DM','SIN INFORMACIÓN','LOTES INCOMPLETOS','PROHIBICIONES'],

  uuid() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  },

  fechaVisible(value) {
    const raw = String(value || '').trim();
    if (!raw) return '—';
    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
      const [y,m,d] = raw.slice(0,10).split('-');
      return `${d}/${m}/${y}`;
    }
    return raw;
  },

  normalizarCondiciones(item = {}) {
    if (Array.isArray(item.condiciones_wms)) return item.condiciones_wms.filter(Boolean);
    return String(item.requisitos || '')
      .split(',')
      .map(x => x.trim())
      .filter(Boolean)
      .map(x => x.replaceAll('_',' '));
  },

  normalizarItem(item = {}) {
    const tieneEstadoOperativo = Object.prototype.hasOwnProperty.call(item,'estado_operativo');
    const estadoWmsRegistrado = Object.prototype.hasOwnProperty.call(item,'estado_wms_registrado')
      ? item.estado_wms_registrado
      : (tieneEstadoOperativo ? item.estado_wms : null);
    const estadoOperativo = item.estado_operativo || item.estado_wms || item.estado_sap || null;
    const condiciones = this.normalizarCondiciones(item);
    const decision = item.decision || (item.decision_gerencia === 'AUTORIZADO_ENVIAR' ? 'AUTORIZADO A ENVIAR' : item.decision_gerencia) || null;
    const modalidad = item.modalidad || item.modalidad_gerencia || null;

    return {
      ...item,
      id: String(item.instancia_id ?? ''),
      lote_display: item.id_lote || '—',
      articulo_display: item.itemcode || '—',
      descripcion_display: item.itemname || '—',
      kilos_display: Number(item.kilos || 0),
      fecha_fabricacion_display: this.fechaVisible(item.fecha_fabricacion || item.fecha_ingreso),
      fecha_ingreso_display: this.fechaVisible(item.fecha_ingreso),
      estado_calidad_display: item.estado_sap || 'SIN INFORMACIÓN',
      estado_wms_registrado_display: estadoWmsRegistrado || 'SIN ESTADO WMS PROPIO',
      estado_operativo_display: estadoOperativo || 'SIN ESTADO OPERATIVO',
      flujo_display: item.estado || estadoOperativo || 'SIN ESTADO',
      condiciones_wms_array: condiciones,
      detector_display: item.detector_normalizado || item.detector_de || 'SIN INFORMACIÓN',
      reservado_display: item.reservado || 'SIN RESERVA',
      calidad_display: item.info_calidad || 'Sin información de calidad.',
      general_display: item.info_general || 'Sin información general.',
      condiciones_display: condiciones.length ? condiciones.join(' · ') : 'Sin condiciones pendientes',
      decision_display: decision || 'Sin decisión gerencial',
      modalidad_display: modalidad || '—'
    };
  },

  async rpc(nombre, parametros = {}) {
    const response = await SupabaseService.rpc('operaciones', nombre, parametros);
    if (!response.ok) {
      const error = new Error(response.error || `No fue posible ejecutar operaciones.${nombre}.`);
      error.estado = response.estado;
      error.permiso = response.permiso;
      error.red = response.red;
      error.codigosSinCoincidencia = /CODIGOS_SIN_COINCIDENCIA/i.test(String(response.error || ''));
      error.codigosAmbiguos = /CODIGOS_AMBIGUOS/i.test(String(response.error || ''));
      error.conflictoCola = /CONFLICTO_COLA_APROBACION|CONFLICTO_PACKING_LIST/i.test(String(response.error || ''));
      error.conflictoVersion = /CONFLICTO_VERSION_MOTIVO/i.test(String(response.error || ''));
      throw error;
    }
    return response.datos;
  },

  async movimientos({ buscar = '', estado = 'TODOS', detector = 'TODOS', limite = 120, offset = 0 } = {}) {
    const data = await this.rpc('movimientos', {
      p_buscar: String(buscar || '').trim() || null,
      p_estado: estado || 'TODOS',
      p_detector: detector || 'TODOS',
      p_limite: limite,
      p_offset: offset
    });
    return { ...data, items:(data?.items || []).map(x => this.normalizarItem(x)) };
  },

  async resolverCodigos(codigos = '') {
    const data = await this.rpc('resolverCodigos', { p_codigos:String(codigos || '') });
    return { ...data, items:(data?.items || []).map(x => this.normalizarItem(x)) };
  },

  reclasificar(instancias, destino, motivo) {
    return this.rpc('reclasificar', {
      p_instancias: (instancias || []).map(Number).filter(Number.isFinite),
      p_destino: destino,
      p_motivo: String(motivo || '').trim(),
      p_operacion_uuid: this.uuid()
    });
  },

  aplicarPedido(codigos, motivo, confirmarParcial = false) {
    return this.rpc('aplicarPedido', {
      p_codigos: String(codigos || ''),
      p_motivo: String(motivo || '').trim(),
      p_confirmar_parcial: Boolean(confirmarParcial),
      p_operacion_uuid: this.uuid()
    });
  },

  async aprobaciones({ estado = 'TODOS', articulo = 'TODOS', limite = 120, offset = 0 } = {}) {
    const data = await this.rpc('aprobaciones', {
      p_estado: estado || 'TODOS',
      p_articulo: articulo || 'TODOS',
      p_limite: limite,
      p_offset: offset
    });
    return { ...data, items:(data?.items || []).map(x => this.normalizarItem(x)) };
  },

  async aprobacionesTodas({ estado = 'TODOS', articulo = 'TODOS' } = {}) {
    const items = [];
    let offset = 0, total = null, first = null;
    do {
      const page = await this.aprobaciones({ estado, articulo, limite:200, offset });
      if (!first) first = page;
      items.push(...(page.items || []));
      total = Number(page.total || 0);
      offset += (page.items || []).length;
      if (!(page.items || []).length) break;
    } while (items.length < total);
    return { ...(first || {}), total:total || 0, items };
  },

  motivoAprobacion(instanciaId, motivo, version = null) {
    return this.rpc('motivoAprobacion', {
      p_instancia_id: Number(instanciaId),
      p_motivo: String(motivo || '').trim() || null,
      p_version_esperada: version === null || version === undefined || version === '' ? null : Number(version),
      p_operacion_uuid: this.uuid()
    });
  },

  decidirAprobacion(instancias, decision, modalidad = null) {
    return this.rpc('decidirAprobacion', {
      p_instancias: (instancias || []).map(Number).filter(Number.isFinite),
      p_decision: String(decision || '').toUpperCase(),
      p_modalidad: modalidad ? String(modalidad).toUpperCase() : null,
      p_operacion_uuid: this.uuid()
    });
  },

  packingAprobacion(instancias) {
    return this.rpc('packingAprobacion', {
      p_instancias: (instancias || []).map(Number).filter(Number.isFinite),
      p_operacion_uuid: this.uuid()
    });
  },

  exportarPacking(result = {}) {
    const headers = ['ID Lote','Artículo','Descripción','Kilos','Cajas','Fecha ingreso','Estado','Estado SAP','Estado WMS','Condiciones','Info calidad','Info general','Detector','Reserva','Almacén'];
    const rows = (result.items || []).map(x => [
      x.id_lote || '', x.itemcode || '', x.itemname || '', Number(x.kilos || 0), Number(x.cajas || 0),
      this.fechaVisible(x.fecha_ingreso), x.estado || '', x.estado_sap || '', x.estado_wms || '',
      Array.isArray(x.condiciones_wms) ? x.condiciones_wms.join(' · ') : (x.requisitos || ''), x.info_calidad || '', x.info_general || '',
      x.detector_de || '', x.reservado || '', x.whsname || x.whscode || ''
    ]);
    const name = `${result.lote_id || 'PACKING_APROBACION'}.xlsx`;
    ExportService.descargarXlsx(name, 'Aprobaciones', [headers, ...rows]);
    return name;
  }
};
