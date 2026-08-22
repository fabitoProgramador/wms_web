/** Guards transversales de las dos cámaras ya migradas a Supabase. */
const MapaCamarasActionGuard = {
  instalado:false,
  reservaTexto(value){
    if(value===true)return'SÍ';
    if(value===false)return'NO';
    const text=String(value??'').trim();
    return text||'—';
  },
  tieneReserva(value){
    if(value===true)return true;
    if(value===false||value===null||value===undefined)return false;
    return String(value).trim()!=='';
  },
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

    // Los dos bridges comparten el mismo bloque visual de Reserva. SAP puede
    // entregar booleano o un texto de reserva/cliente; nunca se debe convertir
    // un texto válido en "—" ni marcar false como reservado.
    const originalDetail=MapaController.overlayDetail,guard=this;
    MapaController.overlayDetail=function(root){
      const result=originalDetail.call(this,root);
      if(!cameras.has(this.activeCamera))return result;
      const pallet=MapaModel.getPallets().find(p=>p.id===this.selectedPalletId);
      if(!pallet)return result;
      const apply=()=>{
        root?.querySelectorAll('.compact-reserve').forEach(row=>{
          if(row.querySelector('span')?.textContent?.trim()!=='Reserva')return;
          const value=row.querySelector('b');if(value)value.textContent=guard.reservaTexto(pallet.reservado);
          row.classList.toggle('reserved',guard.tieneReserva(pallet.reservado));
        });
      };
      if(typeof requestAnimationFrame==='function')requestAnimationFrame(apply);else apply();
      return result;
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
