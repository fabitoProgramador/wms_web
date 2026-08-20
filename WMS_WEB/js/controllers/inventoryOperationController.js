/** UI táctil para cortes físicos de inventario, separada del stock oficial. */
const InventoryOperationController = {
  root: null, session: null, warehouse: 'PROTER', view: 'scan', search: '', candidate: null,
  band: 0, bandDetail: null, renderer: null, toastTimer: null, clockTimer: null, focusScanOnRender: false, _renderToken: 0,
  hidBuffer: '', hidLastKeyAt: 0, hidStartedAt: 0,

  async init(root) {
    this.root = root; this.view = 'scan'; this.search = ''; this.candidate = null; this.bandDetail = null; this.focusScanOnRender = false;
    await InventoryOperationService.initialize();
    const sessions = await InventoryOperationService.sessions();
    this.session = sessions.find(session => session.estado === InventoryOperationModel.STATES.PROCESS) || null;
    if (this.session) { this.warehouse = this.session.almacen; this.band = InventoryOperationModel.bands(this.warehouse)[0]; }
    if (!this._subscribed) {
      this._subscribed = true;
      InventoryOperationService.subscribe(async () => {
        if (AppController.activeView !== 'operacion_inventario' || !this.root) return;
        if (this.session) this.session = await InventoryOperationService.getSession(this.session.id) || this.session;
        this.render();
      });
    }
    this.bindHidScanner();
    clearInterval(this._remoteTimer);
    this._remoteTimer = setInterval(async () => {
      if (AppController.activeView !== 'operacion_inventario') return;
      const result = await InventoryOperationService.refreshRemote();
      if (result.ok && this.session) this.session = await InventoryOperationService.getSession(this.session.id) || this.session;
    }, 15000);
    this.render();
  },

  esc(value) { const node = document.createElement('span'); node.textContent = String(value ?? ''); return node.innerHTML; },
  fmt(value) { return Number(value || 0).toLocaleString('es-CL'); },
  date(value) { if (!value) return '—'; try { return new Date(value).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' }); } catch (_) { return value; } },
  userAudit() { const user = UserModel.getCurrentUser() || {}; return { id: user.id || null, nombre: user.name || 'Usuario WMS', rol: user.role || 'Usuario' }; },
  device() { return navigator.userAgentData?.platform || navigator.platform || 'Navegador web'; },

  async render() {
    if (!this.root) return;
    if (this._stopCamera) { const stop = this._stopCamera; this._stopCamera = null; stop(); }
    const token = ++this._renderToken;
    const status = await InventoryOperationService.status();
    if (token !== this._renderToken || !this.root) return;
    this.root.innerHTML = `<section class="inventory-operation" aria-label="Operación Inventario">
      ${this.heading(status)}
      ${this.session ? this.sessionView(status) : await this.startView(status)}
      <div id="inventoryOperationModal"></div><div id="inventoryOperationToast" class="io-toast" role="status"></div>
    </section>`;
    this.bindAfterRender();
  },

  heading(status) {
    const turn = TURNOS_OPERACIONALES.resolver();
    const label = !status.online ? 'Sin conexión' : status.serverReady ? 'Servidor disponible' : 'Modo local';
    const warehouse = this.session?.almacen || this.warehouse;
    return `<header class="io-operation-summary panel-surface"><div class="io-operation-title"><span>OPERACIÓN EN CÁMARA</span><h1>Operación Inventario</h1><p><i class="${!status.online ? 'offline' : ''}"></i>${label}<b>${status.pending ? `${status.pending} por sincronizar` : 'Sin cambios pendientes'}</b></p></div><div class="io-operation-clock"><b id="ioOperationTime">${TURNOS_OPERACIONALES.formatoHora()}</b><span id="ioOperationDate">${this.esc(TURNOS_OPERACIONALES.formatoFecha())}</span></div><div class="io-operation-turn"><small>TURNO ACTUAL</small><b id="ioOperationTurn">${this.esc(turn.etiqueta)}</b><span>${turn.hora.toString().padStart(2, '0')}:00 · ${this.esc(turn.codigo)}</span></div><div class="io-operation-camera"><small>CÁMARA</small><b>${this.esc(warehouse)}</b><span>${this.session ? 'Corte en seguimiento' : 'Por seleccionar'}</span></div></header>`;
  },

  startOperationalClock() {
    clearInterval(this.clockTimer);
    const update = () => {
      const turn = TURNOS_OPERACIONALES.resolver(), time = document.getElementById('ioOperationTime'), date = document.getElementById('ioOperationDate'), label = document.getElementById('ioOperationTurn');
      if (time) time.textContent = TURNOS_OPERACIONALES.formatoHora();
      if (date) date.textContent = TURNOS_OPERACIONALES.formatoFecha();
      if (label) label.textContent = turn.etiqueta;
    };
    update(); this.clockTimer = setInterval(update, 30000);
  },

  warehouseToggle(activeSessions = []) {
    const proter = activeSessions.find(session => session.almacen === 'PROTER'), post = activeSessions.find(session => session.almacen === 'POST TUNEL');
    return `<div class="io-warehouse-field"><div class="io-warehouse-label"><span>Almacén del corte</span><small>Elegí una cámara disponible</small></div><div class="bit-shift-toggle io-warehouse-toggle ${this.warehouse === 'POST TUNEL' ? 'night' : 'day'}"><button type="button" ${proter ? 'disabled' : ''} class="${this.warehouse === 'PROTER' ? 'active' : ''}" onclick="InventoryOperationController.setWarehouse('PROTER')"><i class="wi wi-snow"></i>PROTER${proter ? '<small>EN USO</small>' : ''}</button><button type="button" ${post ? 'disabled' : ''} class="${this.warehouse === 'POST TUNEL' ? 'active' : ''}" onclick="InventoryOperationController.setWarehouse('POST TUNEL')"><i class="wi wi-cube"></i>POST TUNNEL${post ? '<small>EN USO</small>' : ''}</button></div></div>`;
  },

  async startView() {
    const sessions = await InventoryOperationService.sessions();
    const active = sessions.filter(session => session.estado === InventoryOperationModel.STATES.PROCESS);
    const selectedBusy = active.find(session => session.almacen === this.warehouse);
    return `<div class="io-start-layout"><article class="io-start-card panel-surface"><div class="io-start-intro"><span class="io-step">01</span><div><h2>Crear corte de inventario</h2><p>El snapshot conserva los pallets esperados sin modificar stock ni posiciones.</p></div>${this.warehouseToggle(active)}</div><div class="io-start-meta"><div><span>ALMACÉN SELECCIONADO</span><b>${this.esc(this.warehouse)}</b></div><div><span>PALLETS DISPONIBLES</span><b>${this.fmt(StockModel.pallets().filter(pallet => pallet.ubicacion === this.warehouse).length)}</b></div><div><span>ESTADO</span><b class="${selectedBusy ? 'busy' : ''}">${selectedBusy ? 'CORTE ACTIVO' : 'DISPONIBLE'}</b></div></div><button class="io-start-button" ${selectedBusy ? 'disabled' : ''} onclick="InventoryOperationController.startCut()"><span>▣</span><div><b>${selectedBusy ? 'CÁMARA CON INVENTARIO ACTIVO' : 'INICIAR CORTE DE INVENTARIO'}</b><small>${selectedBusy ? `Responsable: ${this.esc(selectedBusy.iniciadoPor?.nombre || 'Usuario WMS')}` : 'Confirmación segura antes de congelar el snapshot'}</small></div></button></article>${this.recentSessions(sessions)}</div>`;
  },

  recentSessions(sessions) {
    if (!sessions.length) return `<aside class="io-recent panel-surface"><h2>Sesiones</h2><div class="io-empty">Todavía no existen cortes de inventario.</div></aside>`;
    // Cada fila abre el corte; quien administra ve además el botón de eliminar.
    // La fila deja de ser un <button> suelto y pasa a ser una fila con dos
    // acciones: un boton no puede contener otro boton.
    const puedeEliminar = this.canDeleteSessions();
    return `<aside class="io-recent panel-surface"><header><div><span>SEGUIMIENTO</span><h2>Sesiones recientes</h2></div><b>${sessions.length}</b></header><div>${sessions.slice(0, 8).map(session => { const m = InventoryOperationModel.metrics(session); return `<div class="io-recent-row"><button class="io-recent-open" onclick="InventoryOperationController.openSession('${this.esc(session.id)}')"><i class="${session.estado === 'FINALIZADA' ? 'done' : ''}"></i><span><b>${this.esc(session.almacen)}</b><small>${this.date(session.iniciadoEn)} · ${this.esc(session.iniciadoPor?.nombre || 'Usuario')}</small></span><em>${this.esc(session.estado)}<small>${m.scanned}/${m.total} · ${m.progress.toLocaleString('es-CL', { maximumFractionDigits: 1 })}%</small></em></button>${puedeEliminar ? `<button class="io-recent-del" title="Eliminar este corte" aria-label="Eliminar corte de ${this.esc(session.almacen)}" onclick="InventoryOperationController.askDeleteSession('${this.esc(session.id)}')"><i class="wi wi-trash" aria-hidden="true"></i></button>` : ''}</div>`; }).join('')}</div></aside>`;
  },

  /* ------------------------------------------------------------------ *
   * Eliminar un corte de inventario.
   *
   * Es una acción destructiva sobre un conteo auditado, así que queda
   * reservada a quien administra el sistema y siempre pasa por una
   * confirmación que dice exactamente qué se pierde. Borrar el corte NO
   * toca el stock ni las posiciones de la cámara: elimina el recuento.
   * ------------------------------------------------------------------ */
  canDeleteSessions() { return UserModel.canManageUsers(); },

  async askDeleteSession(id) {
    if (!this.canDeleteSessions()) return;
    const session = await InventoryOperationService.getSession(id);
    if (!session) return;
    const m = InventoryOperationModel.metrics(session);
    const enProceso = session.estado === InventoryOperationModel.STATES.PROCESS;
    this.showDecision({
      icon: '⌫',
      eyebrow: 'ELIMINAR CORTE',
      title: `Eliminar inventario de ${session.almacen}`,
      message: `${enProceso ? 'Este corte está EN PROCESO. ' : ''}Se perderán los ${this.fmt(m.scanned)} conteo(s) ya registrados y toda su auditoría, y no se puede deshacer. El stock y las posiciones de la cámara no se modifican.`,
      confirmLabel: 'ELIMINAR CORTE',
      tone: 'danger',
      action: () => this.confirmDeleteSession(id)
    });
  },

  async confirmDeleteSession(id) {
    if (!this.canDeleteSessions()) return;
    const result = await InventoryOperationService.deleteSession(id);
    if (!result.ok) return this.toast(result.error || 'No fue posible eliminar el corte.', 'error');
    // Si se elimino el corte abierto, se vuelve a la pantalla de sesiones.
    if (this.session && this.session.id === id) { this.session = null; this.candidate = null; this.bandDetail = null; this.view = 'scan'; }
    await this.render();
    this.toast(`Corte de ${result.session.almacen} eliminado.`, 'success');
  },

  sessionView(status) {
    const metrics = InventoryOperationModel.metrics(this.session), finished = this.session.estado === InventoryOperationModel.STATES.FINISHED;
    const owner = this.session.iniciadoPor || {}, initials = AppController.initials(owner.nombre || 'Usuario');
    return `<div class="io-session"><section class="io-session-bar panel-surface"><div class="io-session-context"><div class="io-session-warehouse ${this.session.almacen === 'POST TUNEL' ? 'post' : ''}"><i>${this.session.almacen === 'POST TUNEL' ? '🧊' : '❄'}</i><span><small>INVENTARIO EN</small><b>${this.esc(this.session.almacen)}</b></span></div><em class="io-session-state ${finished ? 'finished' : ''}">${this.esc(this.session.estado)}</em><div class="io-session-owner"><i>${this.esc(initials)}</i><span><small>RESPONSABLE</small><b>${this.esc(owner.nombre || 'Usuario WMS')}</b><em>${this.esc(owner.rol || 'Usuario')}</em></span></div><div class="io-session-code"><small>ID DE SESIÓN</small><b title="${this.esc(this.session.id)}">${this.esc(this.session.id)}</b><span>${this.date(this.session.iniciadoEn)}</span></div><button class="io-session-switch ${finished ? 'is-new' : 'is-back'}" onclick="InventoryOperationController.leaveSession()"><i></i>${finished ? 'Nuevo corte' : 'Sesiones'}</button></div>${this.actionBar(finished)}</section>${this.kpis(metrics, finished)}<div class="io-progress" aria-label="Avance ${metrics.progress.toFixed(1)}%"><i style="width:${Math.min(100, metrics.progress)}%"></i></div><section class="io-work panel-surface">${this.workView(finished)}</section></div>`;
  },

  actionBar(finished) {
    const actions = [
      ['scan', '⌁', 'Escanear', 'Identificar pallet', finished], ['pending', '◫', finished ? 'No escaneados' : 'Ver pendientes', 'Localizar faltantes', false],
      ['band', '▦', 'Ver banda', 'Ubicación viva', false], ['export', '⇩', finished ? 'Exportar final' : 'Exportar avance', 'Generar Excel', false], ['close', '✓', 'Cerrar inventario', 'Finalizar corte', finished]
    ];
    // Eliminar sirve tanto en un corte en proceso como en uno ya finalizado,
    // asi que no se deshabilita; sí queda reservada a quien administra.
    if (this.canDeleteSessions()) actions.push(['delete', '⌫', 'Eliminar corte', 'Borra el conteo', false]);
    return `<nav class="io-actions">${actions.map(([key, icon, label, hint, disabled]) => `<button ${disabled ? 'disabled' : ''} data-io-action="${key}" class="${this.view === key ? 'active' : ''} ${key === 'close' || key === 'delete' ? 'danger' : ''}" onclick="InventoryOperationController.action('${key}')"><i>${icon}</i><span><b>${label}</b><small>${hint}</small></span></button>`).join('')}</nav>`;
  },

  kpis(metrics, finished) {
    return `<section class="io-kpis"><button onclick="InventoryOperationController.action('all')"><span>Total pallets</span><b>${this.fmt(metrics.total)}</b><small>Snapshot congelado</small></button><button class="scanned" onclick="InventoryOperationController.action('scanned')"><span>Escaneados</span><b>${this.fmt(metrics.scanned)}</b><small>Confirmados</small></button><button class="pending" onclick="InventoryOperationController.action('pending')"><span>${finished ? 'No escaneados' : 'Pendientes'}</span><b>${this.fmt(finished ? metrics.notScanned : metrics.pending)}</b><small>${finished ? 'Cierre definitivo' : 'Faltan por contar'}</small></button><article class="progress"><span>% avance</span><b>${metrics.progress.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%</b><small>${metrics.review} requieren revisión</small></article></section>`;
  },

  workView(finished) {
    if (this.view === 'pending' || this.view === 'all' || this.view === 'scanned') return this.listView(finished);
    if (this.view === 'band') return this.bandView();
    return this.scanView(finished);
  },

  scanView(finished) {
    if (finished) return `<div class="io-empty large"><b>Inventario finalizado</b><span>No admite nuevos escaneos. Podés consultar bandas, resultados y exportar.</span></div>`;
    return `<div class="io-scan-layout"><div class="io-scanner"><header><div><span>IDENTIFICACIÓN</span><h2>Escaneá pallet o caja</h2></div><em>Un solo parser · Sin mover stock</em></header><form id="ioScanForm"><label for="ioCode">Código bruto</label><div><input id="ioCode" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="Pallet, caja o ID real"><button type="button" id="ioCamera"><i></i>Cámara</button><button>Identificar</button></div><small id="ioScanMessage">USB/Bluetooth: Enter identifica automáticamente</small></form></div>${this.candidate ? this.validationCard() : '<aside class="io-scan-help"><i>⌁</i><b>Listo para escanear</b><span>El pallet se marca como escaneado únicamente después de presionar Guardar.</span></aside>'}</div>`;
  },

  validationCard() {
    const { item, pallet, duplicate, hasDifference } = this.candidate;
    const live = InventoryOperationModel.position(pallet), location = InventoryOperationModel.locationText(live);
    if (duplicate) return `<aside class="io-validation duplicate"><header><div><span>ATENCIÓN</span><h2>PALLET YA SE ENCUENTRA ESCANEADO</h2></div><button onclick="InventoryOperationController.clearCandidate()">×</button></header><div class="io-validation-id"><b>${this.esc(item.idLote)}</b><span>${this.esc(item.descripcion)}</span></div><dl><div><dt>Confirmado</dt><dd>${this.date(item.confirmadoEn)}</dd></div><div><dt>Por</dt><dd>${this.esc(item.confirmadoPor?.nombre || '—')}</dd></div><div class="wide"><dt>Ubicación actual</dt><dd>${this.esc(location)}</dd></div></dl><button class="io-secondary" onclick="InventoryOperationController.clearCandidate()">ENTENDIDO</button></aside>`;
    return `<aside class="io-validation"><header><div><span>VALIDAR ANTES DE CONTAR</span><h2>${this.esc(PalletModel.codigoVisualLegible(pallet))}</h2></div><button onclick="InventoryOperationController.clearCandidate()" aria-label="Cerrar validación">×</button></header><div class="io-validation-id"><small>ID REAL DEL PALLET</small><b>${this.esc(item.idLote)}</b><span>${this.esc(item.descripcion)}</span></div><dl class="io-validation-grid"><div class="io-data-primary"><dt>Pallet</dt><dd>${this.esc(item.numeroPallet)}</dd></div><div class="io-data-primary"><dt>Artículo</dt><dd>${this.esc(item.numeroArticulo)}</dd></div><div class="io-data-metric"><dt>Cajas sistema</dt><dd>${this.fmt(item.cajasSistema)}</dd></div><div class="io-data-metric"><dt>Kilos sistema</dt><dd>${this.fmt(item.kilosSistema)} <small>kg</small></dd></div><div class="io-data-state"><dt>Estado</dt><dd>${this.esc(item.estadoCalidad)} · ${this.esc(item.estado)}</dd></div><div class="io-data-warehouse"><dt>Almacén</dt><dd>${this.esc(item.almacen)}</dd></div><div class="io-data-location"><dt>Ubicación actual</dt><dd>${this.esc(location)}</dd></div></dl>${hasDifference ? `<div class="io-difference-panel"><label class="io-physical-boxes"><span>Cajas físicas<small>Ingresá el conteo observado</small></span><input id="ioPhysicalBoxes" type="number" min="0" step="1" inputmode="numeric" value="${this.candidate.cajasFisicas ?? ''}" oninput="InventoryOperationController.candidate.cajasFisicas=this.value"></label><p class="io-review-warning">Los kilos no se recalcularán: quedarán como REQUIERE REVISIÓN.</p></div>` : ''}<div class="io-validation-actions"><button type="button" class="io-difference-action ${hasDifference ? 'active' : ''}" aria-pressed="${hasDifference}" onclick="InventoryOperationController.toggleDifference(${!hasDifference})"><i>${hasDifference ? '✓' : '±'}</i><span><b>${hasDifference ? 'Diferencia activa' : 'Diferencia de cajas'}</b><small>${hasDifference ? 'Ingresá el conteo físico' : 'Reportar una diferencia'}</small></span></button><button type="button" class="io-save" onclick="InventoryOperationController.saveCandidate()"><i>✓</i><span><b>Guardar conteo</b><small>Confirmar este pallet</small></span></button></div></aside>`;
  },

  listView(finished) {
    let status = this.view === 'scanned' ? InventoryOperationModel.COUNT_STATES.SCANNED : this.view === 'all' ? null : (finished ? InventoryOperationModel.COUNT_STATES.NOT_SCANNED : InventoryOperationModel.COUNT_STATES.PENDING);
    const query = this.search.trim().toLocaleLowerCase('es-CL');
    const rows = this.session.items.filter(item => (!status || item.estadoConteo === status) && (!query || [item.idLote, item.numeroArticulo, item.descripcion, item.numeroPallet].some(value => String(value || '').toLocaleLowerCase('es-CL').includes(query))));
    return `<div class="io-list-head"><div><span>CONTROL DEL CORTE</span><h2>${status || 'Todos los pallets'}</h2><p>${rows.length} resultado${rows.length === 1 ? '' : 's'} del snapshot</p></div><label><i></i><input id="ioListSearch" value="${this.esc(this.search)}" placeholder="Lote, artículo o pallet" oninput="InventoryOperationController.setSearch(this.value)"></label></div><div class="io-result-list">${rows.slice(0, 250).map(item => this.resultCard(item)).join('') || '<div class="io-empty">No hay pallets que coincidan con este filtro.</div>'}</div>${rows.length > 250 ? `<p class="io-list-limit">Mostrando 250 de ${rows.length}; usá el buscador para acotar.</p>` : ''}`;
  },

  resultCard(item) {
    const live = InventoryOperationModel.livePosition(item), state = item.estadoConteo.toLowerCase().replaceAll(' ', '-');
    return `<button class="io-result-card ${state}" onclick="InventoryOperationController.openItemDetail('${this.esc(item.palletId)}')"><i></i><span><b>${this.esc(item.idLote)}</b><small>${this.esc(item.numeroArticulo)} · ${this.esc(item.descripcion)}</small></span><em><b>${this.esc(item.estadoConteo)}</b><small>${this.esc(InventoryOperationModel.locationText(live))}</small></em>${item.requiereRevision ? '<strong>REVISIÓN</strong>' : ''}</button>`;
  },

  bandView() {
    const bands = InventoryOperationModel.bands(this.session.almacen);
    return `<div class="io-band-head"><div><span>UBICACIÓN VIVA</span><h2>Ver banda · ${this.esc(this.session.almacen)}</h2><p>Consulta el mapa actual; no altera el snapshot ni permite movimientos.</p></div><label>Banda<select id="ioBandSelect" onchange="InventoryOperationController.changeBand(this.value)">${bands.map(value => `<option value="${value}" ${String(value) === String(this.band) ? 'selected' : ''}>${this.session.almacen === 'POST TUNEL' && ['01', '02'].includes(String(value)) ? 'Zona' : 'Banda'} ${value}</option>`).join('')}</select></label></div><div class="io-band-layout"><div id="ioBandMap" class="io-band-map"></div><aside id="ioBandDetail" class="io-band-detail">${this.bandDetail ? this.bandPalletDetail(this.bandDetail) : '<div class="io-empty"><b>Tocá un pallet</b><span>Verás sus datos y estado dentro de este corte.</span></div>'}</aside></div>`;
  },

  bandPalletDetail(pallet) {
    const item = InventoryOperationModel.findItem(this.session, pallet), position = InventoryOperationModel.position(pallet);
    return `<header><span>DETALLE DE BANDA</span><b>${this.esc(PalletModel.codigoVisualLegible(pallet))}</b></header><h3>${this.esc(PalletModel.idLoteReal(pallet))}</h3><p>${this.esc(PalletModel.descripcion(pallet))}</p><dl><div><dt>Artículo</dt><dd>${this.esc(PalletModel.numeroArticulo(pallet))}</dd></div><div><dt>Cajas</dt><dd>${this.fmt(pallet.cajas)}</dd></div><div><dt>Kilos</dt><dd>${this.fmt(PalletModel.kilos(pallet))} kg</dd></div><div><dt>Estado</dt><dd>${this.esc(pallet.estado || '—')}</dd></div><div class="wide"><dt>Ubicación</dt><dd>${this.esc(InventoryOperationModel.locationText(position))}</dd></div></dl><strong class="io-count-state ${item?.estadoConteo === 'ESCANEADO' ? 'done' : ''}">${this.esc(item?.estadoConteo || 'FUERA DEL SNAPSHOT')}</strong>`;
  },

  bindAfterRender() {
    this.startOperationalClock();
    if (!this.session) return;
    if (this.view === 'scan' && this.session.estado === InventoryOperationModel.STATES.PROCESS) {
      const form = document.getElementById('ioScanForm');
      if (form) {
        const submit = () => this.resolveCode(form.elements.ioCode.value, 'MANUAL');
        form.onsubmit = event => { event.preventDefault(); submit(); };
        form.elements.ioCode.onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); submit(); } };
        document.getElementById('ioCamera').onclick = () => this.scanCamera();
        if (this.focusScanOnRender && !this.candidate) requestAnimationFrame(() => form.elements.ioCode?.focus({ preventScroll: true }));
        this.focusScanOnRender = false;
      }
    }
    if (this.view === 'band') this.mountBand();
  },

  async setWarehouse(value) {
    if (this.session) return;
    const warehouse = InventoryOperationModel.normalizeWarehouse(value), availability = await InventoryOperationService.availability(warehouse);
    if (!availability.available) return this.showNotice('Cámara con inventario activo', `${warehouse} ya está siendo inventariada por ${availability.session?.iniciadoPor?.nombre || 'otro usuario'}. Podés abrir esa sesión para seguimiento, pero no crear un corte paralelo.`, 'warning');
    this.warehouse = warehouse; this.render();
  },
  async startCut() {
    const count = StockModel.pallets().filter(pallet => pallet.ubicacion === this.warehouse).length;
    if (!count) return this.toast(`No existen pallets en ${this.warehouse}; no se creó el corte.`, 'error');
    const availability = await InventoryOperationService.availability(this.warehouse);
    if (!availability.available) return this.showNotice('Cámara con inventario activo', `${this.warehouse} ya tiene un corte iniciado por ${availability.session?.iniciadoPor?.nombre || 'otro usuario'}. No se creó una sesión duplicada.`, 'warning');
    this.showDecision({ icon: '▣', eyebrow: 'CONFIRMAR CORTE', title: `Iniciar inventario en ${this.warehouse}`, message: `Se congelará un snapshot de ${this.fmt(count)} pallets. La cámara no podrá cambiar dentro de esta sesión y el stock oficial no será modificado.`, confirmLabel: 'INICIAR INVENTARIO', tone: 'success', action: () => this.createConfirmedCut(count) });
  },
  async createConfirmedCut(count) {
    const result = await InventoryOperationService.createSession(this.warehouse);
    if (!result.ok) return this.showNotice('No fue posible iniciar el corte', result.error || 'La cámara ya tiene un inventario activo.', 'warning');
    this.session = result.session; this.band = InventoryOperationModel.bands(this.warehouse)[0]; this.view = 'scan'; this.render();
    this.toast(`Corte ${this.session.id} creado con ${count} pallets.`);
  },
  async openSession(id) { this.session = await InventoryOperationService.getSession(id); if (!this.session) return; this.warehouse = this.session.almacen; this.band = InventoryOperationModel.bands(this.warehouse)[0]; this.view = this.session.estado === 'FINALIZADA' ? 'all' : 'scan'; this.render(); },
  leaveSession() { this.session = null; this.candidate = null; this.bandDetail = null; this.view = 'scan'; this.render(); },
  action(key) { if (key === 'export') return this.exportProgress(); if (key === 'close') return this.closeInventory(); if (key === 'delete') return this.askDeleteSession(this.session?.id); this.focusScanOnRender = key === 'scan'; this.view = key; this.candidate = null; this.bandDetail = null; this.render(); },
  setSearch(value) { this.search = value; clearTimeout(this._searchTimer); this._searchTimer = setTimeout(() => { this.render(); requestAnimationFrame(() => { const input = document.getElementById('ioListSearch'); input?.focus(); input?.setSelectionRange(value.length, value.length); }); }, 120); },

  bindHidScanner() {
    if (this._hidBound) return; this._hidBound = true;
    document.addEventListener('keydown', event => {
      if (AppController.activeView !== 'operacion_inventario' || !this.session || this.session.estado !== InventoryOperationModel.STATES.PROCESS || event.ctrlKey || event.altKey || event.metaKey) return;
      if (event.target?.matches?.('input,textarea,select,[contenteditable="true"]')) return;
      const now = performance.now();
      if (event.key === 'Enter') {
        const value = this.hidBuffer, elapsed = now - this.hidStartedAt; this.hidBuffer = '';
        if (value.length >= 3 && elapsed <= Math.max(700, value.length * 70)) { event.preventDefault(); this.view = 'scan'; this.resolveCode(value, 'LECTOR'); }
        return;
      }
      if (event.key.length !== 1) return;
      if (!this.hidBuffer || now - this.hidLastKeyAt > 85) { this.hidBuffer = event.key; this.hidStartedAt = now; } else this.hidBuffer += event.key;
      this.hidLastKeyAt = now; clearTimeout(this._hidReset); this._hidReset = setTimeout(() => { this.hidBuffer = ''; }, 500);
    });
  },

  async resolveCode(code, source = 'MANUAL') {
    if (!this.session || this.session.estado !== InventoryOperationModel.STATES.PROCESS) return;
    const resolved = GrueroCodeResolver.resolverCodigo(code, source);
    if (!resolved.ok) { this.candidate = null; this.render(); return this.toast(resolved.error, 'error'); }
    const item = InventoryOperationModel.findItem(this.session, resolved.pallet);
    if (!item) { this.candidate = null; this.render(); return this.toast(`El pallet ${PalletModel.idLoteReal(resolved.pallet)} no pertenece al snapshot ${this.session.almacen}.`, 'error'); }
    if (item.estadoConteo === InventoryOperationModel.COUNT_STATES.SCANNED) {
      await InventoryOperationService.registerRescan(this.session, item, this.userAudit());
      this.candidate = { item, pallet: resolved.pallet, resolved, duplicate: true };
    } else this.candidate = { item, pallet: resolved.pallet, resolved, duplicate: false, hasDifference: false, cajasFisicas: null };
    this.view = 'scan'; this.render();
  },

  clearCandidate() { this.candidate = null; this.render(); },
  toggleDifference(checked) { if (!this.candidate) return; this.candidate.hasDifference = checked; if (!checked) this.candidate.cajasFisicas = null; this.render(); },
  async saveCandidate() {
    if (!this.candidate || this.candidate.duplicate) return;
    const livePosition = InventoryOperationModel.position(this.candidate.pallet);
    const result = await InventoryOperationService.confirm(this.session, this.candidate.item, { hasDifference: this.candidate.hasDifference, cajasFisicas: this.candidate.cajasFisicas, user: this.userAudit(), device: this.device(), livePosition, origenCodigo: this.candidate.resolved.origenCodigo, codigoOriginal: this.candidate.resolved.codigoOriginal });
    if (!result.ok) return this.toast(result.error, 'error');
    const code = this.candidate.item.idLote; this.candidate = null; this.render(); this.toast(`✓ ${code} guardado${result.difference ? ' · requiere revisión' : ''}.`, result.difference ? 'warning' : 'success');
  },

  changeBand(value) { this.band = this.session.almacen === 'POST TUNEL' && ['01', '02'].includes(value) ? value : Number(value); this.bandDetail = null; this.render(); },
  mountBand() {
    const target = document.getElementById('ioBandMap'); if (!target) return;
    this.renderer = new MapaIsometricRenderer(target, { cameraMode: this.session.almacen, data: MapaModel.getPallets(), onEmptyBand: () => {}, onSelect: pallet => { if (!pallet) return; this.bandDetail = pallet; const detail = document.getElementById('ioBandDetail'); if (detail) detail.innerHTML = this.bandPalletDetail(pallet); } });
    this.renderer.renderBand(this.band, MapaModel.getPallets());
  },

  openItemDetail(itemId) {
    const item = this.session.items.find(entry => entry.palletId === itemId); if (!item) return;
    const live = InventoryOperationModel.livePosition(item), root = document.getElementById('inventoryOperationModal');
    root.innerHTML = `<div class="io-modal-backdrop" onclick="if(event.target===this)InventoryOperationController.closeModal()"><section class="io-item-dialog"><header><div><span>DETALLE DEL CORTE</span><h2>${this.esc(item.idLote)}</h2></div><button onclick="InventoryOperationController.closeModal()">×</button></header><div><h3>${this.esc(item.descripcion)}</h3><p>${this.esc(item.numeroArticulo)} · Pallet ${this.esc(item.numeroPallet)}</p><dl><div><dt>Estado conteo</dt><dd>${this.esc(item.estadoConteo)}</dd></div><div><dt>Cajas sistema</dt><dd>${this.fmt(item.cajasSistema)}</dd></div><div><dt>Cajas físicas</dt><dd>${item.cajasFisicas === null ? '—' : this.fmt(item.cajasFisicas)}</dd></div><div><dt>Diferencia</dt><dd>${item.diferenciaCajas === null ? '—' : this.fmt(item.diferenciaCajas)}</dd></div><div><dt>Kilos sistema</dt><dd>${this.fmt(item.kilosSistema)} kg</dd></div><div><dt>Validación kilos</dt><dd>${this.esc(item.kilosValidacion || 'PENDIENTE')}</dd></div><div class="wide"><dt>Ubicación actual</dt><dd>${this.esc(InventoryOperationModel.locationText(live))}</dd></div><div class="wide"><dt>Ubicación al escanear</dt><dd>${this.esc(InventoryOperationModel.locationText(item.ubicacionEscaneo))}</dd></div></dl></div><footer><button onclick="InventoryOperationController.closeModal()">CERRAR</button></footer></section></div>`;
  },
  showDecision({ icon = '✓', eyebrow = 'CONFIRMACIÓN', title, message, confirmLabel = 'CONFIRMAR', tone = 'success', action }) {
    const root = document.getElementById('inventoryOperationModal'); if (!root) return;
    this._dialogAction = action;
    root.innerHTML = `<div class="io-modal-backdrop" onclick="if(event.target===this)InventoryOperationController.closeModal()"><section class="io-confirm-dialog ${this.esc(tone)}" role="dialog" aria-modal="true" aria-labelledby="ioConfirmTitle"><header><i>${this.esc(icon)}</i><div><span>${this.esc(eyebrow)}</span><h2 id="ioConfirmTitle">${this.esc(title)}</h2></div><button onclick="InventoryOperationController.closeModal()" aria-label="Cancelar">×</button></header><p>${this.esc(message)}</p><footer><button class="secondary" onclick="InventoryOperationController.closeModal()">VOLVER</button><button class="primary" onclick="InventoryOperationController.confirmDialog()">${this.esc(confirmLabel)}</button></footer></section></div>`;
  },
  showNotice(title, message, tone = 'warning') {
    this.showDecision({ icon: tone === 'warning' ? '!' : 'i', eyebrow: 'INFORMACIÓN DEL INVENTARIO', title, message, confirmLabel: 'ENTENDIDO', tone, action: () => {} });
  },
  confirmDialog() { const action = this._dialogAction; this.closeModal(); if (typeof action === 'function') action(); },
  closeModal() { this._dialogAction = null; const root = document.getElementById('inventoryOperationModal'); if (root) root.innerHTML = ''; },

  exportProgress() {
    if (!this.session) return;
    const state = this.session.estado === 'FINALIZADA' ? 'FINAL' : 'AVANCE', stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14), warehouse = this.session.almacen.replace(/\s+/g, '_');
    ExportService.descargarXlsx(`Inventario_${warehouse}_${state}_${stamp}.xlsx`, `Inventario ${this.session.almacen}`.slice(0, 31), InventoryOperationModel.exportRows(this.session));
    this.toast(`${state === 'FINAL' ? 'Inventario final' : 'Avance'} exportado para ${this.session.almacen}.`);
  },

  async closeInventory() {
    if (!this.session || this.session.estado === InventoryOperationModel.STATES.FINISHED) return;
    const metrics = InventoryOperationModel.metrics(this.session);
    this.showDecision({ icon: '✓', eyebrow: 'CIERRE DEFINITIVO', title: `Cerrar inventario ${this.session.almacen}`, message: `${this.fmt(metrics.pending)} pallet(s) pendientes pasarán a NO ESCANEADO. El snapshot y toda la auditoría se conservarán.`, confirmLabel: 'CERRAR INVENTARIO', tone: 'danger', action: () => this.confirmCloseInventory() });
  },
  async confirmCloseInventory() {
    if (!this.session || this.session.estado === InventoryOperationModel.STATES.FINISHED) return;
    const result = await InventoryOperationService.closeSession(this.session);
    if (!result.ok) return this.toast(result.error, 'error');
    this.session = result.session; this.view = 'all'; this.render(); this.toast('Inventario finalizado. Los pendientes quedaron como NO ESCANEADO.');
  },

  async scanCamera() {
    if (!navigator.mediaDevices?.getUserMedia) return this.toast('Este navegador no permite abrir la cámara. Usá lector o ingreso manual.', 'error');
    let stream;
    try {
      stream = await CameraScannerService.abrirStream();
      console.info(`Camera stream: ${CameraScannerService.describir(stream) || 'resolución no informada'}`);
      const native = 'BarcodeDetector' in window, root = document.getElementById('inventoryOperationModal');
      root.innerHTML = `<div class="io-modal-backdrop"><section class="io-camera-dialog"><header><div><span>ESCÁNER DE CÁMARA</span><h2>Enfocá pallet o caja</h2></div><button id="ioCameraClose">×</button></header><div class="scan-stage"><video autoplay playsinline muted></video></div><p>${native ? 'Lectura automática activa.' : 'Ingresá el código visible; este navegador no ofrece detección automática.'}</p><form><input autocomplete="off" placeholder="Código visible"><button>Resolver</button></form></section></div>`;
      const video = root.querySelector('video'); video.srcObject = stream; let timer = null, busy = false;
      const mejoras = CameraScannerService.potenciar(stream, root.querySelector('.scan-stage'));
      const close = () => { if (timer) clearInterval(timer); mejoras.cerrar(); stream?.getTracks().forEach(track => track.stop()); root.innerHTML = ''; if (this._stopCamera === close) this._stopCamera = null; };
      this._stopCamera = close;
      root.querySelector('#ioCameraClose').onclick = close;
      root.querySelector('form').onsubmit = event => { event.preventDefault(); const value = event.currentTarget.elements[0].value; if (!value) return; close(); this.resolveCode(value, 'CAMARA'); };
      if (native) { const detector = new BarcodeDetector({ formats: ['code_128', 'code_39', 'ean_13', 'ean_8', 'qr_code'] }); timer = setInterval(async () => { if (busy || video.readyState < 2) return; busy = true; try { const codes = await detector.detect(video); if (codes[0]?.rawValue) { const value = codes[0].rawValue; close(); this.resolveCode(value, 'CAMARA'); } } catch (_) {} finally { busy = false; } }, 240); }
    } catch (_) { stream?.getTracks().forEach(track => track.stop()); this.toast('No fue posible abrir la cámara. Revisá permisos o usá lector/ingreso manual.', 'error'); }
  },

  toast(message, type = 'success') { return NotificationService.show(message, { type }); }
};
