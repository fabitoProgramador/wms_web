/**
 * Andén de Carga remoto.
 *
 * La vista conserva la composición visual existente, pero toda operación de
 * negocio (pallets, cabecera, logística, cierre, historial y correcciones)
 * pasa por AndenBackendModel. No existe fallback a cargas locales.
 */
const AndenBackendController = {
  container:null,
  activeTab:'embarque',
  subsection:'en_curso',
  current:null,
  catalogs:{destinos:[],transportistas:[],conductores:[],vehiculos:[]},
  drafts:{embarque:{},postunel:{}},
  draftDirty:{embarque:false,postunel:false},
  historyType:'embarque',
  historySearch:'',
  historyDate:'',
  historyItems:[],
  historyTotal:0,
  historyOffset:0,
  historyLoading:false,
  historyId:null,
  historyMode:'ver',
  historyDetail:null,
  catalogEditor:null,
  saveTimer:null,
  requestId:0,

  esc(v){return SeguridadService.escaparHtml(v);},
  toast(text,type='success'){return NotificationService.show(text,{type});},
  canManage(){return UserModel.hasPermission('anden.gestionar')&&UserModel.hasPermission('despacho.gestionar');},
  canClose(){return UserModel.hasPermission('despacho.cerrar');},
  canReopen(){return UserModel.hasPermission('despacho.reabrir');},
  canLogistics(){return UserModel.hasPermission('logistica.gestionar');},
  flowLabel(tab=this.activeTab){return tab==='postunel'?'Post Túnel':'Embarque · Proter';},
  uuid(){return AndenBackendModel.uuid();},
  fmt(v){return Number(v||0).toLocaleString('es-CL');},
  dateTime(value){if(!value)return'Automática al despachar';const d=new Date(value);return Number.isNaN(d.getTime())?'—':d.toLocaleString('es-CL');},
  datetimeLocal(value){if(!value)return'';const d=new Date(value);if(Number.isNaN(d.getTime()))return'';const off=d.getTimezoneOffset()*60000;return new Date(d.getTime()-off).toISOString().slice(0,16);},

  emptyDraft(){return{destinoId:'',transportistaId:'',conductorId:'',camionId:'',ramplaId:'',temperatura:'',observaciones:'',fechaHora:''};},
  draftFromCurrent(current){
    const c=current?.cabecera||{};
    return{
      destinoId:c.destino_id??'',transportistaId:c.transportista_id??'',conductorId:c.conductor_id??'',camionId:c.camion_id??'',ramplaId:c.rampla_id??'',
      temperatura:c.temperatura??'',observaciones:c.observaciones??'',fechaHora:this.datetimeLocal(c.fecha_hora_despacho)
    };
  },

  async init(containerElement){
    this.container=containerElement;
    this.activeTab=AndenController.activeTab==='postunel'?'postunel':'embarque';
    this.historyType=this.activeTab;
    this.subsection='en_curso';this.historyId=null;this.historyDetail=null;this.catalogEditor=null;
    this.container.innerHTML='<section class="map-offline-loading"><span>Conectando Andén con Supabase…</span></section>';
    try{
      await this.loadCatalogs();
      await this.loadCurrent({preserveDraft:false});
      await this.handoffMapSelection();
      this.render();
    }catch(error){this.renderFatal(error);}
  },

  renderFatal(error){
    const msg=error?.permiso?'Tu sesión no posee permisos para consultar Andén de Carga.':error?.red?'No fue posible conectar con Supabase. Andén no usa cargas locales como respaldo.':(error?.message||'No fue posible cargar Andén de Carga.');
    this.container.innerHTML=`<section class="map-submodule dock-module">${DashboardController.operationalHeader({eyebrow:'MAPA · ANDÉN',title:'Andén de Carga',status:'Backend no disponible'})}<div class="panel-empty"><b>${this.esc(msg)}</b></div></section>`;
    this.toast(msg,'error');
  },

  async loadCatalogs(){
    const data=await AndenBackendModel.catalogos();
    this.catalogs={destinos:Array.isArray(data?.destinos)?data.destinos:[],transportistas:Array.isArray(data?.transportistas)?data.transportistas:[],conductores:Array.isArray(data?.conductores)?data.conductores:[],vehiculos:Array.isArray(data?.vehiculos)?data.vehiculos:[]};
  },

  async loadCurrent({preserveDraft=true}={}){
    const req=++this.requestId,data=await AndenBackendModel.actual(this.activeTab);if(req!==this.requestId)return;
    this.current=data||{flujo:AndenBackendModel.flujo(this.activeTab),estado:'SIN_CARGA',pallets:[],resumen:{pallets:0,cajas:0,kilos:0}};
    if(!preserveDraft||!this.draftDirty[this.activeTab])this.drafts[this.activeTab]=this.current?.despacho_id?this.draftFromCurrent(this.current):this.emptyDraft();
  },

  localSelectionEntries(tab=this.activeTab){
    const state=MapaModel.getState(),ids=new Set(state.cargo?.[tab]||[]);
    return MapaModel.getPallets().filter(p=>ids.has(p.id));
  },

  clearLocalSelectionIds(successIds,tab=this.activeTab){
    if(!successIds.size)return;
    const state=MapaModel.getState();state.cargo||={embarque:[],postunel:[]};state.cargo[tab]=(state.cargo[tab]||[]).filter(id=>!successIds.has(id));state.manuals||={embarque:[],postunel:[]};state.manuals[tab]=[];MapaModel.saveState(state);MapaOfflineService.scheduleSnapshot('anden-handoff');
  },

  async handoffMapSelection(){
    const entries=this.localSelectionEntries();if(!entries.length)return;
    const already=new Set((this.current?.pallets||[]).map(p=>String(p.id_lote))),successIds=new Set(),warnings=[],errors=[];
    const tasks=entries.map(entry=>async()=>{
      const id=String(PalletModel.idLoteReal(entry)||'');
      if(!id)return errors.push('Selección sin ID de lote canónico.');
      if(already.has(id)){successIds.add(entry.id);return;}
      try{const r=await AndenBackendModel.agregarPallet(this.activeTab,id);if(r?.ok===false)throw new Error(r.error||`No se pudo agregar ${id}`);successIds.add(entry.id);already.add(id);if(r?.aviso)warnings.push(r.aviso);}catch(e){errors.push(`${id}: ${e.message}`);}
    });
    for(let i=0;i<tasks.length;i+=5)await Promise.all(tasks.slice(i,i+5).map(fn=>fn()));
    this.clearLocalSelectionIds(successIds);
    if(successIds.size){await MapaOfflineService.refreshFromServer().catch(()=>{});await this.loadCurrent({preserveDraft:true});if(this.current?.despacho_id&&this.draftDirty[this.activeTab])await this.saveHeader({silent:true});}
    [...new Set(warnings)].forEach(x=>this.toast(x,'warning'));
    if(errors.length)this.toast(`${errors.length} pallet(s) de la preparación no pudieron entrar al Andén. La selección se conserva para reintentar.`,'error');
  },

  render(){
    if(!this.container)return;
    this.container.innerHTML=`<section class="map-submodule dock-module">${DashboardController.operationalHeader({eyebrow:'MAPA · ANDÉN',title:'Andén de Carga',status:'Carga, despacho y trazabilidad desde Supabase'})}<div class="map-offline-status compact"><span class="map-connectivity ${navigator.onLine?'online':'offline'}">${navigator.onLine?'● Backend conectado':'● Sin conexión'}</span><span>${this.current?.despacho_id?'Carga remota activa':'Sin carga activa'}</span><small>Supabase es la fuente de verdad</small></div><div class="dock-top-tabs"><button data-sub="en_curso" class="${this.subsection==='en_curso'?'active':''}"><i class="wi wi-truck"></i>Andén en curso</button><button data-sub="historial" class="${this.subsection==='historial'?'active':''}"><i class="wi wi-history"></i>Historial</button></div><div id="dockContent"></div><div id="dockActionModal"></div></section>`;
    this.container.querySelectorAll('[data-sub]').forEach(btn=>btn.onclick=()=>this.changeSubsection(btn.dataset.sub));
    DashboardController.startOperationalClock();
    if(this.subsection==='historial')this.renderHistory();else this.renderCurrent();
  },

  async changeSubsection(value){
    this.subsection=value;
    this.historyId=null;this.historyDetail=null;this.catalogEditor=null;
    if(value==='historial'){this.historyType=this.activeTab;await this.loadHistory(true);}
    this.render();
  },

  segmented(active,prefix='dock'){
    return`<div class="segmented dock-segmented"><button data-${prefix}="embarque" class="${active==='embarque'?'active':''}"><i class="wi wi-anchor"></i>Embarque · Proter</button><button data-${prefix}="postunel" class="${active==='postunel'?'active':''}"><i class="wi wi-snow"></i>Post Túnel</button></div>`;
  },

  selectedCatalog(type,id){return(this.catalogs[type]||[]).find(x=>Number(x.id)===Number(id))||null;},
  option(value,label,selected){return`<option value="${this.esc(value)}" ${String(value)===String(selected)?'selected':''}>${this.esc(label)}</option>`;},
  selectField(name,label,items,selected,{placeholder='No informado',labelFn=x=>x.nombre||x.razon_social||x.patente||x.id}={}){
    return`<label class="dock-field"><span>${this.esc(label)}</span><select name="${this.esc(name)}"><option value="">${this.esc(placeholder)}</option>${items.map(x=>this.option(x.id,labelFn(x),selected)).join('')}</select></label>`;
  },

  renderCurrent(){
    const root=document.getElementById('dockContent');if(!root)return;
    const c=this.current||{},draft=this.drafts[this.activeTab]||this.emptyDraft(),pallets=c.pallets||[],summary=c.resumen||{},head=c.cabecera||{},dest=this.selectedCatalog('destinos',draft.destinoId);
    const selectedTransport=this.selectedCatalog('transportistas',draft.transportistaId);
    const conductores=this.catalogs.conductores.filter(x=>!draft.transportistaId||!x.transportista_id||Number(x.transportista_id)===Number(draft.transportistaId)||Number(x.id)===Number(draft.conductorId));
    const camiones=this.catalogs.vehiculos.filter(x=>x.tipo==='CAMION'&&(!draft.transportistaId||!x.transportista_id||Number(x.transportista_id)===Number(draft.transportistaId)||Number(x.id)===Number(draft.camionId)));
    const ramplas=this.catalogs.vehiculos.filter(x=>x.tipo==='RAMPLA'&&(!draft.transportistaId||!x.transportista_id||Number(x.transportista_id)===Number(draft.transportistaId)||Number(x.id)===Number(draft.ramplaId)));
    const logisticsButton=this.canLogistics()?'<button type="button" class="btn-secondary" data-new-catalog="transportista">+ Transportista</button><button type="button" class="btn-secondary" data-new-catalog="conductor">+ Conductor</button><button type="button" class="btn-secondary" data-new-catalog="camion">+ Camión</button><button type="button" class="btn-secondary" data-new-catalog="rampla">+ Rampla</button>':'';
    const destinationButton=this.canLogistics()?'<button type="button" class="btn-secondary" data-new-catalog="destino">+ Nuevo destino</button>':'';
    root.innerHTML=`<div class="dock-current-head">${this.segmented(this.activeTab,'tab')}<div class="dock-folio"><span>Folio</span><b>${this.esc(head.referencia||'Se genera con el primer pallet')}</b></div></div>
      <form id="dockBackendForm"><div class="dock-layout"><section class="dock-card destination-card"><h3>▣ Destino de carga</h3>${this.selectField('destinoId','Empresa / sucursal',this.catalogs.destinos,draft.destinoId,{placeholder:'Seleccionar destino…',labelFn:x=>x.nombre})}<div class="history-read-grid"><p><b>Empresa:</b> ${this.esc(dest?.empresa||head.empresa_destino||'—')}</p><p><b>Domicilio:</b> ${this.esc(dest?.domicilio||head.domicilio_destino||'—')}</p><p><b>Ciudad:</b> ${this.esc(dest?.ciudad||head.ciudad_destino||'—')}</p></div>${destinationButton}<small>Empresa, domicilio y ciudad se completan desde el destino seleccionado; ya no se duplican como inputs manuales.</small></section>
      <div class="dock-side-stack"><section class="dock-card"><h3>♨ Validación de andén</h3><div class="dock-fields-row"><label class="dock-field"><span>Fecha y hora</span><strong>${this.esc(this.dateTime(head.fecha_hora_despacho))}</strong><small>${head.fecha_hora_despacho?'Registrada por backend':'Se registra automáticamente al despachar'}</small></label><label class="dock-field"><span>Temp. (°C)</span><input name="temperatura" inputmode="decimal" value="${this.esc(draft.temperatura)}" placeholder="Ej: -18,0"></label></div></section><section class="dock-summary"><span><small>Pallets</small><b>${this.fmt(summary.pallets)}</b></span><span><small>Cajas</small><b>${this.fmt(summary.cajas)}</b></span><span><small>Kilos</small><b>${this.fmt(summary.kilos)}</b></span></section></div></div>
      <section class="dock-card"><h3>🚚 Logística</h3><div class="dock-fields-row four">${this.selectField('transportistaId','Transportista',this.catalogs.transportistas,draft.transportistaId,{labelFn:x=>[x.razon_social,x.rut].filter(Boolean).join(' · ')})}${this.selectField('conductorId','Conductor',conductores,draft.conductorId,{labelFn:x=>[x.nombre,x.rut].filter(Boolean).join(' · ')})}${this.selectField('camionId','Patente camión',camiones,draft.camionId,{labelFn:x=>x.patente})}${this.selectField('ramplaId','Patente rampla',ramplas,draft.ramplaId,{labelFn:x=>x.patente})}</div><div class="dock-actions">${logisticsButton}</div><small>${selectedTransport?`Catálogos filtrados por ${this.esc(selectedTransport.razon_social)}.`:'Podés seleccionar registros existentes o registrar una logística nueva una sola vez para reutilizarla.'}</small><div id="dockCatalogEditor">${this.renderCatalogEditor()}</div></section>
      <section class="dock-card pallets-card"><header><h3>▦ Pallets en Andén <small>remoto y auditado</small></h3><div class="manual-load"><input id="dockManualCode" placeholder="ID lote o código visual"><button type="button" id="dockManualAdd" ${this.canManage()?'':'disabled'}>Agregar pallet</button></div></header><div class="load-grid">${this.palletCells(pallets,true)}</div><div class="load-key"><span><i></i>origen mapa</span><span><i class="manual"></i>origen pasillo</span></div></section>
      <section class="dock-card"><h3>☷ Observaciones de carga</h3><textarea name="observaciones" rows="6" placeholder="Estado de rampla, sellos, incidencias…">${this.esc(draft.observaciones)}</textarea><small id="dockSaveState">${c.despacho_id?'Cambios se guardan automáticamente en Supabase.':'El borrador se mantendrá en memoria hasta agregar el primer pallet.'}</small></section>
      <div class="dock-actions"><button type="button" class="dispatch-button" id="dockDispatch" ${this.canClose()&&c.despacho_id?'':'disabled'}><i class="wi wi-check wi-lg"></i><span><b>Guardar y despachar</b><small>${this.fmt(summary.pallets)} pallets · fecha/hora automática</small></span></button><span></span><button type="button" class="btn-secondary" id="dockPdf" ${c.despacho_id?'':'disabled'}><i class="wi wi-pdf"></i>Packing list PDF</button><button type="button" class="btn-secondary" id="dockExcel" ${c.despacho_id?'':'disabled'}><i class="wi wi-sheet"></i>Excel</button></div></form>
      ${this.recentLoadsHtml()}`;

    root.querySelectorAll('[data-tab]').forEach(btn=>btn.onclick=()=>this.changeTab(btn.dataset.tab));
    const form=document.getElementById('dockBackendForm');form?.querySelectorAll('[name]').forEach(input=>input.onchange=()=>this.onDraftChange(form));form?.querySelectorAll('input[name=temperatura],textarea[name=observaciones]').forEach(input=>input.oninput=()=>this.onDraftChange(form));
    root.querySelectorAll('[data-new-catalog]').forEach(btn=>btn.onclick=()=>{this.catalogEditor=btn.dataset.newCatalog;this.renderCurrent();});
    document.getElementById('dockManualAdd')?.addEventListener('click',()=>this.addPallet());document.getElementById('dockManualCode')?.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();this.addPallet();}});
    root.querySelectorAll('.load-pallet[data-id-lote]').forEach(btn=>btn.onclick=()=>this.removePallet(btn.dataset.idLote));
    document.getElementById('dockDispatch')?.addEventListener('click',()=>this.dispatch());document.getElementById('dockPdf')?.addEventListener('click',()=>this.exportCurrent('pdf'));document.getElementById('dockExcel')?.addEventListener('click',()=>this.exportCurrent('excel'));
    root.querySelectorAll('[data-recent-id]').forEach(btn=>btn.onclick=async()=>{this.subsection='historial';this.historyType=this.activeTab;this.historyId=Number(btn.dataset.recentId);await this.loadHistoryDetail(this.historyId);this.render();});
    document.getElementById('dockFullHistory')?.addEventListener('click',async()=>{this.subsection='historial';this.historyType=this.activeTab;await this.loadHistory(true);this.render();});
    this.bindCatalogEditor();
  },

  async changeTab(tab){
    if(!['embarque','postunel'].includes(tab)||tab===this.activeTab)return;
    clearTimeout(this.saveTimer);this.activeTab=tab;AndenController.activeTab=tab;this.catalogEditor=null;await this.loadCurrent({preserveDraft:false});await this.handoffMapSelection();this.render();
  },

  readDraft(form=document.getElementById('dockBackendForm')){
    const data={...this.drafts[this.activeTab]};if(!form)return data;
    ['destinoId','transportistaId','conductorId','camionId','ramplaId','temperatura','observaciones'].forEach(key=>{const node=form.querySelector(`[name=${key}]`);if(node)data[key]=node.value;});return data;
  },

  onDraftChange(form){
    this.drafts[this.activeTab]=this.readDraft(form);this.draftDirty[this.activeTab]=true;clearTimeout(this.saveTimer);
    if(this.current?.despacho_id)this.saveTimer=setTimeout(()=>this.saveHeader({silent:true}),450);
  },

  async saveHeader({silent=false,correction=false,detail=null}={}){
    const source=detail||this.current;if(!source?.despacho_id&&!source?.cabecera?.despacho_id)return{ok:true,pending:true};
    const id=source.despacho_id||source.cabecera?.despacho_id,expected=source.cabecera?.actualizado_en||null,draft=correction?source._draft:(this.drafts[this.activeTab]||this.emptyDraft());
    try{
      const r=await AndenBackendModel.actualizar(id,draft,expected,{correccion});
      if(r?.ok===false&&r?.conflict){if(!silent)this.toast(r.error||'La carga cambió en otro dispositivo.','warning');return r;}
      if(!correction){this.draftDirty[this.activeTab]=false;await this.loadCurrent({preserveDraft:false});if(!silent)this.render();}
      const state=document.getElementById('dockSaveState');if(state)state.textContent='Guardado en Supabase.';
      return r;
    }catch(error){const state=document.getElementById('dockSaveState');if(state)state.textContent='No se pudo guardar todavía.';if(!silent)this.toast(error.message,'error');return{ok:false,error:error.message};}
  },

  async addPallet(){
    if(!this.canManage())return this.toast('Tu sesión no posee permisos para gestionar Andén.','error');
    const input=document.getElementById('dockManualCode'),code=String(input?.value||'').trim();if(!code)return this.toast('Ingresá un ID de lote o código visual.','warning');
    const draftBefore={...this.drafts[this.activeTab]};
    try{
      const r=await AndenBackendModel.agregarPallet(this.activeTab,code);if(r?.ok===false)return this.toast(r.error||'No fue posible agregar el pallet.','error');
      if(r?.aviso)this.toast(r.aviso,'warning');
      await MapaOfflineService.refreshFromServer().catch(()=>{});await this.loadCurrent({preserveDraft:true});
      if(Object.values(draftBefore).some(v=>String(v??'').trim()!=='')){this.drafts[this.activeTab]=draftBefore;this.draftDirty[this.activeTab]=true;await this.saveHeader({silent:true});}
      if(input)input.value='';this.render();
    }catch(error){this.toast(error.message,'error');}
  },

  async removePallet(idLote){
    if(!this.canManage())return this.toast('Tu sesión no posee permisos para gestionar Andén.','error');
    try{await AndenBackendModel.quitarPallet(this.current.despacho_id,idLote,'Retirado de carga en curso desde Andén');await MapaOfflineService.refreshFromServer().catch(()=>{});await this.loadCurrent({preserveDraft:true});this.render();this.toast('Pallet retirado del Andén y origen físico restaurado cuando existía.','success');}catch(error){this.toast(error.message,'error');}
  },

  palletCells(pallets,removable=false){
    if(!pallets.length)return'<p class="empty-message">La carga está vacía. Agregá pallets desde el mapa o por ID/código.</p>';
    return pallets.map(p=>{const origin=p.origen==='MAPA'?'Mapa':'Pasillo',state=p.estado_operativo||p.estado_wms||p.estado_sap||'—',color=COLORES_MAPA_ESTADO[state]||'#64748B';return`<button type="button" class="load-pallet ${p.origen==='PASILLO'?'manual':''}" data-id-lote="${this.esc(p.id_lote)}" ${removable?'title="Tocar para quitar y restaurar origen"':'disabled'}><strong>${this.esc(p.codigo_visual||p.id_lote)}</strong><small>${this.esc(p.itemcode||'—')}</small><span class="load-origin">${origin}</span><i style="--state:${color}">${this.esc(ABREVIATURAS_ESTADO_MAPA[state]||state.slice(0,3))}</i></button>`;}).join('');
  },

  async dispatch(){
    if(!this.current?.despacho_id)return this.toast('Agregá al menos un pallet antes de despachar.','warning');
    this.drafts[this.activeTab]=this.readDraft();
    if(!this.drafts[this.activeTab].destinoId)return this.toast('Seleccioná el destino antes de cerrar la carga.','warning');
    const saved=await this.saveHeader({silent:true});if(saved?.ok===false)return;
    try{
      const result=await AndenBackendModel.despachar(this.current.despacho_id);if(result?.ok===false)return this.toast(result.error||'No fue posible cerrar la carga.','error');
      this.toast(`Despacho cerrado: ${result.pallets} pallet(s).`,'success');this.drafts[this.activeTab]=this.emptyDraft();this.draftDirty[this.activeTab]=false;await MapaOfflineService.refreshFromServer().catch(()=>{});await this.loadCurrent({preserveDraft:false});this.render();
    }catch(error){this.toast(error.message,'error');}
  },

  packingPallet(p={}){
    const itemcode=String(p.itemcode||''),article=itemcode.length>=5?itemcode.slice(-5):itemcode;
    const description=p.itemname||'Sin descripción SAP disponible';
    const organic=/org[aá]nic/i.test(description.normalize('NFD').replace(/[\u0300-\u036f]/g,''));
    return{_backend_catalog:true,_backend_anden:true,id_lote_real:String(p.id_lote||''),lote:String(p.id_lote||''),numero_articulo:itemcode,articulo:article,descripcion:description,itemname:description,kilos:p.kilos==null?null:Number(p.kilos),cajas:p.cajas==null?null:Number(p.cajas),fecha_fabricacion:p.fecha_prod||'—',est_calidad:p.est_calidad||p.estado_sap||'—',calidad_estado:p.est_calidad||p.estado_sap||'—',info_calidad:p.u_inf_cal||'',info_general:p.u_inf_g||'',detector_metales:p.detector_de??'—',reservado:p.u_rerservado??'—',estado:p.estado_operativo||p.estado_wms||p.estado_sap||'—',estado_sap:p.estado_sap||p.est_calidad||'—',estado_wms:p.estado_wms||'—',organico_backend:organic};
  },

  packingRecord(current=this.current){
    const c=current?.cabecera||{},fecha=c.fecha_hora_despacho?this.dateTime(c.fecha_hora_despacho):new Date().toLocaleString('es-CL');
    return{folio:c.referencia||`BORRADOR-${current?.despacho_id||''}`,pestana:this.activeTab,guardada_en:fecha,datos:{empresa:c.empresa_destino||c.destino||'—',domicilio:c.domicilio_destino||'',ciudad:c.ciudad_destino||'',fecha_hora:fecha,temperatura:c.temperatura??'',chofer:c.conductor||'',rut:c.rut_conductor||'',patente_camion:c.patente_camion||'',patente_rampla:c.patente_rampla||'',observaciones:c.observaciones||''},pallets:(current?.pallets||[]).map(p=>({_snapshot:this.packingPallet(p)}))};
  },

  exportCurrent(format){if(!this.current?.despacho_id||!(this.current.pallets||[]).length)return this.toast('No hay pallets en la carga para generar el packing list.','warning');AndenPackingService.exportPacking(this.packingRecord(),format);},

  async recentLoads(){try{return(await AndenBackendModel.historial(this.activeTab,{limite:5,offset:0}))?.items||[];}catch(_){return[];}},
  recentLoadsHtml(){return`<section class="recent-loads"><header><h3>CARGAS RECIENTES</h3><button id="dockFullHistory">Ver historial completo<i class="wi wi-right"></i></button></header><div id="dockRecentLoads"><p class="empty-message">Abrí Historial para consultar despachos cerrados.</p></div></section>`;},

  renderCatalogEditor(){
    const type=this.catalogEditor;if(!type)return'';const transportId=this.drafts[this.activeTab]?.transportistaId||'';
    if(type==='destino')return`<form id="dockCatalogForm" data-type="destino" class="dock-card"><h3>Nuevo destino</h3><div class="dock-fields-row four"><label class="dock-field"><span>Nombre</span><input name="nombre" required></label><label class="dock-field"><span>Empresa</span><input name="empresa"></label><label class="dock-field"><span>Ciudad</span><input name="ciudad"></label><label class="dock-field"><span>Domicilio</span><input name="domicilio"></label></div><label class="dock-field"><span>Sucursal</span><input name="sucursal"></label><div class="dock-actions"><button type="button" class="btn-secondary" id="catalogCancel">Cancelar</button><button class="btn-primary">Guardar destino</button></div></form>`;
    if(type==='transportista')return`<form id="dockCatalogForm" data-type="transportista" class="dock-card"><h3>Nuevo transportista</h3><div class="dock-fields-row"><label class="dock-field"><span>Razón social</span><input name="razonSocial" required></label><label class="dock-field"><span>RUT</span><input name="rut"></label></div><div class="dock-actions"><button type="button" class="btn-secondary" id="catalogCancel">Cancelar</button><button class="btn-primary">Guardar transportista</button></div></form>`;
    if(type==='conductor')return`<form id="dockCatalogForm" data-type="conductor" class="dock-card"><h3>Nuevo conductor</h3><div class="dock-fields-row"><label class="dock-field"><span>Nombre</span><input name="nombre" required></label><label class="dock-field"><span>RUT</span><input name="rut" required></label></div><small>${transportId?'Se asociará al transportista seleccionado.':'Podés registrarlo sin transportista y asociarlo después.'}</small><div class="dock-actions"><button type="button" class="btn-secondary" id="catalogCancel">Cancelar</button><button class="btn-primary">Guardar conductor</button></div></form>`;
    const label=type==='camion'?'camión':'rampla';return`<form id="dockCatalogForm" data-type="${type}" class="dock-card"><h3>Nueva patente · ${label}</h3><label class="dock-field"><span>Patente</span><input name="patente" required autocapitalize="characters"></label><small>${transportId?'Se asociará al transportista seleccionado.':'Puede quedar sin transportista asociado.'}</small><div class="dock-actions"><button type="button" class="btn-secondary" id="catalogCancel">Cancelar</button><button class="btn-primary">Guardar ${label}</button></div></form>`;
  },

  bindCatalogEditor(){
    const form=document.getElementById('dockCatalogForm');if(!form)return;document.getElementById('catalogCancel').onclick=()=>{this.catalogEditor=null;this.renderCurrent();};form.onsubmit=e=>{e.preventDefault();this.saveCatalog(form);};
  },

  async saveCatalog(form){
    if(!this.canLogistics())return this.toast('Tu sesión no posee permiso logistica.gestionar.','error');
    const type=form.dataset.type,data=Object.fromEntries(new FormData(form).entries()),transportistaId=this.drafts[this.activeTab]?.transportistaId||null;
    try{
      let id;
      if(type==='destino')id=await AndenBackendModel.guardarDestino(data);
      else if(type==='transportista')id=await AndenBackendModel.guardarTransportista(data);
      else if(type==='conductor')id=await AndenBackendModel.guardarConductor({...data,transportistaId});
      else id=await AndenBackendModel.guardarVehiculo(type==='camion'?'CAMION':'RAMPLA',{...data,transportistaId});
      await this.loadCatalogs();
      const key=type==='destino'?'destinoId':type==='transportista'?'transportistaId':type==='conductor'?'conductorId':type==='camion'?'camionId':'ramplaId';this.drafts[this.activeTab][key]=id;this.draftDirty[this.activeTab]=true;this.catalogEditor=null;if(this.current?.despacho_id)await this.saveHeader({silent:true});this.render();this.toast('Registro logístico guardado para reutilizarlo.','success');
    }catch(error){this.toast(error.message,'error');}
  },

  async loadHistory(reset=false){
    if(this.historyLoading)return;this.historyLoading=true;try{if(reset){this.historyOffset=0;this.historyItems=[];}const page=await AndenBackendModel.historial(this.historyType,{busqueda:this.historySearch,fecha:this.historyDate,limite:50,offset:this.historyOffset});this.historyTotal=Number(page?.total||0);this.historyItems=reset?(page?.items||[]):[...this.historyItems,...(page?.items||[])];this.historyOffset=this.historyItems.length;}catch(error){this.toast(error.message,'error');}finally{this.historyLoading=false;}
  },

  renderHistory(){
    const root=document.getElementById('dockContent');if(!root)return;if(this.historyId)return this.renderHistoryRecord();
    root.innerHTML=`<div class="history-toolbar">${this.segmented(this.historyType,'history')}<label>🔍<input id="historySearch" value="${this.esc(this.historySearch)}" placeholder="Folio, empresa, conductor o patente"></label><input id="historyDate" type="date" value="${this.esc(this.historyDate)}"></div><div class="load-history-list">${this.historyItems.map(c=>`<article><header><div><i>🚚</i><span><b>${this.esc(c.folio||`#${c.despacho_id}`)}</b><small>${this.esc(c.empresa||c.destino||'—')} · ${this.esc(this.dateTime(c.fecha_hora))}</small></span></div><em>${this.fmt(c.pallets)} pallets · ${this.fmt(c.cajas)} cajas · ${this.esc(c.estado)}</em></header><footer><button data-view-id="${c.despacho_id}"><i class="wi wi-eye"></i>Visualizar datos</button>${this.canReopen()?`<button data-edit-id="${c.despacho_id}"><i class="wi wi-edit"></i>Modificar</button>`:''}<button data-pdf-id="${c.despacho_id}"><i class="wi wi-pdf"></i>PDF</button><button data-xlsx-id="${c.despacho_id}"><i class="wi wi-sheet"></i>Excel</button></footer></article>`).join('')||'<p class="empty-message">No hay despachos que coincidan.</p>'}</div>${this.historyItems.length<this.historyTotal?`<button class="show-more" id="historyMore">Mostrar más (${this.historyTotal-this.historyItems.length})</button>`:''}`;
    root.querySelectorAll('[data-history]').forEach(btn=>btn.onclick=async()=>{this.historyType=btn.dataset.history;this.historySearch='';this.historyDate='';await this.loadHistory(true);this.renderHistory();});
    document.getElementById('historySearch').oninput=e=>this.debounceHistory('historySearch',e.target.value);document.getElementById('historyDate').onchange=e=>this.debounceHistory('historyDate',e.target.value,0);
    root.querySelectorAll('[data-view-id]').forEach(btn=>btn.onclick=()=>this.openHistory(Number(btn.dataset.viewId),'ver'));root.querySelectorAll('[data-edit-id]').forEach(btn=>btn.onclick=()=>this.openHistory(Number(btn.dataset.editId),'modificar'));
    root.querySelectorAll('[data-pdf-id]').forEach(btn=>btn.onclick=()=>this.exportHistory(Number(btn.dataset.pdfId),'pdf'));root.querySelectorAll('[data-xlsx-id]').forEach(btn=>btn.onclick=()=>this.exportHistory(Number(btn.dataset.xlsxId),'excel'));document.getElementById('historyMore')?.addEventListener('click',async()=>{await this.loadHistory(false);this.renderHistory();});
  },

  debounceHistory(field,value,delay=220){clearTimeout(this._historyTimer);this._historyTimer=setTimeout(async()=>{this[field]=value;await this.loadHistory(true);this.renderHistory();document.getElementById(field)?.focus();},delay);},
  async loadHistoryDetail(id){this.historyDetail=await AndenBackendModel.detalle(id);this.historyId=id;},
  async openHistory(id,mode){try{await this.loadHistoryDetail(id);if(mode==='modificar')await this.enterCorrection();else this.historyMode='ver';this.render();}catch(error){this.toast(error.message,'error');}},

  async enterCorrection(){
    if(!this.canReopen())return this.toast('Tu sesión no posee permiso para corregir despachos cerrados.','error');const state=this.historyDetail?.cabecera?.estado;
    if(state==='CERRADO'){
      const reason=await this.askReason('Reabrir despacho','Indicá por qué se debe modificar este despacho cerrado.');if(!reason){this.historyMode='ver';return;}
      await AndenBackendModel.reabrir(this.historyId,reason);await this.loadHistoryDetail(this.historyId);
    }
    if(this.historyDetail?.cabecera?.estado!=='EN_CORRECCION')return this.toast('El despacho no está disponible para corrección.','error');
    this.historyMode='modificar';this.historyDetail._draft=this.draftFromHistory(this.historyDetail.cabecera);
  },

  draftFromHistory(c={}){return{destinoId:c.destino_id??'',transportistaId:c.transportista_id??'',conductorId:c.conductor_id??'',camionId:c.camion_id??'',ramplaId:c.rampla_id??'',temperatura:c.temperatura??'',observaciones:c.observaciones??'',fechaHora:this.datetimeLocal(c.fecha_hora_despacho)};},

  renderHistoryRecord(){
    const root=document.getElementById('dockContent'),d=this.historyDetail;if(!root||!d)return;const c=d.cabecera||{},edit=this.historyMode==='modificar',draft=d._draft||this.draftFromHistory(c),pallets=d.pallets||[];
    if(edit)d._draft=draft;
    const values=edit?`<form id="historyEditForm"><div class="dock-layout"><section class="dock-card"><h3>▣ Destino</h3>${this.selectField('destinoId','Empresa / sucursal',this.catalogs.destinos,draft.destinoId,{placeholder:'Seleccionar destino…',labelFn:x=>x.nombre})}</section><section class="dock-card"><h3>♨ Validación</h3><div class="dock-fields-row"><label class="dock-field"><span>Fecha y hora</span><input type="datetime-local" name="fechaHora" value="${this.esc(draft.fechaHora)}"></label><label class="dock-field"><span>Temperatura</span><input name="temperatura" inputmode="decimal" value="${this.esc(draft.temperatura)}"></label></div></section></div><section class="dock-card"><h3>🚚 Logística</h3><div class="dock-fields-row four">${this.selectField('transportistaId','Transportista',this.catalogs.transportistas,draft.transportistaId,{labelFn:x=>x.razon_social})}${this.selectField('conductorId','Conductor',this.catalogs.conductores,draft.conductorId,{labelFn:x=>[x.nombre,x.rut].filter(Boolean).join(' · ')})}${this.selectField('camionId','Camión',this.catalogs.vehiculos.filter(x=>x.tipo==='CAMION'),draft.camionId,{labelFn:x=>x.patente})}${this.selectField('ramplaId','Rampla',this.catalogs.vehiculos.filter(x=>x.tipo==='RAMPLA'),draft.ramplaId,{labelFn:x=>x.patente})}</div></section><section class="dock-card"><h3>Observaciones</h3><textarea name="observaciones" rows="5">${this.esc(draft.observaciones)}</textarea></section><section class="dock-card"><h3>Agregar pallet a corrección</h3><div class="manual-load"><input id="correctionAddCode" placeholder="ID lote o código visual"><button type="button" id="correctionAddBtn">Agregar</button></div></section></form>`:`<div class="history-read-grid"><section class="dock-card"><h3>Destino de carga</h3><p><b>Empresa:</b> ${this.esc(c.empresa_destino||'—')}</p><p><b>Domicilio:</b> ${this.esc(c.domicilio_destino||'—')}</p><p><b>Ciudad:</b> ${this.esc(c.ciudad_destino||'—')}</p></section><section class="dock-card"><h3>Validación y logística</h3><p><b>Fecha:</b> ${this.esc(this.dateTime(c.fecha_hora_despacho))} · <b>Temp.:</b> ${this.esc(c.temperatura??'—')}</p><p><b>Transportista:</b> ${this.esc(c.transportista||'—')}</p><p><b>Conductor:</b> ${this.esc(c.conductor||'—')} · <b>RUT:</b> ${this.esc(c.rut_conductor||'—')}</p><p><b>Patentes:</b> ${this.esc(c.patente_camion||'—')} / ${this.esc(c.patente_rampla||'—')}</p></section></div><section class="dock-card"><h3>Observaciones</h3><p>${this.esc(c.observaciones||'Sin observaciones.')}</p></section>`;
    root.innerHTML=`<button class="history-back" id="historyBack"><i class="wi wi-left"></i>Volver al historial</button><header class="history-record-heading"><i>${edit?'✎':'🚚'}</i><div><h2>${edit?'Corrección · ':''}${this.esc(c.referencia||`#${this.historyId}`)}</h2><p>${this.esc(c.estado||'—')} · ${this.esc(this.dateTime(c.fecha_hora_despacho||c.cerrado_en))}</p></div></header>${values}<section class="dock-card"><h3>Pallets (${pallets.length}) ${edit?'<small>tocá uno para devolverlo a su origen físico</small>':''}</h3><div class="load-grid">${this.palletCells(pallets,edit)}</div></section>${this.auditHtml(d.auditoria||[])}<div class="dock-actions">${edit?'<button class="btn-primary" id="historySave">Guardar corrección y cerrar</button>':this.canReopen()?'<button class="btn-primary" id="historyModify">Modificar esta carga</button>':''}<span></span><button class="btn-secondary" id="historyPdf"><i class="wi wi-pdf"></i>Packing list PDF</button><button class="btn-secondary" id="historyExcel"><i class="wi wi-sheet"></i>Excel</button></div>`;
    document.getElementById('historyBack').onclick=()=>{this.historyId=null;this.historyDetail=null;this.historyMode='ver';this.renderHistory();};document.getElementById('historyModify')?.addEventListener('click',async()=>{await this.enterCorrection();this.renderHistoryRecord();});
    if(edit){const form=document.getElementById('historyEditForm');form.querySelectorAll('[name]').forEach(x=>x.onchange=()=>this.readHistoryDraft(form));form.querySelector('textarea[name=observaciones]').oninput=()=>this.readHistoryDraft(form);document.getElementById('correctionAddBtn').onclick=()=>this.addCorrectionPallet();document.getElementById('correctionAddCode').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();this.addCorrectionPallet();}};root.querySelectorAll('.load-pallet[data-id-lote]').forEach(btn=>btn.onclick=()=>this.returnCorrectionPallet(btn.dataset.idLote));document.getElementById('historySave').onclick=()=>this.saveCorrection();}
    document.getElementById('historyPdf').onclick=()=>this.exportDetail(d,'pdf');document.getElementById('historyExcel').onclick=()=>this.exportDetail(d,'excel');
  },

  readHistoryDraft(form){const d=this.historyDetail._draft||{};['destinoId','transportistaId','conductorId','camionId','ramplaId','fechaHora','temperatura','observaciones'].forEach(k=>{const n=form.querySelector(`[name=${k}]`);if(n)d[k]=n.value;});this.historyDetail._draft=d;return d;},
  auditHtml(items){if(!items.length)return'';return`<section class="dock-card"><h3>Auditoría del despacho</h3><div class="load-history-list">${items.slice().reverse().slice(0,20).map(a=>`<article><header><div><span><b>${this.esc(a.evento)}</b><small>${this.esc(a.usuario||a.rol||'Sistema')} · ${this.esc(this.dateTime(a.fecha))}</small></span></div></header></article>`).join('')}</div></section>`;},

  async addCorrectionPallet(){const code=String(document.getElementById('correctionAddCode')?.value||'').trim();if(!code)return this.toast('Ingresá un pallet.','warning');try{const r=await AndenBackendModel.agregarCorreccion(this.historyId,code);if(r?.ok===false)return this.toast(r.error||'No fue posible agregar el pallet.','error');await this.loadHistoryDetail(this.historyId);this.historyDetail._draft=this.draftFromHistory(this.historyDetail.cabecera);this.historyMode='modificar';await MapaOfflineService.refreshFromServer().catch(()=>{});this.renderHistoryRecord();}catch(error){this.toast(error.message,'error');}},
  async returnCorrectionPallet(idLote){const reason=await this.askReason('Devolver pallet al mapa','Indicá el motivo de retirar este pallet del despacho. Se intentará restaurar su origen físico.');if(!reason)return;try{const r=await AndenBackendModel.devolverPallet(this.historyId,idLote,reason);if(r?.desplazados?.length)this.toast(`La reposición generó ${r.desplazados.length} desplazamiento(s) auditado(s).`,'warning');await this.loadHistoryDetail(this.historyId);this.historyDetail._draft=this.draftFromHistory(this.historyDetail.cabecera);this.historyMode='modificar';await MapaOfflineService.refreshFromServer().catch(()=>{});this.renderHistoryRecord();}catch(error){this.toast(error.message,'error');}},

  async saveCorrection(){
    const form=document.getElementById('historyEditForm');if(form)this.readHistoryDraft(form);const d=this.historyDetail,headerResult=await this.saveHeader({silent:true,correction:true,detail:d});if(headerResult?.ok===false)return;
    try{
      const fresh=await AndenBackendModel.detalle(this.historyId),pending=(fresh?.pallets||[]).filter(p=>!p.cargado_en);
      for(const p of pending)await AndenBackendModel.confirmarCarga(this.historyId,p.id_lote);
      await AndenBackendModel.recerrar(this.historyId,'Corrección guardada desde Andén de Carga');this.toast('Corrección guardada, auditada y despacho cerrado nuevamente.','success');await MapaOfflineService.refreshFromServer().catch(()=>{});await this.loadHistoryDetail(this.historyId);this.historyMode='ver';await this.loadHistory(true);this.render();
    }catch(error){this.toast(error.message,'error');}
  },

  async exportHistory(id,format){try{const d=await AndenBackendModel.detalle(id);this.exportDetail(d,format);}catch(error){this.toast(error.message,'error');}},
  exportDetail(detail,format){const current={despacho_id:detail?.cabecera?.despacho_id,cabecera:detail?.cabecera||{},pallets:detail?.pallets||[]};AndenPackingService.exportPacking(this.packingRecord(current),format);},

  askReason(title,text){
    return new Promise(resolve=>{const root=document.getElementById('dockActionModal');if(!root)return resolve(null);root.innerHTML=`<div class="map-modal-backdrop"><section class="inventory-dialog"><header><div><b>${this.esc(title)}</b><span>Acción auditada</span></div><button id="dockReasonClose">×</button></header><div class="inventory-dialog-body"><p>${this.esc(text)}</p><label class="dock-field"><span>Motivo</span><textarea id="dockReasonText" rows="4" autofocus></textarea></label><div class="dock-actions"><button class="btn-secondary" id="dockReasonCancel">Cancelar</button><button class="btn-primary" id="dockReasonOk">Confirmar</button></div></div></section></div>`;const finish=value=>{root.innerHTML='';resolve(value);};document.getElementById('dockReasonClose').onclick=()=>finish(null);document.getElementById('dockReasonCancel').onclick=()=>finish(null);document.getElementById('dockReasonOk').onclick=()=>{const v=String(document.getElementById('dockReasonText').value||'').trim();if(!v)return this.toast('El motivo es obligatorio.','warning');finish(v);};document.getElementById('dockReasonText').focus();});
  }
};
