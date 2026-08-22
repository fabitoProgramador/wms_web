/**
 * Fachada de usuario para la interfaz.
 *
 * FUENTE DE VERDAD
 * --------------------------------------------------------------------
 * Este modelo NO persiste usuarios, contraseñas, roles ni permisos en
 * localStorage. La identidad viene de Supabase Auth y la autorización de
 * public.wms_sesion_actual().
 */
const UserModel = {
  _currentUser: null,

  ACCESS_LEVELS: [
    { value: 'USER', label: 'Usuario' },
    { value: 'PLANT_MANAGER', label: 'Jefe de Planta' },
    { value: 'ADMIN', label: 'Administrador' }
  ],

  normalizeUser(user = {}) {
    if (!user || typeof user !== 'object') return null;
    const codigoRol = String(user.backendRole || '').toUpperCase();
    const accessLevel = user.accessLevel || (codigoRol === 'ADMINISTRADOR'
      ? 'ADMIN'
      : codigoRol === 'JEFE_PLANTA' ? 'PLANT_MANAGER' : 'USER');
    const name = String(user.name || [user.nombre, user.apellido_paterno, user.apellido_materno].filter(Boolean).join(' ') || 'Usuario').trim();
    const role = String(user.role || user.cargo || user.backendRoleName || 'Usuario').trim();

    return {
      ...user,
      id: user.id || user.usuario_id || null,
      usuario_id: user.usuario_id || user.id || null,
      name,
      role,
      cargo: user.cargo || role,
      activo: user.activo !== false,
      accessLevel,
      admin: codigoRol === 'ADMINISTRADOR' || accessLevel === 'ADMIN',
      permisos: Array.isArray(user.permisos) ? user.permisos : []
    };
  },

  getCurrentUser() {
    return this._currentUser ? this.normalizeUser(this._currentUser) : null;
  },

  setCurrentUser(user) {
    this._currentUser = this.normalizeUser(user);
    return this._currentUser;
  },

  clearSession() {
    this._currentUser = null;
    try { SeguridadService.limpiarMarcasSesion(); } catch (_) {}
  },

  hasPermission(codigo, user = this.getCurrentUser()) {
    return Boolean(user && Array.isArray(user.permisos) && user.permisos.includes(codigo));
  },

  canManageUsers(user = this.getCurrentUser()) {
    return this.hasPermission('usuarios.gestionar', user);
  },

  isGruero(user = this.getCurrentUser()) {
    return String(user?.backendRole || '').toUpperCase() === 'GRUERO';
  },

  canAccessGruero(user = this.getCurrentUser()) {
    return this.isGruero(user) || this.hasPermission('mapa.gestionar', user) || this.hasPermission('inventario.gestionar', user);
  },

  accessLabel(user = this.getCurrentUser()) {
    return user?.backendRoleName || this.ACCESS_LEVELS.find(x => x.value === user?.accessLevel)?.label || 'Usuario';
  }
};
