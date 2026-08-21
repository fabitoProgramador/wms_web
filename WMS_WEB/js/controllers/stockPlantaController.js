/** Stock en Planta: UI existente conectada exclusivamente a Supabase. */
const StockPlantaController = {
  container: null,
  tab: 'detalle',
  pagina: 0,
  buscar: '',
  almacen: 'TODOS',
  estado: 'TODOS',
  detector: 'TODOS',
  exportOpen: false,
  detalleActual: null,
  resumenActual: null,
  pivotCatalogo: [],
  pivotActivos: new Set(),
  requestId: 0,
  searchTimer: null,
  _pivotInicializado: false,
  FRANJAS: '.stock-tabs,.pivot-chips',

  esc(v) { return SeguridadService.escaparHtml(v); },
  fmt(v) { return Number(v || 0).toLocaleString('es-CL'); },

  init(container) {
    this.container = container;
    this.tab = 'detalle';
    this.pagina = 0;
    this.buscar = '';
    this.almacen = 'TODOS';
    this.estado = 'TODOS';
    this.detector = 'TODOS';
    this.exportOpen = false;
    this.detalleActual = null;
    this.resumenActual = null;
    this.pivotCatalogo = [];
    this.pivotActivos = new Set();
    this._pivotInicializado = false;
    this.requestId += 1;
    clearTimeout(this.searchTimer);
    this.renderShell();
    this.cargarTab();
  },

  recordarScroll() {
    this._scrollFranjas = {};
    document.querySelectorAll(this.FRANJAS).forEach(el => {
      this._scrollFranjas[el.classList[0]] = el.scrollLeft;
    });
  },

  restaurarScroll() {
    const guardado = this._scrollFranjas || {};
    document.querySelectorAll(this.FRANJAS).forEach(el => {
      const valor = guardado[el.classList[0]];
      if (valor) el.scrollLeft = valor;
    });
    const activa = document.querySelector('.stock-tabs button.active');
    if (!activa) return;
    const franja = activa.parentElement;
    if (franja.scrollWidth <= franja.clientWidth + 1) return;
    const a = activa.getBoundingClientRect(), f = franja.getBoundingClientRect();
    if (a.left < f.left || a.right > f.right) {
      franja.scrollLeft += (a.left - f.left) - (f.width - a.width) / 2;
    }
  },

  renderShell() {
    if (!this.container) return;
    this.recordarScroll();
    const tabs = [
      ['detalle','Detalle General'],
      ['articulo','Resumen por Artículo'],
      ['camara','Resumen por Cámara'],
      ['estado','Resumen por Estado'],
      ['pivot','Tabla Dinámica Resumen']
    ];
    this.container.innerHTML = `<section class="stock-view">
      ${DashboardController.operationalHeader({ eyebrow:'CONTROL DE INVENTARIO', title:'Stock en Planta', status:'Stock SAP y estado WMS desde Supabase' })}
      <nav class="stock-tabs" aria-label="Subsecciones de Stock">${tabs.map(([id,t]) => `<button class="${this.tab === id ? 'active' : ''}" onclick="StockPlantaController.cambiarTab('${id}')">${t}</button>`).join('')}</nav>
      <div id="stockTabBody" class="stock-tab-body"><div class="panel-empty">Consultando Stock en Planta desde Supabase…</div></div>
    </section>`;
    this.restaurarScroll();
    DashboardController.startOperationalClock();
  },

  async cambiarTab(tab) {
    this.tab = tab;
    this.pagina = 0;
    this.exportOpen = false;
    this.requestId += 1;
    this.renderShell();
    await this.cargarTab();
  },

  pageSize() { return innerHeight < 700 ? 5 : innerHeight < 850 ? 8 : 10; },

  body() { return this.container?.querySelector('#stockTabBody'); },

  loading(text = 'Consultando Supabase…') {
    return `<div class="panel-empty">${this.esc(text)}</div>`;
  },

  errorHtml(error) {
    const text = error?.permiso
      ? 'Tu sesión no posee permiso para consultar Stock.'
      : error?.red
        ? 'No fue posible conectar con Supabase. Stock en Planta no usa datos locales de respaldo.'
        : (error?.message || 'No fue posible consultar Stock en Planta.');
    return `<div class="panel-empty"><b>${this.esc(text)}</b></div>`;
  },

  async cargarTab() {
    if (this.tab === 'detalle') return this.cargarDetalle();
    if (this.tab === 'pivot') return this.cargarPivot();
    return this.cargarResumen();
  },

  async cargarDetalle() {
    const body = this.body();
    if (!body) return;
    const req = ++this.requestId;
    const porPagina = this.pageSize();
    body.innerHTML = this.loading('Consultando detalle de Stock en Supabase…');
    try {
      const result = await StockPlantaModel.detalle({
        buscar: this.buscar,
        almacen: this.almacen,
        estado: this.estado,
        detector: this.detector,
        limite: porPagina,
        offset: this.pagina * porPagina
      });
      if (req !== this.requestId || this.tab !== 'detalle' || !this.body()) return;
      const paginas = Math.max(1, Math.ceil(result.totalFilas / porPagina));
      if (this.pagina >= paginas) {
        this.pagina = paginas - 1;
        return this.cargarDetalle();
      }
      this.detalleActual = result;
      this.pintarDetalle(result);
    } catch (error) {
      if (req !== this.requestId) return;
      body.innerHTML = this.errorHtml(error);
    }
  },

  pintarDetalle(result) {
    const body = this.body();
    if (!body) return;
    const activos = [Boolean(this.buscar.trim()), this.almacen !== 'TODOS', this.estado !== 'TODOS', this.detector !== 'TODOS'].filter(Boolean).length;
    const porPagina = this.pageSize();
    const paginas = Math.max(1, Math.ceil(result.totalFilas / porPagina));
    const almacenes = result.filtros.almacenes || [];
    const estados = result.filtros.estados || [];
    const detectores = result.filtros.detectores || [];

    body.innerHTML = `<div class="stock-toolbar panel-surface">
      <label class="stock-search"><span>Buscar</span><input id="stockSearch" class="form-control" value="${this.esc(this.buscar)}" placeholder="Lote, artículo, descripción o estado" oninput="StockPlantaController.actualizarBusqueda(this.value)"></label>
      <label class="stock-filter stock-filter-almacen"><span>Filtrar Almacén</span><select class="form-control" onchange="StockPlantaController.actualizarAlmacen(this.value)"><option value="TODOS">TODOS</option>${almacenes.map(a => `<option value="${this.esc(a.almacen)}" ${this.almacen === a.almacen ? 'selected' : ''}>${this.esc(a.almacen)}${a.whscode ? ` · ${this.esc(a.whscode)}` : ''}</option>`).join('')}</select></label>
      <label class="stock-filter stock-filter-estado"><span>Filtrar Estado Actual</span><select class="form-control" onchange="StockPlantaController.actualizarEstado(this.value)"><option value="TODOS">TODOS</option>${estados.map(x => `<option value="${this.esc(x)}" ${this.estado === x ? 'selected' : ''}>${this.esc(x)}</option>`).join('')}</select></label>
      <label class="stock-filter stock-filter-detector"><span>Filtrar Detector Metales</span><select class="form-control" onchange="StockPlantaController.actualizarDetector(this.value)"><option value="TODOS">TODOS</option>${detectores.map(x => `<option value="${this.esc(x)}" ${this.detector === x ? 'selected' : ''}>${this.esc(x)}</option>`).join('')}</select></label>
      <div class="stock-export"><button class="stock-action primary" onclick="StockPlantaController.toggleExport()"><i class="wi wi-upload"></i>Exportar<i class="wi wi-chevron"></i></button>${this.exportOpen ? `<div class="stock-export-menu"><button onclick="StockPlantaController.copiarDetalle()"><i class="wi wi-copy"></i>Copiar todo</button><button onclick="StockPlantaController.exportarDetalle()"><i class="wi wi-sheet"></i>Exportar a Excel</button></div>` : ''}</div>
      <button class="stock-action stock-clear ${activos ? 'has-active' : ''}" onclick="StockPlantaController.limpiarDetalle()" title="Restablecer búsqueda y los tres filtros"><i class="wi wi-clean"></i>Limpiar filtros${activos ? `<small>${activos} activo${activos === 1 ? '' : 's'}</small>` : ''}</button>
    </div>
    <div class="stock-table-shell">${result.items.length ? this.detalleCards(result.items) : '<div class="ops-empty">No hay registros para los filtros seleccionados.</div>'}
      <footer class="stock-pagination"><button ${this.pagina === 0 ? 'disabled' : ''} onclick="StockPlantaController.irPagina(-1)">← Anterior</button><span>Página <b>${this.pagina + 1}</b> de <b>${paginas}</b> · Total <b>${this.fmt(result.totalFilas)}</b> registros SAP</span><button ${this.pagina >= paginas - 1 ? 'disabled' : ''} onclick="StockPlantaController.irPagina(1)">Siguiente →</button></footer>
    </div>`;
    OperacionesController.ajustarListas();
  },

  opsBadge(text, tipo = '') {
    const value = String(text || '—');
    let color = '#64748b';
    if (tipo === 'estado') color = COLORES_MAPA_ESTADO[value] || '#64748b';
    else if (tipo === 'calidad') color = value === 'BLOQUEADO' ? '#ef4444' : '#10b981';
    else if (tipo === 'detector') color = value === 'SI' ? '#10b981' : value === 'SIN INFORMACIÓN' ? '#f59e0b' : '#ef4444';
    else if (tipo === 'reserva') color = value === 'SIN RESERVA' ? '#64748b' : '#f59e0b';
    return `<span class="ops-badge" style="--badge:${color}">${this.esc(value)}</span>`;
  },

  toggleCard(el,event) {
    const card = el.closest('.ops-card');
    if (!card) return;
    if (event) {
      const target = event.target;
      if (target.closest?.('button') && !target.closest('.ops-card-toggle')) return;
      if (target.closest?.('input,a,label')) return;
    }
    const open = card.classList.toggle('open');
    card.querySelector('.ops-card-toggle')?.setAttribute('aria-expanded', open ? 'true' : 'false');
  },

  conditionChips(p) {
    const condiciones = Array.isArray(p.condiciones_wms_array) ? p.condiciones_wms_array : [];
    if (!condiciones.length) return '<span class="ops-state-empty">Sin condiciones pendientes</span>';
    return `<span class="ops-state-chips">${condiciones.map(x => this.opsBadge(x,'estado')).join('')}</span>`;
  },

  stateStrip(p) {
    return `<div class="ops-state-strip" aria-label="Flujo y condiciones del pallet">
      <div><small>FLUJO OPERATIVO</small><span>${this.opsBadge(p.flujo_display,'estado')}</span></div>
      <div class="ops-state-conditions"><small>CONDICIÓN / REQUISITO</small>${this.conditionChips(p)}</div>
    </div>`;
  },

  decisionStrip(p) {
    if (!p.decision_display || p.decision_display === 'Sin decisión gerencial') return '';
    return `<div class="ops-decision-strip"><small>DECISIÓN GERENCIA</small><span>${this.opsBadge(p.decision_display,'estado')}${p.modalidad_display && p.modalidad_display !== '—' ? `<em>${this.esc(p.modalidad_display)}</em>` : ''}</span></div>`;
  },

  notaTexto(titulo, texto) {
    const v = this.esc(texto ?? '—');
    return `<button class="cell-text" title="${v}" data-value="${v}" onclick="StockPlantaController.abrirTexto('${titulo}',this.dataset.value)">${v}</button>`;
  },

  orderDelay(p) {
    if (!p?.en_pedido) return '';
    const dias = p.dias_en_pedido;
    if (dias == null) return `<div class="ops-card-alert"><span class="ops-delay unknown"><i class="wi wi-clock"></i>Pedido sin antigüedad calculada</span></div>`;
    const fecha = p.fecha_pedido ? new Date(p.fecha_pedido).toLocaleDateString('es-CL') : '—';
    const texto = dias === 0 ? 'Pedido ingresado hoy' : dias === 1 ? '1 día en pedido' : `${dias} días en pedido`;
    return `<div class="ops-card-alert"><span class="ops-delay${dias >= 2 ? ' late' : ''}" title="Pedido ingresado el ${this.esc(fecha)}"><i class="wi wi-clock"></i>${texto}${dias >= 2 ? ' · ATRASADO' : ''}</span></div>`;
  },

  orderFlagClass(p) {
    return p?.en_pedido && p.dias_en_pedido != null && p.dias_en_pedido >= 2 ? ' is-late' : '';
  },

  auditBlock(p) {
    const e = p?.ultimo_evento;
    if (!e) return `<div class="ops-card-audit empty"><span class="ops-audit-title">AUDITORÍA · ÚLTIMO MOVIMIENTO</span><p>Sin movimientos WMS registrados para este pallet.</p></div>`;
    const fecha = e.creado_en ? new Date(e.creado_en).toLocaleString('es-CL') : '—';
    return `<div class="ops-card-audit"><span class="ops-audit-title">AUDITORÍA · ÚLTIMO MOVIMIENTO</span><dl>
      <div><dt>Evento</dt><dd>${this.esc(e.evento || '—')}</dd></div>
      <div><dt>Contexto</dt><dd>${this.esc(e.contexto || '—')}</dd></div>
      <div><dt>Anterior</dt><dd>${this.esc(e.valor_anterior || '—')}</dd></div>
      <div><dt>Nuevo</dt><dd>${this.esc(e.valor_nuevo || '—')}</dd></div>
      <div><dt>Usuario</dt><dd>${this.esc(e.usuario || '—')}</dd></div>
      <div><dt>Fecha</dt><dd>${this.esc(fecha)}</dd></div>
      <div class="wide"><dt>Motivo</dt><dd>${this.esc(e.motivo || 'Sin motivo informado')}</dd></div>
    </dl></div>`;
  },

  detalleCards(items) {
    return `<div id="stockCards" class="ops-card-list">${items.map(p => `<article class="ops-card${this.orderFlagClass(p)}" onclick="StockPlantaController.toggleCard(this,event)">
      <div class="ops-card-head">
        <div class="ops-card-id"><b>${this.esc(p.id_lote_real)}</b><small>${this.esc(p.numero_articulo)} · ${this.esc(p.descripcion)}</small></div>
        <div class="ops-card-flag ops-state-flag ops-wms-primary"><small>ESTADO WMS</small>${this.opsBadge(p.estado_wms_efectivo_display,'estado')}</div>
        <button type="button" class="ops-card-toggle" aria-expanded="false" aria-label="Ver auditoría y detalle del lote ${this.esc(p.id_lote_real)}"><i></i></button>
      </div>
      <div class="ops-card-metrics ops-card-metrics-compact">
        <div><small>KILOS</small><span><b class="kilos">${this.fmt(p.kilos_stock)}</b></span></div>
        <div><small>CAJAS</small><span>${this.fmt(p.cajas)}</span></div>
        <div><small>FEC. FABRIC.</small><span>${this.esc(p.fecha_fabricacion)}</span></div>
      </div>
      ${this.stateStrip(p)}
      ${this.decisionStrip(p)}
      ${this.orderDelay(p)}
      <div class="ops-card-notes">
        <div><small>INFO CALIDAD</small><span>${this.notaTexto('Info Calidad',p.info_calidad)}</span></div>
        <div><small>INFO GENERAL</small><span>${this.notaTexto('Info General',p.info_general)}</span></div>
      </div>
      <div class="ops-card-detail"><div class="ops-card-more">
        <div class="ops-card-kv">
          <div><small>CALIDAD SAP</small><span>${this.opsBadge(p.estado_sap_display,'calidad')}</span></div>
          <div><small>ESTADO WMS REGISTRADO</small><span>${this.opsBadge(p.estado_wms_registrado_display,'estado')}</span></div>
          <div><small>ESTADO WMS EFECTIVO</small><span>${this.opsBadge(p.estado_wms_efectivo_display,'estado')}</span></div>
          <div><small>FLUJO OPERATIVO</small><span>${this.opsBadge(p.flujo_display,'estado')}</span></div>
          <div><small>CONDICIONES WMS</small><span>${this.esc(p.condiciones_display)}</span></div>
          <div><small>DECISIÓN GERENCIA</small><span>${this.esc(p.decision_display)}</span></div>
          <div><small>MODALIDAD</small><span>${this.esc(p.modalidad_display)}</span></div>
          <div><small>DETECTOR METALES</small><span>${this.opsBadge(p.detector_metales,'detector')}</span></div>
          <div><small>RESERVA</small><span>${this.opsBadge(p.reserva_texto,'reserva')}</span></div>
          <div><small>ALMACÉN SAP</small><span>${this.esc(p.ubicacion)}</span></div>
        </div>
        ${this.auditBlock(p)}
      </div></div>
    </article>`).join('')}</div>`;
  },

  actualizarBusqueda(v) {
    this.buscar = v;
    this.pagina = 0;
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.cargarDetalle().then(() => {
      const el = document.getElementById('stockSearch');
      if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
    }), 280);
  },

  actualizarAlmacen(v) { this.almacen = v; this.pagina = 0; this.cargarDetalle(); },
  actualizarEstado(v) { this.estado = v; this.pagina = 0; this.cargarDetalle(); },
  actualizarDetector(v) { this.detector = v; this.pagina = 0; this.cargarDetalle(); },
  irPagina(d) { this.pagina += d; this.cargarDetalle(); },

  limpiarDetalle() {
    this.buscar = '';
    this.almacen = 'TODOS';
    this.estado = 'TODOS';
    this.detector = 'TODOS';
    this.pagina = 0;
    this.exportOpen = false;
    this.cargarDetalle().then(() => document.getElementById('stockSearch')?.focus());
    this.toast('Filtros de stock eliminados.','info');
  },

  toggleExport() {
    this.exportOpen = !this.exportOpen;
    if (this.detalleActual) this.pintarDetalle(this.detalleActual);
  },

  async cargarResumen() {
    const body = this.body();
    if (!body) return;
    const req = ++this.requestId;
    body.innerHTML = this.loading('Calculando resumen desde Supabase…');
    try {
      const result = this.tab === 'articulo'
        ? await StockPlantaModel.resumenArticulos('TODOS')
        : this.tab === 'camara'
          ? await StockPlantaModel.resumenCamaras()
          : await StockPlantaModel.resumenEstados('TODOS');
      if (req !== this.requestId || !['articulo','camara','estado'].includes(this.tab) || !this.body()) return;
      this.resumenActual = result;
      body.innerHTML = this.renderResumen(result);
    } catch (error) {
      if (req !== this.requestId) return;
      body.innerHTML = this.errorHtml(error);
    }
  },

  resumenColor(tipo, nombre) {
    if (tipo === 'estado') return COLORES_MAPA_ESTADO[nombre] || '#64748b';
    if (tipo === 'camara') return ALMACENES_PIVOT.find(x => x.id === nombre)?.color || '#38bdf8';
    return '#06b6d4';
  },

  resumenIdentidad(tipo, r) {
    const color = this.resumenColor(tipo, r.nombre);
    if (tipo === 'estado') return `<span class="summary-identity state"><i style="--summary-color:${color}"></i><span>${this.opsBadge(r.nombre,'estado')}</span></span>`;
    if (tipo === 'camara') return `<span class="summary-identity camera"><i style="--summary-color:${color}"></i><span><b>${this.esc(r.nombre)}</b><em>${this.esc(r.whscode || '')}</em></span></span>`;
    return `<span class="summary-identity article"><i style="--summary-color:${color}"></i><span><b class="summary-code">${this.esc(r.codigo || r.nombre)}</b><em title="${this.esc(r.descripcion)}">${this.esc(r.descripcion)}</em></span></span>`;
  },

  resumenCard(tipo, r) {
    const color = this.resumenColor(tipo, r.nombre);
    const tienePct = r.porcentaje != null;
    const raw = tienePct ? Number(r.porcentaje) : 0;
    const value = Math.max(0, Math.min(100, raw));
    const label = tipo === 'estado' ? 'del stock lógico' : tipo === 'camara' ? 'ocupación cámara' : 'del stock lógico';
    const filasNota = r.filasSap !== r.pallets ? ` · ${this.fmt(r.filasSap)} filas SAP` : '';
    return `<article class="summary-card ${tipo}" style="--summary-color:${color}">
      <div class="summary-card-head">${this.resumenIdentidad(tipo,r)}</div>
      <div class="summary-card-metrics">
        <div class="pallets"><small>PALLETS</small><span title="${this.fmt(r.pallets)} pallets lógicos${filasNota}">${this.fmt(r.pallets)}</span></div>
        <div><small>CAJAS</small><span>${this.fmt(r.cajas)}</span></div>
        <div class="weight"><small>KILOS</small><span>${this.fmt(r.kilos)}</span></div>
      </div>
      <div class="summary-card-bar">${tienePct
        ? `<div class="summary-card-pct"><b>${raw.toFixed(1)}</b><em>%</em><small>${label}</small></div><div class="summary-card-track" role="progressbar" aria-label="${this.esc(label)}: ${raw.toFixed(1)} por ciento" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${value.toFixed(1)}"><i style="width:${value.toFixed(1)}%"></i></div>`
        : `<div class="summary-card-pct"><b>—</b><small>Sin capacidad configurada</small></div>`}
      </div>
    </article>`;
  },

  renderResumen(result) {
    const config = result.tipo === 'articulo'
      ? { titulo:'Resumen por Artículo', sub:'Pallets lógicos por producto; cajas y kilos se suman desde las filas SAP.' }
      : result.tipo === 'camara'
        ? { titulo:'Resumen por Cámara', sub:'Pallets distintos presentes por almacén; un pallet multiubicado puede aparecer en más de un almacén.' }
        : { titulo:'Resumen por Estado', sub:'Condiciones WMS sobre pallets lógicos; cajas y kilos conservan el saldo SAP completo.' };
    return `<section class="stock-summary stock-summary-modern panel-surface ${result.tipo}"><header class="stock-summary-heading"><div><span class="summary-eyebrow">VISTA CONSOLIDADA</span><h2>${config.titulo}</h2><p>${config.sub}</p><small>${this.fmt(result.totalPallets)} pallets lógicos · ${this.fmt(result.filasSap)} filas SAP</small></div><span class="summary-group-count"><b>${this.fmt(result.items.length)}</b> ${result.items.length === 1 ? 'agrupación' : 'agrupaciones'}</span></header><div class="summary-card-list">${result.items.map(r => this.resumenCard(result.tipo,r)).join('') || '<div class="ops-empty">Sin datos para construir este resumen.</div>'}</div></section>`;
  },

  async cargarPivot() {
    const body = this.body();
    if (!body) return;
    const req = ++this.requestId;
    body.innerHTML = this.loading('Construyendo tabla dinámica desde Supabase…');
    try {
      const catalogo = await StockPlantaModel.resumenCamaras();
      if (req !== this.requestId || this.tab !== 'pivot') return;
      this.pivotCatalogo = catalogo.items;
      const ids = new Set(this.pivotCatalogo.map(x => x.almacen));
      if (!this._pivotInicializado) {
        ['PROTER','POST TUNEL'].filter(x => ids.has(x)).forEach(x => this.pivotActivos.add(x));
        if (!this.pivotActivos.size) this.pivotCatalogo.slice(0,2).forEach(x => this.pivotActivos.add(x.almacen));
        this._pivotInicializado = true;
      }
      [...this.pivotActivos].filter(x => !ids.has(x)).forEach(x => this.pivotActivos.delete(x));
      const activos = this.pivotCatalogo.filter(x => this.pivotActivos.has(x.almacen));
      const resumenes = await Promise.all(activos.map(async cam => ({ cam, resumen: await StockPlantaModel.resumenArticulos(cam.almacen) })));
      if (req !== this.requestId || this.tab !== 'pivot' || !this.body()) return;
      body.innerHTML = this.renderPivot(resumenes);
    } catch (error) {
      if (req !== this.requestId) return;
      body.innerHTML = this.errorHtml(error);
    }
  },

  renderPivot(resumenes) {
    return `<section class="pivot-view"><div class="pivot-toolbar panel-surface"><div><h2>Tabla Dinámica Resumen</h2><p>Activa o desactiva almacenes SAP para comparar su stock por artículo.</p></div><div class="pivot-chips">${this.pivotCatalogo.map(x => `<button class="${this.pivotActivos.has(x.almacen) ? 'active' : ''}" onclick="StockPlantaController.togglePivot('${this.esc(x.almacen)}')">${this.esc(x.almacen)}</button>`).join('')}</div></div><div class="pivot-grid">${resumenes.map(x => this.pivotCard(x.cam,x.resumen)).join('') || '<div class="stock-empty panel-surface">Selecciona al menos un almacén para construir el resumen.</div>'}</div></section>`;
  },

  togglePivot(id) {
    this.pivotActivos.has(id) ? this.pivotActivos.delete(id) : this.pivotActivos.add(id);
    this.cargarPivot();
  },

  pivotCard(camara, resumen) {
    const a = ALMACENES_PIVOT.find(x => x.id === camara.almacen);
    const kilos = resumen.items.reduce((s,x) => s + Number(x.kilos || 0), 0);
    return `<article class="pivot-card panel-surface" style="--camera:${a?.color || '#64748b'}"><header><div><h3>${this.esc(camara.almacen)}</h3><small>${camara.whscode ? `SAP ${this.esc(camara.whscode)}` : 'Almacén SAP'}</small></div><strong>${this.fmt(kilos)} kg</strong></header><div class="pivot-kpis"><span><b>${this.fmt(resumen.totalPallets)}</b> Pallets</span><span><b>${this.fmt(resumen.items.length)}</b> Artículos</span></div><div class="stock-table-scroll"><table class="stock-table mini"><colgroup><col class="pivot-code-col"><col class="pivot-article-col"><col class="pivot-kilos-col"></colgroup><thead><tr><th>CÓDIGO</th><th>ARTÍCULO</th><th>KILOS</th></tr></thead><tbody>${resumen.items.map(x => `<tr><td class="pivot-ellipsis pivot-code" title="${this.esc(x.codigo)}">${this.esc(x.codigo)}</td><td class="pivot-ellipsis" title="${this.esc(x.descripcion)}">${this.esc(x.descripcion)}</td><td class="stock-kilos" title="${this.fmt(x.kilos)} kg">${this.fmt(x.kilos)}</td></tr>`).join('') || '<tr><td colspan="3" class="stock-empty">Sin stock registrado</td></tr>'}</tbody></table></div></article>`;
  },

  exportFilters() {
    return { buscar:this.buscar, almacen:this.almacen, estado:this.estado, detector:this.detector, limite:5000 };
  },

  tablaTexto(rows) {
    const head = ['LOTE','N° ARTÍCULO','DESCRIPCIÓN','ALMACÉN','KILOS','CAJAS','FEC. FABRIC.','EST. CALIDAD','ESTADO','INFO CALIDAD','INFO GENERAL','DM','RESERVA'];
    const body = rows.map(r => [r.LOTE,r.N_ARTICULO,r.DESCRIPCION,r.ALMACEN,r.KILOS,r.CAJAS,r.FEC_FABRIC,r.EST_CALIDAD,r.ESTADO,r.INFO_CALIDAD,r.INFO_GENERAL,r.DM,r.RESERVA]);
    return [head,...body];
  },

  async copiarDetalle() {
    try {
      const data = await StockPlantaModel.exportar(this.exportFilters());
      if (!data.rows.length) return this.toast('No hay registros para copiar con los filtros actuales.','warning');
      const text = this.tablaTexto(data.rows).map(r => r.map(v => String(v ?? '')).join('\t')).join('\n');
      try {
        await navigator.clipboard.writeText(text);
      } catch (_) {
        const ta = document.createElement('textarea'); ta.value = text; document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove();
      }
      if (data.truncado) this.toast(`Se copiaron ${this.fmt(data.devueltos)} de ${this.fmt(data.total)} registros por límite de exportación.`,'warning');
      else this.toast(`${this.fmt(data.devueltos)} registros SAP copiados al portapapeles.`,'success');
    } catch (error) {
      this.toast(error?.message || 'No fue posible copiar el stock.','error');
    } finally {
      this.exportOpen = false;
      if (this.detalleActual) this.pintarDetalle(this.detalleActual);
    }
  },

  async exportarDetalle() {
    try {
      const data = await StockPlantaModel.exportar(this.exportFilters());
      if (!data.rows.length) return this.toast('No hay registros para exportar con los filtros actuales.','warning');
      const xmlValue = v => String(v ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
      const rows = this.tablaTexto(data.rows).map((r,i) => `<Row>${r.map(v => `<Cell><Data ss:Type="${i && typeof v === 'number' ? 'Number' : 'String'}">${xmlValue(v)}</Data></Cell>`).join('')}</Row>`).join('');
      const libro = `<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Stock en Planta"><Table>${rows}</Table></Worksheet></Workbook>`;
      const blob = new Blob([libro],{type:'application/vnd.ms-excel;charset=utf-8'}), url = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = url; a.download = `Stock_Planta_Parral_${new Date().toISOString().slice(0,10)}.xls`; a.click(); setTimeout(() => URL.revokeObjectURL(url),0);
      if (data.truncado) this.toast(`Excel generado con ${this.fmt(data.devueltos)} de ${this.fmt(data.total)} registros.`,'warning');
      else this.toast(`Excel generado con ${this.fmt(data.devueltos)} registros SAP.`,'success');
    } catch (error) {
      this.toast(error?.message || 'No fue posible exportar el stock.','error');
    } finally {
      this.exportOpen = false;
      if (this.detalleActual) this.pintarDetalle(this.detalleActual);
    }
  },

  abrirTexto(titulo,texto) {
    this.modal(`<header><h2>${this.esc(titulo)}</h2><button onclick="StockPlantaController.cerrarModal()">×</button></header><p class="modal-copy">${this.esc(texto)}</p>`);
  },

  modal(html,clase='') {
    document.getElementById('stockModal')?.remove();
    document.body.insertAdjacentHTML('beforeend',`<div id="stockModal" class="stock-modal-backdrop" onclick="if(event.target===this)StockPlantaController.cerrarModal()"><section class="stock-modal ${clase}">${html}</section></div>`);
  },

  cerrarModal() { document.getElementById('stockModal')?.remove(); },
  toast(text,type='success') { return NotificationService.show(text,{type}); }
};
