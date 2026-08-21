/**
 * Visualizar Stock remoto.
 * Mantiene la experiencia de filtros/exportación, pero toda lectura sale de Supabase.
 */
const ReportesStockController = {
  container:null,
  query:'',warehouse:'TODOS',state:'TODOS',columnFilters:{},page:0,
  exportOpen:false,columnMenuOpen:false,filterModal:null,textModal:null,
  catalog:null,result:null,requestId:0,searchTimer:null,_resizeBound:false,

  esc(v){return SeguridadService.escaparHtml(v);},
  fmt(v){return Number(v||0).toLocaleString('es-CL');},
  pageSize(){const h=window.innerHeight||800;if(h>=950)return 15;if(h>=800)return 12;if(h>=680)return 9;return 7;},
  badge(value,type='state'){
    const text=String(value||'—');let color='#64748b';
    if(type==='quality')color=/BLOQUEADO|RECHAZADO/i.test(text)?'#ef4444':/LIBERADO/i.test(text)?'#10b981':'#64748b';
    else if(type==='detector')color=text==='SI'?'#10b981':text==='NO'||text==='BLOQUEADO'?'#ef4444':'#f59e0b';
    else if(typeof COLORES_MAPA_ESTADO==='object')color=COLORES_MAPA_ESTADO[text]||'#64748b';
    return `<span class="ops-badge" style="--badge:${color}">${this.esc(text)}</span>`;
  },
  toast(text,type='success'){return NotificationService.show(text,{type});},

  init(container){
    this.container=container;this.query='';this.warehouse='TODOS';this.state='TODOS';this.columnFilters={};this.page=0;
    this.exportOpen=false;this.columnMenuOpen=false;this.filterModal=null;this.textModal=null;this.catalog=null;this.result=null;
    clearTimeout(this.searchTimer);this.ensureResize();this.renderLoading();this.cargar(true);
  },

  ensureResize(){
    if(this._resizeBound)return;
    let timer;
    window.addEventListener('resize',()=>{clearTimeout(timer);timer=setTimeout(()=>{
      if(AppController.activeView==='visualizar_stock'&&this.container){this.page=0;this.cargar(false);}
    },140);});
    this._resizeBound=true;
  },

  criteria(){return {busqueda:this.query,almacen:this.warehouse,estado:this.state,filtros:this.columnFilters};},
  renderLoading(){if(this.container)this.container.innerHTML=`<section class="reports-view report-stock-view">${DashboardController.operationalHeader({eyebrow:'CONSULTA OPERACIONAL',title:'Visualizar Stock',status:'Stock y estados WMS desde Supabase'})}<div class="panel-empty">Consultando Visualizar Stock en Supabase…</div></section>`;},
  errorHtml(error){const text=error?.permiso?'Tu sesión no posee permiso para consultar Reportes.':error?.red?'No fue posible conectar con Supabase. Visualizar Stock no usa datos locales de respaldo.':(error?.message||'No fue posible consultar Visualizar Stock.');return `<div class="panel-empty"><b>${this.esc(text)}</b></div>`;},

  async cargar(resetPage=false){
    if(resetPage)this.page=0;
    const req=++this.requestId,size=this.pageSize();
    try{
      const catalogPromise=this.catalog?Promise.resolve(this.catalog):ReportesStockModel.catalogos();
      const [catalog,result]=await Promise.all([catalogPromise,ReportesStockModel.listar({...this.criteria(),limite:size,offset:this.page*size})]);
      if(req!==this.requestId||AppController.activeView!=='visualizar_stock')return;
      this.catalog=catalog;
      const pages=Math.max(1,Math.ceil(result.total/size));
      if(this.page>=pages){this.page=pages-1;return this.cargar(false);}
      this.result=result;this.render();
    }catch(error){if(req===this.requestId&&this.container)this.container.innerHTML=`<section class="reports-view report-stock-view">${DashboardController.operationalHeader({eyebrow:'CONSULTA OPERACIONAL',title:'Visualizar Stock',status:'Supabase como fuente de verdad'})}${this.errorHtml(error)}</section>`;}
  },

  updateSearch(value){this.query=value;this.page=0;clearTimeout(this.searchTimer);this.searchTimer=setTimeout(()=>this.cargar(false).then?.(()=>this.restoreSearchFocus()),280);},
  updateWarehouse(value){this.warehouse=value;this.page=0;this.cargar(false);},
  updateState(value){this.state=value;this.page=0;this.cargar(false);},
  restoreSearchFocus(){const el=document.getElementById('reportSearch');if(el){el.focus();el.setSelectionRange(el.value.length,el.value.length);}},
  changePage(delta){this.page=Math.max(0,this.page+delta);this.cargar(false);window.scrollTo({top:0,behavior:'smooth'});},
  toggleExport(){this.exportOpen=!this.exportOpen;this.columnMenuOpen=false;this.render();},
  toggleColumnMenu(){this.columnMenuOpen=!this.columnMenuOpen;this.exportOpen=false;this.render();},
  clearFilters(){this.query='';this.warehouse='TODOS';this.state='TODOS';this.columnFilters={};this.filterModal=null;this.textModal=null;this.exportOpen=false;this.columnMenuOpen=false;this.page=0;this.cargar(false);this.toast('Búsqueda y filtros eliminados.','info');},

  filterableColumns(){return this.catalog?.columnas||[];},
  columnLabel(id){return this.filterableColumns().find(c=>c.id===id)?.label||id;},
  renderActiveFilters(){const entries=Object.entries(this.columnFilters);if(!entries.length)return '<span>Sin filtros por columna</span>';return `<div>${entries.map(([id,set])=>`<button onclick="ReportesStockController.removeColumnFilter('${this.esc(id)}')">${this.esc(this.columnLabel(id))}: ${set.size} valor(es) ×</button>`).join('')}</div>`;},

  async openColumnFilter(id){
    this.exportOpen=false;this.columnMenuOpen=false;
    this.filterModal={id,loading:true,values:[],selected:new Set(this.columnFilters[id]||[])};this.render();
    try{
      const data=await ReportesStockModel.valoresFiltroTodos({columna:id,...this.criteria()});
      if(!this.filterModal||this.filterModal.id!==id)return;
      const values=(data.items||[]).map(x=>String(x.valor??''));
      this.filterModal.values=values;
      if(!this.columnFilters[id])this.filterModal.selected=new Set(values);
      this.filterModal.loading=false;this.render();
    }catch(error){this.filterModal=null;this.render();this.toast(error.message,'error');}
  },
  toggleFilterValue(encoded,checked){if(!this.filterModal)return;const value=decodeURIComponent(encoded);checked?this.filterModal.selected.add(value):this.filterModal.selected.delete(value);const count=document.getElementById('reportFilterCount');if(count)count.textContent=`${this.filterModal.selected.size} seleccionados`;},
  selectAllFilter(mark){if(!this.filterModal)return;this.filterModal.selected=new Set(mark?this.filterModal.values:[]);this.render();},
  applyColumnFilter(){if(!this.filterModal)return;const {id,values,selected}=this.filterModal;if(!selected.size)return this.toast('Debe dejar marcado al menos un valor o quitar el filtro.','error');if(selected.size===values.length)delete this.columnFilters[id];else this.columnFilters[id]=new Set(selected);this.filterModal=null;this.page=0;this.cargar(false);},
  removeColumnFilter(id){delete this.columnFilters[id];this.filterModal=null;this.page=0;this.cargar(false);},
  closeModal(){this.filterModal=null;this.textModal=null;this.render();},
  openText(title,value){this.textModal={title,value};this.render();},

  conditionChips(p){const rows=Array.isArray(p.condiciones_wms_array)?p.condiciones_wms_array:[];if(!rows.length)return '<span class="ops-state-empty">Sin condiciones pendientes</span>';return `<span class="ops-state-chips">${rows.map(x=>this.badge(x)).join('')}</span>`;},
  stateStrip(p){return `<div class="ops-state-strip" aria-label="Flujo y condiciones del pallet"><div><small>FLUJO OPERATIVO</small><span>${this.badge(p.flujo_display||'—')}</span></div><div class="ops-state-conditions"><small>CONDICIÓN / REQUISITO</small>${this.conditionChips(p)}</div></div>`;},
  decisionStrip(p){if(!p.decision_display||p.decision_display==='Sin decisión gerencial')return '';return `<div class="ops-decision-strip"><small>DECISIÓN GERENCIA</small><span>${this.badge(p.decision_display)}${p.modalidad_display&&p.modalidad_display!=='—'?`<em>${this.esc(p.modalidad_display)}</em>`:''}</span></div>`;},
  orderDelay(p){if(!p.en_pedido)return '';const dias=p.dias_en_pedido,fecha=p.fecha_pedido?new Date(p.fecha_pedido).toLocaleDateString('es-CL'):'—';return `<div class="ops-card-alert"><span class="ops-delay${dias!=null&&dias>=2?' late':''}" title="Pedido ingresado el ${this.esc(fecha)}"><i class="wi wi-clock"></i>${dias==null?'Pedido activo':dias===0?'Pedido ingresado hoy':dias===1?'1 día en pedido':`${dias} días en pedido`}${dias!=null&&dias>=2?' · ATRASADO':''}</span></div>`;},
  toggleCard(el,event){const card=el.closest('.ops-card');if(!card)return;if(event){const t=event.target;if(t.closest?.('button')&&!t.closest('.ops-card-toggle'))return;if(t.closest?.('input,a,label'))return;}const open=card.classList.toggle('open');card.querySelector('.ops-card-toggle')?.setAttribute('aria-expanded',open?'true':'false');},
  auditBlock(p){const e=p.ultimo_evento;if(!e)return `<div class="ops-card-audit empty"><span class="ops-audit-title">AUDITORÍA · ÚLTIMO MOVIMIENTO</span><p>Sin movimientos WMS registrados para este pallet.</p></div>`;return `<div class="ops-card-audit"><span class="ops-audit-title">AUDITORÍA · ÚLTIMO MOVIMIENTO</span><dl><div><dt>Evento</dt><dd>${this.esc(e.evento||'—')}</dd></div><div><dt>Contexto</dt><dd>${this.esc(e.contexto||'—')}</dd></div><div><dt>Anterior</dt><dd>${this.esc(e.valor_anterior||'—')}</dd></div><div><dt>Nuevo</dt><dd>${this.esc(e.valor_nuevo||'—')}</dd></div><div><dt>Usuario</dt><dd>${this.esc(e.usuario||'—')}</dd></div><div><dt>Fecha</dt><dd>${this.esc(e.fecha?new Date(e.fecha).toLocaleString('es-CL'):'—')}</dd></div><div class="wide"><dt>Motivo</dt><dd>${this.esc(e.motivo||'Sin motivo informado')}</dd></div></dl></div>`;},
  textButton(title,text){const safe=this.esc(text||'—');return `<button class="report-text-cell" data-title="${this.esc(title)}" data-value="${safe}" onclick="ReportesStockController.openText(this.dataset.title,this.dataset.value)">${safe}</button>`;},

  cards(items){return `<div id="reportCards" class="ops-card-list">${items.map((p,index)=>`<article class="ops-card${p.en_pedido&&p.dias_en_pedido!=null&&p.dias_en_pedido>=2?' is-late':''}" onclick="ReportesStockController.toggleCard(this,event)"><div class="ops-card-head"><div class="ops-card-id"><b>${this.esc(p.lote_display)}</b><small>${this.esc(p.articulo_display)} · ${this.esc(p.descripcion_display)}</small></div><div class="ops-card-flag ops-state-flag ops-wms-primary"><small>ESTADO WMS</small>${this.badge(p.estado_wms_efectivo_display)}</div><button type="button" class="ops-card-copy" title="Copiar esta fila" aria-label="Copiar fila ${this.esc(p.lote_display)}" onclick="ReportesStockController.copyRow(${index})"><i class="wi wi-copy"></i></button><button type="button" class="ops-card-toggle" aria-expanded="false" aria-label="Ver auditoría y detalle del lote ${this.esc(p.lote_display)}"><i></i></button></div><div class="ops-card-metrics ops-card-metrics-compact"><div><small>KILOS</small><span><b class="report-kilos">${this.fmt(p.kilos_display)}</b></span></div><div><small>CAJAS</small><span>${this.fmt(p.cajas_display)}</span></div><div><small>FEC. FABRIC.</small><span>${this.esc(p.fecha_fabricacion_display)}</span></div></div>${this.stateStrip(p)}${this.decisionStrip(p)}${this.orderDelay(p)}<div class="ops-card-notes"><div><small>INFO CALIDAD</small><span>${this.textButton('Info Calidad',p.info_calidad)}</span></div><div><small>INFO GENERAL</small><span>${this.textButton('Info General',p.info_general)}</span></div></div><div class="ops-card-detail"><div class="ops-card-more"><div class="ops-card-kv"><div><small>CALIDAD SAP</small><span>${this.badge(p.estado_sap_display,'quality')}</span></div><div><small>ESTADO WMS REGISTRADO</small><span>${this.badge(p.estado_wms_registrado_display)}</span></div><div><small>ESTADO WMS EFECTIVO</small><span>${this.badge(p.estado_wms_efectivo_display)}</span></div><div><small>FLUJO OPERATIVO</small><span>${this.badge(p.flujo_display)}</span></div><div><small>CONDICIONES WMS</small><span>${this.esc(p.condiciones_display)}</span></div><div><small>DECISIÓN GERENCIA</small><span>${this.esc(p.decision_display)}</span></div><div><small>MODALIDAD</small><span>${this.esc(p.modalidad_display)}</span></div><div><small>DETECTOR METALES</small><span>${this.badge(p.detector_display,'detector')}</span></div><div><small>RESERVA SAP</small><span>${this.esc(p.reserva_display)}</span></div><div><small>ALMACÉN SAP</small><span>${this.esc(p.ubicacion||p.whsname||p.whscode||'—')}</span></div></div>${this.auditBlock(p)}</div></div></article>`).join('')}</div>`;},

  render(){
    if(!this.container||!this.result||!this.catalog)return;
    const size=this.pageSize(),pages=Math.max(1,Math.ceil(this.result.total/size));
    const active=[Boolean(this.query.trim()),this.warehouse!=='TODOS',this.state!=='TODOS'].filter(Boolean).length+Object.keys(this.columnFilters).length;
    const columns=this.filterableColumns();
    this.container.innerHTML=`<section class="reports-view report-stock-view">${DashboardController.operationalHeader({eyebrow:'CONSULTA OPERACIONAL',title:'Visualizar Stock',status:'1.064 filas SAP y estado WMS desde Supabase'})}<div class="report-filterbar panel-surface"><label class="report-search"><span>Buscar por Lote, Artículo, Estado o Condición</span><input id="reportSearch" class="form-control" value="${this.esc(this.query)}" placeholder="Escriba para buscar..." oninput="ReportesStockController.updateSearch(this.value)"></label><label><span>Filtrar Almacén</span><select class="form-control" onchange="ReportesStockController.updateWarehouse(this.value)"><option value="TODOS">TODOS</option>${this.catalog.almacenes.map(x=>`<option value="${this.esc(x.clave)}" ${x.clave===this.warehouse?'selected':''}>${this.esc(x.clave)} · ${this.esc(x.whscode||'')}</option>`).join('')}</select></label><label><span>Filtrar Estado / Flujo</span><select class="form-control" onchange="ReportesStockController.updateState(this.value)"><option value="TODOS">TODOS</option>${this.catalog.estados.map(x=>`<option value="${this.esc(x)}" ${x===this.state?'selected':''}>${this.esc(x)}</option>`).join('')}</select></label><div class="report-export-wrap"><button class="report-export-button" aria-expanded="${this.exportOpen}" onclick="ReportesStockController.toggleExport()"><i class="wi wi-upload"></i>EXPORTAR <i class="wi wi-chevron"></i></button>${this.exportOpen?`<div class="report-export-menu"><button onclick="ReportesStockController.copyAll()"><i class="wi wi-copy"></i>Copiar todo</button><button onclick="ReportesStockController.exportExcel()"><i class="wi wi-sheet"></i>Exportar a Excel</button></div>`:''}</div><button class="report-clear ${active?'has-active':''}" onclick="ReportesStockController.clearFilters()" ${active?'':'disabled'} title="Restablecer búsqueda y todos los filtros"><span>🧹</span><b>Limpiar filtros</b>${active?`<small>${active} activo${active===1?'':'s'}</small>`:''}</button></div><div class="report-active-filters"><div class="report-column-picker"><button class="report-column-button ${Object.keys(this.columnFilters).length?'has-active':''}" aria-expanded="${this.columnMenuOpen}" onclick="ReportesStockController.toggleColumnMenu()"><i class="wi wi-filter"></i>FILTRAR POR COLUMNA</button>${this.columnMenuOpen?`<div class="report-column-menu" role="menu">${columns.map(c=>`<button role="menuitem" class="${this.columnFilters[c.id]?'active':''}" onclick="ReportesStockController.openColumnFilter('${this.esc(c.id)}')">${this.esc(c.label)}${this.columnFilters[c.id]?`<em>${this.columnFilters[c.id].size}</em>`:''}</button>`).join('')}</div>`:''}</div>${this.renderActiveFilters()}<span>${this.fmt(this.result.total)} registros SAP</span></div><div class="report-table-shell panel-surface">${this.result.items.length?this.cards(this.result.items):'<div class="ops-empty">Ningún registro coincide con los filtros.</div>'}</div><nav class="report-pagination" aria-label="Paginación"><button ${this.page===0?'disabled':''} onclick="ReportesStockController.changePage(-1)"><i class="wi wi-left"></i>Anterior</button><span>Página ${this.page+1} de ${pages} <b>(Total: ${this.fmt(this.result.total)} registros SAP)</b></span><button ${this.page>=pages-1?'disabled':''} onclick="ReportesStockController.changePage(1)">Siguiente<i class="wi wi-right"></i></button></nav><div id="reportModalRoot">${this.renderModal()}</div></section>`;
    DashboardController.startOperationalClock();
  },

  renderModal(){
    if(this.textModal)return `<div class="report-modal-backdrop" onclick="if(event.target===this)ReportesStockController.closeModal()"><section class="report-modal text"><header><h2>${this.esc(this.textModal.title)}</h2><button onclick="ReportesStockController.closeModal()">×</button></header><p>${this.esc(this.textModal.value)}</p><footer><button class="report-primary" onclick="ReportesStockController.closeModal()">CERRAR</button></footer></section></div>`;
    if(!this.filterModal)return '';
    if(this.filterModal.loading)return `<div class="report-modal-backdrop"><section class="report-modal filter"><header><div><h2>🔽 Filtrar: ${this.esc(this.columnLabel(this.filterModal.id))}</h2></div><button onclick="ReportesStockController.closeModal()">×</button></header><div class="panel-empty">Consultando valores en Supabase…</div></section></div>`;
    return `<div class="report-modal-backdrop" onclick="if(event.target===this)ReportesStockController.closeModal()"><section class="report-modal filter"><header><div><h2>🔽 Filtrar: ${this.esc(this.columnLabel(this.filterModal.id))}</h2><span id="reportFilterCount">${this.filterModal.selected.size} seleccionados</span></div><button onclick="ReportesStockController.closeModal()">×</button></header><div class="report-modal-tools"><button onclick="ReportesStockController.selectAllFilter(true)">Marcar todos</button><button onclick="ReportesStockController.selectAllFilter(false)">Desmarcar todos</button></div><div class="report-filter-values">${this.filterModal.values.map(v=>`<label><input type="checkbox" ${this.filterModal.selected.has(v)?'checked':''} onchange="ReportesStockController.toggleFilterValue('${encodeURIComponent(v)}',this.checked)"><span>${this.esc(v||'(vacío)')}</span></label>`).join('')}</div><footer><button class="report-remove-filter" onclick="ReportesStockController.removeColumnFilter('${this.esc(this.filterModal.id)}')">QUITAR FILTRO</button><button onclick="ReportesStockController.closeModal()">CANCELAR</button><button class="report-primary" onclick="ReportesStockController.applyColumnFilter()">APLICAR</button></footer></section></div>`;
  },

  async copyText(text,success){try{await navigator.clipboard.writeText(text);this.toast(success);}catch(_){const ta=document.createElement('textarea');ta.value=text;document.body.appendChild(ta);ta.select();const ok=document.execCommand('copy');ta.remove();this.toast(ok?success:'No se pudo copiar al portapapeles.',ok?'success':'error');}},
  rowText(p){return [p.lote_display,p.articulo_display,p.descripcion_display,p.ubicacion||'',p.kilos_display,p.cajas_display,p.fecha_fabricacion_display,p.estado_sap_display,p.estado_wms_efectivo_display,p.flujo_display,p.condiciones_display,p.decision_display,p.modalidad_display,p.info_calidad||'',p.info_general||'',p.detector_display,p.reserva_display].join('\t');},
  copyRow(index){const p=this.result?.items?.[index];if(p)this.copyText(this.rowText(p),`Fila “${p.lote_display}” copiada.`);},
  async copyAll(){this.exportOpen=false;this.render();try{const data=await ReportesStockModel.exportar({...this.criteria(),limite:10000});if(!data?.items?.length)return this.toast('No hay registros para copiar con los filtros actuales.','warning');const table=ReportesStockModel.exportTable(data);await this.copyText(table.map(r=>r.map(v=>String(v??'')).join('\t')).join('\n'),`${data.devueltos||data.items.length} registros SAP copiados.`);}catch(error){this.toast(error.message,'error');}},
  async exportExcel(){this.exportOpen=false;this.render();try{const data=await ReportesStockModel.exportar({...this.criteria(),limite:10000});if(!data?.items?.length)return this.toast('No hay registros para exportar con los filtros actuales.','warning');const name=`Stock_Visualizado_${new Date().toISOString().replace(/[-:T]/g,'').slice(0,14)}.xlsx`;ExportService.descargarXlsx(name,'Stock',ReportesStockModel.exportTable(data));this.toast(`${data.devueltos||data.items.length} registros SAP exportados a Excel.`);}catch(error){this.toast(error.message,'error');}}
};
