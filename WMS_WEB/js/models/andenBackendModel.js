/**
 * Andén de Carga remoto.
 * Supabase es autoridad de carga, logística, despacho, historial y correcciones.
 * El frontend conserva únicamente borradores de formulario en memoria y genera
 * PDF/Excel a partir de datos/snapshots entregados por este contrato.
 */
const AndenBackendModel = {
  uuid(){
    if(globalThis.crypto?.randomUUID)return globalThis.crypto.randomUUID();
    return'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.random()*16|0;return(c==='x'?r:(r&3|8)).toString(16);});
  },

  flujo(tab){return String(tab||'').toLowerCase()==='postunel'?'POST_TUNEL':'PROTER';},
  tab(flujo){return String(flujo||'').toUpperCase()==='POST_TUNEL'?'postunel':'embarque';},
  numero(value,fallback=null){if(value===null||value===undefined||value==='')return fallback;const n=Number(String(value).replace(',','.'));return Number.isFinite(n)?n:fallback;},
  entero(value){const n=Number(value);return Number.isFinite(n)&&n>0?Math.trunc(n):null;},

  async rpc(nombre,parametros={}){
    const response=await SupabaseService.rpc('anden',nombre,parametros);
    if(!response.ok){
      const error=new Error(response.error||`No fue posible ejecutar anden.${nombre}.`);
      error.estado=response.estado;error.permiso=response.permiso;error.red=response.red;throw error;
    }
    return response.datos;
  },

  actual(tab){return this.rpc('cargaActual',{p_flujo:this.flujo(tab)});},
  catalogos(){return this.rpc('catalogos');},
  agregarPallet(tab,codigo){return this.rpc('agregarPallet',{p_flujo:this.flujo(tab),p_codigo:String(codigo||'').trim(),p_operacion_uuid:this.uuid()});},
  quitarPallet(despachoId,idLote,motivo='Retirado de carga en curso'){
    return this.rpc('quitarPallet',{p_despacho_id:this.entero(despachoId),p_id_lote:String(idLote||''),p_motivo:String(motivo||'').trim()||null,p_operacion_uuid:this.uuid()});
  },

  actualizar(despachoId,draft={},actualizadoEsperado=null,{correccion=false}={}){
    const fecha=correccion&&draft.fechaHora?new Date(draft.fechaHora).toISOString():null;
    return this.rpc('actualizar',{
      p_despacho_id:this.entero(despachoId),
      p_destino_id:this.entero(draft.destinoId),
      p_transportista_id:this.entero(draft.transportistaId),
      p_conductor_id:this.entero(draft.conductorId),
      p_camion_id:this.entero(draft.camionId),
      p_rampla_id:this.entero(draft.ramplaId),
      p_fecha_hora_despacho:fecha,
      p_temperatura:this.numero(draft.temperatura,null),
      p_observaciones:String(draft.observaciones||'').trim()||null,
      p_actualizado_esperado:actualizadoEsperado||null,
      p_operacion_uuid:this.uuid()
    });
  },

  despachar(despachoId){return this.rpc('despachar',{p_despacho_id:this.entero(despachoId),p_operacion_uuid:this.uuid()});},

  historial(tab,{busqueda='',fecha='',limite=50,offset=0}={}){
    return this.rpc('historial',{
      p_flujo:this.flujo(tab),
      p_busqueda:String(busqueda||'').trim()||null,
      p_fecha_desde:fecha||null,
      p_fecha_hasta:fecha||null,
      p_limite:Math.min(Math.max(Number(limite)||50,1),200),
      p_offset:Math.max(Number(offset)||0,0)
    });
  },
  detalle(despachoId){return this.rpc('detalle',{p_despacho_id:this.entero(despachoId)});},

  guardarDestino(data={}){return this.rpc('guardarDestino',{p_nombre:String(data.nombre||'').trim(),p_empresa:String(data.empresa||'').trim()||null,p_sucursal:String(data.sucursal||'').trim()||null,p_domicilio:String(data.domicilio||'').trim()||null,p_ciudad:String(data.ciudad||'').trim()||null});},
  guardarTransportista(data={}){return this.rpc('guardarTransportista',{p_rut:String(data.rut||'').trim()||null,p_razon_social:String(data.razonSocial||'').trim()});},
  guardarConductor(data={}){return this.rpc('guardarConductor',{p_rut:String(data.rut||'').trim(),p_nombre:String(data.nombre||'').trim(),p_transportista_id:this.entero(data.transportistaId)});},
  guardarVehiculo(tipo,data={}){return this.rpc('guardarVehiculo',{p_patente:String(data.patente||'').trim(),p_tipo:String(tipo||'').toUpperCase(),p_transportista_id:this.entero(data.transportistaId)});},

  reabrir(despachoId,motivo){return this.rpc('reabrir',{p_despacho_id:this.entero(despachoId),p_motivo:String(motivo||'').trim()});},
  devolverPallet(despachoId,idLote,motivo){return this.rpc('devolverPallet',{p_despacho_id:this.entero(despachoId),p_id_lote:String(idLote||''),p_motivo:String(motivo||'').trim()});},
  agregarCorreccion(despachoId,codigo){return this.rpc('agregarCorreccion',{p_despacho_id:this.entero(despachoId),p_codigo:String(codigo||'').trim(),p_operacion_uuid:this.uuid()});},
  confirmarCarga(despachoId,idLote){return this.rpc('confirmarCarga',{p_despacho_id:this.entero(despachoId),p_id_lote:String(idLote||'')});},
  recerrar(despachoId,observacion=null){return this.rpc('recerrar',{p_despacho_id:this.entero(despachoId),p_observacion_cierre:String(observacion||'').trim()||null});}
};
