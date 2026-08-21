/**
 * Contrato de conexión WMS_WEB -> Supabase.
 *
 * IMPORTANTE
 * --------------------------------------------------------------------
 * HABILITADO permanece en false durante la migración por secciones.
 * Mientras siga así, el frontend conserva el funcionamiento local actual.
 * Las vistas se conectarán una a una al backend real y recién después se
 * habilitará el modo remoto de forma global.
 *
 * La clave publishable es pública por diseño y puede vivir en el navegador.
 * NUNCA colocar service_role ni secretos administrativos en este repositorio.
 */
const SUPABASE_CONFIG = {
  HABILITADO: false,

  // Proyecto real del WMS. Dejar estos cimientos configurados no activa nada
  // mientras HABILITADO sea false.
  URL: 'https://tbcgkpjhjymwyhuobpqy.supabase.co',
  PUBLISHABLE_KEY: 'sb_publishable_PoFNqdz0IbA2zeQ-q6urHQ_-M5Bje0h',

  // El backend real expone sus RPC WMS desde public.
  ESQUEMA: 'public',

  /**
   * Registro central de contratos del backend.
   * Cada controlador deberá usar estos nombres y no escribir RPCs sueltos.
   * Se irán utilizando sección por sección a medida que se migre la UI.
   */
  RPC: {
    auth: {
      sesionActual: 'wms_sesion_actual',
      tienePermiso: 'wms_tiene_permiso'
    },
    dashboard: {
      resumen: 'wms_dashboard_resumen',
      estadoDetalle: 'wms_dashboard_estado_detalle',
      analisis: 'wms_analisis_operacional',
      monitorResumen: 'wms_monitor_resumen',
      monitorEventos: 'wms_monitor_eventos'
    },
    stock: {
      detalle: 'wms_stock_detalle',
      loteDetallado: 'wms_lote_detallado',
      resumenArticulos: 'wms_stock_resumen_articulos',
      resumenCamaras: 'wms_stock_resumen_camaras',
      resumenEstados: 'wms_stock_resumen_estados',
      exportar: 'wms_stock_exportar'
    },
    mapa: {
      snapshot: 'wms_mapa_snapshot',
      resolverCodigo: 'wms_mapa_resolver_codigo',
      sincronizarOperacion: 'wms_mapa_sincronizar_operacion',
      inventarioCamara: 'wms_mapa_inventario_camara'
    },
    gruero: {
      resolverCodigo: 'wms_gruero_resolver_codigo',
      banda: 'wms_gruero_banda',
      sincronizarMovimiento: 'wms_gruero_sincronizar_movimiento'
    },
    inventario: {
      iniciar: 'wms_iniciar_inventario',
      sesion: 'wms_inventario_sesion',
      sesiones: 'wms_inventario_sesiones',
      activo: 'wms_inventario_activo',
      resolverCodigo: 'wms_inventario_resolver_codigo',
      detalleActual: 'wms_inventario_detalle_actual',
      sincronizarOperacion: 'wms_inventario_sincronizar_operacion',
      cerrar: 'wms_cerrar_inventario'
    },
    operaciones: {
      movimientos: 'wms_operaciones_movimientos_listar',
      resolverCodigos: 'wms_operaciones_resolver_codigos',
      aplicarPedido: 'wms_operaciones_pedido_aplicar',
      aplicarDespacho: 'wms_operaciones_despacho_aplicar',
      aprobaciones: 'wms_operaciones_aprobaciones_listar',
      decidirAprobacion: 'wms_operaciones_aprobacion_decidir',
      reclasificar: 'wms_operaciones_reclasificar'
    },
    anden: {
      cargaActual: 'wms_anden_carga_actual',
      agregarPallet: 'wms_anden_carga_agregar_pallet',
      quitarPallet: 'wms_anden_carga_quitar_pallet',
      actualizar: 'wms_anden_carga_actualizar',
      despachar: 'wms_anden_carga_despachar',
      catalogos: 'wms_anden_catalogos',
      historial: 'wms_anden_historial'
    },
    bitacora: {
      listar: 'wms_bitacora_listar',
      detalle: 'wms_bitacora_detalle',
      pendientes: 'wms_bitacora_pendientes',
      precarga: 'wms_bitacora_precarga',
      crear: 'wms_crear_bitacora',
      modificar: 'wms_modificar_bitacora',
      anular: 'wms_anular_bitacora'
    },
    verificaciones: {
      listar: 'wms_verificaciones_listar',
      detalle: 'wms_verificacion_detalle',
      resolverLote: 'wms_verificacion_resolver_lote',
      crear: 'wms_crear_verificacion',
      modificar: 'wms_modificar_verificacion',
      anular: 'wms_anular_verificacion'
    },
    reportes: {
      catalogos: 'wms_reportes_catalogos',
      compilar: 'wms_reportes_compilar',
      stockListar: 'wms_reportes_stock_listar',
      stockExportar: 'wms_reportes_stock_exportar',
      valoresFiltro: 'wms_reportes_stock_valores_filtro'
    },
    etiquetas: {
      resolver: 'wms_etiqueta_resolver',
      produccion: 'wms_etiquetas_produccion',
      historial: 'wms_etiquetas_historial',
      registrarImpresion: 'wms_etiquetas_registrar_impresion'
    },
    usuarios: {
      administrar: 'wms_usuarios_administracion',
      historial: 'wms_usuario_admin_historial'
    }
  },

  TIMEOUT_MS: 8000,
  REINTENTOS: 2,
  SESSION_STORAGE_KEY: 'wms_web_supabase_session_v1',

  listo() {
    return Boolean(this.HABILITADO && this.URL && this.PUBLISHABLE_KEY);
  },

  rpc(grupo, nombre) {
    return this.RPC?.[grupo]?.[nombre] || null;
  },

  diagnostico() {
    if (!this.HABILITADO) return 'Backend preparado pero deshabilitado: el sistema continúa en modo local.';
    if (!this.URL) return 'Falta la URL del proyecto de Supabase.';
    if (!this.PUBLISHABLE_KEY) return 'Falta la clave pública del proyecto de Supabase.';
    return 'Configuración de Supabase completa.';
  }
};
