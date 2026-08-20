/** UI web completa para Movimientos, Despacho y Gestión de Aprobaciones. */
const OperacionesController = {
  container:null,selected:new Set(),movementFilters:{search:'',state:'TODOS',detector:'TODOS'},MOVEMENT_PAGE:120,movementLimit:120,
  dispatchText:null,dispatchOverlay:false,dispatchDestination:'AUTORIZADOS A ENVIAR',dispatchClass:'',
  approvalFilters:{estado:'TODOS',articulo:'TODOS'},
  /* Escape unico del proyecto: SeguridadService.escaparHtml. Antes cada
     archivo tenia el suyo y seis de ellos no escapaban comillas, lo que dejaba
     abierta la inyeccion dentro de atributos. */
  esc(v) { return SeguridadService.escaparHtml(v); },

  /* --- Alto exacto de la lista de tarjetas --------------------------------
     Cuantas filas se muestran es decision de formato, asi que vive en CSS
     (--ops-rows en operaciones.css). Cuanto MIDE una fila no puede vivir en
     CSS: la misma tarjeta cambia de alto segun su contenido (la alerta de
     pedido atrasado suma ~62px y el motivo de Aprobaciones suma ~66px), asi
     que cualquier valor fijo en pixeles dejaba la ultima tarjeta cortada por
     la mitad. Aqui se mide lo realmente renderizado y el tope cae justo en el
     borde inferior de la ultima fila completa. El max-height de CSS queda
     como valor de respaldo para el primer pintado. */
  ajustarAltoLista(lista){
    if(!lista||!lista.children.length)return;
    const estilo=getComputedStyle(lista);
    const filas=parseInt(estilo.getPropertyValue('--ops-rows'),10)||6;
    const columnas=(estilo.getPropertyValue('grid-template-columns').match(/px/g)||['']).length||1;
    const relleno=parseFloat(estilo.paddingBottom)||0;
    /* El corte lo marca la tarjeta MAS ALTA de la ultima fila visible, no la
       ultima de la grilla: con grid-auto-rows:max-content y align-items:start
       las tarjetas de una misma fila no miden lo mismo (una con alerta de
       pedido atrasado sobresale ~35px sobre su vecina) y tomar solo la ultima
       dejaba cortada a la de al lado. */
    const fin=Math.min(filas*columnas,lista.children.length),inicio=Math.max(0,fin-columnas);
    let borde=0;
    for(let i=inicio;i<fin;i++)borde=Math.max(borde,lista.children[i].getBoundingClientRect().bottom);
    if(!borde)return;
    const alto=borde-lista.getBoundingClientRect().top+lista.scrollTop+relleno;
    lista.style.setProperty('max-height',`${Math.ceil(alto)}px`);
  },
  /* Se recalcula tras cada render y al cambiar el tamano de la ventana, que
     es cuando --ops-rows puede saltar de tramo (8 en PC, 5 en telefono). */
  ajustarListas(){
    requestAnimationFrame(()=>document.querySelectorAll('.ops-card-list').forEach(l=>this.ajustarAltoLista(l)));
    if(this._listasVigiladas)return;
    this._listasVigiladas=true;
    let espera;
    window.addEventListener('resize',()=>{clearTimeout(espera);espera=setTimeout(()=>this.ajustarListas(),150);},{passive:true});
  },
  toast(text,type='ok'){return NotificationService.show(text,{type});},
  error(target,text){const x=document.getElementById(target);if(x)x.textContent=text||'';},
  badge(value,type='state'){let color='#64748b';if(type==='quality')color=value==='BLOQUEADO'?'#ef4444':'#10b981';else if(type==='detector')color=value==='RECHAZADO'?'#ef4444':'#10b981';else if(type==='reserved')color=value==='SÍ'?'#f59e0b':'#64748b';else{const key=Object.keys(COLORES_MAPA_ESTADO).find(k=>OperacionesModel.sameState(k,value));color=key?COLORES_MAPA_ESTADO[key]:'#f59e0b';}return `<span class="ops-badge" style="--badge:${color}">${this.esc(value)}</span>`;},
  cell(p,key){if(key==='lote_display')return `<code class="lote-code">${this.esc(p[key]??'—')}</code>`;if(key==='estado_calidad_display')return this.badge(p[key],'quality');if(key==='estado')return this.badge(p[key]);if(key==='detector_display')return this.badge(p[key],'detector');if(key==='reservado_display')return this.badge(p[key],'reserved');if(key==='calidad_display'||key==='general_display')return `<button class="cell-text" title="${this.esc(p[key])}" onclick="OperacionesController.showText('${key==='calidad_display'?'Info Calidad':'Info General'}',this.dataset.text)" data-text="${this.esc(p[key])}">${this.esc(p[key])}</button>`;if(key==='kilos_display')return `<b class="kilos">${Number(p[key]).toLocaleString('es-CL')}</b>`;return this.esc(p[key]??'—');},
  /* --- Vista en tarjetas de Movimientos de Camara -------------------------
     La tabla de 12 columnas mide ~1476px y obliga a scroll horizontal en
     cualquier resolucion (incluso en PC con la barra lateral plegada), por
     lo que RESERVADO quedaba fuera de pantalla. Se reemplaza por una grilla
     de tarjetas en TODOS los anchos: identificacion, metricas, las dos notas
     operacionales y, al desplegar, detector + reserva + auditoria.
     El numero de columnas lo decide la grilla CSS (auto-fill), asi que al
     plegar la barra lateral el listado reaprovecha el ancho automaticamente
     sin depender de JS. Reutiliza cell() y toggleSelected(), por lo que
     badges, modal de info y seleccion se comportan igual que en la tabla. */
  /* La tarjeta completa abre el detalle. Se ignoran los clics sobre
     controles propios (casilla, boton de nota) para no interferir. */
  toggleCard(el,event){
    const card=el.closest('.ops-card');if(!card)return;
    if(event){const t=event.target;if(t.closest&&t.closest('input,a,label')&&!t.closest('.ops-card-toggle'))return;
      if(t.closest&&t.closest('button')&&!t.closest('.ops-card-toggle'))return;}
    const open=card.classList.toggle('open');
    const button=card.querySelector('.ops-card-toggle');
    if(button)button.setAttribute('aria-expanded',open?'true':'false');
  },
  /* --- Alerta de pedido atrasado, compartida por las cinco tarjetas ------
     La regla de los 2 dias existia desde antes, pero solo se pintaba en la
     tabla 'Pallets pendientes' de Bitacora: un pallet PEDIDO con cinco dias
     de atraso se veia igual que uno de hoy en Movimientos, Despacho, Stock y
     Reportes. Estos dos helpers la hacen transversal sin duplicar la regla:
     el calculo sigue viviendo en PanelControlModel.diasAtrasoPedido(). */
  orderDays(p){
    if(!p||String(p.estado||'').toLocaleUpperCase('es')!=='PEDIDO')return undefined;
    if(typeof PanelControlModel==='undefined'||typeof PanelControlModel.diasAtrasoPedido!=='function')return undefined;
    return PanelControlModel.diasAtrasoPedido(p.fecha_pedido);
  },
  orderFlagClass(p){const d=this.orderDays(p);return (d!==undefined&&d!==null&&d>=2)?' is-late':'';},
  orderDelay(p){
    const dias=this.orderDays(p);
    if(dias===undefined)return '';
    if(dias===null)return `<div class="ops-card-alert"><span class="ops-delay unknown"><i class="wi wi-clock"></i>Pedido sin fecha registrada</span></div>`;
    const fecha=PanelControlModel.fechaPedidoVisible(p.fecha_pedido)||'—';
    const texto=dias===0?'Pedido ingresado hoy':dias===1?'1 día en pedido':`${dias} días en pedido`;
    return `<div class="ops-card-alert"><span class="ops-delay${dias>=2?' late':''}" title="Pedido ingresado el ${this.esc(fecha)}"><i class="wi wi-clock"></i>${texto}${dias>=2?' · ATRASADO':''}</span></div>`;
  },
  auditBlock(p){
    const entry=typeof OperacionesModel.lastAudit==='function'?OperacionesModel.lastAudit(p.id):null;
    if(!entry)return `<div class="ops-card-audit empty"><span class="ops-audit-title">AUDITORÍA</span><p>Sin movimientos registrados para este pallet.</p></div>`;
    const motivo=entry.detalle&&(entry.detalle.motivo||entry.detalle.correo_motivo);
    return `<div class="ops-card-audit">
      <span class="ops-audit-title">AUDITORÍA · ÚLTIMO MOVIMIENTO</span>
      <dl>
        <div><dt>Acción</dt><dd>${this.esc(OperacionesModel.auditLabel(entry.accion))}</dd></div>
        <div><dt>Usuario</dt><dd>${this.esc(entry.usuario||'—')}</dd></div>
        <div><dt>Fecha</dt><dd>${this.esc(entry.fecha||'—')}</dd></div>
        <div class="wide"><dt>Motivo</dt><dd>${this.esc(motivo||'Sin motivo informado')}</dd></div>
      </dl>
    </div>`;
  },
  cards(items,{checkbox=false,id='opsCards'}={}){
    const metrics=[['kilos_display','KILOS'],['cajas','CAJAS'],['fecha_fabricacion_display','FEC. FABRIC.'],['estado','ESTADO']];
    const notes=[['calidad_display','INFO CALIDAD'],['general_display','INFO GENERAL']];
    const detail=[['detector_display','DETECTOR METALES'],['reservado_display','RESERVADO']];
    return `<div class="ops-table-shell"><div id="${id}" class="ops-card-list">${items.map(p=>`
      <article class="ops-card${this.orderFlagClass(p)}" onclick="OperacionesController.toggleCard(this,event)">
        <div class="ops-card-head">${checkbox?`<label class="ops-card-check"><input type="checkbox" aria-label="Seleccionar ${this.esc(p.id)}" ${this.selected.has(p.id)?'checked':''} onchange="OperacionesController.toggleSelected('${p.id}',this.checked)"></label>`:''}
          <div class="ops-card-id"><b>${this.esc(p.lote_display??'—')}</b><small>${this.esc(p.articulo_display??'—')} · ${this.esc(p.descripcion_display??'—')}</small></div>
          <div class="ops-card-flag">${this.cell(p,'estado_calidad_display')}</div>
          <button type="button" class="ops-card-toggle" aria-expanded="false" aria-label="Ver auditoría y detalle del lote ${this.esc(p.lote_display??'')}"><i></i></button>
        </div>
        <div class="ops-card-metrics">${metrics.map(([k,l])=>`<div><small>${l}</small><span>${this.cell(p,k)}</span></div>`).join('')}</div>
        ${this.orderDelay(p)}
        <div class="ops-card-notes">${notes.map(([k,l])=>`<div><small>${l}</small><span>${this.cell(p,k)}</span></div>`).join('')}</div>
        <div class="ops-card-detail"><div class="ops-card-more">
          <div class="ops-card-kv">${detail.map(([k,l])=>`<div><small>${l}</small><span>${this.cell(p,k)}</span></div>`).join('')}</div>
          ${this.auditBlock(p)}
        </div></div>
      </article>`).join('')}</div></div>`;
  },
  showText(title,text){document.getElementById('opsModal')?.remove();document.body.insertAdjacentHTML('beforeend',`<div id="opsModal" class="ops-modal-backdrop" onclick="if(event.target===this)this.remove()"><div class="ops-modal" role="dialog" aria-modal="true"><header><h3>${this.esc(title)}</h3><button onclick="document.getElementById('opsModal').remove()" aria-label="Cerrar">×</button></header><p>${this.esc(text)}</p><footer><button class="ops-action secondary" onclick="document.getElementById('opsModal').remove()">CERRAR</button></footer></div></div>`);},

  initMovimientos(container){this.container=container;this.selected.clear();this.movementLimit=this.MOVEMENT_PAGE;this.renderMovimientos();},
  renderMovimientos(){
    const all=OperacionesModel.filterMovements(this.movementFilters),items=all.slice(0,this.movementLimit),activeFilters=[Boolean(this.movementFilters.search.trim()),this.movementFilters.state!=='TODOS',this.movementFilters.detector!=='TODOS'].filter(Boolean).length,selectedCount=this.selected.size,canClear=activeFilters||selectedCount;
    this.container.innerHTML=`<section class="operations-view">${DashboardController.operationalHeader({ eyebrow:'FLUJO OPERATIVO', title:'Movimientos de Cámara', status:'Lotes y artículos registrados en línea' })}<p class="ops-section-label">FLUJO OPERATIVO: LOTES Y ARTÍCULOS REGISTRADOS</p><div class="ops-filter-bar"><label>Buscar por Lote, Artículo o ID<input id="movementSearch" class="form-control" placeholder="Escriba para buscar..." value="${this.esc(this.movementFilters.search)}" oninput="OperacionesController.setMovementFilter('search',this.value)"></label><label class="ops-select-field">Filtrar Estado Actual<select class="form-control" onchange="OperacionesController.setMovementFilter('state',this.value)">${['TODOS',...OperacionesModel.MOVEMENT_STATES].map(x=>`<option ${this.movementFilters.state===x?'selected':''}>${x}</option>`).join('')}</select></label><label class="ops-select-field">Filtrar Detector Metales<select class="form-control" onchange="OperacionesController.setMovementFilter('detector',this.value)">${['TODOS','APROBADO','RECHAZADO'].map(x=>`<option ${this.movementFilters.detector===x?'selected':''}>${x}</option>`).join('')}</select></label><button class="ops-link ops-clear-button ${canClear?'has-active':''}" onclick="OperacionesController.clearSelection()" ${canClear?'':'disabled'} title="Restablecer búsqueda, filtros y pallets seleccionados"><span>↺</span><b>Limpiar<em> filtros</em></b>${canClear?`<small>${activeFilters}<em> activo${activeFilters===1?'':'s'}</em>${selectedCount?`<em> · </em>${selectedCount}<em> seleccionado${selectedCount===1?'':'s'}</em>`:''}</small>`:''}</button></div><div id="movementResults" class="ops-results">${items.length?this.cards(items,{checkbox:true,id:'movementCards'}):'<div class="ops-empty">Ningún pallet coincide con los filtros de búsqueda.</div>'}${all.length>items.length?`<button class="load-more" onclick="OperacionesController.loadMoreMovements()"><i class="wi wi-down"></i>Cargar ${Math.min(this.MOVEMENT_PAGE,all.length-items.length)} más (mostrando ${items.length} de ${all.length})</button>`:`<p class="result-count">Mostrando ${items.length} pallet(s) que coinciden con los filtros.</p>`}</div><form class="ops-bottom-panel movement" onsubmit="OperacionesController.submitMovement(event)"><h3>🔁 RECLASIFICAR ESTADO (MOVER ENTRE TABLAS)</h3><div class="ops-bottom-grid movement-grid"><label>Mover a Estado (Tabla)<select name="target" class="form-control"><option value="">Seleccione…</option>${OperacionesModel.TARGET_STATES.map(x=>`<option>${x}</option>`).join('')}</select></label><label class="reason-field">Justificación / Motivo Técnico (Obligatorio)<textarea name="reason" class="form-control" rows="2" placeholder="Especificar motivo técnico de la reclasificación..."></textarea></label><button class="ops-action success" type="submit"><i class="wi wi-check"></i>PROCESAR</button></div><div id="movementError" class="ops-error"></div></form></section>`;DashboardController.startOperationalClock();this.ajustarListas();
  },
  setMovementFilter(k,v){const box=k==='search'?document.getElementById('movementSearch'):null,caret=box?box.selectionStart:null;this.movementFilters[k]=v;this.movementLimit=this.MOVEMENT_PAGE;this.renderMovimientos();if(k==='search')this.restoreMovementSearchFocus(caret);},restoreMovementSearchFocus(caret){const el=document.getElementById('movementSearch');if(!el)return;const at=Number.isInteger(caret)?Math.min(caret,el.value.length):el.value.length;el.focus({preventScroll:true});el.setSelectionRange(at,at);},toggleSelected(id,on){on?this.selected.add(id):this.selected.delete(id);this.updateMovementClearButton();},updateMovementClearButton(){const button=document.querySelector('.ops-clear-button');if(!button)return;const activeFilters=[Boolean(this.movementFilters.search.trim()),this.movementFilters.state!=='TODOS',this.movementFilters.detector!=='TODOS'].filter(Boolean).length,selectedCount=this.selected.size,canClear=activeFilters||selectedCount;button.disabled=!canClear;button.classList.toggle('has-active',Boolean(canClear));button.innerHTML=`<span>↺</span><b>Limpiar<em> filtros</em></b>${canClear?`<small>${activeFilters}<em> activo${activeFilters===1?'':'s'}</em>${selectedCount?`<em> · </em>${selectedCount}<em> seleccionado${selectedCount===1?'':'s'}</em>`:''}</small>`:''}`;},clearSelection(){const hadFilters=Boolean(this.movementFilters.search.trim())||this.movementFilters.state!=='TODOS'||this.movementFilters.detector!=='TODOS',hadSelection=this.selected.size>0;this.selected.clear();this.movementFilters={search:'',state:'TODOS',detector:'TODOS'};this.movementLimit=50;this.renderMovimientos();if(hadFilters||hadSelection)this.toast('Filtros y selección restablecidos correctamente.');},loadMoreMovements(){this.movementLimit+=this.MOVEMENT_PAGE;this.renderMovimientos();},
  submitMovement(e){e.preventDefault();const f=e.target,r=OperacionesModel.reclassify([...this.selected],f.target.value,f.reason.value);if(!r.ok)return this.error('movementError',r.error);this.selected.clear();this.toast(`Reclasificación completada: ${r.cantidad} pallets movidos a '${r.estado_destino}'.`);this.renderMovimientos();},

  initDespacho(container){this.container=container;/* El buscador arranca VACIO. Antes se autocargaba con los tres primeros
       lotes del stock y el operador los veia como si los hubiera pegado el. */
    if(this.dispatchText===null)this.dispatchText='';this.dispatchOverlay=false;this.renderDespacho();},
  renderDespacho(){const items=OperacionesModel.previewLots(this.dispatchText||'');this.container.innerHTML=`<section class="operations-view dispatch-view">${DashboardController.operationalHeader({ eyebrow:'OPERACIÓN DE DESPACHO', title:'Despacho y Reproceso', status:'Control comercial y de reproceso en línea' })}<div class="ops-title-row"><p class="ops-section-label">ESTADO OPERATIVO DETALLADO DE LOS LOTES INGRESADOS</p>${this.dispatchTriggerHtml()}</div><div class="dispatch-table-area">${items.length?this.cards(items,{id:'dispatchCards'}):`<div class="ops-empty">${this.dispatchText?'❌ Ningún lote coincide con el Stock.':'Esperando ingreso de lotes...'}</div>`}</div><form class="ops-bottom-panel dispatch" onsubmit="OperacionesController.submitDispatch(event)"><h3>🚨 PANEL DE DESPACHO Y REPROCESO</h3><div class="ops-bottom-grid dispatch-grid"><label>Cambiar Estado Comercial a:<select name="destination" class="form-control" onchange="OperacionesController.changeDispatchDestination(this.value)">${OperacionesModel.SHIPPING_STATES.map(x=>`<option ${this.dispatchDestination===x?'selected':''}>${x}</option>`).join('')}</select></label>${this.dispatchDestination==='AUTORIZADOS A ENVIAR'?`<label>Clasificación de Envío<select name="classification" class="form-control"><option value="">Seleccione…</option>${OperacionesModel.SHIPPING_CLASSES.map(x=>`<option ${this.dispatchClass===x?'selected':''}>${x}</option>`).join('')}</select></label>`:''}<label class="reason-field">Justificación / Orden de Gerencia (Obligatorio)<textarea name="reason" class="form-control" rows="2" placeholder="Especificar motivo o número de instrucción..."></textarea></label>${(()=>{const listo=OperacionesModel.matchLots(this.dispatchText||'').pallets.length;return `<button type="submit" class="ops-action success" ${listo?'':'disabled'} title="${listo?`Aplicar el cambio a ${listo} pallet${listo===1?'':'s'}`:'Cargue lotes en Buscar o pegar lotes para habilitar'}"><i class="wi wi-siren"></i>EJECUTAR</button>`})()}</div><div id="dispatchError" class="ops-error"></div></form></section>`;DashboardController.startOperationalClock();this.ajustarListas();},
  /* Boton de la cabecera. Deja de ser un rotulo fijo: dice cuantos codigos
     hay cargados y cuantos pallets resolvieron, que es el dato que el
     operador necesita antes de ejecutar. */
  dispatchTriggerHtml(){
    const r=OperacionesModel.matchLots(this.dispatchText||'');
    if(!r.pedidos.length)return `<button class="lot-search-trigger" onclick="OperacionesController.openDispatchOverlay()"><i class="wi wi-search"></i><span>Buscar o pegar lotes...</span></button>`;
    const falla=r.sinCoincidencia.length;
    return `<button class="lot-search-trigger cargado${falla?' con-faltantes':''}" onclick="OperacionesController.openDispatchOverlay()"><i class="wi wi-search"></i><span><b>${r.pallets.length} pallet${r.pallets.length===1?'':'s'}</b> · ${r.pedidos.length} código${r.pedidos.length===1?'':'s'}${falla?` · ${falla} sin coincidencia`:''}</span></button>`;
  },

  /* Panel flotante anclado al boton, igual que el buscador de Camara Proter
     y Camara Post Tunel: se abre pegado debajo del disparador, por encima del
     contenido, y si abajo no hay lugar se abre hacia arriba.
     Se reutiliza el componente visual del mapa (.map-overlay y
     .search-input-shell); lo unico que cambia es el proposito: alla se
     resaltan celdas, aca se selecciona el lote de trabajo sobre el que
     despues actua EJECUTAR.
     Vive en document.body y se posiciona con position:fixed. Dentro de
     .main-viewport no puede: ese contenedor abre su propio contexto de
     apilamiento (z-index:1) y el panel quedaria por debajo de la barra
     superior. La rutina de anclaje del mapa no se reutiliza tal cual porque
     depende de .map-module y .map-stage, que aca no existen; sigue las mismas
     reglas de colocacion. */
  ANCLA:{ separacion:8, borde:10, minAbajo:190, altoMin:170, altoMax:560, ancho:520, utilMin:360 },

  lotHost(){
    let host=document.getElementById('lotOverlayHost');
    if(!host){host=document.createElement('div');host.id='lotOverlayHost';document.body.appendChild(host);}
    return host;
  },
  openDispatchOverlay(){
    if(this.dispatchOverlay)return this.closeDispatchOverlay();
    this.dispatchOverlay=true;
    this.lotHost().innerHTML=this.dispatchPanelHtml();
    this.anclarPanel();
    const box=document.getElementById('lotsTextarea');
    if(box){box.focus();box.setSelectionRange(box.value.length,box.value.length);}
    this.vigilarPanel();
  },
  closeDispatchOverlay(){this.dispatchOverlay=false;this.lotHost().innerHTML='';},

  /* Colocacion: debajo del boton si hay lugar, arriba si no; siempre dentro
     de la pantalla. En telefono el ancho se reduce al de la ventana. */
  /* scrollHeight del panel no sirve como alto util: cuenta el desborde de los
     hijos recortados y devolvia ~185 px de mas, que se veian como un vacio
     bajo los botones. Se mide de arriba hasta el fondo del ultimo hijo. */
  altoUtilPanel(panel){
    const ultimo=panel.lastElementChild;
    if(!ultimo)return panel.getBoundingClientRect().height;
    const cs=getComputedStyle(panel);
    return Math.ceil(ultimo.getBoundingClientRect().bottom-panel.getBoundingClientRect().top+parseFloat(cs.paddingBottom||0)+parseFloat(cs.borderBottomWidth||0));
  },
  anclarPanel(){
    const panel=document.querySelector('#lotOverlayHost .lot-panel');
    const ancla=document.querySelector('.lot-search-trigger');
    if(!panel||!ancla)return;
    const A=this.ANCLA, r=ancla.getBoundingClientRect();
    const marco={izq:A.borde,arriba:A.borde,der:window.innerWidth-A.borde,abajo:window.innerHeight-A.borde};
    panel.style.setProperty('visibility','hidden','important');
    panel.style.setProperty('max-height','','important');
    panel.style.setProperty('width','','important');
    const ancho=Math.min(A.ancho,marco.der-marco.izq);
    panel.style.setProperty('width',`${Math.round(ancho)}px`,'important');
    const alto=panel.getBoundingClientRect().height;
    const abajo=marco.abajo-r.bottom-A.separacion, arriba=r.top-marco.arriba-A.separacion;
    const haciaAbajo=abajo>=Math.min(alto,A.minAbajo)||abajo>=arriba;
    const disponible=haciaAbajo?abajo:arriba;
    const maxAlto=Math.max(A.altoMin,Math.min(disponible,A.altoMax));
    const tope=(v,min,max)=>Math.min(Math.max(v,min),Math.max(min,max));
    let top,left;
    if(maxAlto<A.utilMin&&alto>maxAlto){
      /* Telefono bajo: pegado al boton no queda alto util para el textarea y
         los botones. Se pasa a hoja flotante centrada, ancha y alta, que es
         como se comporta cualquier panel de este tipo en movil. */
      panel.classList.add('lot-panel-hoja');
      const anchoHoja=marco.der-marco.izq, altoHoja=Math.min(alto,(marco.abajo-marco.arriba));
      panel.style.setProperty('width',`${Math.round(anchoHoja)}px`,'important');
      panel.style.setProperty('max-height',`${Math.floor(marco.abajo-marco.arriba)}px`,'important');
      left=marco.izq;
      top=Math.max(marco.arriba,Math.round((window.innerHeight-altoHoja)/2));
      panel.style.setProperty('left',`${Math.round(left)}px`,'important');
      panel.style.setProperty('top',`${top}px`,'important');
      /* Se ajusta al contenido real ya con el ancho de hoja aplicado: medir
         antes daba de mas y el panel quedaba con un vacio abajo. */
      const util=Math.min(this.altoUtilPanel(panel),marco.abajo-marco.arriba);
      panel.style.setProperty('max-height',`${Math.ceil(util)}px`,'important');
      panel.style.setProperty('top',`${Math.max(marco.arriba,Math.round((window.innerHeight-util)/2))}px`,'important');
      panel.style.setProperty('visibility','visible','important');
      return;
    }
    panel.classList.remove('lot-panel-hoja');
    top=haciaAbajo?r.bottom+A.separacion:r.top-Math.min(alto,maxAlto)-A.separacion;
    left=tope(r.left,marco.izq,marco.der-ancho);
    top=tope(top,marco.arriba,marco.abajo-Math.min(alto,maxAlto));
    panel.style.setProperty('left',`${Math.round(left)}px`,'important');
    panel.style.setProperty('top',`${Math.round(top)}px`,'important');
    panel.style.setProperty('max-height',`${Math.floor(maxAlto)}px`,'important');
    panel.style.setProperty('max-height',`${Math.ceil(Math.min(this.altoUtilPanel(panel),maxAlto))}px`,'important');
    panel.style.setProperty('visibility','visible','important');
  },

  /* Se reacomoda al girar el telefono o al desplazar, y se cierra solo si el
     operador navega a otra seccion o pulsa Escape. */
  vigilarPanel(){
    if(this._panelVigilado)return;
    this._panelVigilado=true;
    this._reanclar=()=>{ if(this.dispatchOverlay)this.anclarPanel(); };
    window.addEventListener('resize',this._reanclar,{passive:true});
    window.addEventListener('scroll',this._reanclar,{passive:true,capture:true});
    document.addEventListener('keydown',e=>{ if(e.key==='Escape'&&this.dispatchOverlay)this.closeDispatchOverlay(); });
    const raiz=document.getElementById('mainViewport')||document.querySelector('.main-viewport');
    if(raiz)new MutationObserver(()=>{ if(this.dispatchOverlay&&!document.querySelector('.dispatch-view'))this.closeDispatchOverlay(); })
      .observe(raiz,{childList:true,subtree:true});
  },

  dispatchPanelHtml(){
    return `<aside class="map-overlay lot-panel" role="dialog" aria-label="Buscar o pegar lotes"><header><h3>Buscar o pegar lotes</h3><button type="button" onclick="OperacionesController.closeDispatchOverlay()" aria-label="Cerrar">&times;</button></header><p>Una columna de Excel: 1 código, 20 o trescientos. Se aceptan líneas, comas, tabulaciones, punto y coma y barra vertical.</p><p class="lot-formatos"><b>Formatos válidos:</b> ID de lote completo <code>263011027001</code> · código visual <code>A-01</code> o <code>A01</code>.</p><div class="search-input-shell"><textarea id="lotsTextarea" rows="9" spellcheck="false" placeholder="263011027001&#10;A-01&#10;A01" oninput="OperacionesController.updateDispatchText(this.value)">${this.esc(this.dispatchText)}</textarea><small id="lotResumen">${this.lotSummaryHtml()}</small></div><div class="lot-panel-acciones"><button type="button" class="ops-action secondary" onclick="OperacionesController.clearDispatchText()"><i class="wi wi-clean"></i>VACIAR</button><button type="button" class="ops-action success" onclick="OperacionesController.applyDispatchOverlay()"><i class="wi wi-check"></i>APLICAR</button></div></aside>`;
  },
  /* Resumen en vivo. Lo que no calza se muestra completo y seleccionable:
     con cien codigos pegados, saber que fallaron trece no sirve de nada si
     no se puede ver cuales. */
  lotSummaryHtml(){
    const r=OperacionesModel.matchLots(this.dispatchText||'');
    if(!r.pedidos.length)return `<span class="lot-resumen-vacio">Sin códigos ingresados.</span>`;
    const falta=r.sinCoincidencia;
    return `<span class="lot-resumen-cuenta"><b>${r.encontrados.length} de ${r.pedidos.length}</b> encontrado${r.pedidos.length===1?'':'s'} · <b>${r.pallets.length}</b> pallet${r.pallets.length===1?'':'s'}${falta.length?` · <em>${falta.length} sin coincidencia</em>`:''}</span>${falta.length?`<span class="lot-resumen-faltantes"><i>No existen en el stock actual:</i><code>${this.esc(falta.join('  '))}</code></span>`:''}`;
  },
  refreshLotSummary(){
    const caja=document.getElementById('lotResumen');
    if(caja)caja.innerHTML=this.lotSummaryHtml();
  },
  /* Se guarda el texto TAL CUAL lo escribe el operador. La version anterior
     normalizaba en cada tecla y reescribia el textarea, lo que peleaba con
     el cursor. La normalizacion vive en el modelo, donde corresponde. */
  updateDispatchText(v){this.dispatchText=v;this.refreshLotSummary();},
  /* VACIAR tiene que limpiar TODO, no solo el campo. Antes solo borraba el
     texto y el resumen: el disparador seguia anunciando el lote anterior y la
     lista seguia mostrando sus pallets, asi que al pulsar EJECUTAR el sistema
     reclamaba lotes que el operador ya habia quitado. */
  clearDispatchText(){
    this.dispatchText='';
    this.renderDespacho();
    const box=document.getElementById('lotsTextarea');
    if(box){box.value='';box.focus();}
    this.refreshLotSummary();
    this.anclarPanel();
  },
  applyDispatchOverlay(){
    const box=document.getElementById('lotsTextarea');
    if(!String(this.dispatchText||'').trim()){this.toast('Pegue o ingrese al menos un lote antes de aplicar.','warning');box?.focus();return;}
    const r=OperacionesModel.matchLots(this.dispatchText);
    if(!r.pallets.length){this.toast('Ninguno de los códigos ingresados existe en el stock actual.','error');box?.focus();return;}
    this.closeDispatchOverlay();
    this.renderDespacho();
    this.toast(`${r.pallets.length} pallet${r.pallets.length===1?'':'s'} cargado${r.pallets.length===1?'':'s'} para procesar${r.sinCoincidencia.length?` · ${r.sinCoincidencia.length} código${r.sinCoincidencia.length===1?'':'s'} sin coincidencia`:''}.`,r.sinCoincidencia.length?'warning':'ok');
  },
  changeDispatchDestination(v){this.dispatchDestination=v;if(v!=='AUTORIZADOS A ENVIAR')this.dispatchClass='';const reason=document.querySelector('.dispatch-grid textarea')?.value||'';this.renderDespacho();const next=document.querySelector('.dispatch-grid textarea');if(next)next.value=reason;},
  /* Nada silencioso: si algun codigo pegado no existe en el stock, se avisa
     y se pide confirmar ANTES de cambiar el estado comercial. Las reglas de
     validacion no se duplican aca: se corre el mismo processDispatch en modo
     simulacion. */
  submitDispatch(e){
    e.preventDefault();
    const f=e.target,classification=f.classification?.value||null,reason=f.reason.value,destination=f.destination.value;
    const prueba=OperacionesModel.processDispatch(this.dispatchText,destination,reason,classification,{simular:true});
    if(!prueba.ok)return this.error('dispatchError',prueba.error);
    this.error('dispatchError','');
    if(prueba.sinCoincidencia.length)return this.askDispatchConfirm(prueba,{destination,reason,classification});
    this.runDispatch({destination,reason,classification},f);
  },
  askDispatchConfirm(prueba,datos){
    document.getElementById('opsModal')?.remove();
    const faltan=prueba.sinCoincidencia;
    document.body.insertAdjacentHTML('beforeend',`<div id="opsModal" class="ops-modal-backdrop" onclick="if(event.target===this)this.remove()"><div class="ops-modal" role="dialog" aria-modal="true"><header><h3>Hay códigos sin coincidencia</h3><button onclick="document.getElementById('opsModal').remove()" aria-label="Cerrar">&times;</button></header><p>Se va a cambiar el estado de <b>${prueba.modificados}</b> pallet${prueba.modificados===1?'':'s'} a <b>${this.esc(datos.destination)}</b>.

<b>${faltan.length}</b> código${faltan.length===1?'':'s'} no existe${faltan.length===1?'':'n'} en el stock actual y quedará${faltan.length===1?'':'n'} sin aplicar.</p><div class="lot-resumen"><div class="lot-resumen-faltantes"><span>Sin coincidencia:</span><code>${this.esc(faltan.join('  '))}</code></div></div><footer><button class="ops-action secondary" onclick="document.getElementById('opsModal').remove()">CANCELAR</button><button class="ops-action success" onclick="OperacionesController.confirmDispatch()"><i class="wi wi-check"></i>APLICAR IGUAL</button></footer></div></div>`);
    this._despachoPendiente=datos;
  },
  confirmDispatch(){
    document.getElementById('opsModal')?.remove();
    const datos=this._despachoPendiente;
    this._despachoPendiente=null;
    if(datos)this.runDispatch(datos,document.querySelector('.ops-bottom-panel.dispatch'));
  },
  runDispatch(datos,form){
    const r=OperacionesModel.processDispatch(this.dispatchText,datos.destination,datos.reason,datos.classification);
    if(!r.ok)return this.error('dispatchError',r.error);
    this.dispatchDestination=datos.destination;
    this.dispatchClass=datos.classification||'';
    this.toast(`Se actualizaron ${r.modificados} pallets a '${r.destino}'${r.clasificacion_envio?` (${r.clasificacion_envio})`:''}${r.sinCoincidencia.length?` · ${r.sinCoincidencia.length} sin coincidencia`:''}.`,r.sinCoincidencia.length?'warning':'ok');
    const campo=form?.querySelector?.('textarea[name=reason]');
    if(campo)campo.value='';
    this.renderDespacho();
  },

  initAprobaciones(container){this.container=container;this.approvalFilters={estado:'TODOS',articulo:'TODOS'};this.renderAprobaciones();},

  /* --- Filtros de la cola de decision --------------------------------------
     La cola mezcla RECHAZO y BLOQUEADOS de decenas de articulos distintos y
     no habia forma de decidir sobre un articulo solo. Las opciones se arman
     con los valores REALMENTE presentes en la cola: un desplegable con
     estados que no existen en pantalla solo produce busquedas vacias.
     El filtro acota la lista, los indicadores Y las decisiones, porque un
     filtro que no alcanza a los botones es una trampa: el operador ve cinco
     pallets, pulsa 'Aprobar lote' y libera los sesenta de la cola. */
  approvalOptions(items,campo){
    return [...new Set(items.map(p=>String(p[campo]??'').trim()).filter(Boolean))]
      .sort((a,b)=>a.localeCompare(b,'es',{numeric:true}));
  },
  filterApprovals(items){
    const {estado,articulo}=this.approvalFilters;
    return items.filter(p=>
      (estado==='TODOS'||OperacionesModel.sameState(p.estado,estado))&&
      (articulo==='TODOS'||String(p.articulo_display??'').trim()===articulo));
  },
  approvalFilterLabel(){
    const {estado,articulo}=this.approvalFilters,partes=[];
    if(estado!=='TODOS')partes.push(`estado ${estado}`);
    if(articulo!=='TODOS')partes.push(`artículo ${articulo}`);
    return partes.join(' · ');
  },
  setApprovalFilter(campo,valor){this.approvalFilters[campo]=valor;this.renderAprobaciones();},
  clearApprovalFilters(){this.approvalFilters={estado:'TODOS',articulo:'TODOS'};this.renderAprobaciones();},
  approvalFilterBar(todos){
    const activo=this.approvalFilterLabel();
    const opciones=(lista,elegido)=>['TODOS',...lista]
      .map(x=>`<option ${elegido===x?'selected':''}>${this.esc(x)}</option>`).join('');
    return `<div class="approval-filter-bar" aria-label="Filtros de la cola de decisión">
      <label>Filtrar Estado<select class="form-control" onchange="OperacionesController.setApprovalFilter('estado',this.value)">${opciones(this.approvalOptions(todos,'estado'),this.approvalFilters.estado)}</select></label>
      <label>Filtrar N° Artículo<select class="form-control" onchange="OperacionesController.setApprovalFilter('articulo',this.value)">${opciones(this.approvalOptions(todos,'articulo_display'),this.approvalFilters.articulo)}</select></label>
      <button type="button" class="ops-link ops-clear-button${activo?' has-active':''}" ${activo?'':'disabled'} onclick="OperacionesController.clearApprovalFilters()" title="Quitar los filtros aplicados"><span>↺</span><b>Limpiar<em> filtros</em></b></button>
    </div>`;
  },
  approvalSummary(items){return{pallets:items.length,kilos:items.reduce((sum,p)=>sum+(Number(p.kilos_display)||0),0),cajas:items.reduce((sum,p)=>sum+(Number(p.cajas)||0),0),articulos:new Set(items.map(p=>String(p.articulo_display||''))).size,alertas:items.filter(p=>p.calidad_estado_display==='ALERTA').length};},
  approvalInsights(summary,total=summary.pallets,filtro=''){return `<div class="approval-insights" aria-label="Resumen de pendientes"><article class="approval-insight pending"><span>◫</span><div><small>Pallets pendientes</small><strong>${summary.pallets.toLocaleString('es-CL')}</strong><em>${filtro?`${summary.pallets} de ${total} en cola`:'Requieren decisión'}</em></div></article><article class="approval-insight weight"><span>◆</span><div><small>Kilos comprometidos</small><strong>${summary.kilos.toLocaleString('es-CL')}</strong><em>Peso registrado</em></div></article><article class="approval-insight boxes"><span>▦</span><div><small>Cajas asociadas</small><strong>${summary.cajas.toLocaleString('es-CL')}</strong><em>Volumen pendiente</em></div></article><article class="approval-insight articles"><span>◇</span><div><small>Artículos distintos</small><strong>${summary.articulos.toLocaleString('es-CL')}</strong><em>Diversidad del lote</em></div></article><article class="approval-insight alerts"><span>!</span><div><small>Alertas de calidad</small><strong>${summary.alertas.toLocaleString('es-CL')}</strong><em>${summary.alertas?'Revisión prioritaria':'Sin alertas activas'}</em></div></article></div>`;},
  renderAprobaciones(){const todos=OperacionesModel.pending(),pending=this.filterApprovals(todos),common=OperacionesModel.commonReason(pending),summary=this.approvalSummary(pending),disabled=pending.length?'':'disabled',filtro=this.approvalFilterLabel();this.container.innerHTML=`<section class="operations-view approvals-view">${DashboardController.operationalHeader({ eyebrow:'CONTROL GERENCIAL', title:'Gestión de Aprobaciones', status:'Decisiones y pendientes operacionales' })}<div class="approval-command-center"><div class="approval-command-heading"><div><span class="approval-eyebrow">COLA DE DECISIÓN GERENCIAL</span><h2>Revisión de pallets observados</h2><p>Pallets bloqueados o rechazados por calidad/producción, agrupados para revisión de Gerencia.</p></div><span class="approval-live-state"><i></i>${pending.length?'Pendientes activos':'Cola al día'}</span></div>${this.approvalInsights(summary,todos.length,filtro)}${this.approvalFilterBar(todos)}<div class="approval-actions"><button id="packingButton" class="approval-action-card packing" onclick="OperacionesController.generatePackingList()" ${disabled}><span class="approval-action-icon">✉</span><span><b>Generar Packing List</b><small>Exportar y preparar notificación a Gerencia</small></span><span class="approval-action-arrow">→</span></button><div class="approval-decision-group" aria-label="Decisiones para los pallets pendientes"><button class="approval-action-card approve" onclick="OperacionesController.confirmDecision('aprobar')" ${disabled}><span class="approval-action-icon">✓</span><span><b>Aprobar lote</b><small>Liberar ${summary.pallets} pallet${summary.pallets===1?'':'s'}</small></span></button><button class="approval-action-card reprocess" onclick="OperacionesController.confirmDecision('reproceso')" ${disabled}><span class="approval-action-icon">↻</span><span><b>Mandar a reproceso</b><small>Derivar para nueva intervención</small></span></button><button class="approval-action-card reject" onclick="OperacionesController.confirmDecision('rechazar')" ${disabled}><span class="approval-action-icon">×</span><span><b>Rechazar definitivo</b><small>Cerrar como rechazo final</small></span></button></div></div></div>${common?`<div class="common-reason approval-context"><span>ⓘ</span><div><b>Motivo común detectado</b><p>Los ${pending.length} pallets pendientes comparten la condición: “${this.esc(common)}”.</p></div></div>`:''}<div class="approval-table-shell">${pending.length?this.approvalCards(pending):`<div class="ops-empty">${filtro?`Ningún pallet de la cola coincide con el filtro aplicado (${this.esc(filtro)}).`:'No hay pallets pendientes de aprobación en este momento.'}</div>`}</div><div id="approvalError" class="ops-error" aria-live="polite"></div></section>`;DashboardController.startOperationalClock();this.ajustarListas();},
  /* --- Vista en tarjetas de Gestion de Aprobaciones -----------------------
     Misma logica que Movimientos y Despacho: la tabla de 8 columnas obligaba
     a scroll horizontal. La diferencia es que aqui el MOTIVO es un campo
     editable, asi que se mantiene visible y editable dentro de la tarjeta
     (no se esconde en el desplegable) con el mismo onblur/Enter de antes.
     Son TRES datos distintos y no deben confundirse:
       INFO CALIDAD  -> dato de calidad, solo lectura (mismo campo y orden que
                        Movimientos y Despacho).
       INFO GENERAL  -> observacion logistica, solo lectura.
       MOTIVO        -> lo escribe el operador para justificar la decision que
                        va a tomar sobre ese grupo de pallets. Campo propio
                        (motivo_decision); antes pisaba info_calidad, que se
                        lee tambien en Stock, Reportes, Mapa, Anden y Bitacora.
     Detector, reserva y auditoria se despliegan al tocar.
     OJO con los dos campos de nombre casi identico:
       estado_calidad_display -> BLOQUEADO / LIBERADO (estado de calidad real,
                                 normalizado en StockModel). Es el que va en
                                 la esquina, igual que en las otras tarjetas.
       calidad_estado_display -> ALERTA / OK (bandera derivada del estado).
     La tabla anterior mostraba el segundo, que no es el estado de calidad. */
  approvalCards(items){
    const metrics=[['kilos_display','KILOS'],['cajas','CAJAS'],['fecha_display','FEC. INGRESO'],['estado','ESTADO']];
    const detail=[['detector_display','DETECTOR METALES'],['reservado_display','RESERVADO']];
    return `<div class="ops-table-shell"><div id="approvalCards" class="ops-card-list">${items.map(p=>`
      <article class="ops-card${this.orderFlagClass(p)}" onclick="OperacionesController.toggleCard(this,event)">
        <div class="ops-card-head">
          <div class="ops-card-id"><b>${this.esc(p.lote_display??'—')}</b><small>${this.esc(p.articulo_display??'—')} · ${this.esc(p.descripcion_display??'—')}</small></div>
          <div class="ops-card-flag">${this.cell(p,'estado_calidad_display')}</div>
          <button type="button" class="ops-card-toggle" aria-expanded="false" aria-label="Ver auditoría y detalle del lote ${this.esc(p.lote_display??'')}"><i></i></button>
        </div>
        <div class="ops-card-metrics">${metrics.map(([k,l])=>`<div><small>${l}</small><span>${this.cell(p,k)}</span></div>`).join('')}</div>
        ${this.orderDelay(p)}
        <div class="ops-card-notes"><div><small>INFO CALIDAD</small><span>${this.cell(p,'calidad_display')}</span></div><div><small>INFO GENERAL</small><span>${this.cell(p,'general_display')}</span></div></div>
        <div class="ops-card-reason"><small>MOTIVO DE LA DECISIÓN</small><input class="form-control reason-input" aria-label="Motivo de la decisión para ${this.esc(p.id)}" value="${this.esc(p.motivo_display)}" placeholder="Ej.: requiere revisión de calidad antes de liberar" onblur="OperacionesController.saveReason('${p.id}',this.value)" onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur()}"></div>
        <div class="ops-card-detail"><div class="ops-card-more">
          <div class="ops-card-kv">${detail.map(([k,l])=>`<div><small>${l}</small><span>${this.cell(p,k)}</span></div>`).join('')}</div>
          ${this.auditBlock(p)}
        </div></div>
      </article>`).join('')}</div></div>`;
  },
  saveReason(id,value){const r=OperacionesModel.updateDecisionReason(id,value);if(!r.ok)this.toast(r.error,'error');else this.toast('Motivo actualizado.');},
  confirmDecision(decision){const cola=OperacionesModel.pending(),items=this.filterApprovals(cola),filtro=this.approvalFilterLabel();if(!items.length)return this.error('approvalError',filtro?'Ningún pallet coincide con el filtro aplicado.':'No hay pallets pendientes para aplicar esta decisión.');const config={aprobar:{title:'Aprobar lote',verb:'aprobar',detail:'Los pallets pasarán a estado LIBERADO y quedará registrada la decisión de Gerencia.',icon:'✓',tone:'approve'},reproceso:{title:'Mandar a reproceso',verb:'enviar a reproceso',detail:'Los pallets pasarán a REPROCESO para una nueva intervención operacional.',icon:'↻',tone:'reprocess'},rechazar:{title:'Rechazar definitivamente',verb:'rechazar definitivamente',detail:'Los pallets quedarán cerrados como RECHAZO DEFINITIVO. Esta es una decisión crítica.',icon:'×',tone:'reject'}}[decision];if(!config)return this.error('approvalError','La decisión seleccionada no es válida.');const summary=this.approvalSummary(items);document.getElementById('approvalDecisionModal')?.remove();document.body.insertAdjacentHTML('beforeend',`<div id="approvalDecisionModal" class="ops-modal-backdrop approval-confirm-backdrop" onclick="if(event.target===this)this.remove()"><section class="ops-modal approval-confirm ${config.tone}" role="dialog" aria-modal="true" aria-labelledby="approvalConfirmTitle"><header><div class="approval-confirm-title"><span>${config.icon}</span><div><small>CONFIRMACIÓN GERENCIAL</small><h3 id="approvalConfirmTitle">${config.title}</h3></div></div><button onclick="document.getElementById('approvalDecisionModal').remove()" aria-label="Cerrar">×</button></header><p class="approval-confirm-copy">Está a punto de ${config.verb} <strong>${summary.pallets} pallet${summary.pallets===1?'':'s'}</strong>. Revise el impacto antes de continuar.</p>${filtro?`<div class="approval-confirm-filter"><b>Filtro aplicado: ${this.esc(filtro)}</b><span>La decisión alcanza solo a esos ${summary.pallets} pallet${summary.pallets===1?'':'s'}; los ${cola.length-summary.pallets} restantes de la cola quedan sin tocar.</span></div>`:''}<div class="approval-confirm-metrics"><span><small>Pallets</small><b>${summary.pallets.toLocaleString('es-CL')}</b></span><span><small>Kilos</small><b>${summary.kilos.toLocaleString('es-CL')}</b></span><span><small>Cajas</small><b>${summary.cajas.toLocaleString('es-CL')}</b></span><span><small>Alertas</small><b>${summary.alertas.toLocaleString('es-CL')}</b></span></div><div class="approval-confirm-impact">${config.detail}</div><footer><button class="ops-action secondary" onclick="document.getElementById('approvalDecisionModal').remove()">Cancelar</button><button class="ops-action ${config.tone}" onclick="OperacionesController.executeApprovalDecision('${decision}')">${config.icon} Confirmar decisión</button></footer></section></div>`);},
  executeApprovalDecision(decision){const items=this.filterApprovals(OperacionesModel.pending());if(!items.length){document.getElementById('approvalDecisionModal')?.remove();return this.error('approvalError','Los pallets pendientes ya fueron procesados.');}const r=OperacionesModel.decide(items.map(p=>p.id),decision);if(!r.ok)return this.error('approvalError',r.error);document.getElementById('approvalDecisionModal')?.remove();this.toast(`${r.cantidad} pallet${r.cantidad===1?'':'s'}: ${r.etiqueta}.`);this.renderAprobaciones();},
  generatePackingList(){const button=document.getElementById('packingButton');if(button){button.disabled=true;button.textContent='⏳ Generando Packing List...';}setTimeout(()=>{try{const r=OperacionesModel.prepareManagementLot(this.filterApprovals(OperacionesModel.pending()));if(!r.ok){this.toast(r.error,'error');return;}OperacionesModel.downloadPackingList(r);this.toast(`${r.lote_id}: Packing List generado (${r.cantidad} pallets), pero el correo no pudo enviarse (${r.correo_motivo}).`,'warning');}catch(ex){this.toast(`No se pudo generar el Packing List: ${ex.message}`,'error');}finally{this.renderAprobaciones();}},120);}
};
