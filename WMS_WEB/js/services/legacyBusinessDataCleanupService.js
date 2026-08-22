/**
 * Migración única de datos locales de negocio obsoletos.
 *
 * NO toca snapshots/colas offline (Mapa, Gruero, Inventario, Etiquetas),
 * preferencias UI, sesión Auth ni configuración de impresora. Sólo elimina
 * las antiguas claves que actuaban como una segunda base de datos WMS.
 */
const LegacyBusinessDataCleanupService = {
  VERSION_KEY: 'wms_web_business_cleanup_version',
  VERSION: '2026-08-backend-authoritative-1',
  BUSINESS_KEYS: [
    'wms_web_db_pallets',
    'wms_web_db_pallets_schema',
    'wms_web_mapa_letters',
    'wms_web_mapa_released_articles',
    'wms_web_mapa_loads',
    'wms_web_mapa_directories',
    'wms_web_panel_bitacoras',
    'wms_web_panel_bitacoras_schema',
    'wms_web_panel_verificaciones',
    'wms_web_panel_verificaciones_schema',
    'wms_web_historial_aprobaciones',
    'wms_web_historial_etiquetas'
  ],
  purge() {
    try {
      if (localStorage.getItem(this.VERSION_KEY) === this.VERSION) return 0;
      let removed = 0;
      this.BUSINESS_KEYS.forEach(key => {
        if (localStorage.getItem(key) !== null) { localStorage.removeItem(key); removed += 1; }
      });
      localStorage.setItem(this.VERSION_KEY, this.VERSION);
      return removed;
    } catch (_) { return 0; }
  }
};
