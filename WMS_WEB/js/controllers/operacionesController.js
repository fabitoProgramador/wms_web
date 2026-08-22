/**
 * Fachada de navegación de Operaciones.
 * Toda consulta/acción de negocio vive en OperacionesBackendController.
 * Se conserva este nombre únicamente porque AppController lo usa como punto
 * estable de entrada; no contiene estado local ni reglas de negocio.
 */
const OperacionesController = {
  initMovimientos(container) { return OperacionesBackendController.initMovimientos(container); },
  initDespacho(container) { return OperacionesBackendController.initDespacho(container); },
  initAprobaciones(container) { return OperacionesBackendController.initAprobaciones(container); }
};
