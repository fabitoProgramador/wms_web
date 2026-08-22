/** Perfil personal y cierre de sesión: backend real, sin persistencia local de negocio. */
const UserProfileService = {
  instalado:false,
  // Lista de presentación. Supabase vuelve a validar y canonizar el área al guardar.
  areas:['Administración','Operaciones','Frigorífico','Calidad','Logística','Bodega','Sistemas','Recursos Humanos'],

  esc(v){return SeguridadService.escaparHtml(v);},
  uuid(){if(globalThis.crypto?.randomUUID)return globalThis.crypto.randomUUID();return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.random()*16|0,v=c==='x'?r:(r&3|8);return v.toString(16);});},

  fields(user,formId,modal=false){
    const areas=[...new Set([...(this.areas||[]),user.area].filter(Boolean))];
    return `<form id="${formId}" class="user-profile-form" onsubmit="AppController.saveProfile(event,${modal?'true':'false'})" novalidate>
      <div class="user-profile-grid">
        <label><span>Correo de acceso</span><input value="${this.esc(user.email||'')}" readonly autocomplete="email"><small>La identidad Auth no se cambia desde el perfil.</small></label>
        <label><span>Nombre</span><input name="nombre" value="${this.esc(user.nombre||'')}" autocomplete="given-name" required></label>
        <label><span>Apellido paterno</span><input name="apellido_paterno" value="${this.esc(user.apellido_paterno||'')}" autocomplete="family-name" required></label>
        <label><span>Apellido materno</span><input name="apellido_materno" value="${this.esc(user.apellido_materno||'')}" autocomplete="additional-name"></label>
        <label><span>Cargo</span><input name="cargo" value="${this.esc(user.cargo||'')}" autocomplete="organization-title"></label>
        <label><span>Área</span><select name="area" required>${areas.map(a=>`<option value="${this.esc(a)}" ${String(a).localeCompare(String(user.area||''),'es',{sensitivity:'base'})===0?'selected':''}>${this.esc(a)}</option>`).join('')}</select><small>Supabase valida el valor al guardar.</small></label>
        <label><span>RUT</span><input name="rut" value="${this.esc(user.rut||'')}" autocomplete="off"></label>
        <label><span>Nueva contraseña</span><input name="password" type="password" autocomplete="new-password" minlength="8" placeholder="Dejar en blanco para conservar"><small>Mínimo 8 caracteres.</small></label>
      </div>
      <p class="user-profile-error" role="alert" hidden></p>
      <div class="user-profile-actions"><button type="button" class="btn-secondary" onclick="${modal?'AppController.closeProfileEditor()':'AppController.logout()'}">${modal?'Cancelar':'Cerrar sesión'}</button><button type="submit" class="btn-primary">Guardar cambios</button></div>
    </form>`;
  },

  async updateProfile(data={}){
    const nombre=String(data.nombre||'').trim(),apellido=String(data.apellido_paterno||'').trim(),area=String(data.area||'').trim();
    if(!nombre||!apellido||!area)return{ok:false,error:'Nombre, apellido paterno y área son obligatorios.'};
    const password=String(data.password||'');
    if(password&&password.length<8)return{ok:false,error:'La nueva contraseña debe tener al menos 8 caracteres.'};

    const r=await SupabaseService.rpc('usuarios','miPerfilActualizar',{
      p_nombre:nombre,
      p_apellido_paterno:apellido,
      p_apellido_materno:String(data.apellido_materno||'').trim()||null,
      p_cargo:String(data.cargo||'').trim()||null,
      p_area:area,
      p_rut:String(data.rut||'').trim()||null,
      p_operacion_uuid:this.uuid()
    });
    if(!r.ok||r.datos?.ok===false)return{ok:false,error:r.error||r.datos?.error||'No fue posible actualizar el perfil.',red:r.red};

    let passwordError=null;
    if(password){
      const renewed=await SupabaseService.renovarSiHaceFalta();
      if(!renewed.ok)passwordError=renewed.error||'No fue posible renovar la sesión para cambiar la contraseña.';
      else{
        const auth=await SupabaseService.pedir('/auth/v1/user',{method:'PUT',body:JSON.stringify({password})});
        if(!auth.ok)passwordError=auth.error||'Los datos se guardaron, pero no fue posible cambiar la contraseña.';
      }
    }

    const session=await SupabaseService.sesionActual();
    if(!session.ok)return{ok:false,error:session.error||'El perfil se guardó, pero no fue posible refrescar la sesión.'};
    const user=SupabaseService.usuarioInterfaz(session.datos);UserModel.setCurrentUser(user);
    return{ok:true,user,passwordError};
  },

  install(){
    if(this.instalado||typeof AppController==='undefined')return;
    const service=this;
    AppController.profileFields=function(user,formId,modal=false){return service.fields(user,formId,modal);};
    AppController.openProfileEditor=async function(){
      const user=UserModel.getCurrentUser();if(!user)return;this.closeUserOverlay();this.closeProfileEditor();
      const root=document.createElement('div');root.id='userProfileModal';root.className='user-profile-backdrop';
      root.innerHTML=`<section class="user-profile-dialog" role="dialog" aria-modal="true" aria-labelledby="userProfileTitle"><header><div><span class="user-avatar">${this.initials(user.name)}</span><div><small>CUENTA PERSONAL</small><h2 id="userProfileTitle">Editar mis datos</h2></div></div><button type="button" onclick="AppController.closeProfileEditor()" aria-label="Cerrar edición de perfil">×</button></header><p>Nombre, contacto operacional y contraseña. El rol RBAC y los permisos sólo se cambian desde Administración de Usuarios.</p>${service.fields(user,'modalProfileForm',true)}</section>`;
      document.getElementById('appRoot')?.appendChild(root);root.querySelector('input[name=nombre]')?.focus();
    };
    AppController.saveProfile=async function(event,modal=false){
      event.preventDefault();const form=event.currentTarget,error=form.querySelector('.user-profile-error'),submit=form.querySelector('button[type=submit]');error.hidden=true;submit.disabled=true;
      const f=new FormData(form);
      const result=await service.updateProfile({nombre:f.get('nombre'),apellido_paterno:f.get('apellido_paterno'),apellido_materno:f.get('apellido_materno'),cargo:f.get('cargo'),area:f.get('area'),rut:f.get('rut'),password:f.get('password')});
      if(!result.ok){error.textContent=result.error;error.hidden=false;submit.disabled=false;return;}
      this.updateUserChrome(result.user);
      if(result.passwordError){error.textContent=result.passwordError;error.hidden=false;submit.disabled=false;return;}
      NotificationService.show('Perfil actualizado y auditado en Supabase.',{type:'success'});
      if(modal)this.closeProfileEditor();else this.renderAdministration(document.getElementById('mainViewport'));
    };
    AppController.logout=async function(){
      this.closeUserOverlay();this.closeProfileEditor();
      await SupabaseService.salir();
      UserModel.clearSession();
      this.showAuthView();
    };
    this.instalado=true;
  }
};
