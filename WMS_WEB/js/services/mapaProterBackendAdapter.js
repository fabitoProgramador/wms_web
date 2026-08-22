/**
 * Adaptador que MapaOfflineService ya esperaba desde su diseño original.
 *
 * Alcance deliberado: sólo Cámara PROTER. Post Túnel continúa con su contrato
 * legacy hasta su fase propia y sus movimientos no son consumidos por este
 * adaptador.
 */
window.WmsMapAdapter = {
  async fetchSnapshot() {
    const remote = await MapaProterBackendModel.snapshot();
    if (!remote?.ok) throw new Error(remote?.error || 'No fue posible obtener el snapshot PROTER.');

    // No se toca Post Túnel en esta fase. Se descarta cualquier PROTER demo o
    // catálogo remoto anterior y se sustituye por la copia autoritativa nueva.
    const legacy = MapaModel.getPallets().filter(p =>
      p.ubicacion !== 'PROTER' && !p._backend_proter && !p._backend_catalog
    );
    const proter = [...remote.catalogo, ...remote.segmentos];
    const validProterIds = new Set(proter.map(p => p.id));
    const mapState = MapaModel.clone(MapaModel.getState());
    mapState.cargo ||= { embarque: [], postunel: [] };
    mapState.manuals ||= { embarque: [], postunel: [] };
    mapState.cargo.embarque = (mapState.cargo.embarque || []).filter(id => validProterIds.has(id));
    // Los antiguos "manuals" retiraban pallets de una base local. Esa semántica
    // no es válida en PROTER remoto; el handoff actual usa catálogo backend.
    mapState.manuals.embarque = [];

    return {
      pallets: [...legacy, ...proter],
      mapState,
      metadata: {
        backendProter: true,
        backendProterCacheKey: remote.cacheKey,
        backendProterVersion: remote.version,
        backendProterGeneradoEn: remote.generadoEn
      }
    };
  },

  normalizarPosicion(value) {
    if (!value || typeof value !== 'object') return null;
    const camara = String(value.camara || value.ubicacion || '').trim().toUpperCase();
    const banda = value.banda === null || value.banda === undefined ? null : String(value.banda);
    const posicion = value.posicion === null || value.posicion === undefined ? null : Number(value.posicion);
    const altura = String(value.altura || value.nivel || '').trim().toUpperCase() || null;
    const segmentoId = value.segmento_id ?? value.segmentoId ?? null;
    if (!camara || banda === null || posicion === null || !altura) return null;
    return {
      camara,
      banda,
      posicion,
      altura,
      ...(segmentoId !== null && segmentoId !== undefined ? { segmento_id: Number(segmentoId) } : {})
    };
  },

  cameraOf(item = {}) {
    if (String(item.camera || '').toUpperCase() === 'PROTER') return 'PROTER';
    const destino = this.normalizarPosicion(item.destination || item.destino);
    const origen = this.normalizarPosicion(item.origin || item.origen || item.beforeState);
    return destino?.camara || origen?.camara || '';
  },

  supportsMovement(item = {}) {
    if (item.action === 'VACIAR_BANDA' || item.action === 'REEMPLAZAR_SEGMENTO') {
      return String(item.camera || item.camara || 'PROTER').toUpperCase() === 'PROTER';
    }
    return this.cameraOf(item) === 'PROTER';
  },

  async sendMovement(item = {}) {
    if (!this.supportsMovement(item)) return { ok: false, unsupported: true };

    if (item.action === 'VACIAR_BANDA') {
      return MapaProterBackendModel.vaciarBanda({
        key: item.idempotencyKey || item.id,
        banda: item.band ?? item.banda,
        motivo: item.reason || item.motivo || 'Vaciar banda desde Mapa PROTER'
      });
    }

    if (item.action === 'REEMPLAZAR_SEGMENTO') {
      return MapaProterBackendModel.reemplazarSegmento({
        key: item.idempotencyKey || item.id,
        segmentoId: item.segmentoId ?? item.segmento_id,
        codigoNuevo: item.enteredCode || item.codigoNuevo,
        motivo: item.reason || item.motivo || 'Corrección de identidad desde Mapa PROTER'
      });
    }

    const origen = this.normalizarPosicion(item.origin || item.origen || item.beforeState);
    const destino = this.normalizarPosicion(item.destination || item.destino);
    const idLote = String(item.palletRealId || item.id_lote || '').trim();
    if (!idLote) return { ok: false, conflict: true, error: 'Movimiento PROTER sin ID de lote canónico.' };

    let tipo = null;
    if (origen && destino) tipo = 'MOVER';
    else if (origen && !destino) tipo = 'QUITAR';
    else if (!origen && destino) tipo = 'COLOCAR';
    else return { ok: true, ignored: true, reason: 'Sin cambio físico de posición.' };

    const result = await MapaProterBackendModel.sincronizarOperacion({
      key: item.idempotencyKey || item.id,
      tipo,
      idLote,
      origen,
      destino,
      dispositivoEn: item.createdAt || item.updatedAt || new Date().toISOString()
    });

    if (result?.ok === false && result?.conflict !== true && result?.unsupported !== true) {
      // Los rechazos de negocio del mapa se tratan como conflicto para no
      // sobrescribir el servidor con reintentos ciegos.
      return { ...result, conflict: true };
    }
    return result;
  }
};
