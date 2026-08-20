/**
 * Formatos de etiqueta y destino de impresión del Centro de Etiquetas.
 *
 * Aislado a propósito: la vista no sabe de milímetros ni de impresoras, y el
 * futuro adaptador Zebra no necesita conocer la vista. Aquí vive lo único que
 * ambos comparten: qué tamaño de etiqueta se va a emitir y con qué destino.
 *
 * Sobre el problema del destino (el mismo que ocurre en SAP): un navegador no
 * puede elegir la impresora física, siempre usa la predeterminada del sistema,
 * y por eso un trabajo termina saliendo en la fotocopiadora. La salida
 * definitiva NO debe pasar por el diálogo de impresión del navegador: el
 * adaptador Zebra enviará ZPL directo a la impresora por su nombre o IP. Esa
 * configuración se guarda desde ya, para que conectarla no obligue a rehacer
 * la vista ni a reconfigurar los formatos.
 */
const LabelFormatService = {
  KEY: 'wms_web_config_etiquetas',

  /** Tamaños de rollo habituales, en milímetros (ancho × alto). */
  FORMATS: [
    { id: '100x50', label: '100 × 50 mm', w: 100, h: 50, nota: 'Formato actual de planta' },
    { id: '100x60', label: '100 × 60 mm', w: 100, h: 60, nota: '' },
    { id: '100x75', label: '100 × 75 mm', w: 100, h: 75, nota: '' },
    { id: '100x100', label: '100 × 100 mm', w: 100, h: 100, nota: '' },
    { id: '100x150', label: '100 × 150 mm', w: 100, h: 150, nota: 'Despacho' },
    { id: '100x200', label: '100 × 200 mm', w: 100, h: 200, nota: '' },
    { id: '102x152', label: '102 × 152 mm', w: 102, h: 152, nota: '4 × 6 pulgadas' },
    { id: '76x51', label: '76 × 51 mm', w: 76, h: 51, nota: '3 × 2 pulgadas' },
    { id: '57x32', label: '57 × 32 mm', w: 57, h: 32, nota: '' },
    { id: '50x25', label: '50 × 25 mm', w: 50, h: 25, nota: 'Etiqueta chica' },
    { id: '40x30', label: '40 × 30 mm', w: 40, h: 30, nota: '' }
  ],

  /**
   * Modelos Zebra habituales con las resoluciones de cabezal en que se
   * fabrican. El DPI deja de escribirse a mano: se toma del modelo.
   *
   * Sobre la detección automática: una página web NO puede preguntarle nada
   * a la impresora, así que desde aquí lo más fiable es deducir el DPI del
   * modelo. La detección real la hará el adaptador cuando exista, porque las
   * Zebra Link-OS responden consultas SGD sobre la resolución del cabezal;
   * hasta entonces, elegir el modelo cubre el caso sin adivinar.
   */
  PRINTERS: [
    { id: 'generica', label: 'Genérica / otra', dpis: [203, 300, 600], dpi: 203 },
    { id: 'zd220', label: 'Zebra ZD220 / ZD230', dpis: [203], dpi: 203 },
    { id: 'zd421', label: 'Zebra ZD421', dpis: [203, 300], dpi: 203 },
    { id: 'zd621', label: 'Zebra ZD621', dpis: [203, 300], dpi: 203 },
    { id: 'gk420', label: 'Zebra GK420 / GX420', dpis: [203], dpi: 203 },
    { id: 'gx430', label: 'Zebra GX430', dpis: [300], dpi: 300 },
    { id: 'zt230', label: 'Zebra ZT230', dpis: [203, 300], dpi: 203 },
    { id: 'zt411', label: 'Zebra ZT411', dpis: [203, 300, 600], dpi: 203 },
    { id: 'zt421', label: 'Zebra ZT421', dpis: [203, 300], dpi: 203 },
    { id: '105sl', label: 'Zebra 105SL Plus', dpis: [203, 300], dpi: 203 }
  ],

  /** Fondo del material del rollo. La planta usa amarillo hoy. */
  STOCKS: [
    { id: 'amarillo', label: 'Amarillo', bg: '#f4ea00', fg: '#050505' },
    { id: 'blanco', label: 'Blanco', bg: '#ffffff', fg: '#050505' }
  ],

  /**
   * Los dos caminos de salida, a propósito redundantes: si uno no está
   * disponible el otro sigue imprimiendo. Ninguno depende del otro.
   *
   *  auto   → ZPL directo a la Zebra por Browser Print. Es el rápido y el
   *           que ignora la impresora predeterminada del equipo. Necesita
   *           que Browser Print esté instalado en ese PC.
   *  manual → diálogo de impresión del sistema. El usuario ve la lista de
   *           impresoras instaladas en Windows, elige la Zebra a mano y
   *           acepta. No necesita instalar nada, pero sale por el driver
   *           de Windows (gráfico) y no como ZPL.
   *
   * En 'auto', si Browser Print no responde se cae solo al manual: el
   * operador nunca queda sin poder imprimir.
   */
  OUTPUTS: [
    { id: 'auto', label: 'Automática · Zebra directa', nota: 'ZPL por Browser Print, con respaldo manual' },
    { id: 'manual', label: 'Manual · diálogo de Windows', nota: 'Elegir la impresora en la lista del sistema' }
  ],

  DEFAULTS: { format: '100x50', model: 'generica', dpi: 203, dpiAuto: true, stock: 'amarillo', printer: '', salida: 'auto' },

  config() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(this.KEY) || '{}'); } catch (_) { saved = {}; }
    return { ...this.DEFAULTS, ...saved };
  },
  save(patch) {
    const next = { ...this.config(), ...patch };
    localStorage.setItem(this.KEY, JSON.stringify(next));
    return next;
  },

  format(id) { return this.FORMATS.find(f => f.id === (id || this.config().format)) || this.FORMATS[0]; },
  printerModel(id) { return this.PRINTERS.find(x => x.id === (id || this.config().model)) || this.PRINTERS[0]; },
  /** DPI efectivo: del modelo si está en automático, o el elegido a mano. */
  dpi(cfg = this.config()) {
    const model = this.printerModel(cfg.model);
    if (cfg.dpiAuto !== false) return model.dpi;
    return model.dpis.includes(Number(cfg.dpi)) ? Number(cfg.dpi) : model.dpi;
  },
  /** Zebra trabaja en puntos por milímetro; 203 dpi = 8 dots/mm. */
  dotsPerMm(dpi) { return Math.round((dpi / 25.4) * 100) / 100; },
  stock(id) { return this.STOCKS.find(s => s.id === (id || this.config().stock)) || this.STOCKS[0]; },
  /** Variables CSS que dimensionan y colorean la previsualización. */
  cssVars(cfg = this.config()) {
    const f = this.format(cfg.format), s = this.stock(cfg.stock);
    return `--label-w:${f.w};--label-h:${f.h};--label-bg:${s.bg};--label-fg:${s.fg}`;
  },

  /**
   * Contrato que recibirá el adaptador Zebra. Se arma acá para que el día que
   * se conecte la impresora no haya que tocar el controlador ni la vista.
   */
  printJob(label, copies, cfg = this.config()) {
    const f = this.format(cfg.format);
    return {
      lotCode: label.lotCode,
      barcodeValue: label.barcodeValue || label.lotCode,
      symbology: label.symbology,
      copies,
      widthMm: f.w,
      heightMm: f.h,
      dpi: this.dpi(cfg),
      dotsPerMm: this.dotsPerMm(this.dpi(cfg)),
      model: cfg.model,
      stock: cfg.stock,
      printer: cfg.printer || null,
      salida: cfg.salida || 'auto',
      transport: (cfg.salida === 'manual') ? 'dialogo-sistema' : 'zebra-directo'
    };
  }
};
