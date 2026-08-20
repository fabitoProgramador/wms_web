/**
 * Centro de Etiquetas — vista operacional independiente (Operaciones).
 *
 * Estructura: contenido principal + cola propia del módulo a la derecha.
 * La cola NO es un segundo sidebar: pertenece a esta vista y acompaña a las
 * tres pestañas internas (Producción, Buscar / Reimprimir, Historial).
 *
 * Este controlador no crea ni persiste pallets: lee de LabelService (que a su
 * vez lee de los modelos existentes) y sólo escribe en LabelHistoryModel.
 * La salida física está desacoplada: prepara los trabajos y deja la impresión
 * a un adaptador Zebra futuro, sin que la vista tenga que reconstruirse.
 */
const LabelController = {
  container: null,
  tab: 'produccion',
  query: '',
  selected: null,
  queue: [],
  queueOpen: false,
  configOpen: false,
  _unmountWatch: null,
  zebra: { probed: false, available: false, device: null, detail: '' },
  COPIES_PER_PALLET: 2,

  esc(value) { return PalletLabelTemplate.esc(value); },

  init(container) {
    this.container = container;
    this.configOpen = false;   // nunca heredar un overlay abierto de una visita anterior
    // Al entrar, se revisa si alguna etiqueta anticipada ya quedó consolidada.
    const r = LabelHistoryModel.reconcile(lotCode => LabelService.consolidated(lotCode));
    this.render();
    if (r.consolidados || r.discrepancias) {
      const partes = [];
      if (r.consolidados) partes.push(`${r.consolidados} etiqueta(s) anticipada(s) ahora consolidada(s)`);
      if (r.discrepancias) partes.push(`${r.discrepancias} con discrepancia para revisar`);
      NotificationService.show(partes.join(' · '), { type: r.discrepancias ? 'warning' : 'info' });
    }
  },

  /** Punto de entrada desde otras vistas (por ejemplo, un botón de pallet). */
  openForPallet(pallet) {
    this.selected = LabelService.toLabel(pallet);
    this.query = this.selected.lotCode;
    this.tab = 'buscar';
    AppController.navigate('centro_etiquetas');
  },

  tabs() {
    return [
      ['produccion', 'wi-cube', 'Producción'],
      ['buscar', 'wi-search', 'Buscar / Reimprimir'],
      ['historial', 'wi-history', 'Historial']
    ];
  },

  render() {
    if (!this.container) return;
    const pallets = this.queue.length, copies = this.queueCopies();
    this.container.innerHTML = `<section class="label-center-view">
      ${DashboardController.operationalHeader({ eyebrow: 'OPERACIONES · ETIQUETADO', title: 'Centro de Etiquetas', status: 'Preparación e impresión de la etiqueta oficial de pallet · 100 × 50 mm' })}
      <div class="label-center-bar">
        <nav class="label-center-tabs" aria-label="Secciones de Centro de Etiquetas">${this.tabs().map(([id, icon, text]) => `<button type="button" class="${this.tab === id ? 'active' : ''}" onclick="LabelController.selectTab('${id}')"><i class="wi ${icon}" aria-hidden="true"></i>${text}</button>`).join('')}</nav>
      </div>
      <button class="label-queue-trigger" type="button" onclick="LabelController.toggleQueue()" aria-expanded="${this.queueOpen}"><i class="wi wi-print" aria-hidden="true"></i><span>Ver cola</span><b>${pallets} pallet${pallets === 1 ? '' : 's'} · ${copies} etiqueta${copies === 1 ? '' : 's'}</b></button>
      <div class="label-center-shell">
        <div class="label-center-content">${this.renderTab()}</div>
        ${this.renderQueue()}
      </div>
    </section>${this.queueOpen ? '<button class="label-queue-backdrop" type="button" aria-label="Cerrar cola" onclick="LabelController.closeQueue()"></button>' : ''}`;
    this.syncConfigHost();
    DashboardController.startOperationalClock();
  },

  /**
   * El overlay de configuración se monta colgado del <body>, NO dentro de la
   * vista.
   *
   * Motivo: `.main-viewport` declara `position:relative; z-index:1`, y eso
   * abre un contexto de apilamiento. Dentro de él, el z-index 500 del overlay
   * sólo compite con sus hermanos; hacia afuera, todo el viewport vale 1 y
   * pierde contra la barra superior, que vale 90. Resultado: en pantallas no
   * muy altas el diálogo se metía por debajo de la cabecera de la aplicación
   * y el rótulo "CENTRO DE ETIQUETAS" quedaba tapado.
   *
   * Sacarlo del viewport lo deja como un modal de verdad, por encima de todo,
   * sin tocar el z-index de la barra ni el del viewport, que son globales.
   */
  configHost() {
    let host = document.getElementById('labelConfigHost');
    if (!host) {
      host = document.createElement('div');
      host.id = 'labelConfigHost';
      document.body.appendChild(host);
    }
    return host;
  },
  syncConfigHost() { this.configHost().innerHTML = this.renderConfigOverlay(); },

  /**
   * Al vivir fuera de la vista, el overlay ya no desaparece solo cuando se
   * cambia de módulo: quedaría flotando sobre otra pantalla. Este observador
   * mira el viewport y, si la vista del Centro de Etiquetas dejó de estar en
   * el documento, cierra el overlay. Se instala una sola vez y sólo observa
   * el contenedor de vistas, no todo el árbol.
   */
  watchUnmount() {
    if (this._unmountWatch || typeof MutationObserver === 'undefined') return;
    const viewport = document.getElementById('mainViewport');
    if (!viewport) return;
    this._unmountWatch = new MutationObserver(() => {
      if (this.configOpen && !document.querySelector('.label-center-view')) {
        this.configOpen = false;
        this.syncConfigHost();
      }
    });
    this._unmountWatch.observe(viewport, { childList: true });
  },

  /**
   * Configuración de impresión en overlay, detrás de un solo botón de
   * engranaje. Se saca de la vista principal para que las tres pestañas
   * queden limpias: el operador sólo la abre cuando cambia el rollo, el
   * modelo de impresora o hay un problema de salida.
   *
   * El engranaje vive en la esquina superior de la tarjeta de cada pestaña,
   * no suelto entre los controles: ahí se lee como "configurar esto que
   * estoy viendo" y no queda un botón huérfano en la barra.
   */
  configButton() {
    return `<button type="button" class="label-config-open" onclick="LabelController.openConfig()" aria-label="Configuración de impresión" title="Configuración de impresión"><i class="wi wi-settings" aria-hidden="true"></i></button>`;
  },
  openConfig() { this.configOpen = true; this.render(); this.watchUnmount(); },
  closeConfig() { if (!this.configOpen) return; this.configOpen = false; this.render(); },
  setConfig(key, value) {
    const patch = key === 'dpi' ? { dpi: Number(value), dpiAuto: false } : { [key]: value };
    if (key === 'model') patch.dpiAuto = true;      // al cambiar de modelo, vuelve a automático
    if (key === 'dpiAuto') patch.dpiAuto = value === true || value === 'true';
    LabelFormatService.save(patch);
    this.render();
  },
  /**
   * Pregunta al equipo si tiene Browser Print corriendo y, si lo tiene, toma
   * la Zebra conectada y le consulta su propia resolución de cabezal. Con eso
   * el DPI deja de depender del modelo elegido a mano.
   */
  async detectPrinter() {
    this.zebra = { probed: true, available: false, device: null, detail: 'Buscando…' };
    this.render();
    const ok = await ZebraPrintService.detect();
    if (!ok) {
      this.zebra = { probed: true, available: false, device: null, detail: 'No se detectó Zebra Browser Print en este equipo. Instalalo desde la web de Zebra y volvé a probar; mientras tanto la salida queda en previsualización.' };
      this.render(); return;
    }
    const device = await ZebraPrintService.defaultDevice();
    if (!device) {
      this.zebra = { probed: true, available: false, device: null, detail: 'Browser Print está activo pero no reporta ninguna Zebra conectada. Revisá el cable USB o la conexión de red.' };
      this.render(); return;
    }
    const nombre = device.name || device.uid || 'Zebra';
    const dpi = await ZebraPrintService.readResolution(device);
    if (dpi) LabelFormatService.save({ dpi, dpiAuto: false, printer: nombre });
    else LabelFormatService.save({ printer: nombre });
    this.zebra = { probed: true, available: true, device, detail: `Conectada: ${nombre}${dpi ? ` · la impresora informó ${dpi} dpi` : ' · no informó su resolución, se usa la del modelo'}.` };
    this.render();
    NotificationService.show(`Zebra detectada: ${nombre}.`, { type: 'success' });
  },

  /**
   * Avisa antes de imprimir si el formato elegido no puede contener el código
   * de barras del ID de lote. Vale más decirlo acá que emitir una etiqueta
   * recortada que después no se lee en el escáner.
   */
  renderFormatWarning(cfg) {
    const f = LabelFormatService.format(cfg.format);
    const dpi = LabelFormatService.dpi(cfg);
    const util = Math.round(f.w * (dpi / 25.4) * 0.9);
    const muestra = (this.selected && this.selected.lotCode) || '263012509143';
    const ajuste = ZebraPrintService.fitBarcode(muestra, PalletLabelTemplate.DEFAULT_SYMBOLOGY, util);
    if (ajuste.ok && !ajuste.cambiada) return '';
    if (!ajuste.ok) return `<p class="label-config-note warn"><b>Formato demasiado chico.</b> Un ID de lote de ${muestra.length} dígitos no cabe como código de barras legible en ${f.label}. Elegí un formato más ancho: desde 50 × 25 mm entra.</p>`;
    return `<p class="label-config-note info"><b>Simbología ajustada.</b> En ${f.label} el ID no entra en Code 39, así que se imprimirá en Code 128 — codifica exactamente el mismo ID de lote y se lee igual.</p>`;
  },

  renderConfigOverlay() {
    if (!this.configOpen) return '';
    const cfg = LabelFormatService.config();
    const model = LabelFormatService.printerModel(cfg.model);
    const dpi = LabelFormatService.dpi(cfg);
    const auto = cfg.dpiAuto !== false;
    return `<div class="label-config-backdrop" onclick="if(event.target===this)LabelController.closeConfig()">
      <section class="label-config-dialog" role="dialog" aria-modal="true" aria-labelledby="labelConfigTitle">
        <header><span class="label-config-mark" aria-hidden="true"><i class="wi wi-settings"></i></span><div><span>CENTRO DE ETIQUETAS</span><h2 id="labelConfigTitle">Configuración de impresión</h2></div><button type="button" onclick="LabelController.closeConfig()" aria-label="Cerrar"><i class="wi wi-close" aria-hidden="true"></i></button></header>
        <div class="label-config-body">
          <label class="label-config-field wide"><span>Modo de salida</span>
            <select onchange="LabelController.setConfig('salida',this.value)">${LabelFormatService.OUTPUTS.map(o => `<option value="${o.id}" ${(cfg.salida || 'auto') === o.id ? 'selected' : ''}>${this.esc(o.label)} · ${this.esc(o.nota)}</option>`).join('')}</select>
          </label>
          <label class="label-config-field"><span>Formato de etiqueta</span>
            <select onchange="LabelController.setConfig('format',this.value)">${LabelFormatService.FORMATS.map(f => `<option value="${f.id}" ${cfg.format === f.id ? 'selected' : ''}>${this.esc(f.label)}${f.nota ? ` · ${this.esc(f.nota)}` : ''}</option>`).join('')}</select>
          </label>
          <label class="label-config-field"><span>Modelo de impresora</span>
            <select onchange="LabelController.setConfig('model',this.value)">${LabelFormatService.PRINTERS.map(x => `<option value="${x.id}" ${cfg.model === x.id ? 'selected' : ''}>${this.esc(x.label)}</option>`).join('')}</select>
          </label>
          <label class="label-config-field"><span>Resolución</span>
            <select onchange="LabelController.setConfig(this.value==='auto'?'dpiAuto':'dpi', this.value==='auto'?true:this.value)">
              <option value="auto" ${auto ? 'selected' : ''}>Automática · ${model.dpi} dpi</option>
              ${model.dpis.map(d => `<option value="${d}" ${!auto && dpi === d ? 'selected' : ''}>${d} dpi (${LabelFormatService.dotsPerMm(d)} pt/mm)</option>`).join('')}
            </select>
          </label>
          <label class="label-config-field wide"><span>Nombre o IP de la Zebra (opcional si se detecta sola)</span>
            <input value="${this.esc(cfg.printer)}" placeholder="Ej.: ZEBRA-PARRAL-01 o 192.168.1.50" onchange="LabelController.setConfig('printer',this.value)">
          </label>
          <div class="label-config-field wide label-detect">
            <button type="button" class="label-secondary" onclick="LabelController.detectPrinter()"><i class="wi wi-sync" aria-hidden="true"></i>Detectar impresora conectada</button>
            <span class="label-detect-state ${this.zebra.available ? 'ok' : (this.zebra.probed ? 'off' : '')}">${this.zebra.probed ? this.esc(this.zebra.detail) : 'Sin comprobar en este equipo.'}</span>
          </div>
          ${this.renderFormatWarning(cfg)}
          <div class="label-config-help">
            <h3><i class="wi wi-download" aria-hidden="true"></i>Para que la Zebra se detecte sola: instalar Zebra Browser Print</h3>
            <p>Una página web <b>no puede ver por sí sola las impresoras del equipo</b> — no existe forma de que el navegador las liste, y todo lo que pasa por el diálogo de impresión termina en la <b>impresora predeterminada</b>. Ése es justamente el problema que ocurre con SAP cuando una etiqueta sale en la fotocopiadora.</p>
            <p><b>Zebra Browser Print</b> es una aplicación gratuita y liviana de la propia Zebra que se instala <b>una sola vez</b> en el PC donde está la impresora. Queda corriendo en segundo plano escuchando en <code>127.0.0.1:9100</code> y hace de puente entre esta página y las Zebra del equipo, <b>tanto USB como de red</b>.</p>
            <ol>
              <li>Descargarla desde el portal de Zebra: <code>developer.zebra.com</code> → <b>Printers</b> → <b>Browser Print</b> (requiere una cuenta Zebra gratuita).</li>
              <li>Instalarla en el PC que tiene la Zebra conectada. No hace falta instalarla en los teléfonos ni en los tablets.</li>
              <li>Dejar la impresora encendida y enchufada, y volver acá a tocar <b>Detectar impresora conectada</b>.</li>
            </ol>
            <p><b>Qué se gana:</b> la impresora se descubre sola, informa su propia resolución de cabezal (el DPI deja de escribirse a mano) y el trabajo se envía en ZPL directo — <b>sin pasar por el diálogo del navegador ni por la impresora predeterminada</b>, que es lo que evita que la etiqueta termine en la fotocopiadora.</p>
            <p class="label-config-help-foot">Si no está instalada, el Centro de Etiquetas <b>sigue imprimiendo igual</b> por el camino manual descrito abajo. Instalarla sólo agrega la impresión de un clic.</p>
          </div>
          <div class="label-config-help alt">
            <h3><i class="wi wi-print" aria-hidden="true"></i>Respaldo manual: elegir la Zebra en la lista de Windows</h3>
            <p>El camino manual <b>no necesita instalar nada</b>. El sistema arma las etiquetas al tamaño exacto del formato elegido y abre el <b>diálogo de impresión de Windows</b>: ahí aparece la lista de impresoras instaladas en el equipo, se elige la Zebra a mano y se acepta.</p>
            <p><b>Diferencia real con el modo automático:</b> por este camino la etiqueta sale como <b>gráfico a través del driver Zebra de Windows</b>, no como ZPL. Imprime bien, pero el tamaño de etiqueta debe estar configurado en las preferencias del driver, y el diálogo se abre una vez por lote — no es el clic único del modo automático.</p>
            <p class="label-config-help-foot"><b>Los dos caminos conviven.</b> En <b>Automática</b>, si Browser Print no responde el sistema cae solo al diálogo manual: nunca queda sin poder imprimir. En <b>Manual</b> siempre usa el diálogo, aunque Browser Print esté instalado.</p>
          </div>
          <p class="label-config-note">
            <b>Resolución automática.</b> Con <b>Detectar impresora conectada</b> la Zebra informa su propia resolución de cabezal y este campo se completa solo — para eso el equipo necesita tener instalado Zebra Browser Print. Si no está instalado, el DPI se toma del modelo elegido y también se puede fijar a mano.
          </p>
          <p class="label-config-note">
            <b>Destino de impresión.</b> ${(cfg.salida === 'manual')
              ? 'Modo manual: los trabajos abren el diálogo de Windows para que elijas la impresora en la lista del sistema. No se usa la predeterminada salvo que la elijas vos.'
              : (cfg.printer
                ? `Los trabajos irán directo a <b>${this.esc(cfg.printer)}</b> en ZPL, sin pasar por el diálogo del navegador ni por la impresora predeterminada del equipo. Si esa vía falla, se abre el diálogo manual como respaldo.`
                : 'Sin impresora detectada todavía. Si al imprimir no hay Browser Print, el sistema abre el diálogo manual como respaldo, donde podés elegir la Zebra en la lista de Windows.')}
          </p>
        </div>
        <footer><span>${this.esc(LabelFormatService.format(cfg.format).label)} · ${this.esc(model.label)} · ${dpi} dpi</span><button type="button" class="label-primary" onclick="LabelController.closeConfig()">Listo</button></footer>
      </section>
    </div>`;
  },

  renderTab() {
    if (this.tab === 'buscar') return this.renderSearch();
    if (this.tab === 'historial') return this.renderHistory();
    return this.renderProduction();
  },

  /* ------------------------------------------------------------------ *
   * PRODUCCIÓN                                                          *
   * ------------------------------------------------------------------ */
  renderProduction() {
    const items = LabelService.production(24);
    const rows = items.map(label => {
      const inQueue = this.inQueue(label.lotCode);
      const printed = LabelHistoryModel.copiesFor(label.lotCode);
      return `<article class="label-prod-row ${inQueue ? 'queued' : ''}">
        <div class="label-prod-id"><b>${this.esc(label.reference || label.lotCode)}</b><code>${this.esc(label.lotCode)}</code></div>
        <div class="label-prod-art"><span>${this.esc(label.articleCode)}</span><small>${this.esc(label.articleDescription)}</small></div>
        <div class="label-prod-state">${printed ? `<span class="label-tag printed">${printed} impresa${printed === 1 ? '' : 's'}</span>` : '<span class="label-tag">Sin imprimir</span>'}</div>
        <button type="button" class="label-prod-add" ${inQueue ? 'disabled' : ''} onclick="LabelController.addLot('${this.esc(label.lotCode)}')">${inQueue ? 'En cola' : '<i class="wi wi-plus" aria-hidden="true"></i>Agregar'}</button>
      </article>`;
    }).join('');
    const pendientes = items.filter(l => !this.inQueue(l.lotCode)).length;
    return `<section class="label-workspace panel-surface">
      <header class="label-workspace-head">
        <div><span>PRODUCCIÓN</span><h2>Pallets consolidados recientes</h2><p>Cada pallet prepara ${this.COPIES_PER_PALLET} etiquetas con su ID de lote oficial. Los datos salen del maestro de pallets; no se generan valores nuevos.</p></div>
        <div class="label-head-actions"><button type="button" class="label-bulk" ${pendientes ? '' : 'disabled'} onclick="LabelController.addAllProduction()"><i class="wi wi-plus" aria-hidden="true"></i>Agregar ${pendientes} a la cola</button>${this.configButton()}</div>
      </header>
      ${items.length ? `<div class="label-prod-list">${rows}</div>` : '<div class="ops-empty">No hay pallets consolidados con datos maestros completos.</div>'}
    </section>`;
  },

  /* ------------------------------------------------------------------ *
   * BUSCAR / REIMPRIMIR                                                 *
   * ------------------------------------------------------------------ */
  renderSearch() {
    let result;
    if (this.selected) {
      const printed = LabelHistoryModel.copiesFor(this.selected.lotCode);
      const last = LabelHistoryModel.forLot(this.selected.lotCode)[0];
      result = `${printed ? `<div class="label-reprint-warn"><i class="wi wi-alert" aria-hidden="true"></i><div><b>Esta etiqueta ya se imprimió</b><span>${printed} copia(s) · última el ${this.esc(last.fecha)} por ${this.esc(last.usuario)}. Al agregarla de nuevo se registrará como reimpresión.</span></div></div>` : ''}
        <div class="label-preview-stage">${PalletLabelTemplate.render(this.selected)}</div>
        <footer>Origen: <b>${this.selected.source === 'anticipated' ? 'ID de lote anticipado, aún no consolidado' : 'pallet consolidado'}</b> · el código de barras contiene únicamente el ID de lote oficial.</footer>`;
    } else {
      result = '<div class="label-empty-preview"><i class="wi wi-search" aria-hidden="true"></i><b>Sin etiqueta seleccionada</b><span>Escribí o escaneá un pallet: el sistema interpreta solo el tipo de entrada.</span></div>';
    }
    return `<section class="label-workspace panel-surface">
      <header class="label-workspace-head"><div><span>BUSCAR / REIMPRIMIR</span><h2>Buscar o escanear pallet</h2><p>Acepta ID de lote oficial, lectura de código de barras y referencia corta del mapa (A20 o A020). No hay que elegir el tipo de entrada.</p></div><div class="label-head-actions">${this.configButton()}</div></header>
      <form class="label-search-form" onsubmit="LabelController.search(event)">
        <label for="labelLotSearch">Buscar o escanear pallet</label>
        <div><input id="labelLotSearch" value="${this.esc(this.query)}" autocomplete="off" autocapitalize="characters" placeholder="Ej.: 263012509143 · 26-30-12509-143 · A20"><button class="label-primary" type="submit"><i class="wi wi-search" aria-hidden="true"></i>Buscar</button>${this.query || this.selected ? '<button class="label-secondary" type="button" onclick="LabelController.clearSearch()">Limpiar</button>' : ''}</div>
      </form>
      <section class="label-preview-panel">${result}</section>
      ${this.selected ? `<div class="label-search-actions"><button class="label-primary" type="button" onclick="LabelController.addSelectedToQueue()"><i class="wi wi-plus" aria-hidden="true"></i>Agregar a la cola · ${this.COPIES_PER_PALLET} etiquetas</button></div>` : ''}
    </section>`;
  },

  /* ------------------------------------------------------------------ *
   * HISTORIAL                                                           *
   * ------------------------------------------------------------------ */
  renderHistory() {
    const entries = LabelHistoryModel.all().slice().reverse();
    if (!entries.length) {
      return `<section class="label-workspace panel-surface"><header class="label-workspace-head"><div><span>HISTORIAL</span><h2>Sin impresiones registradas</h2><p>Cada trabajo preparado desde Producción o desde Buscar / Reimprimir queda registrado aquí con su lote, artículo, usuario, copias y resultado.</p></div><div class="label-head-actions">${this.configButton()}</div></header><div class="ops-empty">Todavía no se ha preparado ninguna etiqueta.</div></section>`;
    }
    const rows = entries.map(e => `<article class="label-hist-row ${e.result === 'revisar' ? 'review' : ''}">
      <div class="label-hist-id"><b>${this.esc(e.reference)}</b><code>${this.esc(e.lotCode)}</code></div>
      <div class="label-hist-art"><span>${this.esc(e.articleCode)}</span><small>${this.esc(e.articleDescription)}</small></div>
      <div class="label-hist-meta"><span>${this.esc(e.fecha)}</span><small>${this.esc(e.usuario)}</small></div>
      <div class="label-hist-tags">
        <span class="label-tag ${e.kind === 'inicial' ? 'first' : 'reprint'}">${e.kind === 'inicial' ? 'Impresión inicial' : 'Reimpresión'}</span>
        <span class="label-tag">${e.copies} copia${e.copies === 1 ? '' : 's'}</span>
        <span class="label-tag ${e.consolidated ? 'ok' : 'pending'}">${e.consolidated ? 'Consolidado' : 'Anticipada'}</span>
        ${e.result === 'revisar' ? `<span class="label-tag review" title="${this.esc(e.discrepancia || '')}">Revisar</span>` : ''}
      </div>
    </article>`).join('');
    return `<section class="label-workspace panel-surface">
      <header class="label-workspace-head"><div><span>HISTORIAL</span><h2>${entries.length} trabajo${entries.length === 1 ? '' : 's'} registrado${entries.length === 1 ? '' : 's'}</h2><p>Se distingue la impresión inicial de la reimpresión, y si el pallet ya quedó consolidado después de una etiqueta anticipada.</p></div><div class="label-head-actions">${this.configButton()}</div></header>
      <div class="label-hist-list">${rows}</div>
    </section>`;
  },

  /* ------------------------------------------------------------------ *
   * COLA                                                                *
   * ------------------------------------------------------------------ */
  queueCopies() { return this.queue.reduce((total, job) => total + job.copies, 0); },
  selectedJobs() { return this.queue.filter(job => job.checked); },
  selectedCopies() { return this.selectedJobs().reduce((total, job) => total + job.copies, 0); },
  inQueue(lotCode) { return this.queue.some(job => job.label.lotCode === lotCode); },

  renderQueue() {
    const copies = this.queueCopies(), chosen = this.selectedJobs().length, chosenCopies = this.selectedCopies();
    const allChecked = this.queue.length > 0 && chosen === this.queue.length;
    return `<aside class="label-queue ${this.queueOpen ? 'is-open' : ''}" aria-label="Cola de producción">
      <header>
        <div><span>COLA DE PRODUCCIÓN</span><h2>${this.queue.length} pallet${this.queue.length === 1 ? '' : 's'} · ${copies} etiqueta${copies === 1 ? '' : 's'}</h2></div>
        <button type="button" class="label-queue-close" onclick="LabelController.closeQueue()" aria-label="Cerrar cola"><i class="wi wi-close" aria-hidden="true"></i></button>
      </header>
      ${this.queue.length ? `<label class="label-queue-all"><input type="checkbox" ${allChecked ? 'checked' : ''} onchange="LabelController.toggleAll(this.checked)"><span>Seleccionar todos</span><b>${chosen}/${this.queue.length}</b></label>` : ''}
      <div class="label-queue-list">${this.queue.length ? this.queue.map(job => `<label class="label-queue-item">
        <input type="checkbox" ${job.checked ? 'checked' : ''} onchange="LabelController.toggleOne('${this.esc(job.label.lotCode)}',this.checked)">
        <span class="label-queue-id"><b>${this.esc(job.label.reference || job.label.lotCode)}</b><code>${this.esc(job.label.lotCode)}</code></span>
        <span class="label-queue-state">Preparada</span>
        <span class="label-queue-copies">${job.copies}</span>
        <button type="button" class="label-queue-remove" onclick="event.preventDefault();LabelController.removeFromQueue('${this.esc(job.label.lotCode)}')" aria-label="Quitar de la cola"><i class="wi wi-close" aria-hidden="true"></i></button>
      </label>`).join('') : '<div class="label-queue-empty"><i class="wi wi-print" aria-hidden="true"></i><b>La cola está vacía</b><span>Agregá pallets desde Producción o desde Buscar / Reimprimir.</span></div>'}</div>
      <footer>
        <button type="button" class="label-primary" ${chosen ? '' : 'disabled'} onclick="LabelController.print('seleccionados')"><i class="wi wi-print" aria-hidden="true"></i>Imprimir ${chosenCopies}</button>
        <button type="button" class="label-secondary" ${this.queue.length ? '' : 'disabled'} onclick="LabelController.print('todos')">Imprimir todos (${copies})</button>
        <small>Salida en previsualización: el adaptador Zebra se conecta después sin rehacer esta vista.</small>
      </footer>
    </aside>`;
  },

  selectTab(tab) { if (!this.tabs().some(([id]) => id === tab)) return; this.tab = tab; this.render(); },

  search(event) {
    event.preventDefault();
    this.query = document.getElementById('labelLotSearch')?.value || '';
    const result = LabelService.resolve(this.query);
    this.selected = result.ok ? result.label : null;
    this.render();
    NotificationService.show(result.ok ? `Etiqueta preparada para el lote ${result.label.lotCode}.` : result.error, { type: result.ok ? 'success' : 'error' });
  },
  clearSearch() { this.query = ''; this.selected = null; this.render(); },

  pushJob(label, notify = true) {
    if (this.inQueue(label.lotCode)) { if (notify) NotificationService.show('Ese lote ya está en la cola.', { type: 'info' }); return false; }
    this.queue.push({ label: { ...label }, copies: this.COPIES_PER_PALLET, checked: true });
    return true;
  },
  addSelectedToQueue() { if (!this.selected) return; if (this.pushJob(this.selected)) { this.render(); NotificationService.show(`Lote ${this.selected.lotCode} agregado con ${this.COPIES_PER_PALLET} etiquetas.`, { type: 'success' }); } },
  addLot(lotCode) {
    const found = LabelService.production(500).find(l => l.lotCode === lotCode);
    const label = found || LabelService.resolve(lotCode).label;
    if (!label) return;
    if (this.pushJob(label)) { this.render(); NotificationService.show(`Lote ${lotCode} agregado con ${this.COPIES_PER_PALLET} etiquetas.`, { type: 'success' }); }
  },
  addAllProduction() {
    const added = LabelService.production(24).filter(label => this.pushJob(label, false)).length;
    this.render();
    NotificationService.show(added ? `${added} pallet(s) agregados · ${added * this.COPIES_PER_PALLET} etiquetas.` : 'Todos los pallets ya estaban en la cola.', { type: added ? 'success' : 'info' });
  },
  toggleOne(lotCode, checked) { const job = this.queue.find(x => x.label.lotCode === lotCode); if (job) { job.checked = checked; this.render(); } },
  toggleAll(checked) { this.queue.forEach(job => { job.checked = checked; }); this.render(); },
  removeFromQueue(lotCode) { this.queue = this.queue.filter(job => job.label.lotCode !== lotCode); this.render(); },
  toggleQueue() { this.queueOpen = !this.queueOpen; this.render(); },
  closeQueue() { if (!this.queueOpen) return; this.queueOpen = false; this.render(); },

  /* ------------------------------------------------------------------ *
   * SALIDA MANUAL — respaldo por el diálogo del sistema                 *
   *                                                                     *
   * Camino independiente del automático, a propósito: no necesita que   *
   * haya nada instalado en el PC. Se arma un documento con las etiquetas *
   * al tamaño físico exacto del formato elegido y se abre el diálogo de  *
   * impresión, donde el operador ve la lista de impresoras de Windows y  *
   * elige la Zebra a mano.                                              *
   *                                                                     *
   * Se usa la misma ventana emergente que ya usan el mapa y el andén de  *
   * carga para imprimir, en vez de window.print() sobre esta página: si  *
   * se imprimiera la página actual saldrían también el menú, la cabecera *
   * y la cola. El documento nuevo contiene sólo etiquetas.              *
   * ------------------------------------------------------------------ */

  /**
   * Documento imprimible. Las medidas se derivan del formato en
   * milímetros, no de la pantalla: `@page` fija el tamaño de página y
   * cada etiqueta ocupa una página completa sin márgenes.
   *
   * Las tipografías de la etiqueta en pantalla usan clamp() con unidades
   * de viewport, que en una página de tamaño fijo no significan nada. Por
   * eso acá se redeclaran en milímetros, proporcionales al alto real, con
   * las mismas proporciones que ya tenía la regla de impresión de 100×50.
   */
  manualDocument(jobs, cfg) {
    const f = LabelFormatService.format(cfg.format);
    // Unidad tipográfica. NO es el alto a secas: en un rollo alto (100×150,
    // 100×200) escalar por el alto agrandaba tanto el título que "Fruticola
    // Olmue" ya no entraba a lo ancho, se partía en dos líneas y empujaba el
    // número de lote fuera de la etiqueta. Se acota el alto por el ancho, de
    // modo que el texto siempre entre en una línea sea cual sea el formato.
    const escala = Math.min(f.h, f.w * 0.6);
    const mm = factor => +(escala * factor).toFixed(2);
    const mmW = factor => +(f.w * factor).toFixed(2);  // márgenes laterales, sí por ancho
    const hojas = jobs.flatMap(job => Array.from({ length: job.copies }, () => PalletLabelTemplate.render(job.label)))
      .map(html => `<div class="hoja">${html}</div>`).join('');
    return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<title>Etiquetas de pallet · ${this.esc(f.label)}</title>
<link rel="stylesheet" href="css/labels.css">
<style>
  @page{size:${f.w}mm ${f.h}mm;margin:0}
  html,body{margin:0;padding:0;background:#fff}
  .hoja{width:${f.w}mm;height:${f.h}mm;overflow:hidden;break-after:page;page-break-after:always}
  .hoja:last-child{break-after:auto;page-break-after:auto}
  /* Toda la caja vertical se redeclara en milimetros y proporcional al ALTO.
     En pantalla la etiqueta usa porcentajes y clamp() con unidades de
     viewport: en una pagina de tamano fijo eso no significa nada, y los
     porcentajes de padding/margin se resuelven contra el ANCHO, asi que en
     un rollo 100x150 el bloque se estiraba y el numero de lote quedaba
     cortado fuera de la etiqueta. Con estas proporciones el contenido cabe
     en los once formatos, del 100x200 al 50x25. */
  .hoja .pallet-label{
    width:${f.w}mm;height:${f.h}mm;max-width:none;aspect-ratio:auto;
    border-radius:0;box-shadow:none;
    padding:${mm(0.06)}mm ${mmW(0.041)}mm ${mm(0.05)}mm;
  }
  .hoja .pallet-label h2{font-size:${mm(0.15)}mm;margin:0 0 ${mm(0.05)}mm}
  .hoja .pallet-label-fields{font-size:${mm(0.062)}mm;row-gap:${mm(0.025)}mm}
  .hoja .pallet-label-barcode-wrap{margin-top:${mm(0.035)}mm}
  .hoja .pallet-label-barcode{height:${mm(0.17)}mm}
  .hoja .pallet-label-barcode-wrap p{font-size:${mm(0.055)}mm;margin-top:${mm(0.012)}mm}
  @media screen{body{display:grid;gap:10px;justify-items:center;padding:14px;background:#111}}
</style></head><body>${hojas}</body></html>`;
  },

  /** Abre el diálogo del sistema con el lote completo. Un diálogo, no uno por etiqueta. */
  printManual(jobs, cfg) {
    const win = window.open('', '_blank');
    if (!win) return { ok: false, error: 'El navegador bloqueó la ventana de impresión. Permití las ventanas emergentes de este sitio y volvé a intentar.' };
    win.opener = null;
    const ciclo = `<script>window.addEventListener('load',()=>setTimeout(()=>window.print(),350));window.addEventListener('afterprint',()=>setTimeout(()=>window.close(),120));<\/script>`;
    win.document.open();
    win.document.write(this.manualDocument(jobs, cfg).replace('</body>', `${ciclo}</body>`));
    win.document.close();
    return { ok: true };
  },

  /**
   * Punto único de salida. Decide por cuál de los dos caminos sale el
   * lote y registra el resultado real en el historial.
   *
   * En 'auto' se comprueba Browser Print UNA vez para todo el lote, no
   * por etiqueta: si no está, no tiene sentido reintentar doce veces, se
   * cae de una al respaldo manual.
   */
  async print(scope) {
    const jobs = scope === 'todos' ? this.queue.slice() : this.selectedJobs().slice();
    if (!jobs.length) return;
    const cfg = LabelFormatService.config();
    const copies = jobs.reduce((total, job) => total + job.copies, 0);

    let via = (cfg.salida === 'manual') ? 'manual' : 'zebra';
    let motivo = '';
    if (via === 'zebra' && !(await ZebraPrintService.detect())) {
      via = 'manual';
      motivo = 'No se detectó Zebra Browser Print, así que se abrió el diálogo del sistema.';
    }

    let enviadas = 0, fallo = '', aviso = '';
    if (via === 'zebra') {
      for (const job of jobs) {
        const r = await ZebraPrintService.print(LabelFormatService.printJob(job.label, job.copies), job.label);
        if (r.ok) enviadas++; else if (!fallo) fallo = r.error;
        if (r.aviso && !aviso) aviso = r.aviso;
      }
      // Si la Zebra estaba pero ningun trabajo salio, el respaldo manual
      // evita que el operador quede sin etiqueta por un problema puntual.
      if (!enviadas) { via = 'manual'; motivo = fallo || 'La Zebra no aceptó el trabajo; se abrió el diálogo del sistema.'; }
    }

    let manual = null;
    if (via === 'manual') manual = this.printManual(jobs, cfg);

    const destino = via === 'zebra' ? 'zebra-directo' : (manual && manual.ok ? 'dialogo-sistema' : 'no-impresa');
    const f = LabelFormatService.format(cfg.format);
    const done = new Set();
    jobs.forEach(job => {
      LabelHistoryModel.record(job.label, job.copies, {
        consolidated: job.label.source !== 'anticipated',
        result: destino === 'no-impresa' ? 'revisar' : 'impresa',
        formato: `${f.w}×${f.h} mm`,
        dpi: LabelFormatService.dpi(cfg),
        destino
      });
      done.add(job.label.lotCode);
    });

    // Si no se pudo abrir el dialogo, la cola NO se vacia: el trabajo no salio.
    if (destino !== 'no-impresa') {
      this.queue = this.queue.filter(job => !done.has(job.label.lotCode));
      this.queueOpen = false;
    }
    this.render();

    let mensaje, tipo;
    if (destino === 'zebra-directo') {
      mensaje = `${enviadas} pallet(s) enviados a la Zebra · ${copies} etiquetas.${aviso ? ` ${aviso}` : ''}`;
      tipo = 'success';
    } else if (destino === 'dialogo-sistema') {
      mensaje = `${jobs.length} pallet(s) · ${copies} etiquetas en el diálogo de impresión: elegí la Zebra en la lista.${motivo ? ` ${motivo}` : ''}`;
      tipo = 'info';
    } else {
      mensaje = manual.error;
      tipo = 'error';
    }
    NotificationService.show(mensaje, { type: tipo });
  }
};
