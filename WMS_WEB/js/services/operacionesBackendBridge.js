/**
 * Puente temporal de navegación para Operaciones.
 *
 * AppController conserva todavía llamadas históricas a OperacionesController.
 * En esta fase no se reescribe el shell completo: se reemplazan únicamente
 * los tres puntos de entrada ya migrados para que siempre terminen en la capa
 * remota. El controlador/modelo legacy permanecen cargados hasta la limpieza
 * final de dependencias, pero estas vistas ya no los usan como fuente WMS.
 */
const OperacionesBackendBridge = {
  instalado:false,

  install() {
    if (this.instalado) return;
    if (typeof OperacionesController === 'undefined' || typeof OperacionesBackendController === 'undefined') {
      throw new Error('No fue posible instalar el puente remoto de Operaciones.');
    }

    OperacionesController.initMovimientos = container => OperacionesBackendController.initMovimientos(container);
    OperacionesController.initDespacho = container => OperacionesBackendController.initDespacho(container);
    OperacionesController.initAprobaciones = container => OperacionesBackendController.initAprobaciones(container);

    this.instalado = true;
  }
};
