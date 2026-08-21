/** Registro de Verificaciones: UI operacional alimentada exclusivamente por Supabase. */
const VerificacionesController = {
  container:null,
  tab:'visualizar',
  id:null,
  grupo:null,
  pagina:0,
  limite:30,
  filtros:{ buscar:'', fecha:'', turno:'TODOS' },
  requestId:0,
  searchTimer:null,
  actual:null,

  esc(v) { return SeguridadService.escaparHtml(v); },
  fmt(v) { return Number(v || 0).toLocaleString('es-CL'); },
  puede(p) { return UserModel.hasPermission(p); },
  toast(msg,type='success') { return NotificationService.show(msg,{type}); },

  init(container) {
    this.container=container;
    this.tab='visualizar';
    this.id=null;
    this.grupo=null;
    this.pagina=0;
    this.actual=null;
    this.requestId+=1;
    clearTimeout(this.searchTimer);
    this.render();
  },

  tabs() {
    const items=[['visualizar','<i class="wi wi-eye"></i>Visualizar Registros']];
    if(this.puede('verificaciones.registrar')) items.push(['agregar','<i class="wi wi-plus"></i>Agregar Verificación']);
    if(this.puede('verificaciones.modificar')) items.push(['modificar','<i class="wi wi-edit"></i>Modificar Datos']);
    return `<div class="module-tabs">${items.map(([id,label])=>`<button class="${this.tab===id||(this.tab==='detalle'&&id==='visualizar')?'active':''}" onclick="VerificacionesController.cambiarTab('${id}')">${label}</button>`).join('')}</div>`;
  },

  render() {
    if(!this.container)return;
    if(!this.puede('verificaciones.ver')) {
      this.container.innerHTML='<div class="panel-empty"><b>Tu sesión no posee permiso para ver Registro de Verificaciones.</b></div>';
      return;
    }
    this.container.innerHTML=`<section class="panel-control-view crud-view">
      ${DashboardController.operationalHeader({eyebrow:'CONTROL DE CALIDAD',title:'Registro de Verificaciones',status:'Verificaciones y estado operacional desde Supabase'})}
      ${this.tabs()}<div id="crudBody"><div class="panel-empty">Consultando verificaciones…</div></div>
    </section>`;
    DashboardController.startOperationalClock();
    if(this.tab==='agregar') return this.pintarFormulario(null);
    if(this.id) return this.tab==='modificar'?this.cargarRegistro(this.id,true):this.cargarRegistro(this.id,false);
    if(this.grupo) return this.cargarGrupo(this.grupo.fecha,this.grupo.turno,this.grupo.editing);
    return this.cargarListado(this.tab==='modificar');
  },

  cambiarTab(tab) {
    this.tab=tab;
    this.id=null;
    this.grupo=null;
    this.pagina=0;
    this.actual=null;
    this.requestId+=1;
    this.render();
  },

  body() { return document.getElementById('crudBody'); },
  loading(text='Consultando Supabase…') { return `<div class="panel-empty">${this.esc(text)}</div>`; },
  errorHtml(error) {
    const msg=error?.permiso?'Tu sesión no posee permiso para esta acción.':error?.red?'No fue posible conectar con Supabase. Registro de Verificaciones no usa datos locales de respaldo.':error?.conflictoVersion?'El registro cambió en el servidor. Vuelve al listado y ábrelo nuevamente.':(error?.message||'No fue posible completar la operación.');
    return `<div class="panel-empty"><b>${this.esc(msg)}</b></div>`;
  },

  async cargarListado(editing=false) {
    const body=this.body(); if(!body)return;
    const req=++this.requestId;
    body.innerHTML=this.loading('Consultando turnos de verificación…');
    try {
      const data=await VerificacionesModel.listar({...this.filtros,limite:this.limite,offset:this.pagina*this.limite});
      if(req!==this.requestId||!this.body())return;
      this.pintarListado(data,editing);
    } catch(error) { if(req===this.requestId) body.innerHTML=this.errorHtml(error); }
  },

  pintarListado(data,editing) {
    const body=this.body(); if(!body)return;
    const rows=data?.items||[], r=data?.resumen||{}, total=Number(r.turnos||0), paginas=Math.max(1,Math.ceil(total/this.limite));
    body.innerHTML=`<section class="ver-toolbar bit-toolbar panel-surface"><div class="filter-bar">
      <label>Buscar<input id="verSearch" class="form-control" placeholder="Lote, artículo o motivo" value="${this.esc(this.filtros.buscar)}" oninput="VerificacionesController.setFiltro('buscar',this.value)"></label>
      <label>Fecha<input class="form-control" placeholder="dd/mm/aaaa" value="${this.esc(this.filtros.fecha)}" oninput="VerificacionesController.setFiltro('fecha',this.value)"></label>
      <label>Turno<select class="form-control" onchange="VerificacionesController.setFiltro('turno',this.value)">${['TODOS','DIA','NOCHE'].map(x=>`<option value="${x}" ${this.filtros.turno===x?'selected':''}>${x==='TODOS'?'Todos los turnos':x==='DIA'?'Día':'Noche'}</option>`).join('')}</select></label>
    </div>${this.resumenListado(r)}</section>
    <div id="verList" class="record-list ver-record-list">${rows.length?rows.map(x=>this.cardGrupo(x,editing)).join(''):'<div class="panel-empty ver-empty"><b>Sin resultados</b><span>No hay turnos que coincidan con los filtros actuales.</span></div>'}</div>
    ${total>this.limite?`<footer class="stock-pagination"><button ${this.pagina<=0?'disabled':''} onclick="VerificacionesController.irPagina(-1)">← Anterior</button><span>Página <b>${this.pagina+1}</b> de <b>${paginas}</b> · ${this.fmt(total)} turnos</span><button ${this.pagina>=paginas-1?'disabled':''} onclick="VerificacionesController.irPagina(1)">Siguiente →</button></footer>`:''}`;
  },

  resumenListado(r={}) {
    return `<aside class="ver-filter-summary bit-filter-summary ver-intelligence-summary" aria-live="polite"><div><b>${this.fmt(r.turnos)}</b><span>turnos encontrados</span></div><div class="bit-filter-metrics"><span><strong>${this.fmt(r.registros)}</strong> registros</span><span class="verified"><strong>${this.fmt(r.verificados)}</strong> verificados</span><span class="rejected"><strong>${this.fmt(r.rechazados)}</strong> rechazados</span><span class="reprocess"><strong>${this.fmt(r.motivos)}</strong> motivos</span></div><small>Resumen calculado por Supabase para los filtros actuales.</small></aside>`;
  },

  cardGrupo(g,editing) {
    const night=g.turno==='NOCHE', fecha=VerificacionesModel.fechaVisible(g.fecha_operacional);
    return `<button class="record-card ver-record-card ${night?'night':'day'}" onclick="VerificacionesController.abrirGrupo('${this.esc(g.fecha_operacional)}','${g.turno}',${editing?'true':'false'})"><span class="record-icon">${night?'🌙':'☀️'}</span><span class="record-main"><span><b>${this.esc(fecha)}</b><i>Turno ${night?'noche':'día'}</i></span><small>${this.fmt(g.registros)} registros · ${this.fmt(g.verificados)} verificados · ${this.fmt(g.rechazados)} rechazados · ${this.fmt(g.motivos)} motivos</small></span><span class="ver-record-status"><em class="verified">${this.fmt(g.verificados)}</em><em class="rejected">${this.fmt(g.rechazados)}</em><b>${editing?'✏️':'›'}</b></span></button>`;
  },

  setFiltro(key,value) {
    this.filtros[key]=value; this.pagina=0;
    if(key==='buscar'||key==='fecha') {
      clearTimeout(this.searchTimer);
      this.searchTimer=setTimeout(()=>this.cargarListado(this.tab==='modificar'),260);
    } else this.cargarListado(this.tab==='modificar');
  },
  irPagina(delta) { this.pagina=Math.max(0,this.pagina+delta); this.cargarListado(this.tab==='modificar'); },
  abrirGrupo(fecha,turno,editing=false) { this.grupo={fecha,turno,editing}; this.id=null; this.render(); },

  async cargarGrupo(fecha,turno,editing=false) {
    const body=this.body(); if(!body)return;
    const req=++this.requestId; body.innerHTML=this.loading('Consultando verificaciones del turno…');
    try {
      const data=await VerificacionesModel.turno(fecha,turno,500,0);
      if(req!==this.requestId||!this.body())return;
      this.actual=data;
      this.pintarGrupo(data,editing);
    } catch(error) { if(req===this.requestId) body.innerHTML=this.errorHtml(error); }
  },

  pintarGrupo(data,editing) {
    const body=this.body(); if(!body)return;
    const r=data?.resumen||{}, items=data?.items||[], fecha=VerificacionesModel.fechaVisible(data.fecha_operacional);
    body.innerHTML=`<div class="form-top-actions"><button class="back-link" onclick="VerificacionesController.grupo=null;VerificacionesController.render()">← Volver a turnos</button><div>${!editing?`<button class="stock-action" onclick="VerificacionesController.copiarReporte()"><i class="wi wi-copy"></i>Copiar reporte</button><button class="stock-action" onclick="VerificacionesController.descargarReporte()"><i class="wi wi-download"></i>Exportar RTF</button>`:''}${editing&&this.puede('verificaciones.eliminar')?`<button class="danger-btn" onclick="VerificacionesController.anularTurno()">🗑️ Anular turno</button>`:''}</div></div>
      <article class="detail-sheet panel-surface bit-record-head"><header><div><span>${data.turno==='DIA'?'☀️':'🌙'}</span><div><h2>${this.esc(fecha)}</h2><p>Turno ${String(data.turno).toLowerCase()} · ${this.fmt(r.registros)} registro(s)</p></div></div></header></article>
      <div class="turn-summary"><article><span>Verificados</span><b>${this.fmt(r.verificados)}</b></article><article><span>Rechazados</span><b>${this.fmt(r.rechazados)}</b></article><article><span>Motivos distintos</span><b>${this.fmt(r.motivos)}</b></article></div>
      <div class="record-list">${items.length?items.map(v=>this.cardRegistro(v,editing)).join(''):'<div class="panel-empty">Este turno no contiene verificaciones activas.</div>'}</div>`;
  },

  cardRegistro(v,editing) {
    const rejected=String(v.tipo).toUpperCase()==='RECHAZADO';
    return `<button class="record-card" onclick="VerificacionesController.abrirRegistro(${Number(v.verificacion_id)},${editing?'true':'false'})"><span class="record-icon">${rejected?'<i class="wi wi-alert"></i>':'<i class="wi wi-checkc"></i>'}</span><span class="record-main"><span><b>${this.esc(v.codigo_lote)}</b><i>${this.esc(v.itemname||v.itemcode||'—')}</i></span><small>${(v.pallets||[]).length} pallet(s) · ${this.esc(v.usuario_nombre||'Usuario WMS')} · ${this.esc(v.folio_visual||'')}</small></span><b>${editing?'✏️':'›'}</b></button>`;
  },

  abrirRegistro(id,editing=false) { this.id=id; this.grupo=null; this.tab=editing?'modificar':'detalle'; this.render(); },

  async cargarRegistro(id,editing=false) {
    const body=this.body(); if(!body)return;
    const req=++this.requestId; body.innerHTML=this.loading('Consultando registro…');
    try {
      const data=await VerificacionesModel.detalle(id);
      if(req!==this.requestId||!this.body())return;
      this.actual=data;
      if(editing) this.pintarFormulario(data);
      else this.pintarRegistro(data);
    } catch(error) { if(req===this.requestId) body.innerHTML=this.errorHtml(error); }
  },

  pintarRegistro(v) {
    const body=this.body(); if(!body)return;
    const rejected=String(v.tipo).toUpperCase()==='RECHAZADO', fecha=VerificacionesModel.fechaVisible(v.fecha_operacional);
    body.innerHTML=`<button class="back-link" onclick="VerificacionesController.volverDesdeRegistro()">← Volver</button>
      <article class="detail-sheet panel-surface"><header><div><span>${rejected?'⛔':'✅'}</span><div><h2>${this.esc(v.codigo_lote)}</h2><p>${this.esc(fecha)} · Turno ${String(v.turno).toLowerCase()} · ${this.esc(v.folio_visual||'')} · v${this.fmt(v.version)}</p></div></div></header>
      <div class="detail-grid"><section><h3>Artículo</h3><p>${this.esc(v.itemname||v.itemcode||'—')}</p></section><section><h3>Registrado por</h3><p>${this.esc(v.usuario_nombre||'—')} · ${this.esc(v.usuario_cargo||'')}</p></section></div>
      <h3>Pallets</h3><div class="table-scroll"><table class="panel-table"><thead><tr><th>ID lote</th><th>N° pallet</th><th>Motivo</th><th>Folios</th><th>Almacén snapshot</th></tr></thead><tbody>${(v.pallets||[]).map(p=>`<tr><td>${this.esc(p.id_lote||'—')}</td><td>${this.esc(p.numero_pallet||p.numero||'—')}</td><td>${this.esc(p.motivo||'—')}</td><td>${this.esc(p.folio_texto||'—')}</td><td>${this.esc(p.almacen_nombre||p.almacen_codigo||'—')}</td></tr>`).join('')}</tbody></table></div></article>`;
  },

  volverDesdeRegistro() {
    this.id=null;
    this.tab='visualizar';
    this.render();
  },

  pintarFormulario(v=null) {
    const body=this.body(); if(!body)return;
    const edit=Boolean(v?.verificacion_id), fecha=v?.fecha_operacional||VerificacionesModel.hoyIso(), turno=v?.turno||'DIA', tipo=v?.tipo||'VERIFICADO';
    const rows=edit?(v.pallets||[]).map(p=>({id_lote:p.id_lote||'',motivo:p.motivo||'',folios:p.folio_texto||''})):[{id_lote:'',motivo:'',folios:''}];
    body.innerHTML=`${edit?`<div class="form-top-actions"><button class="back-link" onclick="VerificacionesController.id=null;VerificacionesController.tab='modificar';VerificacionesController.render()">← Volver a la lista</button>${this.puede('verificaciones.eliminar')?`<button class="danger-btn" onclick="VerificacionesController.anularActual()">🗑️ Anular registro</button>`:''}</div>`:''}
      <form id="verForm" class="crud-form" onsubmit="VerificacionesController.guardar(event)">
        <input type="hidden" name="version" value="${this.esc(v?.version||'')}">
        <article class="form-section panel-surface"><div class="form-grid">
          <label>Fecha<input name="fecha" class="form-control" value="${this.esc(VerificacionesModel.fechaVisible(fecha))}" placeholder="dd/mm/aaaa" required></label>
          <label>Turno<select name="turno" class="form-control"><option value="DIA" ${turno==='DIA'?'selected':''}>DIA</option><option value="NOCHE" ${turno==='NOCHE'?'selected':''}>NOCHE</option></select></label>
          <label>Resultado<select name="tipo" class="form-control"><option value="VERIFICADO" ${tipo==='VERIFICADO'?'selected':''}>VERIFICADO</option><option value="RECHAZADO" ${tipo==='RECHAZADO'?'selected':''}>RECHAZADO</option></select></label>
          <label>ID lote / código principal<input id="verCodigo" name="codigo" class="form-control" value="${this.esc(v?.codigo_lote||'')}" placeholder="Ej: 263011055163" required onblur="VerificacionesController.previsualizarCodigo(this.value)"></label>
        </div><p class="form-hint">Cada pallet se valida contra el stock e instancia WMS actuales. En filas adicionales usa el ID completo para evitar ambigüedad.</p><div id="verCodigoPreview" class="form-hint"></div></article>
        ${this.rowsSection(rows)}<div class="lote-duplicate">ℹ️ “Folios” reemplaza al antiguo campo “Cajas”: aquí se registran números de folio, separados por coma. Una corrección o anulación del registro no revierte automáticamente el estado operacional que ya produjo la verificación.</div>
        <div id="verError" class="form-error"></div><div class="form-submit"><button class="btn-primary" type="submit"><i class="wi wi-save"></i>${edit?'Guardar cambios':'Guardar verificación'}</button></div>
      </form>`;
  },

  rowsSection(rows) {
    const list=rows?.length?rows:[{}];
    return `<article class="form-section panel-surface"><div class="rows-head"><h3>Pallets verificados</h3><button type="button" class="small-action" onclick="VerificacionesController.agregarFila()"><i class="wi wi-plus"></i>Agregar</button></div><div id="rows-pallets" class="dynamic-rows">${list.map((r,i)=>this.row(r,i)).join('')}</div></article>`;
  },
  row(row={},index=0) {
    return `<div class="dynamic-row ver-pallet-row"><input class="form-control" name="pallet_id_lote" placeholder="ID lote / código${index===0?' (opcional si usa principal)':''}" value="${this.esc(row.id_lote||'')}"><input class="form-control" name="pallet_motivo" placeholder="Motivo" value="${this.esc(row.motivo||'')}"><input class="form-control" name="pallet_folios" placeholder="Folios: 31, 32" value="${this.esc(row.folios||'')}"><button type="button" aria-label="Quitar fila" onclick="this.parentElement.remove()">×</button></div>`;
  },
  agregarFila() { const root=document.getElementById('rows-pallets'); if(root)root.insertAdjacentHTML('beforeend',this.row({},root.children.length)); },
  collectRows(form) {
    const ids=[...form.querySelectorAll('[name="pallet_id_lote"]')], motivos=[...form.querySelectorAll('[name="pallet_motivo"]')], folios=[...form.querySelectorAll('[name="pallet_folios"]')];
    return ids.map((el,i)=>({id_lote:el.value,motivo:motivos[i]?.value||'',folios:folios[i]?.value||''}));
  },

  async previsualizarCodigo(codigo) {
    const box=document.getElementById('verCodigoPreview'); if(!box||!String(codigo||'').trim())return;
    box.textContent='Validando pallet…';
    try {
      const d=await VerificacionesModel.resolverLote(codigo,10);
      if(!d?.total) box.textContent='No se encontró el pallet en el stock actual.';
      else if(d.ambiguo) box.textContent=`Código ambiguo: ${d.total} pallets coinciden. Usa el ID completo.`;
      else {
        const p=d.items?.[0];
        box.textContent=`✓ ${p?.id_lote||codigo} · ${p?.itemname||p?.itemcode||'Artículo'} · ${p?.whsname||p?.whscode||'Sin almacén'}`;
        const first=document.querySelector('[name="pallet_id_lote"]');
        if(first&&!first.value.trim()&&p?.id_lote)first.value=p.id_lote;
      }
    } catch(error) { box.textContent=error.message||'No fue posible validar el pallet.'; }
  },

  async guardar(event) {
    event.preventDefault(); const f=event.currentTarget, errorBox=document.getElementById('verError'); if(errorBox)errorBox.textContent='';
    const payload={fecha:f.fecha.value,turno:f.turno.value,tipo:f.tipo.value,codigo:f.codigo.value,detalles:this.collectRows(f)};
    try {
      const data=this.actual?.verificacion_id
        ? await VerificacionesModel.modificar({id:this.actual.verificacion_id,version:this.actual.version,...payload})
        : await VerificacionesModel.crear(payload);
      if(this.actual?.verificacion_id&&data?.estado_previo_revertido===false) this.toast('Registro actualizado. El estado operacional previo no se revirtió automáticamente.','warning');
      else this.toast(this.actual?.verificacion_id?'Registro actualizado en Supabase.':'Verificación guardada y aplicada al estado operacional.');
      this.cambiarTab('visualizar');
    } catch(error) {
      const msg=error?.conflictoVersion?'El registro fue modificado por otro usuario. Vuelve a abrirlo antes de guardar.':(error?.message||'No fue posible guardar la verificación.');
      if(errorBox)errorBox.textContent=msg; this.toast(msg,'error');
    }
  },

  async anularActual() {
    const v=this.actual; if(!v?.verificacion_id||!this.puede('verificaciones.eliminar'))return;
    const motivo=prompt('Motivo de anulación (queda auditado):','Corrección de registro'); if(motivo===null)return;
    try {
      const data=await VerificacionesModel.anular({id:v.verificacion_id,version:v.version,motivo});
      this.toast(data?.estado_operacional_revertido===false?'Registro anulado. El estado operacional previo se conserva y queda auditado.':'Registro anulado.','warning');
      this.cambiarTab('visualizar');
    } catch(error) { this.toast(error?.conflictoVersion?'El registro cambió en servidor. Vuelve a abrirlo.':error.message,'error'); }
  },

  async anularTurno() {
    const d=this.actual; if(!d?.fecha_operacional||!this.puede('verificaciones.eliminar'))return;
    const motivo=prompt(`Motivo para anular todos los registros activos del turno ${d.turno} / ${VerificacionesModel.fechaVisible(d.fecha_operacional)}:`,'Corrección de turno'); if(motivo===null)return;
    try {
      const r=await VerificacionesModel.anularTurno({fecha:d.fecha_operacional,turno:d.turno,motivo});
      this.toast(`${this.fmt(r?.anulados)} registro(s) anulados. El estado operacional previo no se revierte automáticamente.`,'warning');
      this.grupo=null; this.tab='visualizar'; this.render();
    } catch(error) { this.toast(error.message,'error'); }
  },

  reporteTexto(data=this.actual) {
    if(!data?.fecha_operacional)return '';
    const r=data.resumen||{}, lines=['REGISTRO DE VERIFICACIONES',`${VerificacionesModel.fechaVisible(data.fecha_operacional)} · Turno ${data.turno}`,''];
    const add=(tipo,titulo)=>{
      const regs=(data.items||[]).filter(v=>String(v.tipo).toUpperCase()===tipo);
      if(!regs.length)return;
      lines.push(titulo,'');
      regs.forEach(v=>{
        lines.push(`Lote ${v.codigo_lote} — ${v.itemname||v.itemcode||'Sin artículo'}`);
        (v.pallets||[]).forEach(p=>lines.push(`  • ${p.id_lote||p.numero_pallet}: ${p.motivo}${p.folio_texto?` (Folios: ${p.folio_texto})`:''}`));
        lines.push('');
      });
    };
    add('VERIFICADO','✅ VERIFICADOS'); add('RECHAZADO','❌ RECHAZADOS');
    lines.push('RESUMEN',`${this.fmt(r.verificados)} verificados · ${this.fmt(r.rechazados)} rechazados · ${this.fmt(r.motivos)} motivos`);
    if((data.usuarios||[]).length)lines.push(`Registrado por: ${data.usuarios.map(u=>u.nombre||'—').join(', ')}`);
    return lines.join('\n');
  },

  async copiarReporte() {
    try { await navigator.clipboard.writeText(this.reporteTexto()); this.toast('Reporte copiado correctamente.'); }
    catch(_) { this.toast('No se pudo copiar el reporte. Usa Exportar RTF.','error'); }
  },

  escapeRtf(value) {
    const out=[];
    for(const ch of String(value??'')) {
      const code=ch.codePointAt(0);
      if(ch==='\\'||ch==='{'||ch==='}')out.push(`\\${ch}`);
      else if(code<128)out.push(ch);
      else if(code<=0xFFFF)out.push(`\\u${code<32768?code:code-65536}?`);
      else { const n=code-0x10000; [0xD800+(n>>10),0xDC00+(n&0x3FF)].forEach(u=>out.push(`\\u${u<32768?u:u-65536}?`)); }
    }
    return out.join('');
  },

  descargarReporte() {
    const data=this.actual; if(!data?.fecha_operacional)return;
    const text=this.reporteTexto(data), E=v=>this.escapeRtf(v);
    const rtf=`{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Calibri;}}\\f0\\fs22 ${E(text).replaceAll('\n','\\par\n')}}`;
    const filename=`Verificaciones_${VerificacionesModel.fechaVisible(data.fecha_operacional).replaceAll('/','-')}_${data.turno}.rtf`;
    const blob=new Blob([rtf],{type:'application/rtf;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),0);this.toast(`Reporte exportado: ${filename}`);
  }
};