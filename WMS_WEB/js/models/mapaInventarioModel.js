/**
 * Inventario de Cámara remoto: cruce SAP <-> posiciones físicas WMS.
 * No usa INVENTARIO_CAMARA_SAP, MapaModel ni localStorage como fuente de negocio.
 */
const MapaInventarioModel = {
  _geometria: null,

  numero(value, fallback = 0) {
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

  camara(value) {
    const v = String(value || '').trim().toUpperCase().replace(/_/g, ' ');
    if (v === 'POSTUNEL' || v === 'POST TUNEL') return 'POST TUNEL';
    return 'PROTER';
  },

  async rpc(nombre, parametros = {}) {
    const response = await SupabaseService.rpc('mapa', nombre, parametros);
    if (!response.ok) {
      const error = new Error(response.error || `No fue posible ejecutar mapa.${nombre}.`);
      error.estado = response.estado;
      error.permiso = response.permiso;
      error.red = response.red;
      throw error;
    }
    return response.datos;
  },

  normalizarPosicion(row = {}) {
    return {
      segmentoId: row.posicion_id ?? row.segmento_id ?? null,
      camara: this.camara(row.camara),
      banda: String(row.banda ?? ''),
      posicion: this.numero(row.posicion, null),
      altura: row.altura || row.nivel || '',
      cajas: row.cajas == null ? null : this.numero(row.cajas),
      kilos: row.kilos == null ? null : this.numero(row.kilos),
      actualizadoEn: row.actualizado_en || null
    };
  },

  normalizarItem(row = {}) {
    const posiciones = (row.ubicaciones_fisicas || []).map(x => this.normalizarPosicion(x));
    const cajasCamara = row.cajas_camara == null ? null : this.numero(row.cajas_camara);
    const kilosCamara = row.kilos_camara == null ? null : this.numero(row.kilos_camara);
    return {
      ...row,
      idLote: String(row.id_lote || ''),
      codigoVisual: row.codigo_visual_legible || row.codigo_visual || '',
      itemcode: row.itemcode || '',
      itemname: row.itemname || 'Sin descripción SAP disponible',
      cajas: row.cajas == null ? null : this.numero(row.cajas),
      kilos: row.kilos == null ? null : this.numero(row.kilos),
      cajasCamara,
      kilosCamara,
      cajasInventario: cajasCamara ?? (row.cajas == null ? null : this.numero(row.cajas)),
      kilosInventario: kilosCamara ?? (row.kilos == null ? null : this.numero(row.kilos)),
      saldoCamaraEspecifico: cajasCamara != null || kilosCamara != null,
      estadoInventario: row.estado_inventario || '—',
      camaraConsultada: this.camara(row.camara_consultada),
      camaraSap: row.camara_sap || '—',
      posiciones,
      posicionesMapa: this.numero(row.posiciones_mapa),
      multiubicado: Boolean(row.multiubicado),
      noExistePadre: Boolean(row.no_existe_padre),
      estadoSap: row.estado_sap || 'SIN INFORMACIÓN',
      estadoWms: row.estado_wms || row.estado_sap || 'SIN ESTADO',
      estadoMapa: row.estado_mapa || '—',
      condicionPrincipal: row.condicion_principal || '',
      detector: row.detector_metales || 'SIN INFORMACIÓN',
      reservado: Boolean(row.reservado),
      requiereSegmentoExplicito: Boolean(row.requiere_segmento_explicito)
    };
  },

  async listar({ camara = 'PROTER', estado = 'TODOS', busqueda = '', limite = 40, offset = 0 } = {}) {
    const data = await this.rpc('inventarioCamara', {
      p_camara: this.camara(camara),
      p_estado: estado || 'TODOS',
      p_busqueda: String(busqueda || '').trim() || null,
      p_limite: limite,
      p_offset: offset
    });
    return {
      raw: data,
      camara: this.camara(data?.camara || camara),
      resumen: {
        encontrado: this.numero(data?.resumen?.encontrado),
        otraCamara: this.numero(data?.resumen?.otra_camara),
        noEncontrado: this.numero(data?.resumen?.no_encontrado),
        noExiste: this.numero(data?.resumen?.no_existe),
        total: this.numero(data?.resumen?.total)
      },
      totalFiltrado: this.numero(data?.total_filtrado),
      limite: this.numero(data?.limite, limite),
      offset: this.numero(data?.offset, offset),
      items: (data?.items || []).map(row => this.normalizarItem(row)),
      generadoEn: data?.generado_en || null
    };
  },

  async geometria() {
    if (this._geometria) return this._geometria;
    const data = await this.rpc('snapshot', { p_camara: 'TODOS', p_incluir_catalogo: false });
    this._geometria = data?.geometria || null;
    return this._geometria;
  },

  bandas(camara, geometria) {
    const c = this.camara(camara);
    if (c === 'PROTER') {
      const ranges = geometria?.PROTER?.rangos || [];
      const out = [];
      ranges.forEach(r => {
        for (let i = Number(r.inicio); i <= Number(r.fin); i += 1) out.push(String(i));
      });
      return [...new Set(out)];
    }
    const especiales = (geometria?.['POST TUNEL']?.zonas_especiales || []).map(String);
    const ini = this.numero(geometria?.['POST TUNEL']?.bandas_inicio, 1);
    const fin = this.numero(geometria?.['POST TUNEL']?.bandas_fin, 18);
    return [...especiales, ...Array.from({ length: Math.max(0, fin - ini + 1) }, (_, i) => String(ini + i))];
  },

  maxPosiciones(camara, banda, geometria) {
    const c = this.camara(camara);
    const b = String(banda ?? '');
    if (c === 'PROTER') {
      const n = Number(b);
      const range = (geometria?.PROTER?.rangos || []).find(r => n >= Number(r.inicio) && n <= Number(r.fin));
      return this.numero(range?.posiciones, 0);
    }
    if ((geometria?.['POST TUNEL']?.zonas_especiales || []).map(String).includes(b)) {
      return this.numero(geometria?.['POST TUNEL']?.posiciones_especiales, 17);
    }
    return this.numero(geometria?.['POST TUNEL']?.posiciones_banda, 8);
  },

  niveles(geometria) {
    return Array.isArray(geometria?.niveles) && geometria.niveles.length ? geometria.niveles : ['C1', 'C2'];
  },

  async guardarPosicion({ item, camara, banda, posicion, altura, segmento = null } = {}) {
    const mover = Boolean(segmento?.segmentoId);
    const destino = {
      camara: this.camara(camara),
      banda: String(banda),
      posicion: Number(posicion),
      altura: String(altura || '').toUpperCase()
    };
    if (!mover) {
      if (item?.cajasInventario != null) destino.cajas_posicion = item.cajasInventario;
      if (item?.kilosInventario != null) destino.kilos_posicion = item.kilosInventario;
    }
    return this.rpc('sincronizarOperacion', {
      p_idempotency_key: this.uuid(),
      p_tipo: mover ? 'MOVER' : 'COLOCAR',
      p_id_lote: item?.idLote,
      p_origen: mover ? { segmento_id: segmento.segmentoId } : null,
      p_destino: destino,
      p_dispositivo_en: new Date().toISOString()
    });
  }
};
