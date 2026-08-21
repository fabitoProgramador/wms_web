/**
 * Visualizar Stock: adaptador remoto exclusivo de Reportes Operacionales.
 * Reportes está completamente desacoplado de StockModel; este modelo se ocupa
 * sólo de listado, filtros por columna y exportación remota de Visualizar Stock.
 */
const ReportesStockModel = {
  numero(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  },

  fecha(value) {
    if (!value) return '—';
    const raw = String(value);
    const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00` : raw);
    return Number.isNaN(d.getTime()) ? raw : d.toLocaleDateString('es-CL');
  },

  fechaHora(value) {
    if (!value) return '—';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString('es-CL');
  },

  filtrosJson(filters = {}) {
    const out = {};
    Object.entries(filters || {}).forEach(([key, values]) => {
      const arr = values instanceof Set ? [...values] : Array.isArray(values) ? values : [];
      if (arr.length) out[key] = arr.map(v => String(v));
    });
    return out;
  },

  async rpc(nombre, parametros = {}) {
    const response = await SupabaseService.rpc('reportes', nombre, parametros);
    if (!response.ok) {
      const error = new Error(response.error || `No fue posible consultar reportes.${nombre}.`);
      error.estado = response.estado;
      error.permiso = response.permiso;
      error.red = response.red;
      throw error;
    }
    return response.datos;
  },

  normalizar(row = {}) {
    const condiciones = Array.isArray(row.condiciones_wms) ? row.condiciones_wms.filter(Boolean) : [];
    const decision = row.decision || (row.decision_gerencia === 'AUTORIZADO_ENVIAR' ? 'AUTORIZADO A ENVIAR' : row.decision_gerencia) || null;
    const estadoEfectivo = row.estado_operativo || row.estado_wms || row.estado_sap || '—';
    return {
      ...row,
      id: row.id_lote || row.id || '',
      lote_display: row.id_lote || row.id || '—',
      articulo_display: row.numero_articulo || row.codigo_articulo || '—',
      descripcion_display: row.descripcion || '—',
      kilos_display: this.numero(row.kilos),
      cajas_display: this.numero(row.cajas),
      fecha_fabricacion_display: this.fecha(row.fecha_fabricacion),
      estado_sap_display: row.estado_sap || 'SIN INFORMACIÓN',
      estado_wms_registrado_display: row.estado_wms_registrado || 'SIN ESTADO WMS PROPIO',
      estado_wms_efectivo_display: estadoEfectivo,
      flujo_display: row.estado_principal || estadoEfectivo || '—',
      condiciones_wms_array: condiciones,
      condiciones_display: condiciones.length ? condiciones.join(' · ') : 'Sin condiciones pendientes',
      decision_display: decision || 'Sin decisión gerencial',
      modalidad_display: row.modalidad || row.modalidad_gerencia || '—',
      detector_display: row.detector_metales || 'SIN INFORMACIÓN',
      reserva_display: String(row.reservado || '').trim() || 'SIN RESERVA',
      ultimo_evento: row.ultimo_evento || null,
      fecha_pedido: row.pedido_en || null,
      dias_en_pedido: row.dias_en_pedido == null ? null : this.numero(row.dias_en_pedido)
    };
  },

  async catalogos() {
    const data = await this.rpc('catalogos');
    return {
      raw: data,
      estados: data?.estados || [],
      almacenes: data?.almacenes || [],
      columnas: (data?.columnas || []).filter(c => c?.filterable !== false)
    };
  },

  async listar({ busqueda = '', almacen = 'TODOS', estado = 'TODOS', filtros = {}, limite = 12, offset = 0 } = {}) {
    const data = await this.rpc('stockListar', {
      p_busqueda: String(busqueda || ''),
      p_almacen: almacen || 'TODOS',
      p_estado: estado || 'TODOS',
      p_filtros: this.filtrosJson(filtros),
      p_limite: limite,
      p_offset: offset
    });
    return {
      raw: data,
      total: this.numero(data?.total),
      limite: this.numero(data?.limite, limite),
      offset: this.numero(data?.offset, offset),
      items: (data?.items || []).map(row => this.normalizar(row)),
      estados: data?.estados || [],
      snapshotVersion: data?.snapshot_version || null,
      cacheKey: data?.cache_key || null
    };
  },

  async valoresFiltro({ columna, busqueda = '', almacen = 'TODOS', estado = 'TODOS', filtros = {}, buscarValor = '', limite = 500, offset = 0 } = {}) {
    return this.rpc('valoresFiltro', {
      p_columna: columna,
      p_busqueda: String(busqueda || ''),
      p_almacen: almacen || 'TODOS',
      p_estado: estado || 'TODOS',
      p_filtros: this.filtrosJson(filtros),
      p_buscar_valor: String(buscarValor || ''),
      p_limite: limite,
      p_offset: offset
    });
  },

  async valoresFiltroTodos(criteria = {}) {
    const items = [];
    let offset = 0;
    let total = null;
    do {
      const page = await this.valoresFiltro({ ...criteria, limite: 500, offset });
      const rows = page?.items || [];
      items.push(...rows);
      total = this.numero(page?.total_valores);
      offset += rows.length;
      if (!rows.length) break;
    } while (items.length < total);
    return { total: total || 0, items };
  },

  async exportar({ busqueda = '', almacen = 'TODOS', estado = 'TODOS', filtros = {}, limite = 10000 } = {}) {
    return this.rpc('stockExportar', {
      p_busqueda: String(busqueda || ''),
      p_almacen: almacen || 'TODOS',
      p_estado: estado || 'TODOS',
      p_filtros: this.filtrosJson(filtros),
      p_limite: limite
    });
  },

  exportTable(data = {}) {
    const headers = data.columnas || [];
    const keys = [
      'lote','codigo_articulo','articulo','ubicacion','kilos','cajas','fecha_fabricacion',
      'estado_sap','estado_wms','condiciones_wms','decision','modalidad','info_calidad','info_general',
      'detector_metales','reservado','ultima_accion','motivo_movimiento','usuario_movimiento','fecha_movimiento'
    ];
    const rows = (data.items || []).map(item => keys.map(key => {
      const v = item[key];
      if (key === 'fecha_fabricacion') return this.fecha(v);
      if (key === 'fecha_movimiento') return this.fechaHora(v);
      return v ?? '';
    }));
    return [headers, ...rows];
  }
};
