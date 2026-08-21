/**
 * Puente de compatibilidad de navegación para el módulo Stock.
 * La lógica real vive en controladores remotos por submenú.
 */
const StockController = {
  initStockPlanta(container) { return StockPlantaController.init(container); },
  initLoteDetallado(container) { return LoteDetalladoController.init(container); }
};
