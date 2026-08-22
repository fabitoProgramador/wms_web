/**
 * Puente único entre WMS_WEB y el backend real de Supabase.
 *
 * FUENTE DE VERDAD
 * --------------------------------------------------------------------
 * Identidad: Supabase Auth (correo + contraseña).
 * Autorización: public.wms_sesion_actual() + RBAC WMS.
 * Datos operacionales: RPCs públicos wms_*.
 *
 * No existe fallback a datos de negocio locales. sessionStorage se usa sólo
 * para conservar los tokens Auth durante la sesión del navegador; al recargar
 * siempre se vuelve a validar la sesión contra wms_sesion_actual().
 */
const SupabaseService = {
  _sesion: null,

  /* ============================= RED ============================== */

  _esAuth(ruta = '') { return String(ruta).startsWith('/auth/v1/'); },

  cabeceras(ruta = '', extra = {}) {
    const key = SUPABASE_CONFIG.PUBLISHABLE_KEY;
    const base = {
      apikey: key,
      'Content-Type': 'application/json'
    };

    if (!this._esAuth(ruta)) {
      base['Accept-Profile'] = SUPABASE_CONFIG.ESQUEMA;
      base['Content-Profile'] = SUPABASE_CONFIG.ESQUEMA;
    }

    base.Authorization = `Bearer ${this._sesion?.access_token || key}`;
    return { ...base, ...extra };
  },

  async pedir(ruta, opciones = {}, intento = 0) {
    if (!SUPABASE_CONFIG.listo()) {
      return { ok: false, error: SUPABASE_CONFIG.diagnostico(), deshabilitado: true };
    }

    if (!this._esAuth(ruta) && this._sesion?.refresh_token) {
      const renovada = await this.renovarSiHaceFalta();
      if (!renovada.ok) return renovada;
    }

    const control = new AbortController();
    const reloj = setTimeout(() => control.abort(), SUPABASE_CONFIG.TIMEOUT_MS);
    try {
      const respuesta = await fetch(`${SUPABASE_CONFIG.URL}${ruta}`, {
        ...opciones,
        headers: this.cabeceras(ruta, opciones.headers),
        signal: control.signal
      });
      clearTimeout(reloj);
      const cuerpo = await respuesta.text();
      const datos = cuerpo ? this._json(cuerpo) : null;

      if (respuesta.ok) return { ok: true, datos, estado: respuesta.status };
      return {
        ok: false,
        estado: respuesta.status,
        error: datos?.message || datos?.msg || datos?.error_description || datos?.error || `Error ${respuesta.status}`,
        permiso: respuesta.status === 401 || respuesta.status === 403
      };
    } catch (error) {
      clearTimeout(reloj);
      const esRed = error?.name === 'AbortError' || error instanceof TypeError;
      if (esRed && intento < SUPABASE_CONFIG.REINTENTOS) {
        await new Promise(resolve => setTimeout(resolve, 400 * Math.pow(2, intento)));
        return this.pedir(ruta, opciones, intento + 1);
      }
      return { ok: false, red: true, error: 'Sin conexión con el servidor.' };
    }
  },

  _json(texto) {
    try { return JSON.parse(texto); } catch (_) { return texto || null; }
  },

  /** RPC atómico del backend. Los controladores migrados deben entrar por acá. */
  async funcion(nombre, parametros = {}) {
    return this.pedir(`/rest/v1/rpc/${nombre}`, {
      method: 'POST',
      body: JSON.stringify(parametros || {})
    });
  },

  async rpc(grupo, nombre, parametros = {}) {
    const funcion = SUPABASE_CONFIG.rpc(grupo, nombre);
    if (!funcion) return { ok: false, error: `RPC no registrado: ${grupo}.${nombre}` };
    return this.funcion(funcion, parametros);
  },

  /* ========================= AUTENTICACIÓN ======================== */

  _guardarSesion(datos) {
    if (!datos?.access_token) return false;
    this._sesion = {
      access_token: datos.access_token,
      refresh_token: datos.refresh_token || this._sesion?.refresh_token || null,
      expira: Date.now() + (Number(datos.expires_in) || 3600) * 1000,
      usuarioAuth: datos.user || this._sesion?.usuarioAuth || null
    };
    try {
      sessionStorage.setItem(SUPABASE_CONFIG.SESSION_STORAGE_KEY, JSON.stringify(this._sesion));
    } catch (_) {}
    return true;
  },

  _leerSesionGuardada() {
    try {
      const value = JSON.parse(sessionStorage.getItem(SUPABASE_CONFIG.SESSION_STORAGE_KEY) || 'null');
      return value?.access_token && value?.refresh_token ? value : null;
    } catch (_) {
      return null;
    }
  },

  _limpiarSesion() {
    this._sesion = null;
    try { sessionStorage.removeItem(SUPABASE_CONFIG.SESSION_STORAGE_KEY); } catch (_) {}
  },

  async ingresar(email, password) {
    const correo = String(email || '').trim().toLowerCase();
    const clave = String(password || '');
    if (!correo || !correo.includes('@')) return { ok: false, error: 'Ingrese un correo electrónico válido.' };
    if (!clave) return { ok: false, error: 'Ingrese su contraseña.' };

    const auth = await this.pedir('/auth/v1/token?grant_type=password', {
      method: 'POST',
      body: JSON.stringify({ email: correo, password: clave })
    });

    // Mensaje deliberadamente genérico para evitar enumeración de cuentas.
    if (!auth.ok) return { ok: false, error: 'Correo o contraseña incorrectos.', estado: auth.estado };
    this._guardarSesion(auth.datos);

    const sesion = await this.sesionActual();
    if (!sesion.ok) {
      await this.salir();
      return { ok: false, error: sesion.error || 'La cuenta no posee acceso habilitado al WMS.' };
    }

    return {
      ok: true,
      sesion: sesion.datos,
      usuario: this.usuarioInterfaz(sesion.datos)
    };
  },

  /**
   * Restaura una sesión al recargar la página y vuelve a validarla en backend.
   */
  async restaurarSesion() {
    if (!SUPABASE_CONFIG.listo()) return { ok: false, deshabilitado: true };
    this._sesion = this._leerSesionGuardada();
    if (!this._sesion) return { ok: false, sinSesion: true };

    const renovada = await this.renovarSiHaceFalta();
    if (!renovada.ok) {
      this._limpiarSesion();
      return { ok: false, sinSesion: true, error: 'La sesión ya no es válida.' };
    }

    const sesion = await this.sesionActual();
    if (!sesion.ok) {
      this._limpiarSesion();
      return { ok: false, sinSesion: true, error: sesion.error };
    }

    return { ok: true, sesion: sesion.datos, usuario: this.usuarioInterfaz(sesion.datos) };
  },

  async renovarSiHaceFalta() {
    if (!this._sesion?.refresh_token) return { ok: false, sinSesion: true };
    if (Date.now() < Number(this._sesion.expira || 0) - 60000) {
      return { ok: true, sinCambios: true };
    }

    const control = new AbortController();
    const reloj = setTimeout(() => control.abort(), SUPABASE_CONFIG.TIMEOUT_MS);
    try {
      const respuesta = await fetch(`${SUPABASE_CONFIG.URL}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_CONFIG.PUBLISHABLE_KEY,
          Authorization: `Bearer ${SUPABASE_CONFIG.PUBLISHABLE_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ refresh_token: this._sesion.refresh_token }),
        signal: control.signal
      });
      clearTimeout(reloj);
      const cuerpo = await respuesta.text();
      const datos = cuerpo ? this._json(cuerpo) : null;
      if (!respuesta.ok || !datos?.access_token) {
        this._limpiarSesion();
        return { ok: false, estado: respuesta.status, error: 'La sesión expiró.' };
      }
      this._guardarSesion(datos);
      return { ok: true };
    } catch (_) {
      clearTimeout(reloj);
      return { ok: false, red: true, error: 'No fue posible renovar la sesión.' };
    }
  },

  async sesionActual() {
    if (!this._sesion?.access_token) return { ok: false, error: 'Sin sesión autenticada.' };
    return this.rpc('auth', 'sesionActual');
  },

  /** Adaptador de sesión backend al shape visual actual. */
  usuarioInterfaz(sesion = {}) {
    const u = sesion?.usuario || {};
    const r = sesion?.rol || {};
    const codigoRol = String(r.codigo || '').toUpperCase();
    const accessLevel = codigoRol === 'ADMINISTRADOR'
      ? 'ADMIN'
      : codigoRol === 'JEFE_PLANTA' ? 'PLANT_MANAGER' : 'USER';
    const role = codigoRol === 'GRUERO' ? 'Gruero' : (u.cargo || r.nombre || 'Usuario');

    return {
      id: u.usuario_id,
      usuario_id: u.usuario_id,
      email: u.email,
      nombre: u.nombre,
      apellido_paterno: u.apellido_paterno,
      apellido_materno: u.apellido_materno,
      name: u.nombre_completo || [u.nombre, u.apellido_paterno, u.apellido_materno].filter(Boolean).join(' '),
      cargo: u.cargo,
      area: u.area,
      role,
      rut: u.rut,
      activo: u.activo !== false,
      accessLevel,
      admin: accessLevel === 'ADMIN',
      backendRole: codigoRol,
      backendRoleName: r.nombre,
      permisos: Array.isArray(sesion?.permisos) ? sesion.permisos : [],
      sesionBackend: sesion?.sesion || null
    };
  },

  /** Recuperación estándar de Supabase Auth por correo. */
  async recuperarPassword(email) {
    const correo = String(email || '').trim().toLowerCase();
    if (!correo || !correo.includes('@')) return { ok: false, error: 'Ingrese un correo electrónico válido.' };

    const r = await this.pedir('/auth/v1/recover', {
      method: 'POST',
      body: JSON.stringify({ email: correo })
    });

    // No confirmar si el correo existe.
    if (!r.ok && r.red) return r;
    return { ok: true };
  },

  async salir() {
    if (this._sesion?.access_token && SUPABASE_CONFIG.listo()) {
      try { await this.pedir('/auth/v1/logout', { method: 'POST' }); } catch (_) {}
    }
    this._limpiarSesion();
    return { ok: true };
  },

  haySesion() { return Boolean(this._sesion?.access_token); },

  /* ============================= TEST ============================== */

  async probar() {
    if (!SUPABASE_CONFIG.listo()) return { ok: false, error: SUPABASE_CONFIG.diagnostico() };
    if (!this.haySesion()) return { ok: true, mensaje: 'Proyecto configurado; falta una sesión autenticada para probar RLS/RPC.' };
    const r = await this.sesionActual();
    return r.ok
      ? { ok: true, mensaje: 'Supabase Auth + sesión WMS + RBAC operativos.' }
      : { ok: false, error: r.error };
  }
};
