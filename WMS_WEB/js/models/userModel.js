/** Modelo de usuarios, sesión y reglas de Administración. */
const UserModel = {
  USERS_KEY: 'wms_web_users',
  USERS_SCHEMA_KEY: 'wms_web_users_schema',
  USERS_SCHEMA_VERSION: '7.1.0',
  CURRENT_USER_KEY: 'wms_web_current_user',
  ORIGINAL_ACCESS_PASSWORD: '1234',
  AREAS: ['Administración', 'Operaciones', 'Calidad', 'Logística', 'Bodega', 'Sistemas', 'Recursos Humanos'],
  ACCESS_LEVELS: [
    { value: 'USER', label: 'Usuario' },
    { value: 'PLANT_MANAGER', label: 'Jefe de Planta' },
    { value: 'ADMIN', label: 'Administrador' }
  ],

  getInitialUsers() {
    return [
      { id: 'usr-1', pass: 'admin123', name: 'Fabian Morales', role: 'Jefe de Operaciones', rut: '12.345.678-9', admin: true, accessLevel: 'ADMIN' },
      { id: 'usr-2', pass: 'operario1', name: 'Juan Pérez', role: 'Operador de Frigorífico', rut: '15.678.910-K', admin: false, accessLevel: 'USER' },
      { id: 'usr-3', pass: 'calidad1', name: 'María González', role: 'Control de Calidad', rut: '14.222.333-4', admin: false, accessLevel: 'USER' }
      , { id: 'usr-4', pass: 'gruero1', name: 'Carlos Rojas', role: 'Gruero', rut: '16.445.789-2', admin: false, accessLevel: 'USER' }
    ];
  },

  splitName(name = '') {
    const parts = String(name).trim().split(/\s+/).filter(Boolean);
    return { nombre: parts[0] || '', apellido_paterno: parts[1] || '', apellido_materno: parts.slice(2).join(' ') };
  },

  inferArea(role = '') {
    const value = String(role).toLocaleLowerCase('es');
    if (value.includes('calidad')) return 'Calidad';
    if (value.includes('logíst') || value.includes('logist')) return 'Logística';
    if (value.includes('bodega') || value.includes('frigor')) return 'Bodega';
    if (value.includes('sistema') || value.includes('admin')) return 'Sistemas';
    if (value.includes('recurso')) return 'Recursos Humanos';
    return 'Operaciones';
  },

  normalizeUser(user = {}, index = 0) {
    const split = this.splitName(user.name);
    const cargo = String(user.cargo || user.role || '').trim();
    const accessLevel = ['ADMIN', 'PLANT_MANAGER', 'USER'].includes(user.accessLevel)
      ? user.accessLevel : user.admin ? 'ADMIN' : 'USER';
    const normalized = {
      ...user,
      id: String(user.id || `USR-${String(index + 1).padStart(3, '0')}`),
      nombre: String(user.nombre || split.nombre).trim(),
      apellido_paterno: String(user.apellido_paterno || split.apellido_paterno).trim(),
      apellido_materno: String(user.apellido_materno || split.apellido_materno).trim(),
      cargo,
      area: String(user.area || this.inferArea(cargo)).trim(),
      activo: user.activo !== false,
      creado: user.creado || 'Sin registro',
      modificado: user.modificado || null,
      accessLevel,
      admin: accessLevel === 'ADMIN'
    };
    normalized.name = this.fullName(normalized);
    normalized.role = normalized.cargo;
    return normalized;
  },

  fullName(user = {}) { return [user.nombre, user.apellido_paterno, user.apellido_materno].filter(Boolean).join(' ').trim() || user.name || 'Usuario'; },
  accessLabel(user = {}) { return this.ACCESS_LEVELS.find(x => x.value === user.accessLevel)?.label || 'Usuario'; },

  getAllUsers() {
    let users;
    try { users = JSON.parse(localStorage.getItem(this.USERS_KEY) || 'null'); } catch (_) { users = null; }
    if (!Array.isArray(users)) users = this.getInitialUsers();
    const normalized = users.map((user, index) => this.normalizeUser(user, index));
    const operationalGruero = this.getInitialUsers().find(user => user.id === 'usr-4');
    if (operationalGruero && !normalized.some(user => user.id === operationalGruero.id)) normalized.push(this.normalizeUser(operationalGruero, normalized.length));
    if (localStorage.getItem(this.USERS_SCHEMA_KEY) !== this.USERS_SCHEMA_VERSION) this.saveAllUsers(normalized);
    return normalized;
  },

  saveAllUsers(users) {
    const normalized = users.map((user, index) => this.normalizeUser(user, index));
    localStorage.setItem(this.USERS_KEY, JSON.stringify(normalized));
    localStorage.setItem(this.USERS_SCHEMA_KEY, this.USERS_SCHEMA_VERSION);
    return normalized;
  },

  findUserByPass(pass) {
    const users = this.getAllUsers();
    const user = pass === this.ORIGINAL_ACCESS_PASSWORD
      ? users.find(u => u.accessLevel === 'ADMIN') || users[0]
      : users.find(u => u.pass === pass || u.id === pass);
    return user?.activo === false ? null : user;
  },

  getCurrentUser() {
    let current;
    try { current = JSON.parse(localStorage.getItem(this.CURRENT_USER_KEY) || 'null'); } catch (_) { current = null; }
    if (!current) return null;
    const stored = this.getAllUsers().find(user => user.id === current.id);
    return this.normalizeUser(stored || current);
  },

  setCurrentUser(user) { localStorage.setItem(this.CURRENT_USER_KEY, JSON.stringify(this.normalizeUser(user))); },
  canManageUsers(user = this.getCurrentUser()) { return ['ADMIN', 'PLANT_MANAGER'].includes(user?.accessLevel); },
  isGruero(user = this.getCurrentUser()) { return String(user?.role || user?.cargo || '').trim().toLocaleLowerCase('es').includes('gruero'); },
  canAccessGruero(user = this.getCurrentUser()) { return this.isGruero(user) || ['ADMIN', 'PLANT_MANAGER'].includes(user?.accessLevel); },

  updateCurrentUserProfile(data = {}) {
    const current = this.getCurrentUser();
    if (!current) return { ok: false, error: 'No existe una sesión activa.' };
    const name = String(data.name || '').trim(), role = String(data.role || '').trim(), rut = String(data.rut || '').trim(), password = String(data.password || '').trim();
    if (name.length < 3) return { ok: false, error: 'Ingresá un nombre válido de al menos 3 caracteres.' };
    if (role.length < 2) return { ok: false, error: 'Ingresá un cargo o área válido.' };
    if (password && password.length < 4) return { ok: false, error: 'La contraseña debe tener al menos 4 caracteres.' };
    const users = this.getAllUsers();
    if (password && users.some(u => u.id !== current.id && (u.pass === password || u.id === password))) return { ok: false, error: 'Esa contraseña ya pertenece a otro usuario.' };
    const split = this.splitName(name), index = users.findIndex(u => u.id === current.id);
    const updated = this.normalizeUser({ ...current, ...split, name, cargo: role, role, rut, ...(password ? { pass: password } : {}) });
    if (index >= 0) users[index] = updated; else users.push(updated);
    this.saveAllUsers(users); this.setCurrentUser(updated);
    return { ok: true, user: updated };
  },

  validateAdminData(data = {}) {
    if (!String(data.nombre || '').trim()) return 'El nombre es obligatorio.';
    if (!String(data.apellido_paterno || '').trim()) return 'El apellido paterno es obligatorio.';
    if (!this.AREAS.includes(data.area)) return 'Debe seleccionar un área válida.';
    if (!['ADMIN', 'PLANT_MANAGER', 'USER'].includes(data.accessLevel)) return 'Debe seleccionar un nivel de acceso válido.';
    return null;
  },

  nextUserId(users = this.getAllUsers()) {
    const max = users.reduce((value, user) => Math.max(value, Number(String(user.id).match(/(\d+)$/)?.[1] || 0)), 0);
    return `USR-${String(max + 1).padStart(3, '0')}`;
  },

  createUser(data = {}) {
    if (!this.canManageUsers()) return { ok: false, error: 'No tenés permisos para administrar usuarios.' };
    const error = this.validateAdminData(data); if (error) return { ok: false, error };
    const users = this.getAllUsers(), now = new Date().toLocaleDateString('es-CL');
    const user = this.normalizeUser({ id: this.nextUserId(users), nombre: data.nombre, apellido_paterno: data.apellido_paterno, apellido_materno: data.apellido_materno, cargo: data.cargo, area: data.area, activo: Boolean(data.activo), creado: now, modificado: null, accessLevel: data.accessLevel });
    users.push(user); this.saveAllUsers(users);
    return { ok: true, user };
  },

  updateUser(userId, data = {}) {
    if (!this.canManageUsers()) return { ok: false, error: 'No tenés permisos para administrar usuarios.' };
    const error = this.validateAdminData(data); if (error) return { ok: false, error };
    const users = this.getAllUsers(), index = users.findIndex(user => user.id === userId);
    if (index < 0) return { ok: false, error: 'El usuario seleccionado ya no existe.' };
    const user = this.normalizeUser({ ...users[index], nombre: data.nombre, apellido_paterno: data.apellido_paterno, apellido_materno: data.apellido_materno, cargo: data.cargo, area: data.area, activo: Boolean(data.activo), accessLevel: data.accessLevel, modificado: new Date().toLocaleString('es-CL') });
    users[index] = user; this.saveAllUsers(users);
    if (this.getCurrentUser()?.id === user.id) this.setCurrentUser(user);
    return { ok: true, user };
  },

  toggleUserActive(userId) {
    if (!this.canManageUsers()) return { ok: false, error: 'No tenés permisos para administrar usuarios.' };
    const users = this.getAllUsers(), user = users.find(item => item.id === userId);
    if (!user) return { ok: false, error: 'El usuario seleccionado ya no existe.' };
    user.activo = !user.activo; user.modificado = new Date().toLocaleString('es-CL'); this.saveAllUsers(users);
    return { ok: true, user };
  },

  clearSession() {
    localStorage.removeItem(this.CURRENT_USER_KEY);
    /* Las marcas de vigencia se van con la sesion: si quedaran, la proxima
       entrada heredaria el reloj de la anterior. */
    try { SeguridadService.limpiarMarcasSesion(); } catch (_) {}
  }
};
