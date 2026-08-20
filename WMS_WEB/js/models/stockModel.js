/** Reglas funcionales del módulo Stock, trasladadas desde Programa MVC. */
const StockModel = {
  CAPACIDAD_REFERENCIA: 1500,
  normalizarEstadoCalidad(valor) {
    const estado = String(valor || '').trim().toLocaleUpperCase('es-CL');
    if (['BLOQUEADO','BLOQUEADOS','ALERTA','RECHAZADO','RECHAZO'].includes(estado)) return 'BLOQUEADO';
    if (['LIBERADO','OK','APROBADO'].includes(estado)) return 'LIBERADO';
    return 'LIBERADO';
  },
  pallets() {
    const base = MapaModel.getPallets(), porLote = new Map();
    base.forEach(p => { const lote=String(p.lote||p.id||''); if(!porLote.has(lote)) porLote.set(lote,this.atributosSimulados(lote,p)); });
    return base.map(p => this.normalizar(p, porLote.get(String(p.lote||p.id||''))));
  },
  atributosSimulados(lote,p) {
    let h=2166136261;for(const c of String(lote)){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}const rnd=()=>((h=Math.imul(h,1664525)+1013904223>>>0)/4294967296);
    const estado=String(p.estado||'—'), alertas=new Set(['VERIFICACIÓN','SIN DM','RECHAZO','BLOQUEADOS','LOTES INCOMPLETOS']), alerta=alertas.has(estado);
    const adm=new Date(2026,6,1-Math.floor(rnd()*45+1)),fab=new Date(adm);fab.setDate(fab.getDate()-Math.floor(rnd()*9+2));
    const fecha=d=>`${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
    const ok=['Cumple estándar de calidad para exportación.','Fruta homogénea, sin defectos visibles relevantes.','Calibre y color dentro de parámetros de exportación.'];
    const warn=['Pendiente de verificación de calidad de laboratorio.','Observación de calidad registrada, requiere revisión.','Muestra con defectos menores, en evaluación.'];
    const temp=p.ubicacion==='CAMARA CERO'?(-19.5+rnd()*2):(-1+rnd()*3);
    return {fecha_admision:fecha(adm),fecha_fabricacion:fecha(fab),detector_metales:['RECHAZO','BLOQUEADOS'].includes(estado)?'RECHAZADO':'APROBADO',temperatura:`${temp.toFixed(1)} °C`,reservado:estado==='PEDIDO'?'SÍ':'NO',estado_calidad:alerta?'BLOQUEADO':'LIBERADO',calidad_estado:alerta?'ALERTA':'OK',info_calidad:(alerta?warn:ok)[Math.floor(rnd()*3)],info_general:`Lote ingresado a ${p.ubicacion||'—'}. Sin observaciones logísticas adicionales.`,info_detallada:'Pendiente: falta definir qué información va en este campo.'};
  },
  normalizar(p,simulado={}) {
    const datos = PalletModel.datosPresentacion(p);
    const cajas = Number(p.cajas) || 0;
    const estado = String(p.estado || '—');
    const articulo = String(p.articulo || '').trim();
    const alertas = new Set(['VERIFICACIÓN','SIN DM','RECHAZO','BLOQUEADOS','LOTES INCOMPLETOS']);
    const fechaAdmision = p.fecha_admision || p.fecha_ingreso || '—';
    return {
      ...datos,
      articulo,
      descripcion: PalletModel.descripcion(p),
      cajas,
      kilos_stock: PalletModel.kilos(p),
      id_lote_real: PalletModel.idLoteReal(p),
      numero_articulo: PalletModel.numeroArticulo(p),
      fecha_admision: p.fecha_admision || simulado.fecha_admision || fechaAdmision,
      fecha_fabricacion: p.fecha_fabricacion || simulado.fecha_fabricacion || '—',
      detector_metales: p.detector_metales || simulado.detector_metales || (['RECHAZO','BLOQUEADOS'].includes(estado) ? 'RECHAZADO' : 'APROBADO'),
      reservado: p.reservado || simulado.reservado || (estado === 'PEDIDO' ? 'SÍ' : 'NO'),
      estado_calidad: this.normalizarEstadoCalidad(p.estado_calidad || p.est_calidad || p.calidad_estado || simulado.estado_calidad),
      calidad_estado: p.calidad_estado || simulado.calidad_estado || (alertas.has(estado) ? 'ALERTA' : 'OK'),
      info_calidad: p.info_calidad || simulado.info_calidad || '—',
      info_general: p.info_general || simulado.info_general || '—',
      info_detallada: p.info_detallada || simulado.info_detallada || '—',
      temperatura: p.temperatura || simulado.temperatura || '—',
      codigo_visual: PalletModel.codigoVisualLegible(p)
    };
  },
  /* Los tres filtros son excluyentes entre si y se aplican antes que la
     busqueda de texto, igual que en Movimientos de Camara. */
  detalleFiltrado(texto = '', almacen = 'TODOS', estado = 'TODOS', detector = 'TODOS') {
    const q = String(texto).trim().toLocaleUpperCase('es-CL');
    return this.pallets().filter(p => {
      if (almacen !== 'TODOS' && p.ubicacion !== almacen) return false;
      if (estado !== 'TODOS' && String(p.estado || '') !== estado) return false;
      if (detector !== 'TODOS' && String(p.detector_metales || '') !== detector) return false;
      if (!q) return true;
      return [p.id, p.id_lote_real, p.lote, p.articulo, p.numero_articulo, p.estado]
        .some(v => String(v || '').toLocaleUpperCase('es-CL').includes(q));
    });
  },
  agrupar(campo) {
    const grupos = new Map();
    this.pallets().forEach(p => {
      const clave = p[campo] || '—';
      const g = grupos.get(clave) || { nombre: clave, pallets: 0, cajas: 0, kilos: 0 };
      g.pallets += 1; g.cajas += p.cajas; g.kilos += p.kilos_stock; grupos.set(clave, g);
    });
    return [...grupos.values()].sort((a,b) => b.pallets - a.pallets || String(a.nombre).localeCompare(String(b.nombre)));
  },
  resumenArticulos() { return this.agrupar('articulo').map(x => ({...x, descripcion: CATALOGO_ARTICULOS[x.nombre]?.descripcion || x.nombre, porcentaje: x.pallets / this.CAPACIDAD_REFERENCIA * 100})); },
  resumenCamaras() { return this.agrupar('ubicacion').map(x => ({...x, porcentaje: x.pallets / this.CAPACIDAD_REFERENCIA * 100})); },
  resumenEstados() { const total=this.pallets().length; return this.agrupar('estado').map(x => ({...x, porcentaje: total ? x.pallets / total * 100 : 0})); },
  pivot(almacen) {
    const rows = this.pallets().filter(p => p.ubicacion === almacen);
    const porArticulo = new Map();
    rows.filter(p => p.articulo).forEach(p => porArticulo.set(p.articulo, (porArticulo.get(p.articulo) || 0) + p.kilos_stock));
    return {
      almacen, pallets: rows.length, kilos: rows.reduce((s,p)=>s+p.kilos_stock,0), articulos: porArticulo.size,
      filas: [...porArticulo].map(([codigo,kilos]) => ({codigo, descripcion: CATALOGO_ARTICULOS[codigo]?.descripcion || codigo, kilos})).sort((a,b)=>b.kilos-a.kilos)
    };
  },
  resolverBusqueda(texto) {
    const q = String(texto || '').trim().toLocaleUpperCase('es-CL');
    if (!q) return [];
    const pallets = this.pallets();
    const loteCanon = q.replace(/^L-?/, '');
    const porLote = pallets.filter(p => {
      const interno = String(p.lote || '').trim().toLocaleUpperCase('es-CL').replace(/^L-?/, '');
      return interno === loteCanon;
    });
    if (porLote.length) return porLote;
    const codigo = q.replace(/[\s-]+/g, '').match(/^([A-ZÑ]+)(\d+)$/);
    if (!codigo) return [];
    const articulo = Object.entries(LETRAS_POR_ARTICULO).find(([,letra]) => letra === codigo[1])?.[0];
    if (!articulo) return [];
    const numero = codigo[2].padStart(2, '0');
    const encontrado = pallets.find(p => p.articulo === articulo && String(p.numero_pallet || '').padStart(2, '0') === numero);
    return encontrado ? [encontrado] : [];
  },
  agruparUbicaciones(pallets) {
    const grupos = new Map();
    pallets.forEach(p => {
      const almacen=p.ubicacion || '—', g=grupos.get(almacen)||{almacen,pallets:0,cajas:0,kilos:0,estados:new Set()};
      g.pallets++; g.cajas+=p.cajas; g.kilos+=p.kilos_stock; g.estados.add(p.estado); grupos.set(almacen,g);
    });
    return [...grupos.values()].map(g=>({...g,estados:[...g.estados].sort()})).sort((a,b)=>a.almacen.localeCompare(b.almacen));
  }
};
