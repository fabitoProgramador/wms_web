/**
 * Estado visual/optimista del Mapa.
 *
 * Este objeto NO es una base de datos. Los pallets llegan desde Supabase por
 * MapaOfflineService/WmsMapAdapter; aquí sólo se mantiene el snapshot en
 * memoria y los cambios optimistas necesarios para trabajar offline.
 */
const MapaModel = {
  // Se conservan los nombres únicamente para que la migración/cleanup pueda
  // borrar instalaciones antiguas. Este modelo nunca vuelve a leerlos.
  PALLETS_KEY: 'wms_web_db_pallets',
  DATA_SCHEMA_KEY: 'wms_web_db_pallets_schema',
  LETTERS_KEY: 'wms_web_mapa_letters',
  RELEASED_LETTERS_KEY: 'wms_web_mapa_released_articles',
  MAP_STATE_KEY: 'wms_web_mapa_state',
  LOADS_KEY: 'wms_web_mapa_loads',
  DIRECTORY_KEY: 'wms_web_mapa_directories',
  _palletCache: [],
  _stateCache: null,
  _loadsCache: [],

  clone(value) { return JSON.parse(JSON.stringify(value)); },
  uid(prefix = 'PLT') { return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 9)}`; },

  normalizarContratoDatos(pallets) {
    if (!Array.isArray(pallets)) return [];
    pallets.forEach(p => {
      const idLote = String(p.id_lote_real || p.id_lote || p.lote || '').trim();
      p.id_lote_real = idLote;
      p.lote = idLote;
      if (!p.articulo && idLote.length >= 9) p.articulo = idLote.slice(4, 9);
      if (!p.numero_pallet && idLote.length > 9) p.numero_pallet = idLote.slice(9);
      if (p.cajas !== null && p.cajas !== undefined && p.cajas !== '') p.cajas = Number(p.cajas);
      if (p.kilos !== null && p.kilos !== undefined && p.kilos !== '') p.kilos = Number(p.kilos);
      if (p.cajas_logicas !== null && p.cajas_logicas !== undefined && p.cajas_logicas !== '') p.cajas_logicas = Number(p.cajas_logicas);
      if (p.kilos_logicos !== null && p.kilos_logicos !== undefined && p.kilos_logicos !== '') p.kilos_logicos = Number(p.kilos_logicos);
      p.descripcion = p.descripcion || p.itemname || 'Sin descripción SAP disponible';
      p.numero_articulo = p.numero_articulo || p.itemcode || '';
      if (p.banda === undefined) p.banda = null;
      if (p.posicion === undefined) p.posicion = null;
      if (p.altura === undefined) p.altura = null;
      // Nunca completar calidad, detector, reserva, kilos, estados o textos si
      // el backend no los entregó. null/undefined significa dato no disponible.
    });
    return pallets;
  },

  getPallets() { return Array.isArray(this._palletCache) ? this._palletCache : []; },
  savePallets(pallets) {
    this._palletCache = this.normalizarContratoDatos(Array.isArray(pallets) ? pallets : []);
    if (typeof MapaOfflineService !== 'undefined' && MapaOfflineService.initialized) MapaOfflineService.scheduleSnapshot('optimistic-map');
    return this._palletCache;
  },

  // El catálogo artículo->letra es backend. Se mantiene la API histórica para
  // consumidores visuales, pero nunca se persiste ni se autogenera.
  getReleasedArticles() { return new Set(); },
  sincronizarLetrasPersistentes() { return LETRAS_POR_ARTICULO; },
  editarLetra() { return { ok: false, error: 'Las letras se administran en Supabase desde Agregar Código.' }; },
  liberarLetra() { return null; },

  defaultState() {
    return {
      filters: { PROTER: null, 'POST TUNEL': null }, searches: { PROTER: [], 'POST TUNEL': [] }, fifo: { PROTER: false, 'POST TUNEL': false },
      cargo: { embarque: [], postunel: [] }, manuals: { embarque: [], postunel: [] }, originals: {},
      forms: { embarque: this.newLoadData(), postunel: this.newLoadData() }, counters: { embarque: 1, postunel: 1 },
      letterHistory: []
    };
  },

  getState() {
    if (!this._stateCache) this._stateCache = this.defaultState();
    return this._stateCache;
  },
  saveState(state) {
    this._stateCache = state || this.defaultState();
    if (typeof MapaOfflineService !== 'undefined' && MapaOfflineService.initialized) MapaOfflineService.scheduleSnapshot('ui-map-state');
    return this._stateCache;
  },
  newLoadData() { return { folio: '', empresa: '', domicilio: '', ciudad: '', fecha_hora: '', temperatura: '', chofer: '', rut: '', patente_camion: '', patente_rampla: '', observaciones: '' }; },

  // Historial/maestros de Andén ya viven en Supabase. Este cache sólo existe
  // para compatibilidad de renderizadores durante la transición y permanece vacío.
  getLoads() { return Array.isArray(this._loadsCache) ? this._loadsCache : []; },
  saveLoads(loads) { this._loadsCache = Array.isArray(loads) ? loads : []; return this._loadsCache; },
  defaultDirectories() { return { destinos: [], choferes: [] }; },
  getDirectories() { return this.defaultDirectories(); },
  saveDirectories() { return this.defaultDirectories(); },

  cameraKey(ubicacion) { return ubicacion === 'POST TUNEL' ? 'postunel' : 'embarque'; },
  maxPositions(ubicacion, banda) { return ubicacion === 'PROTER' ? posicionesPorBandaProter(Number(banda)) : posicionesPorZonaPostunel(banda); },

  buscarPalletEnPosicion(ubicacion, banda, posicion, altura, db = this.getPallets()) {
    return db.find(p => p.ubicacion === ubicacion && String(p.banda) === String(banda) && Number(p.posicion) === Number(posicion) && p.altura === altura) || null;
  },

  buscarPalletGlobalPorCodigo(codigoTexto) {
    const objetivo = PalletModel.normalizarCodigo(codigoTexto);
    if (!objetivo) return null;
    return this.getPallets().find(p => {
      const keys = PalletModel.clavesDeBusqueda(p);
      return keys.has(String(codigoTexto || '').trim().toUpperCase()) || keys.has(objetivo);
    }) || null;
  },

  resolverPallet(codigoTexto) {
    const raw = String(codigoTexto || '').trim();
    if (!raw) return { ok: false, error: 'Escaneá o ingresá un código.' };
    const pallet = this.buscarPalletGlobalPorCodigo(raw);
    return pallet ? { ok: true, pallet, entrada: raw } : { ok: false, error: `No se encontró pallet para “${raw}” en el snapshot backend disponible.` };
  },

  compactarBandaAltura(db, ubicacion, banda, altura, posicionVacia) {
    db.filter(p => p.ubicacion === ubicacion && String(p.banda) === String(banda) && p.altura === altura && p.posicion !== null && Number(p.posicion) > Number(posicionVacia))
      .sort((a, b) => Number(a.posicion) - Number(b.posicion))
      .forEach(p => { p.posicion = Number(p.posicion) - 1; });
  },

  recalcularRepetidos(db) {
    ['PROTER', 'POST TUNEL'].forEach(ubicacion => {
      const count = {};
      db.filter(p => p.ubicacion === ubicacion && p.banda !== null).forEach(p => {
        const key = String(p.id_lote_real || p.lote || '');
        if (key) count[key] = (count[key] || 0) + 1;
      });
      db.filter(p => p.ubicacion === ubicacion).forEach(p => {
        const key = String(p.id_lote_real || p.lote || '');
        p.repetido = Boolean(key && p.banda !== null && count[key] > 1);
      });
    });
  },

  asignar(db, pallet, ubicacion, banda, posicion, altura) {
    const ocupante = this.buscarPalletEnPosicion(ubicacion, banda, posicion, altura, db);
    if (ocupante && ocupante.id !== pallet.id) return { ok: false, error: 'La posición seleccionada está ocupada.' };
    const anterior = { ubicacion: pallet.ubicacion, banda: pallet.banda, posicion: pallet.posicion, altura: pallet.altura, segmento_id: pallet.segmento_id ?? null };
    pallet.ubicacion = ubicacion; pallet.banda = banda; pallet.posicion = Number(posicion); pallet.altura = altura;
    if (anterior.banda !== null && anterior.banda !== undefined && (anterior.ubicacion !== ubicacion || String(anterior.banda) !== String(banda) || anterior.altura !== altura)) {
      this.compactarBandaAltura(db, anterior.ubicacion, anterior.banda, anterior.altura, anterior.posicion);
    }
    this.recalcularRepetidos(db);
    return { ok: true, anterior, pallet };
  },

  moverPallet(palletId, ubicacion, banda, posicion, altura) { return this.moverPalletSeguro(palletId, ubicacion, banda, posicion, altura).ok; },

  moverPalletSeguro(palletId, ubicacion, banda, posicion, altura) {
    const db = this.getPallets(), pallet = db.find(p => p.id === palletId);
    if (!pallet) return { ok: false, error: 'Pallet no encontrado en el snapshot backend.' };
    const result = this.asignar(db, pallet, ubicacion, banda, posicion, altura);
    if (!result.ok) return result;
    this.savePallets(db);
    return result;
  },

  quitarDePosicion(palletId) {
    const db = this.getPallets(), p = db.find(x => x.id === palletId);
    if (!p || p.banda === null || p.banda === undefined) return false;
    const { ubicacion, banda, posicion, altura } = p;
    p.banda = p.posicion = p.altura = null;
    this.compactarBandaAltura(db, ubicacion, banda, altura, posicion);
    this.recalcularRepetidos(db); this.savePallets(db); return true;
  },

  vaciarBanda(ubicacion, banda) {
    const db = this.getPallets(), afectados = db.filter(p => p.ubicacion === ubicacion && String(p.banda) === String(banda));
    afectados.forEach(p => { p.banda = p.posicion = p.altura = null; });
    this.recalcularRepetidos(db); this.savePallets(db); return afectados.length;
  },

  editarCelda(ubicacion, banda, posicion, altura, texto) {
    const db = this.getPallets();
    const actual = this.buscarPalletEnPosicion(ubicacion, banda, posicion, altura, db);
    const valor = String(texto || '').trim();
    if (!valor) {
      if (!actual) return { ok: true, removed: false };
      const pos = actual.posicion;
      actual.banda = actual.posicion = actual.altura = null;
      this.compactarBandaAltura(db, ubicacion, banda, altura, pos);
      this.recalcularRepetidos(db); this.savePallets(db);
      return { ok: true, removed: true };
    }
    const pallet = this.buscarPalletGlobalPorCodigo(valor);
    if (!pallet) return { ok: false, error: 'El código no existe en el snapshot backend. Resuélvalo primero contra Supabase.' };
    if (actual && actual.id === pallet.id) return { ok: true, pallet: actual, unchanged: true };
    const result = this.asignar(db, pallet, ubicacion, banda, posicion, altura);
    if (!result.ok) return result;
    this.savePallets(db);
    return { ok: true, pallet };
  },

  fifoIds(ubicacion) {
    const rows = this.getPallets().filter(p => p.banda !== null && p.ubicacion === ubicacion);
    rows.sort((a, b) => this.fechaOrden(a.fecha_fabricacion).localeCompare(this.fechaOrden(b.fecha_fabricacion)));
    return new Set(rows.slice(0, Math.max(1, Math.round(rows.length * 0.2))).map(p => p.id));
  },
  fechaOrden(v) {
    const raw = String(v || '').trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10).replaceAll('-', '');
    const [d = '99', m = '99', a = '9999'] = raw.split(/[/-]/);
    return `${a}${m.padStart(2,'0')}${d.padStart(2,'0')}`;
  },

  coincideFiltro(p, ubicacion, filtro) {
    if (filtro === null) return true;
    if (ubicacion === 'PROTER' && filtro.includes(p.estado)) return true;
    if (ubicacion === 'POST TUNEL' && filtro.includes(p.articulo)) return true;
    return (p.repetido && filtro.includes('REPETIDO')) || (p.no_existe && filtro.includes('NO EXISTE'));
  },

  agregarACarga(palletId) {
    const db = this.getPallets(), p = db.find(x => x.id === palletId);
    if (!p) return { ok: false, error: 'Pallet no encontrado en el snapshot backend.' };
    const tab = this.cameraKey(p.ubicacion), state = this.getState();
    if (state.cargo[tab].includes(p.id) || state.manuals[tab].some(x => x.id === p.id)) return { ok: false, error: 'El pallet ya está en esta carga.' };
    if (p.banda !== null && p.banda !== undefined) {
      state.originals[p.id] = { mapa: tab === 'embarque' ? 'proter' : 'postunel', banda: p.banda, posicion: p.posicion, altura: p.altura, segmento_id: p.segmento_id ?? null };
      state.cargo[tab].push(p.id);
      const { ubicacion, banda, posicion, altura } = p;
      p.banda = p.posicion = p.altura = null;
      this.compactarBandaAltura(db, ubicacion, banda, altura, posicion);
    } else state.manuals[tab].push({ ...p, _manual_pasillo: true });
    this.recalcularRepetidos(db); this.savePallets(db); this.saveState(state);
    return { ok: true, tab };
  },

  agregarCodigoACarga(tab, codigo) {
    const p = this.buscarPalletGlobalPorCodigo(codigo);
    if (!p) return { ok: false, error: `No se encontró ningún pallet con el código “${codigo}” en el snapshot backend.` };
    const esperado = tab === 'embarque' ? 'PROTER' : 'POST TUNEL';
    if (p.banda !== null && p.banda !== undefined && p.ubicacion !== esperado) return { ok: false, error: `El pallet pertenece a ${p.ubicacion}; agregalo desde su carga correspondiente.` };
    return this.agregarACarga(p.id);
  },

  quitarDeCarga(tab, palletId) {
    const state = this.getState();
    const eraManual = state.manuals[tab].some(p => p.id === palletId);
    state.manuals[tab] = state.manuals[tab].filter(p => p.id !== palletId);
    state.cargo[tab] = state.cargo[tab].filter(id => id !== palletId);
    const origen = state.originals[palletId], db = this.getPallets(), pallet = db.find(p => p.id === palletId);
    let aviso = '';
    if (!eraManual && origen && pallet) {
      const ubicacion = tab === 'embarque' ? 'PROTER' : 'POST TUNEL';
      const ocupadas = new Set(db.filter(p => p.id !== palletId && p.ubicacion === ubicacion && String(p.banda) === String(origen.banda) && p.altura === origen.altura && p.posicion !== null).map(p => Number(p.posicion)));
      let destino = Number(origen.posicion);
      if (ocupadas.has(destino)) {
        destino = Array.from({ length: this.maxPositions(ubicacion, origen.banda) }, (_, i) => i + 1).find(n => !ocupadas.has(n)) || null;
        aviso = destino ? `La posición original estaba ocupada: volvió temporalmente a P${destino}.` : 'La banda está llena: quedó temporalmente sin posición.';
      }
      if (destino !== null) { pallet.ubicacion = ubicacion; pallet.banda = origen.banda; pallet.posicion = destino; pallet.altura = origen.altura; }
    }
    delete state.originals[palletId]; this.recalcularRepetidos(db); this.savePallets(db); this.saveState(state);
    return { ok: true, aviso };
  },

  palletsCarga(tab) {
    const state = this.getState(), db = this.getPallets();
    return db.filter(p => state.cargo[tab].includes(p.id)).concat(state.manuals[tab]);
  },

  folioPrevisto() { return 'AUTOMÁTICO'; },
  guardarCarga() { return { ok: false, error: 'Las cargas se guardan exclusivamente en Supabase desde Andén de Carga.' }; },
  aprenderDirectorio() {},
  actualizarCargaHistorica() { return false; },
  quitarPalletHistorico() { return { ok: false, error: 'El historial de despacho se gestiona exclusivamente en Supabase.' }; }
};
