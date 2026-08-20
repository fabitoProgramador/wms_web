/** Vistas web de Stock en Planta y Lote Detallado. */
const StockController = {
  tab: 'detalle', pagina: 0, buscar: '', almacen: 'TODOS', estado: 'TODOS', detector: 'TODOS', exportOpen: false,
  pivotActivos: new Set(['PROTER','POST TUNEL','CAMARA CERO']), loteResultado: null, loteTexto: '',
  /* Escape unico del proyecto: SeguridadService.escaparHtml. Antes cada
     archivo tenia el suyo y seis de ellos no escapaban comillas, lo que dejaba
     abierta la inyeccion dentro de atributos. */
  esc(v) { return SeguridadService.escaparHtml(v); },
  fmt(v){return Number(v||0).toLocaleString('es-CL');},
  badge(text,tipo=''){const color=tipo==='estado'?(COLORES_MAPA_ESTADO[text]||'#64748b'):tipo==='calidad'?(text==='BLOQUEADO'?'#ef4444':'#10b981'):tipo==='alerta'?'#f59e0b':tipo==='ok'?'#10b981':'#64748b';return `<span class="stock-badge" style="--badge-color:${color}">${this.esc(text)}</span>`;},
  initStockPlanta(container){
    this.container=container;this.tab='detalle';this.pagina=0;this.buscar='';this.almacen='TODOS';this.exportOpen=false;this.pivotActivos=new Set(['PROTER','POST TUNEL','CAMARA CERO']);this.renderStock();
  },
  /* ------------------------------------------------------------------ *
   * Desplazamiento horizontal de las franjas de pestañas y de chips.
   *
   * Las pestañas no caben a lo ancho en teléfono, así que la franja se
   * desplaza. El problema era que cada cambio de pestaña reconstruye el
   * HTML: la franja nacía de nuevo en cero y volvía al principio, de modo
   * que la pestaña recién pulsada podía quedar fuera de la vista. Se
   * guarda la posición justo antes de redibujar y se restaura después.
   * ------------------------------------------------------------------ */
  FRANJAS:'.stock-tabs,.pivot-chips',
  recordarScroll(){
    this._scrollFranjas={};
    document.querySelectorAll(this.FRANJAS).forEach(el=>{
      this._scrollFranjas[el.classList[0]]=el.scrollLeft;
    });
  },
  restaurarScroll(){
    const guardado=this._scrollFranjas||{};
    document.querySelectorAll(this.FRANJAS).forEach(el=>{
      const valor=guardado[el.classList[0]];
      if(valor) el.scrollLeft=valor;
    });
    // La pestaña activa siempre debe quedar visible. Se calcula el
    // desplazamiento a mano en vez de usar scrollIntoView, que además
    // arrastraría el scroll vertical de la pagina.
    const activa=document.querySelector('.stock-tabs button.active');
    if(!activa)return;
    const franja=activa.parentElement;
    if(franja.scrollWidth<=franja.clientWidth+1)return;
    const a=activa.getBoundingClientRect(), f=franja.getBoundingClientRect();
    if(a.left<f.left||a.right>f.right){
      franja.scrollLeft+=(a.left-f.left)-(f.width-a.width)/2;
    }
  },

  renderStock(){
    if(!this.container)return;
    this.recordarScroll();
    const tabs=[['detalle','Detalle General'],['articulo','Resumen por Artículo'],['camara','Resumen por Cámara'],['estado','Resumen por Estado'],['pivot','Tabla Dinámica Resumen']];
    this.container.innerHTML=`<section class="stock-view">${DashboardController.operationalHeader({ eyebrow:'CONTROL DE INVENTARIO', title:'Stock en Planta', status:'Inventario consolidado y distribución por almacén' })}
      <nav class="stock-tabs" aria-label="Subsecciones de Stock">${tabs.map(([id,t])=>`<button class="${this.tab===id?'active':''}" onclick="StockController.cambiarTab('${id}')">${t}</button>`).join('')}</nav>
      <div id="stockTabBody" class="stock-tab-body">${this.renderTab()}</div></section>`;
    this.restaurarScroll();
    DashboardController.startOperationalClock();
    /* Mismo tope por filas que Movimientos, Despacho y Aprobaciones: la
       lista de tarjetas es la misma (.ops-card-list). */
    OperacionesController.ajustarListas();
  },
  cambiarTab(tab){this.tab=tab;this.pagina=0;this.exportOpen=false;this.renderStock();},
  renderTab(){if(this.tab==='detalle')return this.renderDetalle();if(this.tab==='pivot')return this.renderPivot();return this.renderResumen();},
  pageSize(){return innerHeight<700?5:innerHeight<850?8:10;},
  renderDetalle(){
    const activos=[Boolean(this.buscar.trim()),this.almacen!=='TODOS',this.estado!=='TODOS',this.detector!=='TODOS'].filter(Boolean).length;
    const filas=StockModel.detalleFiltrado(this.buscar,this.almacen,this.estado,this.detector), porPagina=this.pageSize(), paginas=Math.max(1,Math.ceil(filas.length/porPagina));this.pagina=Math.min(this.pagina,paginas-1);const visibles=filas.slice(this.pagina*porPagina,(this.pagina+1)*porPagina);
    return `<div class="stock-toolbar panel-surface"><label class="stock-search"><span>Buscar</span><input id="stockSearch" class="form-control" value="${this.esc(this.buscar)}" placeholder="Lote, artículo, ID o estado" oninput="StockController.actualizarBusqueda(this.value)"></label>
      <label class="stock-filter stock-filter-almacen"><span>Filtrar Almacén</span><select class="form-control" onchange="StockController.actualizarAlmacen(this.value)"><option>TODOS</option>${ALMACENES_PIVOT.map(a=>`<option value="${this.esc(a.id)}" ${this.almacen===a.id?'selected':''}>${this.esc(a.nombre)}</option>`).join('')}</select></label>
      <label class="stock-filter stock-filter-estado"><span>Filtrar Estado Actual</span><select class="form-control" onchange="StockController.actualizarEstado(this.value)">${['TODOS',...Object.keys(COLORES_MAPA_ESTADO)].map(x=>`<option value="${this.esc(x)}" ${this.estado===x?'selected':''}>${this.esc(x)}</option>`).join('')}</select></label>
      <label class="stock-filter stock-filter-detector"><span>Filtrar Detector Metales</span><select class="form-control" onchange="StockController.actualizarDetector(this.value)">${['TODOS','APROBADO','RECHAZADO'].map(x=>`<option value="${this.esc(x)}" ${this.detector===x?'selected':''}>${this.esc(x)}</option>`).join('')}</select></label>
      <div class="stock-export"><button class="stock-action primary" onclick="StockController.toggleExport()"><i class="wi wi-upload"></i>Exportar<i class="wi wi-chevron"></i></button>${this.exportOpen?`<div class="stock-export-menu"><button onclick="StockController.copiarDetalle()"><i class="wi wi-copy"></i>Copiar todo</button><button onclick="StockController.exportarDetalle()"><i class="wi wi-sheet"></i>Exportar a Excel</button></div>`:''}</div>
      <button class="stock-action stock-clear ${activos?'has-active':''}" onclick="StockController.limpiarDetalle()" title="Restablecer búsqueda y los tres filtros"><i class="wi wi-clean"></i>Limpiar filtros${activos?`<small>${activos} activo${activos===1?'':'s'}</small>`:''}</button></div>
      <div class="stock-table-shell">${visibles.length?this.detalleCards(visibles):'<div class="ops-empty">No hay registros para los filtros seleccionados.</div>'}
      <footer class="stock-pagination"><button ${this.pagina===0?'disabled':''} onclick="StockController.irPagina(-1)">← Anterior</button><span>Página <b>${this.pagina+1}</b> de <b>${paginas}</b> · Total ${this.fmt(filas.length)}</span><button ${this.pagina>=paginas-1?'disabled':''} onclick="StockController.irPagina(1)">Siguiente →</button></footer></div>`;
  },
  /* --- Vista en tarjetas del Detalle de Stock -----------------------------
     Misma estructura que Movimientos, Despacho y Aprobaciones: la tabla de 13
     columnas obligaba a scroll horizontal y dejaba DM y RESERVA fuera de
     pantalla. Se reutiliza el sistema .ops-card (operaciones.css) para que las
     cuatro vistas se vean y se comporten igual, incluida la grilla auto-fill
     que gana columnas al plegar la barra lateral.
     Se usa .ops-badge (no .stock-badge) porque las reglas de tamano y de
     ajuste de texto de la tarjeta estan escritas sobre esa clase.
     toggleCard() y auditBlock() se toman de OperacionesController a proposito:
     una sola implementacion para las cuatro vistas. */
  opsBadge(text,tipo=''){const color=tipo==='estado'?(COLORES_MAPA_ESTADO[text]||'#64748b'):tipo==='calidad'?(text==='BLOQUEADO'?'#ef4444':'#10b981'):tipo==='alerta'?'#f59e0b':tipo==='ok'?'#10b981':'#64748b';return `<span class="ops-badge" style="--badge:${color}">${this.esc(text)}</span>`;},
  notaTexto(titulo,texto){const v=this.esc(texto??'—');return `<button class="cell-text" title="${v}" data-value="${v}" onclick="StockController.abrirTexto('${titulo}',this.dataset.value)">${v}</button>`;},
  detalleCards(items){
    return `<div id="stockCards" class="ops-card-list">${items.map(p=>`
      <article class="ops-card${OperacionesController.orderFlagClass(p)}" onclick="OperacionesController.toggleCard(this,event)">
        <div class="ops-card-head">
          <div class="ops-card-id"><b>${this.esc(p.id_lote_real)}</b><small>${this.esc(p.numero_articulo)} · ${this.esc(p.descripcion)}</small></div>
          <div class="ops-card-flag">${this.opsBadge(p.estado_calidad,'calidad')}</div>
          <button type="button" class="ops-card-toggle" aria-expanded="false" aria-label="Ver auditoría y detalle del lote ${this.esc(p.id_lote_real)}"><i></i></button>
        </div>
        <div class="ops-card-metrics">
          <div><small>KILOS</small><span><b class="kilos">${this.fmt(p.kilos_stock)}</b></span></div>
          <div><small>CAJAS</small><span>${this.fmt(p.cajas)}</span></div>
          <div><small>FEC. FABRIC.</small><span>${this.esc(p.fecha_fabricacion)}</span></div>
          <div><small>ESTADO</small><span>${this.opsBadge(p.estado,'estado')}</span></div>
        </div>
        ${OperacionesController.orderDelay(p)}
        <div class="ops-card-notes">
          <div><small>INFO CALIDAD</small><span>${this.notaTexto('Info Calidad',p.info_calidad)}</span></div>
          <div><small>INFO GENERAL</small><span>${this.notaTexto('Info General',p.info_general)}</span></div>
        </div>
        <div class="ops-card-detail"><div class="ops-card-more">
          <div class="ops-card-kv">
            <div><small>DETECTOR METALES</small><span>${this.opsBadge(p.detector_metales,p.detector_metales==='APROBADO'?'ok':'alerta')}</span></div>
            <div><small>RESERVADO</small><span>${this.opsBadge(p.reservado,p.reservado==='SÍ'?'alerta':'')}</span></div>
            <div><small>ALMACÉN</small><span>${this.esc(p.ubicacion)}</span></div>
          </div>
          ${OperacionesController.auditBlock(p)}
        </div></div>
      </article>`).join('')}</div>`;
  },
  actualizarBusqueda(v){this.buscar=v;this.pagina=0;this.actualizarTabBody();requestAnimationFrame(()=>{const el=document.getElementById('stockSearch');if(el){el.focus();el.setSelectionRange(el.value.length,el.value.length);}});}, actualizarAlmacen(v){this.almacen=v;this.pagina=0;this.actualizarTabBody();}, actualizarEstado(v){this.estado=v;this.pagina=0;this.actualizarTabBody();}, actualizarDetector(v){this.detector=v;this.pagina=0;this.actualizarTabBody();}, irPagina(d){this.pagina+=d;this.actualizarTabBody();},
  limpiarDetalle(){this.buscar='';this.almacen='TODOS';this.estado='TODOS';this.detector='TODOS';this.pagina=0;this.exportOpen=false;this.actualizarTabBody();requestAnimationFrame(()=>document.getElementById('stockSearch')?.focus());this.toast('Filtros de stock eliminados.','info');},toggleExport(){this.exportOpen=!this.exportOpen;this.actualizarTabBody();},
  // Los chips de la Tabla Dinamica viven dentro del cuerpo, asi que este
  // repintado tambien los recreaba en cero: se conserva su posicion igual.
  actualizarTabBody(){const body=document.getElementById('stockTabBody');if(!body)return;this.recordarScroll();body.innerHTML=this.renderTab();this.restaurarScroll();},
  resumenConfig(){return this.tab==='articulo'?{tipo:'articulo',titulo:'Resumen por Artículo',sub:'Agrupación completa del stock por producto.',rows:StockModel.resumenArticulos(),cols:['ARTÍCULO','DESCRIPCIÓN','PALLETS','CAJAS','KILOS','% OCUPACIÓN (PLT)']} : this.tab==='camara'?{tipo:'camara',titulo:'Resumen por Cámara',sub:'Existencias agrupadas por ubicación física.',rows:StockModel.resumenCamaras(),cols:['CÁMARA / ALMACÉN','PALLETS','CAJAS','KILOS','% OCUPACIÓN CÁMARA']}:{tipo:'estado',titulo:'Resumen por Estado',sub:'Distribución del stock por estado operacional.',rows:StockModel.resumenEstados(),cols:['ESTADO','PALLETS','CAJAS','KILOS','% DEL STOCK TOTAL']};},
  resumenColor(tipo,nombre){if(tipo==='estado')return COLORES_MAPA_ESTADO[nombre]||'#64748b';if(tipo==='camara')return ALMACENES_PIVOT.find(x=>x.id===nombre)?.color||'#38bdf8';return '#06b6d4';},
  resumenIdentidad(c,r){const color=this.resumenColor(c.tipo,r.nombre);if(c.tipo==='estado')return `<span class="summary-identity state"><i style="--summary-color:${color}"></i><span>${this.opsBadge(r.nombre,'estado')}</span></span>`;if(c.tipo==='camara')return `<span class="summary-identity camera"><i style="--summary-color:${color}"></i><span><b>${this.esc(r.nombre)}</b></span></span>`;return `<span class="summary-identity article"><i style="--summary-color:${color}"></i><span><b class="summary-code">${this.esc(r.nombre)}</b><em title="${this.esc(r.descripcion)}">${this.esc(r.descripcion)}</em></span></span>`;},
  /* --- Resumenes por Articulo / Camara / Estado en tarjetas ---------------
     Antes eran una tabla (min-width:720px) que en movil se doblaba a fuerza
     de data-label y celdas re-posicionadas: metricas pegadas a los bordes,
     rotulos de .47rem y la barra de porcentaje partida en dos extremos.
     Ahora es una grilla auto-fill de tarjetas, la misma que usan las seis
     vistas de pallets, asi que responde por ancho disponible y no por punto
     de quiebre: 1 columna en telefono, 2 en tablet y 3-4 en PC.
     Las tres pestanas comparten estructura y solo cambian identidad y
     rotulo de la barra, que ya devolvia resumenConfig(). */
  resumenMetricaCard(label,value,tone=''){return `<div class="${tone}"><small>${label}</small><span>${this.fmt(value)}</span></div>`;},
  resumenCard(c,r){
    const color=this.resumenColor(c.tipo,r.nombre);
    const raw=Number(r.porcentaje)||0,value=Math.max(0,Math.min(100,raw));
    const label=c.tipo==='estado'?'del stock total':c.tipo==='camara'?'ocupación cámara':'ocupación pallets';
    return `<article class="summary-card ${c.tipo}" style="--summary-color:${color}">
      <div class="summary-card-head">${this.resumenIdentidad(c,r)}</div>
      <div class="summary-card-metrics">
        ${this.resumenMetricaCard('PALLETS',r.pallets,'pallets')}
        ${this.resumenMetricaCard('CAJAS',r.cajas)}
        ${this.resumenMetricaCard('KILOS',r.kilos,'weight')}
      </div>
      <div class="summary-card-bar">
        <div class="summary-card-pct"><b>${raw.toFixed(1)}</b><em>%</em><small>${label}</small></div>
        <div class="summary-card-track" role="progressbar" aria-label="${this.esc(label)}: ${raw.toFixed(1)} por ciento" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${value.toFixed(1)}"><i style="width:${value.toFixed(1)}%"></i></div>
      </div>
    </article>`;
  },
  renderResumen(){const c=this.resumenConfig();return `<section class="stock-summary stock-summary-modern panel-surface ${c.tipo}"><header class="stock-summary-heading"><div><span class="summary-eyebrow">VISTA CONSOLIDADA</span><h2>${c.titulo}</h2><p>${c.sub}</p></div><span class="summary-group-count"><b>${this.fmt(c.rows.length)}</b> ${c.rows.length===1?'agrupación':'agrupaciones'}</span></header><div class="summary-card-list">${c.rows.map(r=>this.resumenCard(c,r)).join('')||'<div class="ops-empty">Sin datos para construir este resumen.</div>'}</div></section>`;},
  renderPivot(){const almacenes=['PROTER','POST TUNEL','CAMARA CERO'];return `<section class="pivot-view"><div class="pivot-toolbar panel-surface"><div><h2>Tabla Dinámica Resumen</h2><p>Activa o desactiva las cámaras para comparar su stock por artículo.</p></div><div class="pivot-chips">${almacenes.map(id=>`<button class="${this.pivotActivos.has(id)?'active':''}" onclick="StockController.togglePivot('${id}')">${this.esc(id)}</button>`).join('')}</div></div><div class="pivot-grid">${almacenes.filter(id=>this.pivotActivos.has(id)).map(id=>this.pivotCard(id)).join('')||'<div class="stock-empty panel-surface">Selecciona al menos una cámara para construir el resumen.</div>'}</div></section>`;},
  togglePivot(id){this.pivotActivos.has(id)?this.pivotActivos.delete(id):this.pivotActivos.add(id);this.actualizarTabBody();},
  pivotCard(id){const d=StockModel.pivot(id),a=ALMACENES_PIVOT.find(x=>x.id===id);return `<article class="pivot-card panel-surface" style="--camera:${a?.color||'#64748b'}"><header><div><h3>${this.esc(a?.nombre||id)}</h3><small>${a?.sap?`SAP ${this.esc(a.sap)}`:'Sin código SAP'}</small></div><strong>${this.fmt(d.kilos)} kg</strong></header><div class="pivot-kpis"><span><b>${this.fmt(d.pallets)}</b> Pallets</span><span><b>${this.fmt(d.articulos)}</b> Artículos</span></div><div class="stock-table-scroll"><table class="stock-table mini"><colgroup><col class="pivot-code-col"><col class="pivot-article-col"><col class="pivot-kilos-col"></colgroup><thead><tr><th>CÓDIGO</th><th>ARTÍCULO</th><th>KILOS</th></tr></thead><tbody>${d.filas.map(x=>`<tr><td class="pivot-ellipsis pivot-code" title="${this.esc(x.codigo)}">${this.esc(x.codigo)}</td><td class="pivot-ellipsis" title="${this.esc(x.descripcion)}">${this.esc(x.descripcion)}</td><td class="stock-kilos" title="${this.fmt(x.kilos)} kg">${this.fmt(x.kilos)}</td></tr>`).join('')||'<tr><td colspan="3" class="stock-empty">Sin stock registrado</td></tr>'}</tbody></table></div></article>`;},
  exportRows(){return StockModel.detalleFiltrado(this.buscar,this.almacen,this.estado,this.detector);},
  tablaTexto(rows){const head=['LOTE','N° ARTÍCULO','DESCRIPCIÓN','ALMACÉN','KILOS','CAJAS','FEC. FABRIC.','EST. CALIDAD','ESTADO','INFO CALIDAD','INFO GENERAL','DM','RESERVA'];const body=rows.map(p=>[p.id_lote_real,p.numero_articulo,p.descripcion,p.ubicacion,p.kilos_stock,p.cajas,p.fecha_fabricacion,p.estado_calidad,p.estado,p.info_calidad,p.info_general,p.detector_metales,p.reservado]);return [head,...body];},
  async copiarDetalle(){const data=this.exportRows();if(!data.length){this.exportOpen=false;this.actualizarTabBody();return this.toast('No hay registros para copiar con los filtros actuales.','warning');}const text=this.tablaTexto(data).map(r=>r.join('\t')).join('\n');try{await navigator.clipboard.writeText(text);this.toast('Stock filtrado copiado al portapapeles.');}catch(_){const ta=document.createElement('textarea');ta.value=text;document.body.append(ta);ta.select();document.execCommand('copy');ta.remove();this.toast('Stock filtrado copiado al portapapeles.');}this.exportOpen=false;this.actualizarTabBody();},
  exportarDetalle(){const data=this.exportRows();if(!data.length){this.exportOpen=false;this.actualizarTabBody();return this.toast('No hay registros para exportar con los filtros actuales.','warning');}const xmlValue=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');const rows=this.tablaTexto(data).map((r,i)=>`<Row>${r.map(v=>`<Cell><Data ss:Type="${i&&typeof v==='number'?'Number':'String'}">${xmlValue(v)}</Data></Cell>`).join('')}</Row>`).join('');const libro=`<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Stock en Planta"><Table>${rows}</Table></Worksheet></Workbook>`;const blob=new Blob([libro],{type:'application/vnd.ms-excel;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`Stock_Planta_Parral_${new Date().toISOString().slice(0,10)}.xls`;a.click();setTimeout(()=>URL.revokeObjectURL(url),0);this.exportOpen=false;this.actualizarTabBody();this.toast('Exportación Excel generada con todos los registros filtrados.');},
  initLoteDetallado(container){this.container=container;this.loteResultado=null;this.loteTexto='';this.renderLote();},
  renderLote(){this.container.innerHTML=`<section class="stock-view lote-view">${DashboardController.operationalHeader({ eyebrow:'CONSULTA DE INVENTARIO', title:'Lote Detallado', status:'Búsqueda de lotes y ubicaciones en tiempo real' })}
    <form class="lote-search panel-surface" onsubmit="StockController.buscarLote(event)"><label><span>N° de Lote o código (letra+N°)</span><input id="loteSearchInput" class="form-control" value="${this.esc(this.loteTexto)}" placeholder="Ej: L-9042, 9042 o A01"></label><button class="stock-action primary" type="submit">🔍 Buscar</button><button class="stock-action" type="button" onclick="StockController.limpiarLote()">🧹 Limpiar</button></form><div id="loteResult">${this.renderLoteResultado()}</div></section>`;DashboardController.startOperationalClock();},
  buscarLote(e){e?.preventDefault();const input=document.getElementById('loteSearchInput');this.loteTexto=input?.value||'';if(!this.loteTexto.trim()){this.loteResultado=null;document.getElementById('loteResult').innerHTML=this.renderLoteResultado();this.toast('Ingresá un número de lote o código de pallet.','warning');input?.focus();return;}this.loteResultado=StockModel.resolverBusqueda(this.loteTexto);document.getElementById('loteResult').innerHTML=this.renderLoteResultado();if(!this.loteResultado.length){this.toast(`No se encontró “${this.loteTexto.trim()}”. Verificá el código ingresado.`,'error');input?.focus();}else this.toast(`${this.loteResultado.length} pallet${this.loteResultado.length===1?'':'s'} encontrado${this.loteResultado.length===1?'':'s'}.`,'success');},
  limpiarLote(){this.loteTexto='';this.loteResultado=null;document.getElementById('loteResult').innerHTML=this.renderLoteResultado();document.getElementById('stockModal')?.remove();const input=document.getElementById('loteSearchInput');if(input){input.value='';input.focus();}this.toast('Búsqueda limpia.','info');},
  renderLoteResultado(){if(this.loteResultado===null)return `<div class="lote-empty panel-surface"><span>🔎</span><b>Ingresa un N° de lote y presiona Buscar</b><p>La búsqueda es exacta: usa el lote completo o un código de pallet.</p></div>`;if(!this.loteResultado.length)return `<div class="lote-empty warning panel-surface"><span>⚠️</span><b>No se encontró el lote “${this.esc(this.loteTexto.trim())}”</b><p>Verifica que el código esté completo y sin espacios extra.</p></div>`;return this.fichaLote(this.loteResultado);},
  fichaLote(ps){const ref=ps[0],ub=StockModel.agruparUbicaciones(ps),cajas=ps.reduce((s,p)=>s+p.cajas,0),kilos=cajas*12,estados=[...new Set(ps.map(p=>p.estado))].sort(),arts=[...new Set(ps.map(p=>p.articulo))].sort();const campos=[['N° de artículo',arts.map(a=>ps.find(p=>p.articulo===a)?.numero_articulo||a).join(', ')],['Descripción del artículo',arts.map(a=>CATALOGO_ARTICULOS[a]?.descripcion||a).join(', ')],['Ubicación',ub.map(x=>x.almacen).join(', ')],['Fecha de admisión',ref.fecha_admision],['Fecha de fabricación',ref.fecha_fabricacion],['N° de pallet',ps.map(p=>p.numero_pallet||'—').join(', ')],['Cantidad por lote (cajas)',this.fmt(cajas)],['Detector de metales',ref.detector_metales],['Temperatura',ref.temperatura],['Id Lote (real)',ref.id_lote_real],['Código',ref.codigo_visual]];return `<div class="lote-result"><article class="lote-hero panel-surface"><div class="lote-identity"><h2>📦 Lote ${this.esc(ref.id_lote_real)}</h2><p>${this.esc(arts.map(a=>CATALOGO_ARTICULOS[a]?.descripcion||a).join(', '))}</p></div><div class="lote-mini"><span><b>${this.fmt(kilos)} kg</b><small>Kilos totales</small></span><span><b>${this.fmt(cajas)}</b><small>Cajas totales</small></span><span><b>${ub.length}</b><small>Ubicaciones</small></span></div><div class="lote-states">${estados.map(x=>this.badge(x,'estado')).join('')}</div></article>${ub.length>1?`<div class="lote-duplicate">⚠️ Este lote está repartido en ${ub.length} ubicaciones distintas: ${ub.map(x=>this.esc(x.almacen)).join(', ')}</div>`:''}
      ${this.infoLote('🔬',`Info calidad · ${ref.calidad_estado}`,ref.info_calidad,ref.calidad_estado==='OK'?'#10b981':'#f59e0b')}${this.infoLote('📝','Info general',ref.info_general,'#38bdf8')}${this.infoLote('🗂️','Info detallada',ref.info_detallada,'#a855f7')}
      <article class="lote-details panel-surface"><h3>📋 Información adicional del lote</h3><div class="lote-fields">${campos.map(([a,b])=>`<div><small>${a}</small><b>${this.esc(b)}</b></div>`).join('')}<div><small>Reservado</small>${this.badge(ref.reservado,ref.reservado==='SÍ'?'alerta':'')}</div></div></article><button class="stock-action location" onclick="StockController.abrirUbicaciones()">📍 Ver ubicaciones</button></div>`;},
  infoLote(icon,titulo,texto,color){return `<article class="lote-info panel-surface" style="--info:${color}"><i></i><span>${icon}</span><div><b>${this.esc(titulo)}</b><p>${this.esc(texto)}</p></div></article>`;},
  abrirUbicaciones(){const ps=this.loteResultado||[],ub=StockModel.agruparUbicaciones(ps),codigo=ps[0]?.id_lote_real||'';this.modal(`<header><h2>📍 Lote ${this.esc(codigo)} — detalle por ubicación</h2><button onclick="StockController.cerrarModal()">×</button></header>${ub.length>1?`<div class="lote-duplicate">⚠️ Lote repartido en ${ub.length} ubicaciones — revisar posible duplicidad.</div>`:''}<div class="locations">${ub.map(u=>{const a=ALMACENES_PIVOT.find(x=>x.id===u.almacen);return `<article style="--camera:${a?.color||'#64748b'}"><header><b>${this.esc(a?.nombre||u.almacen)}</b><strong>${this.fmt(u.kilos)} kg</strong></header><p>📦 ${this.fmt(u.cajas)} cajas</p><small>Estado(s): ${u.estados.map(x=>this.esc(x)).join(', ')}</small></article>`}).join('')}</div><footer>Total repartido en ${ub.length} ${ub.length===1?'almacén':'almacenes'} <b>${this.fmt(ub.reduce((s,u)=>s+u.cajas,0))} cajas · ${this.fmt(ub.reduce((s,u)=>s+u.kilos,0))} kg</b></footer>`,'locations-modal');},
  abrirTexto(titulo,texto){this.modal(`<header><h2>${this.esc(titulo)}</h2><button onclick="StockController.cerrarModal()">×</button></header><p class="modal-copy">${this.esc(texto)}</p>`);},
  modal(html,clase=''){document.getElementById('stockModal')?.remove();document.body.insertAdjacentHTML('beforeend',`<div id="stockModal" class="stock-modal-backdrop" onclick="if(event.target===this)StockController.cerrarModal()"><section class="stock-modal ${clase}">${html}</section></div>`);},cerrarModal(){document.getElementById('stockModal')?.remove();},
  toast(text,type='success'){return NotificationService.show(text,{type});}
};
