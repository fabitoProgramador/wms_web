/** Administración de Usuarios: lectura RPC + mutaciones seguras por Edge Function. */
const UserAdminModel = {
  uuid() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r=Math.random()*16|0, v=c==='x'?r:(r&3|8); return v.toString(16);
    });
  },

  async rpc(nombre,parametros={}) {
    const response=await SupabaseService.rpc('usuarios',nombre,parametros);
    if(!response.ok){
      const error=new Error(response.error||`No fue posible ejecutar usuarios.${nombre}.`);
      error.estado=response.estado; error.permiso=response.permiso; error.red=response.red;
      throw error;
    }
    return response.datos;
  },

  listar({buscar='',estado='TODOS',rol=null,limite=200,offset=0}={}) {
    return this.rpc('administrar',{
      p_busqueda:String(buscar||'').trim()||null,
      p_estado:estado||'TODOS',
      p_rol_codigo:rol&&rol!=='TODOS'?rol:null,
      p_limite:limite,
      p_offset:offset
    });
  },

  historial(usuarioId,limite=50) {
    return this.rpc('historial',{p_usuario_id:usuarioId,p_limite:limite});
  },

  async edge(action,payload={}) {
    const renovada=await SupabaseService.renovarSiHaceFalta();
    if(!renovada.ok) throw new Error(renovada.error||'La sesión ya no es válida.');
    const response=await SupabaseService.pedir('/functions/v1/wms-user-admin',{
      method:'POST',
      body:JSON.stringify({action,operacion_uuid:this.uuid(),...payload})
    });
    if(!response.ok||response.datos?.ok===false){
      const error=new Error(response.error||response.datos?.error||'No fue posible actualizar el usuario.');
      error.estado=response.estado; error.permiso=response.permiso; error.red=response.red;
      throw error;
    }
    return response.datos;
  },

  crear(data={}) {
    return this.edge('create',{
      email:String(data.email||'').trim().toLowerCase(),
      nombre:String(data.nombre||'').trim(),
      apellido_paterno:String(data.apellido_paterno||'').trim(),
      apellido_materno:String(data.apellido_materno||'').trim()||null,
      cargo:String(data.cargo||'').trim()||null,
      area:String(data.area||'').trim(),
      rut:String(data.rut||'').trim()||null,
      rol_codigo:String(data.rol_codigo||'').trim().toUpperCase(),
      activo:data.activo!==false,
      motivo:String(data.motivo||'').trim()||'Alta de usuario desde Administración WMS'
    });
  },

  actualizar(usuarioId,data={}) {
    return this.edge('update',{
      usuario_id:usuarioId,
      nombre:String(data.nombre||'').trim(),
      apellido_paterno:String(data.apellido_paterno||'').trim(),
      apellido_materno:String(data.apellido_materno||'').trim()||null,
      cargo:String(data.cargo||'').trim()||null,
      area:String(data.area||'').trim(),
      rut:String(data.rut||'').trim()||null,
      rol_codigo:String(data.rol_codigo||'').trim().toUpperCase(),
      motivo:String(data.motivo||'').trim()||'Actualización desde Administración WMS'
    });
  },

  setActivo(usuarioId,activo,motivo='') {
    return this.edge('set_active',{
      usuario_id:usuarioId,
      activo:Boolean(activo),
      motivo:String(motivo||'').trim()||`${activo?'Activación':'Desactivación'} desde Administración WMS`
    });
  }
};
