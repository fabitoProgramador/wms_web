/**
 * Lote Detallado: adaptador remoto exclusivo de wms_lote_detallado().
 * La ficha representa un pallet lógico; las ocurrencias SAP se conservan
 * separadas para no perder saldo cuando un mismo id_lote está en varios almacenes.
 */
const LoteDetalladoModel = {
  numero(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  },

  fecha(value) {
    if (!value) return '—';
    const text = String(value);
    const d = new Date(text.length <= 10 ? `${text.slice(0,10)}T00:00:00` : text);
    return Number.isNaN(d.getTime()) ? text : d.toLocaleDateString('es-CL');
  },

  async buscar(codigo) {
    const texto = String(codigo || '').trim();
    if (!texto) return { ok:false, error:'Ingresá un ID de lote o código visual.' };

    const response = await SupabaseService.rpc('stock', 'loteDetallado', { p_codigo: texto });
    if (!response.ok) {
      const error = new Error(response.error || 'No fue posible consultar el lote.');
      error.estado = response.estado;
      error.permiso = response.permiso;
      error.red = response.red;
      throw error;
    }

    const raw = response.datos || {};
    if (!raw.ok) {
      return {
        ok:false,
        ambiguo:Boolean(raw.ambiguo),
        error:raw.error || 'No se encontró el lote.',
        candidatos:Array.isArray(raw.candidatos) ? raw.candidatos : [],
        codigo:texto
      };
    }

    const lote = raw.lote || {};
    const totales = raw.totales || {};
    const mapa = raw.mapa || {};
    const condicionesWms = Array.isArray(raw.condiciones_wms)
      ? raw.condiciones_wms.filter(Boolean)
      : String(lote.requisitos || '').split(',').map(x => x.trim().replaceAll('_',' ')).filter(Boolean);
    const decision = lote.decision_gerencia === 'AUTORIZADO_ENVIAR'
      ? 'AUTORIZADO A ENVIAR'
      : (lote.decision_gerencia || null);
    const modalidad = lote.decision_gerencia === 'AUTORIZADO_ENVIAR' && ['LIBERADO','RETAIL'].includes(lote.modalidad_gerencia)
      ? lote.modalidad_gerencia
      : (lote.modalidad_gerencia || null);

    const ocurrencias = (raw.ocurrencias_sap || []).map(row => ({
      almacen:row.almacen || row.whsname || row.whscode || '—',
      whscode:row.whscode || '',
      whsname:row.whsname || '',
      kilos:this.numero(row.kilos),
      cajas:this.numero(row.cajas),
      fechaFabricacion:this.fecha(row.fecha_prod),
      fechaAdmision:this.fecha(row.fecha_rec),
      estadoCalidad:row.est_calidad || 'SIN INFORMACIÓN',
      infoCalidad:row.u_inf_cal || '',
      infoGeneral:row.u_inf_g || '',
      detector:row.detector || 'SIN INFORMACIÓN',
      reserva:String(row.reserva || '').trim(),
      actualizadoEn:row.actualizado_el || null
    }));

    const posicionesMapa = (mapa.posiciones || []).map(row => ({
      camara:row.camara || row.almacen || '—',
      banda:row.banda ?? null,
      posicion:row.posicion ?? null,
      altura:row.altura || row.nivel || '',
      cajas:this.numero(row.cajas),
      kilos:this.numero(row.kilos)
    }));

    return {
      ok:true,
      raw,
      idLote:lote.id_lote || texto,
      itemcode:lote.itemcode || '',
      numeroArticulo:lote.numero_articulo || lote.itemcode || '',
      itemname:lote.itemname || '',
      codigoVisual:lote.codigo_visual_legible || lote.codigo_visual || '',
      numeroPallet:lote.numero_pallet || '',
      cajas:this.numero(totales.cajas ?? lote.cajas),
      kilos:this.numero(totales.kilos ?? lote.kilos),
      filasSap:this.numero(totales.filas_sap, ocurrencias.length),
      almacenesSap:this.numero(totales.almacenes_sap, ocurrencias.length),
      multiAlmacenSap:Boolean(raw.multi_almacen_sap),
      almacenSap:raw.almacen_sap || {},
      ocurrencias,
      fechaFabricacion:this.fecha(lote.fecha_prod),
      fechaAdmision:this.fecha(lote.fecha_rec),
      estadoSap:lote.estado_sap || lote.est_calidad || 'SIN INFORMACIÓN',
      estadoWmsRegistrado:lote.estado_wms || 'SIN ESTADO WMS PROPIO',
      estadoWmsEfectivo:lote.estado_operativo || lote.estado_wms || lote.estado_sap || 'SIN ESTADO',
      flujoOperativo:lote.estado_principal || lote.estado_operativo || lote.estado_wms || lote.estado_sap || 'SIN ESTADO',
      condicionesWms,
      condicionesDisplay:condicionesWms.length ? condicionesWms.join(' · ') : 'Sin condiciones pendientes',
      decisionGerencia:decision || 'Sin decisión gerencial',
      modalidadGerencia:modalidad || '—',
      estadoCalidad:lote.estado_calidad_normalizado || lote.est_calidad || 'SIN INFORMACIÓN',
      infoCalidad:lote.u_inf_cal || '',
      infoGeneral:lote.u_inf_g || '',
      infoDetallada:raw.info_detallada || lote.notes || '',
      detector:lote.detector_normalizado || 'SIN INFORMACIÓN',
      reserva:String(lote.u_rerservado || '').trim(),
      reservado:Boolean(lote.reservado),
      enPedido:Boolean(lote.en_pedido),
      pedidoEn:lote.pedido_en || null,
      diasEnPedido:lote.dias_en_pedido == null ? null : this.numero(lote.dias_en_pedido),
      auditoria:raw.auditoria || null,
      mapa:{
        posiciones:posicionesMapa,
        cantidad:this.numero(mapa.cantidad_posiciones),
        multiubicado:Boolean(mapa.multiubicado),
        diagnostico:mapa.diagnostico || 'SIN_MAPA',
        cajasSegmentadas:mapa.cajas_segmentadas == null ? null : this.numero(mapa.cajas_segmentadas),
        kilosSegmentados:mapa.kilos_segmentados == null ? null : this.numero(mapa.kilos_segmentados)
      },
      temperatura:raw.temperatura ?? null,
      temperaturaFuente:raw.temperatura_fuente || null,
      snapshotVersion:raw.snapshot_version || null,
      generadoEn:raw.generado_en || null
    };
  }
};
