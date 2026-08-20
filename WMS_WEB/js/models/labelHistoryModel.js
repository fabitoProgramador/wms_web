/**
 * Historial de impresión del Centro de Etiquetas.
 *
 * Aislado a propósito en su propio modelo: no toca ni extiende los modelos de
 * pallets, stock o mapa. Sólo guarda los trabajos de etiqueta que el módulo
 * genera, para poder responder tres preguntas operacionales:
 *   1. ¿esta etiqueta ya se imprimió antes de volver a imprimirla?
 *   2. ¿quién la imprimió, cuándo y cuántas copias?
 *   3. ¿la etiqueta se emitió anticipada y el pallet ya apareció consolidado?
 */
const LabelHistoryModel = {
  KEY: 'wms_web_historial_etiquetas',

  all() { try { return JSON.parse(localStorage.getItem(this.KEY) || '[]'); } catch (_) { return []; } },
  save(entries) { localStorage.setItem(this.KEY, JSON.stringify(entries.slice(-500))); },

  /** Trabajos de un lote, del más reciente al más antiguo. */
  forLot(lotCode) { const code = String(lotCode || ''); return this.all().filter(x => x.lotCode === code).reverse(); },
  /** Copias acumuladas ya emitidas para ese lote. */
  copiesFor(lotCode) { return this.forLot(lotCode).reduce((total, x) => total + (Number(x.copies) || 0), 0); },
  /**
   * Registra un trabajo. La primera vez es 'inicial'; de ahí en adelante,
   * 'reimpresion'. Esa distinción es la que permite avisar al operador antes
   * de volver a imprimir una etiqueta que ya salió.
   */
  record(label, copies, extra = {}) {
    const entries = this.all();
    const previous = entries.filter(x => x.lotCode === label.lotCode).length;
    const entry = {
      id: `ETQ-${String(entries.length + 1).padStart(4, '0')}`,
      fecha: new Date().toLocaleString('es-CL'),
      timestamp: Date.now(),
      lotCode: label.lotCode,
      articleCode: label.articleCode,
      articleDescription: label.articleDescription,
      reference: label.reference || label.lotCode,
      copies: Number(copies) || 0,
      kind: previous ? 'reimpresion' : 'inicial',
      source: label.source || 'pallet',
      consolidated: extra.consolidated === true,
      result: extra.result || 'preparada',
      formato: extra.formato || null,
      dpi: extra.dpi || null,
      destino: extra.destino || null,
      usuario: (typeof UserModel !== 'undefined' && (UserModel.getCurrentUser() || {}).name) || 'Usuario WMS'
    };
    entries.push(entry);
    this.save(entries);
    return entry;
  },

  /**
   * Reconciliación de etiquetas anticipadas (punto 11 del contrato).
   * Cuando un lote impreso antes de la consolidación ya aparece consolidado,
   * se marca como tal y se conserva como impresa: NO se vuelve a imprimir.
   * Si los datos maestros no coinciden con los anticipados, queda señalado
   * para revisión en vez de sobrescribirse en silencio.
   */
  reconcile(resolveLot) {
    if (typeof resolveLot !== 'function') return { revisados: 0, consolidados: 0, discrepancias: 0 };
    const entries = this.all();
    let consolidados = 0, discrepancias = 0, revisados = 0;
    entries.forEach(entry => {
      if (entry.source !== 'anticipated' || entry.consolidated) return;
      revisados++;
      const actual = resolveLot(entry.lotCode);
      if (!actual) return;
      const mismoArticulo = String(actual.articleCode || '') === String(entry.articleCode || '');
      const mismaDescripcion = String(actual.articleDescription || '') === String(entry.articleDescription || '');
      entry.consolidated = true;
      if (mismoArticulo && mismaDescripcion) { entry.result = 'impresa'; consolidados++; }
      else { entry.result = 'revisar'; entry.discrepancia = `Anticipada: ${entry.articleCode} · ${entry.articleDescription}. Consolidada: ${actual.articleCode} · ${actual.articleDescription}.`; discrepancias++; }
    });
    if (revisados) this.save(entries);
    return { revisados, consolidados, discrepancias };
  },

  clear() { localStorage.removeItem(this.KEY); }
};
