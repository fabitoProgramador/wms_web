/**
 * Adaptador permanente Operación Gruero -> Supabase.
 *
 * La cola local sigue siendo offline-first. Este adaptador sólo define cómo
 * resolver contra el backend y cómo confirmar cada movimiento pendiente. El
 * servidor conserva la última palabra: un conflicto nunca se sobreescribe a
 * ciegas y, después de cada respuesta, el mapa se vuelve a hidratar desde el
 * snapshot autoritativo cuando hay red.
 */
const GrueroBackendAdapter = {
  instalado: false,

  async rpc(nombre, parametros = {}) {
    const response = await SupabaseService.rpc('gruero', nombre, parametros);
    if (!response.ok) {
      return {
        ok: false,
        error: response.error || `No fue posible ejecutar gruero.${nombre}.`,
        red: Boolean(response.red),
        permiso: Boolean(response.permiso),
        estado: response.estado || null
      };
    }
    return response.datos;
  },

  posicion(value) {
    if (!value || typeof value !== 'object') return null;
    const camara = String(value.camara || value.ubicacion || '').trim().toUpperCase();
    const banda = value.banda === null || value.banda === undefined ? null : String(value.banda);
    const posicion = value.posicion === null || value.posicion === undefined ? null : Number(value.posicion);
    const altura = String(value.altura || value.nivel || '').trim().toUpperCase() || null;
    const segmento = value.segmento_id ?? value.segmentoId ?? null;
    if (!camara || banda === null || posicion === null || !altura) return null;
    return {
      camara,
      banda,
      posicion,
      altura,
      ...(segmento !== null && segmento !== undefined ? { segmento_id: Number(segmento) } : {})
    };
  },

  palletVisual(row = {}) {
    const posiciones = Array.isArray(row.posiciones) ? row.posiciones : [];
    const primera = posiciones[0] || null;
    const idLote = String(row.id_lote || '').trim();
    const base = MapaProterBackendModel.basePallet({
      ...row,
      id_lote: idLote,
      estado_mapa: row.estado_mapa || row.estado_wms || row.estado_sap || 'SIN INFORMACIÓN',
      no_existe_padre: Boolean(row.no_existe_padre),
      codigo_visual: row.codigo_visual || null,
      codigo_visual_legible: row.codigo_visual_legible || null
    });
    return {
      ...base,
      id: primera?.segmento_id ? `SEG-${primera.segmento_id}` : `CAT-${idLote}`,
      segmento_id: primera?.segmento_id ?? null,
      ubicacion: primera?.camara || row.almacen_sap || 'CATALOGO',
      banda: primera?.banda ?? null,
      posicion: primera?.posicion ?? null,
      altura: primera?.altura ?? primera?.nivel ?? null,
      cajas: primera?.cajas ?? row.cajas ?? null,
      kilos: primera?.kilos ?? row.kilos ?? null,
      _posiciones_backend: posiciones,
      _backend_catalog: !primera,
      _backend_proter: primera?.camara === 'PROTER',
      _backend_postunel: primera?.camara === 'POST TUNEL'
    };
  },

  inyectarEnSnapshot(pallet) {
    if (!pallet?.id_lote_real || !Array.isArray(MapaModel._palletCache)) return pallet;
    const cache = MapaModel._palletCache;
    const same = cache.find(x => x.id === pallet.id)
      || cache.find(x => PalletModel.idLoteReal(x) === pallet.id_lote_real && String(x.segmento_id ?? '') === String(pallet.segmento_id ?? ''));
    if (same) Object.assign(same, pallet);
    else cache.push(pallet);
    return same || pallet;
  },

  async resolverCodigo(codigo, source = 'MANUAL') {
    const canalEntrada = GrueroCodeResolver.inputChannel(source);
    const raw = String(codigo ?? '');
    if (navigator.onLine && SupabaseService.haySesion()) {
      const remote = await this.rpc('resolverCodigo', { p_codigo: raw });
      if (remote?.ok) {
        const pallet = this.inyectarEnSnapshot(this.palletVisual(remote.pallet || {}));
        return {
          ok: true,
          pallet,
          source,
          canalEntrada,
          rawCode: raw,
          codigoOriginal: raw,
          origenCodigo: remote.pallet?.origen_codigo || 'PALLET',
          datosCodigo: remote.pallet?.datos_codigo || null,
          backend: true,
          reglaResolucion: remote.regla_resolucion || null
        };
      }
      if (!remote?.red) return remote || { ok: false, error: 'Código no reconocido.' };
    }

    const cached = GrueroCodeResolver.resolverCodigo(raw, source);
    return cached.ok ? { ...cached, offline: true } : cached;
  },

  async banda(camara, banda) {
    if (navigator.onLine && SupabaseService.haySesion()) {
      const remote = await this.rpc('banda', { p_camara: String(camara), p_banda: String(banda) });
      if (remote?.items) {
        return {
          ok: true,
          ...remote,
          items: remote.items.map(row => {
            const visual = this.palletVisual({
              ...row,
              posiciones: [{
                segmento_id: row.segmento_id,
                camara: row.camara,
                banda: row.banda,
                posicion: row.posicion,
                altura: row.altura,
                cajas: row.cajas_posicion,
                kilos: row.kilos_posicion
              }]
            });
            return this.inyectarEnSnapshot(visual);
          })
        };
      }
      if (!remote?.red) return remote;
    }
    const items = MapaModel.getPallets().filter(p => p.ubicacion === camara && String(p.banda) === String(banda));
    return { ok: true, offline: true, camara, banda, items };
  },

  async sendMovement(item = {}) {
    const result = await this.rpc('sincronizarMovimiento', {
      p_idempotency_key: item.idempotencyKey || item.id,
      p_tipo: item.type,
      p_id_lote: item.palletRealId || item.id_lote,
      p_origen: this.posicion(item.previous || item.origin || item.origen),
      p_destino: item.type === 'load'
        ? (item.flow ? { flujo: item.flow } : null)
        : this.posicion(item.destination || item.destino),
      p_dispositivo_en: item.deviceTime || item.createdAt || new Date().toISOString()
    });

    if (typeof MapaOfflineService !== 'undefined' && navigator.onLine) {
      try { await MapaOfflineService.refreshFromServer(); } catch (_) {}
    }
    return result;
  },

  install() {
    if (this.instalado) return;
    window.WmsSyncAdapter = { sendMovement: item => this.sendMovement(item) };

    // El controlador conserva toda su UI y su flujo de cámara/HID. Sólo cambia
    // el origen de la identificación: online consulta el RPC Gruero y offline
    // cae al resolvedor del último snapshot backend confirmado.
    if (typeof GrueroController !== 'undefined') {
      GrueroController.resolve = async (code, source = 'MANUAL') => {
        const result = await this.resolverCodigo(code, source);
        if (!result?.ok) {
          GrueroController.pallet = null;
          GrueroController.codeContext = result;
          GrueroController.renderWork();
          const message = GrueroController.root?.querySelector('#grueroScanMessage');
          if (message) { message.textContent = `⚠ ${result?.error || 'Código no reconocido.'}`; message.className = 'error'; }
          const badge = GrueroController.root?.querySelector('[data-status="scanner"]');
          if (badge) { badge.textContent = result?.ambiguity ? 'Código ambiguo' : 'Código no reconocido'; badge.classList.add('error'); }
          GrueroController.toast(result?.error || 'Código no reconocido.', result?.ambiguity ? 'warning' : 'error');
          return;
        }
        GrueroController.pallet = result.pallet;
        GrueroController.codeContext = result;
        GrueroController.camera = result.pallet.ubicacion === 'POST TUNEL' ? 'POST TUNEL' : 'PROTER';
        GrueroController.band = result.pallet.banda ?? (GrueroController.camera === 'PROTER' ? 0 : '01');
        GrueroController.render();
        GrueroController.toast(`✓ ${PalletModel.codigoVisualLegible(result.pallet)} identificado desde ${result.canalEntrada || source}${result.offline ? ' · snapshot offline' : ''}`);
      };
    }
    this.instalado = true;
  }
};
