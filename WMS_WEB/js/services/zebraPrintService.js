/**
 * Adaptador de impresión Zebra.
 *
 * POR QUÉ EXISTE
 * Una página web no puede ver las impresoras del sistema operativo: no hay API
 * de navegador que las liste, y todo lo que pasa por el diálogo de impresión
 * termina en la impresora predeterminada del equipo. Ese es exactamente el
 * problema que se sufre hoy (un trabajo termina saliendo en la fotocopiadora).
 *
 * CÓMO SE RESUELVE
 * Zebra publica "Browser Print": una aplicación pequeña que se instala en el
 * PC y queda escuchando en 127.0.0.1:9100 (y :9101 para HTTPS). Hace de puente
 * entre el JavaScript de la página y las impresoras Zebra del equipo, tanto
 * USB como de red. Con ella la página puede:
 *   - descubrir la impresora conectada y tomar la predeterminada;
 *   - preguntarle su configuración, incluida la resolución del cabezal;
 *   - enviarle ZPL crudo, sin pasar por el diálogo ni por la predeterminada.
 *
 * Este servicio habla ese protocolo por HTTP directo, sin depender del SDK
 * BrowserPrint.js, para no sumar un archivo externo al proyecto. Si Browser
 * Print no está instalado, todo degrada a previsualización y el módulo sigue
 * funcionando igual.
 */
const ZebraPrintService = {
  BASES: ['http://127.0.0.1:9100', 'https://127.0.0.1:9101'],
  base: null,
  device: null,
  available: false,
  lastError: '',

  /** ¿Está corriendo Browser Print en este equipo? */
  async detect() {
    for (const base of this.BASES) {
      try {
        const res = await fetch(`${base}/available`, { method: 'GET', mode: 'cors' });
        if (!res.ok) continue;
        this.base = base;
        this.available = true;
        this.lastError = '';
        return true;
      } catch (_) { /* se prueba la siguiente base */ }
    }
    this.available = false;
    this.base = null;
    this.lastError = 'No se detectó Zebra Browser Print en este equipo.';
    return false;
  },

  /** Impresoras Zebra visibles para el equipo (USB y red). */
  async devices() {
    if (!this.available && !(await this.detect())) return [];
    try {
      const res = await fetch(`${this.base}/available`, { method: 'GET', mode: 'cors' });
      const data = await res.json();
      // Browser Print devuelve formas distintas segun version; se normaliza.
      const list = Array.isArray(data) ? data : (data.printer || data.devices || []);
      return list.filter(Boolean);
    } catch (error) { this.lastError = String(error.message || error); return []; }
  },

  /** Impresora predeterminada del equipo según Browser Print. */
  async defaultDevice() {
    if (!this.available && !(await this.detect())) return null;
    try {
      const res = await fetch(`${this.base}/default?type=printer`, { method: 'GET', mode: 'cors' });
      const data = await res.json();
      this.device = data && (data.uid || data.name) ? data : null;
      return this.device;
    } catch (error) {
      this.lastError = String(error.message || error);
      const list = await this.devices();
      this.device = list[0] || null;
      return this.device;
    }
  },

  /**
   * Resolución real del cabezal, preguntándosela a la impresora.
   * Las Zebra Link-OS responden consultas SGD; head.resolution vuelve en
   * puntos por milímetro (8, 12 o 24) o directamente en dpi según modelo.
   */
  async readResolution(device = this.device) {
    if (!device || !this.base) return null;
    try {
      const res = await fetch(`${this.base}/read`, {
        method: 'POST', mode: 'cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device, data: '! U1 getvar "head.resolution"\r\n' })
      });
      const texto = String(await res.text()).replace(/["\s]/g, '');
      const valor = Number(texto);
      if (!Number.isFinite(valor) || !valor) return null;
      const porMm = { 8: 203, 12: 300, 24: 600 };
      if (porMm[valor]) return porMm[valor];
      return [203, 300, 600].includes(valor) ? valor : null;
    } catch (error) { this.lastError = String(error.message || error); return null; }
  },

  /** Envía ZPL crudo. No usa el diálogo del navegador ni la predeterminada. */
  async send(zpl, device = this.device) {
    if (!device || !this.base) return { ok: false, error: this.lastError || 'Sin impresora Zebra conectada.' };
    try {
      const res = await fetch(`${this.base}/write`, {
        method: 'POST', mode: 'cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device, data: zpl })
      });
      if (!res.ok) return { ok: false, error: `La impresora respondió ${res.status}.` };
      return { ok: true };
    } catch (error) { return { ok: false, error: String(error.message || error) }; }
  },

  /**
   * Ancho en puntos que ocupará el código de barras. Se calcula de verdad
   * porque de él dependen el módulo y el centrado: si se estima mal, el
   * código se sale de la etiqueta y la impresora lo recorta.
   *   Code 39  -> 16 módulos por carácter (6 estrechas + 3 anchas + espacio),
   *               más los dos asteriscos centinela.
   *   Code 128 -> 11 módulos por carácter, más inicio, chequeo y fin.
   */
  barcodeModules(value, symbology) {
    const n = String(value || '').length;
    return symbology === 'CODE39' ? (n + 2) * 16 - 1 : (n + 3) * 11 + 2;
  },

  /**
   * Ajusta el código al ancho útil. Code 39 es muy ancho: un ID de lote de 12
   * dígitos necesita ~670 puntos a 203 dpi, así que no entra en rollos chicos
   * (50×25 o 40×30). En ese caso se pasa a Code 128, que es bastante más
   * denso y codifica exactamente el mismo ID. Nunca se baja el módulo de 2
   * puntos: por debajo de eso el lector deja de leer con fiabilidad.
   * Si ni así entra, se avisa en vez de emitir una etiqueta recortada.
   */
  fitBarcode(value, symbology, util) {
    const MIN = 2, MAX = 6;
    const candidatos = symbology === 'CODE39' ? ['CODE39', 'CODE128'] : ['CODE128', 'CODE39'];
    for (const simbologia of candidatos) {
      const modulos = this.barcodeModules(value, simbologia);
      const modulo = Math.min(MAX, Math.floor(util / modulos));
      if (modulo >= MIN) return { simbologia, modulo, ancho: modulos * modulo, ok: true, cambiada: simbologia !== symbology };
    }
    const modulos = this.barcodeModules(value, 'CODE128');
    return { simbologia: 'CODE128', modulo: MIN, ancho: modulos * MIN, ok: false, cambiada: symbology !== 'CODE128' };
  },

  /**
   * Etiqueta en ZPL. Todo se calcula en puntos desde los milímetros del
   * formato y el DPI real, así que el mismo código sirve para 100×50,
   * 100×150 o cualquier otro rollo. Las coordenadas ZPL son enteras: un
   * decimal invalida el comando y la impresora ignora el campo.
   */
  toZpl(job, label) {
    const dots = mm => Math.round(mm * (job.dpi / 25.4));
    const W = dots(job.widthMm), H = dots(job.heightMm);
    const margen = Math.round(W * 0.05);
    const util = W - margen * 2;
    const colValor = margen + Math.round(util * 0.34);
    const anchoValor = W - colValor - margen;

    // Vertical resuelto de arriba hacia abajo, sin fracciones sueltas.
    const tTitulo = Math.round(H * 0.16), tTexto = Math.round(H * 0.072);
    const yTitulo = Math.round(H * 0.06);
    const y1 = Math.round(H * 0.30);
    const salto = Math.round(H * 0.095);
    const y2 = y1 + salto;                 // descripción, puede ocupar 2 líneas
    const y3 = y1 + salto * 3;             // lote, después de esas 2 líneas
    const altoBarras = Math.round(H * 0.20);
    const yBarras = y3 + Math.round(salto * 0.85);

    // Simbología y módulo que hacen caber el código en el ancho útil.
    const ajuste = this.fitBarcode(job.barcodeValue, job.symbology, util);
    const xBarras = Math.max(0, Math.round((W - ajuste.ancho) / 2));

    const limpio = v => String(v ?? '').replace(/[\^~]/g, ' ');
    const barcode = ajuste.simbologia === 'CODE39'
      ? `^B3N,N,${altoBarras},Y,N`
      : `^BCN,${altoBarras},Y,N,N`;

    return [
      '^XA',
      '^CI28',                                   // UTF-8: respeta acentos
      `^PW${W}`, `^LL${H}`, '^LH0,0',
      `^CF0,${tTitulo}`,
      `^FO0,${yTitulo}^FB${W},1,0,C,0^FD${limpio(label.companyName)}^FS`,
      `^CF0,${tTexto}`,
      `^FO${margen},${y1}^FDCodigo Articulo^FS`,
      `^FO${colValor},${y1}^FD${limpio(label.articleCode)}^FS`,
      `^FO${margen},${y2}^FDNombre Articulo^FS`,
      `^FO${colValor},${y2}^FB${anchoValor},2,0,L,0^FD${limpio(label.articleDescription)}^FS`,
      `^FO${margen},${y3}^FDCodigo Lote^FS`,
      `^FO${colValor},${y3}^FD${limpio(label.lotCode)}^FS`,
      `^BY${ajuste.modulo},3,${altoBarras}`,
      `^FO${xBarras},${yBarras}${barcode}^FD${limpio(job.barcodeValue)}^FS`,
      `^PQ${job.copies}`,                        // copias resueltas por la impresora
      '^XZ'
    ].join('\n');
  },

  /** Camino completo: detectar, resolver destino y enviar. */
  async print(job, label) {
    if (!(await this.detect())) return { ok: false, error: this.lastError, fallback: 'previsualizacion' };
    const device = await this.defaultDevice();
    if (!device) return { ok: false, error: 'Browser Print está activo pero no reporta ninguna Zebra conectada.', fallback: 'previsualizacion' };
    const util = Math.round(job.widthMm * (job.dpi / 25.4) * 0.9);
    const ajuste = this.fitBarcode(job.barcodeValue, job.symbology, util);
    if (!ajuste.ok) return { ok: false, error: `El código de barras no entra en una etiqueta de ${job.widthMm} mm: elegí un formato más ancho.`, fallback: 'previsualizacion' };
    const r = await this.send(this.toZpl(job, label), device);
    return ajuste.cambiada ? { ...r, aviso: `El ID no entraba en Code 39; se imprimió en Code 128, que codifica el mismo lote.` } : r;
  }
};
