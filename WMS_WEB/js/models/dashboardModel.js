/**
 * Modelo remoto exclusivo del Panel de Control.
 *
 * FUENTE DE VERDAD
 * ------------------------------------------------------------------
 * Este módulo NO mantiene stock, estados, verificaciones, cargas ni eventos
 * locales. Toda la información operacional proviene de RPCs de Supabase.
 *
 * El antiguo PanelControlModel sigue cargado temporalmente porque Bitácora y
 * Registro de Verificaciones aún conservan lógica legacy hasta que llegue su
 * fase de migración. DashboardController no debe volver a consumirlo.
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

  /**
   * Resumen Ejecutivo de PROTER.
   * La tendencia usa el histórico real de fecha de recepción SAP. Se evita
   * fijarla a 30 días porque un snapshot válido puede no contener recepciones
   * recientes y eso hacía que la tarjeta mostrara una falsa tendencia 0%.
   */
  async resumen() {
    const [raw, analisis] = await Promise.all([
      this.rpc('dashboard', 'resumen', { p_almacen_codigo: this.ALMACEN_RESUMEN }),
      this.rpc('dashboard', 'analisis', { p_almacen: 'PROTER', p_periodo: 'TODO' })
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

    const tendencia = (analisis?.tendencias?.ingresos || []).slice(-10).map(row => ({
      fecha: String(row.fecha || ''),
      valor: this.numero(row.pallets)
    }));

    return {
      raw,
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
      tendencia
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

  /**
   * Detalle remoto/buscable de una tarjeta KPI.
   *
   * El RPC limita cada llamada a 200 filas. El frontend no debe confundir ese
   * límite técnico con el total del KPI, por lo que recorre páginas del mismo
   * RPC hasta completar `total_resultados`. La búsqueda continúa ejecutándose
   * íntegramente en PostgreSQL; aquí no se filtra una muestra descargada.
   */
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
      return {
        tipo: pct >= 85 ? 'warning' : 'success',
        titulo: `${raw.camara || 'Cámara'}: ${pct.toFixed(1)}% de posiciones utilizadas`,
        detalle: `${this.numero(raw.utilizadas)} de ${this.numero(raw.capacidad)} posiciones físicas.`
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

  /** Análisis Operacional 100% calculado por backend. */
  async analisis({ camara = 'TODOS', periodo = '30D' } = {}) {
    const raw = await this.rpc('dashboard', 'analisis', {
      p_almacen: camara,
      p_periodo: periodo
    });

    const resumen = raw?.resumen || {};
    const actividad = raw?.tendencias?.actividad || {};
    const capacidad = raw?.capacidad || {};
    const totalCapacidad = capacidad?.total || {};
    const etapas = raw?.etapas || {};

    return {
      raw,
      camara: raw?.almacen || camara,
      periodo: raw?.periodo || periodo,
      stock: this.numero(resumen.pallets_actuales),
      cajas: this.numero(resumen.cajas_actuales),
      kilos: this.numero(resumen.kilos_actuales),
      posicionados: this.numero(resumen.posiciones_utilizadas),
      capacidadTotal: this.numero(resumen.capacidad_fisica ?? totalCapacidad.capacidad),
      ocupacion: this.numero(resumen.ocupacion_fisica_porcentaje ?? totalCapacidad.porcentaje),
      ingresos: (raw?.tendencias?.ingresos || []).map(row => ({
        fecha: String(row.fecha || ''),
        valor: this.numero(row.pallets)
      })),
      actividad: [
        { nombre: 'Verificados', valor: this.numero(actividad.verificados) },
        { nombre: 'Rechazados', valor: this.numero(actividad.rechazados) },
        { nombre: 'Despachados', valor: this.numero(actividad.despachados) }
      ],
      distribucion: (raw?.distribucion?.estado_base || []).map(row => ({
        nombre: this.kpiNombre(row.estado),
        pallets: this.numero(row.pallets),
        cajas: this.numero(row.cajas),
        porcentaje: this.numero(row.porcentaje)
      })),
      topProductos: (raw?.top_productos || []).map(row => ({
        nombre: [row.itemcode, row.itemname].filter(Boolean).join(' · '),
        valor: this.numero(row.cajas),
        pallets: this.numero(row.pallets),
        kilos: this.numero(row.kilos)
      })),
      camaras: (capacidad?.camaras || []).map(row => ({
        nombre: row.camara || '—',
        posicionados: this.numero(row.utilizadas),
        capacidad: this.numero(row.capacidad),
        porcentaje: this.numero(row.porcentaje)
      })),
      flujo: [
        { nombre: 'Sin información', valor: this.numero(etapas.sin_informacion) },
        { nombre: 'Por verificar', valor: this.numero(etapas.por_verificar) },
        { nombre: 'Observados', valor: this.numero(etapas.observados) },
        { nombre: 'Liberados', valor: this.numero(etapas.liberados) },
        { nombre: 'Preparación envío', valor: this.numero(etapas.preparacion_envio) },
        { nombre: 'Reproceso', valor: this.numero(etapas.reproceso) }
      ],
      insights: (raw?.insights || []).map(item => this.insight(item)).filter(Boolean),
      generadoEn: raw?.generado_en || null
    };
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
  },

  /** Monitor: resumen y eventos salen del backend; no mezcla colas locales. */
  async monitor(filtro = 'todos') {
    const tipo = String(filtro || 'todos').toUpperCase() === 'TODOS'
      ? 'TODOS'
      : String(filtro || '').toUpperCase();

    const [rawResumen, rawEventos] = await Promise.all([
      this.rpc('dashboard', 'monitorResumen'),
      this.rpc('dashboard', 'monitorEventos', {
        p_desde: null,
        p_limite: 100,
        p_tipo: tipo
      })
    ]);

    const estado = rawResumen?.estado_actual || {};
    const stock = estado?.stock || {};
    const indicadores = rawResumen?.indicadores || {};
    const ocupacion = rawResumen?.ocupacion || {};

    const actividad = (rawEventos?.eventos || []).map(row => ({
      id: row.evento_key || '',
      tipo: String(row.tipo || 'operacion').toLowerCase(),
      subtipo: row.subtipo || '',
      severidad: this.normalizarSeveridad(row.severidad),
      titulo: row.titulo || row.subtipo || 'Evento operacional',
      pallet: row.referencia || '',
      detalle: row.descripcion || '',
      ubicacion: row.almacen || '',
      usuario: row.usuario_nombre || '',
      sincronizacion: row.estado || '',
      timestamp: Date.parse(row.creado_en || '') || 0
    }));

    return {
      rawResumen,
      rawEventos,
      stock: this.numero(stock.pallets),
      cajas: this.numero(stock.cajas),
      kilos: this.numero(stock.kilos),
      criticas: this.numero(indicadores.camaras_con_atencion),
      ocupacionFisica: this.numero(indicadores.ocupacion_fisica_porcentaje),
      pedidos: this.numero(indicadores.pedidos),
      reproceso: this.numero(indicadores.reproceso),
      ocupacionCamaras: (ocupacion.camaras || []).map(row => ({
        nombre: row.camara || '—',
        total: this.numero(row.posiciones_utilizadas),
        problemas: this.numero(row.observados),
        capacidad: this.numero(row.capacidad),
        ocupacion: this.numero(row.ocupacion_fisica_porcentaje),
        sobreCapacidad: Boolean(row.sobre_capacidad)
      })),
      alertas: (rawResumen?.alertas || []).map(row => ({
        nivel: this.normalizarNivelAlerta(row.severidad),
        titulo: row.titulo || 'Alerta operacional',
        detalle: row.detalle || '',
        cantidad: this.numero(row.cantidad)
      })),
      actividad,
      ultimaActividadEn: estado?.ultima_actividad_en || null,
      actualizadoEn: rawResumen?.generado_en || new Date().toISOString()
    };
  }
};
