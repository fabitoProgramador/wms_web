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
    const [proter, post] = await Promise.all([
      MapaProterBackendModel.snapshot(),
      MapaPostTunelBackendModel.snapshot()
    ]);

    if (!proter?.ok) throw new Error(proter?.error || 'No fue posible obtener el snapshot PROTER.');
    if (!post?.ok) throw new Error(post?.error || 'No fue posible obtener el snapshot POST TÚNEL.');

    // El catálogo viene en ambos RPC y es idéntico. Se conserva una sola copia.
    const catalogById = new Map();
    [...proter.catalogo, ...post.catalogo].forEach(p => {
      const id = PalletModel.idLoteReal(p);
      if (id && !catalogById.has(id)) catalogById.set(id, p);
    });

    const pallets = [
      ...catalogById.values(),
      ...proter.segmentos,
      ...post.segmentos
    ];

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

    return {
      pallets,
      mapState,
      metadata: {
        backendMap: true,
        backendProter: true,
        backendPostTunel: true,
        backendProterCacheKey: proter.cacheKey,
        backendPostTunelCacheKey: post.cacheKey,
        backendProterVersion: proter.version,
        backendPostTunelVersion: post.version,
        backendProterGeneradoEn: proter.generadoEn,
        backendPostTunelGeneradoEn: post.generadoEn
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
