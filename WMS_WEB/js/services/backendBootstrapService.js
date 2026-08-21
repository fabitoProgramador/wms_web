/**
 * Puente temporal de arranque durante la migración local -> Supabase.
 *
 * Objetivo: permitir preparar Login/Sesión sin reestructurar AppController.
 * Cuando todas las secciones consuman backend este puente podrá desaparecer y
 * AppController podrá depender directamente de una capa de sesión remota.
 */
const BackendBootstrapService = {
  _instalado: false,

  /**
   * Si el backend está habilitado intenta restaurar la sesión autoritativa.
   * Si está deshabilitado no hace absolutamente nada: el flujo local sigue
   * siendo el mismo que antes de esta migración.
   */
  async prepararInicio() {
    if (typeof SUPABASE_CONFIG === 'undefined' || !SUPABASE_CONFIG.listo()) return;

    const restaurada = await SupabaseService.restaurarSesion();
    if (restaurada.ok && restaurada.usuario) {
      // Cache de presentación para los controladores legacy. La autorización
      // real sigue estando en Supabase/RBAC; esto no concede permisos.
      UserModel.setCurrentUser(restaurada.usuario);
      return;
    }

    // En modo remoto nunca se acepta una sesión local huérfana.
    UserModel.clearSession();
  },

  /**
   * Intercepta sólo logout para cerrar también la sesión Auth. Se conserva el
   * método visual original de AppController y por eso no cambia el diseño.
   */
  instalarHooks() {
    if (this._instalado || typeof AppController === 'undefined') return;
    this._instalado = true;

    const logoutLocal = AppController.logout.bind(AppController);
    AppController.logout = async () => {
      if (typeof SUPABASE_CONFIG !== 'undefined' && SUPABASE_CONFIG.listo()) {
        await SupabaseService.salir();
      }
      logoutLocal();
    };
  }
};
