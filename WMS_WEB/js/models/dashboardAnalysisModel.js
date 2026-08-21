/**
 * Extensión remota del submenú Análisis Operacional.
 *
 * Mantiene a Supabase como única fuente y permite analizar cualquier almacén
 * vigente del padre SAP sin hardcodear el catálogo en el navegador.
 */
(() => {
  DashboardModel.numeroNullable = function(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };

  DashboardModel.catalogoAnalisis = async function() {
    const raw = await this.rpc('dashboard', 'almacenesCatalogo');
    const fisico = raw?.alcance_fisico || { valor: 'TODOS', nombre: 'PROTER + POST TÚNEL' };
    const almacenes = (raw?.almacenes || []).map(row => ({
      valor: row.valor || '',
      nombre: row.nombre || row.valor || '',
      whscode: row.whscode || '',
      whsname: row.whsname || '',
      pallets: this.numero(row.pallets),
      cajas: this.numero(row.cajas),
      kilos: this.numero(row.kilos),
      capacidad: this.numeroNullable(row.capacidad),
      esCamara: Boolean(row.es_camara),
      actualizadoSapEn: row.actualizado_sap_en || null
    }));

    return {
      raw,
      alcanceFisico: {
        valor: fisico.valor || 'TODOS',
        nombre: fisico.nombre || 'PROTER + POST TÚNEL'
      },
      almacenes,
      opciones: [
        {
          valor: fisico.valor || 'TODOS',
          nombre: fisico.nombre || 'PROTER + POST TÚNEL',
          whscode: '',
          esCamara: true,
          esAlcanceFisico: true
        },
        ...almacenes.map(x => ({ ...x, esAlcanceFisico: false }))
      ]
    };
  };

  DashboardModel.analisis = async function({ camara = 'TODOS', periodo = '30D' } = {}) {
    const [raw, catalogo] = await Promise.all([
      this.rpc('dashboard', 'analisis', {
        p_almacen: camara,
        p_periodo: periodo
      }),
      this.catalogoAnalisis()
    ]);

    const resumen = raw?.resumen || {};
    const actividadRaw = raw?.tendencias?.actividad || {};
    const ocupacionStock = raw?.ocupacion_stock || {};
    const totalStock = ocupacionStock?.total || {};
    const capacidadMapa = raw?.capacidad || {};
    const totalMapa = capacidadMapa?.total || {};
    const etapas = raw?.etapas || {};
    const tendencias = raw?.tendencias?.ocupacion?.camaras || [];
    const valorAlcance = raw?.almacen || camara;
    const opcion = catalogo.opciones.find(x => this.estadoIgual(x.valor, valorAlcance))
      || catalogo.opciones.find(x => this.estadoIgual(x.valor, camara))
      || { valor: valorAlcance, nombre: valorAlcance, esCamara: false, esAlcanceFisico: false };

    const capacidadStock = this.numeroNullable(resumen.capacidad_stock_camaras ?? totalStock.capacidad);
    const ocupacionStockPct = this.numeroNullable(resumen.ocupacion_stock_porcentaje ?? totalStock.porcentaje);
    const disponiblesStock = this.numeroNullable(resumen.disponibles_stock ?? totalStock.disponibles);
    const capacidadMapaTotal = this.numeroNullable(resumen.capacidad_fisica ?? totalMapa.capacidad);
    const ocupacionMapa = this.numeroNullable(resumen.ocupacion_fisica_porcentaje ?? totalMapa.porcentaje);
    const tieneCapacidad = capacidadStock !== null && capacidadStock > 0;

    const tendenciaStock = tendencias.map(serie => ({
      nombre: serie.camara || opcion.nombre || '—',
      puntos: (serie.puntos || []).map(row => ({
        fecha: String(row.capturado_en || ''),
        pallets: this.numero(row.pallets),
        cajas: this.numero(row.cajas),
        kilos: this.numero(row.kilos),
        ocupacion: this.numeroNullable(row.ocupacion_porcentaje),
        deltaPallets: row.delta_pallets == null ? null : this.numero(row.delta_pallets),
        deltaCajas: row.delta_cajas == null ? null : this.numero(row.delta_cajas),
        deltaKilos: row.delta_kilos == null ? null : this.numero(row.delta_kilos),
        deltaOcupacion: row.delta_ocupacion_pp == null ? null : this.numero(row.delta_ocupacion_pp),
        entradasPallets: this.numero(row.entradas_pallets),
        salidasPallets: this.numero(row.salidas_pallets),
        entradasCajas: this.numero(row.entradas_cajas),
        salidasCajas: this.numero(row.salidas_cajas),
        entradasKilos: this.numero(row.entradas_kilos),
        salidasKilos: this.numero(row.salidas_kilos)
      }))
    }));

    const movimientosStock = {
      entradas: this.numero(actividadRaw.entradas_stock),
      salidas: this.numero(actividadRaw.salidas_stock),
      entradasCajas: this.numero(actividadRaw.entradas_cajas),
      salidasCajas: this.numero(actividadRaw.salidas_cajas),
      entradasKilos: this.numero(actividadRaw.entradas_kilos),
      salidasKilos: this.numero(actividadRaw.salidas_kilos)
    };

    return {
      raw,
      catalogo,
      almacenesDisponibles: catalogo.opciones,
      camara: valorAlcance,
      nombreAlcance: opcion.nombre || valorAlcance,
      whscodeAlcance: opcion.whscode || '',
      esCamara: Boolean(opcion.esCamara),
      esAlcanceFisico: Boolean(opcion.esAlcanceFisico),
      tieneCapacidad,
      periodo: raw?.periodo || periodo,
      stock: this.numero(resumen.pallets_actuales),
      cajas: this.numero(resumen.cajas_actuales),
      kilos: this.numero(resumen.kilos_actuales),

      palletsStock: this.numero(resumen.pallets_stock_camaras ?? totalStock.pallets),
      capacidadStock,
      ocupacionStock: ocupacionStockPct,
      disponiblesStock,

      posicionados: this.numero(resumen.posiciones_utilizadas),
      capacidadMapa: capacidadMapaTotal,
      ocupacionMapa,

      tendenciaStock,
      movimientosStock,

      actividad: [
        { nombre: 'Entradas SAP', valor: movimientosStock.entradas },
        { nombre: 'Salidas SAP', valor: movimientosStock.salidas },
        { nombre: 'Verificados', valor: this.numero(actividadRaw.verificados) },
        { nombre: 'Rechazados', valor: this.numero(actividadRaw.rechazados) },
        { nombre: 'Despachados', valor: this.numero(actividadRaw.despachados) }
      ],

      ingresos: (raw?.tendencias?.ingresos || []).map(row => ({
        fecha: String(row.fecha || ''),
        valor: this.numero(row.pallets)
      })),
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
      camarasStock: (ocupacionStock?.camaras || []).map(row => ({
        nombre: row.camara || '—',
        pallets: this.numero(row.pallets),
        cajas: this.numero(row.cajas),
        kilos: this.numero(row.kilos),
        capacidad: this.numeroNullable(row.capacidad),
        porcentaje: this.numeroNullable(row.porcentaje),
        disponibles: this.numeroNullable(row.disponibles),
        sobreCapacidad: Boolean(row.sobre_capacidad)
      })),
      camarasMapa: (capacidadMapa?.camaras || []).map(row => ({
        nombre: row.camara || '—',
        posicionados: this.numero(row.utilizadas),
        capacidad: this.numeroNullable(row.capacidad),
        porcentaje: this.numeroNullable(row.porcentaje),
        sobreCapacidad: Boolean(row.sobre_capacidad)
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
  };
})();
