/** Guards transversales de las dos cámaras ya migradas a Supabase. */
const MapaCamarasActionGuard = {
  instalado:false,
  install(){
    if(this.instalado)return;
    const cameras=new Set(['PROTER','POST TUNEL']);

    // Readiness exterior: resuelve el caso donde MapaOfflineService se inició
    // antes del login y el primer RPC no tenía todavía una sesión Auth.
    const originalInit=MapaController.init;
    MapaController.init=async function(container,camera=this.activeCamera){
      if(cameras.has(camera)){
        const ready=await MapaOfflineService.ensureCameraReady(camera);
        if(!ready.ok){
          container.innerHTML=`<section class="map-offline-empty"><b>Conexión inicial requerida para ${SeguridadService.escaparHtml(camera)}</b><p>No existe todavía un snapshot confirmado por Supabase para esta cámara. No se mostrarán datos demo como si fueran reales.</p></section>`;
          return;
        }
      }
      return originalInit.call(this,container,camera);
    };

    // Supr/Backspace reutiliza removePalletFromPosition del controlador base.
    // Se mantiene la función, pero con el mismo RBAC que los botones visibles.
    const originalRemove=MapaController.removePalletFromPosition;
    MapaController.removePalletFromPosition=function(palletId,slot,restoreKeyboard=false){
      if(cameras.has(this.activeCamera)&&!UserModel.hasPermission('mapa.gestionar')){
        return this.toast(`Tu sesión no posee permiso para vaciar posiciones ${this.activeCamera}.`,'error');
      }
      return originalRemove.call(this,palletId,slot,restoreKeyboard);
    };

    // Después de una confirmación/conflicto el snapshot remoto vuelve a mandar.
    // No basta con repintar clases: hay que reconstruir las celdas físicas.
    window.addEventListener('wms-map-offline-status',event=>{
      const reason=event?.detail?.reason;
      if(!['synced','refresh','sync-end'].includes(reason))return;
      const camera=MapaController.activeCamera;
      if(!cameras.has(camera)||!document.querySelector(`.map-module[data-camera="${camera}"]`))return;
      MapaController.viewCache.forEach(entry=>{entry.stale=true;});
      MapaController.renderMap(true);
    });

    this.instalado=true;
  }
};
