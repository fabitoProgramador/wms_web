/**
 * Puente de navegación temporal.
 *
 * Bitácora y Registro de Verificaciones ya no contienen lógica de negocio en
 * este archivo ni consumen PanelControlModel/localStorage. Se mantiene el
 * nombre BitacoraController únicamente porque AppController todavía lo usa
 * como punto de entrada durante la migración por fases.
 */
const BitacoraController = {
  initBitacora(container) {
    return BitacoraOperativaController.init(container);
  },

  initVerificaciones(container) {
    return VerificacionesController.init(container);
  }
};
