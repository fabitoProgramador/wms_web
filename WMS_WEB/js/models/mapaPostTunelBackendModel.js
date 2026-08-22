/**
 * Contrato autoritativo del visor Cámara POST TÚNEL.
 *
 * Reutiliza las reglas comunes ya validadas en MapaProterBackendModel y sólo
 * redefine cámara, geometría y preservación de las zonas especiales 01/02.
 * Supabase sigue siendo la autoridad de posiciones, identidad, estados,
 * conflictos y auditoría.
 */
const MapaPostTunelBackendModel = Object.create(MapaProterBackendModel);

MapaPostTunelBackendModel._snapshot = null;

MapaPostTunelBackendModel.basePallet = function(row = {}) {
  const base = MapaProterBackendModel.basePallet.call(this, row);
  delete base._backend_proter;
  base._backend_postunel = true;
  return base;
};

MapaPostTunelBackendModel.segmentoPallet = function(row = {}) {
  const base = this.basePallet(row);
  const cajasPosicion = this.numero(row.cajas_posicion, base.cajas);
  const kilosPosicion = this.numero(row.kilos_posicion, base.kilos);
  const rawBand = String(row.banda ?? '').trim();
  const banda = rawBand === '01' || rawBand === '02'
    ? rawBand
    : this.numero(rawBand, rawBand);

  return {
    ...base,
    id: `SEG-${row.segmento_id}`,
    segmento_id: this.numero(row.segmento_id),
    ubicacion: 'POST TUNEL',
    banda,
    posicion: this.numero(row.posicion),
    altura: row.altura || null,
    cajas: cajasPosicion,
    kilos: kilosPosicion,
    cajas_posicion: cajasPosicion,
    kilos_posicion: kilosPosicion,
    actualizado_en: row.actualizado_en || null,
    cantidad_posiciones: this.numero(row.cantidad_posiciones, 1)
  };
};

MapaPostTunelBackendModel.catalogoPallet = function(row = {}) {
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
};

MapaPostTunelBackendModel.snapshot = async function() {
  const data = await this.rpc('snapshot', { p_camara: 'POST TUNEL', p_incluir_catalogo: true });
  if (data?.ok === false) return data;
  if (!data || !Array.isArray(data.segmentos) || !Array.isArray(data.catalogo_pallets)) {
    return { ok: false, error: 'Supabase entregó un snapshot POST TÚNEL incompleto.' };
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
};

MapaPostTunelBackendModel.geometria = function() {
  return this._snapshot?.geometria || null;
};

MapaPostTunelBackendModel.camaraMeta = function() {
  return (this._snapshot?.camaras || []).find(x => x.camara === 'POST TUNEL') || null;
};

MapaPostTunelBackendModel.bandas = function() {
  const geometry = this.geometria()?.['POST TUNEL'] || {};
  const specials = Array.isArray(geometry.zonas_especiales) && geometry.zonas_especiales.length
    ? geometry.zonas_especiales.map(String)
    : ['01', '02'];
  const start = this.numero(geometry.bandas_inicio, 1);
  const end = this.numero(geometry.bandas_fin, 18);
  const normal = [];
  for (let band = start; band <= end; band += 1) normal.push(band);
  return [...specials, ...normal];
};

MapaPostTunelBackendModel.maxPosiciones = function(banda) {
  const geometry = this.geometria()?.['POST TUNEL'] || {};
  const raw = String(banda ?? '').trim();
  const specials = new Set((geometry.zonas_especiales || ['01', '02']).map(String));
  return specials.has(raw)
    ? this.numero(geometry.posiciones_especiales, 17)
    : this.numero(geometry.posiciones_banda, 8);
};

MapaPostTunelBackendModel.resolvedToSegment = function(pallet = {}, slot = {}, id = null) {
  const row = {
    ...pallet,
    segmento_id: null,
    camara: 'POST TUNEL',
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
};

MapaPostTunelBackendModel.aplicarIdentidad = function(target, pallet = {}) {
  const slot = { banda: target.banda, posicion: target.posicion, altura: target.altura };
  const next = this.resolvedToSegment(pallet, slot, target.id);
  const preserve = { id: target.id, segmento_id: target.segmento_id, ubicacion: 'POST TUNEL', ...slot };
  Object.keys(target).forEach(key => delete target[key]);
  Object.assign(target, next, preserve);
  return target;
};

MapaPostTunelBackendModel.vaciarBanda = async function({ key, banda, motivo = '' } = {}) {
  return this.rpc('vaciarBanda', {
    p_idempotency_key: key || this.uuid(),
    p_camara: 'POST TUNEL',
    p_banda: String(banda),
    p_motivo: String(motivo || '').trim() || null,
    p_dispositivo_en: new Date().toISOString()
  });
};
