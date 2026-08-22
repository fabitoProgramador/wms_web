/**
 * Packing List de Andén.
 * El frontend sólo da formato. Clasificación, subtotales y totales generales
 * provienen de wms_anden_packing en Supabase.
 */
const AndenPackingService = Object.create(AndenController);

AndenPackingService.classLabel = function(value) {
  const key = String(value || 'SIN_CLASIFICAR').toUpperCase();
  if (key === 'ORGANICO') return 'ORGÁNICO';
  if (key === 'CONVENCIONAL') return 'CONVENCIONAL';
  if (key === 'AMBIGUA') return 'AMBIGUA';
  return 'SIN CLASIFICAR';
};

AndenPackingService.packingModel = function(record) {
  const raw = Array.isArray(record?.pallets) ? record.pallets : [];
  const summary = record?.resumen_packing || {};
  const backendGroups = Array.isArray(summary.grupos) ? summary.grupos : [];

  const items = raw.map((p, index) => ({
    numero: index + 1,
    id: String(p.id_lote || ''),
    sku: String(p.articulo || ''),
    descripcion: String(p.descripcion || 'Sin descripción SAP disponible'),
    kilos: p.kilos == null ? 0 : Number(p.kilos) || 0,
    cajas: p.cajas == null ? 0 : Number(p.cajas) || 0,
    fecha: p.fecha_fabricacion || '—',
    calidad: String(p.estado_calidad || p.estado_sap || '—'),
    infoCalidad: String(p.info_calidad ?? ''),
    infoGeneral: String(p.info_general ?? ''),
    dm: p.dm == null || String(p.dm).trim() === '' ? '—' : String(p.dm),
    reserva: p.reservado == null || String(p.reservado).trim() === '' ? '—' : String(p.reservado),
    clasificacion: String(p.clasificacion_origen || 'SIN_CLASIFICAR').toUpperCase()
  }));

  const groups = {};
  backendGroups.forEach(group => {
    const classKey = String(group.clasificacion || 'SIN_CLASIFICAR').toUpperCase();
    const label = this.classLabel(classKey);
    const bySku = new Map();
    (group.articulos || []).forEach(article => {
      const sku = String(article.articulo || '');
      const articleItems = items.filter(item => item.clasificacion === classKey && item.sku === sku);
      bySku.set(sku, {
        descripcion: article.descripcion || articleItems[0]?.descripcion || 'Sin descripción SAP disponible',
        items: articleItems,
        kilos: Number(article.subtotal_kilos || 0),
        cajas: Number(article.subtotal_cajas || 0),
        pallets: Number(article.pallets || articleItems.length)
      });
    });
    groups[label] = bySku;
  });

  // El contrato remoto siempre trae grupos. Si una versión antigua del RPC no
  // los entrega, se bloquea el cálculo silencioso: no se inventan subtotales.
  if (!backendGroups.length && items.length) {
    const bySku = new Map();
    items.forEach(item => {
      if (!bySku.has(item.sku)) bySku.set(item.sku, { descripcion: item.descripcion, items: [], kilos: 0, cajas: 0, pallets: 0 });
      bySku.get(item.sku).items.push(item);
    });
    groups['SIN CLASIFICAR'] = bySku;
  }

  const total = summary.total_general || {};
  return {
    info: this.packingInfo(record),
    headers: ['N°', 'ID LOTE', 'N° ARTÍCULO', 'DESCRIPCIÓN DEL ARTÍCULO', 'KG (NETO)', 'CAJAS', 'FECHA FABRICACIÓN', 'EST CALIDAD', 'INFO. CALIDAD', 'INFO. GENERAL', 'DM', 'RESERVA'],
    items,
    groups,
    totals: {
      pallets: Number(total.pallets ?? items.length),
      kilos: Number(total.kilos ?? 0),
      cajas: Number(total.cajas ?? 0)
    },
    alerts: summary.alertas_clasificacion || {}
  };
};
