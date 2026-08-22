/**
 * Mapa -> Inventario de Cámara remoto.
 * Cruza stock SAP con Posiciones_Mapa y escribe posiciones sólo por RPC.
 */
const MapaInventarioController = {
  container:null,
  camera:'PROTER',
  filter:'TODOS',
  search:'',
  result:null,
  items:[],
  geometry:null,
  requestId:0,
  searchTimer:null,
  loadingMore:false,

  esc(v){return SeguridadService.escaparHtml(v);},
  fmt(v){return Number(v||0).toLocaleString('es-CL');},
  toast(text,type='success'){return NotificationService.show(text,{type});},
  canManage(){return UserModel.hasPermission('mapa.gestionar');},

  init(container){
    this.container=container;
    this.camera='PROTER';this.filter='TODOS';this.search='';this.result=null;this.items=[];
    clearTimeout(this.searchTimer);
    this.renderShell();
    this.cargar(true);
  },

  renderShell(){
    if(!this.container)return;
    this.container.innerHTML=`<section class="map-submodule inventory-module">
      ${DashboardController.operationalHeader({eyebrow:'CONTROL DE UBICACIONES',title:'Inventario de Cámara',status:'Cruce SAP ↔ posición física WMS desde Supabase'})}
      <div id="inventoryRoot"><div class="panel-empty">Consultando inventario remoto…</div></div>
    </section>`;
    DashboardController.startOperationalClock();
  },

  async cargar(reset=false){
    if(reset){this.items=[];this.result=null;}
    const req=++this.requestId;
    const offset=reset?0:this.items.length;
    try{
      const [geometry,page]=await Promise.all([
        this.geometry?Promise.resolve(this.geometry):MapaInventarioModel.geometria(),
        MapaInventarioModel.listar({camara:this.camera,estado:this.filter,busqueda:this.search,limite:40,offset})
      ]);
      if(req!==this.requestId||AppController.activeView!=='inventario')return;
      this.geometry=geometry;
      this.result=page;
      this.items=reset?page.items:[...this.items,...page.items];
      this.loadingMore=false;
      this.render();
    }catch(error){
      if(req!==this.requestId)return;
      this.loadingMore=false;
      const msg=error?.permiso?'Tu sesión no posee permiso para consultar Inventario de Cámara.'
        :error?.red?'No fue posible conectar con Supabase. Inventario de Cámara no usa datos operacionales locales como respaldo.'
        :(error?.message||'No fue posible consultar Inventario de Cámara.');
      const root=document.getElementById('inventoryRoot');if(root)root.innerHTML=`<div class="panel-empty"><b>${this.esc(msg)}</b></div>`;
      this.toast(msg,'error');
    }
  },

  setCamera(camera){this.camera=MapaInventarioModel.camara(camera);this.filter='TODOS';this.search='';this.cargar(true);},
  setFilter(filter){this.filter=filter;this.cargar(true);},
  onSearch(value){this.search=String(value||'');clearTimeout(this.searchTimer);this.searchTimer=setTimeout(()=>this.cargar(true),260);},
  loadMore(){if(this.loadingMore||!this.result||this.items.length>=this.result.totalFiltrado)return;this.loadingMore=true;this.render();this.cargar(false);},

  render(){
    const root=document.getElementById('inventoryRoot');if(!root||!this.result)return;
    const c=this.result.resumen;
    const filters=[['TODOS','Todos'],['ENCONTRADO','Encontrado'],['OTRA_CAMARA','Otra cámara'],['NO_ENCONTRADO','No encontrado'],['NO_EXISTE','No existe']];
    root.innerHTML=`<div class="inventory-sticky">
      <div class="inventory-camera-tabs"><button data-camera="PROTER" class="${this.camera==='PROTER'?'active':''}"><i class="wi wi-snow"></i>Cámara Proter</button><button data-camera="POST TUNEL" class="${this.camera==='POST TUNEL'?'active':''}"><i class="wi wi-cube"></i>Cámara Post Túnel</button></div>
      <div class="inventory-filters"><label><i class="wi wi-search"></i><input id="inventorySearch" value="${this.esc(this.search)}" placeholder="Código visual, ID de lote o artículo"></label><div class="segmented">${filters.map(([k,l])=>`<button data-filter="${k}" class="${this.filter===k?'active':''}">${l}</button>`).join('')}</div></div>
      <div class="inventory-counts"><article class="found"><b>${this.fmt(c.encontrado)}</b><span>Encontrados</span></article><article class="other"><b>${this.fmt(c.otraCamara)}</b><span>En otra cámara</span></article><article class="missing"><b>${this.fmt(c.noEncontrado)}</b><span>No encontrados</span></article></div>
      ${c.noExiste?`<div class="lote-duplicate">⚠ ${this.fmt(c.noExiste)} posición(es) WMS corresponden a pallets que ya no existen en el padre SAP.</div>`:''}
      ${this.canManage()?'':'<div class="inventory-readonly">Consulta de solo lectura según permisos de la sesión.</div>'}
    </div>
    <div class="inventory-list">${this.items.length?this.items.map(item=>this.card(item)).join(''):'<div class="empty-message">No hay pallets que coincidan con el filtro.</div>'}</div>
    ${this.items.length<this.result.totalFiltrado?`<button class="show-more" id="inventoryMore" ${this.loadingMore?'disabled':''}>${this.loadingMore?'Cargando…':`Mostrar más (${this.fmt(this.result.totalFiltrado-this.items.length)} restantes)`}</button>`:''}
    <div id="inventoryModal"></div>`;
    root.querySelectorAll('[data-camera]').forEach(btn=>btn.onclick=()=>this.setCamera(btn.dataset.camera));
    root.querySelectorAll('[data-filter]').forEach(btn=>btn.onclick=()=>this.setFilter(btn.dataset.filter));
    const input=document.getElementById('inventorySearch');
    if(input)input.oninput=e=>this.onSearch(e.target.value);
    root.querySelectorAll('.inventory-card').forEach(card=>card.onclick=()=>this.detalle(card.dataset.id));
    document.getElementById('inventoryMore')?.addEventListener('click',()=>this.loadMore());
  },

  statusLabel(status){return {ENCONTRADO:'Encontrado',OTRA_CAMARA:'Otra cámara',NO_ENCONTRADO:'No encontrado',NO_EXISTE:'No existe en SAP'}[status]||status;},

  location(item){
    if(!item.posiciones.length)return 'Sin posición física WMS';
    const here=item.posiciones.filter(p=>p.camara===this.camera);
    const selected=here[0]||item.posiciones[0];
    const base=`${selected.camara} · Banda ${selected.banda} · P${selected.posicion} · ${selected.altura}`;
    return item.posiciones.length>1?`${base} · ${item.posiciones.length} posiciones`:base;
  },

  card(item){
    const visual=item.codigoVisual||'?';
    const statusClass=item.estadoInventario.toLowerCase();
    const klass=item.estadoInventario==='NO_EXISTE'?'no_encontrado no_existe':statusClass;
    const boxes=item.cajas==null?'—':this.fmt(item.cajas);
    return `<button class="inventory-card ${klass}" data-id="${this.esc(item.idLote)}">
      <i>${this.esc(visual)}</i>
      <span><strong>${this.esc(item.idLote)}</strong><small>${this.esc(item.itemcode)} · ${this.esc(item.itemname)} · ${boxes} cajas · WMS ${this.esc(item.estadoWms)}</small></span>
      <em><b>${this.esc(this.statusLabel(item.estadoInventario))}</b><small>${this.esc(this.location(item))}</small></em>
    </button>`;
  },

  item(id){return this.items.find(x=>x.idLote===id)||null;},

  detalle(id){
    const item=this.item(id),root=document.getElementById('inventoryModal');if(!item||!root)return;
    const positions=item.posiciones.length?item.posiciones.map((p,index)=>`<div><dt>Posición ${index+1}</dt><dd>${this.esc(`${p.camara} · Banda ${p.banda} · P${p.posicion} · ${p.altura}`)}${p.cajas!=null?` · ${this.fmt(p.cajas)} cajas`:''}</dd></div>`).join(''):'<div><dt>Ubicación física</dt><dd>Sin posición WMS registrada</dd></div>';
    const editButtons=this.canManage()
      ?(item.posiciones.length
        ?item.posiciones.map((p,index)=>`<button class="btn-secondary" data-edit-segment="${index}">Editar posición ${index+1} · ${this.esc(p.camara)} / Banda ${this.esc(p.banda)}</button>`).join('')
        :'<button class="btn-primary" id="inventoryAssign">Asignar posición física</button>')
      :'<small>Sin permiso mapa.gestionar: detalle disponible en modo lectura.</small>';
    root.innerHTML=`<div class="map-modal-backdrop"><section class="inventory-dialog"><header><div><b>${this.esc(item.codigoVisual||item.idLote)}</b><span>${this.esc(this.statusLabel(item.estadoInventario))}</span></div><button id="inventoryClose">×</button></header><div class="inventory-dialog-body">
      <dl class="map-detail-grid"><div><dt>ID Lote</dt><dd>${this.esc(item.idLote)}</dd></div><div><dt>Artículo</dt><dd>${this.esc(item.itemcode)} · ${this.esc(item.itemname)}</dd></div><div><dt>Cajas</dt><dd>${item.cajas==null?'—':this.fmt(item.cajas)}</dd></div><div><dt>Kilos</dt><dd>${item.kilos==null?'—':this.fmt(item.kilos)}</dd></div><div><dt>Estado WMS</dt><dd>${this.esc(item.estadoWms)}</dd></div><div><dt>Calidad SAP</dt><dd>${this.esc(item.estadoSap)}</dd></div><div><dt>Condición WMS</dt><dd>${this.esc(item.condicionPrincipal||'Sin condición principal')}</dd></div><div><dt>Cámara SAP</dt><dd>${this.esc(item.camaraSap)}</dd></div><div><dt>Detector</dt><dd>${this.esc(item.detector)}</dd></div><div><dt>Posiciones WMS</dt><dd>${this.fmt(item.posicionesMapa)}${item.multiubicado?' · MULTIUBICADO':''}</dd></div>${positions}</dl>
      ${item.noExistePadre?'<div class="lote-duplicate">⚠ Este pallet está posicionado en WMS pero no existe actualmente en Lotes_en_Stock.</div>':''}
      <div class="inventory-actions">${editButtons}${item.noExistePadre?'':`<button class="btn-secondary" id="inventoryFull">Ver ficha completa</button>`}</div>
    </div></section></div>`;
    document.getElementById('inventoryClose').onclick=()=>root.innerHTML='';
    root.querySelector('.map-modal-backdrop').onclick=e=>{if(e.target===e.currentTarget)root.innerHTML='';};
    document.getElementById('inventoryAssign')?.addEventListener('click',()=>this.asignar(item,null));
    root.querySelectorAll('[data-edit-segment]').forEach(btn=>btn.onclick=()=>this.asignar(item,item.posiciones[Number(btn.dataset.editSegment)]));
    document.getElementById('inventoryFull')?.addEventListener('click',()=>this.verFicha(item));
  },

  verFicha(item){
    AppController.navigate('lote_detallado');
    setTimeout(()=>{
      const input=document.getElementById('loteSearchInput');if(!input)return;
      input.value=item.idLote;
      LoteDetalladoController.buscar();
    },0);
  },

  asignar(item,segmento){
    if(!this.canManage())return this.toast('Tu sesión no posee permiso para gestionar posiciones del mapa.','error');
    const root=document.getElementById('inventoryModal');if(!root)return;
    const bands=MapaInventarioModel.bandas(this.camera,this.geometry);
    const levels=MapaInventarioModel.niveles(this.geometry);
    const sameCamera=segmento?.camara===this.camera;
    const selectedBand=sameCamera?String(segmento.banda):'';
    root.querySelector('.inventory-dialog-body').innerHTML=`<div class="inventory-assign-heading"><span>UBICACIÓN EN MAPA WMS</span><h3>${segmento?'Editar segmento físico':'Asignar posición física'}</h3><p>${segmento?`Se moverá únicamente el segmento seleccionado (${this.esc(segmento.camara)} / Banda ${this.esc(segmento.banda)} / P${segmento.posicion} / ${this.esc(segmento.altura)}).`:'El pallet aún no tiene una posición física registrada.'}</p></div>
      <div class="inventory-position-form"><label><span>Banda</span><div class="select-shell"><select id="invBand"><option value="">Elegir…</option>${bands.map(b=>`<option value="${this.esc(b)}" ${selectedBand===String(b)?'selected':''}>${this.esc(b)}</option>`).join('')}</select></div></label><label><span>Posición</span><div class="select-shell"><select id="invPos"></select></div></label><label><span>Nivel</span><div class="select-shell"><select id="invLevel">${levels.map(l=>`<option value="${this.esc(l)}" ${sameCamera&&segmento?.altura===l?'selected':''}>${this.esc(l)}</option>`).join('')}</select></div></label></div>
      <div class="inventory-position-preview" id="invPreview"><span>Destino seleccionado · ${this.esc(this.camera)}</span><strong>Completá banda, posición y nivel</strong></div>
      <div class="inventory-assign-actions"><button class="btn-secondary" id="invBack">Volver</button><button class="btn-primary" id="invSave"><i class="wi wi-check"></i>Guardar posición</button></div><small id="invError" style="color:#ef4444"></small>`;
    const band=document.getElementById('invBand'),pos=document.getElementById('invPos'),level=document.getElementById('invLevel');
    const fill=()=>{const max=band.value?MapaInventarioModel.maxPosiciones(this.camera,band.value,this.geometry):0;pos.innerHTML=max?Array.from({length:max},(_,i)=>`<option value="${i+1}" ${sameCamera&&Number(segmento?.posicion)===i+1?'selected':''}>${i+1}</option>`).join(''):'<option value="">Elegir…</option>';preview();};
    const preview=()=>{const target=document.querySelector('#invPreview strong');if(target)target.textContent=band.value&&pos.value?`${this.camera} · Banda ${band.value} · Posición ${pos.value} · ${level.value}`:'Completá banda, posición y nivel';};
    fill();band.onchange=fill;pos.onchange=preview;level.onchange=preview;
    document.getElementById('invBack').onclick=()=>this.detalle(item.idLote);
    document.getElementById('invSave').onclick=()=>this.guardarPosicion(item,segmento,band.value,pos.value,level.value);
  },

  async guardarPosicion(item,segmento,banda,posicion,altura){
    if(!this.canManage())return this.toast('Tu sesión no posee permiso para gestionar posiciones del mapa.','error');
    if(!banda||!posicion||!altura)return this.toast('Elegí banda, posición y nivel antes de guardar.','error');
    const button=document.getElementById('invSave'),errorNode=document.getElementById('invError');if(button)button.disabled=true;
    try{
      const result=await MapaInventarioModel.guardarPosicion({item,camara:this.camera,banda,posicion,altura,segmento});
      if(result?.ok===false){if(errorNode)errorNode.textContent=result.error||'No fue posible guardar la posición.';return;}
      document.getElementById('inventoryModal').innerHTML='';
      await this.cargar(true);
      this.toast(segmento?'Posición física actualizada en Supabase.':'Posición física registrada en Supabase.','success');
      if(result?.advertencia_almacen)this.toast(result.advertencia_almacen,'warning');
    }catch(error){if(errorNode)errorNode.textContent=error?.message||'No fue posible guardar la posición.';}
    finally{if(button)button.disabled=false;}
  }
};
