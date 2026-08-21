/**
 * Operaciones migradas a Supabase.
 *
 * El controlador conserva la experiencia visual de las tres vistas, pero no
 * decide estados ni subestados. Renderiza lo que devuelve el backend y envía
 * únicamente las acciones públicas admitidas por sus RPC.
 */
const OperacionesBackendController = {
  container:null,
  selected:new Set(),
  movementFilters:{buscar:'',estado:'TODOS',detector:'TODOS'},
  movementItems:[], movementTotal:0, movementOptions:{estados:[],detectores:[]},
  MOVEMENT_PAGE:120, movementSearchTimer:null, requestId:0,

  dispatchText:'',
  dispatchResolution:{pedidos:[],encontrados:[],sin_coincidencia:[],ambiguos:[],items:[],cantidad_pallets:0},
  dispatchOverlay:false, dispatchTimer:null, _pedidoPendiente:null,

  approvalFilters:{estado:'TODOS',articulo:'TODOS'},
  approvalItems:[], approvalTotal:0, approvalData:null, APPROVAL_PAGE:120,
  _approvalDecision:null,

  esc(v){return SeguridadService.escaparHtml(v);},
  fmt(v){const n=Number(v||0);return Number.isFinite(n)?n.toLocaleString('es-CL'):'0';},
  puede(p){return UserModel.hasPermission(p);},
  toast(text,type='success'){return NotificationService.show(text,{type});},
  normalizar(v){return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase();},
  setError(id,text=''){const el=document.getElementById(id);if(el)el.textContent=text;},

  errorHtml(error){
    const msg=error?.permiso?'Tu sesión no posee permiso para esta acción.'
      :error?.red?'No fue posible conectar con Supabase. Operaciones no usa datos locales de respaldo.'
      :error?.conflictoVersion?'El registro cambió en el servidor. Recargue la vista antes de continuar.'
      :error?.conflictoCola?'La cola cambió mientras la estaba revisando. Se recargará con el estado actual.'
      :(error?.message||'No fue posible completar la operación.');
    return `<div class="ops-empty"><b>${this.esc(msg)}</b></div>`;
  },

  badge(value,type='state'){
    const text=String(value||'—'); let color='#64748b';
    if(type==='quality') color=/BLOQUEADO|RECHAZADO/i.test(text)?'#ef4444':/LIBERADO/i.test(text)?'#10b981':'#64748b';
    else if(type==='detector') color=text==='SI'?'#10b981':text==='NO'||text==='BLOQUEADO'?'#ef4444':'#f59e0b';
    else {
      const keys=typeof COLORES_MAPA_ESTADO==='object'?Object.keys(COLORES_MAPA_ESTADO):[];
      const key=keys.find(k=>this.normalizar(k)===this.normalizar(text));
      color=key?COLORES_MAPA_ESTADO[key]:'#64748b';
    }
    return `<span class="ops-badge" style="--badge:${color}">${this.esc(text)}</span>`;
  },

  conditionChips(p){
    const condiciones=Array.isArray(p.condiciones_wms_array)?p.condiciones_wms_array:[];
    if(!condiciones.length)return '<span class="ops-state-empty">Sin condiciones pendientes</span>';
    return `<span class="ops-state-chips">${condiciones.map(x=>this.badge(x)).join('')}</span>`;
  },

  stateStrip(p,{queue=false}={}){
    return `<div class="ops-state-strip" aria-label="Capas de estado del pallet">
      <div><small>ESTADO OPERATIVO</small><span>${this.badge(p.estado_operativo_display||'SIN ESTADO')}</span></div>
      <div><small>${queue?'ESTADO COLA':'FLUJO / FILTRO'}</small><span>${this.badge(p.flujo_display||p.estado||'SIN ESTADO')}</span></div>
      <div class="ops-state-conditions"><small>CONDICIONES / SUBESTADOS</small>${this.conditionChips(p)}</div>
    </div>`;
  },

  textButton(title,text){
    const safe=this.esc(text||'—');
    return `<button class="cell-text" title="${safe}" data-text="${safe}" onclick="OperacionesBackendController.showText('${this.esc(title)}',this.dataset.text)">${safe}</button>`;
  },

  showText(title,text){
    document.getElementById('opsModal')?.remove();
    document.body.insertAdjacentHTML('beforeend',`<div id="opsModal" class="ops-modal-backdrop" onclick="if(event.target===this)this.remove()"><div class="ops-modal" role="dialog" aria-modal="true"><header><h3>${this.esc(title)}</h3><button onclick="document.getElementById('opsModal').remove()" aria-label="Cerrar">×</button></header><p>${this.esc(text)}</p><footer><button class="ops-action secondary" onclick="document.getElementById('opsModal').remove()">CERRAR</button></footer></div></div>`);
  },

  toggleCard(el,event){
    const card=el.closest('.ops-card');if(!card)return;
    if(event){
      const t=event.target;
      if(t.closest?.('input,a,label')&&!t.closest('.ops-card-toggle'))return;
      if(t.closest?.('button')&&!t.closest('.ops-card-toggle'))return;
    }
    const open=card.classList.toggle('open');
    card.querySelector('.ops-card-toggle')?.setAttribute('aria-expanded',open?'true':'false');
  },

  auditBlock(p){
    const a=p.auditoria;
    if(!a)return `<div class="ops-card-audit empty"><span class="ops-audit-title">AUDITORÍA</span><p>Sin movimientos WMS registrados para este pallet.</p></div>`;
    return `<div class="ops-card-audit"><span class="ops-audit-title">AUDITORÍA · ÚLTIMO MOVIMIENTO</span><dl><div><dt>Evento</dt><dd>${this.esc(a.evento||'—')}</dd></div><div><dt>Usuario</dt><dd>${this.esc(a.usuario||'—')}</dd></div><div><dt>Fecha</dt><dd>${this.esc(a.fecha?new Date(a.fecha).toLocaleString('es-CL'):'—')}</dd></div><div class="wide"><dt>Motivo</dt><dd>${this.esc(a.motivo||'Sin motivo informado')}</dd></div></dl></div>`;
  },

  orderDelay(p){
    if(!p.en_pedido)return '';
    const dias=Number(p.dias_en_pedido||0),fecha=p.pedido_en?new Date(p.pedido_en).toLocaleDateString('es-CL'):'—';
    return `<div class="ops-card-alert"><span class="ops-delay${dias>=2?' late':''}" title="Pedido ingresado el ${this.esc(fecha)}"><i class="wi wi-clock"></i>${dias===0?'Pedido ingresado hoy':dias===1?'1 día en pedido':`${dias} días en pedido`}${dias>=2?' · ATRASADO':''}</span></div>`;
  },

  cards(items,{checkbox=false,id='opsCards'}={}){
    return `<div class="ops-table-shell"><div id="${id}" class="ops-card-list">${items.map(p=>`
      <article class="ops-card${p.en_pedido&&Number(p.dias_en_pedido||0)>=2?' is-late':''}" onclick="OperacionesBackendController.toggleCard(this,event)">
        <div class="ops-card-head">
          ${checkbox?`<label class="ops-card-check"><input type="checkbox" aria-label="Seleccionar ${this.esc(p.id_lote)}" ${this.selected.has(Number(p.instancia_id))?'checked':''} onchange="OperacionesBackendController.toggleSelected(${Number(p.instancia_id)},this.checked)"></label>`:''}
          <div class="ops-card-id"><b>${this.esc(p.id_lote||'—')}</b><small>${this.esc(p.itemcode||'—')} · ${this.esc(p.itemname||'—')}</small></div>
          <div class="ops-card-flag ops-state-flag"><small>CALIDAD SAP</small>${this.badge(p.estado_sap||'SIN INFORMACIÓN','quality')}</div>
          <button type="button" class="ops-card-toggle" aria-expanded="false" aria-label="Ver auditoría y detalle del lote ${this.esc(p.id_lote||'')}"><i></i></button>
        </div>
        <div class="ops-card-metrics">
          <div><small>KILOS</small><span><b class="kilos">${this.fmt(p.kilos)}</b></span></div>
          <div><small>CAJAS</small><span>${this.fmt(p.cajas)}</span></div>
          <div><small>FEC. FABRIC.</small><span>${this.esc(p.fecha_fabricacion_display||'—')}</span></div>
          <div><small>ESTADO OPERATIVO</small><span>${this.badge(p.estado_operativo_display||'—')}</span></div>
        </div>
        ${this.stateStrip(p)}
        ${this.orderDelay(p)}
        <div class="ops-card-notes">
          <div><small>INFO CALIDAD</small><span>${this.textButton('Info Calidad',p.info_calidad||'Sin información de calidad.')}</span></div>
          <div><small>INFO GENERAL</small><span>${this.textButton('Info General',p.info_general||'Sin información general.')}</span></div>
        </div>
        <div class="ops-card-detail"><div class="ops-card-more">
          <div class="ops-card-kv">
            <div><small>CALIDAD SAP</small><span>${this.badge(p.estado_sap||'SIN INFORMACIÓN','quality')}</span></div>
            <div><small>ESTADO WMS REGISTRADO</small><span>${this.badge(p.estado_wms_registrado_display||'SIN ESTADO WMS PROPIO')}</span></div>
            <div><small>DECISIÓN GERENCIA</small><span>${this.esc(p.decision_display||'Sin decisión gerencial')}</span></div>
            <div><small>MODALIDAD</small><span>${this.esc(p.modalidad_display||'—')}</span></div>
            <div><small>DETECTOR METALES</small><span>${this.badge(p.detector_display||p.detector_de||'SIN INFORMACIÓN','detector')}</span></div>
            <div><small>RESERVA SAP</small><span>${this.esc(p.reservado||'SIN RESERVA')}</span></div>
            <div><small>ALMACÉN SAP</small><span>${this.esc(p.whsname||p.whscode||'—')}</span></div>
          </div>
          ${this.auditBlock(p)}
        </div></div>
      </article>`).join('')}</div></div>`;
  },

  /* ====================== MOVIMIENTOS DE CÁMARA ====================== */
  initMovimientos(container){
    this.container=container;
    this.selected.clear();
    this.movementFilters={buscar:'',estado:'TODOS',detector:'TODOS'};
    this.movementItems=[];
    this.movementTotal=0;
    this.requestId+=1;
    this.cargarMovimientos(true);
  },

  async cargarMovimientos(reset=false){
    const req=++this.requestId;
    if(reset)this.movementItems=[];
    if(!this.puede('stock.ver')){
      this.container.innerHTML='<div class="ops-empty"><b>Tu sesión no posee permiso para consultar Operaciones.</b></div>';
      return;
    }
    if(reset)this.pintarMovimientos(true);
    try{
      const data=await OperacionesBackendModel.movimientos({...this.movementFilters,limite:this.MOVEMENT_PAGE,offset:this.movementItems.length});
      if(req!==this.requestId)return;
      this.movementItems.push(...(data.items||[]));
      this.movementTotal=Number(data.total||0);
      this.movementOptions={estados:data.estados||[],detectores:data.detectores||[]};
      this.pintarMovimientos(false);
    }catch(error){
      if(req===this.requestId)this.container.innerHTML=`<section class="operations-view">${DashboardController.operationalHeader({eyebrow:'FLUJO OPERATIVO',title:'Movimientos de Cámara',status:'Supabase como fuente de verdad'})}${this.errorHtml(error)}</section>`;
    }
  },

  pintarMovimientos(loading=false){
    const active=[Boolean(this.movementFilters.buscar.trim()),this.movementFilters.estado!=='TODOS',this.movementFilters.detector!=='TODOS'].filter(Boolean).length;
    const states=['TODOS',...(this.movementOptions.estados||[])],detectors=['TODOS',...(this.movementOptions.detectores||[])];
    this.container.innerHTML=`<section class="operations-view">
      ${DashboardController.operationalHeader({eyebrow:'FLUJO OPERATIVO',title:'Movimientos de Cámara',status:'Estados y condiciones calculados por Supabase'})}
      <p class="ops-section-label">FLUJO OPERATIVO: LOTES Y ARTÍCULOS REGISTRADOS</p>
      <div class="ops-filter-bar">
        <label>Buscar por Lote, Artículo o Código<input id="movementSearch" class="form-control" placeholder="Escriba para buscar..." value="${this.esc(this.movementFilters.buscar)}" oninput="OperacionesBackendController.setMovementFilter('buscar',this.value)"></label>
        <label class="ops-select-field">Filtrar Estado Actual<select class="form-control" onchange="OperacionesBackendController.setMovementFilter('estado',this.value)">${states.map(x=>`<option value="${this.esc(x)}" ${this.movementFilters.estado===x?'selected':''}>${this.esc(x)}</option>`).join('')}</select></label>
        <label class="ops-select-field">Filtrar Detector Metales<select class="form-control" onchange="OperacionesBackendController.setMovementFilter('detector',this.value)">${detectors.map(x=>`<option value="${this.esc(x)}" ${this.movementFilters.detector===x?'selected':''}>${this.esc(x)}</option>`).join('')}</select></label>
        <button class="ops-link ops-clear-button ${active||this.selected.size?'has-active':''}" onclick="OperacionesBackendController.clearMovementFilters()" ${active||this.selected.size?'':'disabled'}><span>↺</span><b>Limpiar<em> filtros</em></b></button>
      </div>
      <div class="ops-results">
        ${loading?'<div class="ops-empty">Consultando movimientos en Supabase…</div>':this.movementItems.length?this.cards(this.movementItems,{checkbox:true,id:'movementCards'}):'<div class="ops-empty">Ningún pallet coincide con los filtros.</div>'}
        ${!loading&&this.movementItems.length<this.movementTotal?`<button class="load-more" onclick="OperacionesBackendController.cargarMovimientos(false)"><i class="wi wi-down"></i>Cargar más (${this.movementItems.length} de ${this.movementTotal})</button>`:!loading?`<p class="result-count">Mostrando ${this.movementItems.length} de ${this.movementTotal} pallet(s).</p>`:''}
      </div>
      ${this.puede('pallet.estado_cambiar')?`<form class="ops-bottom-panel movement" onsubmit="OperacionesBackendController.submitMovement(event)">
        <h3>🔁 RECLASIFICAR ESTADO / CONDICIÓN</h3>
        <div class="ops-bottom-grid movement-grid">
          <label>Destino operacional<select name="target" class="form-control" required><option value="">Seleccione…</option>${OperacionesBackendModel.RECLASIFICACION_DESTINOS.map(x=>`<option>${x}</option>`).join('')}</select></label>
          <label class="reason-field">Justificación / Motivo Técnico (Obligatorio)<textarea name="reason" class="form-control" rows="2" placeholder="Especificar motivo técnico de la reclasificación..." required></textarea></label>
          <button class="ops-action success" type="submit"><i class="wi wi-check"></i>PROCESAR</button>
        </div>
        <div id="movementError" class="ops-error"></div>
      </form>`:''}
    </section>`;
    DashboardController.startOperationalClock();
  },

  setMovementFilter(key,value){
    this.movementFilters[key]=value;
    clearTimeout(this.movementSearchTimer);
    if(key==='buscar')this.movementSearchTimer=setTimeout(()=>this.cargarMovimientos(true),260);
    else this.cargarMovimientos(true);
  },

  clearMovementFilters(){
    this.selected.clear();
    this.movementFilters={buscar:'',estado:'TODOS',detector:'TODOS'};
    this.cargarMovimientos(true);
  },

  toggleSelected(id,on){on?this.selected.add(Number(id)):this.selected.delete(Number(id));},

  async submitMovement(event){
    event.preventDefault();
    const f=event.currentTarget;
    if(!this.selected.size)return this.setError('movementError','Debe seleccionar al menos un pallet.');
    const motivo=String(f.reason.value||'').trim(),destino=f.target.value;
    if(!motivo)return this.setError('movementError','Debe ingresar el motivo técnico.');
    try{
      const r=await OperacionesBackendModel.reclasificar([...this.selected],destino,motivo);
      this.selected.clear();
      this.toast(`${r.cantidad} pallet(s) procesados · ${r.semantica||'operación aplicada'}${Number(r.reproceso_a_verificacion_emergencia||0)?` · ${r.reproceso_a_verificacion_emergencia} reproceso(s) derivados a verificación de emergencia`:''}.`);
      this.cargarMovimientos(true);
    }catch(error){this.setError('movementError',error.message);}
  },

  /* ============================= DESPACHO ============================= */
  initDespacho(container){
    this.container=container;
    this.dispatchText='';
    this.dispatchResolution={pedidos:[],encontrados:[],sin_coincidencia:[],ambiguos:[],items:[],cantidad_pallets:0};
    this.dispatchOverlay=false;
    this.renderDespacho();
  },

  renderDespacho(){
    const r=this.dispatchResolution||{},items=r.items||[],puedePedido=this.puede('pedido.gestionar');
    this.container.innerHTML=`<section class="operations-view dispatch-view">
      ${DashboardController.operationalHeader({eyebrow:'OPERACIÓN DE DESPACHO',title:'Despacho',status:'Ingreso de pallets al estado PEDIDO'})}
      <div class="ops-title-row"><p class="ops-section-label">ESTADO OPERATIVO DETALLADO DE LOS LOTES INGRESADOS</p>${this.dispatchTriggerHtml()}</div>
      <div class="dispatch-table-area">${items.length?this.cards(items,{id:'dispatchCards'}):`<div class="ops-empty">${this.dispatchText?'Ningún lote resuelto todavía.':'Esperando ingreso de lotes...'}</div>`}</div>
      ${puedePedido?`<form class="ops-bottom-panel dispatch pedido-only" onsubmit="OperacionesBackendController.submitPedido(event)">
        <h3>📦 ENVIAR LOTES A PEDIDO</h3>
        <div class="ops-bottom-grid pedido-grid">
          <label class="reason-field">Motivo / Orden de Pedido (Obligatorio)<textarea name="reason" class="form-control" rows="3" placeholder="Ingrese instrucción, orden, cliente o motivo operacional del pedido..." required></textarea></label>
          <button type="submit" class="ops-action success" ${items.length?'':'disabled'}><i class="wi wi-check"></i>EJECUTAR PEDIDO</button>
        </div>
        <div id="dispatchError" class="ops-error"></div>
      </form>`:''}
    </section>`;
    DashboardController.startOperationalClock();
  },

  dispatchTriggerHtml(){
    const r=this.dispatchResolution||{},faltan=(r.sin_coincidencia||[]).length,amb=(r.ambiguos||[]).length;
    if(!String(this.dispatchText||'').trim())return `<button class="lot-search-trigger" onclick="OperacionesBackendController.openDispatchOverlay()"><i class="wi wi-search"></i><span>Buscar o pegar lotes...</span></button>`;
    return `<button class="lot-search-trigger cargado${faltan||amb?' con-faltantes':''}" onclick="OperacionesBackendController.openDispatchOverlay()"><i class="wi wi-search"></i><span><b>${r.cantidad_pallets||0} pallet(s)</b> · ${(r.pedidos||[]).length} código(s)${faltan?` · ${faltan} sin coincidencia`:''}${amb?` · ${amb} ambiguo(s)`:''}</span></button>`;
  },

  lotHost(){let host=document.getElementById('lotOverlayHost');if(!host){host=document.createElement('div');host.id='lotOverlayHost';document.body.appendChild(host);}return host;},
  openDispatchOverlay(){if(this.dispatchOverlay)return this.closeDispatchOverlay();this.dispatchOverlay=true;this.lotHost().innerHTML=this.dispatchPanelHtml();this.anclarDispatchPanel();document.getElementById('lotsTextarea')?.focus();},
  closeDispatchOverlay(){this.dispatchOverlay=false;this.lotHost().innerHTML='';},

  anclarDispatchPanel(){
    const panel=document.querySelector('#lotOverlayHost .lot-panel'),button=document.querySelector('.lot-search-trigger');
    if(!panel||!button)return;
    const r=button.getBoundingClientRect(),w=Math.min(540,window.innerWidth-20);
    panel.style.position='fixed';
    panel.style.width=`${w}px`;
    panel.style.left=`${Math.max(10,Math.min(r.left,window.innerWidth-w-10))}px`;
    panel.style.top=`${Math.min(window.innerHeight-420,Math.max(10,r.bottom+8))}px`;
    panel.style.zIndex='700';
  },

  dispatchPanelHtml(){
    return `<aside class="map-overlay lot-panel" role="dialog" aria-label="Buscar o pegar lotes"><header><h3>Buscar o pegar lotes</h3><button type="button" onclick="OperacionesBackendController.closeDispatchOverlay()" aria-label="Cerrar">×</button></header><p>Puede pegar una columna completa desde Excel. El backend acepta ID de lote completo o código visual.</p><div class="search-input-shell"><textarea id="lotsTextarea" rows="9" spellcheck="false" placeholder="263011027001&#10;A-01&#10;A01" oninput="OperacionesBackendController.updateDispatchText(this.value)">${this.esc(this.dispatchText)}</textarea><small id="lotResumen">${this.lotSummaryHtml()}</small></div><div class="lot-panel-acciones"><button type="button" class="ops-action secondary" onclick="OperacionesBackendController.clearDispatchText()"><i class="wi wi-clean"></i>VACIAR</button><button type="button" class="ops-action success" onclick="OperacionesBackendController.applyDispatchOverlay()"><i class="wi wi-check"></i>APLICAR</button></div></aside>`;
  },

  lotSummaryHtml(){
    const r=this.dispatchResolution||{};
    if(!String(this.dispatchText||'').trim())return '<span class="lot-resumen-vacio">Sin códigos ingresados.</span>';
    return `<span class="lot-resumen-cuenta"><b>${r.cantidad_pallets||0}</b> pallet(s) resueltos · <b>${(r.encontrados||[]).length}</b> código(s) encontrados${(r.sin_coincidencia||[]).length?` · <em>${r.sin_coincidencia.length} sin coincidencia</em>`:''}${(r.ambiguos||[]).length?` · <em>${r.ambiguos.length} ambiguo(s)</em>`:''}</span>${(r.sin_coincidencia||[]).length?`<span class="lot-resumen-faltantes"><i>No encontrados:</i><code>${this.esc(r.sin_coincidencia.join('  '))}</code></span>`:''}${(r.ambiguos||[]).length?`<span class="lot-resumen-faltantes"><i>Códigos ambiguos:</i><code>${this.esc(r.ambiguos.map(x=>x.codigo).join('  '))}</code></span>`:''}`;
  },

  updateDispatchText(value){this.dispatchText=value;clearTimeout(this.dispatchTimer);this.dispatchTimer=setTimeout(()=>this.resolverDespacho(true),280);},

  clearDispatchText(){
    this.dispatchText='';
    this.dispatchResolution={pedidos:[],encontrados:[],sin_coincidencia:[],ambiguos:[],items:[],cantidad_pallets:0};
    this.renderDespacho();
    if(this.dispatchOverlay){
      this.lotHost().innerHTML=this.dispatchPanelHtml();
      this.anclarDispatchPanel();
      document.getElementById('lotsTextarea')?.focus();
    }
  },

  async resolverDespacho(mantenerPanel=false){
    if(!String(this.dispatchText||'').trim()){
      this.dispatchResolution={pedidos:[],encontrados:[],sin_coincidencia:[],ambiguos:[],items:[],cantidad_pallets:0};
      if(mantenerPanel){const s=document.getElementById('lotResumen');if(s)s.innerHTML=this.lotSummaryHtml();}
      return this.dispatchResolution;
    }
    try{
      this.dispatchResolution=await OperacionesBackendModel.resolverCodigos(this.dispatchText);
      if(mantenerPanel){const s=document.getElementById('lotResumen');if(s)s.innerHTML=this.lotSummaryHtml();}
      return this.dispatchResolution;
    }catch(error){this.toast(error.message,'error');throw error;}
  },

  async applyDispatchOverlay(){
    try{
      const r=await this.resolverDespacho(true);
      if(!r.items?.length)return this.toast('Ningún código ingresado pudo resolverse en el stock actual.','error');
      if(r.ambiguos?.length)return this.toast('Hay códigos ambiguos. Use el ID de lote completo antes de continuar.','warning');
      this.closeDispatchOverlay();
      this.renderDespacho();
    }catch(_){/* mensaje ya mostrado */}
  },

  async submitPedido(event){
    event.preventDefault();
    const motivo=String(event.currentTarget.reason.value||'').trim();
    if(!motivo)return this.setError('dispatchError','Debe ingresar el motivo / justificación del Pedido.');
    this.setError('dispatchError','');
    try{
      const r=await this.resolverDespacho(false);
      if(!r.items?.length)return this.setError('dispatchError','Ninguno de los códigos ingresados existe en el inventario actual.');
      if(r.ambiguos?.length)return this.setError('dispatchError','Hay códigos ambiguos. Use el ID de lote completo.');
      if(r.sin_coincidencia?.length){this._pedidoPendiente={motivo};return this.confirmarPedidoParcial(r);}
      await this.ejecutarPedido(motivo,false);
    }catch(error){this.setError('dispatchError',error.message);}
  },

  confirmarPedidoParcial(r){
    document.getElementById('opsModal')?.remove();
    document.body.insertAdjacentHTML('beforeend',`<div id="opsModal" class="ops-modal-backdrop" onclick="if(event.target===this)this.remove()"><div class="ops-modal" role="dialog" aria-modal="true"><header><h3>Códigos sin coincidencia</h3><button onclick="document.getElementById('opsModal').remove()">×</button></header><p>Se encontraron <b>${r.items.length}</b> pallet(s), pero ${r.sin_coincidencia.length} código(s) no existen en el stock actual. Si continúa, sólo los encontrados pasarán a PEDIDO.</p><div class="lot-resumen-faltantes"><code>${this.esc(r.sin_coincidencia.join('  '))}</code></div><footer><button class="ops-action secondary" onclick="document.getElementById('opsModal').remove()">CANCELAR</button><button class="ops-action success" onclick="OperacionesBackendController.confirmarPedidoParcialEjecutar()">APLICAR ENCONTRADOS</button></footer></div></div>`);
  },

  async confirmarPedidoParcialEjecutar(){
    document.getElementById('opsModal')?.remove();
    const p=this._pedidoPendiente;
    this._pedidoPendiente=null;
    if(p)await this.ejecutarPedido(p.motivo,true);
  },

  async ejecutarPedido(motivo,confirmarParcial){
    try{
      const r=await OperacionesBackendModel.aplicarPedido(this.dispatchText,motivo,confirmarParcial);
      this.toast(`${r.modificados} pallet(s) enviados a PEDIDO${r.sin_coincidencia?.length?` · ${r.sin_coincidencia.length} código(s) omitidos`:''}.`);
      await this.resolverDespacho(false);
      this.renderDespacho();
    }catch(error){this.setError('dispatchError',error.message);}
  },

  /* ======================= GESTIÓN DE APROBACIONES ======================= */
  initAprobaciones(container){
    this.container=container;
    this.approvalFilters={estado:'TODOS',articulo:'TODOS'};
    this.approvalItems=[];
    this.approvalTotal=0;
    this.approvalData=null;
    this.requestId+=1;
    this.cargarAprobaciones(true);
  },

  async cargarAprobaciones(reset=false){
    const req=++this.requestId;
    if(reset){this.approvalItems=[];this.approvalData=null;}
    if(reset)this.pintarAprobaciones(true);
    try{
      const data=await OperacionesBackendModel.aprobaciones({...this.approvalFilters,limite:this.APPROVAL_PAGE,offset:this.approvalItems.length});
      if(req!==this.requestId)return;
      this.approvalItems.push(...(data.items||[]));
      this.approvalTotal=Number(data.total||0);
      this.approvalData=data;
      this.pintarAprobaciones(false);
    }catch(error){
      if(req===this.requestId)this.container.innerHTML=`<section class="operations-view approvals-view">${DashboardController.operationalHeader({eyebrow:'CONTROL GERENCIAL',title:'Gestión de Aprobaciones',status:'Supabase como fuente de verdad'})}${this.errorHtml(error)}</section>`;
    }
  },

  approvalFilterBar(){
    const o=this.approvalData?.opciones||{},states=['TODOS',...(o.estados||[])],arts=['TODOS',...(o.articulos||[])];
    return `<div class="approval-filter-bar">
      <label>Filtrar Estado<select class="form-control" onchange="OperacionesBackendController.setApprovalFilter('estado',this.value)">${states.map(x=>`<option value="${this.esc(x)}" ${this.approvalFilters.estado===x?'selected':''}>${this.esc(x)}</option>`).join('')}</select></label>
      <label>Filtrar N° Artículo<select class="form-control" onchange="OperacionesBackendController.setApprovalFilter('articulo',this.value)">${arts.map(x=>`<option value="${this.esc(x)}" ${this.approvalFilters.articulo===x?'selected':''}>${this.esc(x)}</option>`).join('')}</select></label>
      <button type="button" class="ops-link ops-clear-button ${this.approvalFilters.estado!=='TODOS'||this.approvalFilters.articulo!=='TODOS'?'has-active':''}" onclick="OperacionesBackendController.clearApprovalFilters()" ${this.approvalFilters.estado==='TODOS'&&this.approvalFilters.articulo==='TODOS'?'disabled':''}><span>↺</span><b>Limpiar<em> filtros</em></b></button>
    </div>`;
  },

  approvalInsights(){
    const s=this.approvalData?.resumen||{};
    return `<div class="approval-insights">
      <article class="approval-insight pending"><span>◫</span><div><small>Pallets pendientes</small><strong>${this.fmt(s.pallets)}</strong><em>Requieren decisión</em></div></article>
      <article class="approval-insight weight"><span>◆</span><div><small>Kilos comprometidos</small><strong>${this.fmt(s.kilos)}</strong><em>Peso registrado</em></div></article>
      <article class="approval-insight boxes"><span>▦</span><div><small>Cajas asociadas</small><strong>${this.fmt(s.cajas)}</strong><em>Volumen pendiente</em></div></article>
      <article class="approval-insight articles"><span>◇</span><div><small>Artículos distintos</small><strong>${this.fmt(s.articulos)}</strong><em>Diversidad</em></div></article>
      <article class="approval-insight alerts"><span>!</span><div><small>Observados</small><strong>${this.fmt(s.alertas)}</strong><em>Cola gerencial</em></div></article>
    </div>`;
  },

  pintarAprobaciones(loading=false){
    const d=this.approvalData||{},common=d.motivo_comun,canDecide=this.puede('gerencia.decision'),acciones=d.opciones?.acciones||[];
    this.container.innerHTML=`<section class="operations-view approvals-view">
      ${DashboardController.operationalHeader({eyebrow:'CONTROL GERENCIAL',title:'Gestión de Aprobaciones',status:'Decisiones y subestados gobernados por Supabase'})}
      <div class="approval-command-center">
        <div class="approval-command-heading">
          <div><span class="approval-eyebrow">COLA DE DECISIÓN GERENCIAL</span><h2>Revisión de pallets observados</h2><p>El frontend no asigna estados: envía la decisión y Supabase resuelve estado, modalidad y condiciones pendientes.</p></div>
          <span class="approval-live-state"><i></i>${this.approvalTotal?'Pendientes activos':'Cola al día'}</span>
        </div>
        ${this.approvalInsights()}
        ${this.approvalFilterBar()}
        ${canDecide?`<div class="approval-actions">
          <button id="packingButton" class="approval-action-card packing" onclick="OperacionesBackendController.generatePackingList()" ${this.approvalTotal?'':'disabled'}><span class="approval-action-icon">✉</span><span><b>Generar Packing List</b><small>Preparar los pallets filtrados</small></span><span class="approval-action-arrow">→</span></button>
          <div class="approval-decision-group">
            ${acciones.includes('APROBAR')?`<button class="approval-action-card approve" onclick="OperacionesBackendController.confirmDecision('APROBAR')" ${this.approvalTotal?'':'disabled'}><span class="approval-action-icon">✓</span><span><b>Aprobar lote</b><small>Autorizar a enviar como LIBERADO o RETAIL</small></span></button>`:''}
            ${acciones.includes('REPROCESO')?`<button class="approval-action-card reprocess" onclick="OperacionesBackendController.confirmDecision('REPROCESO')" ${this.approvalTotal?'':'disabled'}><span class="approval-action-icon">↻</span><span><b>Mandar a reproceso</b><small>Derivar al flujo de reproceso</small></span></button>`:''}
          </div>
        </div>`:''}
      </div>
      ${common?`<div class="common-reason approval-context"><span>ⓘ</span><div><b>Motivo común detectado</b><p>${this.esc(common)}</p></div></div>`:''}
      <div class="approval-table-shell">
        ${loading?'<div class="ops-empty">Consultando cola de aprobación…</div>':this.approvalItems.length?this.approvalCards(this.approvalItems):'<div class="ops-empty">No hay pallets pendientes para los filtros actuales.</div>'}
        ${!loading&&this.approvalItems.length<this.approvalTotal?`<button class="load-more" onclick="OperacionesBackendController.cargarAprobaciones(false)">Cargar más (${this.approvalItems.length} de ${this.approvalTotal})</button>`:''}
      </div>
      <div id="approvalError" class="ops-error"></div>
    </section>`;
    DashboardController.startOperationalClock();
  },

  approvalCards(items){
    return `<div class="ops-table-shell"><div class="ops-card-list">${items.map(p=>`
      <article class="ops-card approval-state-card" onclick="OperacionesBackendController.toggleCard(this,event)">
        <div class="ops-card-head">
          <div class="ops-card-id"><b>${this.esc(p.id_lote||'—')}</b><small>${this.esc(p.itemcode||'—')} · ${this.esc(p.itemname||'—')}</small></div>
          <div class="ops-card-flag ops-state-flag"><small>CALIDAD SAP</small>${this.badge(p.estado_sap||'SIN INFORMACIÓN','quality')}</div>
          <button type="button" class="ops-card-toggle" aria-expanded="false"><i></i></button>
        </div>
        <div class="ops-card-metrics">
          <div><small>KILOS</small><span><b class="kilos">${this.fmt(p.kilos)}</b></span></div>
          <div><small>CAJAS</small><span>${this.fmt(p.cajas)}</span></div>
          <div><small>FEC. INGRESO</small><span>${this.esc(p.fecha_ingreso_display)}</span></div>
          <div><small>ESTADO COLA</small><span>${this.badge(p.flujo_display||p.estado||'—')}</span></div>
        </div>
        ${this.stateStrip(p,{queue:true})}
        ${this.orderDelay(p)}
        <div class="ops-card-notes">
          <div><small>INFO CALIDAD</small><span>${this.textButton('Info Calidad',p.info_calidad||'Sin información de calidad.')}</span></div>
          <div><small>INFO GENERAL</small><span>${this.textButton('Info General',p.info_general||'Sin información general.')}</span></div>
        </div>
        <div class="ops-card-reason"><small>MOTIVO DE LA DECISIÓN</small><input class="form-control reason-input" value="${this.esc(p.motivo_decision||'')}" placeholder="Motivo de la decisión gerencial" onblur="OperacionesBackendController.saveReason(${Number(p.instancia_id)},this.value,${p.motivo_version===null||p.motivo_version===undefined?'null':Number(p.motivo_version)})" onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur()}"></div>
        <div class="ops-card-detail"><div class="ops-card-more">
          <div class="ops-card-kv">
            <div><small>ESTADO WMS REGISTRADO</small><span>${this.badge(p.estado_wms_registrado_display||'SIN ESTADO WMS PROPIO')}</span></div>
            <div><small>ESTADO OPERATIVO EFECTIVO</small><span>${this.badge(p.estado_operativo_display||'SIN ESTADO')}</span></div>
            <div><small>CONDICIONES WMS</small><span>${this.esc(p.condiciones_display)}</span></div>
            <div><small>DETECTOR</small><span>${this.badge(p.detector_display||p.detector_de||'SIN INFORMACIÓN','detector')}</span></div>
            <div><small>RESERVA SAP</small><span>${this.esc(p.reservado||'SIN RESERVA')}</span></div>
            <div><small>ALMACÉN SAP</small><span>${this.esc(p.whsname||p.whscode||'—')}</span></div>
          </div>
          ${this.auditBlock(p)}
        </div></div>
      </article>`).join('')}</div></div>`;
  },

  setApprovalFilter(key,value){this.approvalFilters[key]=value;this.cargarAprobaciones(true);},
  clearApprovalFilters(){this.approvalFilters={estado:'TODOS',articulo:'TODOS'};this.cargarAprobaciones(true);},

  async saveReason(id,value,version){
    try{
      const r=await OperacionesBackendModel.motivoAprobacion(id,value,version);
      const item=this.approvalItems.find(x=>Number(x.instancia_id)===Number(id));
      if(item){item.motivo_decision=r.motivo_decision;item.motivo_version=r.version;}
      this.toast('Motivo actualizado.');
    }catch(error){
      this.toast(error.message,'error');
      if(error.conflictoVersion)this.cargarAprobaciones(true);
    }
  },

  async confirmDecision(decision){
    try{
      const all=await OperacionesBackendModel.aprobacionesTodas(this.approvalFilters);
      if(!all.items.length)return this.setError('approvalError','La cola ya no contiene pallets para este filtro.');
      this._approvalDecision={decision,items:all.items};
      const modalities=this.approvalData?.opciones?.modalidades_aprobacion||[];
      document.getElementById('approvalDecisionModal')?.remove();
      document.body.insertAdjacentHTML('beforeend',`<div id="approvalDecisionModal" class="ops-modal-backdrop approval-confirm-backdrop" onclick="if(event.target===this)this.remove()"><section class="ops-modal approval-confirm ${decision==='APROBAR'?'approve':'reprocess'}" role="dialog" aria-modal="true"><header><div class="approval-confirm-title"><span>${decision==='APROBAR'?'✓':'↻'}</span><div><small>CONFIRMACIÓN GERENCIAL</small><h3>${decision==='APROBAR'?'Aprobar lote':'Mandar a reproceso'}</h3></div></div><button onclick="document.getElementById('approvalDecisionModal').remove()">×</button></header><p class="approval-confirm-copy">La decisión se aplicará a <strong>${all.items.length} pallet(s)</strong> del filtro actual.</p>${decision==='APROBAR'?`<label class="approval-mode-field">Modalidad de autorización<select id="approvalModalidad" class="form-control"><option value="">Seleccione…</option>${modalities.map(x=>`<option value="${this.esc(x)}">${this.esc(x)}</option>`).join('')}</select><small>Supabase guardará AUTORIZADO A ENVIAR + modalidad. El estado final puede quedar LIBERADO o mantener condiciones WMS pendientes.</small></label>`:`<div class="approval-confirm-impact">Supabase enviará estos pallets al flujo REPROCESO y conservará la auditoría gerencial.</div>`}<footer><button class="ops-action secondary" onclick="document.getElementById('approvalDecisionModal').remove()">Cancelar</button><button class="ops-action ${decision==='APROBAR'?'approve':'reprocess'}" onclick="OperacionesBackendController.executeApprovalDecision()">Confirmar decisión</button></footer></section></div>`);
    }catch(error){this.setError('approvalError',error.message);}
  },

  async executeApprovalDecision(){
    const p=this._approvalDecision;if(!p)return;
    const modalidad=p.decision==='APROBAR'?document.getElementById('approvalModalidad')?.value:null;
    if(p.decision==='APROBAR'&&!modalidad)return this.toast('Seleccione modalidad LIBERADO o RETAIL.','warning');
    try{
      const r=await OperacionesBackendModel.decidirAprobacion(p.items.map(x=>x.instancia_id),p.decision,modalidad);
      document.getElementById('approvalDecisionModal')?.remove();
      this._approvalDecision=null;
      if(p.decision==='APROBAR')this.toast(`${r.cantidad} pallet(s) autorizados a enviar · ${r.modalidad}. Liberados inmediatos: ${r.liberados_inmediatos||0}; con condiciones pendientes: ${r.bloqueados_por_condiciones||0}.`);
      else this.toast(`${r.cantidad} pallet(s) enviados a REPROCESO.`);
      this.cargarAprobaciones(true);
    }catch(error){
      this.toast(error.message,'error');
      if(error.conflictoCola)this.cargarAprobaciones(true);
    }
  },

  async generatePackingList(){
    const button=document.getElementById('packingButton');
    if(button)button.disabled=true;
    try{
      const all=await OperacionesBackendModel.aprobacionesTodas(this.approvalFilters);
      if(!all.items.length)return this.toast('No hay pallets pendientes para generar Packing List.','warning');
      const r=await OperacionesBackendModel.packingAprobacion(all.items.map(x=>x.instancia_id));
      const name=OperacionesBackendModel.exportarPacking(r);
      this.toast(`${r.lote_id}: Packing List generado (${r.cantidad} pallets) · ${name}.`);
    }catch(error){this.toast(error.message,'error');}
    finally{if(button)button.disabled=false;}
  }
};
