/**
 * Adaptador único Mapa de Cámaras -> Supabase.
 *
 * PROTER y POST TÚNEL comparten snapshot, resolver, sincronización idempotente
 * y reglas de conflicto. La diferencia de geometría/presentación vive en sus
 * modelos de cámara, no en la cola offline.
 */
window.WmsMapAdapter = {
  modelFor(camera) {
    return String(camera || '').trim().toUpperCase() === 'POST TUNEL'
      ? MapaPostTunelBackendModel
      : MapaProterBackendModel;
  },

  async fetchSnapshot() {
    // Una sola llamada trae ambas cámaras y un único catálogo. Evita descargar
    // dos veces los mismos 1.062 pallets sólo para separar PROTER/Post Túnel.
    const data = await MapaProterBackendModel.rpc('snapshot', {
      p_camara: 'TODOS',
      p_incluir_catalogo: true
    });
    if (data?.ok === false) throw new Error(data.error || 'No fue posible obtener el snapshot de cámaras.');
    if (!data || !Array.isArray(data.segmentos) || !Array.isArray(data.catalogo_pallets)) {
      throw new Error('Supabase entregó un snapshot de cámaras incompleto.');
    }

    MapaProterBackendModel._snapshot = data;
    MapaPostTunelBackendModel._snapshot = data;

    const proterSegments = data.segmentos
      .filter(row => String(row.camara || '').toUpperCase() === 'PROTER')
      .map(row => MapaProterBackendModel.segmentoPallet(row));
    const postSegments = data.segmentos
      .filter(row => String(row.camara || '').toUpperCase() === 'POST TUNEL')
      .map(row => MapaPostTunelBackendModel.segmentoPallet(row));
    const catalog = data.catalogo_pallets.map(row => MapaProterBackendModel.catalogoPallet(row));

    const pallets = [...catalog, ...proterSegments, ...postSegments];

    // Estado visual sí puede persistir, pero nunca referencias a pallets demo o
    // a la antigua semántica "manual" que quitaba pallets de una base local.
    const validIds = new Set(pallets.map(p => p.id));
    const mapState = MapaModel.clone(MapaModel.getState());
    mapState.cargo ||= { embarque: [], postunel: [] };
    mapState.manuals ||= { embarque: [], postunel: [] };
    mapState.cargo.embarque = (mapState.cargo.embarque || []).filter(id => validIds.has(id));
    mapState.cargo.postunel = (mapState.cargo.postunel || []).filter(id => validIds.has(id));
    mapState.manuals.embarque = [];
    mapState.manuals.postunel = [];

    const version = data.snapshot_version || null;
    const generated = data.generado_en || null;
    return {
      pallets,
      mapState,
      metadata: {
        backendMap: true,
        backendProter: true,
        backendPostTunel: true,
        backendMapCacheKey: data.cache_key || null,
        backendProterCacheKey: data.cache_key || null,
        backendPostTunelCacheKey: data.cache_key || null,
        backendProterVersion: version,
        backendPostTunelVersion: version,
        backendProterGeneradoEn: generated,
        backendPostTunelGeneradoEn: generated
      }
    };
  },

  normalizarPosicion(value) {
    if (!value || typeof value !== 'object') return null;
    const camara = String(value.camara || value.ubicacion || '').trim().toUpperCase();
    const rawBand = value.banda === null || value.banda === undefined ? null : String(value.banda);
    const posicion = value.posicion === null || value.posicion === undefined ? null : Number(value.posicion);
    const altura = String(value.altura || value.nivel || '').trim().toUpperCase() || null;
    const segmentoId = value.segmento_id ?? value.segmentoId ?? null;
    if (!camara || rawBand === null || posicion === null || !altura) return null;
    return {
      camara,
      banda: rawBand,
      posicion,
      altura,
      ...(segmentoId !== null && segmentoId !== undefined ? { segmento_id: Number(segmentoId) } : {})
    };
  },

  cameraOf(item = {}) {
    const explicit = String(item.camera || item.camara || '').trim().toUpperCase();
    if (explicit === 'PROTER' || explicit === 'POST TUNEL') return explicit;
    const destino = this.normalizarPosicion(item.destination || item.destino);
    const origen = this.normalizarPosicion(item.origin || item.origen || item.beforeState);
    return destino?.camara || origen?.camara || '';
  },

  supportsMovement(item = {}) {
    return ['PROTER', 'POST TUNEL'].includes(this.cameraOf(item));
  },

  async sendMovement(item = {}) {
    const camera = this.cameraOf(item);
    if (!['PROTER', 'POST TUNEL'].includes(camera)) return { ok: false, unsupported: true };
    const model = this.modelFor(camera);

    if (item.action === 'VACIAR_BANDA') {
      return model.vaciarBanda({
        key: item.idempotencyKey || item.id,
        banda: item.band ?? item.banda,
        motivo: item.reason || item.motivo || `Vaciar banda desde Mapa ${camera}`
      });
    }

    if (item.action === 'REEMPLAZAR_SEGMENTO') {
      return model.reemplazarSegmento({
        key: item.idempotencyKey || item.id,
        segmentoId: item.segmentoId ?? item.segmento_id,
        codigoNuevo: item.enteredCode || item.codigoNuevo,
        motivo: item.reason || item.motivo || `Corrección de identidad desde Mapa ${camera}`
      });
    }

    const origen = this.normalizarPosicion(item.origin || item.origen || item.beforeState);
    const destino = this.normalizarPosicion(item.destination || item.destino);
    const idLote = String(item.palletRealId || item.id_lote || '').trim();
    if (!idLote) return { ok: false, conflict: true, error: `Movimiento ${camera} sin ID de lote canónico.` };

    let tipo = null;
    if (origen && destino) tipo = 'MOVER';
    else if (origen && !destino) tipo = 'QUITAR';
    else if (!origen && destino) tipo = 'COLOCAR';
    else return { ok: true, ignored: true, reason: 'Sin cambio físico de posición.' };

    const result = await model.sincronizarOperacion({
      key: item.idempotencyKey || item.id,
      tipo,
      idLote,
      origen,
      destino,
      dispositivoEn: item.createdAt || item.updatedAt || new Date().toISOString()
    });

    if (result?.ok === false && result?.conflict !== true && result?.unsupported !== true) {
      // Todo rechazo de negocio se congela como conflicto. Nunca reintentamos
      // a ciegas una operación que podría sobrescribir un cambio posterior.
      return { ...result, conflict: true };
    }
    return result;
  }
};
