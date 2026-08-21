/** Bitácora: misma experiencia visual, datos y CRUD exclusivamente en Supabase. */
const BitacoraOperativaController = {
  container:null,
  tab:'visualizar',
  id:null,
  pagina:0,
  limite:30,
  filtros:{ buscar:'', fecha:'', turno:'TODOS' },
  requestId:0,
  searchTimer:null,
  actual:null,
  draft:null,

  esc(v) { return SeguridadService.escaparHtml(v); },
  fmt(v) { return Number(v || 0).toLocaleString('es-CL'); },
  puede(p) { return UserModel.hasPermission(p); },
  toast(msg,type='success') { return NotificationService.show(msg,{type}); },

  init(container) {
    this.container=container;
    this.tab='visualizar';
    this.id=null;
    this.pagina=0;
    this.actual=null;
    this.draft=null;
    this.requestId+=1;
    clearTimeout(this.searchTimer);
    this.render();
  },

  tabs() {
    const items=[['visualizar','<i class="wi wi-eye"></i>Visualizar Bitácora']];
    if(this.puede('bitacora.registrar')) items.push(['agregar','<i class="wi wi-plus"></i>Agregar Bitácora']);
    if(this.puede('bitacora.modificar')) items.push(['modificar','<i class="wi wi-edit"></i>Modificar Datos']);
    return `<div class="module-tabs">${items.map(([id,label])=>`<button class="${this.tab===id||(this.tab==='detalle'&&id==='visualizar')?'active':''}" onclick="BitacoraOperativaController.cambiarTab('${id}')">${label}</button>`).join('')}</div>`;
  },

  render() {
    if(!this.container)return;
    if(!this.puede('bitacora.ver')) {
      this.container.innerHTML='<div class="panel-empty"><b>Tu sesión no posee permiso para ver Bitácora.</b></div>';
      return;
    }
    this.container.innerHTML=`<section class="panel-control-view crud-view">
      ${DashboardController.operationalHeader({eyebrow:'CONTROL DEL TURNO',title:'Bitácora',status:'Planificación, pendientes y KPI desde Supabase'})}
      ${this.tabs()}<div id="crudBody"><div class="panel-empty">Consultando Bitácora…</div></div>
    </section>`;
    DashboardController.startOperationalClock();
    if(this.tab==='agregar') return this.cargarFormulario(null);
    if(this.tab==='detalle'&&this.id) return this.cargarDetalle(this.id,false);
    if(this.tab==='modificar'&&this.id) return this.cargarDetalle(this.id,true);
    return this.cargarListado(this.tab==='modificar');
  },

  cambiarTab(tab) {
    this.tab=tab;
    this.id=null;
    this.pagina=0;
    this.actual=null;
    this.draft=null;
    this.requestId+=1;
    this.render();
  },

  body() { return document.getElementById('crudBody'); },
  loading(text='Consultando Supabase…') { return `<div class="panel-empty">${this.esc(text)}</div>`; },
  errorHtml(error) {
    const msg=error?.permiso?'Tu sesión no posee permiso para esta acción.':error?.red?'No fue posible conectar con Supabase. Bitácora no usa datos locales de respaldo.':error?.conflictoVersion?'La bitácora cambió en el servidor. Vuelve al listado y ábrela nuevamente.':(error?.message||'No fue posible completar la operación.');
    return `<div class="panel-empty"><b>${this.esc(msg)}</b></div>`;
  },

  async cargarListado(editing=false) {
    const body=this.body(); if(!body)return;
    const req=++this.requestId;
    body.innerHTML=this.loading('Consultando bitácoras en Supabase…');
    try {
      const data=await BitacoraModel.listar({...this.filtros,limite:this.limite,offset:this.pagina*this.limite});
      if(req!==this.requestId||!this.body())return;
      this.pintarListado(data,editing);
    } catch(error) { if(req===this.requestId&&body) body.innerHTML=this.errorHtml(error); }
  },

  pintarListado(data,editing) {
    const body=this.body(); if(!body)return;
    const rows=data?.items||[], resumen=data?.resumen||{}, total=Number(resumen.bitacoras||0), paginas=Math.max(1,Math.ceil(total/this.limite));
    body.innerHTML=`<section class="ver-toolbar bit-toolbar panel-surface"><div class="filter-bar">
      <label>Buscar<input id="bitSearch" class="form-control" placeholder="Evento o motivo" value="${this.esc(this.filtros.buscar)}" oninput="BitacoraOperativaController.setFiltro('buscar',this.value)"></label>
      <label>Fecha<input class="form-control" placeholder="dd/mm/aaaa" value="${this.esc(this.filtros.fecha)}" oninput="BitacoraOperativaController.setFiltro('fecha',this.value)"></label>
      <label>Turno<select class="form-control" onchange="BitacoraOperativaController.setFiltro('turno',this.value)">${['TODOS','DIA','NOCHE'].map(x=>`<option value="${x}" ${this.filtros.turno===x?'selected':''}>${x==='TODOS'?'Todos los turnos':x==='DIA'?'Día':'Noche'}</option>`).join('')}</select></label>
    </div>${this.resumenListado(resumen)}</section>
    <div id="bitList" class="record-list bit-record-list">${rows.length?rows.map(x=>this.card(x,editing)).join(''):'<div class="panel-empty">Ninguna bitácora coincide con los filtros.</div>'}</div>
    ${total>this.limite?`<footer class="stock-pagination"><button ${this.pagina<=0?'disabled':''} onclick="BitacoraOperativaController.irPagina(-1)">← Anterior</button><span>Página <b>${this.pagina+1}</b> de <b>${paginas}</b> · ${this.fmt(total)} bitácoras</span><button ${this.pagina>=paginas-1?'disabled':''} onclick="BitacoraOperativaController.irPagina(1)">Siguiente →</button></footer>`:''}`;
  },

  resumenListado(r={}) {
    return `<aside class="ver-filter-summary bit-filter-summary" aria-live="polite"><div><b>${this.fmt(r.bitacoras)}</b><span>bitácoras encontradas</span></div><div class="bit-filter-metrics"><span><strong>${this.fmt(r.eventos)}</strong> eventos</span><span class="verified"><strong>${this.fmt(r.verificados)}</strong> verificados</span><span class="rejected"><strong>${this.fmt(r.rechazados)}</strong> rechazados</span><span class="reprocess"><strong>${this.fmt(r.reproceso)}</strong> reproceso</span></div><small>Resumen calculado por el backend para los filtros actuales.</small></aside>`;
  },

  card(b,editing) {
    const fecha=BitacoraModel.fechaVisible(b.fecha_operacional), turno=b.turno||'DIA';
    return `<button class="record-card ${turno.toLowerCase()}" onclick="BitacoraOperativaController.abrir(${Number(b.bitacora_id)},${editing?'true':'false'})"><span class="record-icon">${turno==='DIA'?'☀️':'🌙'}</span><span class="record-main"><span><b>${this.esc(fecha)}</b><i>${turno==='DIA'?'Turno día':'Turno noche'} · ${this.esc(b.folio_visual||'')}</i></span><small>${this.fmt(b.eventos)} eventos · ${this.fmt(b.verificados)} verificados · ${this.fmt(b.rechazados)} rechazados · ${this.fmt(b.reproceso)} a reproceso</small></span><b>${editing?'✏️':'›'}</b></button>`;
  },

  setFiltro(key,value) {
    this.filtros[key]=value; this.pagina=0;
    if(key==='buscar'||key==='fecha') {
      clearTimeout(this.searchTimer);
      this.searchTimer=setTimeout(()=>this.cargarListado(this.tab==='modificar'),260);
    } else this.cargarListado(this.tab==='modificar');
  },
  irPagina(delta) { this.pagina=Math.max(0,this.pagina+delta); this.cargarListado(this.tab==='modificar'); },
  abrir(id,editing=false) { this.id=id; this.tab=editing?'modificar':'detalle'; this.render(); },

  async cargarDetalle(id,editing=false) {
    const body=this.body(); if(!body)return;
    const req=++this.requestId; body.innerHTML=this.loading('Consultando detalle de Bitácora…');
    try {
      const data=await BitacoraModel.detalle(id,{incluirPendientes:true,limitePendientes:50});
      if(req!==this.requestId||!this.body())return;
      this.actual=data;
      if(editing) this.pintarFormulario(data);
      else this.pintarDetalle(data);
    } catch(error) { if(req===this.requestId) body.innerHTML=this.errorHtml(error); }
  },

  pintarDetalle(data) {
    const body=this.body(), b=data?.bitacora, k=data?.kpi_turno||{}; if(!body||!b)return;
    const fecha=BitacoraModel.fechaVisible(data.fecha_operacional);
    body.innerHTML=`<button class="back-link" onclick="BitacoraOperativaController.cambiarTab('visualizar')"><i class="wi wi-left"></i>Volver al listado</button>
      <article class="detail-sheet panel-surface bit-record-head"><header><div><span>${data.turno==='DIA'?'☀️':'🌙'}</span><div><h2>${this.esc(fecha)}</h2><p>Turno ${String(data.turno).toLowerCase()} · ${this.esc(b.folio_visual||'')} · v${this.fmt(b.version)}</p></div></div></header></article>
      ${this.seccionPlanificacion(b.planificacion||[])}${this.seccionResumen(b.resumen_manual||[])}${this.seccionPendientes(data.pendientes_actuales)}${this.seccionKpi(k,b.bitacora_id)}
      ${this.puede('bitacora.eliminar')?`<div class="form-submit"><button class="danger-btn" onclick="BitacoraOperativaController.anularActual()"><i class="wi wi-trash"></i>Anular bitácora</button></div>`:''}`;
  },

  seccionPlanificacion(items=[]) {
    return `<article class="detail-sheet panel-surface bit-read-section"><h3>📋 Planificación</h3>${items.length?`<div class="bit-planning-cards">${items.map(x=>`<div class="bit-planning-card"><small>${this.esc(x.etiqueta)}</small><b>${this.esc(x.valor)}</b></div>`).join('')}</div>`:'<p class="muted">Sin campos registrados.</p>'}</article>`;
  },
  seccionResumen(items=[]) {
    return `<article class="detail-sheet panel-surface bit-read-section"><h3>📝 Resumen del turno</h3>${items.length?`<ol class="bit-timeline">${items.map(x=>`<li><span></span><p>${this.esc(x.texto)}</p></li>`).join('')}</ol>`:'<p class="muted">Sin eventos registrados.</p>'}</article>`;
  },

  seccionKpi(kpi={},bitacoraId=null) {
    const c=kpi.consolidado||{}, a=kpi.automatico||{}, m=kpi.ajuste_manual||{};
    const card=(icon,tone,title,total,tipo)=>`<section class="bit-kpi-card ${tone}"><div><i>${icon}</i><span>${title}</span><b>${this.fmt(total)}</b></div><small>Automático ${this.fmt(a[tipo]||0)} · Ajuste manual ${this.fmt(m[tipo]||0)}</small>${bitacoraId?`<button type="button" class="bit-kpi-detail-button" onclick="BitacoraOperativaController.abrirKpi(${Number(bitacoraId)},'${tipo}')"><i class="wi wi-eye"></i>Ver detalle</button>`:''}</section>`;
    return `<article class="detail-sheet panel-surface bit-kpi-detail"><div class="bit-kpi-title"><h3>📊 KPI del turno</h3><aside class="bit-auto-summary"><span>↻ Consolidado del backend</span><b>${this.fmt(c.verificados)} verificados · ${this.fmt(c.rechazados)} rechazados · ${this.fmt(c.reproceso)} a reproceso</b><small>${this.esc(kpi.nota_reproceso||'')}</small></aside></div><div class="bit-kpi-grid">${card('🔍','verified','Verificados',c.verificados,'verificados')}${card('❌','rejected','Rechazados',c.rechazados,'rechazados')}${card('🔄','reprocess','A reproceso',c.reproceso,'reproceso')}</div></article>`;
  },

  seccionPendientes(data={}) {
    const rows=data?.items||[], urgent=Number(data?.urgentes_2_mas_dias||0);
    if(!rows.length)return `<article class="form-section panel-surface pending-pallets"><div class="rows-head"><h3>📦 Pallets pendientes (0)</h3></div><p class="muted">No hay pallets en estado PEDIDO en este momento.</p></article>`;
    return `<article class="form-section panel-surface pending-pallets"><div class="rows-head"><h3>📦 Pallets pendientes (${this.fmt(data.total)})</h3>${urgent?`<b class="pending-alert">${urgent} urgente(s) · 2+ días de atraso</b>`:''}</div><div class="ops-card-list">${rows.map(p=>this.cardPendiente(p)).join('')}</div></article>`;
  },

  cardPendiente(p) {
    const dias=Number(p.dias_en_pedido||0), alerta=dias>=2;
    return `<article class="ops-card${alerta?' is-late':''}" onclick="OperacionesController.toggleCard(this,event)"><div class="ops-card-head"><div class="ops-card-id"><b>${this.esc(p.id_lote)}</b><small>${this.esc(p.itemcode||'—')} · ${this.esc(p.itemname||'—')}</small></div><div class="ops-card-flag"><span class="ops-badge" style="--badge:${alerta?'#ef4444':'#64748b'}">${this.esc(p.estado_operativo||'PEDIDO')}</span></div><button type="button" class="ops-card-toggle" aria-expanded="false"><i></i></button></div><div class="ops-card-metrics"><div><small>KILOS</small><span><b>${this.fmt(p.kilos)}</b></span></div><div><small>CAJAS</small><span>${this.fmt(p.cajas)}</span></div><div><small>EN PEDIDO</small><span>${dias} día${dias===1?'':'s'}</span></div><div><small>ALMACÉN SAP</small><span>${this.esc(p.whsname||p.whscode||'—')}</span></div></div>${alerta?`<div class="ops-card-alert"><span class="ops-delay late"><i class="wi wi-clock"></i>${dias} días en pedido · ATRASADO</span></div>`:''}<div class="ops-card-detail"><div class="ops-card-more"><div class="ops-card-kv"><div><small>DETECTOR</small><span>${this.esc(p.detector_de||'SIN INFORMACIÓN')}</span></div><div><small>RESERVA</small><span>${this.esc(p.reservado||'SIN RESERVA')}</span></div><div><small>REQUISITOS</small><span>${this.esc(p.requisitos||'—')}</span></div></div><button type="button" class="stock-action" onclick="event.stopPropagation();BitacoraOperativaController.abrirAuditoria(${Number(p.instancia_id)})">Ver auditoría</button></div></div></article>`;
  },

  async cargarFormulario(id=null,turno='DIA') {
    const body=this.body(); if(!body)return;
    if(id)return this.cargarDetalle(id,true);
    const req=++this.requestId; body.innerHTML=this.loading('Preparando nueva Bitácora…');
    try {
      const fecha=BitacoraModel.hoyIso();
      const [pre,turn,pending]=await Promise.all([BitacoraModel.precarga(turno),BitacoraModel.turno(fecha,turno),BitacoraModel.pendientes(50,0)]);
      if(req!==this.requestId||!this.body())return;
      this.actual={nuevo:true,fecha_operacional:fecha,turno,bitacora:null,kpi_turno:turn?.kpi_turno||{},precarga:pre,pendientes_actuales:pending,existente:turn?.bitacora||null};
      this.pintarFormulario(this.actual);
    } catch(error) { if(req===this.requestId) body.innerHTML=this.errorHtml(error); }
  },

  capturarDraft() {
    const f=document.getElementById('bitForm');
    if(!f)return null;
    return {
      planificacion:this.collect(f,'plan',['etiqueta','valor']),
      resumen:this.collect(f,'resumen',['texto']),
      verificados:this.collect(f,'verificados',['motivo','cantidad']),
      rechazados:this.collect(f,'rechazados',['motivo','cantidad']),
      reproceso:f.reproceso?.value||'0'
    };
  },

  pintarFormulario(data) {
    const body=this.body(); if(!body)return;
    const edit=Boolean(data?.bitacora), b=data?.bitacora||{}, pre=data?.precarga||{};
    const turno=data.turno||b.turno||'DIA', fecha=data.fecha_operacional||BitacoraModel.hoyIso();
    const baseAjustes=edit?BitacoraModel.separarAjustes(b.ajustes_kpi||[]):{verificados:[],rechazados:[],reproceso:0};
    const d=!edit?this.draft:null;
    const plan=edit?(b.planificacion||[]):(d?.planificacion||pre.planificacion||[]);
    const resumen=edit?(b.resumen_manual||[]):(d?.resumen||pre.resumen_manual||[]);
    const ajustes=edit?baseAjustes:{verificados:d?.verificados||[],rechazados:d?.rechazados||[],reproceso:d?.reproceso??0};
    const existente=!edit&&data.existente;
    body.innerHTML=`${edit?`<div class="form-top-actions"><button class="back-link" onclick="BitacoraOperativaController.id=null;BitacoraOperativaController.tab='modificar';BitacoraOperativaController.render()">← Volver a la lista</button>${this.puede('bitacora.eliminar')?`<button class="danger-btn" onclick="BitacoraOperativaController.anularActual()">Anular esta bitácora</button>`:''}</div>`:''}
      ${existente?`<div class="lote-duplicate">ℹ️ Ya existe ${this.esc(existente.folio_visual||'una bitácora')} activa para ${BitacoraModel.fechaVisible(fecha)} / ${turno}. Usa “Modificar Datos” si necesitas cambiarla.</div>`:''}
      <form id="bitForm" class="crud-form" onsubmit="BitacoraOperativaController.guardar(event)">
        <input type="hidden" name="fecha" value="${this.esc(fecha)}"><input type="hidden" name="version" value="${this.esc(b.version||'')}">
        <article class="form-section panel-surface"><div class="form-section-title"><div><h2>${edit?'Modificar bitácora':'Nueva bitácora'}</h2><p>${BitacoraModel.fechaVisible(fecha)} · planificación, resumen operacional y KPI.</p></div><div class="bit-shift-field"><span>Turno</span><div class="bit-shift-toggle ${turno==='NOCHE'?'night':'day'}"><button type="button" class="${turno==='DIA'?'active':''}" onclick="BitacoraOperativaController.seleccionarTurno('DIA',${edit?'true':'false'})">☀ Día</button><button type="button" class="${turno==='NOCHE'?'active':''}" onclick="BitacoraOperativaController.seleccionarTurno('NOCHE',${edit?'true':'false'})">🌙 Noche</button></div><input id="bitTurno" type="hidden" name="turno" value="${turno}"></div></div></article>
        ${this.rowsSection('Planificación','plan',plan,['etiqueta','valor'],['Concepto','Valor'])}${this.rowsSection('Resumen del turno','resumen',resumen,['texto'],['Evento o resumen'])}
        ${this.seccionPendientes(data.pendientes_actuales||{})}
        <section class="bit-kpi-editor"><div class="bit-kpi-title"><h3>📊 KPI del turno <small>Ajuste manual</small></h3>${this.seccionKpiCompacta(data.kpi_turno||{})}</div><div class="form-two-cols">${this.rowsSection('🔍 Verificados','verificados',ajustes.verificados,['motivo','cantidad'],['Motivo','Cantidad'])}${this.rowsSection('❌ Rechazados','rechazados',ajustes.rechazados,['motivo','cantidad'],['Motivo','Cantidad'])}<article class="form-section panel-surface bit-kpi-reprocess"><h3>🔄 A reproceso</h3><label>PLT<input class="form-control compact-input" type="number" min="0" name="reproceso" value="${this.esc(ajustes.reproceso)}"></label><small>Ajuste manual auditado</small></article></div></section>
        <div id="bitError" class="form-error"></div><div class="form-submit"><button type="submit" class="btn-primary" ${existente?'disabled':''}><i class="wi wi-save"></i>${edit?'Guardar cambios':'Guardar bitácora'}</button></div>
      </form>`;
    OperacionesController.ajustarListas?.();
  },

  seccionKpiCompacta(k={}) {
    const c=k.consolidado||{},a=k.automatico||{};
    return `<aside class="bit-auto-summary"><span>↻ Resumen automático del turno</span><b>${this.fmt(c.verificados)} verificados · ${this.fmt(c.rechazados)} rechazados · ${this.fmt(c.reproceso)} a reproceso</b><small>Verificaciones automáticas: ${this.fmt(a.verificados)} verificadas · ${this.fmt(a.rechazados)} rechazadas.</small></aside>`;
  },

  rowsSection(title,key,rows,fields,labels) {
    const list=(rows&&rows.length)?rows:[{}];
    return `<article class="form-section panel-surface"><div class="rows-head"><h3>${title}</h3><button type="button" class="small-action" onclick="BitacoraOperativaController.agregarFila('${key}')"><i class="wi wi-plus"></i>Agregar</button></div><div id="rows-${key}" class="dynamic-rows">${list.map(r=>this.row(key,fields,labels,r)).join('')}</div></article>`;
  },
  row(key,fields,labels,row={}) { return `<div class="dynamic-row">${fields.map((f,i)=>`<input class="form-control" name="${key}_${f}" ${f==='cantidad'?'type="number" min="0"':''} placeholder="${labels[i]}" value="${this.esc(row[f]??'')}">`).join('')}<button type="button" aria-label="Quitar fila" onclick="this.parentElement.remove()">×</button></div>`; },
  agregarFila(key) { const defs={plan:[['etiqueta','valor'],['Concepto','Valor']],resumen:[['texto'],['Evento o resumen']],verificados:[['motivo','cantidad'],['Motivo','Cantidad']],rechazados:[['motivo','cantidad'],['Motivo','Cantidad']]}[key]; document.getElementById(`rows-${key}`)?.insertAdjacentHTML('beforeend',this.row(key,defs[0],defs[1])); },
  collect(form,key,fields) { const first=[...form.querySelectorAll(`[name="${key}_${fields[0]}"]`)]; return first.map((_,i)=>Object.fromEntries(fields.map(f=>[f,form.querySelectorAll(`[name="${key}_${f}"]`)[i]?.value||'']))); },

  seleccionarTurno(turno,editing=false) {
    if(!editing) {
      this.draft=this.capturarDraft();
      return this.cargarFormulario(null,turno);
    }
    const input=document.getElementById('bitTurno'); if(input)input.value=turno;
    document.querySelector('.bit-shift-toggle')?.classList.toggle('night',turno==='NOCHE');
    document.querySelector('.bit-shift-toggle')?.classList.toggle('day',turno==='DIA');
    document.querySelectorAll('.bit-shift-toggle button').forEach((b,i)=>b.classList.toggle('active',(i===0&&turno==='DIA')||(i===1&&turno==='NOCHE')));
  },

  async guardar(event) {
    event.preventDefault(); const f=event.currentTarget, errorBox=document.getElementById('bitError'); if(errorBox)errorBox.textContent='';
    const payload={fecha:f.fecha.value,turno:f.turno.value,planificacion:this.collect(f,'plan',['etiqueta','valor']),resumen:this.collect(f,'resumen',['texto']),verificados:this.collect(f,'verificados',['motivo','cantidad']),rechazados:this.collect(f,'rechazados',['motivo','cantidad']),reproceso:f.reproceso.value};
    try {
      if(this.actual?.bitacora) await BitacoraModel.modificar({id:this.actual.bitacora.bitacora_id,version:this.actual.bitacora.version,...payload});
      else await BitacoraModel.crear(payload);
      this.draft=null;
      this.toast(this.actual?.bitacora?'Bitácora actualizada en Supabase.':'Bitácora guardada en Supabase.');
      this.cambiarTab('visualizar');
    } catch(error) {
      const msg=error?.conflictoVersion?'La bitácora fue modificada por otro usuario. Vuelve a abrirla antes de guardar.':(error?.message||'No fue posible guardar la bitácora.');
      if(errorBox)errorBox.textContent=msg; this.toast(msg,'error');
    }
  },

  async anularActual() {
    const b=this.actual?.bitacora; if(!b||!this.puede('bitacora.eliminar'))return;
    const motivo=prompt('Motivo de anulación (queda auditado):','Corrección de registro');
    if(motivo===null)return;
    try { await BitacoraModel.anular({id:b.bitacora_id,version:b.version,motivo}); this.toast('Bitácora anulada. El registro histórico se conserva.','warning'); this.cambiarTab('visualizar'); }
    catch(error){this.toast(error?.conflictoVersion?'La bitácora cambió en servidor. Vuelve a abrirla.':error.message,'error');}
  },

  async abrirKpi(id,tipo) {
    try {
      const d=await BitacoraModel.kpiDetalle(id,tipo);
      const registros=d.registros||[], manuales=d.manuales||[], responsables=d.responsables||[];
      this.modal(`<header><h2>📊 ${this.esc(d.tipo||tipo)} · ${this.esc(d.folio_visual||'')}</h2><button onclick="BitacoraOperativaController.cerrarModal()">×</button></header><div class="turn-summary"><article><span>Total</span><b>${this.fmt(d.total)}</b></article><article><span>Automático</span><b>${this.fmt(d.automatico)}</b></article><article><span>Manual</span><b>${this.fmt(d.total_manual)}</b></article></div>${registros.length?`<div class="record-list">${registros.map(r=>`<article class="detail-sheet panel-surface"><b>${this.esc(r.folio_visual||'')}</b><p>${this.esc(r.codigo_lote||'')} · ${this.esc(r.itemname||r.itemcode||'')}</p><small>${(r.pallets||[]).map(p=>`${this.esc(p.id_lote||p.numero_pallet)} · ${this.esc(p.motivo)}`).join(' | ')}</small></article>`).join('')}</div>`:'<p class="muted">Sin registros automáticos.</p>'}${manuales.length?`<h3>Ajustes manuales</h3><ul>${manuales.map(x=>`<li>${this.esc(x.motivo||'Reproceso')} · <b>${this.fmt(x.cantidad)}</b></li>`).join('')}</ul>`:''}${responsables.length?`<h3>Responsables</h3><p>${responsables.map(x=>this.esc(x.nombre||'—')).join(', ')}</p>`:''}`,'bit-kpi-modal');
    } catch(error){this.toast(error.message,'error');}
  },

  async abrirAuditoria(instanciaId) {
    try {
      const d=await BitacoraModel.pendienteAuditoria(instanciaId,30), rows=d.items||[];
      this.modal(`<header><h2>Auditoría · ${this.esc(d.id_lote||'')}</h2><button onclick="BitacoraOperativaController.cerrarModal()">×</button></header>${rows.length?`<div class="bit-timeline">${rows.map(x=>`<article class="detail-sheet panel-surface"><b>${this.esc(x.evento||x.contexto||'Evento')}</b><p>${this.esc(x.motivo||`${x.valor_anterior||''} → ${x.valor_nuevo||''}`)}</p><small>${this.esc(x.usuario||'—')} · ${this.esc(x.creado_en?new Date(x.creado_en).toLocaleString('es-CL'):'—')} · ${this.esc(x.fuente||'WMS')}</small></article>`).join('')}</div>`:'<p class="muted">Sin eventos registrados.</p>'}`);
    } catch(error){this.toast(error.message,'error');}
  },

  modal(html,clase='') { document.getElementById('bitModal')?.remove(); document.body.insertAdjacentHTML('beforeend',`<div id="bitModal" class="stock-modal-backdrop" onclick="if(event.target===this)BitacoraOperativaController.cerrarModal()"><section class="stock-modal ${clase}">${html}</section></div>`); },
  cerrarModal() { document.getElementById('bitModal')?.remove(); }
};