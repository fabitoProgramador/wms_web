/**
 * Arranque autoritativo WMS_WEB -> Supabase.
 *
 * Antes de mostrar la aplicación intenta restaurar la sesión Auth y valida
 * usuario, rol, permisos y vigencia mediante public.wms_sesion_actual().
 * Si esa validación falla, no se acepta ninguna sesión local alternativa.
 */
const BackendBootstrapService = {
  _instalado: false,

  async prepararInicio() {
    if (typeof SUPABASE_CONFIG === 'undefined' || !SUPABASE_CONFIG.listo()) {
      UserModel.clearSession();
      return { ok: false, error: 'Backend Supabase no configurado.' };
    }

    const restaurada = await SupabaseService.restaurarSesion();
    if (restaurada.ok && restaurada.usuario) {
      UserModel.setCurrentUser(restaurada.usuario);
      return { ok: true, usuario: restaurada.usuario };
    }

    UserModel.clearSession();
    return { ok: false, sinSesion: true, error: restaurada.error || null };
  },

  /**
   * Conserva el método visual actual de AppController, pero el cierre real de
   * Auth ocurre primero en Supabase. Después sólo se limpia la fachada local
   * en memoria y se vuelve al Login.
   */
  instalarHooks() {
    if (this._instalado || typeof AppController === 'undefined') return;
    this._instalado = true;

    const logoutVisual = AppController.logout.bind(AppController);
    AppController.logout = async () => {
      await SupabaseService.salir();
      logoutVisual();
    };
  }
};
