/**
 * Puente con Supabase.
 *
 * ====================================================================
 * INACTIVO MIENTRAS `SUPABASE_CONFIG.HABILITADO` SEA false.
 * Ningún módulo del sistema depende todavía de este archivo. Existe para
 * que el backend se pueda ir armando y probando por partes, sin tocar lo
 * que hoy funciona.
 * ====================================================================
 *
 * POR QUÉ NO USA LA LIBRERÍA OFICIAL
 * Supabase expone una API REST (PostgREST) que se consume con `fetch`.
 * Traer el SDK completo significaría un bundle y una dependencia externa
 * en un proyecto que hoy no tiene ninguna. Para lo que el WMS necesita
 * —leer, insertar, actualizar y llamar funciones— alcanza con fetch, y
 * así el proyecto sigue sin cadena de dependencias que auditar.
 *
 * DÓNDE ENCAJA
 * El sistema ya tiene dos contratos de adaptador esperando:
 *   window.WmsSyncAdapter.sendMovement(item)   -> Operación Gruero
 *   window.WmsMapAdapter.fetchSnapshot()       -> Mapa de Cámara
 * Este servicio es lo que después alimentará a esos dos, sin que los
 * controladores se enteren de que hay una base detrás.
 */
const SupabaseService = {

  _sesion: null,   // { access_token, refresh_token, expira, usuario }

  /* ==================================================================
     LLAMADA BASE
     ================================================================== */

  cabeceras(extra = {}) {
    const base = {
      'apikey': SUPABASE_CONFIG.ANON_KEY,
      'Content-Type': 'application/json',
      'Accept-Profile': SUPABASE_CONFIG.ESQUEMA,
      'Content-Profile': SUPABASE_CONFIG.ESQUEMA
    };
    /* Con sesión se manda el token del usuario, no la anon: es lo que
       permite que las políticas de la base sepan QUIÉN pregunta. */
    base.Authorization = `Bearer ${this._sesion?.access_token || SUPABASE_CONFIG.ANON_KEY}`;
    return { ...base, ...extra };
  },

  /**
   * Envoltorio único de red. Devuelve SIEMPRE un objeto, nunca lanza:
   * el resto del sistema ya trabaja con `{ok:false, error}` y con colas
   * offline, y una excepción suelta rompería ese flujo.
   *
   * @returns {Promise<{ok:boolean, datos?:any, error?:string, estado?:number, red?:boolean}>}
   */
  async pedir(ruta, opciones = {}, intento = 0) {
    if (!SUPABASE_CONFIG.listo()) {
      return { ok: false, error: SUPABASE_CONFIG.diagnostico(), deshabilitado: true };
    }
    const control = new AbortController();
    const reloj = setTimeout(() => control.abort(), SUPABASE_CONFIG.TIMEOUT_MS);
    try {
      const respuesta = await fetch(`${SUPABASE_CONFIG.URL}${ruta}`, {
        ...opciones,
        headers: this.cabeceras(opciones.headers),
        signal: control.signal
      });
      clearTimeout(reloj);
      const cuerpo = await respuesta.text();
      const datos = cuerpo ? this._json(cuerpo) : null;
      if (respuesta.ok) return { ok: true, datos, estado: respuesta.status };
      /* 401 y 403 son decisiones de la base: no se reintentan. Insistir
         ante un permiso denegado sólo genera ruido y bloqueos. */
      return {
        ok: false,
        estado: respuesta.status,
        error: datos?.message || datos?.error_description || `Error ${respuesta.status}`,
        permiso: respuesta.status === 401 || respuesta.status === 403
      };
    } catch (error) {
      clearTimeout(reloj);
      const esRed = error?.name === 'AbortError' || error instanceof TypeError;
      if (esRed && intento < SUPABASE_CONFIG.REINTENTOS) {
        await new Promise(r => setTimeout(r, 400 * Math.pow(2, intento)));
        return this.pedir(ruta, opciones, intento + 1);
      }
      return { ok: false, red: true, error: 'Sin conexión con el servidor.' };
    }
  },

  _json(texto) { try { return JSON.parse(texto); } catch (_) { return null; } },

  /* ==================================================================
     TABLAS
     ================================================================== */

  tabla(nombre) { return SUPABASE_CONFIG.TABLAS[nombre] || nombre; },

  /** SELECT. `filtros` usa la sintaxis de PostgREST: {estado:'eq.LIBERADO'} */
  async listar(tabla, { filtros = {}, columnas = '*', orden = null, limite = null } = {}) {
    const p = new URLSearchParams({ select: columnas });
    Object.entries(filtros).forEach(([k, v]) => p.append(k, v));
    if (orden) p.append('order', orden);
    if (limite) p.append('limit', String(limite));
    return this.pedir(`/rest/v1/${this.tabla(tabla)}?${p}`, { method: 'GET' });
  },

  async insertar(tabla, filas) {
    return this.pedir(`/rest/v1/${this.tabla(tabla)}`, {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(Array.isArray(filas) ? filas : [filas])
    });
  },

  /**
   * Insertar-o-actualizar por clave. Es lo que necesita la cola offline:
   * si un movimiento se reenvía porque el operador perdió señal, la clave
   * de idempotencia evita que se aplique dos veces.
   */
  async upsert(tabla, filas, { conflicto = 'id' } = {}) {
    return this.pedir(`/rest/v1/${this.tabla(tabla)}?on_conflict=${conflicto}`, {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify(Array.isArray(filas) ? filas : [filas])
    });
  },

  async actualizar(tabla, filtros, cambios) {
    const p = new URLSearchParams();
    Object.entries(filtros).forEach(([k, v]) => p.append(k, v));
    return this.pedir(`/rest/v1/${this.tabla(tabla)}?${p}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(cambios)
    });
  },

  /** Función almacenada (RPC). Se usa para operaciones que deben ser atómicas. */
  async funcion(nombre, parametros = {}) {
    return this.pedir(`/rest/v1/rpc/${nombre}`, {
      method: 'POST',
      body: JSON.stringify(parametros)
    });
  },

  /* ==================================================================
     SESIÓN — RUT + PIN

     El sistema de planta se identifica por RUT, no por correo, y el PIN
     es lo que el operador puede escribir con guantes. Supabase Auth
     trabaja con correo, así que se traduce: el RUT normalizado forma un
     correo interno del dominio de la planta, que nadie usa para recibir
     nada; sólo sirve de identificador estable.

     El PIN NUNCA se guarda ni se compara en el navegador: viaja a
     Supabase, que lo verifica contra el hash del servidor. Esto es lo
     que reemplaza al `pass:'admin123'` en texto plano de hoy.
     ================================================================== */

  DOMINIO_INTERNO: 'planta.local',

  /** 12.345.678-9 -> 123456789 ; se acepta con o sin puntos y guion. */
  normalizarRut(rut) {
    return String(rut || '').trim().toUpperCase().replace(/[.\-\s]/g, '');
  },

  correoDeRut(rut) {
    const limpio = this.normalizarRut(rut);
    return limpio ? `rut${limpio}@${this.DOMINIO_INTERNO}` : '';
  },

  /**
   * Ingreso con RUT y PIN.
   * @returns {Promise<{ok:boolean, usuario?:object, error?:string}>}
   */
  async ingresar(rut, pin) {
    const correo = this.correoDeRut(rut);
    if (!correo) return { ok: false, error: 'RUT no válido.' };
    if (!String(pin || '').trim()) return { ok: false, error: 'Ingrese su PIN.' };

    const r = await this.pedir('/auth/v1/token?grant_type=password', {
      method: 'POST',
      body: JSON.stringify({ email: correo, password: String(pin) })
    });
    /* El mensaje al operador no distingue entre "ese RUT no existe" y "el
       PIN está mal": decirlo revelaría qué RUT están registrados. */
    if (!r.ok) return { ok: false, error: 'RUT o PIN incorrectos.' };

    this._guardarSesion(r.datos);
    const perfil = await this.perfilActual();
    return { ok: true, usuario: perfil.datos?.[0] || null };
  },

  _guardarSesion(datos) {
    if (!datos?.access_token) return;
    this._sesion = {
      access_token: datos.access_token,
      refresh_token: datos.refresh_token,
      expira: Date.now() + (Number(datos.expires_in) || 3600) * 1000,
      usuario: datos.user || null
    };
  },

  /** Renueva el token antes de que caduque. */
  async renovarSiHaceFalta() {
    if (!this._sesion?.refresh_token) return { ok: false };
    if (Date.now() < this._sesion.expira - 60000) return { ok: true, sinCambios: true };
    const r = await this.pedir('/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      body: JSON.stringify({ refresh_token: this._sesion.refresh_token })
    });
    if (r.ok) this._guardarSesion(r.datos);
    else this._sesion = null;
    return r;
  },

  /** El perfil trae rol y permisos DESDE LA BASE, no desde el navegador. */
  async perfilActual() {
    if (!this._sesion) return { ok: false, error: 'Sin sesión.' };
    return this.listar('usuarios', { filtros: { select: '*' }, columnas: '*' });
  },

  async salir() {
    if (this._sesion) await this.pedir('/auth/v1/logout', { method: 'POST' });
    this._sesion = null;
  },

  haySesion() { return Boolean(this._sesion?.access_token); },

  /* ==================================================================
     COMPROBACIÓN
     ================================================================== */

  /** Verifica que el proyecto responde y que las políticas están puestas. */
  async probar() {
    if (!SUPABASE_CONFIG.listo()) return { ok: false, error: SUPABASE_CONFIG.diagnostico() };
    const r = await this.listar('pallets', { columnas: 'id', limite: 1 });
    if (r.ok) return { ok: true, mensaje: 'Conexión establecida y lectura permitida.' };
    if (r.permiso) return { ok: true, mensaje: 'Conexión establecida; la base exige sesión (RLS activo, que es lo correcto).' };
    return { ok: false, error: r.error };
  }
};
