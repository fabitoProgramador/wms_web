/** Reglas de negocio de Reportes Operacionales, trasladadas desde Programa MVC. */
const ReportesModel = {
  TIPOS_REPORTE: [
    'REPORTE GENERAL',
    'REPORTE DE RECHAZOS',
    'REPORTE DE PROHIBICIONES',
    'REPORTE SIN INFORMACION',
    'REPORTE DE VERIFICACIONES',
    'REPORTE SIN DM',
    'REPORTE DE REPROCESO',
    'REPORTE DE PEDIDOS',
    'REPORTE AUTORIZADOS A ENVIAR'
  ],

  ESTADO_POR_REPORTE: {
    'REPORTE DE RECHAZOS': 'RECHAZO',
    'REPORTE DE PROHIBICIONES': 'PROHIBICIONES',
    'REPORTE SIN INFORMACION': 'SIN INFORMACIÓN',
    'REPORTE DE VERIFICACIONES': 'VERIFICACIÓN',
    'REPORTE SIN DM': 'SIN DM',
    'REPORTE DE REPROCESO': 'REPROCESO',
    'REPORTE DE PEDIDOS': 'PEDIDO',
    'REPORTE AUTORIZADOS A ENVIAR': 'AUTORIZADOS A ENVIAR'
  },

  columnas() {
    return [
      { id:'lote', label:'ID LOTE', width:148, value:p=>PalletModel.idLoteReal(p) || p.lote || '—' },
      { id:'codigo_articulo', label:'N° ARTÍCULO', width:122, value:p=>PalletModel.numeroArticulo(p) },
      { id:'articulo', label:'DESCRIPCIÓN', width:220, value:p=>PalletModel.descripcion(p) },
      { id:'ubicacion', label:'ALMACÉN', width:140, value:p=>p.ubicacion || '—' },
      { id:'kilos', label:'KILOS', width:96, value:p=>PalletModel.kilos(p), numeric:true },
      { id:'cajas', label:'CAJAS', width:82, value:p=>Number(p.cajas) || 0, numeric:true },
      { id:'fecha_fabricacion', label:'FEC. FABRIC.', width:126, value:p=>p.fecha_fabricacion || '—' },
      { id:'estado_calidad', label:'EST. CALIDAD', width:132, value:p=>StockModel.normalizarEstadoCalidad(p.estado_calidad || p.est_calidad || p.calidad_estado) },
      { id:'estado', label:'ESTADO', width:170, value:p=>p.estado || '—' },
      { id:'info_calidad', label:'INFO CALIDAD', width:260, value:p=>p.info_calidad || '—' },
      { id:'info_general', label:'INFO GENERAL', width:260, value:p=>p.info_general || '—' },
      { id:'detector_metales', label:'DM', width:118, value:p=>p.detector_metales || '—' },
      { id:'reservado', label:'RESERVADO', width:105, value:p=>p.reservado || '—' },
      { id:'clasificacion_envio', label:'CLASIFICACIÓN ENVÍO', width:190, value:p=>p.clasificacion_envio || '—' }
    ];
  },

  pallets() { return StockModel.pallets(); },

  filtrarParaReporte(tipo) {
    const estado = this.ESTADO_POR_REPORTE[tipo];
    const pallets = this.pallets();
    return estado ? pallets.filter(p=>p.estado === estado) : pallets;
  },

  compilar(tipo) {
    const datos = this.filtrarParaReporte(tipo);
    return { tipo, total:datos.length, vistaPrevia:datos.slice(0,25) };
  },

  valoresUnicos(columnaId) {
    const col = this.columnas().find(x=>x.id===columnaId);
    if (!col) return [];
    return [...new Set(this.pallets().map(p=>String(col.value(p))))]
      .sort((a,b)=>a.localeCompare(b,'es',{numeric:true,sensitivity:'base'}));
  },

  filtrarStock({busqueda='',almacen='TODOS',estado='TODOS',filtrosColumnas={}}={}) {
    const q=String(busqueda).trim().toLocaleLowerCase('es-CL');
    const columnas=this.columnas();
    return this.pallets().filter(p=>{
      if (almacen!=='TODOS' && p.ubicacion!==almacen) return false;
      if (estado!=='TODOS' && p.estado!==estado) return false;
      if (q && ![p.id,p.lote,p.articulo,p.estado].some(v=>String(v||'').toLocaleLowerCase('es-CL').includes(q))) return false;
      return columnas.every(col=>{
        const activos=filtrosColumnas[col.id];
        return !activos || activos.has(String(col.value(p)));
      });
    });
  },

  filasExportacion(pallets) {
    const columnas=this.columnas();
    return [columnas.map(c=>c.label),...pallets.map(p=>columnas.map(c=>c.value(p)))];
  }
};
