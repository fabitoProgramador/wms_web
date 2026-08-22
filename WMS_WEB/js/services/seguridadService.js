/**
 * Seguridad del cliente.
 *
 * La autoridad real vive en Supabase Auth + RBAC/RPC. Este servicio sólo
 * mantiene defensas de interfaz que no sustituyen al backend.
 */
const SeguridadService = {
  escaparHtml(valor) {
    return String(valor ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  },

  /*
   * AppController todavía consulta este método de forma síncrona. Cuando
   * Supabase está activo, la sesión ya fue validada por BackendBootstrapService
   * contra wms_sesion_actual(), por lo que aquí no se crea un segundo reloj
   * local ni una regla paralela de caducidad.
   */
  estadoSesion() {
    if (typeof SUPABASE_CONFIG !== 'undefined' && SUPABASE_CONFIG.listo()) {
      return { vigente: Boolean(SupabaseService?.haySesion?.()), motivo: SupabaseService?.haySesion?.() ? null : 'backend' };
    }
    return { vigente: false, motivo: 'backend_requerido' };
  },

  marcarInicioSesion() {
    // Sin efecto: la duración máxima se calcula y valida en wms_sesion_actual().
  },

  limpiarMarcasSesion() {
    try { sessionStorage.removeItem('wms_web_sesion_inicio'); } catch (_) {}
    try { localStorage.removeItem('wms_web_sesion_inicio'); } catch (_) {}
  },

  /* Freno de UX ante intentos repetidos. Supabase mantiene sus propios
     controles/rate limits; esto sólo evita tanteos rápidos desde este cliente. */
  INTENTOS: {
    CLAVE: 'wms_web_intentos_acceso',
    LIBRES: 4,
    ESPERA_BASE_SEG: 15,
    ESPERA_MAX_SEG: 300,
    OLVIDO_MIN: 30
  },

  _leerIntentos() {
    try {
      const x = JSON.parse(sessionStorage.getItem(this.INTENTOS.CLAVE) || 'null');
      if (!x || typeof x !== 'object') return { fallos: 0, ultimo: 0 };
      return { fallos: Number(x.fallos) || 0, ultimo: Number(x.ultimo) || 0 };
    } catch (_) { return { fallos: 0, ultimo: 0 }; }
  },

  _guardarIntentos(estado) {
    try { sessionStorage.setItem(this.INTENTOS.CLAVE, JSON.stringify(estado)); } catch (_) {}
  },

  puedeIntentar() {
    const { fallos, ultimo } = this._leerIntentos();
    if (!fallos) return { permitido: true, esperaSeg: 0, fallos: 0 };
    const ahora = Date.now();
    if (ahora - ultimo > this.INTENTOS.OLVIDO_MIN * 60 * 1000) {
      this.reiniciarIntentos();
      return { permitido: true, esperaSeg: 0, fallos: 0 };
    }
    if (fallos <= this.INTENTOS.LIBRES) return { permitido: true, esperaSeg: 0, fallos };
    const exceso = fallos - this.INTENTOS.LIBRES;
    const espera = Math.min(this.INTENTOS.ESPERA_BASE_SEG * Math.pow(2, exceso - 1), this.INTENTOS.ESPERA_MAX_SEG);
    const restante = Math.ceil((ultimo + espera * 1000 - ahora) / 1000);
    return restante > 0
      ? { permitido: false, esperaSeg: restante, fallos }
      : { permitido: true, esperaSeg: 0, fallos };
  },

  registrarFallo() {
    const { fallos } = this._leerIntentos();
    this._guardarIntentos({ fallos: fallos + 1, ultimo: Date.now() });
  },

  reiniciarIntentos() {
    try { sessionStorage.removeItem(this.INTENTOS.CLAVE); } catch (_) {}
    try { localStorage.removeItem(this.INTENTOS.CLAVE); } catch (_) {}
  }
};
