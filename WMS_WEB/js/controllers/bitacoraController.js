/** CRUD web de Bitácora y Registro de Verificaciones del Panel de Control. */
const BitacoraController = {
  container: null, bitTab: 'visualizar', bitId: null, bitDraft: null, bitEditTurno: null, verTab: 'visualizar', verId: null, verGrupo: null,
  empty: '<div class="panel-empty">Este registro ya no existe.</div>',
  bitFilters: { buscar: '', fecha: '', turno: 'TODOS' }, verFilters: { buscar: '', fecha: '', turno: 'TODOS' },
  /* Escape unico del proyecto: SeguridadService.escaparHtml. Antes cada
     archivo tenia el suyo y seis de ellos no escapaban comillas, lo que dejaba
     abierta la inyeccion dentro de atributos. */
  esc(v) { return SeguridadService.escaparHtml(v); },
  tabs(items, active, method) { return `<div class="module-tabs">${items.map(x => `<button class="${active === x[0] || (active === 'detalle' && x[0] === 'visualizar') ? 'active' : ''}" onclick="BitacoraController.${method}('${x[0]}')">${x[1]}</button>`).join('')}</div>`; },
  toast(msg, type = 'ok') { return NotificationService.show(msg, { type }); },

  initBitacora(container) { this.container = container; this.bitTab = 'visualizar'; this.bitId = null; this.bitDraft = null; this.bitEditTurno = null; this.renderBitacora(); },
  captureBitDraft() {
    const form = document.getElementById('bitForm');
    if (!form || this.bitId) return;
    this.bitDraft = { turno: form.turno.value, planificacion: this.collectRows(form, 'plan', ['etiqueta', 'valor']), resumen_dia: this.collectRows(form, 'resumen', ['texto']), kpi_verificados: this.collectRows(form, 'verificados', ['motivo', 'cantidad']), kpi_rechazados: this.collectRows(form, 'rechazados', ['motivo', 'cantidad']), kpi_reproceso: form.reproceso.value };
  },
  changeBitTab(tab) {
    if (this.bitTab === 'agregar' && tab !== 'agregar') this.captureBitDraft();
    if (tab === 'modificar') this.bitDraft = null;
    this.bitTab = tab; this.bitId = null; this.bitEditTurno = null; this.renderBitacora();
  },
  renderBitacora() {
    this.container.innerHTML = `<section class="panel-control-view crud-view">${DashboardController.operationalHeader({ eyebrow: 'CONTROL DEL TURNO', title: 'Bitácora', status: 'Planificación y cierre operacional' })}${this.tabs([['visualizar','<i class="wi wi-eye"></i>Visualizar Bitácora'],['agregar','<i class="wi wi-plus"></i>Agregar Bitácora'],['modificar','<i class="wi wi-edit"></i>Modificar Datos']], this.bitTab, 'changeBitTab')}<div id="crudBody"></div></section>`;
    DashboardController.startOperationalClock();
    const body = document.getElementById('crudBody');
    if (this.bitTab === 'agregar') return this.renderBitForm(body, null);
    if (this.bitTab === 'detalle') return this.renderBitDetail(body, this.bitId);
    if (this.bitTab === 'modificar' && this.bitId) return this.renderBitForm(body, this.bitId);
    this.renderBitList(body, this.bitTab === 'modificar');
  },
  renderBitList(body, editing) {
    const items = PanelControlModel.filterBitacoras(this.bitFilters);
    body.innerHTML = `<section class="ver-toolbar bit-toolbar panel-surface"><div class="filter-bar"><label>Buscar<input class="form-control" placeholder="Evento o motivo" value="${this.esc(this.bitFilters.buscar)}" oninput="BitacoraController.setBitFilter('buscar',this.value)"></label><label>Fecha<input class="form-control" placeholder="dd/mm/aaaa" value="${this.esc(this.bitFilters.fecha)}" oninput="BitacoraController.setBitFilter('fecha',this.value)"></label><label>Turno<select class="form-control" onchange="BitacoraController.setBitFilter('turno',this.value)">${['TODOS','DIA','NOCHE'].map(option => `<option value="${option}" ${this.bitFilters.turno === option ? 'selected' : ''}>${option === 'TODOS' ? 'Todos los turnos' : option === 'DIA' ? 'Día' : 'Noche'}</option>`).join('')}</select></label></div>${this.bitFilterSummary(items)}</section><div id="bitList" class="record-list bit-record-list">${this.bitCards(items, editing)}</div>`;
  },
  bitCards(items, editing) { return items.length ? items.map(b => { const kpi = this.kpiBitacora(b); return `<button class="record-card ${b.turno.toLowerCase()}" onclick="BitacoraController.openBit('${b.id}',${editing})"><span class="record-icon">${b.turno === 'DIA' ? '☀️' : '🌙'}</span><span class="record-main"><span><b>${this.esc(b.fecha)}</b><i>${b.turno === 'DIA' ? 'Turno día' : 'Turno noche'}</i></span><small>${b.resumen_dia.length} eventos · ${kpi.totalVerificados} verificados · ${kpi.totalRechazados} rechazados · ${b.kpi_reproceso} a reproceso</small></span><b>${editing ? '✏️' : '›'}</b></button>`; }).join('') : '<div class="panel-empty">Ninguna bitácora coincide con los filtros.</div>'; },
  bitFilterSummary(items) {
    const active = [];
    if (this.bitFilters.buscar) active.push(`Búsqueda: ${this.esc(this.bitFilters.buscar)}`);
    if (this.bitFilters.fecha) active.push(`Fecha: ${this.esc(this.bitFilters.fecha)}`);
    if (this.bitFilters.turno !== 'TODOS') active.push(`Turno: ${this.bitFilters.turno === 'NOCHE' ? 'Noche' : 'Día'}`);
    const totals = items.reduce((summary, bitacora) => {
      const kpi = this.kpiBitacora(bitacora);
      summary.eventos += (bitacora.resumen_dia || []).length;
      summary.verificados += kpi.totalVerificados;
      summary.rechazados += kpi.totalRechazados;
      summary.reproceso += Number(bitacora.kpi_reproceso) || 0;
      return summary;
    }, { eventos:0, verificados:0, rechazados:0, reproceso:0 });
    return `<aside id="bitFilterSummary" class="ver-filter-summary bit-filter-summary" aria-live="polite"><div><b>${items.length}</b><span>${items.length === 1 ? 'bitácora encontrada' : 'bitácoras encontradas'}</span></div><div class="bit-filter-metrics"><span><strong>${totals.eventos}</strong> eventos</span><span class="verified"><strong>${totals.verificados}</strong> verificados</span><span class="rejected"><strong>${totals.rechazados}</strong> rechazados</span><span class="reprocess"><strong>${totals.reproceso}</strong> reproceso</span></div>${active.length ? `<small>Filtros activos: ${active.join(' · ')}</small>` : '<small>Resumen consolidado de todos los turnos registrados.</small>'}</aside>`;
  },
  setBitFilter(key, value) {
    this.bitFilters[key] = value;
    const items = PanelControlModel.filterBitacoras(this.bitFilters), box = document.getElementById('bitList'), summary = document.getElementById('bitFilterSummary');
    if (box) box.innerHTML = this.bitCards(items, this.bitTab === 'modificar');
    if (summary) summary.outerHTML = this.bitFilterSummary(items);
  },
  openBit(id, editing) { this.bitId = id; this.bitTab = editing ? 'modificar' : 'detalle'; this.renderBitacora(); },
  renderBitDetail(body, id) {
    const b = PanelControlModel.getBitacoras().find(x => x.id === id); if (!b) return body.innerHTML = '<div class="panel-empty">Esta bitácora ya no existe.</div>';
    body.innerHTML = `<button class="back-link" onclick="BitacoraController.changeBitTab('visualizar')"><i class="wi wi-left"></i>Volver al listado</button><article class="detail-sheet panel-surface bit-record-head"><header><div><span>${b.turno === 'DIA' ? '☀️' : '🌙'}</span><div><h2>${b.fecha}</h2><p>Turno ${b.turno.toLowerCase()} · ${b.id}</p></div></div></header></article>${this.bitPlanningSection(b.planificacion)}${this.bitSummarySection(b.resumen_dia)}${this.pendingPalletsSection()}${this.bitKpiSection(b)}`;
  },
  combinarMotivos(...listas) {
    const mapa = new Map();
    listas.flat().forEach(item => {
      const motivo = String(item?.motivo ?? item?.nombre ?? '').trim();
      const cantidad = Number(item?.cantidad) || 0;
      if (!motivo || cantidad <= 0) return;
      const clave = motivo.toLocaleLowerCase('es');
      const actual = mapa.get(clave) || { motivo, cantidad: 0 };
      actual.cantidad += cantidad; mapa.set(clave, actual);
    });
    return [...mapa.values()].sort((a, b) => b.cantidad - a.cantidad);
  },
  kpiBitacora(b) {
    const fecha = b.fecha || PanelControlModel.hoy(), turno = b.turno || 'DIA';
    const resumen = PanelControlModel.resumenVerificaciones(fecha, turno);
    const automaticos = { verificados: (resumen.motivosVerificados || []).map(x => ({ motivo: x.nombre, cantidad: x.cantidad })), rechazados: (resumen.motivosRechazados || []).map(x => ({ motivo: x.nombre, cantidad: x.cantidad })) };
    const manuales = { verificados: b.kpi_verificados || [], rechazados: b.kpi_rechazados || [] };
    const verificados = this.combinarMotivos(automaticos.verificados, manuales.verificados);
    const rechazados = this.combinarMotivos(automaticos.rechazados, manuales.rechazados);
    return { automaticos, manuales, verificados, rechazados, totalVerificados: PanelControlModel.totalMotivos(verificados), totalRechazados: PanelControlModel.totalMotivos(rechazados), autoVerificados: PanelControlModel.totalMotivos(automaticos.verificados), autoRechazados: PanelControlModel.totalMotivos(automaticos.rechazados) };
  },
  resumenAutomatico(b) {
    const kpi = this.kpiBitacora(b);
    const reproceso = Number(b.kpi_reproceso) || 0;
    return `<aside class="bit-auto-summary" aria-live="polite"><span>↻ Resumen consolidado del turno</span><b>${kpi.totalVerificados} verificados · ${kpi.totalRechazados} rechazados · ${reproceso} a reproceso</b><small>Integra Registro de Verificaciones y ajustes manuales de ${this.esc(b.fecha || PanelControlModel.hoy())} · ${b.turno === 'NOCHE' ? 'turno noche' : 'turno día'}.</small></aside>`;
  },
  bitPlanningSection(items = []) {
    const content = items.length ? `<div class="bit-planning-cards">${items.map(x => `<div class="bit-planning-card"><small>${this.esc(x.etiqueta)}</small><b>${this.esc(x.valor)}</b></div>`).join('')}</div>` : '<p class="muted">Sin campos registrados.</p>';
    return `<article class="detail-sheet panel-surface bit-read-section"><h3>📋 Planificación</h3>${content}</article>`;
  },
  bitSummarySection(items = []) {
    const content = items.length ? `<ol class="bit-timeline">${items.map(x => `<li><span></span><p>${this.esc(x.texto)}</p></li>`).join('')}</ol>` : '<p class="muted">Sin eventos registrados.</p>';
    return `<article class="detail-sheet panel-surface bit-read-section"><h3>📝 Resumen del día</h3>${content}</article>`;
  },
  bitKpiSection(b) {
    const kpi = this.kpiBitacora(b);
    const card = (icon, tone, title, total, rows) => `<section class="bit-kpi-card ${tone}"><div><i>${icon}</i><span>${title}</span><b>${total}</b></div>${rows.length ? `<ul>${rows.map(x => `<li>${this.esc(x.motivo)} <strong>${Number(x.cantidad) || 0}</strong></li>`).join('')}</ul>` : '<small>Sin desglose por motivo</small>'}</section>`;
    return `<article class="detail-sheet panel-surface bit-kpi-detail"><div class="bit-kpi-title"><h3>📊 KPI del turno</h3>${this.resumenAutomatico(b)}</div><div class="bit-kpi-grid">${card('🔍', 'verified', 'Verificados', kpi.totalVerificados, kpi.verificados)}${card('❌', 'rejected', 'Rechazados', kpi.totalRechazados, kpi.rechazados)}${card('🔄', 'reprocess', 'A reproceso', Number(b.kpi_reproceso) || 0, [])}</div></article>`;
  },

  /* --- Pallets pendientes por pedido, en tarjetas -------------------------
     Ultima tabla del sistema que obligaba a scroll horizontal: diez columnas
     con min-width:920px, imposible en telefono. Reutiliza el sistema
     .ops-card (operaciones.css) y los helpers de OperacionesController, para
     que sea la misma tarjeta que en las otras cinco vistas.
     Aqui nacio la regla de los 2 dias de atraso, asi que la franja roja la
     pinta el mismo orderDelay() que ahora usan todas las demas. */
  opsBadge(text, tipo = '') {
    const valor = String(text || '—');
    const color = tipo === 'estado' ? (COLORES_MAPA_ESTADO[valor] || '#64748b')
      : tipo === 'dm' ? (valor.toLocaleUpperCase('es') === 'RECHAZADO' ? '#ef4444' : '#10b981')
      : tipo === 'reserva' ? (valor.toLocaleUpperCase('es') === 'SÍ' ? '#f59e0b' : '#64748b') : '#64748b';
    return `<span class="ops-badge" style="--badge:${color}">${this.esc(valor)}</span>`;
  },
  pendingNote(titulo, texto) {
    const v = this.esc(texto || '—');
    return `<button class="cell-text" title="${v}" data-text="${v}" onclick="OperacionesController.showText('${titulo}',this.dataset.text)">${v}</button>`;
  },
  pendingPalletsSection() {
    const pallets = PanelControlModel.palletsPendientesPedido();
    if (!pallets.length) return `<article class="form-section panel-surface pending-pallets"><div class="rows-head"><h3>📦 Pallets pendientes (0)</h3></div><p class="muted">No hay pallets en estado PEDIDO en este momento.</p></article>`;
    const cards = pallets.map(p => {
      const fecha = PanelControlModel.fechaPedidoVisible(p.fecha_pedido) || 'Sin fecha';
      return `<article class="ops-card${OperacionesController.orderFlagClass(p)}" onclick="OperacionesController.toggleCard(this,event)">
        <div class="ops-card-head">
          <div class="ops-card-id"><b>${this.esc(PalletModel.idLoteReal(p))}</b><small>${this.esc(p.articulo || '—')} · ${this.esc(PalletModel.descripcion(p))}</small></div>
          <div class="ops-card-flag">${this.opsBadge(p.estado, 'estado')}</div>
          <button type="button" class="ops-card-toggle" aria-expanded="false" aria-label="Ver auditoría y detalle del lote ${this.esc(PalletModel.idLoteReal(p))}"><i></i></button>
        </div>
        <div class="ops-card-metrics">
          <div><small>KILOS</small><span><b class="kilos">${PalletModel.kilos(p).toLocaleString('es-CL')}</b></span></div>
          <div><small>CAJAS</small><span>${Number(p.cajas || 0).toLocaleString('es-CL')}</span></div>
          <div><small>DÍA DE PEDIDO</small><span>${this.esc(fecha)}</span></div>
          <div><small>DETECTOR</small><span>${this.opsBadge(p.detector_metales, 'dm')}</span></div>
        </div>
        ${OperacionesController.orderDelay(p)}
        <div class="ops-card-notes">
          <div><small>INFO CALIDAD</small><span>${this.pendingNote('Info Calidad', p.info_calidad)}</span></div>
          <div><small>INFO GENERAL</small><span>${this.pendingNote('Info General', p.info_general)}</span></div>
        </div>
        <div class="ops-card-detail"><div class="ops-card-more">
          <div class="ops-card-kv">
            <div><small>RESERVADO</small><span>${this.opsBadge(p.reservado, 'reserva')}</span></div>
            <div><small>ALMACÉN</small><span>${this.esc(p.ubicacion || '—')}</span></div>
          </div>
          ${OperacionesController.auditBlock(p)}
        </div></div>
      </article>`;
    }).join('');
    const urgentCount = pallets.filter(p => (PanelControlModel.diasAtrasoPedido(p.fecha_pedido) || 0) >= 2).length;
    return `<article class="form-section panel-surface pending-pallets"><div class="rows-head"><h3>📦 Pallets pendientes (${pallets.length})</h3>${urgentCount ? `<b class="pending-alert">${urgentCount} urgente(s) · 2+ días de atraso</b>` : ''}</div><div id="pendingCards" class="ops-card-list">${cards}</div></article>`;
  },
  renderBitForm(body, id) {
    let b = id ? PanelControlModel.getBitacoras().find(x => x.id === id) : null;
    if (b && this.bitEditTurno) b = { ...b, turno: this.bitEditTurno };
    if (!b) {
      const p = this.bitDraft || { turno: 'DIA', ...PanelControlModel.precargaBitacora('DIA'), kpi_verificados: [], kpi_rechazados: [], kpi_reproceso: 0 };
      b = { ...p, planificacion: p.planificacion || [], resumen_dia: p.resumen_dia || [], kpi_verificados: p.kpi_verificados || [], kpi_rechazados: p.kpi_rechazados || [], kpi_reproceso: p.kpi_reproceso || 0 };
    }
    const turnoControl = `<div class="bit-shift-field"><span>Turno</span><div class="bit-shift-toggle ${b.turno === 'NOCHE' ? 'night' : 'day'}"><button type="button" class="${b.turno === 'DIA' ? 'active' : ''}" onclick="BitacoraController.selectBitShift('DIA','${id || ''}')">☀ Día</button><button type="button" class="${b.turno === 'NOCHE' ? 'active' : ''}" onclick="BitacoraController.selectBitShift('NOCHE','${id || ''}')">🌙 Noche</button></div><input type="hidden" name="turno" value="${b.turno}"></div>`;
    body.innerHTML = `${id ? `<div class="form-top-actions"><button class="back-link" onclick="BitacoraController.changeBitTab('modificar')">← Volver a la lista</button><button class="danger-btn" onclick="BitacoraController.deleteBit('${id}')"><i class="wi wi-trash"></i>Eliminar esta bitácora</button></div>` : ''}<form id="bitForm" class="crud-form" onsubmit="BitacoraController.saveBit(event,'${id || ''}')"><article class="form-section panel-surface"><div class="form-section-title"><div><h2>${id ? 'Modificar bitácora' : 'Nueva bitácora'}</h2><p>Planificación, resumen operacional y KPI del turno.</p></div>${turnoControl}</div></article>${this.rowsSection('Planificación','plan',b.planificacion,['etiqueta','valor'],['Concepto','Valor'])}${this.rowsSection('Resumen del turno','resumen',b.resumen_dia,['texto'],['Evento o resumen'])}<section class="bit-kpi-editor"><div class="bit-kpi-title"><h3>📊 KPI del turno <small>Ajuste manual</small></h3>${this.resumenAutomatico(b)}</div><div class="form-two-cols">${this.rowsSection('🔍 Verificados','verificados',b.kpi_verificados,['motivo','cantidad'],['Motivo','Cantidad'])}${this.rowsSection('❌ Rechazados','rechazados',b.kpi_rechazados,['motivo','cantidad'],['Motivo','Cantidad'])}<article class="form-section panel-surface bit-kpi-reprocess"><h3>🔄 A reproceso</h3><label>PLT<input class="form-control compact-input" type="number" min="0" name="reproceso" value="${b.kpi_reproceso}"></label><small>Sin desglose por motivo</small></article></div></section><div class="form-submit"><button type="submit" class="btn-primary"><i class="wi wi-save"></i>${id ? 'Guardar cambios' : 'Guardar bitácora'}</button></div></form>`;
    body.querySelector('.bit-kpi-editor')?.insertAdjacentHTML('beforebegin', this.pendingPalletsSection());
  },
  rowsSection(title, key, rows, fields, labels) {
    const list = rows.length ? rows : [{}];
    return `<article class="form-section panel-surface"><div class="rows-head"><h3>${title}</h3><button type="button" class="small-action" onclick="BitacoraController.addRow('${key}')"><i class="wi wi-plus"></i>Agregar</button></div><div id="rows-${key}" class="dynamic-rows">${list.map(row => this.row(key, fields, labels, row)).join('')}</div></article>`;
  },
  row(key, fields, labels, row = {}) { return `<div class="dynamic-row">${fields.map((f, i) => `<input class="form-control" name="${key}_${f}" ${f === 'cantidad' ? 'type="number" min="0"' : ''} placeholder="${labels[i]}" value="${this.esc(row[f] ?? '')}">`).join('')}<button type="button" aria-label="Quitar fila" onclick="this.parentElement.remove()">×</button></div>`; },
  addRow(key) { const defs = { plan: [['etiqueta','valor'],['Concepto','Valor']], resumen: [['texto'],['Evento o resumen']], verificados: [['motivo','cantidad'],['Motivo','Cantidad']], rechazados: [['motivo','cantidad'],['Motivo','Cantidad']], pallets: [['numero','motivo','cajas'],['Número de pallet','Motivo','Cajas']] }[key]; document.getElementById(`rows-${key}`).insertAdjacentHTML('beforeend', this.row(key, defs[0], defs[1])); },
  collectRows(form, key, fields) { const first = [...form.querySelectorAll(`[name="${key}_${fields[0]}"]`)]; return first.map((_, i) => Object.fromEntries(fields.map(f => [f, form.querySelectorAll(`[name="${key}_${f}"]`)[i]?.value || '']))); },
  saveBit(e, id) { e.preventDefault(); const f = e.target; const saved = PanelControlModel.upsertBitacora({ turno: f.turno.value, planificacion: this.collectRows(f,'plan',['etiqueta','valor']), resumen_dia: this.collectRows(f,'resumen',['texto']), kpi_verificados: this.collectRows(f,'verificados',['motivo','cantidad']), kpi_rechazados: this.collectRows(f,'rechazados',['motivo','cantidad']), kpi_reproceso: f.reproceso.value }, id || null); if (!saved) return this.toast('La bitácora ya no existe.', 'error'); this.bitDraft = null; this.bitEditTurno = null; this.bitTab = 'visualizar'; this.bitId = null; this.toast(id ? 'Bitácora actualizada.' : 'Bitácora guardada.'); this.renderBitacora(); },
  selectBitShift(turno, id) { if (id) { this.bitEditTurno = turno; return this.renderBitacora(); } this.prefillShift(turno); },
  prefillShift(turno) { const p = PanelControlModel.precargaBitacora(turno); this.bitDraft = { turno, planificacion: p.planificacion, resumen_dia: p.resumen_dia, kpi_verificados: [], kpi_rechazados: [], kpi_reproceso: 0 }; this.renderBitacora(); },
  deleteBit(id) { if (!confirm('¿Eliminar esta bitácora completa?')) return; PanelControlModel.deleteBitacora(id); this.toast('Bitácora eliminada.'); this.changeBitTab('visualizar'); },

  initVerificaciones(container) { this.container = container; this.renderVerificaciones(); },
  changeVerTab(tab) { this.verTab = tab; this.verId = null; this.verGrupo = null; this.renderVerificaciones(); },
  renderVerificaciones() {
    this.container.innerHTML = `<section class="panel-control-view crud-view">${DashboardController.operationalHeader({ eyebrow: 'CONTROL DE CALIDAD', title: 'Registro de Verificaciones', status: 'Seguimiento de verificaciones del turno' })}${this.tabs([['visualizar','<i class="wi wi-eye"></i>Visualizar Registros'],['agregar','<i class="wi wi-plus"></i>Agregar Verificación'],['modificar','<i class="wi wi-edit"></i>Modificar Datos']], this.verTab, 'changeVerTab')}<div id="crudBody"></div></section>`;
    DashboardController.startOperationalClock();
    const body = document.getElementById('crudBody');
    if (this.verTab === 'agregar') return this.renderVerForm(body, null);
    if (this.verId) return this.verTab === 'modificar' ? this.renderVerForm(body, this.verId) : this.renderVerRecord(body, this.verId);
    if (this.verGrupo) return this.renderVerGroup(body, this.verGrupo.fecha, this.verGrupo.turno);
    this.renderVerGroups(body, this.verTab === 'modificar');
  },
  renderVerGroups(body, editing) {
    const items = PanelControlModel.filterVerificaciones(this.verFilters), groups = [...new Map(items.map(v => [`${v.fecha}|${v.turno}`, { fecha:v.fecha, turno:v.turno }])).values()];
    body.innerHTML = `<div class="filter-bar panel-surface"><label>Buscar<input class="form-control" placeholder="Lote, artículo o motivo" value="${this.esc(this.verFilters.buscar)}" oninput="BitacoraController.setVerFilter('buscar',this.value)"></label><label>Fecha<input class="form-control" placeholder="dd/mm/aaaa" value="${this.esc(this.verFilters.fecha)}" oninput="BitacoraController.setVerFilter('fecha',this.value)"></label><label>Turno<select class="form-control" onchange="BitacoraController.setVerFilter('turno',this.value)">${['TODOS','DIA','NOCHE'].map(x => `<option ${this.verFilters.turno === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label></div><div id="verList" class="record-list">${this.verGroupCards(groups, editing)}</div>`;
  },
  verGroupCards(groups, editing) { return groups.length ? groups.map(g => { const r=PanelControlModel.resumenVerificaciones(g.fecha,g.turno); return `<button class="record-card ${g.turno.toLowerCase()}" onclick="BitacoraController.openVerGroup('${g.fecha}','${g.turno}',${editing})"><span class="record-icon">${g.turno==='DIA'?'☀️':'🌙'}</span><span class="record-main"><span><b>${g.fecha}</b><i>Turno ${g.turno.toLowerCase()}</i></span><small>${r.verificados} verificados · ${r.rechazados} rechazados · ${r.motivos.length} motivos</small></span><b>›</b></button>`; }).join('') : '<div class="panel-empty">Ningún registro coincide con los filtros.</div>'; },
  setVerFilter(k,v) { this.verFilters[k]=v; const items=PanelControlModel.filterVerificaciones(this.verFilters), groups=[...new Map(items.map(x=>[`${x.fecha}|${x.turno}`,{fecha:x.fecha,turno:x.turno}])).values()]; const box=document.getElementById('verList'); if(box) box.innerHTML=this.verGroupCards(groups,this.verTab==='modificar'); },
  openVerGroup(fecha, turno) { this.verGrupo={fecha,turno}; this.renderVerificaciones(); },
  verFilterSummary(items, groups) {
    const active = [];
    if (this.verFilters.buscar) active.push(`Búsqueda: ${this.esc(this.verFilters.buscar)}`);
    if (this.verFilters.fecha) active.push(`Fecha: ${this.esc(this.verFilters.fecha)}`);
    if (this.verFilters.turno !== 'TODOS') active.push(`Turno: ${this.verFilters.turno === 'NOCHE' ? 'Noche' : 'Día'}`);
    const verified = new Set(), rejected = new Set(), reasons = new Set();
    items.forEach(record => (record.pallets || []).forEach(pallet => {
      const palletKey = `${record.codigo_lote || ''}|${pallet.numero_pallet || pallet.numero || ''}`;
      if (record.tipo === 'rechazado') rejected.add(palletKey); else verified.add(palletKey);
      const reason = String(pallet.motivo || '').trim().toLocaleLowerCase('es-CL');
      if (reason) reasons.add(reason);
    }));
    return `<aside id="verFilterSummary" class="ver-filter-summary bit-filter-summary ver-intelligence-summary" aria-live="polite"><div><b>${groups.length}</b><span>${groups.length === 1 ? 'turno encontrado' : 'turnos encontrados'}</span></div><div class="bit-filter-metrics"><span><strong>${items.length}</strong> registros</span><span class="verified"><strong>${verified.size}</strong> verificados</span><span class="rejected"><strong>${rejected.size}</strong> rechazados</span><span class="reprocess"><strong>${reasons.size}</strong> motivos</span></div>${active.length ? `<small>Filtros activos: ${active.join(' · ')}</small>` : '<small>Resumen consolidado de todos los turnos registrados.</small>'}</aside>`;
  },
  verGroupCards(groups, editing) {
    return groups.length ? groups.map(group => {
      const summary = PanelControlModel.resumenVerificaciones(group.fecha, group.turno);
      const isNight = group.turno === 'NOCHE';
      return `<button class="record-card ver-record-card ${isNight ? 'night' : 'day'}" onclick="BitacoraController.openVerGroup('${group.fecha}','${group.turno}',${editing})"><span class="record-icon">${isNight ? '🌙' : '☀️'}</span><span class="record-main"><span><b>${group.fecha}</b><i>Turno ${isNight ? 'noche' : 'día'}</i></span><small>${summary.verificados} verificados · ${summary.rechazados} rechazados · ${summary.motivos.length} motivos</small></span><span class="ver-record-status"><em class="verified">${summary.verificados}</em><em class="rejected">${summary.rechazados}</em><b>${editing ? '✏️' : '›'}</b></span></button>`;
    }).join('') : '<div class="panel-empty ver-empty"><b>Sin resultados</b><span>No hay turnos que coincidan con los filtros actuales.</span></div>';
  },
  renderVerGroups(body, editing) {
    const items = PanelControlModel.filterVerificaciones(this.verFilters);
    const groups = [...new Map(items.map(item => [`${item.fecha}|${item.turno}`, { fecha:item.fecha, turno:item.turno }])).values()];
    body.innerHTML = `<section class="ver-toolbar bit-toolbar panel-surface"><div class="filter-bar"><label>Buscar<input class="form-control" placeholder="Lote o motivo" value="${this.esc(this.verFilters.buscar)}" oninput="BitacoraController.setVerFilter('buscar',this.value)"></label><label>Fecha<input class="form-control" placeholder="dd/mm/aaaa" value="${this.esc(this.verFilters.fecha)}" oninput="BitacoraController.setVerFilter('fecha',this.value)"></label><label>Turno<select class="form-control" onchange="BitacoraController.setVerFilter('turno',this.value)">${['TODOS','DIA','NOCHE'].map(option => `<option value="${option}" ${this.verFilters.turno === option ? 'selected' : ''}>${option === 'TODOS' ? 'Todos los turnos' : option === 'DIA' ? 'Día' : 'Noche'}</option>`).join('')}</select></label></div>${this.verFilterSummary(items, groups)}</section><div id="verList" class="record-list ver-record-list">${this.verGroupCards(groups, editing)}</div>`;
  },
  setVerFilter(key, value) {
    this.verFilters[key] = value;
    const items = PanelControlModel.filterVerificaciones(this.verFilters);
    const groups = [...new Map(items.map(item => [`${item.fecha}|${item.turno}`, { fecha:item.fecha, turno:item.turno }])).values()];
    const list = document.getElementById('verList'), summary = document.getElementById('verFilterSummary');
    if (list) list.innerHTML = this.verGroupCards(groups, this.verTab === 'modificar');
    if (summary) summary.outerHTML = this.verFilterSummary(items, groups);
  },
  buildVerReportData(fecha, turno) {
    const label = turno === 'NOCHE' ? 'Turno Noche' : 'Turno Día';
    const sections = ['verificado', 'rechazado'].map(tipo => ({
      tipo,
      titulo: tipo === 'verificado' ? 'VERIFICADOS' : 'RECHAZADOS',
      icono: tipo === 'verificado' ? '✅' : '❌',
      verbo: tipo === 'verificado' ? 'Verificado' : 'Rechazado',
      registros: PanelControlModel.getVerificaciones().filter(registro => registro.fecha === fecha && registro.turno === turno && registro.tipo === tipo)
    })).filter(section => section.registros.length);
    const usuarios = [];
    sections.forEach(section => section.registros.forEach(registro => {
      const usuario = registro.usuario || '—';
      if (!usuarios.includes(usuario)) usuarios.push(usuario);
    }));
    const resumen = PanelControlModel.resumenVerificaciones(fecha, turno);
    return { fecha, turno, label, sections, usuarios, resumen };
  },
  verShiftRecords(fecha, turno, tipo) {
    const records = this.buildVerReportData(fecha, turno).sections.flatMap(section => section.registros);
    return tipo ? records.filter(record => record.tipo === tipo) : records;
  },
  verReportText(fecha, turno) {
    const report = this.buildVerReportData(fecha, turno);
    const lines = ['REGISTRO DE VERIFICACIONES', `${report.fecha} · ${report.label}`, ''];
    report.sections.forEach(section => {
      lines.push(`${section.icono} ${section.titulo}`, '');
      section.registros.forEach(registro => {
        lines.push(`  📦 Lote ${this.verShortLote(registro.codigo_lote)} — ${registro.articulo}`);
        (registro.pallets || []).forEach(pallet => {
          const folio = pallet.cajas ? ` (Folio: ${pallet.cajas})` : '';
          lines.push(`     • Pallet ${pallet.numero_pallet || pallet.numero}: ${pallet.motivo}${folio}`);
        });
        lines.push('');
      });
      lines.push('');
    });
    lines.push('📊 RESUMEN', '');
    if (report.resumen.verificados) {
      lines.push(`✅ ${report.resumen.verificados} pallet(s) verificado(s), pasados correctamente por el detector de metales.`, '', '   Desglose por motivo:');
      report.resumen.motivosVerificados.forEach(motivo => lines.push(`     ${motivo.nombre}: ${motivo.cantidad}`));
    }
    if (report.resumen.rechazados) {
      lines.push('', `❌ ${report.resumen.rechazados} pallet(s) rechazado(s).`, '');
      report.resumen.motivosRechazados.forEach(motivo => lines.push(`     ${motivo.nombre}: ${motivo.cantidad}`));
    }
    if (report.usuarios.length) lines.push('', `👤 Registrado por: ${report.usuarios.join(', ')}`);
    return lines.join('\n');
  },
  escapeVerRtf(value) {
    const units = [];
    for (const char of String(value ?? '')) {
      const code = char.codePointAt(0);
      if (char === '\\' || char === '{' || char === '}') units.push(`\\${char}`);
      else if (code < 128) units.push(char);
      else if (code <= 0xFFFF) units.push(`\\u${code < 32768 ? code : code - 65536}?`);
      else {
        const pair = code - 0x10000;
        [0xD800 + (pair >> 10), 0xDC00 + (pair & 0x3FF)].forEach(unit => units.push(`\\u${unit < 32768 ? unit : unit - 65536}?`));
      }
    }
    return units.join('');
  },
  verReportRtf(fecha, turno) {
    const report = this.buildVerReportData(fecha, turno), E = value => this.escapeVerRtf(value);
    const parts = ['{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Calibri;}}\\f0\\fs22', `\\b ${E('REGISTRO DE VERIFICACIONES')}\\b0\\par`, `${E(`${report.fecha} · ${report.label}`)}\\par\\par`];
    report.sections.forEach(section => {
      parts.push(`\\b ${E(`${section.icono} ${section.titulo}`)}\\b0\\par\\par`);
      section.registros.forEach(registro => {
        parts.push(`    ${E('📦 Lote ')}\\b ${E(this.verShortLote(registro.codigo_lote))}\\b0 ${E(` — ${registro.articulo}`)}\\par`);
        (registro.pallets || []).forEach(pallet => {
          const folio = pallet.cajas ? ` (Folio: ${pallet.cajas})` : '';
          parts.push(`        ${E('• ')}\\b ${E(`Pallet ${pallet.numero_pallet || pallet.numero}`)}\\b0 ${E(`: ${pallet.motivo}${folio}`)}\\par`);
        });
        parts.push('\\par');
      });
      parts.push('\\par');
    });
    parts.push(`\\b ${E('📊 RESUMEN')}\\b0\\par\\par`);
    if (report.resumen.verificados) {
      parts.push(`${E(`✅ ${report.resumen.verificados} pallet(s) verificado(s), pasados correctamente por el detector de metales.`)}\\par\\par`, `    ${E('Desglose por motivo:')}\\par`);
      report.resumen.motivosVerificados.forEach(motivo => parts.push(`        \\b ${E(motivo.nombre)}\\b0 ${E(`: ${motivo.cantidad}`)}\\par`));
    }
    if (report.resumen.rechazados) {
      parts.push(`\\par${E(`❌ ${report.resumen.rechazados} pallet(s) rechazado(s).`)}\\par\\par`);
      report.resumen.motivosRechazados.forEach(motivo => parts.push(`        \\b ${E(motivo.nombre)}\\b0 ${E(`: ${motivo.cantidad}`)}\\par`));
    }
    if (report.usuarios.length) parts.push(`\\par${E(`👤 Registrado por: ${report.usuarios.join(', ')}`)}\\par`);
    parts.push('}');
    return parts.join('\n');
  },
  async copyVerReport(fecha, turno) {
    try { await navigator.clipboard.writeText(this.verReportText(fecha, turno)); this.toast('✓ Reporte copiado correctamente'); }
    catch (_) { this.toast('No se pudo copiar el reporte. Usa Exportar a archivo.', 'error'); }
  },
  downloadVerReport(fecha, turno) {
    const filename = `Verificaciones_${fecha.replaceAll('/', '-')}_${turno}.rtf`;
    const blob = new Blob([this.verReportRtf(fecha, turno)], { type: 'application/rtf;charset=utf-8' });
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 0);
    this.toast(`✓ Reporte exportado: ${filename}`);
  },
  renderVerGroup(body, fecha, turno) {
    const list=PanelControlModel.getVerificaciones().filter(x=>x.fecha===fecha&&x.turno===turno), r=PanelControlModel.resumenVerificaciones(fecha,turno), editing=this.verTab==='modificar';
    body.innerHTML=`<div class="form-top-actions"><button class="back-link" onclick="BitacoraController.verGrupo=null;BitacoraController.renderVerificaciones()">← Volver a turnos</button>${editing?`<button class="danger-btn" onclick="BitacoraController.deleteVerShift('${fecha}','${turno}')">🗑️ Eliminar turno</button>`:''}</div><div class="turn-summary"><article><span>Verificados</span><b>${r.verificados}</b></article><article><span>Rechazados</span><b>${r.rechazados}</b></article><article><span>Motivos distintos</span><b>${r.motivos.length}</b></article></div><div class="record-list">${list.map(v=>`<button class="record-card" onclick="BitacoraController.openVer('${v.id}',${editing})"><span class="record-icon">${v.tipo==='verificado'?'<i class=\"wi wi-checkc\"></i>':'<i class=\"wi wi-alert\"></i>'}</span><span class="record-main"><span><b>${this.esc(v.codigo_lote)}</b><i>${this.esc(v.articulo)}</i></span><small>${v.pallets.length} pallets · ${this.esc(v.usuario)}</small></span><b>${editing?'✏️':'›'}</b></button>`).join('')}</div>`;
  },
  openVer(id, editing) { this.verId=id; this.verTab=editing?'modificar':'detalle'; this.renderVerificaciones(); },
  renderVerRecord(body,id){ const v=PanelControlModel.getVerificaciones().find(x=>x.id===id); if(!v)return body.innerHTML=this.empty; body.innerHTML=`<button class="back-link" onclick="BitacoraController.verId=null;BitacoraController.verTab='visualizar';BitacoraController.renderVerificaciones()">← Volver</button><article class="detail-sheet panel-surface"><header><div><span>${v.tipo==='verificado'?'✅':'⛔'}</span><div><h2>${this.esc(v.codigo_lote)}</h2><p>${v.fecha} · Turno ${v.turno.toLowerCase()} · ${v.id}</p></div></div></header><div class="detail-grid"><section><h3>Artículo</h3><p>${this.esc(v.articulo)}</p></section><section><h3>Registrado por</h3><p>${this.esc(v.usuario)}</p></section></div><h3>Pallets</h3><div class="table-scroll"><table class="panel-table"><thead><tr><th>Número</th><th>Motivo</th><th>Cajas</th></tr></thead><tbody>${v.pallets.map(p=>`<tr><td>${this.esc(p.numero)}</td><td>${this.esc(p.motivo)}</td><td>${p.cajas}</td></tr>`).join('')}</tbody></table></div></article>`; },
  renderVerForm(body,id){ const v=id?PanelControlModel.getVerificaciones().find(x=>x.id===id):{fecha:PanelControlModel.hoy(),turno:'DIA',tipo:'verificado',codigo_lote:'',pallets:[]}; body.innerHTML=`${id?`<div class="form-top-actions"><button class="back-link" onclick="BitacoraController.verId=null;BitacoraController.renderVerificaciones()">← Volver</button><button class="danger-btn" onclick="BitacoraController.deleteVer('${id}')">🗑️ Eliminar registro</button></div>`:''}<form id="verForm" class="crud-form" onsubmit="BitacoraController.saveVer(event,'${id||''}')"><article class="form-section panel-surface"><div class="form-grid"><label>Fecha<input name="fecha" class="form-control" value="${this.esc(v.fecha)}" placeholder="dd/mm/aaaa" required></label><label>Turno<select name="turno" class="form-control"><option ${v.turno==='DIA'?'selected':''}>DIA</option><option ${v.turno==='NOCHE'?'selected':''}>NOCHE</option></select></label><label>Resultado<select name="tipo" class="form-control"><option value="verificado" ${v.tipo==='verificado'?'selected':''}>VERIFICADO</option><option value="rechazado" ${v.tipo==='rechazado'?'selected':''}>RECHAZADO</option></select></label><label>Código de lote<input name="codigo" class="form-control" value="${this.esc(v.codigo_lote)}" placeholder="L-202600" required></label></div><p class="form-hint">El lote se valida contra el stock actual y completa su artículo automáticamente.</p></article>${this.rowsSection('Pallets verificados','pallets',v.pallets,['numero','motivo','cajas'],['Número de pallet','Motivo','Cajas'])}<div id="verError" class="form-error"></div><div class="form-submit"><button class="btn-primary" type="submit"><i class="wi wi-save"></i>${id?'Guardar cambios':'Guardar verificación'}</button></div></form>`; },
  saveVer(e,id){e.preventDefault();const f=e.target,r=PanelControlModel.upsertVerificacion({fecha:f.fecha.value,turno:f.turno.value,tipo:f.tipo.value,codigo_lote:f.codigo.value,pallets:this.collectRows(f,'pallets',['numero','motivo','cajas'])},id||null);if(!r.ok){document.getElementById('verError').textContent=r.error;return;}this.toast(id?'Registro actualizado.':'Verificación guardada.');this.changeVerTab('visualizar');},
  deleteVer(id){if(!confirm('¿Eliminar este registro?'))return;PanelControlModel.deleteVerificacion(id);this.toast('Registro eliminado.');this.changeVerTab('visualizar');},
  deleteVerShift(fecha,turno){if(!confirm(`¿Eliminar todos los registros del turno ${turno} del ${fecha}?`))return;const n=PanelControlModel.deleteTurno(fecha,turno);this.toast(`${n} registros eliminados.`);this.changeVerTab('visualizar');},
  bitKpiSection(b) {
    const kpi = this.kpiBitacora(b);
    const card = (icon, tone, title, total, rows, tipo) => `<section class="bit-kpi-card ${tone}"><div><i>${icon}</i><span>${title}</span><b>${total}</b></div>${rows.length ? `<ul>${rows.map(x => `<li>${this.esc(x.motivo)} <strong>${Number(x.cantidad) || 0}</strong></li>`).join('')}</ul>` : '<small>Sin desglose por motivo</small>'}<button type="button" class="bit-kpi-detail-button" onclick="BitacoraController.openKpiDetail('${b.id}','${tipo}')"><i class="wi wi-eye"></i>Ver detalle</button></section>`;
    return `<article class="detail-sheet panel-surface bit-kpi-detail"><div class="bit-kpi-title"><h3>📊 KPI del turno</h3>${this.resumenAutomatico(b)}</div><div class="bit-kpi-grid">${card('🔍', 'verified', 'Verificados', kpi.totalVerificados, kpi.verificados, 'verificados')}${card('❌', 'rejected', 'Rechazados', kpi.totalRechazados, kpi.rechazados, 'rechazados')}${card('🔄', 'reprocess', 'A reproceso', Number(b.kpi_reproceso) || 0, [], 'reproceso')}</div></article>`;
  },
  kpiDetailData(b, tipo) {
    const registros = PanelControlModel.getVerificaciones().filter(v => v.fecha === b.fecha && v.turno === b.turno && (tipo === 'verificados' ? v.tipo === 'verificado' : tipo === 'rechazados' ? v.tipo === 'rechazado' : false));
    const manuales = tipo === 'verificados' ? (b.kpi_verificados || []) : tipo === 'rechazados' ? (b.kpi_rechazados || []) : [];
    const totalManual = PanelControlModel.totalMotivos(manuales);
    return { registros, manuales, totalManual, total: tipo === 'reproceso' ? Number(b.kpi_reproceso) || 0 : registros.reduce((n, v) => n + (v.pallets || []).length, 0) + totalManual };
  },
  openKpiDetail(id, tipo) {
    const b = PanelControlModel.getBitacoras().find(x => x.id === id); if (!b) return this.toast('La bitácora ya no existe.', 'error');
    this.closeKpiDetail();
    const labels = { verificados: ['Verificados', '🔍'], rechazados: ['Rechazados', '❌'], reproceso: ['A reproceso', '🔄'] }, [titulo, icono] = labels[tipo] || labels.verificados;
    const data = this.kpiDetailData(b, tipo);
    const responsables = data.registros.map(v => ({ nombre: v.analista || v.usuario || 'No registrado', sello: v.registrado_en || v.actualizado_en || 'Hora no registrada', cargo: v.cargo || 'Analista responsable' }));
    const responsablesUnicos = [...new Map(responsables.map(x => [String(x.nombre).trim().toLowerCase(), x])).values()];
    const principal = responsablesUnicos[0] || null;
    const trazabilidad = principal ? `<aside class="bit-kpi-modal-trace"><span class="bit-kpi-analyst-avatar" aria-hidden="true">${this.esc(String(principal.nombre).trim().charAt(0).toUpperCase() || '?')}</span><div><small>${this.esc(principal.cargo)}</small><b>${this.esc(principal.nombre)}</b><em>${this.esc(b.turno)} · ${this.esc(principal.sello)}${responsablesUnicos.length > 1 ? ` · +${responsablesUnicos.length - 1} analista(s)` : ''}</em></div></aside>` : '';
    const registros = data.registros.length ? data.registros.map(v => `<article class="bit-kpi-register"><div class="bit-kpi-register-context"><div><b>${this.esc(v.codigo_lote || 'Sin lote')}</b><span>${this.esc(v.articulo || 'Sin artículo')}</span></div><em>${this.esc(v.id || 'Sin folio')}</em><span class="bit-kpi-result ${v.tipo === 'rechazado' ? 'rejected' : 'verified'}">${v.tipo === 'rechazado' ? 'Rechazado' : 'Verificado'}</span></div><div class="bit-kpi-pallet-list">${(v.pallets || []).map(p => `<div><b>${this.esc(p.numero_pallet || p.numero || 'Sin pallet')}</b><span>${this.esc(p.motivo || 'Sin motivo')}</span><em>Folio ${this.esc(p.cajas || '—')}</em></div>`).join('') || '<p>Sin pallets asociados.</p>'}</div></article>`).join('') : '';
    const audit = b.ajuste_manual;
    const turnoAudit = String(audit?.turno || b.turno).toUpperCase() === 'NOCHE' ? 'Noche' : 'Día';
    const auditCard = audit ? `<aside class="bit-kpi-manual-audit"><span class="bit-kpi-analyst-avatar" aria-hidden="true">${this.esc(String(audit.usuario || '?').trim().charAt(0).toUpperCase() || '?')}</span><div><small>${this.esc(audit.cargo || 'Responsable del ajuste')}</small><b>${this.esc(audit.usuario || 'Responsable no registrado')}</b><em>${turnoAudit} · ${this.esc(audit.registrado_en || audit.actualizado_en || 'Hora no registrada')}</em></div></aside>` : '<p class="bit-kpi-manual-legacy">Responsable del ajuste no registrado en este dato histórico.</p>';
    const manual = data.manuales.length ? `<section class="bit-kpi-manual"><div class="bit-kpi-manual-head"><h3>Ajuste manual de bitácora</h3>${auditCard}</div><ul>${data.manuales.map(x => `<li>${this.esc(x.motivo)} <b>${Number(x.cantidad) || 0}</b></li>`).join('')}</ul></section>` : '';
    const reprocess = tipo === 'reproceso' ? `<section class="bit-kpi-manual"><div class="bit-kpi-manual-head"><h3>Registro manual de reproceso</h3>${auditCard}</div><p>${data.total ? `${data.total} pallet(s) informados para reproceso.` : 'No hay pallets informados para reproceso.'} El formulario original no almacena un desglose por pallet o motivo.</p></section>` : '';
    const empty = !registros && !manual && !reprocess ? '<p class="bit-kpi-empty">No hay registros para este KPI en el turno seleccionado.</p>' : '';
    const modal = document.createElement('div'); modal.id = 'bitKpiModal'; modal.className = 'bit-kpi-modal'; modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); modal.setAttribute('aria-label', `Detalle de ${titulo}`); modal.onclick = event => { if (event.target === modal) this.closeKpiDetail(); };
    const totalAnalistas = responsablesUnicos.length;
    modal.innerHTML = `<section class="bit-kpi-modal-card"><header class="bit-kpi-modal-header"><div><span>${icono} Detalle KPI</span><h2>${titulo}</h2><p>${this.esc(b.fecha)} · Turno ${b.turno === 'NOCHE' ? 'noche' : 'día'}</p></div>${trazabilidad}<button type="button" aria-label="Cerrar detalle" onclick="BitacoraController.closeKpiDetail()">×</button></header><div class="bit-kpi-modal-body"><div class="bit-kpi-recap"><span>Total del KPI</span><b>${data.total}</b><small>${data.registros.length} registro(s) · ${totalAnalistas} analista(s) · ${data.totalManual} ajuste(s) manual(es)</small></div>${registros}${manual}${reprocess}${empty}</div></section>`;
    document.body.appendChild(modal); modal.querySelector('button')?.focus();
    this.kpiModalEscape = event => { if (event.key === 'Escape') this.closeKpiDetail(); }; document.addEventListener('keydown', this.kpiModalEscape);
  },
  closeKpiDetail() { document.getElementById('bitKpiModal')?.remove(); if (this.kpiModalEscape) document.removeEventListener('keydown', this.kpiModalEscape); this.kpiModalEscape = null; },

  // Registro de Verificaciones: réplica funcional del flujo consolidado del MVC.
  verShortLote(lote) { const value = String(lote || ''); return value.toUpperCase().startsWith('L-') ? value.slice(2) : value; },
  verShiftRecords(fecha, turno, tipo) { return PanelControlModel.getVerificaciones().filter(v => v.fecha === fecha && v.turno === turno && (!tipo || v.tipo === tipo)); },
  verShiftSummary(fecha, turno) {
    const r = PanelControlModel.resumenVerificaciones(fecha, turno);
    const block = (title, tone, total, motivos) => `<section class="ver-shift-metric ${tone}"><div><span>${title}</span><b>${total}</b><small>pallets distintos</small></div>${motivos.length ? `<ul>${motivos.map(m => `<li>${this.esc(m.nombre)} <strong>${m.cantidad}</strong></li>`).join('')}</ul>` : '<p>Sin datos todavía.</p>'}</section>`;
    return `<article class="ver-shift-summary panel-surface"><h3>📊 Resumen del turno</h3>${r.verificados ? `<p class="ver-detector-note">✅ ${r.verificados} pallet(s) verificado(s), pasados correctamente por el detector de metales.</p>` : ''}<div class="ver-shift-summary-grid">${block('Verificados','verified',r.verificados,r.motivosVerificados)}${block('Rechazados','rejected',r.rechazados,r.motivosRechazados)}</div><small class="ver-summary-note">Un pallet con varios motivos cuenta una vez en el total, pero suma en cada motivo.</small></article>`;
  },
  verShiftLists(fecha, turno) {
    const section = (tipo, title, icon, tone) => {
      const rows = this.verShiftRecords(fecha, turno, tipo);
      const content = rows.length ? rows.slice().reverse().map(v => {
        const chips = (v.pallets || []).map(p => `<span>Pallet ${this.esc(p.numero_pallet || p.numero)} · ${this.esc(p.motivo)}${p.cajas ? ` · Folio ${this.esc(p.cajas)}` : ''}</span>`).join('');
        return `<article><header><div><b>Lote ${this.esc(this.verShortLote(v.codigo_lote))}</b><span>${this.esc(v.articulo || '—')}</span></div><small>👤 ${this.esc(v.usuario || 'No registrado')}</small></header><div>${chips}</div></article>`;
      }).join('') : `<p class="muted">Todavía no hay lotes ${tipo === 'verificado' ? 'verificados' : 'rechazados'} en este turno.</p>`;
      return `<section class="ver-shift-list ${tone}"><h3>${icon} ${title}</h3>${content}</section>`;
    };
    return `<div class="ver-shift-lists">${section('verificado','Verificado en este turno','✅','verified')}${section('rechazado','Rechazado en este turno','❌','rejected')}</div>`;
  },
  verReportText(fecha, turno) {
    const label = turno === 'NOCHE' ? 'Turno Noche' : 'Turno Día', lines = ['REGISTRO DE VERIFICACIONES', `${fecha} · ${label}`, ''];
    ['verificado','rechazado'].forEach(tipo => { const rows = this.verShiftRecords(fecha, turno, tipo); if (!rows.length) return; lines.push(`${tipo === 'verificado' ? '✅ VERIFICADOS' : '❌ RECHAZADOS'}`, ''); rows.forEach(v => { lines.push(`Lote ${this.verShortLote(v.codigo_lote)} · ${v.articulo}`); (v.pallets || []).forEach(p => lines.push(`  Pallet ${p.numero_pallet || p.numero}: ${p.motivo}${p.cajas ? ` (Folio: ${p.cajas})` : ''}`)); lines.push(`  Registrado por: ${v.usuario || 'No registrado'}`, ''); }); });
    const r = PanelControlModel.resumenVerificaciones(fecha, turno); lines.push('RESUMEN', `${r.verificados} pallet(s) verificado(s) · ${r.rechazados} rechazado(s)`); return lines.join('\n');
  },
  verReportRtf(fecha, turno) {
    const esc = value => String(value || '').replace(/\\/g, '\\\\').replace(/[{}]/g, '\\$&').replace(/\n/g, '\\par ');
    const label = turno === 'NOCHE' ? 'Turno Noche' : 'Turno Día', parts = ['{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Calibri;}}\\f0\\fs22', `\\b ${esc('REGISTRO DE VERIFICACIONES')}\\b0\\par`, `${esc(`${fecha} · ${label}`)}\\par\\par`];
    ['verificado','rechazado'].forEach(tipo => { const rows = this.verShiftRecords(fecha, turno, tipo); if (!rows.length) return; parts.push(`\\b ${esc(tipo === 'verificado' ? '✅ VERIFICADOS' : '❌ RECHAZADOS')}\\b0\\par\\par`); rows.forEach(v => { parts.push(`${esc('Lote ')}\\b ${esc(this.verShortLote(v.codigo_lote))}\\b0 ${esc(` · ${v.articulo}`)}\\par`); (v.pallets || []).forEach(p => parts.push(`${esc(`  Pallet ${p.numero_pallet || p.numero}: ${p.motivo}${p.cajas ? ` (Folio: ${p.cajas})` : ''}`)}\\par`)); parts.push(`${esc(`  Registrado por: ${v.usuario || 'No registrado'}`)}\\par\\par`); }); });
    const r = PanelControlModel.resumenVerificaciones(fecha, turno); parts.push(`\\b ${esc('RESUMEN')}\\b0\\par`, `${esc(`${r.verificados} pallet(s) verificado(s) · ${r.rechazados} rechazado(s)`)}\\par`, '}'); return parts.join('\n');
  },
  async copyVerReport(fecha, turno) { const text = this.verReportText(fecha, turno); try { await navigator.clipboard.writeText(text); this.toast('Reporte copiado al portapapeles.'); } catch (_) { this.toast('No fue posible copiar el reporte.', 'error'); } },
  downloadVerReport(fecha, turno) { const rtf = this.verReportRtf(fecha, turno), blob = new Blob([rtf], {type:'application/rtf'}), url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = `Verificaciones_${fecha.replaceAll('/','-')}_${turno}.rtf`; link.click(); URL.revokeObjectURL(url); this.toast('Reporte de verificaciones exportado.'); },
  renderVerGroup(body, fecha, turno) {
    const editing = this.verTab === 'modificar', list = this.verShiftRecords(fecha, turno), r = PanelControlModel.resumenVerificaciones(fecha, turno);
    if (!editing) { body.innerHTML = `<div class="form-top-actions"><button class="back-link" onclick="BitacoraController.verGrupo=null;BitacoraController.renderVerificaciones()">← Volver al listado</button><div><button class="small-action" onclick="BitacoraController.copyVerReport('${fecha}','${turno}')"><i class="wi wi-copy"></i>Copiar reporte</button><button class="small-action" onclick="BitacoraController.downloadVerReport('${fecha}','${turno}')"><i class="wi wi-download"></i>Exportar archivo</button></div></div><article class="ver-shift-head panel-surface"><div><span>${turno === 'DIA' ? '☀️' : '🌙'}</span><div><h2>${this.esc(fecha)}</h2><p>Turno ${turno === 'NOCHE' ? 'noche' : 'día'}</p></div></div></article>${this.verShiftSummary(fecha,turno)}${this.verShiftLists(fecha,turno)}`; return; }
    body.innerHTML = `<div class="form-top-actions"><button class="back-link" onclick="BitacoraController.verGrupo=null;BitacoraController.renderVerificaciones()">← Volver a turnos</button><button class="danger-btn" onclick="BitacoraController.deleteVerShift('${fecha}','${turno}')">🗑️ Eliminar todo el turno</button></div><article class="ver-shift-head panel-surface"><div><span>${turno === 'DIA' ? '☀️' : '🌙'}</span><div><h2>${this.esc(fecha)}</h2><p>Turno ${turno === 'NOCHE' ? 'noche' : 'día'} · ${list.length} lote(s)</p></div></div></article><div class="turn-summary"><article><span>Verificados</span><b>${r.verificados}</b></article><article><span>Rechazados</span><b>${r.rechazados}</b></article><article><span>Motivos distintos</span><b>${r.motivos.length}</b></article></div><div class="record-list">${list.map(v => `<button class="record-card" onclick="BitacoraController.openVer('${v.id}',true)"><span class="record-icon">${v.tipo === 'verificado' ? '<i class=\"wi wi-checkc\"></i>' : '<i class=\"wi wi-alert\"></i>'}</span><span class="record-main"><span><b>Lote ${this.esc(this.verShortLote(v.codigo_lote))}</b><i>${this.esc(v.articulo)}</i></span><small>${(v.pallets || []).map(p => `${p.numero_pallet || p.numero} · ${p.motivo}`).join(' · ')}</small></span><b>✏️</b></button>`).join('')}</div>`;
  },
  verReportText(fecha, turno) {
    const report = this.buildVerReportData(fecha, turno);
    const lines = ['REGISTRO DE VERIFICACIONES', `${report.fecha} · ${report.label}`, ''];
    report.sections.forEach(section => {
      lines.push(`${section.icono} ${section.titulo}`, '');
      section.registros.forEach(registro => {
        lines.push(`  📦 Lote ${this.verShortLote(registro.codigo_lote)} — ${registro.articulo}`);
        (registro.pallets || []).forEach(pallet => lines.push(`     • Pallet ${pallet.numero_pallet || pallet.numero}: ${pallet.motivo}${pallet.cajas ? ` (Folio: ${pallet.cajas})` : ''}`));
        lines.push('');
      });
      lines.push('');
    });
    lines.push('📊 RESUMEN', '');
    if (report.resumen.verificados) {
      lines.push(`✅ ${report.resumen.verificados} pallet(s) verificado(s), pasados correctamente por el detector de metales.`, '', '   Desglose por motivo:');
      report.resumen.motivosVerificados.forEach(motivo => lines.push(`     ${motivo.nombre}: ${motivo.cantidad}`));
    }
    if (report.resumen.rechazados) {
      lines.push('', `❌ ${report.resumen.rechazados} pallet(s) rechazado(s).`, '');
      report.resumen.motivosRechazados.forEach(motivo => lines.push(`     ${motivo.nombre}: ${motivo.cantidad}`));
    }
    if (report.usuarios.length) lines.push('', `👤 Registrado por: ${report.usuarios.join(', ')}`);
    return lines.join('\n');
  },
  verReportRtf(fecha, turno) {
    const report = this.buildVerReportData(fecha, turno), E = value => this.escapeVerRtf(value);
    const parts = ['{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Calibri;}}\\f0\\fs22', `\\b ${E('REGISTRO DE VERIFICACIONES')}\\b0\\par`, `${E(`${report.fecha} · ${report.label}`)}\\par\\par`];
    report.sections.forEach(section => {
      parts.push(`\\b ${E(`${section.icono} ${section.titulo}`)}\\b0\\par\\par`);
      section.registros.forEach(registro => {
        parts.push(`    ${E('📦 Lote ')}\\b ${E(this.verShortLote(registro.codigo_lote))}\\b0 ${E(` — ${registro.articulo}`)}\\par`);
        (registro.pallets || []).forEach(pallet => parts.push(`        ${E('• ')}\\b ${E(`Pallet ${pallet.numero_pallet || pallet.numero}`)}\\b0 ${E(`: ${pallet.motivo}${pallet.cajas ? ` (Folio: ${pallet.cajas})` : ''}`)}\\par`));
        parts.push('\\par');
      });
      parts.push('\\par');
    });
    parts.push(`\\b ${E('📊 RESUMEN')}\\b0\\par\\par`);
    if (report.resumen.verificados) {
      parts.push(`${E(`✅ ${report.resumen.verificados} pallet(s) verificado(s), pasados correctamente por el detector de metales.`)}\\par\\par`, `    ${E('Desglose por motivo:')}\\par`);
      report.resumen.motivosVerificados.forEach(motivo => parts.push(`        \\b ${E(motivo.nombre)}\\b0 ${E(`: ${motivo.cantidad}`)}\\par`));
    }
    if (report.resumen.rechazados) {
      parts.push(`\\par${E(`❌ ${report.resumen.rechazados} pallet(s) rechazado(s).`)}\\par\\par`);
      report.resumen.motivosRechazados.forEach(motivo => parts.push(`        \\b ${E(motivo.nombre)}\\b0 ${E(`: ${motivo.cantidad}`)}\\par`));
    }
    if (report.usuarios.length) parts.push(`\\par${E(`👤 Registrado por: ${report.usuarios.join(', ')}`)}\\par`);
    parts.push('}'); return parts.join('\n');
  },
  async copyVerReport(fecha, turno) {
    try { await navigator.clipboard.writeText(this.verReportText(fecha, turno)); this.toast('✓ Reporte copiado correctamente'); }
    catch (_) { this.toast('No se pudo copiar el reporte. Usa Exportar a archivo.', 'error'); }
  },
  downloadVerReport(fecha, turno) {
    const filename = `Verificaciones_${fecha.replaceAll('/', '-')}_${turno}.rtf`;
    const blob = new Blob([this.verReportRtf(fecha, turno)], {type:'application/rtf;charset=utf-8'});
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 0);
    this.toast(`✓ Reporte exportado: ${filename}`);
  },
  verShiftRecords(fecha, turno, tipo) {
    const records = this.buildVerReportData(fecha, turno).sections.flatMap(section => section.registros);
    return tipo ? records.filter(record => record.tipo === tipo) : records;
  },
  verLiveOverview(fecha, turno) { return `${this.verShiftSummary(fecha,turno)}${this.verShiftLists(fecha,turno)}`; },
  previewVerTurn(fecha, turno) { const target = document.getElementById('verLiveOverview'); if (target) target.innerHTML = this.verLiveOverview(fecha, turno); },
  setVerFormType(button, tipo) {
    const form = button.closest('form'); if (!form) return;
    const typeInput = form.querySelector('[name="tipo"]'); if (!typeInput) return; typeInput.value = tipo;
    form.querySelectorAll('[data-ver-type]').forEach(x => {
      x.classList.remove('active', 'verified', 'rejected');
      if (x.textContent.trim().toLowerCase() === tipo) x.classList.add(tipo === 'rechazado' ? 'rejected' : 'verified');
    });
    button.classList.add('active');
    const title = form.querySelector('[data-ver-form-title]'), save = form.querySelector('[data-ver-save]');
    if (title) title.textContent = tipo === 'rechazado' ? 'Agregar rechazo' : 'Agregar verificación';
    if (save) save.textContent = `💾 Guardar lote ${tipo === 'rechazado' ? 'rechazado' : 'verificado'}`;
  },
  setVerFormShift(button, turno) {
    const form = button.closest('form'); if (!form) return;
    const shiftInput = form.querySelector('[name="turno"]'), dateInput = form.querySelector('[name="fecha"]'); if (!shiftInput) return; shiftInput.value = turno;
    const toggle = button.closest('.bit-shift-toggle');
    toggle?.classList.toggle('night', turno === 'NOCHE'); toggle?.classList.toggle('day', turno !== 'NOCHE');
    toggle?.querySelectorAll('button').forEach(x => x.classList.remove('active')); button.classList.add('active');
    this.previewVerTurn(dateInput?.value || '', turno);
  },
  renderVerForm(body, id) {
    const v = id ? PanelControlModel.getVerificaciones().find(x => x.id === id) : {fecha:PanelControlModel.hoy(),turno:'DIA',tipo:'verificado',codigo_lote:'',pallets:[]}; if (!v) return body.innerHTML = this.empty;
    const title = v.tipo === 'rechazado' ? 'Agregar rechazo' : 'Agregar verificación';
    const turnoControl = `<div class="bit-shift-field ver-shift-field"><span>Turno</span><div class="bit-shift-toggle ${v.turno === 'NOCHE' ? 'night' : 'day'}"><button type="button" class="${v.turno === 'DIA' ? 'active' : ''}" onclick="BitacoraController.setVerFormShift(this,'DIA')">☀ Día</button><button type="button" class="${v.turno === 'NOCHE' ? 'active' : ''}" onclick="BitacoraController.setVerFormShift(this,'NOCHE')">🌙 Noche</button></div><input type="hidden" name="turno" value="${v.turno}"></div>`;
    body.innerHTML = `${id ? `<div class="form-top-actions"><button class="back-link" onclick="BitacoraController.verId=null;BitacoraController.verGrupo={fecha:'${this.esc(v.fecha)}',turno:'${this.esc(v.turno)}'};BitacoraController.renderVerificaciones()">← Volver a los lotes</button><button class="danger-btn" onclick="BitacoraController.deleteVer('${id}')">🗑️ Eliminar registro</button></div>` : ''}<form id="verForm" class="crud-form" onsubmit="BitacoraController.saveVer(event,'${id||''}')"><article class="form-section panel-surface"><div class="form-section-title"><div><h2 data-ver-form-title>${title}</h2><p>El resumen inferior combina verificados y rechazados del mismo turno.</p></div><div class="ver-form-type"><button type="button" data-ver-type class="${v.tipo === 'verificado' ? 'active verified' : ''}" onclick="BitacoraController.setVerFormType(this,'verificado')">Verificado</button><button type="button" data-ver-type class="${v.tipo === 'rechazado' ? 'active rejected' : ''}" onclick="BitacoraController.setVerFormType(this,'rechazado')">Rechazado</button></div></div><input type="hidden" name="tipo" value="${this.esc(v.tipo)}"><div class="form-grid"><label>Fecha<input name="fecha" class="form-control" value="${this.esc(v.fecha)}" placeholder="dd/mm/aaaa" required oninput="BitacoraController.previewVerTurn(this.value,this.form.turno.value)"></label>${turnoControl}<label>Código de lote<input name="codigo" class="form-control" value="${this.esc(this.verShortLote(v.codigo_lote))}" placeholder="Ej: 1041" required></label></div><p class="form-hint">El código admite formato corto o L- y se valida contra el stock actual.</p></article>${this.rowsSection('Pallets del lote','pallets',v.pallets,['numero','motivo','cajas'],['Número de pallet','Motivo','N° de folio'])}<div id="verError" class="form-error"></div><div class="form-submit"><button class="btn-primary" data-ver-save type="submit">${id?'<i class="wi wi-save"></i>Guardar cambios':`<i class="wi wi-save"></i>Guardar lote ${v.tipo === 'rechazado' ? 'rechazado' : 'verificado'}`}</button></div></form><section id="verLiveOverview" class="ver-live-overview">${this.verLiveOverview(v.fecha,v.turno)}</section>`;
  }
};
