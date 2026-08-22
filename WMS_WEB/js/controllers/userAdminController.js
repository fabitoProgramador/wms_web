/** Administración de usuarios: frontend puro sobre backend Supabase autoritativo. */
const UserAdminController = {
  container:null,
  tab:'list',
  editingId:null,
  filtros:{buscar:'',estado:'TODOS',rol:'TODOS'},
  data:null,
  loading:false,
  requestId:0,
  searchTimer:null,

  esc(v){return SeguridadService.escaparHtml(v);},
  fmtDate(v){if(!v)return '—';try{return new Date(v).toLocaleString('es-CL');}catch(_){return String(v);}},
  notify(message,type='success'){return NotificationService.show(message,{type});},
  puedeGestionar(){return Boolean(this.data?.permisos?.puede_gestionar);},

  init(container){
    this.container=container;this.tab='list';this.editingId=null;this.filtros={buscar:'',estado:'TODOS',rol:'TODOS'};this.data=null;this.requestId+=1;this.cargar();
  },

  async cargar(){
    const req=++this.requestId;this.loading=true;this.render();
    try{
      const data=await UserAdminModel.listar(this.filtros);
      if(req!==this.requestId)return;
      this.data=data||{};this.loading=false;
      if(this.editingId&&!this.usuario(this.editingId))this.editingId=null;
      this.render();
    }catch(error){
      if(req!==this.requestId)return;
      this.loading=false;
      this.container.innerHTML=`<article class="user-admin-denied"><span>⚠</span><div><h2>No fue posible cargar Administración de Usuarios</h2><p>${this.esc(error?.message||'Error de backend.')}</p></div></article>`;
    }
  },

  usuarios(){return Array.isArray(this.data?.usuarios)?this.data.usuarios:[];},
  roles(){return Array.isArray(this.data?.roles)?this.data.roles:[];},
  areas(){return Array.isArray(this.data?.areas)?this.data.areas:[];},
  usuario(id){return this.usuarios().find(x=>String(x.usuario_id)===String(id))||null;},

  render(){
    if(!this.container)return;
    if(this.loading&&!this.data){this.container.innerHTML='<div class="panel-empty">Consultando usuarios, roles y permisos en Supabase…</div>';return;}
    if(!this.data){return;}
    const manage=this.puedeGestionar();
    if(!manage&&this.data?.permisos?.puede_ver!==true){this.container.innerHTML='<article class="user-admin-denied"><span>🔒</span><div><h2>Administración restringida</h2><p>Tu rol no posee permiso usuarios.ver.</p></div></article>';return;}
    if(!manage&&this.tab!=='list')this.tab='list';
    this.container.innerHTML=`<section class="user-admin-module">
      <header class="user-admin-head"><div><span class="eyebrow">GESTIÓN DE ACCESOS</span><h2>Administración de usuarios</h2><p>Identidad Auth, perfil WMS, rol, estado y auditoría administrados por Supabase.</p></div><span class="user-admin-access">🛡 ${this.esc(this.data?.actor?.rol_codigo||UserModel.accessLabel(UserModel.getCurrentUser()))}</span></header>
      <nav class="user-admin-tabs" aria-label="Secciones de administración">
        ${this.tabButton('list','<i class="wi wi-sheet"></i>','Visualizar usuarios')}
        ${manage?this.tabButton('add','<i class="wi wi-plus"></i>','Agregar usuario'):''}
        ${manage?this.tabButton('edit','<i class="wi wi-edit"></i>','Modificar usuario'):''}
      </nav>
      <div class="user-admin-content">${this.renderContent()}</div>
    </section>`;
  },

  tabButton(id,icon,label){return `<button type="button" class="${this.tab===id?'active':''}" onclick="UserAdminController.setTab('${id}')"><span>${icon}</span>${label}</button>`;},
  setTab(tab){if(!['list','add','edit'].includes(tab))tab='list';if(tab!=='list'&&!this.puedeGestionar())tab='list';this.tab=tab;if(tab!=='edit')this.editingId=null;this.render();},
  renderContent(){if(this.tab==='add')return this.renderForm('add');if(this.tab==='edit')return this.renderEdit();return this.renderList();},

  renderList(){
    const r=this.data?.resumen||{},users=this.usuarios(),roles=['TODOS',...this.roles().map(x=>x.codigo)];
    return `<div class="user-admin-stats">
      ${this.statCard('◉','Total usuarios',r.total||0,'blue')}${this.statCard('✓','Usuarios activos',r.activos||0,'green')}${this.statCard('—','Usuarios inactivos',r.inactivos||0,'red')}${this.statCard('◇','Áreas registradas',r.areas||0,'violet')}
    </div>
    <div class="user-admin-toolbar">
      <label><span aria-hidden="true">⌕</span><input id="userAdminSearch" type="search" value="${this.esc(this.filtros.buscar)}" oninput="UserAdminController.setFiltro('buscar',this.value)" placeholder="Nombre, correo, RUT, cargo o área"></label>
      <select class="form-control" onchange="UserAdminController.setFiltro('estado',this.value)">${['TODOS','ACTIVO','INACTIVO'].map(x=>`<option ${this.filtros.estado===x?'selected':''}>${x}</option>`).join('')}</select>
      <select class="form-control" onchange="UserAdminController.setFiltro('rol',this.value)">${roles.map(x=>`<option value="${this.esc(x)}" ${this.filtros.rol===x?'selected':''}>${x==='TODOS'?'Todos los roles':this.esc(this.roles().find(r=>r.codigo===x)?.nombre||x)}</option>`).join('')}</select>
      <span>${this.fmtCount(this.data?.paginacion?.total_filtrado)} resultado(s)</span>
    </div>
    ${users.length?`${this.renderTable(users)}${this.renderMobileCards(users)}`:'<div class="user-admin-empty"><span>⌕</span><h3>Sin resultados</h3><p>No hay usuarios que coincidan con los filtros.</p></div>'}`;
  },
  fmtCount(v){return Number(v||0).toLocaleString('es-CL');},
  statCard(icon,label,value,tone){return `<article class="user-stat ${tone}"><span>${icon}</span><div><small>${label}</small><strong>${this.fmtCount(value)}</strong></div></article>`;},

  renderTable(users){return `<div class="user-admin-table-shell"><table class="user-admin-table"><thead><tr><th>Usuario</th><th>Cargo</th><th>Área</th><th>Rol WMS</th><th>Estado</th><th>Actualizado</th><th>Acciones</th></tr></thead><tbody>${users.map(u=>`<tr><td><div class="user-cell"><span>${AppController.initials(u.nombre_completo||u.nombre)}</span><div><strong>${this.esc(u.nombre_completo||u.nombre)}</strong><small>${this.esc(u.email||'—')} · ${this.esc(u.rut||'Sin RUT')}</small></div></div></td><td>${this.esc(u.cargo||'Sin cargo')}</td><td>${this.esc(u.area||'—')}</td><td><span class="access-badge user">${this.esc(u.rol_nombre||u.rol_codigo||'—')}</span></td><td>${this.statusBadge(u)}</td><td>${this.esc(this.fmtDate(u.actualizado_en))}</td><td>${this.actions(u)}</td></tr>`).join('')}</tbody></table></div>`;},

  renderMobileCards(users){return `<div class="user-admin-mobile-list">${users.map(u=>`<article class="user-mobile-card"><header><div class="user-cell"><span>${AppController.initials(u.nombre_completo||u.nombre)}</span><div><strong>${this.esc(u.nombre_completo||u.nombre)}</strong><small>${this.esc(u.email||'—')}</small></div></div>${this.statusBadge(u)}</header><dl><div><dt>RUT</dt><dd>${this.esc(u.rut||'—')}</dd></div><div><dt>Cargo</dt><dd>${this.esc(u.cargo||'—')}</dd></div><div><dt>Área</dt><dd>${this.esc(u.area||'—')}</dd></div><div><dt>Rol WMS</dt><dd>${this.esc(u.rol_nombre||u.rol_codigo||'—')}</dd></div></dl><footer>${this.actions(u)}</footer></article>`).join('')}</div>`;},

  statusBadge(u){return `<span class="status-badge ${u.activo?'active':'inactive'}"><i></i>${u.activo?'Activo':'Inactivo'}</span>`;},
  actions(u){
    const edit=u.puede_editar?`<button type="button" onclick="UserAdminController.editUser('${this.esc(u.usuario_id)}')" title="Modificar usuario">✎</button>`:'';
    const toggle=u.puede_cambiar_estado?`<button type="button" class="${u.activo?'deactivate':'activate'}" onclick="UserAdminController.toggleUser('${this.esc(u.usuario_id)}',${u.activo?'false':'true'})" title="${u.activo?'Desactivar':'Activar'}">${u.activo?'○':'✓'}</button>`:'';
    const history=`<button type="button" onclick="UserAdminController.showHistory('${this.esc(u.usuario_id)}')" title="Historial">↺</button>`;
    return `<div class="user-row-actions">${edit}${toggle}${history}</div>`;
  },

  setFiltro(key,value){this.filtros[key]=value;if(key==='buscar'){clearTimeout(this.searchTimer);this.searchTimer=setTimeout(()=>this.cargar(),280);}else this.cargar();},

  renderEdit(){
    const editable=this.usuarios().filter(x=>x.puede_editar);
    if(!this.editingId&&editable.length)this.editingId=editable[0].usuario_id;
    const user=this.usuario(this.editingId);
    return `<div class="user-edit-picker"><label>Usuario a modificar</label><select onchange="UserAdminController.selectEdit(this.value)">${editable.map(u=>`<option value="${this.esc(u.usuario_id)}" ${String(u.usuario_id)===String(this.editingId)?'selected':''}>${this.esc(u.nombre_completo||u.nombre)} · ${this.esc(u.email)}</option>`).join('')}</select></div>${user&&user.puede_editar?this.renderForm('edit',user):'<div class="user-admin-empty"><p>No hay usuarios que tu rol pueda modificar.</p></div>'}`;
  },

  renderForm(mode,user={}){
    const editing=mode==='edit',data=editing?user:{activo:true,area:'',rol_codigo:'USUARIO'};
    const availableRoles=this.roles().filter(r=>r.asignable||r.codigo===data.rol_codigo);
    return `<form class="user-admin-form" onsubmit="UserAdminController.save(event,'${mode}')" novalidate>
      <header><div><span class="form-icon">${editing?'✎':'+'}</span><div><small>${editing?'EDICIÓN BACKEND':'NUEVA IDENTIDAD AUTH + WMS'}</small><h3>${editing?'Modificar usuario':'Agregar usuario'}</h3></div></div>${editing?`<span class="user-form-id">${this.esc(user.usuario_id)}</span>`:'<span class="user-form-id">ID Auth automático</span>'}</header>
      <div class="user-admin-form-grid">
        <label><span>Correo de identidad <b>*</b></span><input name="email" type="email" value="${this.esc(data.email||'')}" ${editing?'readonly':''} required autocomplete="email"><small class="field-help">${editing?'El correo Auth no se cambia desde esta ficha.':'Supabase enviará una invitación a este correo.'}</small></label>
        ${this.field('Nombre','nombre',data.nombre,true,'given-name')}
        ${this.field('Apellido paterno','apellido_paterno',data.apellido_paterno,true,'family-name')}
        ${this.field('Apellido materno','apellido_materno',data.apellido_materno,false,'additional-name')}
        ${this.field('Cargo','cargo',data.cargo,false,'organization-title','Ej.: Supervisor de turno')}
        ${this.field('RUT','rut',data.rut,false,'off','Ej.: 20.316.609-5')}
        <label><span>Área <b>*</b></span><select name="area" required><option value="">Seleccionar área</option>${this.areas().map(a=>`<option value="${this.esc(a)}" ${a===data.area?'selected':''}>${this.esc(a)}</option>`).join('')}</select></label>
        <label><span>Rol WMS <b>*</b></span><select name="rol_codigo" required>${availableRoles.map(r=>`<option value="${this.esc(r.codigo)}" ${r.codigo===data.rol_codigo?'selected':''}>${this.esc(r.nombre)} · ${this.esc(r.codigo)}</option>`).join('')}</select><small class="field-help">Los permisos los determina RBAC en Supabase.</small></label>
        <label class="wide"><span>Motivo / observación</span><input name="motivo" placeholder="Opcional; queda en auditoría"></label>
      </div>
      ${!editing?`<label class="user-active-switch"><input type="checkbox" name="activo" checked><span aria-hidden="true"></span><div><strong>Crear usuario activo</strong><small>Si queda inactivo, Auth también será bloqueado.</small></div></label>`:''}
      ${editing?`<div class="user-form-meta"><span>Creado: <b>${this.esc(this.fmtDate(data.creado_en))}</b></span><span>Última modificación: <b>${this.esc(this.fmtDate(data.actualizado_en))}</b></span><span>Estado: <b>${data.activo?'ACTIVO':'INACTIVO'}</b></span></div>`:''}
      <p class="user-admin-error" role="alert" hidden></p>
      <div class="user-admin-form-actions"><button type="button" class="btn-secondary" onclick="UserAdminController.setTab('list')">Cancelar</button><button type="submit" class="btn-primary">${editing?'Guardar modificaciones':'Crear e invitar usuario'}</button></div>
    </form>`;
  },

  field(label,name,value='',required=false,autocomplete='off',placeholder=''){return `<label><span>${label}${required?' <b>*</b>':''}</span><input name="${name}" value="${this.esc(value||'')}" autocomplete="${autocomplete}" ${required?'required':''} placeholder="${this.esc(placeholder)}"></label>`;},
  selectEdit(id){this.editingId=id;this.render();},
  editUser(id){this.editingId=id;this.tab='edit';this.render();},

  async save(event,mode){
    event.preventDefault();const form=event.currentTarget,error=form.querySelector('.user-admin-error');error.hidden=true;
    if(!form.reportValidity())return;
    const f=new FormData(form),data={email:f.get('email'),nombre:f.get('nombre'),apellido_paterno:f.get('apellido_paterno'),apellido_materno:f.get('apellido_materno'),cargo:f.get('cargo'),area:f.get('area'),rut:f.get('rut'),rol_codigo:f.get('rol_codigo'),activo:f.has('activo'),motivo:f.get('motivo')};
    const submit=form.querySelector('button[type=submit]');submit.disabled=true;
    try{
      const result=mode==='edit'?await UserAdminModel.actualizar(this.editingId,data):await UserAdminModel.crear(data);
      this.tab='list';this.editingId=null;this.filtros={buscar:'',estado:'TODOS',rol:'TODOS'};await this.cargar();
      this.notify(mode==='edit'?'Usuario actualizado y auditado en Supabase.':`Usuario creado en Auth/WMS${result?.invitation_sent?' · invitación enviada':''}.`);
      const current=UserModel.getCurrentUser();if(result?.user?.usuario_id===current?.id){const s=await SupabaseService.sesionActual();if(s.ok){const ui=SupabaseService.usuarioInterfaz(s.datos);UserModel.setCurrentUser(ui);AppController.updateUserChrome(ui);}}
    }catch(e){error.textContent=e.message||'No fue posible guardar el usuario.';error.hidden=false;submit.disabled=false;}
  },

  async toggleUser(id,activo){
    const u=this.usuario(id);if(!u)return;
    if(!confirm(`${activo?'Activar':'Desactivar'} a ${u.nombre_completo||u.nombre}?`))return;
    try{await UserAdminModel.setActivo(id,activo);await this.cargar();this.notify(`Usuario ${activo?'activado':'desactivado'} en Auth y WMS.`);}catch(e){this.notify(e.message||'No fue posible cambiar el estado.','error');}
  },

  async showHistory(id){
    const u=this.usuario(id);if(!u)return;
    try{
      const data=await UserAdminModel.historial(id,60),rows=data?.historial||[];
      document.getElementById('userAuditModal')?.remove();
      document.body.insertAdjacentHTML('beforeend',`<div id="userAuditModal" class="ops-modal-backdrop" onclick="if(event.target===this)this.remove()"><section class="ops-modal" role="dialog" aria-modal="true"><header><div><small>AUDITORÍA DE USUARIO</small><h3>${this.esc(u.nombre_completo||u.nombre)}</h3></div><button onclick="document.getElementById('userAuditModal').remove()">×</button></header><div class="user-admin-mobile-list">${rows.length?rows.map(x=>`<article class="user-mobile-card"><header><strong>${this.esc(x.evento||'EVENTO')}</strong><small>${this.esc(this.fmtDate(x.creado_en))}</small></header><dl><div><dt>Ejecutado por</dt><dd>${this.esc(x.ejecutado_por_nombre||'Sistema')}</dd></div><div><dt>Motivo</dt><dd>${this.esc(x.motivo||'—')}</dd></div></dl></article>`).join(''):'<div class="panel-empty">Sin eventos de auditoría.</div>'}</div><footer><button class="btn-secondary" onclick="document.getElementById('userAuditModal').remove()">Cerrar</button></footer></section></div>`);
    }catch(e){this.notify(e.message||'No fue posible consultar el historial.','error');}
  }
};
