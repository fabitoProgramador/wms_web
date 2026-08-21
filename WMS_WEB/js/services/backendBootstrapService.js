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
   * El header mantiene exactamente su estructura/CSS original. Sólo se cambia
   * el significado del estado: ya no es un texto estático ni una simulación
   * local, sino el estado de la sesión/backend Supabase validado.
   */
  actualizarHeaderBackend(estado = 'ok', texto = '') {
    const linea = document.querySelector('.header-title p');
    if (linea) {
      const etiqueta = texto || ({
        ok: 'Supabase conectado',
        loading: 'Validando Supabase…',
        offline: 'Sin conexión a Supabase',
        error: 'Backend no disponible'
      })[estado] || 'Supabase';
      linea.innerHTML = `SISTEMA FRIGORÍFICO PARRAL <i></i> ${SeguridadService.escaparHtml(etiqueta)}`;
    }

    const sesion = document.querySelector('.user-session-status span');
    if (sesion) {
      sesion.textContent = estado === 'ok'
        ? 'Supabase · Sesión activa'
        : estado === 'loading'
          ? 'Validando sesión…'
          : 'Sesión sin validar';
    }
  },

  prepararHeaderBackend() {
    // La edición personal todavía no tiene un RPC específico. No se deja un
    // botón visible que parezca operativo y termine en un error local.
    document.querySelector('.user-overlay-edit')?.remove();

    const boton = document.querySelector('.sync-button');
    if (boton) {
      boton.setAttribute('aria-label', 'Actualizar datos desde Supabase');
      boton.title = 'Revalidar sesión y actualizar la vista desde Supabase';
      const texto = boton.querySelector('span');
      if (texto) texto.textContent = 'ACTUALIZAR DATOS';
    }

    this.actualizarHeaderBackend('ok');
  },

  /**
   * Revalida identidad, rol, permisos y vigencia en el backend. Si la sesión
   * sigue válida, actualiza la fachada de usuario en memoria y vuelve a montar
   * la vista activa, haciendo que los módulos migrados consulten nuevamente
   * sus RPCs. Un problema de red NO destruye la sesión local del navegador.
   */
  async actualizarDesdeBackend() {
    const boton = document.querySelector('.sync-button');
    const texto = boton?.querySelector('span');
    if (boton) boton.disabled = true;
    if (texto) texto.textContent = 'ACTUALIZANDO…';
    this.actualizarHeaderBackend('loading');

    try {
      const validacion = await SupabaseService.sesionActual();

      if (!validacion.ok) {
        if (validacion.red) {
          this.actualizarHeaderBackend('offline');
          try {
            NotificationService.show('No fue posible conectar con Supabase. Los módulos migrados no usarán datos locales de respaldo.', { type: 'warning', store: false });
          } catch (_) {}
          return { ok: false, red: true };
        }

        if (validacion.permiso || [401, 403].includes(Number(validacion.estado))) {
          await SupabaseService.salir();
          UserModel.clearSession();
          AppController.showAuthView();
          try {
            NotificationService.show('La sesión ya no es válida. Vuelva a ingresar.', { type: 'warning', store: false });
          } catch (_) {}
          return { ok: false, sinSesion: true };
        }

        this.actualizarHeaderBackend('error');
        try {
          NotificationService.show(validacion.error || 'No fue posible validar el backend.', { type: 'error', store: false });
        } catch (_) {}
        return { ok: false };
      }

      const usuario = SupabaseService.usuarioInterfaz(validacion.datos);
      UserModel.setCurrentUser(usuario);
      AppController.updateUserChrome(usuario);
      this.actualizarHeaderBackend('ok');
      AppController.navigate(AppController.activeView);

      if (boton) {
        boton.classList.add('synced');
        setTimeout(() => boton.classList.remove('synced'), 800);
      }
      return { ok: true, usuario };
    } finally {
      if (boton) boton.disabled = false;
      if (texto) texto.textContent = 'ACTUALIZAR DATOS';
    }
  },

  /**
   * Conserva AppController como shell visual. La capa backend sólo envuelve
   * acciones transversales para no reestructurar vistas ni CSS.
   */
  instalarHooks() {
    if (this._instalado || typeof AppController === 'undefined') return;
    this._instalado = true;

    const logoutVisual = AppController.logout.bind(AppController);
    AppController.logout = async () => {
      await SupabaseService.salir();
      logoutVisual();
    };

    const showMainVisual = AppController.showMainApp.bind(AppController);
    AppController.showMainApp = user => {
      showMainVisual(user);
      this.prepararHeaderBackend();
    };

    // El botón histórico ya no hace un simple re-render local.
    AppController.syncTurn = () => this.actualizarDesdeBackend();
  }
};
