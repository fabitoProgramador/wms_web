/**
 * Núcleo visual del Panel de Control + Resumen Ejecutivo.
 *
 * Análisis Operacional y Monitor en Tiempo Real poseen controladores propios.
 * Este archivo conserva únicamente estado/helpers compartidos y Resumen.
 */
const DashboardController = {
  defaultDetailState: null,
  userSelectedState: null,
  stateSearch: '',
  stateSearchTimer: null,
  stateDetailRequestId: 0,
  resumenContainer: null,
  resumenActual: null,
  resumenClockTimer: null,
  analysisFilters: { camara: 'TODOS', periodo: '30D' },

  init(container, section = AppController.activeView) {
    if (section !== 'monitor_tiempo_real' && this.monitorRefreshTimer) {
      clearInterval(this.monitorRefreshTimer);
    }
    if (section === 'graficos') {
      if (typeof this.renderAnalisis !== 'function') return this.errorView(container, 'Análisis Operacional', new Error('Controlador de análisis no cargado.'));
      return this.renderAnalisis(container);
    }
    if (section === 'monitor_tiempo_real') {
      if (typeof this.renderMonitor !== 'function') return this.errorView(container, 'Monitor en Tiempo Real', new Error('Controlador de monitor no cargado.'));
      return this.renderMonitor(container);
    }
    this.defaultDetailState = null;
    this.userSelectedState = null;
    this.stateSearch = '';
    this.stateDetailRequestId += 1;
    return this.renderResumen(container);
  },

  escape(v) { return SeguridadService.escaparHtml(v); },

  colorEstado(nombre) {
    const key = Object.keys(COLORES_MAPA_ESTADO).find(k => DashboardModel.estadoIgual(k, nombre));
    return (key && COLORES_MAPA_ESTADO[key]) || '#64748b';
  },

  operationalHeader({ eyebrow = 'OPERACIÓN EN TIEMPO REAL', title = 'Resumen Ejecutivo', status = 'Sistema en línea' } = {}) {
    const user = UserModel.getCurrentUser() || {};
    const turn = TURNOS_OPERACIONALES.resolver();
    return `<section class="dashboard-operational-head panel-surface"><div class="dashboard-operational-title"><span>${this.escape(eyebrow)}</span><h1>${this.escape(title)}</h1><p><i></i> ${this.escape(status)} · ${this.escape(turn.zonaHoraria)}</p></div><div class="dashboard-operational-clock"><b id="dashboardOperationalTime">${TURNOS_OPERACIONALES.formatoHora()}</b><span id="dashboardOperationalDate">${this.escape(TURNOS_OPERACIONALES.formatoFecha())}</span></div><div class="dashboard-operational-turn"><small>TURNO ACTUAL</small><b id="dashboardOperationalTurn">${this.escape(turn.etiqueta)}</b><span>${turn.hora.toString().padStart(2, '0')}:00 · ${this.escape(turn.codigo)}</span></div><div class="dashboard-operational-user"><i>${this.escape(AppController.initials(user.name))}</i><span><small>USUARIO ACTIVO</small><b>${this.escape(user.name || 'Usuario')}</b><em>${this.escape(user.role || 'Sin cargo')}</em></span></div></section>`;
  },

  startOperationalClock() {
    clearInterval(this.resumenClockTimer);
    const update = () => {
      const turn = TURNOS_OPERACIONALES.resolver();
      const time = document.getElementById('dashboardOperationalTime');
      const date = document.getElementById('dashboardOperationalDate');
      const label = document.getElementById('dashboardOperationalTurn');
      if (time) time.textContent = TURNOS_OPERACIONALES.formatoHora();
      if (date) date.textContent = TURNOS_OPERACIONALES.formatoFecha();
      if (label) label.textContent = turn.etiqueta;
    };
    update();
    this.resumenClockTimer = setInterval(update, 30000);
  },

  empty(text) { return `<div class="panel-empty">${this.escape(text)}</div>`; },
  loading(text = 'Consultando backend…') { return `<div class="panel-empty">${this.escape(text)}</div>`; },
  detailState() { return this.userSelectedState || this.defaultDetailState; },

  errorView(container, title, error) {
    const message = error?.permiso
      ? 'Tu sesión no posee permisos para consultar esta información.'
      : error?.red
        ? 'No fue posible conectar con Supabase. Este módulo no utiliza datos locales de respaldo.'
        : (error?.message || 'No fue posible consultar el backend.');
    container.innerHTML = `<section class="panel-control-view">${this.operationalHeader({ title, status: 'Backend no disponible' })}<article class="panel-surface panel-empty"><b>${this.escape(message)}</b></article></section>`;
    this.startOperationalClock();
  },

  sparkline(data, color = '#10b981') {
    if (!data.length) return this.empty('Sin snapshots de ocupación registrados');
    const max = Math.max(...data.map(x => x.valor), 1);
    const min = Math.min(...data.map(x => x.valor));
    const values = data.map((x, i) => ({
      x: data.length === 1 ? 50 : i / (data.length - 1) * 100,
      y: 34 - ((x.valor - min) / Math.max(1, max - min)) * 26
    }));
    const points = values.map(p => `${p.x},${p.y}`).join(' ');
    const last = values.at(-1);
    const area = `0,38 ${points} 100,38`;
    return `<svg class="sparkline" viewBox="0 0 100 40" preserveAspectRatio="none" role="img" aria-label="Tendencia histórica de ocupación de cámara"><defs><linearGradient id="capacitySparkFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".34"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs><line class="sparkline-grid" x1="0" y1="38" x2="100" y2="38"/><polygon points="${area}" fill="url(#capacitySparkFill)"/><polyline points="${points}" fill="none" stroke="${color}" stroke-width="2.5" vector-effect="non-scaling-stroke"/><circle cx="${last.x}" cy="${last.y}" r="2.6" fill="${color}" vector-effect="non-scaling-stroke"/></svg>`;
  },

  async renderResumen(container) {
    this.resumenContainer = container;
    container.innerHTML = `<section class="panel-control-view">${this.operationalHeader()}${this.loading('Cargando Resumen Ejecutivo desde Supabase…')}</section>`;
    this.startOperationalClock();

    try {
      const r = await DashboardModel.resumen();
      if (this.resumenContainer !== container) return;
      this.resumenActual = r;

      if (!this.defaultDetailState || !r.porEstado.some(x => DashboardModel.estadoIgual(x.nombre, this.defaultDetailState) && x.pallets > 0)) {
        this.defaultDetailState = r.porEstado.find(x => x.pallets > 0)?.nombre || null;
      }
      if (this.userSelectedState && !r.porEstado.some(x => DashboardModel.estadoIgual(x.nombre, this.userSelectedState) && x.pallets > 0)) {
        this.userSelectedState = null;
      }

      const detailState = this.detailState();
      const capacidad = r.capacidad || 0;
      const disponibles = r.disponibles == null ? '—' : r.disponibles.toLocaleString('es-CL');
      const delta = r.tendenciaActual?.deltaPallets;
      const deltaTexto = delta == null
        ? 'BASE'
        : `${delta > 0 ? '↗ +' : delta < 0 ? '↘ ' : '→ '}${delta.toLocaleString('es-CL')} PLT`;
      const tendenciaDetalle = r.tendencia.length > 1
        ? 'Cambio neto entre sincronizaciones SAP'
        : 'Baseline inicial · se actualizará con nuevos snapshots SAP';

      container.innerHTML = `<section class="panel-control-view">
        ${this.operationalHeader()}
        <article class="capacity-hero panel-surface">
          <div class="capacity-ring" style="--pct:${r.ocupacion.toFixed(1)}"><div><strong>${r.ocupacion.toFixed(1)}%</strong></div></div>
          <div class="capacity-main"><h2>${r.stock.toLocaleString('es-CL')} <small>/ ${capacidad ? capacidad.toLocaleString('es-CL') : '—'} PLT</small></h2><p class="capacity-chamber">CÁMARA ${this.escape(r.camara || 'PROTER')}</p><div class="capacity-stats"><div><i>📦</i><span><em class="rot-largo">Cajas en cámara</em><em class="rot-corto">Cajas</em></span><b>${r.cajas.toLocaleString('es-CL')}</b></div><div><i>🟩</i><span><em class="rot-largo">Disponibles</em><em class="rot-corto">Disponibles</em></span><b>${disponibles}</b></div><div><i>❄️</i><span><em class="rot-largo">Cámaras activas</em><em class="rot-corto">Cámaras</em></span><b>${r.camaras}</b></div></div></div>
          <div class="capacity-trend"><div class="capacity-trend-meta"><span>TENDENCIA DE OCUPACIÓN</span><b>${deltaTexto}</b><small>${this.escape(tendenciaDetalle)}</small></div>${this.sparkline(r.tendencia)}</div>
        </article>
        <div class="state-kpi-grid" aria-label="Estados operacionales">${r.porEstado.map(x => this.kpiCard(x)).join('')}</div>
        <div id="dashboardStateDetail">${detailState ? this.stateDetailShell(detailState) : ''}</div>
      </section>`;

      container.querySelectorAll('.state-kpi').forEach(card => card.onclick = () => this.openStateDetail(card.dataset.state));
      this.bindStateDetail(container);
      this.startOperationalClock();
      if (detailState) await this.loadStateDetail(detailState);
    } catch (error) {
      this.errorView(container, 'Resumen Ejecutivo', error);
    }
  },

  kpiCard(x) {
    const inverse = ['VERIFICACIÓN', 'SIN DM', 'RECHAZO'].includes(x.nombre);
    const semaphore = x.pallets <= 5 ? 'ok' : x.pallets <= 15 ? 'warn' : 'danger';
    const icons = { 'VERIFICACIÓN': '🔎', 'SIN DM': '❔', RECHAZO: '⛔', LIBERADO: '✅', PROHIBICIONES: '🚫', 'LOTES INCOMPLETOS': '🧩', 'AUTORIZADOS A ENVIAR': '📤', 'SIN INFORMACIÓN': 'ℹ️', BLOQUEADOS: '🔒', PEDIDO: '🛒', REPROCESO: '♻️' };
    const active = this.userSelectedState && DashboardModel.estadoIgual(this.userSelectedState, x.nombre);
    const percentage = Math.max(0, Math.min(100, Number(x.porcentaje) || 0));
    return `<button type="button" class="state-kpi ${active ? 'active' : ''}" data-state="${this.escape(x.nombre)}" style="--state:${this.colorEstado(x.nombre)}" aria-pressed="${active ? 'true' : 'false'}" aria-label="Ver pallets en estado ${this.escape(x.nombre)}"><div class="state-kpi-top"><span class="state-icon">${icons[x.nombre] || '📦'}</span>${inverse ? `<i class="semaphore ${semaphore}" title="Semáforo inverso"></i>` : '<i class="state-open">›</i>'}</div><span class="state-name">${this.escape(x.nombre)}</span><strong>${x.pallets.toLocaleString('es-CL')}</strong><div class="state-foot"><span>${x.cajas.toLocaleString('es-CL')} cajas</span><span>${percentage.toFixed(1)}%</span></div><span class="state-progress" role="progressbar" aria-label="${this.escape(x.nombre)}: ${percentage.toFixed(1)} por ciento" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percentage.toFixed(1)}"><i style="width:${percentage.toFixed(3)}%"></i></span></button>`;
  },

  async openStateDetail(state) {
    const same = this.userSelectedState && DashboardModel.estadoIgual(this.userSelectedState, state);
    this.userSelectedState = same ? null : state;
    this.stateSearch = '';
    clearTimeout(this.stateSearchTimer);
    this.stateDetailRequestId += 1;
    if (!this.resumenContainer) return;

    const detail = this.resumenContainer.querySelector('#dashboardStateDetail');
    const detailState = this.detailState();
    if (detail) detail.innerHTML = detailState ? this.stateDetailShell(detailState) : '';
    this.resumenContainer.querySelectorAll('.state-kpi').forEach(card => {
      const active = this.userSelectedState && DashboardModel.estadoIgual(card.dataset.state, this.userSelectedState);
      card.classList.toggle('active', active);
      card.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    this.bindStateDetail(this.resumenContainer);
    if (!same && detailState) {
      requestAnimationFrame(() => detail?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
      await this.loadStateDetail(detailState);
    }
  },

  estadoResumen(state) {
    return this.resumenActual?.porEstado?.find(x => DashboardModel.estadoIgual(x.nombre, state)) || { pallets: 0, cajas: 0 };
  },

  stateDetailShell(state) {
    const summary = this.estadoResumen(state);
    return `<section class="state-detail panel-surface" style="--state:${this.colorEstado(state)}" aria-label="Detalle de ${this.escape(state)}">
      <header class="state-detail-head"><div><span>DETALLE OPERACIONAL</span><h2>${this.escape(state)}</h2><p>${Number(summary.pallets || 0).toLocaleString('es-CL')} pallets · ${Number(summary.cajas || 0).toLocaleString('es-CL')} cajas</p></div><button type="button" id="stateDetailClose" aria-label="Cerrar detalle">×</button></header>
      <div class="state-detail-toolbar"><label><span>Buscar dentro de ${this.escape(state)}</span><input id="stateDetailSearch" type="search" value="${this.escape(this.stateSearch)}" placeholder="Lote, artículo, descripción o ubicación…" autocomplete="off"></label><b id="stateDetailCount">Consultando…</b></div>
      <div class="state-pallet-list">${this.loading('Consultando detalle en Supabase…')}</div>
    </section>`;
  },

  bindStateDetail(container) {
    const detail = container.querySelector('#dashboardStateDetail');
    if (!detail || !this.detailState()) return;

    detail.querySelector('#stateDetailClose').onclick = () => {
      this.userSelectedState = null;
      this.defaultDetailState = null;
      this.stateSearch = '';
      clearTimeout(this.stateSearchTimer);
      this.stateDetailRequestId += 1;
      detail.innerHTML = '';
      this.resumenContainer?.querySelectorAll('.state-kpi').forEach(card => {
        card.classList.remove('active');
        card.setAttribute('aria-pressed', 'false');
      });
    };

    const input = detail.querySelector('#stateDetailSearch');
    input.oninput = () => {
      this.stateSearch = input.value;
      clearTimeout(this.stateSearchTimer);
      this.stateSearchTimer = setTimeout(() => this.loadStateDetail(this.detailState()), 280);
    };
  },

  async loadStateDetail(state = this.detailState()) {
    if (!state || !this.resumenContainer) return;
    const detail = this.resumenContainer.querySelector('#dashboardStateDetail');
    if (!detail) return;
    const list = detail.querySelector('.state-pallet-list');
    const count = detail.querySelector('#stateDetailCount');
    const busqueda = this.stateSearch;
    const requestId = ++this.stateDetailRequestId;
    if (list) list.innerHTML = this.loading('Consultando detalle en Supabase…');

    try {
      const result = await DashboardModel.estadoDetalle(state, { busqueda, limite: 200, offset: 0 });
      if (requestId !== this.stateDetailRequestId || state !== this.detailState() || busqueda !== this.stateSearch) return;
      if (count) count.textContent = `${result.total} resultado${result.total === 1 ? '' : 's'}`;
      if (list) list.innerHTML = this.stateRows(result.items);
      this.bindStateMapLinks(detail);
    } catch (error) {
      if (requestId !== this.stateDetailRequestId) return;
      if (count) count.textContent = 'Error de consulta';
      if (list) list.innerHTML = this.empty(error?.message || 'No fue posible consultar el detalle.');
    }
  },

  stateRows(items) {
    if (!items.length) return this.empty(this.stateSearch ? 'No hay coincidencias con esa búsqueda.' : 'No hay pallets en este estado.');
    return items.map(p => {
      const positioned = p.posicionesMapa === 1 && p.camara;
      const location = positioned
        ? `${p.camara} · Banda ${p.banda ?? '—'} · P${p.posicion ?? '—'} · ${p.altura || '—'}`
        : `${p.whsname || p.whscode || '—'} · ${p.ubicacionEstado === 'UBICACION_AMBIGUA' ? 'Ubicación ambigua' : 'Sin posición WMS'}`;
      const mapTitle = positioned ? 'Se habilitará con la migración del módulo Mapa' : 'Sin posición única en el mapa WMS';
      const estado = p.estadoWms || p.estadoOperativo || p.estadoSap || '';
      return `<article class="state-pallet-row"><span class="state-pallet-code">${this.escape(p.codigoVisual || p.itemcode || p.idLote)}</span><div class="state-pallet-main"><b>${this.escape(p.idLote)}</b><span>${this.escape(p.itemcode || '—')} · ${this.escape(p.itemname || 'Sin descripción')}</span></div><div class="state-pallet-location"><b>${this.escape(location)}</b><span>${p.cajas.toLocaleString('es-CL')} cajas · ${p.kilos.toLocaleString('es-CL')} kg${estado ? ` · ${this.escape(estado)}` : ''}</span></div><button type="button" class="state-map-link" data-id-lote="${this.escape(p.idLote)}" data-camara="${this.escape(p.camara || '')}" disabled title="${this.escape(mapTitle)}">${positioned ? 'Ubicar en mapa' : 'Sin posición'}</button></article>`;
    }).join('');
  },

  bindStateMapLinks() {
    // Panel no consulta MapaModel/localStorage. Se habilitará al migrar Mapa.
  }
};
