/** Reglas de negocio de las tres subsecciones de Operaciones. */
const OperacionesModel = {
  HISTORY_KEY: 'wms_web_historial_aprobaciones',
  MOVEMENT_STATES: ['SIN INFORMACIÓN','VERIFICACIÓN','SIN DM','RECHAZO','PROHIBICIONES'],
  TARGET_STATES: ['RECHAZO','VERIFICACIÓN','SIN DM','PROHIBICIONES'],
  SHIPPING_STATES: ['AUTORIZADOS A ENVIAR','PEDIDO','REPROCESO'],
  SHIPPING_CLASSES: ['RETAIL','LIBERADO','VERIFICAR LIBERADO','VERIFICAR RETAIL','SIN DM LIBERADO','SIN DM RETAIL'],
  sameState(a,b){return String(a||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase()===String(b||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase();},
  // Programa MVC enriquece una sola vez el repositorio y todas las vistas
  // consumen los mismos atributos. StockModel replica ese adaptador temporal.
  pallets(){return StockModel.pallets();},
  save(ps){MapaModel.savePallets(ps);},
  display(p){
    const alert=this.sameState(p.estado,'RECHAZO')||this.sameState(p.estado,'BLOQUEADOS');
    const iso=p.fecha_admision||p.fecha_ingreso||'';
    const fecha=/^\d{4}-\d{2}-\d{2}$/.test(iso)?iso.split('-').reverse().join('/'):iso||'—';
    return {...p,
      lote_display:PalletModel.idLoteReal(p), articulo_display:PalletModel.numeroArticulo(p),
      descripcion_display:PalletModel.descripcion(p),
      kilos_display:PalletModel.kilos(p), detector_display:p.detector_metales||(alert?'RECHAZADO':'APROBADO'),
      fecha_fabricacion_display:p.fecha_fabricacion||'—',
      estado_calidad_display:StockModel.normalizarEstadoCalidad(p.estado_calidad||p.est_calidad||p.calidad_estado),
      calidad_display:p.info_calidad||(alert?'Revisión requerida por calidad o producción.':'Control de calidad conforme.'),
      calidad_estado_display:p.calidad_estado||(alert?'ALERTA':'OK'),
      general_display:p.info_general||`Lote ingresado a ${p.ubicacion||'ubicación no informada'}. Sin observaciones logísticas adicionales.`,
      reservado_display:p.reservado||(this.sameState(p.estado,'PEDIDO')?'SÍ':'NO'), fecha_display:fecha,
      motivo_display:p.motivo_decision||''
    };
  },
  filterMovements({search='',state='TODOS',detector='TODOS'}={}){
    const q=search.trim().toLocaleLowerCase('es');
    return this.pallets().map(p=>this.display(p)).filter(p=>(state==='TODOS'||this.sameState(p.estado,state))&&(detector==='TODOS'||p.detector_display===detector)&&(!q||[p.id,p.lote,p.id_lote_real,p.articulo,p.numero_articulo].some(v=>String(v||'').toLocaleLowerCase('es').includes(q))));
  },
  reclassify(ids,target,reason){
    if(!ids?.length)return{ok:false,error:'Debe seleccionar al menos un pallet para reclasificar.'};
    if(!target)return{ok:false,error:'Debe elegir a qué Estado (tabla) se mueven los pallets seleccionados.'};
    if(!String(reason||'').trim())return{ok:false,error:'Debe ingresar la justificación / motivo técnico.'};
    const set=new Set(ids),ps=this.pallets();let cantidad=0;
    ps.forEach(p=>{if(set.has(p.id)){p.estado=target;cantidad++;}});this.save(ps);
    // Auditoria: deja constancia de quien reclasifico, cuando y con que motivo.
    this.record('reclasificacion',ids,{nuevo_estado:target,motivo:String(reason).trim()});
    return{ok:true,cantidad,estado_destino:target};
  },
  /* Una columna pegada desde Excel llega con basura previsible: tabs, comas,
     punto y coma, barra vertical, comillas alrededor del valor y el espacio
     duro (U+00A0) que se cuela al copiar desde una planilla o desde el
     navegador. Todo eso se convierte en un lote por linea. */
  normalizeLots(text){
    return String(text||'')
      .replace(/\u00a0/g,' ')
      .replace(/[\t,;|\r]/g,'\n')
      .split('\n')
      .map(x=>x.trim().replace(/^["']+|["']+$/g,'').trim())
      .filter(Boolean)
      .join('\n');
  },
  /* Las claves las define PalletModel.clavesDeBusqueda, la unica fuente de
     verdad del sistema: ID de lote completo, codigo visual con guion y sin
     guion. El id interno del pallet y el campo lote crudo quedaron fuera a
     proposito: no se muestran en ninguna pantalla. */
  lotKeys(p){return PalletModel.clavesDeBusqueda(p);},
  /* Devuelve los pallets y, sobre todo, QUE quedo afuera. Sin esta segunda
     mitad el despacho aplicaba en silencio sobre los que calzaban y el
     operador no tenia forma de enterarse de los que no. */
  matchLots(text){
    const pedidos=[...new Set(this.normalizeLots(text).split('\n').filter(Boolean).map(x=>x.toUpperCase()))];
    if(!pedidos.length)return{pallets:[],pedidos:[],encontrados:[],sinCoincidencia:[]};
    const buscados=new Set();
    pedidos.forEach(t=>{buscados.add(t);const plano=PalletModel.normalizarCodigo(t);if(plano)buscados.add(plano);});
    const alcanzadas=new Set(),pallets=[];
    this.pallets().forEach(p=>{
      const claves=this.lotKeys(p);
      for(const k of claves){
        if(buscados.has(k)){pallets.push(p);claves.forEach(x=>alcanzadas.add(x));break;}
      }
    });
    const calza=t=>alcanzadas.has(t)||alcanzadas.has(PalletModel.normalizarCodigo(t));
    return{pallets,pedidos,encontrados:pedidos.filter(calza),sinCoincidencia:pedidos.filter(t=>!calza(t))};
  },
  previewLots(text){return this.matchLots(text).pallets.map(p=>this.display(p));},
  /* Con simular:true corre exactamente las mismas validaciones pero no
     escribe nada. Sirve para que el controlador pueda avisar de los lotes sin
     coincidencia ANTES de tocar el estado comercial, sin duplicar reglas. */
  processDispatch(text,destination,reason,classification,{simular=false}={}){
    const content=this.normalizeLots(text),authorized=destination==='AUTORIZADOS A ENVIAR';
    if(!content)return{ok:false,error:'Debe ingresar al menos un lote para procesar.'};
    if(authorized&&!classification)return{ok:false,error:'Debe seleccionar la Clasificación de Envío (Retail, Liberado, etc.).'};
    if(!String(reason||'').trim())return{ok:false,error:'Debe ingresar la Justificación / Orden de Gerencia.'};
    const encaje=this.matchLots(content),elegidos=new Set(encaje.pallets.map(p=>p.id));
    if(!elegidos.size)return{ok:false,error:'Ninguno de los lotes ingresados existe en el inventario actual.'};
    const ps=this.pallets();let modificados=0;const ids=[];
    ps.forEach(p=>{if(elegidos.has(p.id)){ids.push(p.id);modificados++;if(simular)return;p.estado=destination;if(authorized)p.clasificacion_envio=classification;}});
    if(simular)return{ok:true,simulado:true,modificados,destino:destination,clasificacion_envio:authorized?classification:null,sinCoincidencia:encaje.sinCoincidencia};
    this.save(ps);/* Deja el mismo asiento de auditoria que la reclasificacion, para que la
       tarjeta de Despacho pueda mostrar quien, cuando y por que. */
    this.record('despacho',ids,{nuevo_estado:destination,clasificacion_envio:authorized?classification:null,motivo:String(reason).trim()});return{ok:true,modificados,destino:destination,clasificacion_envio:authorized?classification:null,sinCoincidencia:encaje.sinCoincidencia};
  },
  pending(){return this.pallets().filter(p=>this.sameState(p.estado,'RECHAZO')||this.sameState(p.estado,'BLOQUEADOS')).sort((a,b)=>String(a.lote).localeCompare(String(b.lote))||String(a.id).localeCompare(String(b.id))).map(p=>this.display(p));},
  commonReason(items=this.pending()){if(!items.length)return null;const reasons=new Set(items.map(p=>p.calidad_display));if(reasons.size!==1)return null;const [r]=reasons;return !r||r==='Motivo no especificado en el sistema.'?null:r;},
  /* El MOTIVO es del operador, no de calidad: sirve para marcar por que se
     va a aprobar o rechazar un grupo de pallets antes de decidir. Vive en
     su propio campo (motivo_decision) y NO pisa info_calidad, que es el
     dato de calidad que leen Stock, Reportes, Mapa, Anden y Bitacora. */
  updateDecisionReason(id,reason){const ps=this.pallets(),p=ps.find(x=>x.id===id);if(!p)return{ok:false,error:`No se encontró el pallet '${id}'.`};p.motivo_decision=String(reason||'').trim();this.save(ps);return{ok:true};},
  history(){try{return JSON.parse(localStorage.getItem(this.HISTORY_KEY)||'[]')}catch(_){return[]}},
  // Ultimo asiento de auditoria que afecta a un pallet. Solo lectura.
  lastAudit(palletId){const h=this.history();for(let i=h.length-1;i>=0;i--){const e=h[i];if(Array.isArray(e.pallet_ids)&&e.pallet_ids.includes(palletId))return e;}return null;},
  auditLabel(action){return{reclasificacion:'Reclasificación',despacho:'Despacho / Reproceso',aprobar:'Aprobación',reproceso:'Envío a reproceso',rechazar:'Rechazo definitivo',envio_gerencia:'Envío a Gerencia'}[action]||String(action||'Movimiento');},
  saveHistory(x){localStorage.setItem(this.HISTORY_KEY,JSON.stringify(x));},
  record(action,ids,detail={},lotId=null){const h=this.history(),entry={id:`APR-${String(h.length+1).padStart(4,'0')}`,lote_id:lotId,fecha:new Date().toLocaleString('es-CL'),accion:action,usuario:(UserModel.getCurrentUser()||{}).name||'Usuario WMS',pallet_ids:[...ids],detalle:detail};h.push(entry);this.saveHistory(h);return entry;},
  decide(ids,decision){const map={aprobar:['LIBERADO','Aprobado por Gerencia'],reproceso:['REPROCESO','Enviado a Reproceso'],rechazar:['RECHAZO_DEFINITIVO','Rechazado en forma definitiva']},target=map[decision];if(!target)return{ok:false,error:`Decisión inválida: '${decision}'.`};if(!ids?.length)return{ok:false,error:'No hay pallets seleccionados para aplicar esta decisión.'};const set=new Set(ids),ps=this.pallets(),now=new Date().toLocaleString('es-CL'),user=(UserModel.getCurrentUser()||{}).name||'Usuario WMS';let cantidad=0;const razones=new Set();ps.forEach(p=>{if(set.has(p.id)){const m=String(p.motivo_decision||'').trim();if(m)razones.add(m);p.estado=target[0];p._decidido_por=user;p._decidido_en=now;cantidad++;}});this.save(ps);/* El 'por que' de la decision es el MOTIVO que escribio el operador en la
       tarjeta. Si todos los pallets comparten motivo se guarda textual; si son
       varios se deja constancia de cuantos; si nadie escribio nada, se dice. */
    const motivo=razones.size===0?'Sin motivo informado por el operador':razones.size===1?[...razones][0]:`${razones.size} motivos distintos informados por el operador`;
    this.record(decision,ids,{nuevo_estado:target[0],motivo});return{ok:true,cantidad,nuevo_estado:target[0],etiqueta:target[1]};},
  /* Recibe el subconjunto sobre el que trabaja Gestion de Aprobaciones. Sin
     argumento sigue tomando la cola completa, como antes. */
  prepareManagementLot(items=this.pending()){if(!items.length)return{ok:false,error:'No hay pallets pendientes de aprobación en este momento.'};const h=this.history(),n=h.filter(x=>x.accion==='envio_gerencia').length+1,id=`LOTE-APR-${String(n).padStart(4,'0')}`;this.record('envio_gerencia',items.map(x=>x.id),{correo_enviado:false,correo_motivo:'Servicio de correo no disponible en el cliente web.'},id);return{ok:true,lote_id:id,cantidad:items.length,cajas:items.reduce((s,p)=>s+(Number(p.cajas)||0),0),items,correo_enviado:false,correo_motivo:'Servicio de correo no disponible en el cliente web.'};},
  xml(v){return String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');},
  crc32(bytes){let crc=0xffffffff;for(const b of bytes){crc^=b;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return(crc^0xffffffff)>>>0;},
  zipStore(files){
    const enc=new TextEncoder(),u16=n=>new Uint8Array([n&255,(n>>>8)&255]),u32=n=>new Uint8Array([n&255,(n>>>8)&255,(n>>>16)&255,(n>>>24)&255]),join=parts=>{const out=new Uint8Array(parts.reduce((s,p)=>s+p.length,0));let o=0;parts.forEach(p=>{out.set(p,o);o+=p.length;});return out;};
    const locals=[],central=[];let offset=0;
    Object.entries(files).forEach(([path,text])=>{const name=enc.encode(path),data=enc.encode(text),crc=this.crc32(data),local=join([u32(0x04034b50),u16(20),u16(0),u16(0),u16(0),u16(0),u32(crc),u32(data.length),u32(data.length),u16(name.length),u16(0),name,data]);locals.push(local);central.push(join([u32(0x02014b50),u16(20),u16(20),u16(0),u16(0),u16(0),u16(0),u32(crc),u32(data.length),u32(data.length),u16(name.length),u16(0),u16(0),u16(0),u16(0),u32(0),u32(offset),name]));offset+=local.length;});
    const centralBytes=join(central),end=join([u32(0x06054b50),u16(0),u16(0),u16(central.length),u16(central.length),u32(centralBytes.length),u32(offset),u16(0)]);return join([...locals,centralBytes,end]);
  },
  downloadPackingList(result){
    const headers=['ID Pallet','Lote','Código Fruta','Kilos','Cajas','Temp. Ingreso','Calidad','Motivo de Bloqueo','Estado Actual','Ubicación'];
    const values=result.items.map(p=>[p.id,p.lote_display,p.articulo_display,p.kilos_display,p.cajas||0,p.temperatura||'',p.calidad_estado_display,p.calidad_display,p.estado,p.ubicacion]);
    const rows=[headers,...values].map((row,ri)=>`<row r="${ri+1}">${row.map((v,ci)=>{const col=String.fromCharCode(65+ci),numeric=typeof v==='number';return numeric?`<c r="${col}${ri+1}"><v>${v}</v></c>`:`<c r="${col}${ri+1}" t="inlineStr"><is><t>${this.xml(v)}</t></is></c>`;}).join('')}</row>`).join('');
    const sheet=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`;
    const files={
      '[Content_Types].xml':'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
      '_rels/.rels':'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
      'xl/workbook.xml':'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Packing List" sheetId="1" r:id="rId1"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels':'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
      'xl/worksheets/sheet1.xml':sheet
    };
    const bytes=this.zipStore(files),url=URL.createObjectURL(new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})),a=document.createElement('a');a.href=url;a.download=`Packing_List_Bloqueados_${result.lote_id}.xlsx`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
};
