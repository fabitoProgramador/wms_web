/**
 * Stock en Planta: adaptador remoto exclusivo de los RPC de Supabase.
 * No usa MapaModel, StockModel legacy ni almacenamiento local como fuente.
 */
const StockPlantaModel = {
  numero(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  },

  fecha(value) {
    if (!value) return '—';
    const d = new Date(`${String(value).slice(0, 10)}T00:00:00`);
    return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString('es-CL');
  },

  condiciones(row = {}) {
    const out = [];
    if (row.flag_verificacion) out.push('VERIFICACIÓN');
    if (row.flag_sin_dm) out.push('SIN DM');
    if (row.flag_sin_informacion) out.push('SIN INFORMACIÓN');
    if (row.flag_lote_incompleto) out.push('LOTES INCOMPLETOS');
    if (row.flag_prohibicion) out.push('PROHIBICIONES');
    if (row.flag_pedido) out.push('PEDIDO');
    return out;
  },

  async rpc(nombre, parametros = {}) {
    const response = await SupabaseService.rpc('stock', nombre, parametros);
    if (!response.ok) {
      const error = new Error(response.error || `No fue posible consultar stock.${nombre}.`);
      error.estado = response.estado;
      error.permiso = response.permiso;
      error.red = response.red;
      throw error;
    }
    return response.datos;
  },

  normalizarFila(row = {}) {
    const reservaTexto = String(row.u_rerservado || '').trim();
    const condiciones = this.condiciones(row);
    const estadoWmsEfectivo = row.estado_operativo || row.estado_wms || row.estado_sap || row.estado_calidad_normalizado || '—';
    const estadoWmsRegistrado = row.estado_wms || null;
    const flujo = row.estado_principal || estadoWmsEfectivo || '—';
    const decision = row.decision_gerencia === 'AUTORIZADO_ENVIAR' ? 'AUTORIZADO A ENVIAR' : (row.decision_gerencia || null);
    return {
      ...row,
      id: row.id_lote || '',
      id_lote_real: row.id_lote || '',
      lote: row.id_lote || '',
      articulo: row.itemcode || '',
      numero_articulo: row.numero_articulo || row.itemcode || '',
      descripcion: row.itemname || '',
      ubicacion: row.almacen_clave || row.whsname || row.whscode || '—',
      cajas: this.numero(row.cajas),
      kilos_stock: this.numero(row.kilos),
      fecha_fabricacion: this.fecha(row.fecha_prod),
      fecha_admision: this.fecha(row.fecha_rec),
      estado_calidad: row.estado_calidad_normalizado || row.est_calidad || row.estado_sap || '—',
      estado_sap_display: row.estado_sap || row.estado_calidad_normalizado || row.est_calidad || '—',
      estado_wms_registrado_display: estadoWmsRegistrado || 'SIN ESTADO WMS PROPIO',
      estado_wms_efectivo_display: estadoWmsEfectivo,
      flujo_display: flujo,
      condiciones_wms_array: condiciones,
      condiciones_display: condiciones.length ? condiciones.join(' · ') : 'Sin condiciones pendientes',
      decision_display: decision || 'Sin decisión gerencial',
      modalidad_display: row.modalidad_gerencia || '—',
      estado: flujo,
      info_calidad: row.u_inf_cal || '—',
      info_general: row.u_inf_g || '—',
      info_detallada: row.notes || '—',
      detector_metales: row.detector_normalizado || 'SIN INFORMACIÓN',
      reservado: Boolean(row.reservado),
      reserva_texto: reservaTexto || 'SIN RESERVA',
      codigo_visual: row.codigo_visual_legible || row.codigo_visual || '',
      fecha_pedido: row.pedido_en || null,
      dias_en_pedido: row.dias_en_pedido == null ? null : this.numero(row.dias_en_pedido),
      ultimo_evento: row.ultimo_evento || null
    };
  },

  async detalle({ buscar = '', almacen = 'TODOS', estado = 'TODOS', detector = 'TODOS', limite = 10, offset = 0 } = {}) {
    const raw = await this.rpc('detalle', {
      p_buscar: String(buscar || '').trim() || null,
      p_almacen: almacen || 'TODOS',
      p_estado: estado || 'TODOS',
      p_detector: detector || 'TODOS',
      p_limite: limite,
      p_offset: offset
    });
    return {
      raw,
      totalFilas: this.numero(raw?.total),
      limite: this.numero(raw?.limite, limite),
      offset: this.numero(raw?.offset, offset),
      items: (raw?.items || []).map(row => this.normalizarFila(row)),
      filtros: {
        almacenes: raw?.filtros?.almacenes || [],
        estados: raw?.filtros?.estados || [],
        detectores: raw?.filtros?.detectores || []
      },
      snapshotVersion: raw?.snapshot_version || null,
      cacheKey: raw?.cache_key || null,
      generadoEn: raw?.generado_en || null
    };
  },

  normalizarResumen(raw = {}, tipo = '') {
    return {
      raw,
      tipo,
      totalPallets: this.numero(raw.total_pallets ?? raw.pallets_logicos_globales),
      filasSap: this.numero(raw.filas_sap),
      items: (raw.items || []).map(row => ({
        nombre: row.nombre || row.codigo || row.almacen || '—',
        codigo: row.codigo || '',
        descripcion: row.descripcion || '',
        almacen: row.almacen || row.nombre || '',
        whscode: row.whscode || '',
        whsname: row.whsname || '',
        pallets: this.numero(row.pallets),
        filasSap: this.numero(row.filas_sap, this.numero(row.pallets)),
        cajas: this.numero(row.cajas),
        kilos: this.numero(row.kilos),
        capacidad: row.capacidad == null ? null : this.numero(row.capacidad),
        porcentaje: row.porcentaje == null ? null : this.numero(row.porcentaje),
        sobreCapacidad: Boolean(row.sobre_capacidad),
        palletsExcedentes: row.pallets_excedentes == null ? null : this.numero(row.pallets_excedentes),
        tipoPorcentaje: row.tipo_porcentaje || '',
        solapado: Boolean(row.solapado)
      })),
      snapshotVersion: raw.snapshot_version || null,
      generadoEn: raw.generado_en || null
    };
  },

  async resumenArticulos(almacen = 'TODOS') {
    return this.normalizarResumen(await this.rpc('resumenArticulos', { p_almacen: almacen || 'TODOS' }), 'articulo');
  },

  async resumenCamaras() {
    return this.normalizarResumen(await this.rpc('resumenCamaras'), 'camara');
  },

  async resumenEstados(almacen = 'TODOS') {
    return this.normalizarResumen(await this.rpc('resumenEstados', { p_almacen: almacen || 'TODOS' }), 'estado');
  },

  async exportar({ buscar = '', almacen = 'TODOS', estado = 'TODOS', detector = 'TODOS', limite = 5000 } = {}) {
    const raw = await this.rpc('exportar', {
      p_buscar: String(buscar || '').trim() || null,
      p_almacen: almacen || 'TODOS',
      p_estado: estado || 'TODOS',
      p_detector: detector || 'TODOS',
      p_limite: limite
    });
    return {
      raw,
      total: this.numero(raw?.total),
      devueltos: this.numero(raw?.devueltos),
      truncado: Boolean(raw?.truncado),
      rows: raw?.rows || []
    };
  }
};
