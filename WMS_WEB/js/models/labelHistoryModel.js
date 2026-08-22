/**
 * Fachada de historial del Centro de Etiquetas.
 *
 * Ya no existe una base local `wms_web_historial_etiquetas`. El listado visible
 * proviene del historial Supabase guardado en el snapshot offline explícito;
 * una impresión sin red se muestra de forma optimista y se sincroniza después.
 */
const LabelHistoryModel = {
  all() { return typeof LabelService === 'undefined' ? [] : LabelService.history(); },
  forLot(lotCode) {
    const code = String(lotCode || '');
    return this.all().filter(x => String(x.lotCode || '') === code).sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));
  },
  copiesFor(lotCode) {
    return this.forLot(lotCode)
      .filter(x => x.destino !== 'no-impresa')
      .reduce((total, x) => total + (Number(x.copies) || 0), 0);
  },
  record(label, copies, extra = {}) {
    const entry = LabelService.optimisticHistory(label, copies, extra);
    LabelService.recordPrint(label, copies, extra).catch(() => {});
    return entry;
  },
  reconcile() { return LabelService.reconciliation(); },
  clear() { /* El historial auditado no se elimina desde el navegador. */ }
};
