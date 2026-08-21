/** Rutas y secciones del WMS_WEB. */
const SECCIONES = [
  { id: 'dashboard', titulo: 'Resumen Ejecutivo', categoria: 'Panel de Control', icono: '📊' },
  { id: 'graficos', titulo: 'Análisis Operacional', categoria: 'Panel de Control', icono: '📈' },
  { id: 'monitor_tiempo_real', titulo: 'Monitor en Tiempo Real', categoria: 'Panel de Control', icono: '🔴' },

  { id: 'movimientos', titulo: 'Movimientos de Cámara', categoria: 'Operaciones', icono: '🔄' },
  { id: 'despacho', titulo: 'Despacho y Reproceso', categoria: 'Operaciones', icono: '🚚' },
  { id: 'aprobaciones', titulo: 'Gestión de Aprobaciones', categoria: 'Operaciones', icono: '✅' },
  // Registros operacionales remotos. `permiso` controla visibilidad de lectura;
  // las acciones internas verifican sus permisos registrar/modificar/eliminar.
  { id: 'bitacora', titulo: 'Bitácora', categoria: 'Operaciones', icono: '📓', permiso: 'bitacora.ver' },
  { id: 'registro_verificaciones', titulo: 'Registro de Verificaciones', categoria: 'Operaciones', icono: '🧪', permiso: 'verificaciones.ver' },
  { id: 'centro_etiquetas', titulo: 'Centro de Etiquetas', categoria: 'Operaciones', icono: '🏷️' },

  { id: 'stock_planta', titulo: 'Stock en Planta', categoria: 'Stock y Lotes', icono: '📦' },
  { id: 'lote_detallado', titulo: 'Lote Detallado', categoria: 'Stock y Lotes', icono: '🔍' },
  { id: 'generar_reporte', titulo: 'Generar Reporte', categoria: 'Reportes Operacionales', icono: '📄' },
  { id: 'visualizar_stock', titulo: 'Visualizar Stock', categoria: 'Reportes Operacionales', icono: '👁️' },
  { id: 'mapa_vista', titulo: 'Cámara Proter', categoria: 'Mapa de Cámara', icono: '🏭' },
  { id: 'mapa_postunel', titulo: 'Cámara Post Túnel', categoria: 'Mapa de Cámara', icono: '🧊' },
  { id: 'mapa_codigo', titulo: 'Agregar Código a Mapa', categoria: 'Mapa de Cámara', icono: '➕' },
  { id: 'inventario', titulo: 'Inventario de Cámara', categoria: 'Mapa de Cámara', icono: '📋' },
  { id: 'anden_carga', titulo: 'Andén de Carga', categoria: 'Mapa de Cámara', icono: '🏗️' },
  { id: 'administracion', titulo: 'Administración de Usuarios', categoria: 'Configuración', icono: '⚙️' }
];

// Operaciones especiales visibles según rol/permisos actuales del shell.
SECCIONES.splice(8, 0, { id: 'gruero', titulo: 'Operación Gruero', categoria: 'Operaciones', icono: '🏗️', roles: ['GRUERO', 'ADMIN', 'PLANT_MANAGER'] });
SECCIONES.splice(9, 0, { id: 'operacion_inventario', titulo: 'Operación Inventario', categoria: 'Operaciones', icono: '▣', roles: ['GRUERO', 'ADMIN', 'PLANT_MANAGER'] });
