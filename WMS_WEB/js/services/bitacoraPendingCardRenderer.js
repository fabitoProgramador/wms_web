/** Pendientes PEDIDO de Bitácora con el mismo lenguaje visual de Operaciones. */
const BitacoraPendingCardRenderer = {
  render(p={}) {
    const op=OperacionesBackendController;
    const item=OperacionesBackendModel.normalizarItem({...p,en_pedido:true});
    const dias=Number(item.dias_en_pedido||0),late=dias>=2;
    return `<article class="ops-card${late?' is-late':''}" onclick="OperacionesBackendController.toggleCard(this,event)">
      <div class="ops-card-head">
        <div class="ops-card-id"><b>${op.esc(item.id_lote||'—')}</b><small>${item.codigo_visual?`${op.esc(item.codigo_visual)} · `:''}${op.esc(item.itemcode||'—')} · ${op.esc(item.itemname||'—')}</small></div>
        <div class="ops-card-flag ops-state-flag ops-wms-primary"><small>ESTADO WMS</small>${op.badge(op.wmsPrincipal(item))}</div>
        <button type="button" class="ops-card-toggle" aria-expanded="false" aria-label="Ver detalle del pallet ${op.esc(item.id_lote||'')}"><i></i></button>
      </div>
      <div class="ops-card-metrics ops-card-metrics-compact">
        <div><small>KILOS</small><span><b class="kilos">${op.fmt(item.kilos)}</b></span></div>
        <div><small>CAJAS</small><span>${op.fmt(item.cajas)}</span></div>
        <div><small>FEC. FABRIC.</small><span>${op.esc(item.fecha_fabricacion_display||'—')}</span></div>
        <div><small>EN PEDIDO</small><span>${dias===0?'Hoy':`${dias} día${dias===1?'':'s'}`}</span></div>
      </div>
      ${op.stateStrip(item)}
      ${op.decisionStrip(item)}
      ${op.orderDelay(item)}
      <div class="ops-card-notes">
        <div><small>INFO CALIDAD</small><span>${op.textButton('Info Calidad',item.info_calidad||'Sin información de calidad.')}</span></div>
        <div><small>INFO GENERAL</small><span>${op.textButton('Info General',item.info_general||'Sin información general.')}</span></div>
      </div>
      <div class="ops-card-detail"><div class="ops-card-more">
        <div class="ops-card-kv">
          <div><small>CALIDAD SAP</small><span>${op.badge(item.estado_sap||'SIN INFORMACIÓN','quality')}</span></div>
          <div><small>ESTADO WMS REGISTRADO</small><span>${op.badge(item.estado_wms_registrado_display||'SIN ESTADO WMS PROPIO')}</span></div>
          <div><small>ESTADO WMS EFECTIVO</small><span>${op.badge(op.wmsPrincipal(item))}</span></div>
          <div><small>FLUJO OPERATIVO</small><span>${op.badge(item.flujo_display||item.estado||'SIN FLUJO')}</span></div>
          <div><small>CONDICIONES WMS</small><span>${op.esc(item.condiciones_display||'Sin condiciones pendientes')}</span></div>
          <div><small>DECISIÓN GERENCIA</small><span>${op.esc(item.decision_display||'Sin decisión gerencial')}</span></div>
          <div><small>MODALIDAD</small><span>${op.esc(item.modalidad_display||'—')}</span></div>
          <div><small>DETECTOR METALES</small><span>${op.badge(item.detector_display||'SIN INFORMACIÓN','detector')}</span></div>
          <div><small>RESERVA SAP</small><span>${op.esc(item.reservado||'SIN RESERVA')}</span></div>
          <div><small>ALMACÉN SAP</small><span>${op.esc(item.whsname||item.whscode||'—')}</span></div>
          <div><small>UBICACIÓN WMS</small><span>${op.esc(op.ubicacionWms(item))}</span></div>
        </div>
        ${op.auditBlock(item)}
        <button type="button" class="stock-action" onclick="event.stopPropagation();BitacoraOperativaController.abrirAuditoria(${Number(item.instancia_id)})">Ver auditoría completa</button>
      </div></div>
    </article>`;
  },
  install(){
    if(typeof BitacoraOperativaController==='undefined')return;
    BitacoraOperativaController.cardPendiente=p=>this.render(p);
  }
};
