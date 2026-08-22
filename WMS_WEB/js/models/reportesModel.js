/**
 * Generar Reporte: adaptador remoto exclusivo de Reportes Operacionales.
 * No calcula estados ni lee StockModel; Supabase compila el reporte autoritativo.
 */
const ReportesModel = {
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

  async rpc(nombre, parametros = {}) {
    const response = await SupabaseService.rpc('reportes', nombre, parametros);
    if (!response.ok) {
      const error = new Error(response.error || `No fue posible ejecutar reportes.${nombre}.`);
      error.estado = response.estado;
      error.permiso = response.permiso;
      error.red = response.red;
      throw error;
    }
    return response.datos;
  },

  normalizarItem(row = {}) {
    const condiciones = Array.isArray(row.condiciones_wms) ? row.condiciones_wms.filter(Boolean) : [];
    const estadoEfectivo = row.estado_operativo || row.estado_wms || row.estado_sap || 'SIN ESTADO';
    return {
      ...row,
      id: row.id_lote || row.id || '',
      lote_display: row.id_lote || row.id || '—',
      articulo_display: row.itemcode || '—',
      descripcion_display: row.itemname || '—',
      kilos_display: this.numero(row.kilos),
      cajas_display: this.numero(row.cajas),
      fecha_fabricacion_display: this.fecha(row.fecha_fabricacion),
      estado_sap_display: row.estado_sap || 'SIN INFORMACIÓN',
      estado_wms_registrado_display: row.estado_wms_registrado || 'SIN ESTADO WMS PROPIO',
      estado_wms_efectivo_display: estadoEfectivo,
      flujo_display: row.estado_principal || estadoEfectivo,
      condiciones_wms_array: condiciones,
      condiciones_display: condiciones.length ? condiciones.join(' · ') : 'Sin condiciones pendientes',
      decision_display: row.decision || 'Sin decisión gerencial',
      modalidad_display: row.modalidad || '—',
      detector_display: row.detector_metales || 'SIN INFORMACIÓN',
      reserva_display: String(row.reservado || '').trim() || 'SIN RESERVA',
      ultimo_evento: row.ultimo_evento || null
    };
  },

  async catalogos() {
    const data = await this.rpc('catalogos');
    return {
      raw:data,
      tiposReporte:data?.tipos_reporte || [],
      estados:data?.estados || [],
      almacenes:data?.almacenes || []
    };
  },

  async compilar(tipo, limite = 25) {
    const data = await this.rpc('compilar', {
      p_tipo:String(tipo || '').trim(),
      p_limite:limite
    });
    return {
      raw:data,
      tipo:data?.tipo || tipo,
      tipoClave:data?.tipo_clave || '',
      total:this.numero(data?.total),
      totales:{
        registros:this.numero(data?.totales?.pallets ?? data?.total),
        cajas:this.numero(data?.totales?.cajas),
        kilos:this.numero(data?.totales?.kilos)
      },
      vistaPrevia:(data?.vistaPrevia || []).map(row => this.normalizarItem(row)),
      vistaPreviaLimite:this.numero(data?.vista_previa_limite, limite),
      emitidoPor:data?.emitido_por || {},
      emitidoEn:data?.emitido_en || null,
      snapshotVersion:data?.snapshot_version || null,
      semanticaEstados:data?.semantica_estados || ''
    };
  }
};
