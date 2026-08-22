/**
 * Packing List de Andén.
 * Reutiliza el layout Excel/PDF ya probado de AndenController, pero sustituye
 * su modelo legacy por los campos congelados del despacho Supabase.
 */
const AndenPackingService = Object.create(AndenController);

AndenPackingService.packingModel = function(record){
  const items=(record?.pallets||[]).map((entry,index)=>{
    const p=entry?._snapshot||entry||{};
    const descripcion=String(p.descripcion||p.itemname||'Sin descripción SAP disponible');
    const normal=descripcion.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase();
    const quality=String(p.est_calidad||p.calidad_estado||p.estado_sap||'—');
    const dm=p.detector_metales??p.detector_de??p.dm;
    const reserve=p.reservado??p.u_rerservado;
    const organic=p.organico_backend===true||normal.includes('ORGANIC');
    return{
      numero:index+1,
      id:String(p.id_lote_real||p.id_lote||p.lote||''),
      sku:String(p.numero_articulo||p.itemcode||p.articulo||''),
      descripcion,
      kilos:p.kilos==null?0:Number(p.kilos)||0,
      cajas:p.cajas==null?0:Number(p.cajas)||0,
      fecha:p.fecha_fabricacion||p.fecha_prod||'—',
      calidad:quality,
      infoCalidad:String(p.info_calidad??p.u_inf_cal??''),
      infoGeneral:String(p.info_general??p.u_inf_g??''),
      dm:dm===null||dm===undefined||String(dm).trim()===''?'—':String(dm),
      reserva:reserve===null||reserve===undefined||String(reserve).trim()===''?'—':String(reserve),
      organico:organic
    };
  });

  const groups={CONVENCIONAL:new Map(),'ORGÁNICO':new Map()};
  items.forEach(item=>{
    const origin=item.organico?'ORGÁNICO':'CONVENCIONAL',bySku=groups[origin];
    if(!bySku.has(item.sku))bySku.set(item.sku,{descripcion:item.descripcion,items:[],kilos:0,cajas:0});
    const group=bySku.get(item.sku);group.items.push(item);group.kilos+=item.kilos;group.cajas+=item.cajas;
  });

  return{
    info:this.packingInfo(record),
    headers:['N°','ID LOTE','N° ARTÍCULO','DESCRIPCIÓN DEL ARTÍCULO','KG (NETO)','CAJAS','FECHA FABRICACIÓN','EST CALIDAD','INFO. CALIDAD','INFO. GENERAL','DM','RESERVA'],
    items,
    groups,
    totals:{pallets:items.length,kilos:items.reduce((sum,item)=>sum+item.kilos,0),cajas:items.reduce((sum,item)=>sum+item.cajas,0)}
  };
};
