/** Guards puntuales para acciones legacy reutilizadas por PROTER. */
const MapaProterActionGuard = {
  instalado:false,
  install(){
    if(this.instalado)return;
    const original=MapaController.removePalletFromPosition;
    MapaController.removePalletFromPosition=function(palletId,slot,restoreKeyboard=false){
      if(this.activeCamera==='PROTER'&&!UserModel.hasPermission('mapa.gestionar')){
        return this.toast('Tu sesión no posee permiso para vaciar posiciones PROTER.','error');
      }
      return original.call(this,palletId,slot,restoreKeyboard);
    };

    window.addEventListener('wms-map-offline-status',event=>{
      const reason=event?.detail?.reason;
      if(!['synced','refresh','sync-end'].includes(reason))return;
      if(MapaController.activeCamera!=='PROTER'||!document.querySelector('.map-module[data-camera="PROTER"]'))return;
      MapaController.viewCache.forEach(entry=>{entry.stale=true;});
      MapaController.renderMap(true);
    });

    this.instalado=true;
  }
};
