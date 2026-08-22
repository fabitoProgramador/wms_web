/**
 * Fachada de presentación para consumidores legacy que todavía necesitan una
 * lista síncrona de pallets. No es una base de datos ni genera atributos.
 *
 * La fuente es exclusivamente el snapshot backend confirmado en MapaModel.
 * Las vistas Stock productivas usan sus modelos RPC dedicados.
 */
const StockModel = {
  CAPACIDAD_REFERENCIA: 1500,

  normalizarEstadoCalidad(valor) {
    const estado = String(valor || '').trim().toLocaleUpperCase('es-CL');
    if (['BLOQUEADO','BLOQUEADOS','ALERTA','RECHAZADO','RECHAZO'].includes(estado)) return 'BLOQUEADO';
    if (['LIBERADO','OK','APROBADO'].includes(estado)) return 'LIBERADO';
    return estado || 'SIN INFORMACIÓN';
  },

  origenBackend(p) { return Boolean(p?._backend_catalog || p?._backend_proter || p?._backend_postunel); },

  pallets() {
    if (typeof MapaModel === 'undefined') return [];
    const rows = MapaModel.getPallets().filter(p => this.origenBackend(p));
    const catalog = rows.filter(p => p._backend_catalog);
    const source = catalog.length ? catalog : rows;
    const byLot = new Map();
    source.forEach(p => {
      const id = String(p.id_lote_real || p.lote || '').trim();
      if (id && !byLot.has(id)) byLot.set(id, this.normalizar(p));
    });
    return [...byLot.values()];
  },

  normalizar(p = {}) {
    const idLote = String(p.id_lote_real || p.lote || '').trim();
    const articulo = String(p.articulo || idLote.slice(4, 9) || '').slice(-5);
    const kilos = p.kilos_logicos ?? p.kilos ?? null;
    const cajas = p.cajas_logicas ?? p.cajas ?? null;
    return {
      ...p,
      id: p.id || `CAT-${idLote}`,
      id_lote_real: idLote,
      lote: idLote,
      articulo,
      numero_articulo: p.numero_articulo || '',
      numero_pallet: p.numero_pallet || idLote.slice(9),
      descripcion: p.descripcion || 'Sin descripción SAP disponible',
      cajas,
      kilos_stock: kilos,
      kilos,
      fecha_admision: p.fecha_admision || p.fecha_recepcion || null,
      fecha_fabricacion: p.fecha_fabricacion || null,
      detector_metales: p.detector_metales ?? null,
      reservado: p.reservado ?? null,
      estado_calidad: this.normalizarEstadoCalidad(p.calidad_estado || p.estado_sap),
      calidad_estado: p.calidad_estado || p.estado_sap || null,
      info_calidad: p.info_calidad ?? null,
      info_general: p.info_general ?? null,
      temperatura: p.temperatura ?? null,
      codigo_visual: p.codigo_visual_legible_backend || p.codigo_visual_backend || p._codigo_visual_manual || idLote,
      ubicacion: p.almacen_sap || p.ubicacion || null,
      fuente: 'BACKEND_SNAPSHOT'
    };
  },

  detalleFiltrado(texto = '', almacen = 'TODOS', estado = 'TODOS', detector = 'TODOS') {
    const q = String(texto || '').trim().toLocaleUpperCase('es-CL');
    return this.pallets().filter(p => {
      if (almacen !== 'TODOS' && String(p.ubicacion || '') !== almacen) return false;
      if (estado !== 'TODOS' && String(p.estado || '') !== estado) return false;
      if (detector !== 'TODOS' && String(p.detector_metales || '') !== detector) return false;
      if (!q) return true;
      return [p.id_lote_real, p.articulo, p.numero_articulo, p.descripcion, p.estado, p.ubicacion]
        .some(v => String(v || '').toLocaleUpperCase('es-CL').includes(q));
    });
  },

  agrupar(campo) {
    const grupos = new Map();
    this.pallets().forEach(p => {
      const clave = p[campo] || '—';
      const g = grupos.get(clave) || { nombre: clave, pallets: 0, cajas: 0, kilos: 0 };
      g.pallets += 1;
      g.cajas += Number(p.cajas || 0);
      g.kilos += Number(p.kilos_stock || 0);
      grupos.set(clave, g);
    });
    return [...grupos.values()].sort((a,b) => b.pallets - a.pallets || String(a.nombre).localeCompare(String(b.nombre)));
  },

  resumenArticulos() { return this.agrupar('articulo').map(x => ({ ...x, descripcion: x.nombre, porcentaje: x.pallets / this.CAPACIDAD_REFERENCIA * 100 })); },
  resumenCamaras() { return this.agrupar('ubicacion').map(x => ({ ...x, porcentaje: x.pallets / this.CAPACIDAD_REFERENCIA * 100 })); },
  resumenEstados() { const total=this.pallets().length; return this.agrupar('estado').map(x => ({...x, porcentaje: total ? x.pallets / total * 100 : 0})); },

  resolverBusqueda(texto) {
    const raw = String(texto || '').trim().toUpperCase();
    if (!raw) return [];
    const flat = PalletModel.normalizarCodigo(raw);
    return this.pallets().filter(p => {
      const keys = PalletModel.clavesDeBusqueda(p);
      return keys.has(raw) || keys.has(flat);
    });
  },

  agruparUbicaciones(pallets) {
    const grupos = new Map();
    (pallets || []).forEach(p => {
      const almacen=p.ubicacion || '—', g=grupos.get(almacen)||{almacen,pallets:0,cajas:0,kilos:0,estados:new Set()};
      g.pallets++; g.cajas+=Number(p.cajas||0); g.kilos+=Number(p.kilos_stock||0); if(p.estado)g.estados.add(p.estado); grupos.set(almacen,g);
    });
    return [...grupos.values()].map(g=>({...g,estados:[...g.estados].sort()})).sort((a,b)=>a.almacen.localeCompare(b.almacen));
  }
};
