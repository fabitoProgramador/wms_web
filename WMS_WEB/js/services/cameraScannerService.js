/**
 * Mejoras del visor de cámara para los lectores existentes.
 *
 * QUÉ HACE Y QUÉ NO
 * Este servicio NO lee códigos. La detección sigue estando donde estaba:
 * en `GrueroController.scanCamera()` y `InventoryOperationController.scanCamera()`,
 * con el `BarcodeDetector` nativo y su intervalo de 240 ms. Acá sólo se agrega
 * lo que rodea al visor:
 *
 *   - negociación de una captura de mejor calidad (cámara trasera y 1080p),
 *   - la línea roja de escaneo, que es puramente decorativa,
 *   - la linterna (torch) cuando el equipo la soporta,
 *   - el encendido automático de la linterna con poca luz.
 *
 * REGLA DE ORO: todo es progresivo. Si el equipo no soporta 1080p, ni torch,
 * ni getCapabilities, el lector abre y funciona igual que siempre. Ninguna
 * mejora puede impedir que la cámara se abra.
 *
 * NO se abre un segundo getUserMedia: se trabaja siempre sobre el mismo
 * MediaStream que ya usa el lector.
 */
const CameraScannerService = {

  /* Calidad pedida. Todo va como `ideal`, nunca como `exact`: el navegador
     negocia lo mejor que el equipo pueda dar y jamás rechaza la apertura.
     No se pide 4K a propósito: para leer códigos conviene una captura
     estable a 1080p antes que una de mayor tamaño con más latencia. */
  VIDEO_PREFERIDO: {
    facingMode: { ideal: 'environment' },
    width: { ideal: 1920 },
    height: { ideal: 1080 },
    frameRate: { ideal: 30 }
  },
  /* Escalones de reserva, del mejor al mínimo. Sólo se baja si el anterior
     falla de verdad; con constraints `ideal` esto casi nunca ocurre, pero
     así queda garantizado que el lector siempre abre. */
  ESCALONES: [
    { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
    { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
    { facingMode: { ideal: 'environment' } },
    true
  ],

  /* Detección de poca luz. Los dos umbrales están separados a propósito
     (histéresis): se enciende por debajo de BAJO y se apaga por encima de
     ALTO, así la linterna no parpadea cuando la luz queda en el límite. */
  LUZ: {
    UMBRAL_BAJO: 46,        // 0-255: por debajo de esto la escena está oscura
    UMBRAL_ALTO: 78,        // por encima de esto hay luz suficiente
    MUESTRAS: 3,            // lecturas seguidas necesarias antes de actuar
    INTERVALO_MS: 800,      // se mide cada 800 ms, no en cada cuadro
    LADO: 32                // el análisis se hace sobre un lienzo de 32x32
  },

  /**
   * Abre la cámara negociando la mejor captura disponible.
   * Devuelve el MediaStream, o lanza el error original si ninguna
   * combinación funcionó (mismo comportamiento que antes para el `catch`
   * que ya tienen los controladores).
   */
  async abrirStream() {
    let ultimoError = null;
    for (const video of this.ESCALONES) {
      try { return await navigator.mediaDevices.getUserMedia({ video, audio: false }); }
      catch (error) { ultimoError = error; }
    }
    throw ultimoError || new Error('No fue posible abrir la cámara.');
  },

  /** Resolución REAL entregada por el equipo, que no es la del <video> en pantalla. */
  describir(stream) {
    const track = stream?.getVideoTracks?.()[0];
    const s = track?.getSettings?.() || {};
    if (!s.width || !s.height) return '';
    return `${s.width}x${s.height}${s.frameRate ? ` @ ${Math.round(s.frameRate)}fps` : ''}`;
  },

  soportaTorch(stream) {
    const track = stream?.getVideoTracks?.()[0];
    const caps = track?.getCapabilities?.();
    return Boolean(caps && caps.torch);
  },

  /**
   * Monta la capa visual sobre el visor y devuelve un objeto con `cerrar()`.
   *
   * @param {MediaStream} stream  el mismo stream que ya usa el lector
   * @param {HTMLElement} escena  contenedor que envuelve al <video>
   * @returns {{cerrar: Function}}
   */
  potenciar(stream, escena) {
    if (!escena) return { cerrar() {} };
    const track = stream?.getVideoTracks?.()[0] || null;
    const video = escena.querySelector('video');

    // --- Capa visual: marco discreto y línea roja. Sin eventos: no tapa clics
    //     ni interfiere con el decodificador, que lee del <video> directamente.
    const capa = document.createElement('div');
    capa.className = 'scan-overlay';
    capa.setAttribute('aria-hidden', 'true');
    capa.innerHTML = '<span class="scan-frame"></span><span class="scan-line"></span>';
    escena.appendChild(capa);

    // --- Linterna: el botón sólo existe si el equipo realmente la soporta.
    let torchOn = false, boton = null;
    const puedeTorch = this.soportaTorch(stream);
    const aplicarTorch = async encendido => {
      if (!puedeTorch || !track || torchOn === encendido) return;
      try { await track.applyConstraints({ advanced: [{ torch: encendido }] }); torchOn = encendido; }
      catch (_) { /* silencio: el equipo dijo que podía y no pudo; el lector sigue */ }
      if (boton) { boton.classList.toggle('is-on', torchOn); boton.setAttribute('aria-pressed', String(torchOn)); }
    };

    if (puedeTorch) {
      boton = document.createElement('button');
      boton.type = 'button';
      boton.className = 'scan-torch';
      boton.setAttribute('aria-pressed', 'false');
      boton.setAttribute('aria-label', 'Encender o apagar la linterna');
      boton.innerHTML = '<i class="wi wi-sun" aria-hidden="true"></i><span>Flash</span>';
      boton.onclick = event => { event.preventDefault(); event.stopPropagation(); auto.activo = false; aplicarTorch(!torchOn); };
      escena.appendChild(boton);
    }

    /* --- Poca luz automática.
     *
     * Se mide sobre un lienzo de 32x32 (1024 píxeles) cada 800 ms, no en
     * cada cuadro: es una comprobación deliberadamente barata.
     *
     * Sólo se promedia el BORDE del cuadro, nunca el centro. Si se midiera
     * el centro, un código de barras negro delante del lente se leería como
     * "está oscuro" y encendería la linterna sin necesidad. El contexto
     * alrededor del código es lo que dice de verdad si hay luz en la cámara. */
    const auto = { activo: puedeTorch, oscuras: 0, claras: 0, timer: null };
    let lienzo = null, ctx = null;

    const luminanciaDelBorde = () => {
      if (!video || video.readyState < 2 || !video.videoWidth) return null;
      if (!lienzo) {
        lienzo = document.createElement('canvas');
        lienzo.width = this.LUZ.LADO; lienzo.height = this.LUZ.LADO;
        ctx = lienzo.getContext('2d', { willReadFrequently: true });
      }
      try {
        ctx.drawImage(video, 0, 0, this.LUZ.LADO, this.LUZ.LADO);
        const datos = ctx.getImageData(0, 0, this.LUZ.LADO, this.LUZ.LADO).data;
        const lado = this.LUZ.LADO, desde = Math.round(lado * 0.25), hasta = Math.round(lado * 0.75);
        let suma = 0, n = 0;
        for (let y = 0; y < lado; y++) {
          for (let x = 0; x < lado; x++) {
            if (x >= desde && x < hasta && y >= desde && y < hasta) continue;   // se salta el centro
            const i = (y * lado + x) * 4;
            suma += 0.2126 * datos[i] + 0.7152 * datos[i + 1] + 0.0722 * datos[i + 2];
            n++;
          }
        }
        return n ? suma / n : null;
      } catch (_) { return null; }
    };

    if (puedeTorch) {
      auto.timer = setInterval(() => {
        if (!auto.activo) return;                       // el operador tomó el control manual
        const luz = luminanciaDelBorde();
        if (luz === null) return;
        if (luz < this.LUZ.UMBRAL_BAJO) { auto.oscuras++; auto.claras = 0; }
        else if (luz > this.LUZ.UMBRAL_ALTO) { auto.claras++; auto.oscuras = 0; }
        else { return; }                                // zona intermedia: no se toca nada
        if (!torchOn && auto.oscuras >= this.LUZ.MUESTRAS) { auto.oscuras = 0; aplicarTorch(true); }
        else if (torchOn && auto.claras >= this.LUZ.MUESTRAS) { auto.claras = 0; aplicarTorch(false); }
      }, this.LUZ.INTERVALO_MS);
    }

    return {
      soportaTorch: puedeTorch,
      /** Se llama ANTES de detener el stream: la linterna se apaga primero. */
      cerrar() {
        if (auto.timer) { clearInterval(auto.timer); auto.timer = null; }
        auto.activo = false;
        if (torchOn && track) { try { track.applyConstraints({ advanced: [{ torch: false }] }); } catch (_) {} torchOn = false; }
        capa.remove();
        boton?.remove();
        lienzo = null; ctx = null;
      }
    };
  }
};
