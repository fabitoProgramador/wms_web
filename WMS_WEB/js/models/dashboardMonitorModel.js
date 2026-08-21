/**
 * Submenú Monitor en Tiempo Real.
 * Fuente única: RPC Supabase. Sin colas/eventos locales de respaldo.
 */
(() => {
  DashboardModel.monitor = async function(filtro = 'TODOS') {
    const tipoSolicitado = String(filtro || 'TODOS').trim().toUpperCase() || 'TODOS';
    const [rawResumen, rawEventos] = await Promise.all([
      this.rpc('dashboard', 'monitorResumen'),
      this.rpc('dashboard', 'monitorEventos', {
        p_desde: null,
        p_limite: 100,
        p_tipo: tipoSolicitado
      })
    ]);

    const estado = rawResumen?.estado_actual || {};
    const sync = estado?.sincronizacion || {};
    const stock = estado?.stock || {};
    const indicadores = rawResumen?.indicadores || {};
    const stockCamaras = rawResumen?.ocupacion_stock || {};
    const mapa = rawResumen?.ocupacion || {};

    const filtros = (rawResumen?.filtros_eventos || []).map(row => ({
      valor: String(row.valor || 'TODOS').toUpperCase(),
      nombre: row.nombre || row.valor || 'Todos'
    }));

    const actividad = (rawEventos?.eventos || []).map(row => ({
      id: row.evento_key || '',
      tipo: String(row.tipo || 'OPERACION').toLowerCase(),
      subtipo: row.subtipo || '',
      severidad: this.normalizarSeveridad(row.severidad),
      titulo: row.titulo || row.subtipo || 'Evento operacional',
      referencia: row.referencia || '',
      detalle: row.descripcion || '',
      ubicacion: row.almacen || '',
      usuario: row.usuario_nombre || '',
      estado: row.estado || '',
      timestamp: Date.parse(row.creado_en || '') || 0
    }));

    return {
      rawResumen,
      rawEventos,
      filtro: String(rawEventos?.tipo || tipoSolicitado).toUpperCase(),
      filtros,
      sincronizacion: {
        sincronizado: Boolean(sync.sincronizado),
        idsPadre: this.numero(sync.ids_padre),
        instanciasActivas: this.numero(sync.instancias_wms_activas),
        diferencia: this.numero(sync.diferencia_identidades),
        actualizadoSapEn: sync.actualizado_sap_en || null,
        snapshotSapEn: sync.snapshot_sap_en || null,
        capturadoEn: sync.snapshot_capturado_en || null
      },
      stock: {
        pallets: this.numero(stock.pallets),
        cajas: this.numero(stock.cajas),
        kilos: this.numero(stock.kilos)
      },
      stockCamaras: {
        pallets: this.numero(stockCamaras.pallets),
        cajas: this.numero(stockCamaras.cajas),
        kilos: this.numero(stockCamaras.kilos),
        capacidad: this.numero(stockCamaras.capacidad_total),
        porcentaje: this.numero(indicadores.ocupacion_stock_porcentaje ?? stockCamaras.porcentaje),
        camaras: (stockCamaras.camaras || []).map(row => ({
          nombre: row.camara || '—',
          pallets: this.numero(row.pallets),
          cajas: this.numero(row.cajas),
          kilos: this.numero(row.kilos),
          capacidad: this.numero(row.capacidad),
          disponibles: this.numero(row.disponibles),
          porcentaje: this.numero(row.ocupacion_stock_porcentaje),
          sobreCapacidad: Boolean(row.sobre_capacidad)
        }))
      },
      mapa: {
        posiciones: this.numero(mapa.posiciones_utilizadas),
        capacidad: this.numero(mapa.capacidad_total),
        porcentaje: this.numero(indicadores.ocupacion_fisica_porcentaje ?? mapa.porcentaje),
        camaras: (mapa.camaras || []).map(row => ({
          nombre: row.camara || '—',
          posiciones: this.numero(row.posiciones_utilizadas),
          capacidad: this.numero(row.capacidad),
          porcentaje: this.numero(row.ocupacion_fisica_porcentaje),
          observados: this.numero(row.observados),
          sobreCapacidad: Boolean(row.sobre_capacidad)
        }))
      },
      indicadores: {
        camarasAtencion: this.numero(indicadores.camaras_con_atencion),
        pedidos: this.numero(indicadores.pedidos),
        reproceso: this.numero(indicadores.reproceso)
      },
      alertas: (rawResumen?.alertas || []).map(row => ({
        nivel: this.normalizarNivelAlerta(row.severidad),
        codigo: row.codigo || '',
        titulo: row.titulo || 'Alerta operacional',
        detalle: row.detalle || '',
        cantidad: this.numero(row.cantidad)
      })),
      actividad,
      ultimaActividadEn: estado?.ultima_actividad_en || rawEventos?.ultimo_evento_en || null,
      actualizadoEn: rawResumen?.generado_en || new Date().toISOString()
    };
  };
})();
