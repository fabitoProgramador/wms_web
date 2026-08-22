/**
 * Persistencia offline-first del Mapa.
 *
 * El snapshot contiene exclusivamente datos backend ya normalizados + estado
 * visual/transitorio. No guarda cargas de Andén, directorios, letras maestras
 * ni ninguna base de negocio paralela.
 */
const MapaOfflineService = {
  DB:'wms_map_offline', VERSION:1, SNAPSHOTS:'snapshots', MOVEMENTS:'movements', CONFLICTS:'conflicts', ACTIVE:'active',
  initialized:false, hasSnapshot:false, backendProterReady:false, backendPostTunelReady:false, backendMapReady:false,
  metadata:null, reachable:false, _saveTimer:null, _syncing:null, _bound:false,
  palletFields:['id','lote','articulo','descripcion','numero_pallet','numero_articulo','id_lote_real','cajas','kilos','cajas_logicas','kilos_logicos','cajas_posicion','kilos_posicion','segmento_id','estado','estado_mapa','estado_wms','estado_wms_registrado','estado_sap','ubicacion','banda','posicion','altura','repetido','repetido_id_lote','repetido_codigo_visual','multiubicado','no_existe','no_existe_padre','fecha_ingreso','fecha_admision','fecha_recepcion','fecha_fabricacion','detector_metales','info_calidad','info_general','motivo_decision','reservado','fecha_pedido','calidad_estado','condicion_principal','condiciones_wms','condiciones_adicionales','decision','modalidad','flags','whscode','whsname','almacen_sap','diferencia_almacen_mapa','ultima_auditoria','codigo_visual_backend','codigo_visual_legible_backend','sin_codigo_visual','cajas_asociadas','_codigo_visual_manual','pendiente_verificacion','_backend_proter','_backend_postunel','_backend_catalog','actualizado_en'],

  open(){return new Promise((resolve,reject)=>{if(!window.indexedDB)return reject(new Error('IndexedDB no disponible'));const request=window.indexedDB.open(this.DB,this.VERSION);request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains(this.SNAPSHOTS))db.createObjectStore(this.SNAPSHOTS,{keyPath:'id'});if(!db.objectStoreNames.contains(this.MOVEMENTS))db.createObjectStore(this.MOVEMENTS,{keyPath:'id'});if(!db.objectStoreNames.contains(this.CONFLICTS))db.createObjectStore(this.CONFLICTS,{keyPath:'id'});};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});},
  async all(store){const db=await this.open();return new Promise((resolve,reject)=>{const request=db.transaction(store,'readonly').objectStore(store).getAll();request.onsuccess=()=>resolve(request.result||[]);request.onerror=()=>reject(request.error);});},
  async get(store,id){const db=await this.open();return new Promise((resolve,reject)=>{const request=db.transaction(store,'readonly').objectStore(store).get(id);request.onsuccess=()=>resolve(request.result||null);request.onerror=()=>reject(request.error);});},
  async put(store,value){const db=await this.open();return new Promise((resolve,reject)=>{const request=db.transaction(store,'readwrite').objectStore(store).put(value);request.onsuccess=()=>resolve(value);request.onerror=()=>reject(request.error);});},
  async remove(store,id){const db=await this.open();return new Promise((resolve,reject)=>{const request=db.transaction(store,'readwrite').objectStore(store).delete(id);request.onsuccess=resolve;request.onerror=()=>reject(request.error);});},

  compactPallet(p){const result={};this.palletFields.forEach(key=>{if(p[key]!==undefined)result[key]=p[key];});return result;},
  applyReadiness(metadata={}){this.backendProterReady=Boolean(metadata?.backendProter);this.backendPostTunelReady=Boolean(metadata?.backendPostTunel);this.backendMapReady=Boolean(metadata?.backendMap||(this.backendProterReady&&this.backendPostTunelReady));},
  readyForCamera(camera){const cam=String(camera||'').trim().toUpperCase();return cam==='PROTER'?this.backendProterReady:cam==='POST TUNEL'?this.backendPostTunelReady:false;},

  currentSnapshot(source='cache',extraMetadata={}){
    return {
      id:this.ACTIVE,
      pallets:MapaModel.getPallets().map(p=>this.compactPallet(p)),
      mapState:MapaModel.clone(MapaModel.getState()),
      metadata:{...(this.metadata||{}),...extraMetadata,version:Date.now(),timestamp:new Date().toISOString(),source,backendMap:Boolean(this.backendMapReady),backendProter:Boolean(this.backendProterReady),backendPostTunel:Boolean(this.backendPostTunelReady)}
    };
  },

  async saveSnapshot(source='cache',extraMetadata={}){
    const snapshot=this.currentSnapshot(source,extraMetadata);
    await this.put(this.SNAPSHOTS,snapshot);
    this.hasSnapshot=Boolean(snapshot.pallets?.length||snapshot.metadata?.backendMap);
    this.applyReadiness(snapshot.metadata);
    this.metadata=snapshot.metadata;
    this.emit();
    return snapshot;
  },
  scheduleSnapshot(source='optimistic'){clearTimeout(this._saveTimer);this._saveTimer=setTimeout(()=>this.saveSnapshot(source).catch(()=>{}),140);},

  async probeOnline(){
    if(!navigator.onLine){this.reachable=false;return false;}
    try{await fetch(`__wms_online_probe__?t=${Date.now()}`,{method:'HEAD',cache:'no-store'});this.reachable=true;}catch(_){this.reachable=false;}
    return this.reachable;
  },

  hydrateSnapshot(snapshot){
    if(!snapshot)return false;
    this.applyReadiness(snapshot.metadata||{});
    const rows=(snapshot.pallets||[]).filter(p=>Boolean(p?._backend_catalog||p?._backend_proter||p?._backend_postunel));
    MapaModel._palletCache=MapaModel.normalizarContratoDatos(rows);
    MapaModel._stateCache={...MapaModel.defaultState(),...(snapshot.mapState||{})};
    this.hasSnapshot=Boolean(rows.length||this.backendMapReady);
    this.metadata=snapshot.metadata||null;
    return this.hasSnapshot;
  },

  async initialize(){
    if(this.initialized)return{ok:this.hasSnapshot||this.backendMapReady,metadata:this.metadata,backendProterReady:this.backendProterReady,backendPostTunelReady:this.backendPostTunelReady,backendMapReady:this.backendMapReady};
    let snapshot=null;try{snapshot=await this.get(this.SNAPSHOTS,this.ACTIVE);}catch(_){}
    if(snapshot)this.hydrateSnapshot(snapshot);

    const online=await this.probeOnline();
    if(online&&window.WmsMapAdapter?.fetchSnapshot){
      try{
        const remote=await window.WmsMapAdapter.fetchSnapshot();
        if(remote?.pallets){
          MapaModel._palletCache=MapaModel.normalizarContratoDatos(remote.pallets);
          if(remote.mapState)MapaModel._stateCache={...MapaModel.defaultState(),...remote.mapState};
          this.applyReadiness(remote.metadata||{});
          await this.saveSnapshot('server',remote.metadata||{});
        }
      }catch(_){}
    }

    // Sin snapshot y sin servidor no se crea ningún repositorio demo.
    this.initialized=true;this.bind();this.emit();
    return{ok:this.hasSnapshot||this.backendMapReady,metadata:this.metadata,backendProterReady:this.backendProterReady,backendPostTunelReady:this.backendPostTunelReady,backendMapReady:this.backendMapReady,needsInitialConnection:!this.hasSnapshot&&!online};
  },

  async ensureCameraReady(camera){
    await this.initialize();
    if(this.readyForCamera(camera))return{ok:true,camera,fromCache:true};
    const refreshed=await this.refreshFromServer();
    if(refreshed.ok&&this.readyForCamera(camera))return{ok:true,camera,fromServer:true};
    return{ok:false,camera,offline:Boolean(refreshed.offline),unconfigured:Boolean(refreshed.unconfigured),error:refreshed.error||`No existe snapshot backend confirmado para ${camera}.`};
  },

  bind(){
    if(this._bound)return;this._bound=true;
    window.addEventListener('online',async()=>{const was=this.reachable;await this.probeOnline();this.emit('online');if(!was&&this.reachable)this.sync();});
    window.addEventListener('offline',()=>{this.reachable=false;this.emit('offline');});
    this._probeTimer=setInterval(async()=>{const was=this.reachable;await this.probeOnline();if(was!==this.reachable){this.emit(this.reachable?'server-online':'server-offline');if(this.reachable)this.sync();}},8000);
  },

  async record(action){
    const id=`MM-${Date.now()}-${Math.random().toString(36).slice(2,9)}`,user=UserModel.getCurrentUser();
    const item={id,idempotencyKey:id,sequence:Date.now(),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),status:'PENDIENTE_SYNC',attempts:0,userId:user?.id,userName:user?.name,mapVersion:this.metadata?.version||null,...action};
    await this.put(this.MOVEMENTS,item);this.scheduleSnapshot('optimistic-movement');this.emit('queued');if(this.reachable)this.sync();return item;
  },
  async pending(){try{return(await this.all(this.MOVEMENTS)).sort((a,b)=>(a.sequence||0)-(b.sequence||0));}catch(_){return[];}},
  async conflicts(){try{return await this.all(this.CONFLICTS);}catch(_){return[];}},
  async pendingPalletIds(){return new Set((await this.pending()).map(x=>x.palletId).filter(Boolean));},
  async status(){const movements=await this.pending(),conflicts=await this.conflicts();return{online:navigator.onLine&&this.reachable,pending:movements.filter(x=>x.status!=='CONFLICTO').length,conflicts:conflicts.length,syncing:Boolean(this._syncing),snapshot:this.metadata,backendMapReady:this.backendMapReady,backendProterReady:this.backendProterReady,backendPostTunelReady:this.backendPostTunelReady};},

  async sync(){if(this._syncing)return this._syncing;this._syncing=this._sync().finally(()=>{this._syncing=null;this.emit('sync-end');});this.emit('sync-start');return this._syncing;},
  async _sync(){
    const all=(await this.pending()).filter(x=>x.status!=='CONFLICTO');
    if(!await this.probeOnline())return{ok:false,offline:true,pending:all.length};
    const adapter=window.WmsMapAdapter?.sendMovement?window.WmsMapAdapter:(window.WmsSyncAdapter?.sendMovement?window.WmsSyncAdapter:null);
    if(!adapter)return{ok:false,unconfigured:true,pending:all.length};
    const items=all.filter(x=>!adapter.supportsMovement||adapter.supportsMovement(x));
    let synced=0,conflictCount=0;
    for(const original of items){
      const item={...original,status:'SINCRONIZANDO',attempts:(original.attempts||0)+1,updatedAt:new Date().toISOString()};await this.put(this.MOVEMENTS,item);
      try{
        const result=await adapter.sendMovement(item);
        if(result?.unsupported){await this.put(this.MOVEMENTS,original);continue;}
        if(result?.conflict){const conflict={...item,status:'CONFLICTO',reason:result.error||result.reason||'Estado remoto diferente',server:result,detectedAt:new Date().toISOString()};await this.put(this.MOVEMENTS,conflict);await this.put(this.CONFLICTS,conflict);conflictCount++;continue;}
        if(!result?.ok)throw new Error(result?.error||'Servidor rechazó el movimiento');
        await this.remove(this.MOVEMENTS,item.id);synced++;
      }catch(error){await this.put(this.MOVEMENTS,{...item,status:'REINTENTO',lastError:error.message,updatedAt:new Date().toISOString()});}
    }
    if((synced||conflictCount)&&window.WmsMapAdapter?.fetchSnapshot){
      try{const remote=await window.WmsMapAdapter.fetchSnapshot();if(remote?.pallets){MapaModel._palletCache=MapaModel.normalizarContratoDatos(remote.pallets);if(remote.mapState)MapaModel._stateCache={...MapaModel.defaultState(),...remote.mapState};this.applyReadiness(remote.metadata||{});await this.saveSnapshot('server',remote.metadata||{});}}catch(_){}
    }
    this.emit('synced');return{ok:true,synced,conflicts:conflictCount,pending:(await this.pending()).length};
  },

  async refreshFromServer(){
    if(!await this.probeOnline())return{ok:false,offline:true};
    if(!window.WmsMapAdapter?.fetchSnapshot)return{ok:false,unconfigured:true};
    const remote=await window.WmsMapAdapter.fetchSnapshot();
    if(!remote?.pallets)return{ok:false,error:'El servidor no entregó datos de mapa.'};
    MapaModel._palletCache=MapaModel.normalizarContratoDatos(remote.pallets);
    if(remote.mapState)MapaModel._stateCache={...MapaModel.defaultState(),...remote.mapState};
    this.applyReadiness(remote.metadata||{});
    await this.saveSnapshot('server',remote.metadata||{});
    this.emit('refresh');
    return{ok:true,backendMapReady:this.backendMapReady,backendProterReady:this.backendProterReady,backendPostTunelReady:this.backendPostTunelReady};
  },

  emit(reason='status'){window.dispatchEvent(new CustomEvent('wms-map-offline-status',{detail:{reason}}));}
};
