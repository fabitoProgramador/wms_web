/**
 * Puente de comportamiento exclusivo para Cámara POST TÚNEL.
 *
 * Se instala después de MapaProterBackendBridge. Intercepta sólo Post Túnel;
 * PROTER continúa usando su bridge y los renderizadores 2D/2.5D no cambian.
 */
const MapaPostTunelBackendBridge = {
  instalado:false,
  originales:{},

  canManage(){return UserModel.hasPermission('mapa.gestionar');},
  esc(v){return SeguridadService.escaparHtml(v);},
  realId(p){return p?PalletModel.idLoteReal(p):'';},
  esPost(ctrl){return ctrl?.activeCamera==='POST TUNEL';},
  tab(){return'postunel';},

  install(){
    if(this.instalado)return;
    if(typeof MapaController==='undefined'||typeof MapaPostTunelBackendModel==='undefined')throw new Error('No fue posible instalar el contrato backend de Cámara POST TÚNEL.');
    const ctrl=MapaController,bridge=this;
    ['init','renderMap','overlayDetail','overlayEmpty','overlayEditCode','beginCellEdit','chooseTouchDestination','overlayMove','dropPallet','emptyBand','toggleSelectedLoad','overlayCargo','undo','redo'].forEach(name=>this.originales[name]=ctrl[name]);

    ctrl.init=async function(container,camera=this.activeCamera){
      if(camera!=='POST TUNEL')return bridge.originales.init.call(this,container,camera);
      const ready=await MapaOfflineService.ensureCameraReady('POST TUNEL');
      if(!ready.ok){
        container.innerHTML=`<section class="map-offline-empty"><b>Conexión inicial requerida para POST TÚNEL</b><p>Este equipo todavía no posee un snapshot POST TÚNEL confirmado por Supabase. No se mostrarán pallets demo ni una copia legacy como datos reales.</p></section>`;
        return;
      }
      await bridge.originales.init.call(this,container,camera);
      bridge.consumirUbicacionPendiente(this);
    };

    ctrl.renderMap=function(force=false){
      const result=bridge.originales.renderMap.call(this,force);
      if(bridge.esPost(this)){
        const meta=MapaPostTunelBackendModel.camaraMeta();
        const capacity=Number(meta?.capacidad)||356;
        const occupied=MapaModel.getPallets().filter(p=>p._backend_postunel&&!p._backend_catalog&&p.ubicacion==='POST TUNEL'&&p.banda!==null).length;
        const cap=document.getElementById('mapCapacity');
        if(cap)cap.innerHTML=`<strong>${occupied}</strong><span>de ${capacity} slots ocupados</span>`;
      }
      return result;
    };

    ctrl.overlayDetail=function(root){if(!bridge.esPost(this))return bridge.originales.overlayDetail.call(this,root);return bridge.overlayDetail(this,root);};
    ctrl.overlayEmpty=function(root){if(!bridge.esPost(this))return bridge.originales.overlayEmpty.call(this,root);return bridge.overlayEmpty(this,root);};
    ctrl.overlayEditCode=function(root){if(!bridge.esPost(this))return bridge.originales.overlayEditCode.call(this,root);return bridge.overlayEditCode(this,root);};
    ctrl.beginCellEdit=function(pallet,slot,cell){if(!bridge.esPost(this))return bridge.originales.beginCellEdit.call(this,pallet,slot,cell);return bridge.beginCellEdit(this,pallet,slot,cell);};
    ctrl.chooseTouchDestination=function(occupant,slot,element){if(!bridge.esPost(this))return bridge.originales.chooseTouchDestination.call(this,occupant,slot,element);return bridge.chooseTouchDestination(this,occupant,slot,element);};
    ctrl.overlayMove=function(root){if(!bridge.esPost(this))return bridge.originales.overlayMove.call(this,root);return bridge.overlayMove(this,root);};
    ctrl.dropPallet=function(id,slot){if(!bridge.esPost(this))return bridge.originales.dropPallet.call(this,id,slot);return bridge.mover(this,id,slot,{close:false});};
    ctrl.emptyBand=function(banda){if(!bridge.esPost(this))return bridge.originales.emptyBand.call(this,banda);return bridge.emptyBand(this,banda);};
    ctrl.toggleSelectedLoad=function(pallet=null){if(!bridge.esPost(this))return bridge.originales.toggleSelectedLoad.call(this,pallet);return bridge.toggleCarga(this,pallet);};
    ctrl.overlayCargo=function(root){if(!bridge.esPost(this))return bridge.originales.overlayCargo.call(this,root);return bridge.overlayCargo(this,root);};
    ctrl.undo=function(){if(!bridge.esPost(this))return bridge.originales.undo.call(this);return bridge.undo(this);};
    ctrl.redo=function(){if(!bridge.esPost(this))return bridge.originales.redo.call(this);return bridge.redo(this);};
    this.instalado=true;
  },

  consumirUbicacionPendiente(ctrl){
    const target=ctrl.pendingLocate;
    if(!target||String(target.camara||'').toUpperCase()!=='POST TUNEL')return;
    const candidates=MapaModel.getPallets().filter(p=>p._backend_postunel&&!p._backend_catalog&&p.ubicacion==='POST TUNEL');
    const pallet=candidates.find(p=>target.segmentoId!=null&&Number(p.segmento_id)===Number(target.segmentoId))
      ||candidates.find(p=>this.realId(p)===String(target.idLote||'')&&String(p.banda)===String(target.banda)&&Number(p.posicion)===Number(target.posicion)&&p.altura===target.altura)
      ||candidates.find(p=>this.realId(p)===String(target.idLote||''));
    ctrl.pendingLocate=null;
    if(!pallet)return ctrl.toast('La ubicación solicitada ya no existe en el snapshot actual de POST TÚNEL.','warning');
    requestAnimationFrame(()=>{
      const key=ctrl.renderer?.key(pallet.banda,pallet.posicion,pallet.altura),cell=key?ctrl.renderer?.cells?.get(key):null;
      if(!cell)return ctrl.toast('El pallet existe, pero su celda no pudo localizarse en la vista actual.','warning');
      cell.scrollIntoView({block:'center',inline:'center',behavior:'smooth'});
      ctrl.selectCell(pallet,{banda:pallet.banda,posicion:pallet.posicion,altura:pallet.altura},cell);
    });
  },

  colorArticulo(p){return p?.repetido?COLOR_MAPA_REPETIDO:PalletModel.colorParaArticuloPostunel(p?.articulo,MapaModel.getPallets());},

  estaEnCarga(pallet){
    const id=this.realId(pallet),state=MapaModel.getState();
    return(state.cargo?.postunel||[]).some(entryId=>{const entry=MapaModel.getPallets().find(p=>p.id===entryId);return entry&&this.realId(entry)===id;});
  },

  entradaCarga(pallet){const id=this.realId(pallet);return MapaModel.getPallets().find(p=>p._backend_catalog&&this.realId(p)===id)||pallet;},

  palletsCarga(){
    const state=MapaModel.getState(),ids=new Set(state.cargo?.postunel||[]),seen=new Set();
    return MapaModel.getPallets().filter(p=>ids.has(p.id)).filter(p=>{const id=this.realId(p);if(!id||seen.has(id))return false;seen.add(id);return true;});
  },

  overlayDetail(ctrl,root){
    const p=MapaModel.getPallets().find(x=>x.id===ctrl.selectedPalletId);if(!p)return ctrl.closeOverlay();
    const manage=this.canManage(),visual=PalletModel.codigoVisualLegible(p),realId=this.realId(p);
    const cajas=p.cajas==null?'—':Number(p.cajas).toLocaleString('es-CL'),kilos=p.kilos==null?'—':Number(p.kilos).toLocaleString('es-CL');
    const reserved=p.reservado===true?'SÍ':p.reservado===false?'NO':'—',detector=p.detector_metales||'SIN INFORMACIÓN',quality=p.estado_sap||'—';
    const special=String(p.banda)==='01'||String(p.banda)==='02',location=`${special?'Zona':'Banda'} ${this.esc(p.banda)} · Nivel ${this.esc(p.altura)} · Posición ${p.posicion}`;
    const audit=p.ultima_auditoria,auditHtml=audit?`<div class="compact-info-row general" style="--info:#38bdf8"><span>↺</span><strong>Última auditoría <em>${this.esc(audit.evento||'Evento WMS')}</em></strong><p>${this.esc([audit.usuario,audit.rol,audit.fecha?new Date(audit.fecha).toLocaleString('es-CL'):null].filter(Boolean).join(' · '))}</p></div>`:'';
    const warnings=[p.repetido?'⚠ La referencia aparece en más de una posición.':'',p.no_existe?'⚠ Esta posición WMS no tiene actualmente un pallet correspondiente en SAP.':'',p.diferencia_almacen_mapa?`⚠ SAP indica ${p.almacen_sap||'otro almacén'}; la ubicación física WMS es POST TÚNEL.`:''].filter(Boolean).map(x=>`<p class="map-warning">${this.esc(x)}</p>`).join('');
    const disabled=manage?'':'disabled title="Sin permiso mapa.gestionar"',inLoad=this.estaEnCarga(p),articleColor=this.colorArticulo(p)||'#64748B';

    ctrl.overlayShell(root,'Detalle del pallet',`<div class="pallet-detail-hero"><div class="pallet-visual-code"><small>REFERENCIA VISUAL</small><strong>${this.esc(visual)}</strong></div><span class="map-state-badge" style="--state:${articleColor}">ART. ${this.esc(p.articulo||'—')}</span></div>
      <section class="pallet-real-id"><small>ID REAL DEL LOTE</small><strong>${this.esc(realId)}</strong><span>Artículo ${this.esc(p.articulo||'—')} · Pallet ${this.esc(p.numero_pallet||'—')}</span></section>
      <div class="pallet-detail-section product-section"><h4>Producto</h4><dl class="map-detail-grid product-summary"><div class="wide"><dt>Descripción</dt><dd>${this.esc(p.descripcion||'—')}</dd></div><div><dt>Estado WMS</dt><dd>${this.esc(p.estado_wms||p.estado||'—')}</dd></div><div><dt>Calidad SAP</dt><dd>${this.esc(quality)}</dd></div><div class="stock-metric"><dt>Kilos físicos</dt><dd>${kilos} <small>kg</small></dd></div><div class="stock-metric"><dt>Cajas físicas</dt><dd>${cajas}</dd></div></dl></div>
      <div class="pallet-detail-section insight-section"><h4>Información asociada</h4><div class="pallet-information-compact"><div class="compact-info-row quality" style="--info:#10b981"><span>🔬</span><strong>Calidad <em>${this.esc(quality)}</em></strong><p>${this.esc(p.info_calidad||'Sin información de calidad registrada.')}</p></div><div class="compact-info-row general" style="--info:#38bdf8"><span>📝</span><strong>Info general</strong><p>${this.esc(p.info_general||'Sin información general registrada.')}</p></div><div class="compact-reserve ${reserved==='SÍ'?'reserved':''}"><span>Reserva</span><b>${this.esc(reserved)}</b></div><div class="compact-reserve"><span>Detector</span><b>${this.esc(detector)}</b></div>${auditHtml}</div></div>
      <div class="pallet-detail-section trace-section"><h4>Ubicación</h4><dl class="map-detail-grid traceability"><div class="wide"><dt>Posición actual</dt><dd>${location}</dd></div><div><dt>Almacén SAP</dt><dd>${this.esc(p.almacen_sap||p.whscode||'—')}</dd></div><div><dt>Segmento WMS</dt><dd>${this.esc(p.segmento_id??'pendiente de sincronizar')}</dd></div></dl></div>${warnings}
      <div class="pallet-shortcuts" aria-label="Atajos de teclado"><span><kbd>P</kbd>Carga</span><span><kbd>Espacio</kbd>Editar</span><span><kbd>Supr</kbd>Vaciar</span><span><kbd>Esc</kbd>Cerrar</span></div>
      <div class="overlay-actions detail-action-grid"><button class="btn-primary" id="detailLoad"><i class="wi wi-truck"></i>${inLoad?'Quitar carga':'Agregar carga'}</button><button class="btn-secondary" id="detailTouchMove" ${disabled}><i class="wi wi-hand"></i>Elegir destino</button><button class="btn-secondary" id="detailMove" ${disabled}><i class="wi wi-swap"></i>Mover</button><button class="btn-secondary" id="detailEditCode" ${disabled}><i class="wi wi-edit"></i>Editar</button><button class="btn-secondary danger" id="detailDelete" ${disabled}><i class="wi wi-erase"></i>Vaciar</button></div>`,'detail-overlay pallet-detail-overlay');
    document.getElementById('detailLoad').onclick=()=>this.toggleCarga(ctrl,p);
    if(manage){document.getElementById('detailTouchMove').onclick=()=>ctrl.startTouchMove(p.id);document.getElementById('detailMove').onclick=()=>ctrl.openOverlay('move');document.getElementById('detailEditCode').onclick=()=>ctrl.openOverlay('edit-code');document.getElementById('detailDelete').onclick=()=>ctrl.removePalletFromPosition(p.id,ctrl.selectedSlot);}
  },

  overlayEmpty(ctrl,root){
    const s=ctrl.selectedSlot,manage=this.canManage(),special=String(s.banda)==='01'||String(s.banda)==='02';
    ctrl.overlayShell(root,`Slot vacío · ${special?'Z':'B'}${this.esc(s.banda)} · P${s.posicion} · ${s.altura}`,`<p>La posición está disponible. La identidad se resolverá contra Supabase o el último catálogo backend si el equipo está offline.</p><button class="btn-primary wide" id="emptyAssign" ${manage?'':'disabled title="Sin permiso mapa.gestionar"'}><i class="wi wi-plus"></i>Asignar código visual</button>`,'detail-overlay');
    if(manage)document.getElementById('emptyAssign').onclick=()=>ctrl.openOverlay('edit-code');
  },

  overlayEditCode(ctrl,root){
    const slot=ctrl.selectedSlot,pallet=MapaModel.getPallets().find(x=>x.id===ctrl.selectedPalletId),value=pallet&&!pallet.sin_codigo_visual?PalletModel.codigoVisual(pallet):'';
    const special=String(slot.banda)==='01'||String(slot.banda)==='02';
    ctrl.overlayShell(root,pallet?`Editar ${this.esc(PalletModel.codigoVisualLegible(pallet))}`:'Asignar pallet al slot',`<p>${pallet?'Corregí la identidad de esta posición física. La operación queda auditada y no modifica SAP.':`Destino: ${special?'zona':'banda'} ${this.esc(slot.banda)}, posición ${slot.posicion}, nivel ${slot.altura}.`}</p><label class="touch-code-field"><span>ID lote o código visual</span><input id="touchCodeInput" maxlength="16" value="${this.esc(value)}" placeholder="Ej: A234 o ID completo" autocomplete="off" autocapitalize="characters"></label><div class="overlay-actions"><button class="btn-secondary" id="touchCodeCancel">Cancelar</button><button class="btn-primary" id="touchCodeSave">Guardar</button></div><small id="touchCodeError" style="color:#ef4444"></small>`,'edit-code-overlay touch-action-overlay');
    const input=document.getElementById('touchCodeInput'),save=()=>this.guardarCodigo(ctrl,pallet,slot,input.value,document.getElementById('touchCodeError'));input.focus();input.select();
    document.getElementById('touchCodeCancel').onclick=()=>ctrl.closeOverlay();document.getElementById('touchCodeSave').onclick=save;input.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();save();}};
  },

  beginCellEdit(ctrl,pallet,slot,cell){
    if(!cell||!this.canManage())return this.canManage()?null:ctrl.toast('Tu sesión no posee permiso para editar posiciones POST TÚNEL.','error');
    const original=pallet&&!pallet.sin_codigo_visual?PalletModel.codigoVisual(pallet):'';
    cell.innerHTML=`<input class="map-cell-editor" aria-label="ID lote o código visual" maxlength="16" value="${this.esc(original)}">`;
    const input=cell.querySelector('input');input.focus();input.select();let done=false;
    const finish=async save=>{if(done)return;done=true;if(save&&input.value.trim())await this.guardarCodigo(ctrl,pallet,slot,input.value,null,{close:false});else ctrl.refresh();};
    input.onkeydown=e=>{e.stopPropagation();if(e.key==='Enter'){e.preventDefault();finish(true);}if(e.key==='Escape'){e.preventDefault();finish(false);}};
    input.onblur=()=>setTimeout(()=>{if(document.body.contains(input))finish(false);},80);
  },

  async guardarCodigo(ctrl,pallet,slot,codigo,errorNode=null,{close=true}={}){
    if(!this.canManage())return ctrl.toast('Tu sesión no posee permiso para gestionar posiciones POST TÚNEL.','error');
    const code=String(codigo||'').trim();if(!code){if(errorNode)errorNode.textContent='Ingresá un ID de lote o código visual.';return;}
    const resolved=await MapaPostTunelBackendModel.resolverOperacional(code);
    if(!resolved?.ok||!resolved?.pallet){const msg=resolved?.error||'No fue posible resolver el pallet.';if(errorNode)errorNode.textContent=msg;else ctrl.toast(msg,'error');return;}
    const db=MapaModel.getPallets();
    if(pallet){
      const before=MapaModel.clone(db);UndoService.guardarSnapshot('POST TUNEL',before);
      const segmentoId=pallet.segmento_id;
      if(segmentoId==null){ctrl.toast('La posición todavía no posee segmento remoto confirmado. Actualizá antes de corregirla.','warning');return;}
      MapaPostTunelBackendModel.aplicarIdentidad(pallet,resolved.pallet);MapaModel.recalcularRepetidos(db);MapaModel.savePallets(db);
      MapaOfflineService.record({action:'REEMPLAZAR_SEGMENTO',camera:'POST TUNEL',palletId:pallet.id,palletRealId:this.realId(pallet),palletCode:PalletModel.codigoVisual(pallet),segmentoId,enteredCode:code,createdAt:new Date().toISOString()}).catch(()=>ctrl.toast('La corrección quedó local, pero no pudo entrar a la cola de sincronización.','error'));
    }else{
      const occupant=db.find(p=>p.ubicacion==='POST TUNEL'&&p.banda!==null&&String(p.banda)===String(slot.banda)&&Number(p.posicion)===Number(slot.posicion)&&p.altura===slot.altura);
      if(occupant)return ctrl.toast(`La posición ya está ocupada por ${PalletModel.codigoVisualLegible(occupant)}.`,'error');
      UndoService.guardarSnapshot('POST TUNEL',db);
      const created=MapaPostTunelBackendModel.resolvedToSegment(resolved.pallet,slot);db.push(created);MapaModel.recalcularRepetidos(db);MapaModel.savePallets(db);
      ctrl.recordMovement('ASIGNAR_PALLET',created,null,ctrl.positionOf(created));
    }
    if(close)ctrl.closeOverlay();ctrl.refresh();ctrl.toast('Cambio aplicado y enviado a sincronización POST TÚNEL.',MapaOfflineService.reachable?'success':'warning');
  },

  chooseTouchDestination(ctrl,occupant,slot,element){
    const moving=MapaModel.getPallets().find(x=>x.id===ctrl.pendingMovePalletId);if(!moving)return ctrl.cancelTouchMove();
    if(String(moving.banda)===String(slot.banda)&&Number(moving.posicion)===Number(slot.posicion)&&moving.altura===slot.altura)return ctrl.toast('Ese pallet ya se encuentra en esa posición.','info');
    if(occupant&&occupant.id!==moving.id)return ctrl.toast(`Destino ocupado por ${PalletModel.codigoVisualLegible(occupant)}. Elegí una posición vacía.`,'error');
    ctrl.selectedSlot=slot;ctrl.overlayAnchor=element||ctrl.selectedCellElement;document.querySelectorAll('.map-slot.touch-destination').forEach(x=>x.classList.remove('touch-destination'));element?.classList.add('touch-destination');
    const root=document.getElementById('mapOverlayRoot'),special=String(slot.banda)==='01'||String(slot.banda)==='02',destination=`${special?'Zona':'Banda'} ${this.esc(slot.banda)} · P${slot.posicion} · ${slot.altura}`;
    root.dataset.mode='move-confirm';ctrl.overlayShell(root,'Confirmar movimiento',`<div class="touch-move-summary"><span><small>PALLET</small><b>${this.esc(PalletModel.codigoVisualLegible(moving))}</b></span><i>→</i><span><small>DESTINO</small><b>${destination}</b></span></div><p>La posición seleccionada está vacía.</p><div class="overlay-actions"><button class="btn-secondary" id="touchMoveBack">Elegir otra</button><button class="btn-primary" id="touchMoveConfirm">Confirmar movimiento</button></div>`,'move-confirm-overlay touch-action-overlay');
    document.getElementById('touchMoveBack').onclick=()=>{element?.classList.remove('touch-destination');ctrl.closeOverlay();};
    document.getElementById('touchMoveConfirm').onclick=()=>this.mover(ctrl,moving.id,slot,{close:true,finishTouch:true});
  },

  overlayMove(ctrl,root){
    const p=MapaModel.getPallets().find(x=>x.id===ctrl.selectedPalletId);if(!p)return;
    const bands=MapaPostTunelBackendModel.bandas(),options=bands.map(b=>`<option value="${this.esc(b)}" ${String(b)===String(p.banda)?'selected':''}>${this.esc(b)}</option>`).join('');
    ctrl.overlayShell(root,`Mover ${this.esc(PalletModel.codigoVisualLegible(p))}`,`<p>Seleccioná una ubicación exacta. Un destino ocupado será rechazado.</p><div class="move-grid"><label>Zona / Banda<select id="moveBand">${options}</select></label><label>Posición<select id="movePos"></select></label><label>Nivel<select id="moveLevel"><option ${p.altura==='C1'?'selected':''}>C1</option><option ${p.altura==='C2'?'selected':''}>C2</option></select></label></div><div class="overlay-actions"><button class="btn-secondary" id="moveDelete">Vaciar esta celda</button><button class="btn-primary" id="moveSave">Mover pallet</button></div>`,'move-overlay touch-action-overlay');
    const band=document.getElementById('moveBand'),pos=document.getElementById('movePos'),fill=()=>{const max=MapaPostTunelBackendModel.maxPosiciones(band.value);pos.innerHTML=Array.from({length:max},(_,i)=>`<option value="${i+1}" ${i+1===Number(p.posicion)?'selected':''}>${i+1}</option>`).join('');};fill();band.onchange=fill;
    document.getElementById('moveSave').onclick=()=>this.mover(ctrl,p.id,{banda:band.value,posicion:Number(pos.value),altura:document.getElementById('moveLevel').value},{close:true});
    document.getElementById('moveDelete').onclick=()=>ctrl.removePalletFromPosition(p.id,ctrl.selectedSlot);
  },

  mover(ctrl,id,slot,{close=false,finishTouch=false}={}){
    if(!this.canManage())return ctrl.toast('Tu sesión no posee permiso para mover pallets POST TÚNEL.','error');
    const db=MapaModel.getPallets(),pallet=db.find(p=>p.id===id);if(!pallet)return;
    const occupant=db.find(p=>p.ubicacion==='POST TUNEL'&&p.banda!==null&&p.id!==id&&String(p.banda)===String(slot.banda)&&Number(p.posicion)===Number(slot.posicion)&&p.altura===slot.altura);
    if(occupant)return ctrl.toast(`Destino ocupado por ${PalletModel.codigoVisualLegible(occupant)}. No se desplazó ningún pallet.`,'error');
    if(String(pallet.banda)===String(slot.banda)&&Number(pallet.posicion)===Number(slot.posicion)&&pallet.altura===slot.altura)return ctrl.toast('El pallet ya se encuentra en esa posición.','info');
    const origin=ctrl.positionOf(pallet);UndoService.guardarSnapshot('POST TUNEL',db);
    const moved=MapaModel.moverPalletSeguro(id,'POST TUNEL',slot.banda,Number(slot.posicion),slot.altura);if(!moved?.ok)return ctrl.toast(moved?.error||'No fue posible mover el pallet.','error');
    ctrl.recordMovement('MOVER_PALLET',pallet,origin,ctrl.positionOf(pallet));
    if(finishTouch)ctrl.cancelTouchMove();if(close)ctrl.closeOverlay();ctrl.refresh();ctrl.toast('Movimiento aplicado y enviado a sincronización POST TÚNEL.',MapaOfflineService.reachable?'success':'warning');
  },

  emptyBand(ctrl,banda){
    if(!this.canManage())return ctrl.toast('Tu sesión no posee permiso para vaciar zonas o bandas POST TÚNEL.','error');
    const db=MapaModel.getPallets(),affected=db.filter(p=>p.ubicacion==='POST TUNEL'&&String(p.banda)===String(banda));if(!affected.length)return;
    UndoService.guardarSnapshot('POST TUNEL',db);const removed=MapaModel.vaciarBanda('POST TUNEL',banda);
    MapaOfflineService.record({action:'VACIAR_BANDA',camera:'POST TUNEL',band:String(banda),reason:'Vaciar zona/banda desde Mapa POST TÚNEL',createdAt:new Date().toISOString()}).catch(()=>ctrl.toast('El vaciado quedó local, pero no pudo entrar a la cola.','error'));
    ctrl.refresh();ctrl.toast(`${['01','02'].includes(String(banda))?'Zona':'Banda'} ${banda}: ${removed} pallet(s) retirado(s) del snapshot local y enviados a sincronización.`,MapaOfflineService.reachable?'success':'warning');
  },

  toggleCarga(ctrl,pallet=null){
    const p=pallet||MapaModel.getPallets().find(x=>x.id===ctrl.selectedPalletId);if(!p)return;
    const state=MapaModel.getState();state.cargo||={embarque:[],postunel:[]};state.cargo.postunel||=[];
    const real=this.realId(p),ids=state.cargo.postunel,matching=ids.filter(id=>{const e=MapaModel.getPallets().find(x=>x.id===id);return e&&this.realId(e)===real;});
    if(matching.length)state.cargo.postunel=ids.filter(id=>!matching.includes(id));
    else{const entry=this.entradaCarga(p);if(!state.cargo.postunel.includes(entry.id))state.cargo.postunel.push(entry.id);}
    MapaModel.saveState(state);MapaOfflineService.scheduleSnapshot('post-load-selection');ctrl.closeOverlay();ctrl.refresh();ctrl.toast(matching.length?'Pallet quitado de la preparación de carga.':'Pallet agregado a la preparación de carga.','info');
  },

  async agregarCargaPorCodigo(ctrl,codigo){
    const result=await MapaPostTunelBackendModel.resolverOperacional(codigo);if(!result?.ok||!result?.pallet)return ctrl.toast(result?.error||'No se encontró el pallet.','error');
    const id=String(result.pallet.id_lote||''),entry=MapaModel.getPallets().find(p=>p._backend_catalog&&this.realId(p)===id);if(!entry)return ctrl.toast('El pallet fue resuelto, pero no existe en el catálogo del snapshot actual. Actualizá el mapa.','warning');
    const state=MapaModel.getState();state.cargo.postunel||=[];if(state.cargo.postunel.includes(entry.id))return ctrl.toast('El pallet ya está en esta preparación de carga.','info');state.cargo.postunel.push(entry.id);MapaModel.saveState(state);MapaOfflineService.scheduleSnapshot('post-load-selection');ctrl.refresh();ctrl.openOverlay('cargo');
  },

  overlayCargo(ctrl,root){
    const pallets=this.palletsCarga(),cajas=pallets.reduce((s,p)=>s+(Number(p.cajas)||0),0),arts=new Set(pallets.map(p=>p.articulo)).size;
    const cells=pallets.length?pallets.map(p=>`<button class="load-pallet" data-id="${this.esc(p.id)}" title="Tocar para quitar"><strong>${this.esc(PalletModel.codigoVisual(p))}</strong><small>${this.esc(p.articulo||'—')}</small><i style="--state:${this.colorArticulo(p)||'#64748B'}">ART</i></button>`).join(''):'<p class="empty-message">Todavía no hay pallets en la preparación de carga.</p>';
    ctrl.overlayShell(root,'🚚 Post Túnel',`<div class="manual-load"><input id="manualLoadCode" placeholder="ID lote o código visual" autofocus><button id="manualLoadAdd">Agregar</button></div><small>La selección no retira físicamente pallets del mapa. La transferencia real a Andén se realizará en el módulo Andén de Carga.</small><div class="load-progress"><b>${pallets.length} de 30 pallets</b><span>${pallets.length>=30?'rampla completa':pallets.length>=20?`faltan ${30-pallets.length} para 30`:'en preparación'}</span></div><div class="load-grid">${cells}</div><div class="load-totals"><span><small>Pallets</small><b>${pallets.length}</b></span><span><small>Cajas</small><b>${cajas.toLocaleString('es-CL')}</b></span><span><small>Artículos</small><b>${arts}</b></span></div><button class="btn-primary wide" id="goToDock">Continuar al Andén de Carga<i class="wi wi-right"></i></button>`,'cargo-overlay');
    root.querySelectorAll('.load-pallet').forEach(btn=>btn.onclick=()=>{const p=MapaModel.getPallets().find(x=>x.id===btn.dataset.id);if(p)this.toggleCarga(ctrl,p);ctrl.openOverlay('cargo');});
    const add=()=>{const input=document.getElementById('manualLoadCode');this.agregarCargaPorCodigo(ctrl,input.value.trim());};document.getElementById('manualLoadAdd').onclick=add;document.getElementById('manualLoadCode').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();add();}};
    document.getElementById('goToDock').onclick=()=>{ctrl.closeOverlay();AndenController.activeTab='postunel';AppController.navigate('anden_carga');};
  },

  undo(ctrl){
    const before=MapaModel.clone(MapaModel.getPallets());if(!UndoService.deshacer('POST TUNEL',MapaModel.getPallets()))return;
    ctrl.reconcileCargo();ctrl.recordPositionDifferences(before,'DESHACER');ctrl.refresh();ctrl.toast('Cambio deshecho y enviado a sincronización.','info');
  },

  redo(ctrl){
    const before=MapaModel.clone(MapaModel.getPallets());if(!UndoService.rehacer('POST TUNEL',MapaModel.getPallets()))return;
    ctrl.reconcileCargo();ctrl.recordPositionDifferences(before,'REHACER');ctrl.refresh();ctrl.toast('Cambio rehecho y enviado a sincronización.','info');
  }
};
