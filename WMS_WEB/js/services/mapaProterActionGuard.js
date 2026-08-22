/** Guard puntual para una acción legacy reutilizada por PROTER. */
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
    this.instalado=true;
  }
};
