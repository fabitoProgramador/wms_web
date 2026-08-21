/**
 * Núcleo remoto del Panel de Control + Resumen Ejecutivo.
 *
 * FUENTE DE VERDAD
 * ------------------------------------------------------------------
 * Este módulo NO mantiene stock, estados, verificaciones, cargas ni eventos
 * locales. Toda la información operacional proviene de RPCs de Supabase.
 *
 * Análisis Operacional y Monitor en Tiempo Real viven en módulos remotos
 * separados. No se conservan implementaciones duplicadas en este archivo.
 */
const DashboardModel = {
  ALMACEN_RESUMEN: 'CAM302',

  KPIS: [
    { codigo: 'VERIFICACION', nombre: 'VERIFICACIÓN' },
    { codigo: 'SIN_DM', nombre: 'SIN DM' },
    { codigo: 'RECHAZO', nombre: 'RECHAZO' },
    { codigo: 'LIBERADO', nombre: 'LIBERADO' },
    { codigo: 'PROHIBICION', nombre: 'PROHIBICIONES' },
    { codigo: 'LOTE_INCOMPLETO', nombre: 'LOTES INCOMPLETOS' },
    { codigo: 'AUTORIZADO_ENVIAR', nombre: 'AUTORIZADOS A ENVIAR' },
    { codigo: 'SIN_INFORMACION', nombre: 'SIN INFORMACIÓN' },
    { codigo: 'BLOQUEADO', nombre: 'BLOQUEADOS' },
    { codigo: 'PEDIDO', nombre: 'PEDIDO' },
    { codigo: 'REPROCESO', nombre: 'REPROCESO' }
  ],

  normalizarEstado(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replaceAll('_', ' ')
      .trim()
      .toUpperCase();
  },

  estadoIgual(a, b) {
    return this.normalizarEstado(a) === this.normalizarEstado(b);
  },

  numero(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  },

  kpiCodigo(nombreOCodigo) {
    const normalizado = this.normalizarEstado(nombreOCodigo);
    return this.KPIS.find(kpi =>
      this.normalizarEstado(kpi.nombre) === normalizado ||
      this.normalizarEstado(kpi.codigo) === normalizado
    )?.codigo || String(nombreOCodigo || '').trim().toUpperCase();
  },

  kpiNombre(codigo) {
    return this.KPIS.find(kpi => kpi.codigo === String(codigo || '').toUpperCase())?.nombre
      || String(codigo || '').replaceAll('_', ' ');
  },

  async rpc(grupo, nombre, parametros = {}) {
    const response = await SupabaseService.rpc(grupo, nombre, parametros);
    if (!response.ok) {
      const error = new Error(response.error || `No fue posible consultar ${grupo}.${nombre}.`);
      error.estado = response.estado;
      error.permiso = response.permiso;
      error.red = response.red;
      throw error;
    }
    return response.datos;
  },

  /** Resumen Ejecutivo de PROTER. */
  async resumen() {
    const [raw, rawTendencia] = await Promise.all([
      this.rpc('dashboard', 'resumen', { p_almacen_codigo: this.ALMACEN_RESUMEN }),
      this.rpc('dashboard', 'ocupacionTendencia', { p_almacen: 'PROTER', p_limite: 30 })
    ]);

    const universo = raw?.universo || {};
    const ocupacion = raw?.ocupacion || {};
    const rawKpis = raw?.kpis || {};
    const porEstado = this.KPIS.map(kpi => {
      const value = rawKpis[kpi.codigo] || {};
      return {
        codigo: kpi.codigo,
        nombre: kpi.nombre,
        pallets: this.numero(value.pallets),
        cajas: this.numero(value.cajas),
        porcentaje: this.numero(value.porcentaje_universo)
      };
    });

    const tendencia = (rawTendencia?.puntos || []).map(row => ({
      fecha: String(row.capturado_en || ''),
      valor: this.numero(row.ocupacion_porcentaje),
      pallets: this.numero(row.pallets),
      cajas: this.numero(row.cajas),
      kilos: this.numero(row.kilos),
      deltaPallets: row.delta_pallets == null ? null : this.numero(row.delta_pallets),
      deltaOcupacion: row.delta_ocupacion_pp == null ? null : this.numero(row.delta_ocupacion_pp)
    }));
    const actualTendencia = rawTendencia?.actual || {};

    return {
      raw,
      rawTendencia,
      stock: this.numero(universo.pallets),
      cajas: this.numero(universo.cajas),
      kilos: this.numero(universo.kilos),
      capacidad: this.numero(ocupacion.capacidad_pallets),
      disponibles: ocupacion.disponibles == null ? null : this.numero(ocupacion.disponibles),
      ocupacion: this.numero(ocupacion.porcentaje),
      camaras: this.numero(ocupacion.camaras_activas),
      camara: ocupacion.camara_fisica || 'PROTER',
      almacenCodigo: raw?.almacen_codigo || this.ALMACEN_RESUMEN,
      almacenNombre: raw?.almacen_nombre || 'PROTER',
      generadoEn: raw?.generado_en || null,
      porEstado,
      tendencia,
      tendenciaActual: {
        capturadoEn: actualTendencia.capturado_en || null,
        actualizadoSapEn: actualTendencia.actualizado_sap_en || null,
        pallets: this.numero(actualTendencia.pallets, this.numero(universo.pallets)),
        ocupacion: this.numero(actualTendencia.ocupacion_porcentaje, this.numero(ocupacion.porcentaje)),
        deltaPallets: actualTendencia.delta_pallets == null ? null : this.numero(actualTendencia.delta_pallets),
        deltaCajas: actualTendencia.delta_cajas == null ? null : this.numero(actualTendencia.delta_cajas),
        deltaKilos: actualTendencia.delta_kilos == null ? null : this.numero(actualTendencia.delta_kilos),
        deltaOcupacion: actualTendencia.delta_ocupacion_pp == null ? null : this.numero(actualTendencia.delta_ocupacion_pp)
      }
    };
  },

  filaEstadoDetalle(row) {
    return {
      instanciaId: row.instancia_id,
      idLote: row.id_lote || '',
      codigoVisual: row.codigo_visual || '',
      itemcode: row.itemcode || '',
      itemname: row.itemname || '',
      whscode: row.whscode || '',
      whsname: row.whsname || '',
      cajas: this.numero(row.cajas),
      kilos: this.numero(row.kilos),
      camara: row.camara || '',
      banda: row.banda ?? null,
      posicion: row.posicion ?? null,
      altura: row.altura || '',
      posicionesMapa: this.numero(row.posiciones_mapa),
      ubicacionEstado: row.ubicacion_estado || 'SIN_POSICION',
      estadoSap: row.estado_sap || '',
      estadoWms: row.estado_wms || '',
      estadoOperativo: row.estado_operativo || '',
      requisitos: row.requisitos || '',
      enPedido: Boolean(row.en_pedido),
      decisionGerencia: row.decision_gerencia || ''
    };
  },

  async estadoDetalle(estado, { busqueda = '', limite = 200, offset = 0 } = {}) {
    const codigo = this.kpiCodigo(estado);
    const texto = String(busqueda || '').trim() || null;
    const pagina = Math.min(200, Math.max(1, Number(limite) || 200));
    let siguiente = Math.max(0, Number(offset) || 0);
    let total = 0;
    const items = [];

    do {
      const rows = await this.rpc('dashboard', 'estadoDetalle', {
        p_kpi: codigo,
        p_almacen_codigo: this.ALMACEN_RESUMEN,
        p_busqueda: texto,
        p_limite: pagina,
        p_offset: siguiente
      });
      const lote = Array.isArray(rows) ? rows : [];
      if (!lote.length) break;
      if (!total) total = this.numero(lote[0].total_resultados);
      items.push(...lote.map(row => this.filaEstadoDetalle(row)));
      siguiente += lote.length;
      if (lote.length < pagina) break;
    } while (siguiente < total);

    return {
      estado: this.kpiNombre(codigo),
      codigo,
      total,
      items
    };
  },

  insight(raw = {}) {
    const codigo = String(raw.codigo || '').toUpperCase();
    if (codigo === 'MAYOR_CONDICION') {
      const nombre = this.kpiNombre(raw.condicion);
      return {
        tipo: 'info',
        titulo: `${nombre} concentra el mayor volumen`,
        detalle: `${this.numero(raw.pallets).toLocaleString('es-CL')} pallets · ${this.numero(raw.porcentaje).toFixed(1)}% del alcance.`
      };
    }
    if (codigo === 'CAMARA_MAYOR_OCUPACION') {
      const pct = this.numero(raw.porcentaje);
      const pallets = this.numero(raw.pallets);
      const capacidad = this.numero(raw.capacidad);
      const disponibles = this.numero(raw.disponibles);
      return {
        tipo: pct >= 85 ? 'warning' : 'success',
        titulo: `${raw.camara || 'Cámara'}: ${pct.toFixed(1)}% de capacidad de stock`,
        detalle: `${pallets.toLocaleString('es-CL')} de ${capacidad.toLocaleString('es-CL')} pallets · ${disponibles.toLocaleString('es-CL')} disponibles.`
      };
    }
    if (codigo === 'SIN_INFORMACION' && this.numero(raw.pallets) > 0) {
      return {
        tipo: 'warning',
        titulo: `${this.numero(raw.pallets)} pallets requieren información`,
        detalle: 'El indicador proviene del estado operacional actual del backend.'
      };
    }
    return null;
  },

  normalizarSeveridad(value) {
    const v = this.normalizarEstado(value);
    if (v.includes('CRIT')) return 'critical';
    if (v.includes('WARN') || v.includes('ATENC') || v.includes('ADVERT')) return 'attention';
    if (v.includes('SUCCESS') || v.includes('CORRECT') || v.includes('OK')) return 'success';
    return 'info';
  },

  normalizarNivelAlerta(value) {
    const v = this.normalizarEstado(value);
    if (v.includes('CRIT')) return 'critica';
    if (v.includes('ATENC')) return 'atencion';
    if (v.includes('WARN') || v.includes('ADVERT')) return 'advertencia';
    return 'informativa';
  }
};
