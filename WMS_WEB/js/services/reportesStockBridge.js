/**
 * Puente temporal mientras Generar Reporte sigue en ReportesController legacy.
 * Visualizar Stock queda exclusivamente en ReportesStockController/Supabase.
 */
const ReportesStockBridge = {
  install() {
    if (typeof ReportesController === 'undefined' || typeof ReportesStockController === 'undefined') return false;
    ReportesController.initVisualizarStock = container => ReportesStockController.init(container);
    return true;
  }
};

ReportesStockBridge.install();
