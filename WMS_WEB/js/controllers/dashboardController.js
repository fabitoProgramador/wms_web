/** Vistas funcionales de Resumen, Análisis y Monitor del Panel de Control. */
const DashboardController = {
  defaultDetailState: null,
  userSelectedState: null,
  stateSearch: '',
  resumenContainer: null,
  resumenClockTimer: null,
  analysisFilters: { camara: 'TODOS', periodo: '30D' },
  monitorFilter: 'todos',
  monitorRefreshTimer: null,
  monitorRefreshDebounce: null,
  init(container, section = AppController.activeView) {
    if (section !== 'monitor_tiempo_real') clearInterval(this.monitorRefreshTimer);
    if (section === 'graficos') return this.renderAnalisis(container);
    if (section === 'monitor_tiempo_real') return this.renderMonitor(container);
    this.defaultDetailState = null;
    this.userSelectedState = null;
    this.stateSearch = '';
    this.renderResumen(container);
  },

  escape(v) { const d = document.createElement('div'); d.textContent = String(v ?? ''); return d.innerHTML; },
  colorEstado(nombre) {
    const key = Object.keys(COLORES_MAPA_ESTADO).find(k => PanelControlModel.estadoIgual(k, nombre));
    return (key && COLORES_MAPA_ESTADO[key]) || '#64748b';
  },
  header(title, subtitle, extra = '') { return `<div class="panel-view-head"><div><h1>${title}</h1><p>${subtitle}</p></div>${extra}</div>`; },
  operationalHeader({ eyebrow = 'OPERACIÓN EN TIEMPO REAL', title = 'Resumen Ejecutivo', status = 'Sistema en línea' } = {}) {
    const user = UserModel.getCurrentUser() || {}, turn = TURNOS_OPERACIONALES.resolver();
    return `<section class="dashboard-operational-head panel-surface"><div class="dashboard-operational-title"><span>${this.escape(eyebrow)}</span><h1>${this.escape(title)}</h1><p><i></i> ${this.escape(status)} · ${this.escape(turn.zonaHoraria)}</p></div><div class="dashboard-operational-clock"><b id="dashboardOperationalTime">${TURNOS_OPERACIONALES.formatoHora()}</b><span id="dashboardOperationalDate">${this.escape(TURNOS_OPERACIONALES.formatoFecha())}</span></div><div class="dashboard-operational-turn"><small>TURNO ACTUAL</small><b id="dashboardOperationalTurn">${this.escape(turn.etiqueta)}</b><span>${turn.hora.toString().padStart(2, '0')}:00 · ${this.escape(turn.codigo)}</span></div><div class="dashboard-operational-user"><i>${this.escape(AppController.initials(user.name))}</i><span><small>USUARIO ACTIVO</small><b>${this.escape(user.name || 'Usuario')}</b><em>${this.escape(user.role || 'Sin cargo')}</em></span></div></section>`;
  },
  startOperationalClock() {
    clearInterval(this.resumenClockTimer);
    const update = () => { const turn = TURNOS_OPERACIONALES.resolver(), time = document.getElementById('dashboardOperationalTime'), date = document.getElementById('dashboardOperationalDate'), label = document.getElementById('dashboardOperationalTurn'); if (time) time.textContent = TURNOS_OPERACIONALES.formatoHora(); if (date) date.textContent = TURNOS_OPERACIONALES.formatoFecha(); if (label) label.textContent = turn.etiqueta; };
    update(); this.resumenClockTimer = setInterval(update, 30000);
  },
  empty(text) { return `<div class="panel-empty">${text}</div>`; },
  detailState() { return this.userSelectedState || this.defaultDetailState; },

  sparkline(data, color = '#10b981') {
    if (!data.length) return this.empty('Sin historial de fechas');
    const max = Math.max(...data.map(x => x.valor), 1), min = Math.min(...data.map(x => x.valor));
    const values = data.map((x, i) => ({ x: data.length === 1 ? 50 : i / (data.length - 1) * 100, y: 34 - ((x.valor - min) / Math.max(1, max - min)) * 26 }));
    const points = values.map(p => `${p.x},${p.y}`).join(' '), last = values.at(-1), area = `0,38 ${points} 100,38`;
    return `<svg class="sparkline" viewBox="0 0 100 40" preserveAspectRatio="none" role="img" aria-label="Tendencia de ocupación según admisiones"><defs><linearGradient id="capacitySparkFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".34"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs><line class="sparkline-grid" x1="0" y1="38" x2="100" y2="38"/><polygon points="${area}" fill="url(#capacitySparkFill)"/><polyline points="${points}" fill="none" stroke="${color}" stroke-width="2.5" vector-effect="non-scaling-stroke"/><circle cx="${last.x}" cy="${last.y}" r="2.6" fill="${color}" vector-effect="non-scaling-stroke"/></svg>`;
  },
  bars(items, colors = [], horizontal = false) {
    if (!items.length) return this.empty('No hay datos disponibles');
    const max = Math.max(...items.map(x => x.valor), 1);
    return `<div class="chart-bars ${horizontal ? 'horizontal' : ''}">${items.map((x, i) => `<div class="chart-bar-item"><div class="chart-value">${x.valor.toLocaleString('es-CL')}</div><div class="chart-bar-track"><span style="${horizontal ? 'width' : 'height'}:${Math.max(3, x.valor / max * 100)}%;background:${colors[i] || '#10b981'}"></span></div><div class="chart-label" title="${this.escape(x.nombre)}">${this.escape(x.nombre)}</div></div>`).join('')}</div>`;
  },
  donut(items) {
    if (!items.length) return this.empty('No hay estados con pallets');
    let offset = 0, total = items.reduce((s, x) => s + x.pallets, 0);
    const rings = items.map(x => { const dash = x.pallets / total * 100, circle = `<circle cx="20" cy="20" r="15.9" fill="none" stroke="${this.colorEstado(x.nombre)}" stroke-width="6" stroke-dasharray="${dash} ${100 - dash}" stroke-dashoffset="${-offset}"/>`; offset += dash; return circle; }).join('');
    return `<div class="donut-layout"><svg class="donut" viewBox="0 0 40 40" transform="rotate(-90)" aria-label="Distribución por estado">${rings}</svg><div class="chart-legend">${items.slice(0, 6).map(x => `<span><i style="background:${this.colorEstado(x.nombre)}"></i>${this.escape(x.nombre)} <b>${x.pallets}</b></span>`).join('')}</div></div>`;
  },

  renderResumen(container) {
    this.resumenContainer = container;
    const r = PanelControlModel.resumen();
    if (!this.defaultDetailState || !r.porEstado.some(x => PanelControlModel.estadoIgual(x.nombre, this.defaultDetailState) && x.pallets > 0)) this.defaultDetailState = r.porEstado.find(x => x.pallets > 0)?.nombre || null;
    if (this.userSelectedState && !r.porEstado.some(x => PanelControlModel.estadoIgual(x.nombre, this.userSelectedState) && x.pallets > 0)) this.userSelectedState = null;
    const detailState = this.detailState();
    const first = r.tendencia[0]?.valor || 0, last = r.tendencia.at(-1)?.valor || 0, variation = first ? Math.round((last - first) / first * 100) : 0;
    container.innerHTML = `<section class="panel-control-view">
      ${this.operationalHeader()}
      <article class="capacity-hero panel-surface">
        <div class="capacity-ring" style="--pct:${r.ocupacion.toFixed(1)}"><div><strong>${r.ocupacion.toFixed(1)}%</strong></div></div>
        <div class="capacity-main"><h2>${r.stock.toLocaleString('es-CL')} <small>/ ${PanelControlModel.CAPACIDAD_TOTAL} PLT</small></h2><p class="capacity-chamber">CÁMARA PROTER</p><div class="capacity-stats"><div><i>📦</i><span><em class="rot-largo">Cajas en cámara</em><em class="rot-corto">Cajas</em></span><b>${r.cajas.toLocaleString('es-CL')}</b></div><div><i>🟩</i><span><em class="rot-largo">Disponibles</em><em class="rot-corto">Disponibles</em></span><b>${r.disponibles.toLocaleString('es-CL')}</b></div><div><i>❄️</i><span><em class="rot-largo">Cámaras activas</em><em class="rot-corto">Cámaras</em></span><b>${r.camaras}</b></div></div></div>
        <div class="capacity-trend"><div class="capacity-trend-meta"><span>TENDENCIA OCUPACIÓN</span><b class="${variation < 0 ? 'negative' : ''}">${variation >= 0 ? '↗' : '↘'} ${Math.abs(variation)}%</b><small>Últimos ingresos registrados</small></div>${this.sparkline(r.tendencia, variation < 0 ? '#ef4444' : '#10b981')}</div>
      </article>
      <div class="state-kpi-grid" aria-label="Estados operacionales">${r.porEstado.map(x => this.kpiCard(x)).join('')}</div>
      <div id="dashboardStateDetail">${detailState ? this.stateDetail(detailState) : ''}</div>
    </section>`;
    container.querySelectorAll('.state-kpi').forEach(card => card.onclick = () => this.openStateDetail(card.dataset.state));
    this.bindStateDetail(container);
    this.startOperationalClock();
  },
  kpiCard(x) {
    const inverse = ['VERIFICACIÓN', 'SIN DM', 'RECHAZO'].includes(x.nombre), semaphore = x.pallets <= 5 ? 'ok' : x.pallets <= 15 ? 'warn' : 'danger';
    const icons = { 'VERIFICACIÓN': '🔎', 'SIN DM': '❔', RECHAZO: '⛔', LIBERADO: '✅', PROHIBICIONES: '🚫', 'LOTES INCOMPLETOS': '🧩', 'AUTORIZADOS A ENVIAR': '📤', 'SIN INFORMACIÓN': 'ℹ️', BLOQUEADOS: '🔒', PEDIDO: '🛒', REPROCESO: '♻️' };
    const active = this.userSelectedState && PanelControlModel.estadoIgual(this.userSelectedState, x.nombre);
    const percentage = Math.max(0, Math.min(100, Number(x.porcentaje) || 0));
    return `<button type="button" class="state-kpi ${active ? 'active' : ''}" data-state="${this.escape(x.nombre)}" style="--state:${this.colorEstado(x.nombre)}" aria-pressed="${active ? 'true' : 'false'}" aria-label="Ver pallets en estado ${this.escape(x.nombre)}"><div class="state-kpi-top"><span class="state-icon">${icons[x.nombre] || '📦'}</span>${inverse ? `<i class="semaphore ${semaphore}" title="Semáforo inverso"></i>` : '<i class="state-open">›</i>'}</div><span class="state-name">${this.escape(x.nombre)}</span><strong>${x.pallets.toLocaleString('es-CL')}</strong><div class="state-foot"><span>${x.cajas.toLocaleString('es-CL')} cajas</span><span>${percentage.toFixed(1)}%</span></div><span class="state-progress" role="progressbar" aria-label="${this.escape(x.nombre)}: ${percentage.toFixed(1)} por ciento" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percentage.toFixed(1)}"><i style="width:${percentage.toFixed(3)}%"></i></span></button>`;
  },

  openStateDetail(state) {
    const same = this.userSelectedState && PanelControlModel.estadoIgual(this.userSelectedState, state);
    this.userSelectedState = same ? null : state;
    this.stateSearch = '';
    if (!this.resumenContainer) return;
    const detail = this.resumenContainer.querySelector('#dashboardStateDetail');
    const detailState = this.detailState();
    if (detail) detail.innerHTML = detailState ? this.stateDetail(detailState) : '';
    this.resumenContainer.querySelectorAll('.state-kpi').forEach(card => { const active = this.userSelectedState && PanelControlModel.estadoIgual(card.dataset.state, this.userSelectedState); card.classList.toggle('active', active); card.setAttribute('aria-pressed', active ? 'true' : 'false'); });
    this.bindStateDetail(this.resumenContainer);
    if (!same) requestAnimationFrame(() => detail?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  },

  statePallets(state = this.detailState()) {
    const query = this.stateSearch.trim().toLocaleLowerCase('es');
    return PanelControlModel.pallets().filter(p => PanelControlModel.estadoIgual(p.estado, state)).filter(p => {
      if (!query) return true;
      return [PalletModel.codigoVisualLegible(p), PalletModel.idLoteReal(p), p.articulo, PalletModel.descripcion(p), p.ubicacion, p.banda, p.posicion]
        .some(value => String(value ?? '').toLocaleLowerCase('es').includes(query));
    });
  },

  stateDetail(state) {
    const all = PanelControlModel.pallets().filter(p => PanelControlModel.estadoIgual(p.estado, state));
    const pallets = this.statePallets(state), cajas = all.reduce((sum, p) => sum + (Number(p.cajas) || 0), 0);
    return `<section class="state-detail panel-surface" style="--state:${this.colorEstado(state)}" aria-label="Detalle de ${this.escape(state)}">
      <header class="state-detail-head"><div><span>DETALLE OPERACIONAL</span><h2>${this.escape(state)}</h2><p>${all.length.toLocaleString('es-CL')} pallets · ${cajas.toLocaleString('es-CL')} cajas</p></div><button type="button" id="stateDetailClose" aria-label="Cerrar detalle">×</button></header>
      <div class="state-detail-toolbar"><label><span>Buscar dentro de ${this.escape(state)}</span><input id="stateDetailSearch" type="search" value="${this.escape(this.stateSearch)}" placeholder="Lote, artículo, descripción o ubicación…" autocomplete="off"></label><b id="stateDetailCount">${pallets.length} resultado${pallets.length === 1 ? '' : 's'}</b></div>
      <div class="state-pallet-list">${this.stateRows(pallets)}</div>
    </section>`;
  },

  stateRows(pallets) {
    if (!pallets.length) return this.empty(this.stateSearch ? 'No hay coincidencias con esa búsqueda.' : 'No hay pallets en este estado.');
    return pallets.map(p => {
      const positioned = p.banda !== null && p.banda !== undefined;
      const location = positioned ? `${p.ubicacion || '—'} · Banda ${p.banda} · P${p.posicion} · ${p.altura || '—'}` : `${p.ubicacion || '—'} · Sin posición`;
      return `<article class="state-pallet-row"><span class="state-pallet-code">${this.escape(PalletModel.codigoVisualLegible(p))}</span><div class="state-pallet-main"><b>${this.escape(PalletModel.idLoteReal(p))}</b><span>${this.escape(p.articulo || '—')} · ${this.escape(PalletModel.descripcion(p))}</span></div><div class="state-pallet-location"><b>${this.escape(location)}</b><span>${(Number(p.cajas) || 0).toLocaleString('es-CL')} cajas · ${PalletModel.kilos(p).toLocaleString('es-CL')} kg</span></div><button type="button" class="state-map-link" data-pallet-id="${this.escape(p.id)}" ${positioned ? '' : 'disabled'}>${positioned ? 'Ubicar en mapa' : 'Sin posición'}</button></article>`;
    }).join('');
  },

  bindStateDetail(container) {
    const detail = container.querySelector('#dashboardStateDetail'); if (!detail || !this.detailState()) return;
    detail.querySelector('#stateDetailClose').onclick = () => { this.userSelectedState = null; this.defaultDetailState = null; this.stateSearch = ''; detail.innerHTML = ''; this.resumenContainer.querySelectorAll('.state-kpi').forEach(card => { card.classList.remove('active'); card.setAttribute('aria-pressed', 'false'); }); };
    const input = detail.querySelector('#stateDetailSearch');
    input.oninput = () => {
      this.stateSearch = input.value;
      const pallets = this.statePallets();
      detail.querySelector('.state-pallet-list').innerHTML = this.stateRows(pallets);
      detail.querySelector('#stateDetailCount').textContent = `${pallets.length} resultado${pallets.length === 1 ? '' : 's'}`;
      this.bindStateMapLinks(detail);
    };
    this.bindStateMapLinks(detail);
  },

  bindStateMapLinks(root) { root.querySelectorAll('.state-map-link:not(:disabled)').forEach(button => button.onclick = () => this.goToPallet(button.dataset.palletId)); },
  goToPallet(id) {
    const pallet = PanelControlModel.pallets().find(p => p.id === id); if (!pallet) return;
    MapaController.selectedPalletId = id;
    AppController.navigate(pallet.ubicacion === 'POST TUNEL' ? 'mapa_postunel' : 'mapa_vista');
    setTimeout(() => { const cell = document.querySelector(`.map-view-layer:not([hidden]) [data-pallet-id="${CSS.escape(id)}"]`); cell?.scrollIntoView({ block: 'center', inline: 'center' }); cell?.click(); }, 80);
  },

  renderAnalisis(container) {
    const a = PanelControlModel.analisis(this.analysisFilters), periodoTexto = ({ HOY: 'Hoy', '7D': 'Últimos 7 días', '30D': 'Últimos 30 días', '90D': 'Últimos 90 días', TODO: 'Todo el registro' })[a.periodo];
    const actividadDetalle = a.camara === 'TODOS' ? `${periodoTexto} · verificaciones, rechazos y cargas` : `${periodoTexto} · cargas del almacén; verificaciones sin almacén informado`;
    container.innerHTML = `<section class="panel-control-view">
      ${this.operationalHeader({ eyebrow: 'ANÁLISIS DE LA OPERACIÓN', title: 'Análisis Operacional', status: 'Tendencias y capacidad en línea' })}
      <section class="analysis-toolbar panel-surface" aria-label="Filtros de análisis"><div><span>ALCANCE ANALÍTICO</span><b>Datos actuales y registros operacionales</b></div><label><span>Almacén</span><select id="analysisWarehouse"><option value="TODOS">Todos</option><option value="PROTER">Proter</option><option value="POST TUNEL">Post Túnel</option></select></label><label><span>Período de registros</span><select id="analysisPeriod"><option value="HOY">Hoy</option><option value="7D">7 días</option><option value="30D">30 días</option><option value="90D">90 días</option><option value="TODO">Todo</option></select></label></section>
      <div class="analysis-summary" aria-label="Resumen analítico">
        ${this.analysisSummary('Pallets actuales', a.stock, a.camara === 'TODOS' ? 'Ambos almacenes' : a.camara, 'stock')}
        ${this.analysisSummary('Cajas actuales', a.cajas.toLocaleString('es-CL'), 'Fuente única de stock', 'boxes')}
        ${this.analysisSummary('Posiciones utilizadas', a.posicionados, `${a.capacidadTotal.toLocaleString('es-CL')} posiciones físicas`, 'slots')}
        ${this.analysisSummary('Ocupación física', `${a.ocupacion.toFixed(1)}%`, 'Pallets posicionados', a.ocupacion >= 85 ? 'risk' : 'capacity')}
      </div>
      <h2 class="group-title">Tendencias</h2><div class="analysis-grid">
        ${this.chartCard('Ingresos registrados', `${periodoTexto} · pallets presentes actualmente`, this.lineChart(a.ingresos))}
        ${this.chartCard('Actividad registrada', actividadDetalle, this.bars(a.actividad, ['#10b981','#ef4444','#06b6d4']))}
      </div><h2 class="group-title">Distribución</h2><div class="analysis-grid">
        ${this.chartCard('Distribución por Estado', 'Participación sobre pallets almacenados', this.donut(a.distribucion))}
        ${this.chartCard('Top 5 Productos', 'Artículos con más cajas en el stock actual', this.bars(a.topProductos, [], true))}
      </div><h2 class="group-title">Capacidad</h2><div class="analysis-grid">
        ${this.chartCard('Ocupación física por Cámara', 'Posiciones utilizadas sobre la configuración real del mapa', this.capacityBars(a.camaras))}
        ${this.chartCard('Capacidad física utilizada', `${a.posicionados} de ${a.capacidadTotal} posiciones`, `<div class="gauge-wrap"><div class="gauge ${a.ocupacion > 85 ? 'danger' : a.ocupacion > 60 ? 'warn' : ''}" style="--pct:${a.ocupacion}"><strong>${Math.round(a.ocupacion)}%</strong></div></div>`)}
      </div><h2 class="group-title">Lectura operacional actual</h2>
      ${this.chartCard('Distribución actual por etapa', 'Composición actual; no representa transiciones históricas', this.flow(a.flujo), 'wide')}
      <h2 class="group-title">Insights calculados</h2><section class="analysis-insights panel-surface">${a.insights.length ? a.insights.map(x => `<article class="${x.tipo}"><i>${x.tipo === 'warning' ? '!' : x.tipo === 'success' ? '✓' : 'i'}</i><div><b>${this.escape(x.titulo)}</b><span>${this.escape(x.detalle)}</span></div></article>`).join('') : this.empty('No hay observaciones relevantes para este alcance.')}</section>
    </section>`;
    const warehouse = container.querySelector('#analysisWarehouse'), period = container.querySelector('#analysisPeriod');
    warehouse.value = a.camara; period.value = a.periodo;
    warehouse.onchange = () => { this.analysisFilters.camara = warehouse.value; this.renderAnalisis(container); };
    period.onchange = () => { this.analysisFilters.periodo = period.value; this.renderAnalisis(container); };
    this.startOperationalClock();
  },
  analysisSummary(label, value, detail, tone) { return `<article class="analysis-summary-card ${tone}"><span>${this.escape(label)}</span><strong>${this.escape(value)}</strong><small>${this.escape(detail)}</small></article>`; },
  chartCard(title, sub, content, cls = '') { return `<article class="chart-card panel-surface ${cls}"><header><div><h3>${title}</h3><p>${sub}</p></div></header><div class="chart-body">${content}</div></article>`; },
  capacityBars(items) {
    if (!items.length) return this.empty('No hay cámaras en el alcance seleccionado');
    return `<div class="capacity-bars">${items.map(x => `<article><header><b>${this.escape(x.nombre)}</b><span>${x.porcentaje.toFixed(1)}%</span></header><div><i style="width:${Math.min(100, x.porcentaje)}%"></i></div><footer><span>${x.posicionados} posicionados</span><span>${x.capacidad} posiciones</span></footer></article>`).join('')}</div>`;
  },
  lineChart(items) {
    if (!items.length) return this.empty('Sin fechas de admisión/ingreso');
    const max = Math.max(...items.map(x => x.valor), 1), min = Math.min(...items.map(x => x.valor)), den = Math.max(1, max - min);
    const pts = items.map((x, i) => `${items.length === 1 ? 50 : 5 + i/(items.length-1)*90},${82 - (x.valor-min)/den*65}`).join(' ');
    return `<svg class="line-chart" viewBox="0 0 100 100" preserveAspectRatio="none"><defs><linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#10b981" stop-opacity=".45"/><stop offset="1" stop-color="#10b981" stop-opacity="0"/></linearGradient></defs><polygon points="5,90 ${pts} 95,90" fill="url(#area)"/><polyline points="${pts}" fill="none" stroke="#10b981" stroke-width="2" vector-effect="non-scaling-stroke"/></svg><div class="axis-labels"><span>${this.escape(items[0].fecha)}</span><span>${this.escape(items.at(-1).fecha)}</span></div>`;
  },
  flow(items) { const max = Math.max(...items.map(x => x.valor), 1); return `<div class="flow-chart">${items.map((x, i) => `<div class="flow-step"><span>${x.nombre}</span><div style="width:${Math.max(22, x.valor/max*100)}%">${x.valor}</div>${i < items.length-1 ? '<i>›</i>' : ''}</div>`).join('')}</div>`; },

  async renderMonitor(container) {
    this.monitorContainer = container;
    container.innerHTML = `<section class="panel-control-view monitor-view">
      ${this.operationalHeader({ title: 'Monitor en Tiempo Real', status: 'Centro de actividad operacional' })}
      <section class="monitor-now panel-surface"><header><div><span>ESTADO OPERACIONAL ACTUAL</span><h2>Operación en curso</h2></div><time id="monitorLastUpdate">Actualizando…</time></header><div id="monitorNowGrid" class="monitor-now-grid"></div></section>
      <div id="monitorStats" class="monitor-stats" aria-label="Indicadores operacionales"></div>
      <div class="monitor-primary-grid">
        <article class="monitor-card monitor-feed-card panel-surface"><header class="monitor-card-head"><div><span>ACTIVIDAD OPERACIONAL</span><h3>Eventos registrados</h3></div><div id="monitorFeedFilters" class="monitor-feed-filters" role="group" aria-label="Filtrar eventos">${[['todos','Todos'],['mapa','Mapa'],['gruero','Gruero'],['verificacion','Verificaciones'],['inventario','Inventario'],['carga','Carga']].map(([id,label]) => `<button type="button" data-monitor-filter="${id}" class="${this.monitorFilter === id ? 'active' : ''}">${label}</button>`).join('')}</div></header><div id="monitorTimeline" class="timeline operational-feed"></div></article>
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
      ['wms-map-offline-status','online','offline','storage'].forEach(name => window.addEventListener(name, () => this.scheduleMonitorRefresh()));
      if (typeof InventoryOperationService !== 'undefined') InventoryOperationService.subscribe(() => this.scheduleMonitorRefresh());
    }
    clearInterval(this.monitorRefreshTimer);
    this.monitorRefreshTimer = setInterval(() => { if (AppController.activeView === 'monitor_tiempo_real') this.refreshMonitor(); }, 15000);
  },
  scheduleMonitorRefresh() {
    if (AppController.activeView !== 'monitor_tiempo_real') return;
    clearTimeout(this.monitorRefreshDebounce);
    this.monitorRefreshDebounce = setTimeout(() => this.refreshMonitor(), 140);
  },
  patchHtml(id, html) {
    const node = this.monitorContainer?.querySelector(`#${id}`);
    if (node && node.innerHTML !== html) node.innerHTML = html;
  },
  async refreshMonitor() {
    if (AppController.activeView !== 'monitor_tiempo_real' || !this.monitorContainer) return;
    const m = await PanelControlModel.monitor();
    if (AppController.activeView !== 'monitor_tiempo_real' || !this.monitorContainer) return;
    const latest = m.actividad[0], online = navigator.onLine;
    this.patchHtml('monitorNowGrid', [
      ['Conectividad', online ? 'En línea' : 'Sin conexión', online ? 'Los servicios locales siguen disponibles' : 'Trabajando con respaldo local', online ? 'success' : 'warning'],
      ['Sincronización', m.conflictos ? `${m.conflictos} conflicto(s)` : m.pendientes ? `${m.pendientes} pendiente(s)` : 'Al día', m.conflictos ? 'Requiere revisión' : 'Colas operacionales', m.conflictos ? 'critical' : m.pendientes ? 'attention' : 'success'],
      ['Última actividad', latest ? this.eventTime(latest.timestamp) : 'Sin eventos', latest ? latest.titulo : 'No hay registros fechados', 'info'],
      ['Stock actual', m.stock.toLocaleString('es-CL'), `${m.cajas.toLocaleString('es-CL')} cajas`, 'info']
    ].map(x => `<article class="${x[3]}"><span>${x[0]}</span><b>${this.escape(x[1])}</b><small>${this.escape(x[2])}</small></article>`).join(''));
    this.patchHtml('monitorStats', [['Cámaras con atención',m.criticas,'danger'],['Ocupación física',`${m.ocupacionFisica.toFixed(1)}%`,'info'],['Pedidos',m.pedidos,'pink'],['Reproceso',m.reproceso,'purple']].map(x => `<article class="monitor-stat ${x[2]}"><span>${x[0]}</span><strong>${x[1]}</strong></article>`).join(''));
    const events = this.monitorFilter === 'todos' ? m.actividad : m.actividad.filter(event => event.tipo === this.monitorFilter);
    this.patchHtml('monitorTimeline', events.length ? events.slice(0, 50).map(event => this.monitorEvent(event)).join('') : this.empty('No existen eventos fechados para este filtro.'));
    this.patchHtml('monitorAlerts', m.alertas.length ? m.alertas.map(a => `<div class="alert ${a.nivel}"><i>${a.nivel === 'critica' ? '×' : a.nivel === 'advertencia' || a.nivel === 'atencion' ? '!' : 'i'}</i><p><b>${this.escape(a.titulo)}</b><span>${this.escape(a.detalle)}</span></p></div>`).join('') : `<div class="alert correcta"><i>✓</i><p><b>Operación sin alertas activas</b><span>No se detectaron condiciones que requieran atención.</span></p></div>`);
    this.patchHtml('monitorOccupancy', m.ocupacionCamaras.map(c => `<article><span><b>${this.escape(c.nombre)}</b><em>${c.total} pallets · ${c.ocupacion.toFixed(1)}%</em></span><div><i style="width:${Math.min(100,c.ocupacion)}%"></i></div><small>${c.problemas} observados · ${c.capacidad} posiciones físicas</small></article>`).join('') || this.empty('No hay cámaras con stock.'));
    const updated = this.monitorContainer.querySelector('#monitorLastUpdate');
    if (updated) updated.textContent = `Actualizado ${this.eventTime(PanelControlModel.fechaTimestamp(m.actualizadoEn))}`;
  },
  eventTime(timestamp) { return timestamp ? new Date(timestamp).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }) : '—'; },
  monitorEvent(event) {
    const icons = { mapa: '⌖', gruero: '↔', verificacion: '✓', inventario: '▣', carga: '⇩', aprobacion: '◆' };
    const meta = [event.ubicacion, event.usuario, event.sincronizacion].filter(Boolean).join(' · ');
    return `<article class="monitor-event ${this.escape(event.severidad)}" data-event-type="${this.escape(event.tipo)}"><time>${this.eventTime(event.timestamp)}</time><i>${icons[event.tipo] || '•'}</i><div><header><b>${this.escape(event.titulo)}</b>${event.pallet ? `<strong>${this.escape(event.pallet)}</strong>` : ''}</header>${event.detalle ? `<p>${this.escape(event.detalle)}</p>` : ''}${meta ? `<small>${this.escape(meta)}</small>` : ''}</div></article>`;
  }
};
