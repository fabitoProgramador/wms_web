/** Administración de usuarios replicada desde Programa MVC. */
const UserAdminController = {
  container: null,
  tab: 'list',
  editingId: null,
  search: '',

  esc(value) {
    const node = document.createElement('div');
    node.textContent = String(value ?? '');
    return node.innerHTML;
  },

  init(container) {
    this.container = container;
    this.tab = 'list';
    this.editingId = null;
    this.search = '';
    this.render();
  },

  render() {
    if (!this.container) return;
    if (!UserModel.canManageUsers()) {
      this.container.innerHTML = '<article class="user-admin-denied"><span>🔒</span><div><h2>Administración restringida</h2><p>Esta función está disponible para Administradores y Jefes de Planta.</p></div></article>';
      return;
    }
    this.container.innerHTML = `<section class="user-admin-module">
      <header class="user-admin-head">
        <div><span class="eyebrow">GESTIÓN DE ACCESOS</span><h2>Administración de usuarios</h2><p>Consulta, registra y actualiza los usuarios autorizados del sistema.</p></div>
        <span class="user-admin-access">🛡 ${this.esc(UserModel.accessLabel(UserModel.getCurrentUser()))}</span>
      </header>
      <nav class="user-admin-tabs" aria-label="Secciones de administración">
        ${this.tabButton('list', '<i class="wi wi-sheet"></i>', 'Visualizar usuarios')}
        ${this.tabButton('add', '<i class="wi wi-plus"></i>', 'Agregar usuario')}
        ${this.tabButton('edit', '<i class="wi wi-edit"></i>', 'Modificar usuario')}
      </nav>
      <div class="user-admin-content">${this.renderContent()}</div>
    </section>`;
    if (this.tab === 'list') this.restoreSearchFocus();
  },

  tabButton(id, icon, label) {
    return `<button type="button" class="${this.tab === id ? 'active' : ''}" onclick="UserAdminController.setTab('${id}')" aria-current="${this.tab === id ? 'page' : 'false'}"><span>${icon}</span>${label}</button>`;
  },

  setTab(tab) {
    this.tab = ['list', 'add', 'edit'].includes(tab) ? tab : 'list';
    if (this.tab !== 'edit') this.editingId = null;
    this.render();
  },

  renderContent() {
    if (this.tab === 'add') return this.renderForm('add');
    if (this.tab === 'edit') return this.renderEdit();
    return this.renderList();
  },

  filteredUsers() {
    const term = this.search.trim().toLocaleLowerCase('es');
    return UserModel.getAllUsers().filter(user => !term || [UserModel.fullName(user), user.cargo, user.area]
      .some(value => String(value || '').toLocaleLowerCase('es').includes(term)));
  },

  renderList() {
    const all = UserModel.getAllUsers();
    const users = this.filteredUsers();
    const active = all.filter(user => user.activo).length;
    const areas = new Set(all.map(user => user.area).filter(Boolean)).size;
    return `<div class="user-admin-stats">
      ${this.statCard('◉', 'Total usuarios', all.length, 'blue')}
      ${this.statCard('✓', 'Usuarios activos', active, 'green')}
      ${this.statCard('—', 'Usuarios inactivos', all.length - active, 'red')}
      ${this.statCard('◇', 'Áreas registradas', areas, 'violet')}
    </div>
    <div class="user-admin-toolbar">
      <label><span aria-hidden="true">⌕</span><input id="userAdminSearch" type="search" value="${this.esc(this.search)}" oninput="UserAdminController.searchUsers(this.value)" placeholder="Buscar por nombre, apellido, cargo o área" aria-label="Buscar usuarios"></label>
      <span>${users.length} de ${all.length} usuarios</span>
    </div>
    ${users.length ? `${this.renderTable(users)}${this.renderMobileCards(users)}` : '<div class="user-admin-empty"><span>⌕</span><h3>Sin resultados</h3><p>No hay usuarios que coincidan con la búsqueda.</p></div>'}`;
  },

  statCard(icon, label, value, tone) {
    return `<article class="user-stat ${tone}"><span>${icon}</span><div><small>${label}</small><strong>${value}</strong></div></article>`;
  },

  renderTable(users) {
    return `<div class="user-admin-table-shell"><table class="user-admin-table"><thead><tr><th>Usuario</th><th>Cargo</th><th>Área</th><th>Acceso</th><th>Estado</th><th>Creado</th><th>Modificado</th><th>Acciones</th></tr></thead><tbody>${users.map(user => `<tr>
      <td><div class="user-cell"><span>${AppController.initials(UserModel.fullName(user))}</span><div><strong>${this.esc(UserModel.fullName(user))}</strong><small>${this.esc(user.id)}</small></div></div></td>
      <td>${this.esc(user.cargo || 'Sin cargo')}</td><td>${this.esc(user.area)}</td>
      <td><span class="access-badge ${String(user.accessLevel).toLowerCase()}">${this.esc(UserModel.accessLabel(user))}</span></td>
      <td>${this.statusBadge(user)}</td><td>${this.esc(user.creado || 'Sin registro')}</td><td>${this.esc(user.modificado || 'Sin cambios')}</td>
      <td>${this.actions(user)}</td></tr>`).join('')}</tbody></table></div>`;
  },

  renderMobileCards(users) {
    return `<div class="user-admin-mobile-list">${users.map(user => `<article class="user-mobile-card">
      <header><div class="user-cell"><span>${AppController.initials(UserModel.fullName(user))}</span><div><strong>${this.esc(UserModel.fullName(user))}</strong><small>${this.esc(user.id)}</small></div></div>${this.statusBadge(user)}</header>
      <dl><div><dt>Cargo</dt><dd>${this.esc(user.cargo || 'Sin cargo')}</dd></div><div><dt>Área</dt><dd>${this.esc(user.area)}</dd></div><div><dt>Acceso</dt><dd>${this.esc(UserModel.accessLabel(user))}</dd></div><div><dt>Modificado</dt><dd>${this.esc(user.modificado || 'Sin cambios')}</dd></div></dl>
      <footer>${this.actions(user)}</footer></article>`).join('')}</div>`;
  },

  statusBadge(user) { return `<span class="status-badge ${user.activo ? 'active' : 'inactive'}"><i></i>${user.activo ? 'Activo' : 'Inactivo'}</span>`; },
  actions(user) { return `<div class="user-row-actions"><button type="button" onclick="UserAdminController.editUser('${this.esc(user.id)}')" title="Modificar usuario" aria-label="Modificar ${this.esc(UserModel.fullName(user))}">✎</button><button type="button" class="${user.activo ? 'deactivate' : 'activate'}" onclick="UserAdminController.toggleUser('${this.esc(user.id)}')" title="${user.activo ? 'Desactivar' : 'Activar'} usuario" aria-label="${user.activo ? 'Desactivar' : 'Activar'} ${this.esc(UserModel.fullName(user))}">${user.activo ? '○' : '✓'}</button></div>`; },

  searchUsers(value) {
    this.search = value;
    const content = this.container?.querySelector('.user-admin-content');
    if (content) content.innerHTML = this.renderList();
    this.restoreSearchFocus();
  },

  restoreSearchFocus() {
    requestAnimationFrame(() => {
      const input = document.getElementById('userAdminSearch');
      if (!input) return;
      input.focus({ preventScroll: true });
      input.setSelectionRange(input.value.length, input.value.length);
    });
  },

  renderEdit() {
    const users = UserModel.getAllUsers();
    if (!this.editingId && users.length) this.editingId = users[0].id;
    const user = users.find(item => item.id === this.editingId);
    return `<div class="user-edit-picker"><label for="userEditPicker">Usuario a modificar</label><select id="userEditPicker" onchange="UserAdminController.selectEdit(this.value)">${users.map(item => `<option value="${this.esc(item.id)}" ${item.id === this.editingId ? 'selected' : ''}>${this.esc(UserModel.fullName(item))} · ${this.esc(item.id)}</option>`).join('')}</select></div>${user ? this.renderForm('edit', user) : '<div class="user-admin-empty"><p>No hay usuarios registrados.</p></div>'}`;
  },

  renderForm(mode, user = {}) {
    const editing = mode === 'edit';
    const data = editing ? user : { activo: true, accessLevel: 'USER', area: '' };
    return `<form class="user-admin-form" onsubmit="UserAdminController.save(event,'${mode}')" novalidate>
      <header><div><span class="form-icon">${editing ? '✎' : '+'}</span><div><small>${editing ? 'EDICIÓN DE REGISTRO' : 'NUEVO REGISTRO'}</small><h3>${editing ? 'Modificar usuario' : 'Agregar usuario'}</h3></div></div>${editing ? `<span class="user-form-id">${this.esc(user.id)}</span>` : '<span class="user-form-id">ID automático</span>'}</header>
      <div class="user-admin-form-grid">
        ${this.field('Nombre', 'nombre', data.nombre, true, 'given-name')}
        ${this.field('Apellido paterno', 'apellido_paterno', data.apellido_paterno, true, 'family-name')}
        ${this.field('Apellido materno', 'apellido_materno', data.apellido_materno, false, 'additional-name')}
        ${this.field('Cargo', 'cargo', data.cargo, false, 'organization-title', 'Ej.: Supervisor de turno')}
        <label><span>Área <b>*</b></span><select name="area" required><option value="">Seleccionar área</option>${UserModel.AREAS.map(area => `<option value="${this.esc(area)}" ${data.area === area ? 'selected' : ''}>${this.esc(area)}</option>`).join('')}</select></label>
        <label><span>Nivel de acceso <b>*</b></span><select name="accessLevel" required>${UserModel.ACCESS_LEVELS.map(level => `<option value="${level.value}" ${data.accessLevel === level.value ? 'selected' : ''}>${this.esc(level.label)}</option>`).join('')}</select><small class="field-help">Define permisos; no modifica el cargo visible.</small></label>
      </div>
      <label class="user-active-switch"><input type="checkbox" name="activo" ${data.activo !== false ? 'checked' : ''}><span aria-hidden="true"></span><div><strong>Usuario activo</strong><small>Permite el acceso del usuario al sistema.</small></div></label>
      ${editing ? `<div class="user-form-meta"><span>Creado: <b>${this.esc(data.creado || 'Sin registro')}</b></span><span>Última modificación: <b>${this.esc(data.modificado || 'Sin cambios')}</b></span></div>` : ''}
      <p class="user-admin-error" role="alert" hidden></p>
      <div class="user-admin-form-actions"><button type="button" class="btn-secondary" onclick="UserAdminController.setTab('list')">Cancelar</button><button type="submit" class="btn-primary">${editing ? 'Guardar modificaciones' : 'Registrar usuario'}</button></div>
    </form>`;
  },

  field(label, name, value = '', required = false, autocomplete = 'off', placeholder = '') {
    return `<label><span>${label}${required ? ' <b>*</b>' : ''}</span><input name="${name}" value="${this.esc(value)}" autocomplete="${autocomplete}" ${required ? 'required' : ''} placeholder="${this.esc(placeholder)}"></label>`;
  },

  selectEdit(userId) { this.editingId = userId; this.render(); },
  editUser(userId) { this.editingId = userId; this.tab = 'edit'; this.render(); },

  save(event, mode) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const data = {
      nombre: values.get('nombre'), apellido_paterno: values.get('apellido_paterno'), apellido_materno: values.get('apellido_materno'),
      cargo: values.get('cargo'), area: values.get('area'), accessLevel: values.get('accessLevel'), activo: values.has('activo')
    };
    const result = mode === 'edit' ? UserModel.updateUser(this.editingId, data) : UserModel.createUser(data);
    const error = form.querySelector('.user-admin-error');
    if (!result.ok) { error.textContent = result.error; error.hidden = false; return; }
    const current = UserModel.getCurrentUser();
    AppController.updateUserChrome(current);
    if (!UserModel.canManageUsers(current)) {
      AppController.renderAdministration(document.getElementById('mainViewport'));
      return;
    }
    this.tab = 'list'; this.editingId = null; this.search = ''; this.render();
    this.notify(mode === 'edit' ? 'Usuario actualizado correctamente.' : 'Usuario registrado correctamente.');
  },

  toggleUser(userId) {
    const result = UserModel.toggleUserActive(userId);
    if (!result.ok) { this.notify(result.error, 'error'); return; }
    this.render();
    this.notify(`Usuario ${result.user.activo ? 'activado' : 'desactivado'} correctamente.`);
  },

  notify(message, type = 'success') { return NotificationService.show(message, { type }); }
};
