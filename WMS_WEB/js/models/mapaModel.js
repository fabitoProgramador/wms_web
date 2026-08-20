/**
 * Fuente única de datos y reglas de negocio del módulo Mapa.
 * Los renderizadores actuales —y el futuro visor 2.5D— deben consumir
 * exclusivamente este contrato para no duplicar movimientos ni validaciones.
 */
const MapaModel = {
  PALLETS_KEY: 'wms_web_db_pallets',
  DATA_SCHEMA_KEY: 'wms_web_db_pallets_schema',
  DATA_SCHEMA_VERSION: '6.4.0',
  LETTERS_KEY: 'wms_web_mapa_letters',
  RELEASED_LETTERS_KEY: 'wms_web_mapa_released_articles',
  MAP_STATE_KEY: 'wms_web_mapa_state',
  LOADS_KEY: 'wms_web_mapa_loads',
  DIRECTORY_KEY: 'wms_web_mapa_directories',
  _palletCache: null,
  _stateCache: null,
  _loadsCache: null,

  clone(value) { return JSON.parse(JSON.stringify(value)); },
  uid(prefix = 'PLT') { return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 9)}`; },
  // Adaptador de la semilla del RepositorioPallets MVC: los datos demo de
  // calidad/pedido son estables por lote y viven en la fuente de pallets,
  // nunca en el render de Bitácora. Una API real reemplazará este adaptador.
  semillaLote(lote) { return [...String(lote || '')].reduce((n, c) => ((n * 31) + c.charCodeAt(0)) >>> 0, 7); },
  indiceLote(lote, modulo) { return this.semillaLote(lote) % modulo; },

  getInitialPallets() {
    const list = [];
    const estados = Object.keys(COLORES_MAPA_ESTADO);
    const articulos = Object.keys(CATALOGO_ARTICULOS);
    const crear = (ubicacion, cantidad, slots, prefijo, inicio, saltoHoras) => {
      for (let i = 0; i < cantidad; i += 1) {
        const slot = slots[(i * 2) % slots.length];
        const articulo = articulos[(i + (ubicacion === 'POST TUNEL' ? 2 : 0)) % articulos.length];
        const numero = String((i % 99) + 1).padStart(2, '0');
        const fecha = new Date(Date.now() - i * saltoHoras * 3600000);
        list.push({
          id: `${prefijo}-${inicio + i}`,
          lote: `L-${202600 + (i % 75)}`,
          articulo,
          descripcion: CATALOGO_ARTICULOS[articulo].descripcion,
          numero_pallet: numero,
          cajas: (ubicacion === 'PROTER' ? 60 : 50) + (i % 40),
          estado: estados[i % estados.length],
          ubicacion,
          banda: slot.banda,
          posicion: slot.posicion,
          altura: slot.altura,
          repetido: false,
          fecha_ingreso: fecha.toISOString().slice(0, 10),
          fecha_admision: fecha.toLocaleDateString('es-CL'),
          fecha_fabricacion: fecha.toLocaleDateString('es-CL')
        });
      }
    };
    crear('PROTER', 180, generarSlotsProter(), 'PLT-PRO', 1000, 24);
    crear('POST TUNEL', 120, generarSlotsPostunel(), 'PLT-PUN', 2000, 12);
    return this.normalizarContratoDatos(list, { recalcularNumerosDemo: false });
  },

  normalizarContratoDatos(pallets, { recalcularNumerosDemo = false } = {}) {
    const contador = {};
    pallets.forEach(p => {
      if (p.pendiente_verificacion && String(p.articulo || '').trim().toLocaleLowerCase('es-CL') === 'pendiente de verificación') {
        p.articulo = '';
        if (String(p.descripcion || '').trim().toLocaleLowerCase('es-CL') === 'pendiente de verificación') p.descripcion = 'Sin datos maestros asociados';
      }
      const articulo = String(p.articulo || '').trim();
      if (recalcularNumerosDemo && /^PLT-(PRO|PUN)-\d+$/.test(String(p.id || ''))) {
        contador[articulo] = (contador[articulo] || 0) + 1;
        p.numero_pallet = String(contador[articulo]).padStart(2, '0');
        delete p.id_lote_real;
        delete p.numero_articulo;
      }
      p.cajas = Number(p.cajas) || 0;
      p.descripcion = PalletModel.descripcion(p);
      p.kilos = PalletModel.kilos(p);
      p.numero_articulo = PalletModel.numeroArticulo(p);
      p.id_lote_real = PalletModel.idLoteReal(p);
      if (p.banda === undefined) p.banda = null;
      if (p.posicion === undefined) p.posicion = null;
      if (p.altura === undefined) p.altura = null;
      if (!p.fecha_fabricacion && p.fecha_ingreso) {
        const [a, m, d] = String(p.fecha_ingreso).split('-');
        p.fecha_fabricacion = a && m && d ? `${d}/${m}/${a}` : '';
      }
      // Contrato de datos que consume Bitácora en el MVC. Es común a mapa,
      // inventario y pendientes; se completa una vez al migrar datos previos.
      const alertaCalidad = ['VERIFICACIÓN', 'SIN DM', 'RECHAZO', 'BLOQUEADOS', 'LOTES INCOMPLETOS'].includes(String(p.estado || '').toUpperCase());
      const calidadOk = ['Cumple estándar de calidad para exportación.', 'Fruta homogénea, sin defectos visibles relevantes.', 'Calibre y color dentro de parámetros de exportación.'];
      const calidadAlerta = ['Pendiente de verificación de calidad de laboratorio.', 'Observación de calidad registrada, requiere revisión.', 'Muestra con defectos menores, en evaluación.'];
      const textosCalidad = alertaCalidad ? calidadAlerta : calidadOk;
      if (!p.detector_metales) p.detector_metales = alertaCalidad ? 'RECHAZADO' : 'APROBADO';
      if (!p.info_calidad) p.info_calidad = textosCalidad[this.indiceLote(p.lote, textosCalidad.length)];
      if (!p.info_general) p.info_general = `Lote ingresado a ${p.ubicacion || 'planta'}. Sin observaciones logísticas adicionales.`;
      if (!p.reservado) p.reservado = String(p.estado || '').toUpperCase() === 'PEDIDO' ? 'SÍ' : 'NO';
      if (String(p.estado || '').toUpperCase() === 'PEDIDO' && !p.fecha_pedido) {
        const fechaPedido = new Date();
        fechaPedido.setDate(fechaPedido.getDate() - this.indiceLote(p.lote, 5));
        p.fecha_pedido = `${String(fechaPedido.getDate()).padStart(2, '0')}/${String(fechaPedido.getMonth() + 1).padStart(2, '0')}/${fechaPedido.getFullYear()}`;
      }
    });
    return pallets;
  },

  getPallets() {
    if (Array.isArray(this._palletCache)) return this._palletCache;
    let pallets;
    try { pallets = JSON.parse(localStorage.getItem(this.PALLETS_KEY) || 'null'); } catch (_) { pallets = null; }
    if (!Array.isArray(pallets)) pallets = this.getInitialPallets();
    const migrar = localStorage.getItem(this.DATA_SCHEMA_KEY) !== this.DATA_SCHEMA_VERSION;
    this.normalizarContratoDatos(pallets, { recalcularNumerosDemo: migrar });
    this.sincronizarLetrasPersistentes(pallets);
    if (migrar || !localStorage.getItem(this.PALLETS_KEY)) this.savePallets(pallets);
    this._palletCache = pallets;
    return this._palletCache;
  },

  savePallets(pallets) {
    this.normalizarContratoDatos(pallets);
    this._palletCache = pallets;
    localStorage.setItem(this.DATA_SCHEMA_KEY, this.DATA_SCHEMA_VERSION);
    if(typeof MapaOfflineService!=='undefined'&&MapaOfflineService.initialized)MapaOfflineService.scheduleSnapshot('local-model');
  },

  getReleasedArticles() {
    try { return new Set(JSON.parse(localStorage.getItem(this.RELEASED_LETTERS_KEY) || '[]')); }
    catch (_) { return new Set(); }
  },

  sincronizarLetrasPersistentes(pallets) {
    let guardadas = {};
    try { guardadas = JSON.parse(localStorage.getItem(this.LETTERS_KEY) || '{}') || {}; } catch (_) {}
    Object.keys(LETRAS_POR_ARTICULO).forEach(k => delete LETRAS_POR_ARTICULO[k]);
    Object.assign(LETRAS_POR_ARTICULO, guardadas);
    const liberados = this.getReleasedArticles();
    const usadas = new Set(Object.values(LETRAS_POR_ARTICULO));
    [...new Set(pallets.map(p => String(p.articulo || '').trim()).filter(Boolean))].forEach(articulo => {
      if (LETRAS_POR_ARTICULO[articulo] || liberados.has(articulo)) return;
      const letra = PalletModel.siguienteLetra(usadas);
      LETRAS_POR_ARTICULO[articulo] = letra;
      usadas.add(letra);
    });
    localStorage.setItem(this.LETTERS_KEY, JSON.stringify(LETRAS_POR_ARTICULO));
    return LETRAS_POR_ARTICULO;
  },

  editarLetra(articulo, nuevaLetra, registradoPor = '') {
    const nueva = String(nuevaLetra || '').trim().toUpperCase();
    if (!nueva) return { ok: false, error: 'La letra no puede quedar vacía.' };
    const dueno = Object.entries(LETRAS_POR_ARTICULO).find(([art, letra]) => art !== articulo && letra === nueva);
    if (dueno) return { ok: false, error: `Esa letra ya está en uso por "${dueno[0]}" — liberala primero o elegí otra.` };
    const anterior = LETRAS_POR_ARTICULO[articulo] || '(sin asignar)';
    LETRAS_POR_ARTICULO[articulo] = nueva;
    const liberados = this.getReleasedArticles(); liberados.delete(articulo);
    localStorage.setItem(this.RELEASED_LETTERS_KEY, JSON.stringify([...liberados]));
    localStorage.setItem(this.LETTERS_KEY, JSON.stringify(LETRAS_POR_ARTICULO));
    const state = this.getState();
    state.letterHistory.unshift({ articulo, letra_anterior: anterior, letra_nueva: nueva, registrado_por: String(registradoPor || '').trim() || '(sin especificar)', fecha: new Date().toLocaleString('es-CL') });
    state.letterHistory = state.letterHistory.slice(0, 50);
    this.saveState(state);
    const pallets = this.getPallets(); this.recalcularRepetidos(pallets); this.savePallets(pallets);
    return { ok: true };
  },

  liberarLetra(articulo) {
    const letra = LETRAS_POR_ARTICULO[articulo];
    delete LETRAS_POR_ARTICULO[articulo];
    const liberados = this.getReleasedArticles(); liberados.add(articulo);
    localStorage.setItem(this.RELEASED_LETTERS_KEY, JSON.stringify([...liberados]));
    localStorage.setItem(this.LETTERS_KEY, JSON.stringify(LETRAS_POR_ARTICULO));
    return letra;
  },

  defaultState() {
    return {
      filters: { PROTER: null, 'POST TUNEL': null }, searches: { PROTER: [], 'POST TUNEL': [] }, fifo: { PROTER: false, 'POST TUNEL': false },
      cargo: { embarque: [], postunel: [] }, manuals: { embarque: [], postunel: [] }, originals: {},
      forms: { embarque: this.newLoadData(), postunel: this.newLoadData() }, counters: { embarque: 1, postunel: 1 },
      letterHistory: []
    };
  },

  getState() {
    if (this._stateCache) return this._stateCache;
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(this.MAP_STATE_KEY) || '{}') || {}; } catch (_) {}
    const base = this.defaultState();
    this._stateCache = {
      ...base, ...saved,
      filters: { ...base.filters, ...(saved.filters || {}) }, searches: { ...base.searches, ...(saved.searches || {}) }, fifo: { ...base.fifo, ...(saved.fifo || {}) },
      cargo: { ...base.cargo, ...(saved.cargo || {}) }, manuals: { ...base.manuals, ...(saved.manuals || {}) },
      forms: { embarque: { ...base.forms.embarque, ...(saved.forms?.embarque || {}) }, postunel: { ...base.forms.postunel, ...(saved.forms?.postunel || {}) } },
      counters: { ...base.counters, ...(saved.counters || {}) }, originals: saved.originals || {}, letterHistory: saved.letterHistory || []
    };
    return this._stateCache;
  },
  saveState(state) { this._stateCache = state; localStorage.setItem(this.MAP_STATE_KEY, JSON.stringify(state)); },
  newLoadData() { return { folio: '', empresa: '', domicilio: '', ciudad: '', fecha_hora: '', temperatura: '', chofer: '', rut: '', patente_camion: '', patente_rampla: '', observaciones: '' }; },

  getLoads() {if(Array.isArray(this._loadsCache))return this._loadsCache;try { const v = JSON.parse(localStorage.getItem(this.LOADS_KEY) || '[]');this._loadsCache=Array.isArray(v)?v:[];return this._loadsCache; } catch (_) {this._loadsCache=[]; return this._loadsCache;} },
  saveLoads(loads) {this._loadsCache=loads;if(typeof MapaOfflineService!=='undefined'&&MapaOfflineService.initialized)MapaOfflineService.scheduleSnapshot('local-loads'); },
  defaultDirectories() {
    return {
      destinos: (typeof DESTINOS_ANDEN === 'undefined' ? [] : DESTINOS_ANDEN).map(item => ({ ...item })),
      choferes: [
        { nombre: 'Luis Contreras', rut: '12.345.678-9', patente_camion: 'KXTR-42', patente_rampla: 'RM-8871' },
        { nombre: 'Marcos Pino', rut: '15.987.654-3', patente_camion: 'LPWD-18', patente_rampla: 'RM-4402' }
      ]
    };
  },
  getDirectories() {
    let stored = {}; try { stored = JSON.parse(localStorage.getItem(this.DIRECTORY_KEY) || '{}') || {}; } catch (_) { stored = {}; }
    const defaults = this.defaultDirectories(), merge = (base, extra, key) => { const result = this.clone(base); (Array.isArray(extra) ? extra : []).forEach(item => { const value = String(item?.[key] || '').toLowerCase(); const index = result.findIndex(x => String(x?.[key] || '').toLowerCase() === value); if (index >= 0) result[index] = { ...result[index], ...item }; else if (value) result.push(item); }); return result; };
    const legacy = new Set(['frutícola los robles ltda.', 'exportadora del maule s.a.', 'agrícola santa elena']);
    const defaultDestinationIds = new Set(defaults.destinos.map(item => item.id));
    const storedDestinations = (Array.isArray(stored.destinos) ? stored.destinos : []).filter(item => !legacy.has(String(item?.empresa || '').trim().toLowerCase()) && !defaultDestinationIds.has(item?.id)).map((item, index) => ({
      ...item,
      id: item.id || `personalizado-${index}-${String(item.empresa || 'destino').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      nombre: item.nombre || [item.empresa, item.ciudad].filter(Boolean).join(' – ')
    }));
    const directories = { destinos: merge(defaults.destinos, storedDestinations, 'id'), choferes: merge(defaults.choferes, stored.choferes, 'nombre') };
    this.saveDirectories(directories); return directories;
  },
  saveDirectories(v) { localStorage.setItem(this.DIRECTORY_KEY, JSON.stringify(v)); },

  cameraKey(ubicacion) { return ubicacion === 'POST TUNEL' ? 'postunel' : 'embarque'; },
  maxPositions(ubicacion, banda) { return ubicacion === 'PROTER' ? posicionesPorBandaProter(Number(banda)) : posicionesPorZonaPostunel(banda); },

  buscarPalletEnPosicion(ubicacion, banda, posicion, altura, db = this.getPallets()) {
    return db.find(p => p.ubicacion === ubicacion && p.banda === banda && Number(p.posicion) === Number(posicion) && p.altura === altura) || null;
  },
  buscarPalletGlobalPorCodigo(codigoTexto) {
    const objetivo = PalletModel.normalizarCodigo(codigoTexto); if (!objetivo) return null;
    return this.getPallets().find(p => PalletModel.normalizarCodigo(PalletModel.codigoVisual(p)) === objetivo) || null;
  },
  /** Resolvedor único para lector, cámara e ingreso manual. No altera el dato escaneado. */
  resolverPallet(codigoTexto) {
    const raw = String(codigoTexto || '').trim();
    if (!raw) return { ok: false, error: 'Escaneá o ingresá un código.' };
    const normalized = PalletModel.normalizarCodigo(raw);
    const lote = PalletModel.normalizarLote(raw);
    const pallet = this.getPallets().find(p =>
      PalletModel.normalizarCodigo(PalletModel.codigoVisual(p)) === normalized ||
      PalletModel.normalizarCodigo(p.id) === normalized ||
      PalletModel.normalizarCodigo(PalletModel.idLoteReal(p)) === normalized ||
      PalletModel.normalizarLote(p.lote) === lote ||
      (Array.isArray(p.cajas_asociadas) && p.cajas_asociadas.some(c => PalletModel.normalizarCodigo(c) === normalized))
    );
    return pallet ? { ok: true, pallet, entrada: raw } : { ok: false, error: `No se encontró pallet para “${raw}”.` };
  },

  compactarBandaAltura(db, ubicacion, banda, altura, posicionVacia) {
    db.filter(p => p.ubicacion === ubicacion && p.banda === banda && p.altura === altura && p.posicion !== null && Number(p.posicion) > Number(posicionVacia))
      .sort((a, b) => a.posicion - b.posicion).forEach(p => { p.posicion -= 1; });
  },

  recalcularRepetidos(db) {
    ['PROTER', 'POST TUNEL'].forEach(ubicacion => {
      const conteo = {};
      db.filter(p => p.ubicacion === ubicacion && p.banda !== null).forEach(p => { const c = PalletModel.normalizarCodigo(PalletModel.codigoVisual(p)); conteo[c] = (conteo[c] || 0) + 1; });
      db.filter(p => p.ubicacion === ubicacion).forEach(p => { p.repetido = p.banda !== null && conteo[PalletModel.normalizarCodigo(PalletModel.codigoVisual(p))] > 1; });
    });
  },

  asignar(db, pallet, ubicacion, banda, posicion, altura) {
    const ocupante = this.buscarPalletEnPosicion(ubicacion, banda, posicion, altura, db);
    if (ocupante && ocupante.id !== pallet.id) ocupante.banda = ocupante.posicion = ocupante.altura = null;
    const anterior = { ubicacion: pallet.ubicacion, banda: pallet.banda, posicion: pallet.posicion, altura: pallet.altura };
    pallet.ubicacion = ubicacion; pallet.banda = banda; pallet.posicion = Number(posicion); pallet.altura = altura;
    if (anterior.banda !== null && (anterior.ubicacion !== ubicacion || anterior.banda !== banda || anterior.altura !== altura)) {
      this.compactarBandaAltura(db, anterior.ubicacion, anterior.banda, anterior.altura, anterior.posicion);
    }
    this.recalcularRepetidos(db);
  },

  moverPallet(palletId, ubicacion, banda, posicion, altura) {
    const db = this.getPallets(), pallet = db.find(p => p.id === palletId); if (!pallet) return false;
    this.asignar(db, pallet, ubicacion, banda, posicion, altura); this.savePallets(db); return true;
  },

  /** Movimiento operacional seguro: jamás desalojar un pallet destino. */
  moverPalletSeguro(palletId, ubicacion, banda, posicion, altura) {
    const db = this.getPallets(), pallet = db.find(p => p.id === palletId);
    if (!pallet) return { ok: false, error: 'Pallet no encontrado.' };
    const ocupante = this.buscarPalletEnPosicion(ubicacion, banda, posicion, altura, db);
    if (ocupante && ocupante.id !== pallet.id) return { ok: false, error: 'La posición seleccionada está ocupada.' };
    const anterior = { ubicacion: pallet.ubicacion, banda: pallet.banda, posicion: pallet.posicion, altura: pallet.altura };
    this.asignar(db, pallet, ubicacion, banda, posicion, altura); this.savePallets(db);
    return { ok: true, pallet, anterior };
  },

  quitarDePosicion(palletId) {
    const db = this.getPallets(), p = db.find(x => x.id === palletId); if (!p || p.banda === null) return false;
    const { ubicacion, banda, posicion, altura } = p; p.banda = p.posicion = p.altura = null;
    this.compactarBandaAltura(db, ubicacion, banda, altura, posicion); this.recalcularRepetidos(db); this.savePallets(db); return true;
  },

  vaciarBanda(ubicacion, banda) {
    const db = this.getPallets(), afectados = db.filter(p => p.ubicacion === ubicacion && p.banda === banda);
    afectados.forEach(p => { p.banda = p.posicion = p.altura = null; }); this.recalcularRepetidos(db); this.savePallets(db); return afectados.length;
  },

  editarCelda(ubicacion, banda, posicion, altura, texto) {
    const db = this.getPallets(), actual = this.buscarPalletEnPosicion(ubicacion, banda, posicion, altura, db), valor = String(texto || '').trim();
    if (!valor) {
      if (actual) { const pos = actual.posicion; actual.banda = actual.posicion = actual.altura = null; this.compactarBandaAltura(db, ubicacion, banda, altura, pos); }
      this.recalcularRepetidos(db); this.savePallets(db); return { ok: true, removed: Boolean(actual) };
    }
    const objetivo = PalletModel.normalizarCodigo(valor);
    if (actual && PalletModel.normalizarCodigo(PalletModel.codigoVisual(actual)) === objetivo) return { ok: true, pallet: actual, unchanged: true };
    const existente = db.find(p => p.ubicacion === ubicacion && p.banda !== null && PalletModel.normalizarCodigo(PalletModel.codigoVisual(p)) === objetivo);
    let pallet;
    if (existente) {
      pallet = { ...existente, id: this.uid('PLT-DUP'), banda: null, posicion: null, altura: null, repetido: false };
    } else {
      const limpio = objetivo.replace(/^L/, '');
      const match = limpio.match(/^([A-ZÑ]+)(\d{1,4})$/i);
      const numero = match ? match[2].padStart(2, '0') : '';
      pallet = { id: this.uid('PLT-NUEVO'), lote: valor.toUpperCase().startsWith('L-') ? valor.toUpperCase() : `L-${valor.toUpperCase()}`, articulo: '', descripcion: 'Sin datos maestros asociados', estado: 'VERIFICACIÓN', cajas: 0, ubicacion, banda: null, posicion: null, altura: null, repetido: false, _codigo_visual_manual: match ? `${match[1].toUpperCase()}${numero}` : (limpio || '?'), numero_pallet: numero, pendiente_verificacion: true };
    }
    db.push(pallet); this.asignar(db, pallet, ubicacion, banda, posicion, altura); this.savePallets(db); return { ok: true, pallet };
  },

  fifoIds(ubicacion) {
    // FIFO siempre se calcula dentro de la cámara activa. Mezclar cámaras daba
    // prioridad a pallets ajenos al mapa que el usuario estaba consultando.
    let posicionados = this.getPallets().filter(p => p.banda !== null && p.ubicacion === ubicacion);
    posicionados.sort((a, b) => this.fechaOrden(a.fecha_fabricacion).localeCompare(this.fechaOrden(b.fecha_fabricacion)));
    return new Set(posicionados.slice(0, Math.max(1, Math.round(posicionados.length * 0.2))).map(p => p.id));
  },
  fechaOrden(v) { const [d = '99', m = '99', a = '9999'] = String(v || '').split('/'); return `${a}${m}${d}`; },

  coincideFiltro(p, ubicacion, filtro) {
    if (filtro === null) return true;
    if (ubicacion === 'PROTER' && filtro.includes(p.estado)) return true;
    if (ubicacion === 'POST TUNEL' && filtro.includes(p.articulo)) return true;
    return (p.repetido && filtro.includes('REPETIDO')) || (p.no_existe && filtro.includes('NO EXISTE'));
  },

  agregarACarga(palletId) {
    const db = this.getPallets(), p = db.find(x => x.id === palletId); if (!p) return { ok: false, error: 'Pallet no encontrado.' };
    const tab = this.cameraKey(p.ubicacion), state = this.getState();
    if (state.cargo[tab].includes(p.id) || state.manuals[tab].some(x => x.id === p.id)) return { ok: false, error: 'El pallet ya está en esta carga.' };
    if (p.banda !== null) {
      state.originals[p.id] = { mapa: tab === 'embarque' ? 'proter' : 'postunel', banda: p.banda, posicion: p.posicion, altura: p.altura };
      state.cargo[tab].push(p.id);
      const { ubicacion, banda, posicion, altura } = p; p.banda = p.posicion = p.altura = null;
      this.compactarBandaAltura(db, ubicacion, banda, altura, posicion);
    } else {
      state.manuals[tab].push({ ...p, _manual_pasillo: true });
    }
    this.recalcularRepetidos(db); this.savePallets(db); this.saveState(state); return { ok: true, tab };
  },

  agregarCodigoACarga(tab, codigo) {
    const p = this.buscarPalletGlobalPorCodigo(codigo); if (!p) return { ok: false, error: `No se encontró ningún pallet con el código "${codigo}".` };
    const esperado = tab === 'embarque' ? 'PROTER' : 'POST TUNEL';
    if (p.banda !== null && p.ubicacion !== esperado) return { ok: false, error: `El pallet pertenece a ${p.ubicacion}; agregalo desde su carga correspondiente.` };
    if (p.banda === null || p.banda === undefined) {
      const state = this.getState();
      if (state.cargo[tab].includes(p.id) || state.manuals[tab].some(x => x.id === p.id)) return { ok: false, error: 'El pallet ya está en esta carga.' };
      state.manuals[tab].push({ ...p, _manual_pasillo: true }); this.saveState(state); return { ok: true, tab, origen: 'pasillo' };
    }
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
      const ocupadas = new Set(db.filter(p => p.ubicacion === ubicacion && p.banda === origen.banda && p.altura === origen.altura && p.posicion !== null).map(p => Number(p.posicion)));
      let destino = Number(origen.posicion);
      if (ocupadas.has(destino)) {
        destino = Array.from({ length: this.maxPositions(ubicacion, origen.banda) }, (_, i) => i + 1).find(n => !ocupadas.has(n)) || null;
        aviso = destino ? `La posición original estaba ocupada: volvió a la posición ${destino}.` : 'La banda está llena: el pallet quedó sin posición.';
      }
      if (destino !== null) { pallet.banda = origen.banda; pallet.posicion = destino; pallet.altura = origen.altura; }
    }
    delete state.originals[palletId]; this.recalcularRepetidos(db); this.savePallets(db); this.saveState(state); return { ok: true, aviso };
  },

  palletsCarga(tab) {
    const state = this.getState(), db = this.getPallets();
    return db.filter(p => state.cargo[tab].includes(p.id)).concat(state.manuals[tab]);
  },

  folioPrevisto(tab) { const state = this.getState(); return `${ANDEN_PREFIJO_FOLIO[tab]}-${new Date().getFullYear()}-${String(state.counters[tab]).padStart(4, '0')}`; },

  guardarCarga(tab, datos) {
    const state = this.getState(), pallets = this.palletsCarga(tab);
    if (!pallets.length) return { ok: false, error: 'No se puede despachar una carga sin pallets.' };
    if (!String(datos.empresa || '').trim()) return { ok: false, error: 'Falta la empresa de destino.' };
    const folio = this.folioPrevisto(tab);
    const registro = { folio, pestana: tab, guardada_en: new Date().toLocaleString('es-CL'), datos: { ...datos }, pallets: pallets.map(p => ({ id: p.id, codigo: PalletModel.codigoVisual(p), lote: p.lote, articulo: p.articulo, cajas: p.cajas || 0, estado: p.estado, de_pasillo: Boolean(p._manual_pasillo), posicion_original: state.originals[p.id] || null, _snapshot: { ...p } })) };
    const loads = this.getLoads(); loads.unshift(registro); this.saveLoads(loads);
    const ids = new Set(pallets.map(p => p.id));
    const db = this.getPallets().filter(p => !ids.has(p.id)); this.savePallets(db);
    Object.keys(state.originals).forEach(id => { if (ids.has(id)) delete state.originals[id]; });
    state.cargo[tab] = []; state.manuals[tab] = []; state.forms[tab] = this.newLoadData(); state.counters[tab] += 1; this.saveState(state);
    this.aprenderDirectorio(datos);
    return { ok: true, folio, cantidad: pallets.length };
  },

  aprenderDirectorio(datos) {
    const d = this.getDirectories();
    const normalized = value => String(value || '').trim().toLowerCase();
    if (datos.empresa && !d.destinos.some(x => normalized(x.empresa) === normalized(datos.empresa) && normalized(x.domicilio) === normalized(datos.domicilio) && normalized(x.ciudad) === normalized(datos.ciudad))) {
      d.destinos.push({ id: `personalizado-${Date.now()}`, nombre: [datos.empresa, datos.ciudad].filter(Boolean).join(' – '), empresa: datos.empresa, domicilio: datos.domicilio || '', ciudad: datos.ciudad || '' });
    }
    if (datos.chofer && !d.choferes.some(x => x.nombre.toLowerCase() === datos.chofer.toLowerCase())) d.choferes.push({ nombre: datos.chofer, rut: datos.rut || '', patente_camion: datos.patente_camion || '', patente_rampla: datos.patente_rampla || '' });
    this.saveDirectories(d);
  },

  actualizarCargaHistorica(folio, cambios) {
    const loads = this.getLoads(), c = loads.find(x => x.folio === folio); if (!c) return false;
    Object.assign(c.datos, cambios); this.saveLoads(loads); return true;
  },

  quitarPalletHistorico(folio, palletId) {
    let loads = this.getLoads(); const carga = loads.find(c => c.folio === folio); if (!carga) return { ok: false };
    const entrada = carga.pallets.find(p => p.id === palletId); if (!entrada) return { ok: false };
    carga.pallets = carga.pallets.filter(p => p.id !== palletId);
    const db = this.getPallets(); let aviso = '';
    if (entrada._snapshot) {
      let pallet = db.find(p => p.id === palletId); if (!pallet) { pallet = { ...entrada._snapshot }; db.push(pallet); }
      const origen = entrada.posicion_original;
      if (origen) {
        const ubicacion = origen.mapa === 'proter' ? 'PROTER' : 'POST TUNEL';
        const ocupadas = new Set(db.filter(p => p.id !== palletId && p.ubicacion === ubicacion && p.banda === origen.banda && p.altura === origen.altura && p.posicion !== null).map(p => Number(p.posicion)));
        let destino = Number(origen.posicion);
        if (ocupadas.has(destino)) { destino = Array.from({ length: this.maxPositions(ubicacion, origen.banda) }, (_, i) => i + 1).find(n => !ocupadas.has(n)) || null; aviso = destino ? `La posición original estaba ocupada: volvió a P${destino}.` : 'La banda está llena: quedó sin posición.'; }
        pallet.ubicacion = ubicacion; pallet.banda = destino === null ? null : origen.banda; pallet.posicion = destino; pallet.altura = destino === null ? null : origen.altura;
      }
    }
    if (!carga.pallets.length) loads = loads.filter(c => c.folio !== folio);
    const final = entrada.de_pasillo || !entrada.posicion_original ? `El pallet ${entrada.codigo} de pasillo salió de la carga ${folio} y quedó sin posición.` : `El pallet ${entrada.codigo} volvió al mapa y salió de la carga ${folio}.`;
    this.recalcularRepetidos(db); this.savePallets(db); this.saveLoads(loads); return { ok: true, aviso, mensaje: aviso ? `${aviso} ${final}` : final, cargaEliminada: !carga.pallets.length };
  }
};
