/** Controlador web de las dos subsecciones originales de Reportes Operacionales. */
const ReportesController = {
  container:null, reportType:'REPORTE GENERAL', compiled:null,
  query:'', warehouse:'TODOS', state:'TODOS', columnFilters:{}, page:0,
  exportOpen:false, columnMenuOpen:false, filterModal:null, textModal:null, toastTimer:null,

  /* Escape unico del proyecto: SeguridadService.escaparHtml. Antes cada
     archivo tenia el suyo y seis de ellos no escapaban comillas, lo que dejaba
     abierta la inyeccion dentro de atributos. */
  esc(v) { return SeguridadService.escaparHtml(v); },
  fmt(v){return Number(v||0).toLocaleString('es-CL');},
  pageSize(){const h=window.innerHeight||800;if(h>=950)return 15;if(h>=800)return 12;if(h>=680)return 9;return 7;},
  ensureResize(){if(this._resizeBound)return;let timer;window.addEventListener('resize',()=>{clearTimeout(timer);timer=setTimeout(()=>{if(AppController.activeView==='visualizar_stock'&&this.container)this.renderVisualizarStock();},100);});this._resizeBound=true;},
  warehouses(){return ['TODOS',...ALMACENES_PIVOT.map(x=>x.id)];},
  states(){return ['TODOS',...Object.keys(COLORES_MAPA_ESTADO)];},
  badge(value,type='state'){
    const cls=type==='detector'?(value==='RECHAZADO'?'danger':'success'):type==='reserve'?(value==='SÍ'?'warning':'muted'):type==='quality'?(value==='BLOQUEADO'?'danger':'success'):'state';
    const style=type==='state'?` style="--report-badge:${COLORES_MAPA_ESTADO[value]||'#64748b'}"`:'';
    return `<span class="report-badge ${cls}"${style}>${this.esc(value)}</span>`;
  },

  initGenerarReporte(container){this.ensureResize();this.container=container;this.reportType='REPORTE GENERAL';this.compiled=null;this.renderGenerarReporte();},
  renderGenerarReporte(){
    this.container.innerHTML=`<section class="reports-view report-compiler-view">
      ${DashboardController.operationalHeader({ eyebrow:'REPORTES OPERACIONALES', title:'Generar Reporte', status:'Compilación gerencial de la operación' })}
      <div class="report-compiler-toolbar panel-surface">
        <label><span>Seleccione el Reporte Requerido</span><select id="reportType" class="form-control" onchange="ReportesController.reportType=this.value">${ReportesModel.TIPOS_REPORTE.map(x=>`<option ${x===this.reportType?'selected':''}>${this.esc(x)}</option>`).join('')}</select></label>
        <button class="report-primary" onclick="ReportesController.compileReport()"><i class="wi wi-chart"></i>COMPILAR INFORME</button>
      </div>
      <div class="report-preview-label">VISTA PREVIA DEL DOCUMENTO COMPILADO</div>
      <div class="report-preview panel-surface" aria-live="polite">${this.renderReportPreview()}</div>
    </section>`;
    DashboardController.startOperationalClock();
  },
  compileReport(){this.reportType=document.getElementById('reportType')?.value||this.reportType;this.compiled=ReportesModel.compilar(this.reportType);this.renderGenerarReporte();},
  renderReportPreview(){
    if(!this.compiled)return `<div class="report-empty"><span>📋</span><p>Seleccione un criterio arriba y presione “Compilar” para procesar.</p></div>`;
    const user=UserModel.getCurrentUser()||{};
    const issued=new Date().toLocaleString('es-CL',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
    const head=`<header class="compiled-head"><div><span>DOCUMENTO</span><strong>${this.esc(this.compiled.tipo)}</strong></div><p>Emitido por: ${this.esc(user.name||'Usuario WMS')} <i></i> Fecha: ${this.esc(issued)} <i></i> Origen: Planta Parral</p></header>`;
    if(!this.compiled.total)return `${head}<div class="report-empty warning"><span>⚠️</span><p>No se registran movimientos ni stock para este filtro específico en este momento.</p></div>`;
    return `${head}<div class="compiled-meta"><b>${this.fmt(this.compiled.total)} registros encontrados</b><span>Vista previa: primeros ${this.compiled.vistaPrevia.length}</span></div><div class="compiled-list">${this.compiled.vistaPrevia.map(p=>`<article><code>• PALLET: ${this.esc(p.id)}</code><span>LOTE: ${this.esc(p.lote)} | ${this.esc(p.articulo)}</span><em>${this.badge(p.estado)}</em><b>${this.fmt(PalletModel.kilos(p))} kg <small>(${this.fmt(p.cajas)} Cjs)</small></b></article>`).join('')}</div>`;
  },

  initVisualizarStock(container){this.ensureResize();this.container=container;this.query='';this.warehouse='TODOS';this.state='TODOS';this.page=0;this.exportOpen=false;this.renderVisualizarStock();},
  criteria(){return {busqueda:this.query,almacen:this.warehouse,estado:this.state,filtrosColumnas:this.columnFilters};},
  filtered(){return ReportesModel.filtrarStock(this.criteria());},
  updateSearch(value){this.query=value;this.page=0;this.renderVisualizarStock();this.restoreSearchFocus();},
  updateWarehouse(value){this.warehouse=value;this.page=0;this.renderVisualizarStock();},
  updateState(value){this.state=value;this.page=0;this.renderVisualizarStock();},
  restoreSearchFocus(){const el=document.getElementById('reportSearch');if(el){el.focus();el.setSelectionRange(el.value.length,el.value.length);}},
  changePage(delta){this.page+=delta;this.renderVisualizarStock();document.querySelector('.report-table-scroll')?.scrollTo({left:0,top:0});},
  toggleExport(){this.exportOpen=!this.exportOpen;this.columnMenuOpen=false;this.renderVisualizarStock();},
  /* Los filtros por columna vivian en los <th> de la tabla. Al pasar a
     tarjetas ya no hay cabeceras, asi que se exponen en este menu: misma
     funcion openColumnFilter() y el mismo modal de siempre. */
  toggleColumnMenu(){this.columnMenuOpen=!this.columnMenuOpen;this.exportOpen=false;this.renderVisualizarStock();},
  clearColumnFilters(){this.query='';this.warehouse='TODOS';this.state='TODOS';this.columnFilters={};this.filterModal=null;this.exportOpen=false;this.columnMenuOpen=false;this.page=0;this.renderVisualizarStock();requestAnimationFrame(()=>document.getElementById('reportSearch')?.focus());this.toast('Búsqueda y filtros eliminados.','info');},

  renderVisualizarStock(){
    const data=this.filtered(),size=this.pageSize(),pages=Math.max(1,Math.ceil(data.length/size));this.page=Math.max(0,Math.min(this.page,pages-1));
    const visible=data.slice(this.page*size,this.page*size+size),cols=ReportesModel.columnas(),activeFilterCount=[Boolean(this.query.trim()),this.warehouse!=='TODOS',this.state!=='TODOS'].filter(Boolean).length+Object.keys(this.columnFilters).length;
    this.container.innerHTML=`<section class="reports-view report-stock-view">
      ${DashboardController.operationalHeader({ eyebrow:'CONSULTA OPERACIONAL', title:'Visualizar Stock', status:'Inventario detallado con filtros y exportación' })}
      <div class="report-filterbar panel-surface">
        <label class="report-search"><span>Buscar por Lote, Artículo, ID o Estado</span><input id="reportSearch" class="form-control" value="${this.esc(this.query)}" placeholder="Escriba para buscar..." oninput="ReportesController.updateSearch(this.value)"></label>
        <label><span>Filtrar Almacén</span><select class="form-control" onchange="ReportesController.updateWarehouse(this.value)">${this.warehouses().map(x=>`<option value="${this.esc(x)}" ${x===this.warehouse?'selected':''}>${this.esc(x)}</option>`).join('')}</select></label>
        <label><span>Filtrar Estado</span><select class="form-control" onchange="ReportesController.updateState(this.value)">${this.states().map(x=>`<option value="${this.esc(x)}" ${x===this.state?'selected':''}>${this.esc(x)}</option>`).join('')}</select></label>
        <div class="report-export-wrap"><button class="report-export-button" aria-expanded="${this.exportOpen}" onclick="ReportesController.toggleExport()"><i class="wi wi-upload"></i>EXPORTAR <i class="wi wi-chevron"></i></button>${this.exportOpen?`<div class="report-export-menu"><button onclick="ReportesController.copyAll()"><i class="wi wi-copy"></i>Copiar todo</button><button onclick="ReportesController.exportExcel()"><i class="wi wi-sheet"></i>Exportar a Excel</button></div>`:''}</div>
        <button class="report-clear ${activeFilterCount?'has-active':''}" onclick="ReportesController.clearColumnFilters()" ${activeFilterCount?'':'disabled'} title="Restablecer búsqueda y todos los filtros"><span>🧹</span><b>Limpiar filtros</b>${activeFilterCount?`<small>${activeFilterCount} activo${activeFilterCount===1?'':'s'}</small>`:''}</button>
      </div>
      <div class="report-active-filters">
        <div class="report-column-picker">
          <button class="report-column-button ${Object.keys(this.columnFilters).length?'has-active':''}" aria-expanded="${this.columnMenuOpen}" onclick="ReportesController.toggleColumnMenu()"><i class="wi wi-filter"></i>FILTRAR POR COLUMNA</button>
          ${this.columnMenuOpen?`<div class="report-column-menu" role="menu">${cols.map(c=>`<button role="menuitem" class="${this.columnFilters[c.id]?'active':''}" onclick="ReportesController.openColumnFilter('${c.id}')">${this.esc(c.label)}${this.columnFilters[c.id]?`<em>${this.columnFilters[c.id].size}</em>`:''}</button>`).join('')}</div>`:''}
        </div>
        ${this.renderActiveFilters()}<span>${this.fmt(data.length)} pallets</span></div>
      <div class="report-table-shell panel-surface">${visible.length?this.stockCards(visible):'<div class="ops-empty">Ningún pallet coincide con los filtros de búsqueda.</div>'}</div>
      <nav class="report-pagination" aria-label="Paginación"><button ${this.page===0?'disabled':''} onclick="ReportesController.changePage(-1)"><i class="wi wi-left"></i>Anterior</button><span>Página ${this.page+1} de ${pages} <b>(Total: ${this.fmt(data.length)} pallets)</b></span><button ${this.page>=pages-1?'disabled':''} onclick="ReportesController.changePage(1)">Siguiente<i class="wi wi-right"></i></button></nav>
      <div id="reportModalRoot">${this.renderModal()}</div><div id="reportToast" class="report-toast" role="status"></div>
    </section>`;
    DashboardController.startOperationalClock();
  },
  renderActiveFilters(){const entries=Object.entries(this.columnFilters);if(!entries.length)return '<span>Sin filtros por columna</span>';return `<div>${entries.map(([id,set])=>`<button onclick="ReportesController.removeColumnFilter('${id}')">${this.esc(ReportesModel.columnas().find(c=>c.id===id)?.label||id)}: ${set.size} valor(es) ×</button>`).join('')}</div>`;},
  /* --- Vista en tarjetas de Visualizar Stock ------------------------------
     Quinta vista con el mismo sistema .ops-card. La tabla tenia 14 columnas
     mas la de copiar (2.011px de ancho fijo por colgroup): ni en PC entraba,
     de ahi el cartel 'Deslice horizontalmente', que ya no hace falta.
     Se conservan las tres funciones propias de esta vista: copiar fila (boton
     en la cabecera de la tarjeta), los modales de texto y los filtros por
     columna, que ahora se abren desde el menu FILTRAR POR COLUMNA. */
  cardValue(cols,id,p){return this.renderCell(cols.find(c=>c.id===id),p);},
  stockCards(items){
    const cols=ReportesModel.columnas(),v=(id,p)=>this.cardValue(cols,id,p);
    return `<div id="reportCards" class="ops-card-list">${items.map(p=>`
      <article class="ops-card${OperacionesController.orderFlagClass(p)}" onclick="OperacionesController.toggleCard(this,event)">
        <div class="ops-card-head">
          <div class="ops-card-id"><b>${this.esc(cols[0].value(p))}</b><small>${this.esc(cols[1].value(p))} · ${this.esc(cols[2].value(p))}</small></div>
          <div class="ops-card-flag">${v('estado_calidad',p)}</div>
          <button type="button" class="ops-card-copy" title="Copiar esta fila" aria-label="Copiar fila ${this.esc(p.id)}" onclick="ReportesController.copyRow('${this.esc(p.id)}')"><i class="wi wi-copy"></i></button>
          <button type="button" class="ops-card-toggle" aria-expanded="false" aria-label="Ver auditoría y detalle del lote ${this.esc(cols[0].value(p))}"><i></i></button>
        </div>
        <div class="ops-card-metrics">
          <div><small>KILOS</small><span>${v('kilos',p)}</span></div>
          <div><small>CAJAS</small><span>${this.fmt(cols.find(c=>c.id==='cajas').value(p))}</span></div>
          <div><small>FEC. FABRIC.</small><span>${v('fecha_fabricacion',p)}</span></div>
          <div><small>ESTADO</small><span>${v('estado',p)}</span></div>
        </div>
        ${OperacionesController.orderDelay(p)}
        <div class="ops-card-notes">
          <div><small>INFO CALIDAD</small><span>${v('info_calidad',p)}</span></div>
          <div><small>INFO GENERAL</small><span>${v('info_general',p)}</span></div>
        </div>
        <div class="ops-card-detail"><div class="ops-card-more">
          <div class="ops-card-kv">
            <div><small>DETECTOR METALES</small><span>${v('detector_metales',p)}</span></div>
            <div><small>RESERVADO</small><span>${v('reservado',p)}</span></div>
            <div><small>ALMACÉN</small><span>${v('ubicacion',p)}</span></div>
            <div><small>CLASIFICACIÓN ENVÍO</small><span>${v('clasificacion_envio',p)}</span></div>
          </div>
          ${OperacionesController.auditBlock(p)}
        </div></div>
      </article>`).join('')}</div>`;
  },
  renderCell(c,p){const v=c.value(p);if(c.id==='estado')return this.badge(v);if(c.id==='estado_calidad')return this.badge(v,'quality');if(c.id==='detector_metales')return this.badge(v,'detector');if(c.id==='reservado')return this.badge(v,'reserve');if(c.id==='info_calidad'||c.id==='info_general'){const title=c.id==='info_calidad'?'Info Calidad':'Info General';return `<button class="report-text-cell" data-title="${title}" data-value="${this.esc(v)}" onclick="ReportesController.openText(this.dataset.title,this.dataset.value)">${this.esc(v)}</button>`;}if(c.id==='kilos')return `<b class="report-kilos">${this.fmt(v)}</b>`;if(c.id==='lote')return `<code class="report-lote">${this.esc(v)}</code>`;return this.esc(v);},

  openColumnFilter(id){this.exportOpen=false;this.columnMenuOpen=false;this.filterModal={id,selected:new Set(this.columnFilters[id]||ReportesModel.valoresUnicos(id))};this.renderVisualizarStock();},
  toggleFilterValue(encoded,checked){const value=decodeURIComponent(encoded);checked?this.filterModal.selected.add(value):this.filterModal.selected.delete(value);const count=document.getElementById('reportFilterCount');if(count)count.textContent=`${this.filterModal.selected.size} seleccionados`;},
  selectAllFilter(mark){this.filterModal.selected=new Set(mark?ReportesModel.valoresUnicos(this.filterModal.id):[]);this.renderVisualizarStock();},
  applyColumnFilter(){const id=this.filterModal.id,all=ReportesModel.valoresUnicos(id);if(!this.filterModal.selected.size){this.toast('Debe dejar marcado al menos un valor o quitar el filtro.','error');return;}if(this.filterModal.selected.size===all.length)delete this.columnFilters[id];else this.columnFilters[id]=new Set(this.filterModal.selected);this.filterModal=null;this.page=0;this.renderVisualizarStock();},
  removeColumnFilter(id){delete this.columnFilters[id];this.filterModal=null;this.page=0;this.renderVisualizarStock();},
  closeModal(){this.filterModal=null;this.textModal=null;this.renderVisualizarStock();},
  openText(title,value){this.textModal={title,value};this.renderVisualizarStock();},
  renderModal(){
    if(this.textModal)return `<div class="report-modal-backdrop" onclick="if(event.target===this)ReportesController.closeModal()"><section class="report-modal text"><header><h2>${this.esc(this.textModal.title)}</h2><button onclick="ReportesController.closeModal()">×</button></header><p>${this.esc(this.textModal.value)}</p><footer><button class="report-primary" onclick="ReportesController.closeModal()">CERRAR</button></footer></section></div>`;
    if(!this.filterModal)return '';
    const col=ReportesModel.columnas().find(c=>c.id===this.filterModal.id),values=ReportesModel.valoresUnicos(this.filterModal.id);
    return `<div class="report-modal-backdrop" onclick="if(event.target===this)ReportesController.closeModal()"><section class="report-modal filter"><header><div><h2>🔽 Filtrar: ${this.esc(col?.label||'Columna')}</h2><span id="reportFilterCount">${this.filterModal.selected.size} seleccionados</span></div><button onclick="ReportesController.closeModal()">×</button></header><div class="report-modal-tools"><button onclick="ReportesController.selectAllFilter(true)">Marcar todos</button><button onclick="ReportesController.selectAllFilter(false)">Desmarcar todos</button></div><div class="report-filter-values">${values.map(v=>`<label><input type="checkbox" ${this.filterModal.selected.has(v)?'checked':''} onchange="ReportesController.toggleFilterValue('${encodeURIComponent(v)}',this.checked)"><span>${this.esc(v)}</span></label>`).join('')}</div><footer><button class="report-remove-filter" onclick="ReportesController.removeColumnFilter('${this.filterModal.id}')">QUITAR FILTRO</button><button onclick="ReportesController.closeModal()">CANCELAR</button><button class="report-primary" onclick="ReportesController.applyColumnFilter()">APLICAR</button></footer></section></div>`;
  },

  async copyText(text,success){try{await navigator.clipboard.writeText(text);this.toast(success);}catch(_){const ta=document.createElement('textarea');ta.value=text;document.body.appendChild(ta);ta.select();const ok=document.execCommand('copy');ta.remove();this.toast(ok?success:'No se pudo copiar al portapapeles.',ok?'success':'error');}},
  copyAll(){this.exportOpen=false;const data=this.filtered();if(!data.length){this.renderVisualizarStock();this.toast('No hay filas para copiar con los filtros actuales.','error');return;}const rows=ReportesModel.filasExportacion(data),text=rows.map(r=>r.join('\t')).join('\n');this.renderVisualizarStock();this.copyText(text,`${data.length} filas copiadas; puede pegarlas en Excel.`);},
  copyRow(id){const p=ReportesModel.pallets().find(x=>x.id===id);if(!p)return;const cols=ReportesModel.columnas();this.copyText(cols.map(c=>c.value(p)).join('\t'),`Fila “${id}” copiada.`);},
  exportExcel(){this.exportOpen=false;const data=this.filtered();this.renderVisualizarStock();if(!data.length){this.toast('No hay filas para exportar con los filtros actuales.','error');return;}const name=`Stock_Visualizado_${new Date().toISOString().replace(/[-:T]/g,'').slice(0,14)}.xlsx`;ExportService.descargarXlsx(name,'Stock',ReportesModel.filasExportacion(data));this.toast(`${data.length} filas exportadas a Excel.`);},
  toast(message,type='success'){return NotificationService.show(message,{type});}
};
