/**
 * Fachada de Reportes Operacionales.
 * Generar Reporte se compila aquí; Visualizar Stock vive en su controlador especializado.
 */
const ReportesController = {
  container:null,
  reportType:'REPORTE GENERAL',
  catalog:null,
  compiled:null,
  loading:false,
  requestId:0,

  esc(v){return SeguridadService.escaparHtml(v);},
  fmt(v){return Number(v||0).toLocaleString('es-CL');},
  toast(text,type='success'){return NotificationService.show(text,{type});},

  initVisualizarStock(container){
    return ReportesStockController.init(container);
  },

  badge(value,type='state'){
    const text=String(value||'—');let color='#64748b';
    if(type==='quality')color=/BLOQUEADO|RECHAZADO/i.test(text)?'#ef4444':/LIBERADO/i.test(text)?'#10b981':'#64748b';
    else if(type==='detector')color=text==='SI'?'#10b981':text==='NO'||text==='BLOQUEADO'?'#ef4444':'#f59e0b';
    else if(typeof COLORES_MAPA_ESTADO==='object')color=COLORES_MAPA_ESTADO[text]||'#64748b';
    return `<span class="ops-badge" style="--badge:${color}">${this.esc(text)}</span>`;
  },

  async initGenerarReporte(container){
    this.container=container;
    this.reportType='REPORTE GENERAL';
    this.catalog=null;
    this.compiled=null;
    this.loading=true;
    this.renderGenerarReporte();
    const req=++this.requestId;
    try{
      this.catalog=await ReportesModel.catalogos();
      if(req!==this.requestId||AppController.activeView!=='generar_reporte')return;
      if(!this.catalog.tiposReporte.includes(this.reportType))this.reportType=this.catalog.tiposReporte[0]||'REPORTE GENERAL';
      this.loading=false;
      this.renderGenerarReporte();
    }catch(error){
      if(req!==this.requestId)return;
      this.loading=false;
      this.renderGenerarReporte(error);
    }
  },

  errorHtml(error){
    const text=error?.permiso?'Tu sesión no posee permiso para consultar Reportes.'
      :error?.red?'No fue posible conectar con Supabase. Generar Reporte no usa datos locales de respaldo.'
      :(error?.message||'No fue posible consultar los catálogos de Reportes.');
    return `<div class="report-empty warning"><span>⚠️</span><p>${this.esc(text)}</p></div>`;
  },

  renderGenerarReporte(error=null){
    if(!this.container)return;
    const tipos=this.catalog?.tiposReporte||[];
    this.container.innerHTML=`<section class="reports-view report-compiler-view">
      ${DashboardController.operationalHeader({eyebrow:'REPORTES OPERACIONALES',title:'Generar Reporte',status:'Compilación autoritativa desde Supabase'})}
      <div class="report-compiler-toolbar panel-surface">
        <label><span>Seleccione el Reporte Requerido</span><select id="reportType" class="form-control" ${this.loading||!tipos.length?'disabled':''} onchange="ReportesController.reportType=this.value">${tipos.map(x=>`<option value="${this.esc(x)}" ${x===this.reportType?'selected':''}>${this.esc(x)}</option>`).join('')}</select></label>
        <button class="report-primary" onclick="ReportesController.compileReport()" ${this.loading||!tipos.length?'disabled':''}><i class="wi wi-chart"></i>${this.loading?'CONSULTANDO…':'COMPILAR INFORME'}</button>
      </div>
      <div class="report-preview-label">VISTA PREVIA DEL DOCUMENTO COMPILADO</div>
      <div class="report-preview panel-surface" aria-live="polite">${error?this.errorHtml(error):this.renderReportPreview()}</div>
    </section>`;
    DashboardController.startOperationalClock();
  },

  async compileReport(){
    const tipo=document.getElementById('reportType')?.value||this.reportType;
    this.reportType=tipo;
    this.loading=true;
    this.renderGenerarReporte();
    const req=++this.requestId;
    try{
      this.compiled=await ReportesModel.compilar(tipo,25);
      if(req!==this.requestId||AppController.activeView!=='generar_reporte')return;
      this.loading=false;
      this.renderGenerarReporte();
      this.toast(`${this.compiled.total} registro(s) SAP compilados desde Supabase.`,'success');
    }catch(error){
      if(req!==this.requestId)return;
      this.loading=false;
      this.compiled=null;
      this.renderGenerarReporte(error);
      this.toast(error.message,'error');
    }
  },

  renderReportPreview(){
    if(this.loading)return `<div class="report-empty"><span>⌛</span><p>Compilando información autoritativa en Supabase…</p></div>`;
    if(!this.compiled)return `<div class="report-empty"><span>📋</span><p>Seleccione un criterio y presione “Compilar informe”. El navegador no reconstruye estados ni usa StockModel.</p></div>`;
    const c=this.compiled;
    const issued=c.emitidoEn?new Date(c.emitidoEn).toLocaleString('es-CL'):'—';
    const head=`<header class="compiled-head"><div><span>DOCUMENTO</span><strong>${this.esc(c.tipo)}</strong></div><p>Emitido por: ${this.esc(c.emitidoPor?.nombre||'Usuario WMS')} <i></i> Fecha: ${this.esc(issued)} <i></i> Origen: Supabase · Planta Parral</p></header>`;
    if(!c.total)return `${head}<div class="report-empty warning"><span>⚠️</span><p>No existen registros para este criterio en el snapshot actual.</p></div>`;
    return `${head}
      <div class="compiled-meta"><b>${this.fmt(c.total)} registros SAP</b><span>Vista previa: ${this.fmt(c.vistaPrevia.length)} de ${this.fmt(c.total)}</span></div>
      <div class="approval-insights report-compiled-kpis">
        <article class="approval-insight pending"><span>◫</span><div><small>Registros SAP</small><strong>${this.fmt(c.totales.registros)}</strong><em>Coinciden con el criterio</em></div></article>
        <article class="approval-insight weight"><span>◆</span><div><small>Kilos</small><strong>${this.fmt(c.totales.kilos)}</strong><em>Saldo del reporte</em></div></article>
        <article class="approval-insight boxes"><span>▦</span><div><small>Cajas</small><strong>${this.fmt(c.totales.cajas)}</strong><em>Volumen del reporte</em></div></article>
      </div>
      ${this.reportCards(c.vistaPrevia)}`;
  },

  conditionChips(p){
    const condiciones=Array.isArray(p.condiciones_wms_array)?p.condiciones_wms_array:[];
    if(!condiciones.length)return '<span class="ops-state-empty">Sin condiciones pendientes</span>';
    return `<span class="ops-state-chips">${condiciones.map(x=>this.badge(x)).join('')}</span>`;
  },

  stateStrip(p){
    return `<div class="ops-state-strip" aria-label="Capas WMS del registro"><div><small>FLUJO OPERATIVO</small><span>${this.badge(p.flujo_display)}</span></div><div class="ops-state-conditions"><small>CONDICIÓN / REQUISITO</small>${this.conditionChips(p)}</div></div>`;
  },

  toggleCard(el,event){
    const card=el.closest('.ops-card');if(!card)return;
    if(event&&event.target.closest?.('button')&&!event.target.closest('.ops-card-toggle'))return;
    const open=card.classList.toggle('open');
    card.querySelector('.ops-card-toggle')?.setAttribute('aria-expanded',open?'true':'false');
  },

  auditBlock(p){
    const e=p.ultimo_evento;
    if(!e)return `<div class="ops-card-audit empty"><span class="ops-audit-title">AUDITORÍA · ÚLTIMO MOVIMIENTO</span><p>Sin movimientos WMS registrados para este pallet.</p></div>`;
    return `<div class="ops-card-audit"><span class="ops-audit-title">AUDITORÍA · ÚLTIMO MOVIMIENTO</span><dl><div><dt>Evento</dt><dd>${this.esc(e.evento||'—')}</dd></div><div><dt>Contexto</dt><dd>${this.esc(e.contexto||'—')}</dd></div><div><dt>Anterior</dt><dd>${this.esc(e.valor_anterior||'—')}</dd></div><div><dt>Nuevo</dt><dd>${this.esc(e.valor_nuevo||'—')}</dd></div><div><dt>Usuario</dt><dd>${this.esc(e.usuario||'—')}</dd></div><div><dt>Fecha</dt><dd>${this.esc(e.fecha?new Date(e.fecha).toLocaleString('es-CL'):'—')}</dd></div><div class="wide"><dt>Motivo</dt><dd>${this.esc(e.motivo||'Sin motivo informado')}</dd></div></dl></div>`;
  },

  reportCards(items){
    return `<div class="ops-card-list report-compiled-cards">${items.map(p=>`<article class="ops-card" onclick="ReportesController.toggleCard(this,event)">
      <div class="ops-card-head"><div class="ops-card-id"><b>${this.esc(p.lote_display)}</b><small>${this.esc(p.articulo_display)} · ${this.esc(p.descripcion_display)}</small></div><div class="ops-card-flag ops-state-flag ops-wms-primary"><small>ESTADO WMS</small>${this.badge(p.estado_wms_efectivo_display)}</div><button type="button" class="ops-card-toggle" aria-expanded="false" aria-label="Ver detalle del lote ${this.esc(p.lote_display)}"><i></i></button></div>
      <div class="ops-card-metrics ops-card-metrics-compact"><div><small>KILOS</small><span><b class="report-kilos">${this.fmt(p.kilos_display)}</b></span></div><div><small>CAJAS</small><span>${this.fmt(p.cajas_display)}</span></div><div><small>FEC. FABRIC.</small><span>${this.esc(p.fecha_fabricacion_display)}</span></div></div>
      ${this.stateStrip(p)}
      ${p.decision_display!=='Sin decisión gerencial'?`<div class="ops-decision-strip"><small>DECISIÓN GERENCIA</small><span>${this.badge(p.decision_display)}${p.modalidad_display!=='—'?`<em>${this.esc(p.modalidad_display)}</em>`:''}</span></div>`:''}
      <div class="ops-card-detail"><div class="ops-card-more"><div class="ops-card-kv"><div><small>CALIDAD SAP</small><span>${this.badge(p.estado_sap_display,'quality')}</span></div><div><small>ESTADO WMS REGISTRADO</small><span>${this.badge(p.estado_wms_registrado_display)}</span></div><div><small>ESTADO WMS EFECTIVO</small><span>${this.badge(p.estado_wms_efectivo_display)}</span></div><div><small>FLUJO OPERATIVO</small><span>${this.badge(p.flujo_display)}</span></div><div><small>CONDICIONES WMS</small><span>${this.esc(p.condiciones_display)}</span></div><div><small>DETECTOR METALES</small><span>${this.badge(p.detector_display,'detector')}</span></div><div><small>RESERVA SAP</small><span>${this.esc(p.reserva_display)}</span></div><div><small>ALMACÉN SAP</small><span>${this.esc(p.almacen||p.whsname||p.whscode||'—')}</span></div><div><small>INFO CALIDAD</small><span>${this.esc(p.info_calidad||'—')}</span></div><div><small>INFO GENERAL</small><span>${this.esc(p.info_general||'—')}</span></div></div>${this.auditBlock(p)}</div></div>
    </article>`).join('')}</div>`;
  }
};
