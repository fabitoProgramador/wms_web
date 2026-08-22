/**
 * Contrato autoritativo del visor Cámara PROTER.
 *
 * Supabase mantiene posiciones, identidad, estados, conflictos y auditoría.
 * El frontend conserva únicamente presentación, filtros, FIFO, exportación y
 * una copia offline explícita del último snapshot confirmado.
 */
const MapaProterBackendModel = {
  _snapshot: null,

  numero(value, fallback = null) {
    if (value === null || value === undefined || value === '') return fallback;
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  },

  uuid() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 3 | 8)).toString(16);
    });
  },

  async rpc(nombre, parametros = {}) {
    const response = await SupabaseService.rpc('mapa', nombre, parametros);
    if (!response.ok) {
      return {
        ok: false,
        error: response.error || `No fue posible ejecutar mapa.${nombre}.`,
        permiso: Boolean(response.permiso),
        red: Boolean(response.red),
        estado: response.estado || null
      };
    }
    return response.datos;
  },

  articuloBase(idLote, itemcode = '') {
    const id = String(idLote || '').trim();
    if (/^[0-9]{12,13}$/.test(id)) return id.slice(4, 9);
    const sap = String(itemcode || '').replace(/\D/g, '');
    return sap.length >= 5 ? sap.slice(-5) : sap;
  },

  codigoPresentacion(row = {}) {
    const numero = String(row.numero_pallet || String(row.id_lote || '').slice(9) || '').trim();
    return String(row.codigo_visual || '').trim().toUpperCase() || `?${numero || ''}`;
  },

  basePallet(row = {}) {
    const idLote = String(row.id_lote || '').trim();
    const articulo = this.articuloBase(idLote, row.itemcode);
    const codigo = this.codigoPresentacion(row);
    const cajasLogicas = this.numero(row.cajas);
    const kilosLogicos = this.numero(row.kilos);
    return {
      id_lote_real: idLote,
      lote: idLote,
      articulo,
      numero_articulo: row.itemcode || '',
      descripcion: row.itemname || 'Sin descripción SAP disponible',
      numero_pallet: String(row.numero_pallet || idLote.slice(9) || ''),
      _codigo_visual_manual: codigo,
      codigo_visual_backend: row.codigo_visual || null,
      codigo_visual_legible_backend: row.codigo_visual_legible || null,
      sin_codigo_visual: Boolean(row.sin_codigo_visual || !row.codigo_visual),
      cajas: cajasLogicas,
      kilos: kilosLogicos,
      cajas_logicas: cajasLogicas,
      kilos_logicos: kilosLogicos,
      estado: row.estado_mapa || row.estado_wms || row.estado_sap || 'SIN INFORMACIÓN',
      estado_mapa: row.estado_mapa || null,
      estado_wms: row.estado_wms || null,
      estado_wms_registrado: row.estado_wms_registrado || null,
      estado_sap: row.estado_sap || null,
      calidad_estado: row.estado_sap || null,
      condicion_principal: row.condicion_principal || null,
      condiciones_wms: Array.isArray(row.condiciones_wms) ? row.condiciones_wms : [],
      condiciones_adicionales: Array.isArray(row.condiciones_adicionales) ? row.condiciones_adicionales : [],
      decision: row.decision || null,
      modalidad: row.modalidad || null,
      flags: row.flags || {},
      fecha_fabricacion: row.fecha_fabricacion || null,
      fecha_admision: row.fecha_recepcion || null,
      fecha_recepcion: row.fecha_recepcion || null,
      info_calidad: row.info_calidad ?? null,
      info_general: row.info_general ?? null,
      detector_metales: row.detector_metales ?? null,
      reservado: row.reservado ?? null,
      whscode: row.whscode || null,
      whsname: row.whsname || null,
      almacen_sap: row.almacen_sap || null,
      diferencia_almacen_mapa: Boolean(row.diferencia_almacen_mapa),
      ultima_auditoria: row.ultima_auditoria || null,
      no_existe: Boolean(row.no_existe_padre || row.marca_visual === 'NO EXISTE'),
      no_existe_padre: Boolean(row.no_existe_padre),
      repetido: Boolean(row.repetido || row.marca_visual === 'REPETIDO'),
      repetido_id_lote: Boolean(row.repetido_id_lote),
      repetido_codigo_visual: Boolean(row.repetido_codigo_visual),
      multiubicado: Boolean(row.multiubicado),
      _backend_proter: true
    };
  },

  segmentoPallet(row = {}) {
    const base = this.basePallet(row);
    const cajasPosicion = this.numero(row.cajas_posicion, base.cajas);
    const kilosPosicion = this.numero(row.kilos_posicion, base.kilos);
    return {
      ...base,
      id: `SEG-${row.segmento_id}`,
      segmento_id: this.numero(row.segmento_id),
      ubicacion: 'PROTER',
      banda: this.numero(row.banda, row.banda),
      posicion: this.numero(row.posicion),
      altura: row.altura || null,
      cajas: cajasPosicion,
      kilos: kilosPosicion,
      cajas_posicion: cajasPosicion,
      kilos_posicion: kilosPosicion,
      actualizado_en: row.actualizado_en || null,
      cantidad_posiciones: this.numero(row.cantidad_posiciones, 1)
    };
  },

  catalogoPallet(row = {}) {
    const base = this.basePallet(row);
    return {
      ...base,
      id: `CAT-${base.id_lote_real}`,
      ubicacion: 'CATALOGO',
      banda: null,
      posicion: null,
      altura: null,
      _backend_catalog: true
    };
  },

  async snapshot() {
    const data = await this.rpc('snapshot', { p_camara: 'PROTER', p_incluir_catalogo: true });
    if (data?.ok === false) return data;
    if (!data || !Array.isArray(data.segmentos) || !Array.isArray(data.catalogo_pallets)) {
      return { ok: false, error: 'Supabase entregó un snapshot PROTER incompleto.' };
    }
    this._snapshot = data;
    return {
      ok: true,
      raw: data,
      segmentos: data.segmentos.map(row => this.segmentoPallet(row)),
      catalogo: data.catalogo_pallets.map(row => this.catalogoPallet(row)),
      geometria: data.geometria || null,
      camaras: data.camaras || [],
      presentacion: data.presentacion || null,
      cacheKey: data.cache_key || null,
      version: data.snapshot_version || null,
      generadoEn: data.generado_en || null
    };
  },

  geometria() { return this._snapshot?.geometria || null; },
  camaraMeta() { return (this._snapshot?.camaras || []).find(x => x.camara === 'PROTER') || null; },

  bandas() {
    const ranges = this.geometria()?.PROTER?.rangos || [];
    const out = [];
    ranges.forEach(r => {
      for (let i = Number(r.inicio); i <= Number(r.fin); i += 1) out.push(i);
    });
    return out.length ? [...new Set(out)] : Array.from({ length: 30 }, (_, i) => i);
  },

  maxPosiciones(banda) {
    const n = Number(banda);
    const range = (this.geometria()?.PROTER?.rangos || []).find(r => n >= Number(r.inicio) && n <= Number(r.fin));
    return this.numero(range?.posiciones, n <= 14 || n >= 23 ? 9 : 7);
  },

  async resolver(codigo) {
    const data = await this.rpc('resolverCodigo', { p_codigo: String(codigo || '').trim() });
    return data;
  },

  candidatosCache(codigo) {
    const raw = String(codigo || '').trim().toUpperCase();
    const plano = PalletModel.normalizarCodigo(raw);
    const byId = new Map();
    MapaModel.getPallets().filter(p => p._backend_catalog).forEach(p => {
      const keys = PalletModel.clavesDeBusqueda(p);
      if (keys.has(raw) || keys.has(plano)) byId.set(PalletModel.idLoteReal(p), p);
    });
    return [...byId.values()];
  },

  resolverCache(codigo) {
    const raw = String(codigo || '').trim().toUpperCase();
    const matches = this.candidatosCache(raw);
    if (matches.length === 1) return { ok: true, pallet: this.palletBackendDesdeCache(matches[0]), offline: true };
    if (matches.length > 1) return { ok: false, conflict: true, ambiguity: true, error: 'Código ambiguo en la copia offline. Use el ID de lote completo.', candidatos: matches.map(PalletModel.idLoteReal) };
    if (/^[0-9]{12,13}$/.test(raw)) {
      return {
        ok: true,
        offline: true,
        pallet: {
          id_lote: raw,
          itemcode: '',
          itemname: null,
          numero_pallet: raw.slice(9),
          codigo_visual: null,
          codigo_visual_legible: null,
          cajas: null,
          kilos: null,
          estado_mapa: 'NO EXISTE',
          estado_wms: null,
          estado_sap: null,
          no_existe_padre: true,
          sin_codigo_visual: true
        }
      };
    }
    return { ok: false, error: 'Sin conexión: el código no existe de forma inequívoca en el último catálogo. Use el ID de lote completo.' };
  },

  palletBackendDesdeCache(p) {
    return {
      id_lote: PalletModel.idLoteReal(p),
      itemcode: p.numero_articulo || '',
      itemname: p.descripcion || null,
      numero_pallet: p.numero_pallet || '',
      codigo_visual: p.codigo_visual_backend || (String(p._codigo_visual_manual || '').startsWith('?') ? null : p._codigo_visual_manual),
      codigo_visual_legible: p.codigo_visual_legible_backend || null,
      cajas: p.cajas_logicas ?? p.cajas ?? null,
      kilos: p.kilos_logicos ?? p.kilos ?? null,
      estado_mapa: p.estado_mapa || p.estado || null,
      estado_wms: p.estado_wms || null,
      estado_wms_registrado: p.estado_wms_registrado || null,
      estado_sap: p.estado_sap || null,
      condicion_principal: p.condicion_principal || null,
      condiciones_wms: p.condiciones_wms || [],
      condiciones_adicionales: p.condiciones_adicionales || [],
      decision: p.decision || null,
      modalidad: p.modalidad || null,
      info_calidad: p.info_calidad ?? null,
      info_general: p.info_general ?? null,
      detector_metales: p.detector_metales ?? null,
      reservado: p.reservado ?? null,
      whscode: p.whscode || null,
      whsname: p.whsname || null,
      almacen_sap: p.almacen_sap || null,
      no_existe_padre: Boolean(p.no_existe_padre),
      sin_codigo_visual: Boolean(p.sin_codigo_visual)
    };
  },

  async resolverOperacional(codigo) {
    const online = typeof MapaOfflineService !== 'undefined' && MapaOfflineService.reachable;
    if (online) {
      const result = await this.resolver(codigo);
      if (!result?.red) return result;
    }
    return this.resolverCache(codigo);
  },

  resolvedToSegment(pallet = {}, slot = {}, id = null) {
    const row = {
      ...pallet,
      segmento_id: null,
      camara: 'PROTER',
      banda: slot.banda,
      posicion: slot.posicion,
      altura: slot.altura,
      cajas_posicion: pallet.cajas ?? null,
      kilos_posicion: pallet.kilos ?? null,
      repetido: false,
      no_existe_padre: Boolean(pallet.no_existe_padre)
    };
    const result = this.segmentoPallet(row);
    result.id = id || `TMP-${this.uuid()}`;
    result.segmento_id = null;
    return result;
  },

  aplicarIdentidad(target, pallet = {}) {
    const slot = { banda: target.banda, posicion: target.posicion, altura: target.altura };
    const next = this.resolvedToSegment(pallet, slot, target.id);
    const preserve = { id: target.id, segmento_id: target.segmento_id, ubicacion: 'PROTER', ...slot };
    Object.keys(target).forEach(k => delete target[k]);
    Object.assign(target, next, preserve);
    return target;
  },

  async sincronizarOperacion({ key, tipo, idLote, origen = null, destino = null, dispositivoEn = null } = {}) {
    return this.rpc('sincronizarOperacion', {
      p_idempotency_key: key || this.uuid(),
      p_tipo: tipo,
      p_id_lote: idLote,
      p_origen: origen,
      p_destino: destino,
      p_dispositivo_en: dispositivoEn || new Date().toISOString()
    });
  },

  async vaciarBanda({ key, banda, motivo = '' } = {}) {
    return this.rpc('vaciarBanda', {
      p_idempotency_key: key || this.uuid(),
      p_camara: 'PROTER',
      p_banda: String(banda),
      p_motivo: String(motivo || '').trim() || null,
      p_dispositivo_en: new Date().toISOString()
    });
  },

  async reemplazarSegmento({ key, segmentoId, codigoNuevo, motivo = '' } = {}) {
    return this.rpc('reemplazarSegmento', {
      p_idempotency_key: key || this.uuid(),
      p_segmento_id: Number(segmentoId),
      p_codigo_nuevo: String(codigoNuevo || '').trim(),
      p_motivo: String(motivo || '').trim() || null,
      p_dispositivo_en: new Date().toISOString()
    });
  }
};
