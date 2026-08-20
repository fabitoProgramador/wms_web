/**
 * Servicio de seguridad del cliente.
 *
 * Único lugar del proyecto donde viven las decisiones de seguridad que se
 * aplican en el navegador. Es la base sobre la que después se apoya el
 * backend: cuando el sistema hable con Supabase, la autoridad real pasa a
 * estar en la base de datos, y esto queda como la primera barrera.
 *
 * REGLA IMPORTANTE: nada de lo que hay acá reemplaza a un servidor. Todo lo
 * que corre en el navegador es manipulable por quien tenga la consola abierta.
 * Esto reduce el daño accidental y cierra las vías de inyección; la validación
 * que no se puede burlar tiene que vivir en la base.
 */
const SeguridadService = {

  /* ==================================================================
     1. ESCAPE DE HTML
     ================================================================== */

  /**
   * Convierte un valor cualquiera en texto seguro para insertar en HTML,
   * TANTO en contenido como dentro de un atributo.
   *
   * Por qué no basta con `textContent`: la forma anterior creaba un <div>,
   * le asignaba textContent y devolvía innerHTML. Eso escapa `< > &` pero
   * NO las comillas. Como el proyecto interpola en atributos
   * (title="${esc(x)}", data-id="${esc(x)}" y 65 sitios más), un valor con
   * una comilla doble cerraba el atributo y permitía inyectar otro. Con
   * datos que llegan de SAP o que escribe un operador, eso es una puerta.
   *
   * Comprobado: `" data-x="1` inyectaba un atributo con la versión vieja y
   * no inyecta nada con ésta.
   */
  escaparHtml(valor) {
    return String(valor ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  },

  /* ==================================================================
     2. VIGENCIA DE LA SESIÓN

     NO se cierra por inactividad, y es a propósito. En cámara de frío un
     operador puede pasar una hora sin tocar el equipo porque está
     trabajando: bajando pallets, esperando un yale, revisando carga. Que
     el sistema lo eche por eso sería un estorbo, no una protección.

     Lo único que se controla es la duración TOTAL de la sesión: una
     sesión que quedó abierta en un PC de cámara no puede seguir viva
     indefinidamente. El tope está por encima de cualquier turno real,
     así que en operación normal nadie lo alcanza.
     ================================================================== */

  SESION: {
    /* 16 h: un turno de 12 con margen de sobra. Se cambia acá y en
       ningún otro lado. */
    DURACION_MAX_HORAS: 16,
    CLAVE_INICIO: 'wms_web_sesion_inicio'
  },

  /** Se llama al iniciar sesión: deja la marca de tiempo de arranque. */
  marcarInicioSesion() {
    try { localStorage.setItem(this.SESION.CLAVE_INICIO, String(Date.now())); }
    catch (_) { /* almacenamiento lleno o bloqueado: la app sigue */ }
  },

  /**
   * @returns {{vigente:boolean, motivo:string|null}}
   */
  estadoSesion() {
    let inicio = 0;
    try { inicio = Number(localStorage.getItem(this.SESION.CLAVE_INICIO) || 0); } catch (_) {}
    if (!Number.isFinite(inicio) || inicio <= 0) {
      /* Sesión anterior a este control: se la deja pasar y se marca ahora,
         para no echar a nadie en el primer despliegue. */
      this.marcarInicioSesion();
      return { vigente: true, motivo: null };
    }
    if (Date.now() - inicio > this.SESION.DURACION_MAX_HORAS * 60 * 60 * 1000) {
      return { vigente: false, motivo: 'duracion' };
    }
    return { vigente: true, motivo: null };
  },

  limpiarMarcasSesion() {
    try { localStorage.removeItem(this.SESION.CLAVE_INICIO); } catch (_) {}
  },

  /* ==================================================================
     3. FRENO A LOS INTENTOS FALLIDOS

     Hoy la contraseña es además el identificador, así que probar claves al
     azar identifica usuarios. Un freno progresivo hace inviable ese tanteo
     sin molestar a quien simplemente se equivocó una vez.
     ================================================================== */

  INTENTOS: {
    CLAVE: 'wms_web_intentos_acceso',
    LIBRES: 4,            // los primeros cuatro no esperan nada
    ESPERA_BASE_SEG: 15,  // a partir del quinto: 15 s, 30 s, 60 s…
    ESPERA_MAX_SEG: 300,
    OLVIDO_MIN: 30        // media hora sin fallar y el contador vuelve a cero
  },

  _leerIntentos() {
    try {
      const x = JSON.parse(localStorage.getItem(this.INTENTOS.CLAVE) || 'null');
      if (!x || typeof x !== 'object') return { fallos: 0, ultimo: 0 };
      return { fallos: Number(x.fallos) || 0, ultimo: Number(x.ultimo) || 0 };
    } catch (_) { return { fallos: 0, ultimo: 0 }; }
  },
  _guardarIntentos(estado) {
    try { localStorage.setItem(this.INTENTOS.CLAVE, JSON.stringify(estado)); } catch (_) {}
  },

  /**
   * ¿Puede intentar ahora?
   * @returns {{permitido:boolean, esperaSeg:number, fallos:number}}
   */
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
    try { localStorage.removeItem(this.INTENTOS.CLAVE); } catch (_) {}
  }
};
