/**
 * Vistas de Resumen, Análisis y Monitor del Panel de Control.
 * Fuente de datos: DashboardModel -> RPC Supabase. Sin fallback local.
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
  monitorFilter: 'todos',
  monitorContainer: null,
  monitorRefreshTimer: null,
  monitorRefreshDebounce: null,
  _monitorEventsBound: false,

  init(container, section = AppController.activeView) {
    if (section !== 'monitor_tiempo_real') clearInterval(this.monitorRefreshTimer);
    if (section === 'graficos') return this.renderAnalisis(container);
    if (section === 'monitor_tiempo_real') return this.renderMonitor(container);
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
    const user = UserModel.getCurrentUser() || {}, turn = TURNOS_OPERACIONALES.resolver();
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
    const max = Math.max(...data.map(x => x.valor), 1), min = Math.min(...data.map(x => x.valor));
    const values = data.map((x, i) => ({ x: data.length === 1 ? 50 : i / (data.length - 1) * 100, y: 34 - ((x.valor - min) / Math.max(1, max - min)) * 26 }));
    const points = values.map(p => `${p.x},${p.y}`).join(' '), last = values.at(-1), area = `0,38 ${points} 100,38`;
    return `<svg class="sparkline" viewBox="0 0 100 40" preserveAspectRatio="none" role="img" aria-label="Tendencia histórica de ocupación de cámara"><defs><linearGradient id="capacitySparkFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".34"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs><line class="sparkline-grid" x1="0" y1="38" x2="100" y2="38"/><polygon points="${area}" fill="url(#capacitySparkFill)"/><polyline points="${points}" fill="none" stroke="${color}" stroke-width="2.5" vector-effect="non-scaling-stroke"/><circle cx="${last.x}" cy="${last.y}" r="2.6" fill="${color}" vector-effect="non-scaling-stroke"/></svg>`;
  },

  bars(items, colors = [], horizontal = false) {
    if (!items.length) return this.empty('No hay datos disponibles');
    const max = Math.max(...items.map(x => x.valor), 1);
    return `<div class="chart-bars ${horizontal ? 'horizontal' : ''}">${items.map((x, i) => {
      const valor = Number(x.valor || 0);
      const pct = valor > 0 ? Math.max(3, valor / max * 100) : 0;
      return `<div class="chart-bar-item"><div class="chart-value">${valor.toLocaleString('es-CL')}</div><div class="chart-bar-track"><span style="${horizontal ? 'width' : 'height'}:${pct}%;background:${colors[i] || '#10b981'}"></span></div><div class="chart-label" title="${this.escape(x.nombre)}">${this.escape(x.nombre)}</div></div>`;
    }).join('')}</div>`;
  },

  donut(items) {
    if (!items.length) return this.empty('No hay estados con pallets');
    let offset = 0;
    const total = items.reduce((s, x) => s + Number(x.pallets || 0), 0) || 1;
    const rings = items.map(x => {
      const dash = Number(x.pallets || 0) / total * 100;
      const circle = `<circle cx="20" cy="20" r="15.9" fill="none" stroke="${this.colorEstado(x.nombre)}" stroke-width="6" stroke-dasharray="${dash} ${100 - dash}" stroke-dashoffset="${-offset}"/>`;
      offset += dash;
      return circle;
    }).join('');
    return `<div class="donut-layout"><svg class="donut" viewBox="0 0 40 40" transform="rotate(-90)" aria-label="Distribución por estado">${rings}</svg><div class="chart-legend">${items.slice(0, 6).map(x => `<span><i style="background:${this.colorEstado(x.nombre)}"></i>${this.escape(x.nombre)} <b>${Number(x.pallets || 0).toLocaleString('es-CL')}</b></span>`).join('')}</div></div>`;
  },

  /* =========================== RESUMEN =========================== */

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
    // Intencionalmente vacío durante esta fase: no se permite que Panel vuelva
    // a consultar MapaModel/localStorage. Se habilitará cuando Mapa sea remoto.
  },

  /* =========================== ANÁLISIS ========================== */

  async renderAnalisis(container) {
    container.innerHTML = `<section class="panel-control-view">${this.operationalHeader({ eyebrow: 'ANÁLISIS DE LA OPERACIÓN', title: 'Análisis Operacional', status: 'Tendencias y capacidad en línea' })}${this.loading('Calculando análisis desde Supabase…')}</section>`;
    this.startOperationalClock();

    try {
      const a = await DashboardModel.analisis(this.analysisFilters);
      const periodoTexto = ({ HOY: 'Hoy', '7D': 'Últimos 7 días', '30D': 'Últimos 30 días', '90D': 'Últimos 90 días', TODO: 'Todo el registro' })[a.periodo] || a.periodo;
      const actividadDetalle = `${periodoTexto} · eventos WMS cerrados/registrados`;
      const alcanceTexto = a.camara === 'TODOS' ? 'PROTER + POST TÚNEL' : a.camara;
      const mapaDetalle = `${a.posicionados.toLocaleString('es-CL')} de ${a.capacidadMapa.toLocaleString('es-CL')} posiciones · ${a.ocupacionMapa.toFixed(1)}%`;

      container.innerHTML = `<section class="panel-control-view">
        ${this.operationalHeader({ eyebrow: 'ANÁLISIS DE LA OPERACIÓN', title: 'Análisis Operacional', status: 'Stock, tendencia y actividad desde Supabase' })}
        <section class="analysis-toolbar panel-surface" aria-label="Filtros de análisis"><div><span>ALCANCE ANALÍTICO</span><b>Stock actual + actividad del período seleccionado</b></div><label><span>Cámara</span><select id="analysisWarehouse"><option value="TODOS">PROTER + Post Túnel</option><option value="PROTER">Proter</option><option value="POST TUNEL">Post Túnel</option></select></label><label><span>Período de actividad</span><select id="analysisPeriod"><option value="HOY">Hoy</option><option value="7D">7 días</option><option value="30D">30 días</option><option value="90D">90 días</option><option value="TODO">Todo</option></select></label></section>
        <div class="analysis-summary" aria-label="Resumen analítico">
          ${this.analysisSummary('Pallets actuales', a.stock.toLocaleString('es-CL'), alcanceTexto, 'stock')}
          ${this.analysisSummary('Cajas actuales', a.cajas.toLocaleString('es-CL'), 'Saldo SAP de las cámaras', 'boxes')}
          ${this.analysisSummary('Ocupación de stock', `${a.ocupacionStock.toFixed(1)}%`, `${a.palletsStock.toLocaleString('es-CL')} de ${a.capacidadStock.toLocaleString('es-CL')} pallets · ${a.disponiblesStock.toLocaleString('es-CL')} disponibles`, a.ocupacionStock >= 85 ? 'risk' : 'capacity')}
          ${this.analysisSummary('Posiciones WMS', a.posicionados.toLocaleString('es-CL'), mapaDetalle, 'slots')}
        </div>
        <h2 class="group-title">Tendencias</h2><div class="analysis-grid">
          ${this.chartCard('Tendencia de ocupación', `${periodoTexto} · snapshots de stock por cámara`, this.occupancyTrendChart(a.tendenciaOcupacion))}
          ${this.chartCard('Actividad registrada', actividadDetalle, this.bars(a.actividad, ['#10b981','#ef4444','#06b6d4']))}
        </div><h2 class="group-title">Distribución</h2><div class="analysis-grid">
          ${this.chartCard('Distribución por Estado', 'Participación sobre pallets del alcance actual', this.donut(a.distribucion))}
          ${this.chartCard('Top 5 Productos', 'Artículos con más cajas dentro del alcance actual', this.bars(a.topProductos, [], true))}
        </div><h2 class="group-title">Capacidad</h2><div class="analysis-grid">
          ${this.chartCard('Ocupación de stock por Cámara', 'Pallets SAP sobre capacidad configurada', this.stockCapacityBars(a.camarasStock))}
          ${this.chartCard('Capacidad de stock utilizada', `${a.palletsStock.toLocaleString('es-CL')} de ${a.capacidadStock.toLocaleString('es-CL')} pallets`, `<div class="gauge-wrap"><div class="gauge ${a.ocupacionStock > 85 ? 'danger' : a.ocupacionStock > 60 ? 'warn' : ''}" style="--pct:${a.ocupacionStock}"><strong>${Math.round(a.ocupacionStock)}%</strong></div></div>`)}
          ${this.chartCard('Posiciones registradas en Mapa WMS', 'Capa física independiente del saldo SAP; no se usa para calcular ocupación de stock', this.capacityBars(a.camarasMapa), 'wide')}
        </div><h2 class="group-title">Lectura operacional actual</h2>
        ${this.chartCard('Distribución actual por etapa', 'Condiciones WMS actuales; pueden superponerse', this.flow(a.flujo), 'wide')}
        <h2 class="group-title">Insights calculados</h2><section class="analysis-insights panel-surface">${a.insights.length ? a.insights.map(x => `<article class="${x.tipo}"><i>${x.tipo === 'warning' ? '!' : x.tipo === 'success' ? '✓' : 'i'}</i><div><b>${this.escape(x.titulo)}</b><span>${this.escape(x.detalle)}</span></div></article>`).join('') : this.empty('No hay observaciones relevantes para este alcance.')}</section>
      </section>`;

      const warehouse = container.querySelector('#analysisWarehouse'), period = container.querySelector('#analysisPeriod');
      warehouse.value = a.camara;
      period.value = a.periodo;
      warehouse.onchange = () => { this.analysisFilters.camara = warehouse.value; this.renderAnalisis(container); };
      period.onchange = () => { this.analysisFilters.periodo = period.value; this.renderAnalisis(container); };
      this.startOperationalClock();
    } catch (error) {
      this.errorView(container, 'Análisis Operacional', error);
    }
  },

  analysisSummary(label, value, detail, tone) { return `<article class="analysis-summary-card ${tone}"><span>${this.escape(label)}</span><strong>${this.escape(value)}</strong><small>${this.escape(detail)}</small></article>`; },
  chartCard(title, sub, content, cls = '') { return `<article class="chart-card panel-surface ${cls}"><header><div><h3>${this.escape(title)}</h3><p>${this.escape(sub)}</p></div></header><div class="chart-body">${content}</div></article>`; },

  stockCapacityBars(items) {
    if (!items.length) return this.empty('No hay cámaras con stock en el alcance seleccionado');
    return `<div class="capacity-bars">${items.map(x => `<article><header><b>${this.escape(x.nombre)}</b><span>${x.porcentaje.toFixed(1)}%</span></header><div><i style="width:${Math.min(100, Math.max(0, x.porcentaje))}%"></i></div><footer><span>${x.pallets.toLocaleString('es-CL')} pallets</span><span>${x.disponibles.toLocaleString('es-CL')} disponibles · cap. ${x.capacidad.toLocaleString('es-CL')}</span></footer></article>`).join('')}</div>`;
  },

  capacityBars(items) {
    if (!items.length) return this.empty('No hay cámaras en el alcance seleccionado');
    return `<div class="capacity-bars">${items.map(x => `<article><header><b>${this.escape(x.nombre)}</b><span>${x.porcentaje.toFixed(1)}%</span></header><div><i style="width:${Math.min(100, Math.max(0, x.porcentaje))}%"></i></div><footer><span>${x.posicionados.toLocaleString('es-CL')} posicionados</span><span>${x.capacidad.toLocaleString('es-CL')} posiciones</span></footer></article>`).join('')}</div>`;
  },

  occupancyTrendChart(series) {
    const sets = (series || []).filter(x => Array.isArray(x.puntos) && x.puntos.length);
    if (!sets.length) return this.empty('Sin snapshots de ocupación para este período');
    const stamps = sets.flatMap(s => s.puntos.map(p => Date.parse(p.fecha || '')).filter(Number.isFinite));
    const minT = stamps.length ? Math.min(...stamps) : 0;
    const maxT = stamps.length ? Math.max(...stamps) : minT;
    const colors = ['#10b981', '#06b6d4'];
    const seriesSvg = sets.map((s, index) => {
      const color = colors[index % colors.length];
      const coords = s.puntos.map((p, i) => {
        const ts = Date.parse(p.fecha || '');
        const x = minT === maxT || !Number.isFinite(ts) ? (s.puntos.length === 1 ? 50 : 5 + i / Math.max(1, s.puntos.length - 1) * 90) : 5 + (ts - minT) / (maxT - minT) * 90;
        const pct = Math.max(0, Math.min(100, Number(p.valor || 0)));
        const y = 90 - pct * .75;
        return { x, y, pct };
      });
      const points = coords.map(p => `${p.x},${p.y}`).join(' ');
      return `${coords.length > 1 ? `<polyline points="${points}" fill="none" stroke="${color}" stroke-width="2.2" vector-effect="non-scaling-stroke"/>` : ''}${coords.map(p => `<circle cx="${p.x}" cy="${p.y}" r="2.3" fill="${color}" vector-effect="non-scaling-stroke"/>`).join('')}`;
    }).join('');
    const firstDate = stamps.length ? new Date(minT).toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit' }) : '—';
    const lastDate = stamps.length ? new Date(maxT).toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit' }) : '—';
    const legend = sets.map((s, index) => {
      const last = s.puntos.at(-1);
      const delta = last?.deltaPallets;
      const deltaText = delta == null ? 'baseline' : `${delta > 0 ? '+' : ''}${delta} PLT`;
      return `<span><i style="background:${colors[index % colors.length]}"></i>${this.escape(s.nombre)} <b>${Number(last?.valor || 0).toFixed(1)}%</b> · ${this.escape(deltaText)}</span>`;
    }).join('');
    return `<svg class="line-chart" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Tendencia de ocupación por cámara"><line x1="5" y1="90" x2="95" y2="90" stroke="currentColor" opacity=".12"/><line x1="5" y1="52.5" x2="95" y2="52.5" stroke="currentColor" opacity=".08"/>${seriesSvg}</svg><div class="axis-labels"><span>${firstDate}</span><span>${lastDate}</span></div><div class="chart-legend">${legend}</div>`;
  },

  lineChart(items) {
    if (!items.length) return this.empty('Sin registros para este período');
    const max = Math.max(...items.map(x => x.valor), 1), min = Math.min(...items.map(x => x.valor)), den = Math.max(1, max - min);
    const pts = items.map((x, i) => `${items.length === 1 ? 50 : 5 + i/(items.length-1)*90},${82 - (x.valor-min)/den*65}`).join(' ');
    return `<svg class="line-chart" viewBox="0 0 100 100" preserveAspectRatio="none"><defs><linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#10b981" stop-opacity=".45"/><stop offset="1" stop-color="#10b981" stop-opacity="0"/></linearGradient></defs><polygon points="5,90 ${pts} 95,90" fill="url(#area)"/><polyline points="${pts}" fill="none" stroke="#10b981" stroke-width="2" vector-effect="non-scaling-stroke"/></svg><div class="axis-labels"><span>${this.escape(items[0].fecha)}</span><span>${this.escape(items.at(-1).fecha)}</span></div>`;
  },

  flow(items) {
    const max = Math.max(...items.map(x => x.valor), 1);
    return `<div class="flow-chart">${items.map((x, i) => {
      const valor = Number(x.valor || 0);
      const width = valor > 0 ? Math.max(22, valor / max * 100) : 0;
      return `<div class="flow-step"><span>${this.escape(x.nombre)}</span><div style="width:${width}%">${valor.toLocaleString('es-CL')}</div>${i < items.length-1 ? '<i>›</i>' : ''}</div>`;
    }).join('')}</div>`;
  },

  /* ============================ MONITOR ========================== */

  async renderMonitor(container) {
    this.monitorContainer = container;
    container.innerHTML = `<section class="panel-control-view monitor-view">
      ${this.operationalHeader({ title: 'Monitor en Tiempo Real', status: 'Centro de actividad operacional' })}
      <section class="monitor-now panel-surface"><header><div><span>ESTADO OPERACIONAL ACTUAL</span><h2>Operación en curso</h2></div><time id="monitorLastUpdate">Actualizando…</time></header><div id="monitorNowGrid" class="monitor-now-grid"></div></section>
      <div id="monitorStats" class="monitor-stats" aria-label="Indicadores operacionales"></div>
      <div class="monitor-primary-grid">
        <article class="monitor-card monitor-feed-card panel-surface"><header class="monitor-card-head"><div><span>ACTIVIDAD OPERACIONAL</span><h3>Eventos registrados</h3></div><div id="monitorFeedFilters" class="monitor-feed-filters" role="group" aria-label="Filtrar eventos">${[['todos','Todos'],['mapa','Mapa'],['gruero','Gruero'],['verificacion','Verificaciones'],['inventario','Inventario'],['carga','Carga'],['operacion','Operaciones']].map(([id,label]) => `<button type="button" data-monitor-filter="${id}" class="${this.monitorFilter === id ? 'active' : ''}">${label}</button>`).join('')}</div></header><div id="monitorTimeline" class="timeline operational-feed"></div></article>
        <article class="monitor-card monitor-alert-card panel-surface"><header class="monitor-card-head"><div><span>PRIORIZACIÓN</span><h3>Alertas operacionales</h3></div></header><div id="monitorAlerts" class="alerts-list"></div></article>
      </div>
      <article class="monitor-card monitor-occupancy-card compact panel-surface"><header class="monitor-card-head"><div><span>DETALLE SECUNDARIO</span><h3>Ocupación física por cámara</h3></div></header><div id="monitorOccupancy" class="segment-list"></div></article>
    </section>`;
    this.bindMonitorFilters();
    this.bindMonitorUpdates();
    this.startOperationalClock();
    await this.refreshMonitor();
  },

  bindMonitorFilters() {
    this.monitorContainer?.querySelectorAll('[data-monitor-filter]').forEach(button => button.onclick = () => {
      this.monitorFilter = button.dataset.monitorFilter;
      this.monitorContainer.querySelectorAll('[data-monitor-filter]').forEach(x => x.classList.toggle('active', x === button));
      this.refreshMonitor();
    });
  },

  bindMonitorUpdates() {
    if (!this._monitorEventsBound) {
      this._monitorEventsBound = true;
      ['online','offline'].forEach(name => window.addEventListener(name, () => this.scheduleMonitorRefresh()));
    }
    clearInterval(this.monitorRefreshTimer);
    this.monitorRefreshTimer = setInterval(() => {
      if (AppController.activeView === 'monitor_tiempo_real') this.refreshMonitor();
    }, 15000);
  },

  scheduleMonitorRefresh() {
    if (AppController.activeView !== 'monitor_tiempo_real') return;
    clearTimeout(this.monitorRefreshDebounce);
    this.monitorRefreshDebounce = setTimeout(() => this.refreshMonitor(), 180);
  },

  patchHtml(id, html) {
    const node = this.monitorContainer?.querySelector(`#${id}`);
    if (node && node.innerHTML !== html) node.innerHTML = html;
  },

  async refreshMonitor() {
    if (AppController.activeView !== 'monitor_tiempo_real' || !this.monitorContainer) return;

    if (!navigator.onLine) {
      this.patchHtml('monitorNowGrid', [
        ['Conectividad', 'Sin conexión', 'Panel sin fallback local', 'warning'],
        ['Backend', 'No disponible', 'Se requiere Supabase para datos operacionales', 'critical']
      ].map(x => `<article class="${x[3]}"><span>${x[0]}</span><b>${this.escape(x[1])}</b><small>${this.escape(x[2])}</small></article>`).join(''));
      this.patchHtml('monitorTimeline', this.empty('Sin conexión con Supabase. No se muestran datos locales como reemplazo.'));
      return;
    }

    try {
      const m = await DashboardModel.monitor(this.monitorFilter);
      if (AppController.activeView !== 'monitor_tiempo_real' || !this.monitorContainer) return;
      const latest = m.actividad[0];

      this.patchHtml('monitorNowGrid', [
        ['Conectividad', 'En línea', 'Supabase disponible', 'success'],
        ['Backend', 'Sincronizado', 'Fuente de verdad: Supabase', 'success'],
        ['Última actividad', latest ? this.eventTime(latest.timestamp) : 'Sin eventos', latest ? latest.titulo : 'No hay registros fechados', 'info'],
        ['Stock actual', m.stock.toLocaleString('es-CL'), `${m.cajas.toLocaleString('es-CL')} cajas`, 'info']
      ].map(x => `<article class="${x[3]}"><span>${x[0]}</span><b>${this.escape(x[1])}</b><small>${this.escape(x[2])}</small></article>`).join(''));

      this.patchHtml('monitorStats', [
        ['Cámaras con atención', m.criticas, 'danger'],
        ['Ocupación física', `${m.ocupacionFisica.toFixed(1)}%`, 'info'],
        ['Pedidos', m.pedidos, 'pink'],
        ['Reproceso', m.reproceso, 'purple']
      ].map(x => `<article class="monitor-stat ${x[2]}"><span>${x[0]}</span><strong>${x[1]}</strong></article>`).join(''));

      this.patchHtml('monitorTimeline', m.actividad.length ? m.actividad.slice(0, 50).map(event => this.monitorEvent(event)).join('') : this.empty('No existen eventos registrados para este filtro.'));
      this.patchHtml('monitorAlerts', m.alertas.length ? m.alertas.map(a => `<div class="alert ${a.nivel}"><i>${a.nivel === 'critica' ? '×' : a.nivel === 'advertencia' || a.nivel === 'atencion' ? '!' : 'i'}</i><p><b>${this.escape(a.titulo)}</b><span>${this.escape(a.detalle)}</span></p></div>`).join('') : `<div class="alert correcta"><i>✓</i><p><b>Operación sin alertas activas</b><span>No se detectaron condiciones que requieran atención.</span></p></div>`);
      this.patchHtml('monitorOccupancy', m.ocupacionCamaras.map(c => `<article><span><b>${this.escape(c.nombre)}</b><em>${c.total} posiciones · ${c.ocupacion.toFixed(1)}%</em></span><div><i style="width:${Math.min(100,c.ocupacion)}%"></i></div><small>${c.problemas} observados · ${c.capacidad} posiciones físicas</small></article>`).join('') || this.empty('No hay cámaras configuradas.'));

      const updated = this.monitorContainer.querySelector('#monitorLastUpdate');
      if (updated) updated.textContent = `Actualizado ${this.eventTime(Date.parse(m.actualizadoEn || '') || Date.now())}`;
    } catch (error) {
      this.patchHtml('monitorNowGrid', `<article class="critical"><span>Backend</span><b>No disponible</b><small>${this.escape(error?.message || 'Error de consulta')}</small></article>`);
      this.patchHtml('monitorTimeline', this.empty('No fue posible obtener eventos de Supabase.'));
      this.patchHtml('monitorAlerts', this.empty('No fue posible calcular alertas sin backend.'));
      this.patchHtml('monitorOccupancy', this.empty('No fue posible consultar ocupación.'));
    }
  },

  eventTime(timestamp) {
    return timestamp ? new Date(timestamp).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }) : '—';
  },

  monitorEvent(event) {
    const icons = { mapa: '⌖', gruero: '↔', verificacion: '✓', inventario: '▣', carga: '⇩', operacion: '◆' };
    const meta = [event.ubicacion, event.usuario, event.sincronizacion].filter(Boolean).join(' · ');
    return `<article class="monitor-event ${this.escape(event.severidad)}" data-event-type="${this.escape(event.tipo)}"><time>${this.eventTime(event.timestamp)}</time><i>${icons[event.tipo] || '•'}</i><div><header><b>${this.escape(event.titulo)}</b>${event.pallet ? `<strong>${this.escape(event.pallet)}</strong>` : ''}</header>${event.detalle ? `<p>${this.escape(event.detalle)}</p>` : ''}${meta ? `<small>${this.escape(meta)}</small>` : ''}</div></article>`;
  }
};
