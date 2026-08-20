/**
 * Configuración de conexión con Supabase.
 *
 * ====================================================================
 * NADA DE ESTO ESTÁ ACTIVO TODAVÍA.
 * Mientras `HABILITADO` sea false, el sistema sigue funcionando
 * exactamente como hoy, contra los datos locales. Este archivo son los
 * cimientos: se llena cuando exista el proyecto en Supabase y se
 * enciende cuando el backend esté probado.
 * ====================================================================
 *
 * SOBRE LAS CLAVES — importante
 *
 * La clave `anon` es PÚBLICA por diseño: viaja al navegador y cualquiera
 * puede leerla. Eso no es una filtración: lo que protege los datos no es
 * la clave, son las políticas de Row Level Security de la base. Una anon
 * sin RLS deja la base abierta; una anon con RLS bien escrita es segura.
 *
 * La clave `service_role` NO puede aparecer nunca en este archivo ni en
 * ningún otro que llegue al navegador. Salta todas las políticas. Vive
 * únicamente en un servidor propio o en una Edge Function de Supabase.
 */
const SUPABASE_CONFIG = {

  /* Se enciende cuando el backend esté listo y probado. Con false, el
     sistema no intenta ninguna conexión remota. */
  HABILITADO: false,

  /* Pegar acá los dos valores del panel de Supabase:
     Project Settings -> API -> Project URL y anon public. */
  URL: '',
  ANON_KEY: '',

  /* Nombre del esquema. Se usa uno propio en vez de `public` para que las
     tablas del WMS no se mezclen con las que Supabase crea por su cuenta. */
  ESQUEMA: 'wms',

  /* Tablas. Los nombres se declaran acá y no sueltos por el código, para
     que renombrar una tabla sea un cambio en un solo lugar. */
  TABLAS: {
    usuarios: 'usuarios',
    pallets: 'pallets',
    movimientos: 'movimientos',
    despachos: 'despachos',
    inventarios: 'inventarios',
    inventario_items: 'inventario_items',
    bitacora: 'bitacora',
    verificaciones: 'verificaciones',
    aprobaciones: 'aprobaciones',
    comunicados: 'comunicados',
    etiquetas: 'etiquetas_impresas',
    mapa_estado: 'mapa_estado'
  },

  /* Cuánto espera una llamada antes de darse por perdida. En cámara la
     señal es mala: conviene fallar rápido y seguir con la cola offline,
     que ya existe, antes que dejar al operador esperando. */
  TIMEOUT_MS: 8000,

  /* Reintentos con espera creciente para errores de red, nunca para
     errores de permiso: si la base dice que no, no se insiste. */
  REINTENTOS: 2,

  /** ¿Está todo lo necesario para intentar conectar? */
  listo() {
    return Boolean(this.HABILITADO && this.URL && this.ANON_KEY);
  },

  /** Diagnóstico legible, para mostrar en pantalla o en la bitácora. */
  diagnostico() {
    if (!this.HABILITADO) return 'Backend deshabilitado: el sistema trabaja con datos locales.';
    if (!this.URL) return 'Falta la URL del proyecto de Supabase.';
    if (!this.ANON_KEY) return 'Falta la clave anon del proyecto de Supabase.';
    return 'Configuración de Supabase completa.';
  }
};
