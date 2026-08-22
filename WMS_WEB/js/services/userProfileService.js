/** Perfil personal, vista de Mis Datos y cierre de sesión: backend real, sin persistencia local de negocio. */
const UserProfileService = {
  instalado:false,
  areas:['Administración','Operaciones','Frigorífico','Calidad','Logística','Bodega','Sistemas','Recursos Humanos'],

  esc(v){return SeguridadService.escaparHtml(v);},
  uuid(){if(globalThis.crypto?.randomUUID)return globalThis.crypto.randomUUID();return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.random()*16|0,v=c==='x'?r:(r&3|8);return v.toString(16);});},
  shortName(user={}){
    const nombre=String(user.nombre||'').trim(),apellido=String(user.apellido_paterno||'').trim();
    if(nombre||apellido)return [nombre,apellido].filter(Boolean).join(' ');
    return String(user.name||'Usuario').trim().split(/\s+/).slice(0,2).join(' ');
  },

  editableFields(user,formId){
    const areas=[...new Set([...(this.areas||[]),user.area].filter(Boolean))];
    return `<form id="${formId}" class="user-profile-form" onsubmit="AppController.saveProfile(event,true)" novalidate>
      <div class="user-profile-grid">
        <label><span>Nombre</span><input name="nombre" value="${this.esc(user.nombre||'')}" autocomplete="given-name" required></label>
        <label><span>Apellido paterno</span><input name="apellido_paterno" value="${this.esc(user.apellido_paterno||'')}" autocomplete="family-name" required></label>
        <label><span>Apellido materno</span><input name="apellido_materno" value="${this.esc(user.apellido_materno||'')}" autocomplete="additional-name"></label>
        <label><span>Área</span><select name="area" required>${areas.map(a=>`<option value="${this.esc(a)}" ${String(a).localeCompare(String(user.area||''),'es',{sensitivity:'base'})===0?'selected':''}>${this.esc(a)}</option>`).join('')}</select></label>
        <label><span>Cargo</span><input name="cargo" value="${this.esc(user.cargo||'')}" autocomplete="organization-title"></label>
        <label><span>Correo</span><input name="email" type="email" value="${this.esc(user.email||'')}" autocomplete="email" required><small>Se sincroniza con la identidad de acceso.</small></label>
        <label><span>RUT</span><input name="rut" value="${this.esc(user.rut||'')}" autocomplete="off"></label>
        <label><span>Nueva contraseña</span><input name="password" type="password" autocomplete="new-password" minlength="8" placeholder="Dejar en blanco para conservar"><small>Mínimo 8 caracteres.</small></label>
      </div>
      <p class="user-profile-error" role="alert" hidden></p>
      <div class="user-profile-actions"><button type="button" class="btn-secondary" onclick="AppController.closeProfileEditor()">Cancelar</button><button type="submit" class="btn-primary">Guardar cambios</button></div>
    </form>`;
  },

  readonlyFields(user){
    const field=(label,value)=>`<label><span>${label}</span><input value="${this.esc(value||'—')}" readonly tabindex="-1" aria-readonly="true"></label>`;
    return `<div class="user-profile-form user-profile-readonly"><div class="user-profile-grid">
      ${field('Nombre',user.nombre)}
      ${field('Apellido paterno',user.apellido_paterno)}
      ${field('Apellido materno',user.apellido_materno)}
      ${field('Área',user.area)}
      ${field('Cargo',user.cargo)}
      ${field('Correo',user.email)}
      ${field('RUT',user.rut)}
    </div></div>`;
  },

  async edgeSelfUpdate(data={}){
    const renovada=await SupabaseService.renovarSiHaceFalta();
    if(!renovada.ok)return{ok:false,error:renovada.error||'La sesión ya no es válida.'};
    const response=await SupabaseService.pedir('/functions/v1/wms-user-admin',{
      method:'POST',
      body:JSON.stringify({
        action:'self_update',
        operacion_uuid:this.uuid(),
        email:String(data.email||'').trim().toLowerCase(),
        nombre:String(data.nombre||'').trim(),
        apellido_paterno:String(data.apellido_paterno||'').trim(),
        apellido_materno:String(data.apellido_materno||'').trim()||null,
        cargo:String(data.cargo||'').trim()||null,
        area:String(data.area||'').trim(),
        rut:String(data.rut||'').trim()||null
      })
    });
    if(!response.ok||response.datos?.ok===false)return{ok:false,error:response.error||response.datos?.error||'No fue posible actualizar el perfil.',red:response.red};
    return{ok:true,data:response.datos};
  },

  async updateProfile(data={}){
    const nombre=String(data.nombre||'').trim(),apellido=String(data.apellido_paterno||'').trim(),area=String(data.area||'').trim(),email=String(data.email||'').trim().toLowerCase();
    if(!nombre||!apellido||!area||!email)return{ok:false,error:'Nombre, apellido paterno, área y correo son obligatorios.'};
    if(!email.includes('@'))return{ok:false,error:'Ingrese un correo válido.'};
    const password=String(data.password||'');
    if(password&&password.length<8)return{ok:false,error:'La nueva contraseña debe tener al menos 8 caracteres.'};

    const profile=await this.edgeSelfUpdate({...data,email});
    if(!profile.ok)return profile;

    let passwordError=null;
    if(password){
      const renewed=await SupabaseService.renovarSiHaceFalta();
      if(!renewed.ok)passwordError=renewed.error||'Los datos se guardaron, pero no fue posible renovar la sesión para cambiar la contraseña.';
      else{
        const auth=await SupabaseService.pedir('/auth/v1/user',{method:'PUT',body:JSON.stringify({password})});
        if(!auth.ok)passwordError=auth.error||'Los datos se guardaron, pero no fue posible cambiar la contraseña.';
      }
    }

    const session=await SupabaseService.sesionActual();
    if(!session.ok)return{ok:false,error:session.error||'El perfil se guardó, pero no fue posible refrescar la sesión.'};
    const user=SupabaseService.usuarioInterfaz(session.datos);UserModel.setCurrentUser(user);
    return{ok:true,user,passwordError,emailChanged:Boolean(profile.data?.email_changed)};
  },

  install(){
    if(this.instalado||typeof AppController==='undefined')return;
    const service=this;
    const originalUpdateChrome=AppController.updateUserChrome.bind(AppController);

    AppController.profileFields=function(user,formId){return service.editableFields(user,formId);};

    AppController.openProfileEditor=function(){
      const user=UserModel.getCurrentUser();if(!user)return;this.closeUserOverlay();this.closeProfileEditor();
      const root=document.createElement('div');root.id='userProfileModal';root.className='user-profile-backdrop';
      root.innerHTML=`<section class="user-profile-dialog" role="dialog" aria-modal="true" aria-labelledby="userProfileTitle"><header><div><span class="user-avatar">${this.initials(service.shortName(user))}</span><div><small>CUENTA PERSONAL</small><h2 id="userProfileTitle">Editar mis datos</h2></div></div><button type="button" onclick="AppController.closeProfileEditor()" aria-label="Cerrar edición de perfil">×</button></header><p>Actualiza tus datos personales y, si lo necesitas, tu contraseña. El rol, permisos y estado se administran por separado.</p>${service.editableFields(user,'modalProfileForm')}</section>`;
      document.getElementById('appRoot')?.appendChild(root);root.querySelector('input[name=nombre]')?.focus();
    };

    AppController.saveProfile=async function(event){
      event.preventDefault();const form=event.currentTarget,error=form.querySelector('.user-profile-error'),submit=form.querySelector('button[type=submit]');error.hidden=true;submit.disabled=true;
      if(!form.reportValidity()){submit.disabled=false;return;}
      const f=new FormData(form);
      const result=await service.updateProfile({nombre:f.get('nombre'),apellido_paterno:f.get('apellido_paterno'),apellido_materno:f.get('apellido_materno'),cargo:f.get('cargo'),area:f.get('area'),email:f.get('email'),rut:f.get('rut'),password:f.get('password')});
      if(!result.ok){error.textContent=result.error;error.hidden=false;submit.disabled=false;return;}
      this.updateUserChrome(result.user);
      if(result.passwordError){error.textContent=result.passwordError;error.hidden=false;submit.disabled=false;return;}
      NotificationService.show(result.emailChanged?'Perfil y correo actualizados correctamente.':'Perfil actualizado correctamente.',{type:'success'});
      this.closeProfileEditor();
      if(this.activeView==='administracion')this.renderAdministration(document.getElementById('mainViewport'));
    };

    AppController.renderAdministration=function(viewport){
      const user=UserModel.getCurrentUser(),canManage=UserModel.canManageUsers(user),short=service.shortName(user);
      viewport.innerHTML=`<section class="user-settings-view">${DashboardController.operationalHeader({eyebrow:'CONFIGURACIÓN',title:'Administración de Usuarios',status:canManage?'Cuenta, sesión y administración autorizada':'Cuenta y datos personales'})}<div class="user-settings-layout"><article class="user-settings-card identity"><span class="user-avatar large">${this.initials(short)}</span><div><small>USUARIO ACTIVO</small><h2>${this.esc(short)}</h2><p>${this.esc(user.role)}</p>${user.rut?`<span>RUT ${this.esc(user.rut)}</span>`:''}<span class="identity-access">🛡 ${this.esc(UserModel.accessLabel(user))}</span></div></article><article class="user-settings-card"><div class="settings-card-head"><div><small>MIS DATOS</small><h2>Visualizar mis datos</h2></div><span class="session-live"><i></i> Sesión activa</span></div><p class="user-readonly-intro">Estos datos identifican tu cuenta. Para modificarlos usa <b>Editar mis datos</b> desde el avatar del encabezado.</p>${service.readonlyFields(user)}</article></div>${canManage?'<div id="userAdminMount"></div>':''}</section>`;
      if(canManage)UserAdminController.init(document.getElementById('userAdminMount'));DashboardController.startOperationalClock();
    };

    AppController.updateUserChrome=function(user){
      originalUpdateChrome(user);
      const short=service.shortName(user);
      const sidebar=document.querySelector('.sidebar-user .user-info strong');if(sidebar)sidebar.textContent=short;
      const header=document.querySelector('.header-user>div:last-child b');if(header)header.textContent=short;
      const overlay=document.querySelector('#userOverlayMenu header>div:nth-child(2) strong');if(overlay)overlay.textContent=short;
      document.querySelectorAll('.sidebar-user .user-avatar,.header-user .user-avatar,#userOverlayMenu .user-avatar').forEach(x=>x.textContent=this.initials(short));
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
