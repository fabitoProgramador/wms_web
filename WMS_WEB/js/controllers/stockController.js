/**
 * Lote Detallado legacy.
 *
 * Stock en Planta ya no vive aquí: fue migrado a StockPlantaController y
 * StockPlantaModel. Este controlador se retirará cuando Lote Detallado sea
 * conectado a Supabase en su propia fase.
 */
const StockController = {
  container: null,
  loteResultado: null,
  loteTexto: '',

  esc(v) { return SeguridadService.escaparHtml(v); },
  fmt(v) { return Number(v || 0).toLocaleString('es-CL'); },
  badge(text,tipo='') {
    const color = tipo === 'estado'
      ? (COLORES_MAPA_ESTADO[text] || '#64748b')
      : tipo === 'calidad'
        ? (text === 'BLOQUEADO' ? '#ef4444' : '#10b981')
        : tipo === 'alerta' ? '#f59e0b' : tipo === 'ok' ? '#10b981' : '#64748b';
    return `<span class="stock-badge" style="--badge-color:${color}">${this.esc(text)}</span>`;
  },

  initLoteDetallado(container) {
    this.container = container;
    this.loteResultado = null;
    this.loteTexto = '';
    this.renderLote();
  },

  renderLote() {
    this.container.innerHTML = `<section class="stock-view lote-view">${DashboardController.operationalHeader({ eyebrow:'CONSULTA DE INVENTARIO', title:'Lote Detallado', status:'Búsqueda de lotes y ubicaciones en tiempo real' })}
      <form class="lote-search panel-surface" onsubmit="StockController.buscarLote(event)"><label><span>N° de Lote o código (letra+N°)</span><input id="loteSearchInput" class="form-control" value="${this.esc(this.loteTexto)}" placeholder="Ej: L-9042, 9042 o A01"></label><button class="stock-action primary" type="submit">🔍 Buscar</button><button class="stock-action" type="button" onclick="StockController.limpiarLote()">🧹 Limpiar</button></form><div id="loteResult">${this.renderLoteResultado()}</div>
    </section>`;
    DashboardController.startOperationalClock();
  },

  buscarLote(e) {
    e?.preventDefault();
    const input = document.getElementById('loteSearchInput');
    this.loteTexto = input?.value || '';
    if (!this.loteTexto.trim()) {
      this.loteResultado = null;
      document.getElementById('loteResult').innerHTML = this.renderLoteResultado();
      this.toast('Ingresá un número de lote o código de pallet.','warning');
      input?.focus();
      return;
    }
    this.loteResultado = StockModel.resolverBusqueda(this.loteTexto);
    document.getElementById('loteResult').innerHTML = this.renderLoteResultado();
    if (!this.loteResultado.length) {
      this.toast(`No se encontró “${this.loteTexto.trim()}”. Verificá el código ingresado.`,'error');
      input?.focus();
    } else {
      this.toast(`${this.loteResultado.length} pallet${this.loteResultado.length === 1 ? '' : 's'} encontrado${this.loteResultado.length === 1 ? '' : 's'}.`,'success');
    }
  },

  limpiarLote() {
    this.loteTexto = '';
    this.loteResultado = null;
    document.getElementById('loteResult').innerHTML = this.renderLoteResultado();
    document.getElementById('stockModal')?.remove();
    const input = document.getElementById('loteSearchInput');
    if (input) { input.value = ''; input.focus(); }
    this.toast('Búsqueda limpia.','info');
  },

  renderLoteResultado() {
    if (this.loteResultado === null) return `<div class="lote-empty panel-surface"><span>🔎</span><b>Ingresa un N° de lote y presiona Buscar</b><p>La búsqueda es exacta: usa el lote completo o un código de pallet.</p></div>`;
    if (!this.loteResultado.length) return `<div class="lote-empty warning panel-surface"><span>⚠️</span><b>No se encontró el lote “${this.esc(this.loteTexto.trim())}”</b><p>Verifica que el código esté completo y sin espacios extra.</p></div>`;
    return this.fichaLote(this.loteResultado);
  },

  fichaLote(ps) {
    const ref = ps[0];
    const ub = StockModel.agruparUbicaciones(ps);
    const cajas = ps.reduce((s,p) => s + p.cajas,0);
    const kilos = cajas * 12;
    const estados = [...new Set(ps.map(p => p.estado))].sort();
    const arts = [...new Set(ps.map(p => p.articulo))].sort();
    const campos = [
      ['N° de artículo',arts.map(a => ps.find(p => p.articulo === a)?.numero_articulo || a).join(', ')],
      ['Descripción del artículo',arts.map(a => CATALOGO_ARTICULOS[a]?.descripcion || a).join(', ')],
      ['Ubicación',ub.map(x => x.almacen).join(', ')],
      ['Fecha de admisión',ref.fecha_admision],
      ['Fecha de fabricación',ref.fecha_fabricacion],
      ['N° de pallet',ps.map(p => p.numero_pallet || '—').join(', ')],
      ['Cantidad por lote (cajas)',this.fmt(cajas)],
      ['Detector de metales',ref.detector_metales],
      ['Temperatura',ref.temperatura],
      ['Id Lote (real)',ref.id_lote_real],
      ['Código',ref.codigo_visual]
    ];
    return `<div class="lote-result"><article class="lote-hero panel-surface"><div class="lote-identity"><h2>📦 Lote ${this.esc(ref.id_lote_real)}</h2><p>${this.esc(arts.map(a => CATALOGO_ARTICULOS[a]?.descripcion || a).join(', '))}</p></div><div class="lote-mini"><span><b>${this.fmt(kilos)} kg</b><small>Kilos totales</small></span><span><b>${this.fmt(cajas)}</b><small>Cajas totales</small></span><span><b>${ub.length}</b><small>Ubicaciones</small></span></div><div class="lote-states">${estados.map(x => this.badge(x,'estado')).join('')}</div></article>${ub.length > 1 ? `<div class="lote-duplicate">⚠️ Este lote está repartido en ${ub.length} ubicaciones distintas: ${ub.map(x => this.esc(x.almacen)).join(', ')}</div>` : ''}
      ${this.infoLote('🔬',`Info calidad · ${ref.calidad_estado}`,ref.info_calidad,ref.calidad_estado === 'OK' ? '#10b981' : '#f59e0b')}${this.infoLote('📝','Info general',ref.info_general,'#38bdf8')}${this.infoLote('🗂️','Info detallada',ref.info_detallada,'#a855f7')}
      <article class="lote-details panel-surface"><h3>📋 Información adicional del lote</h3><div class="lote-fields">${campos.map(([a,b]) => `<div><small>${a}</small><b>${this.esc(b)}</b></div>`).join('')}<div><small>Reservado</small>${this.badge(ref.reservado,ref.reservado === 'SÍ' ? 'alerta' : '')}</div></div></article><button class="stock-action location" onclick="StockController.abrirUbicaciones()">📍 Ver ubicaciones</button></div>`;
  },

  infoLote(icon,titulo,texto,color) {
    return `<article class="lote-info panel-surface" style="--info:${color}"><i></i><span>${icon}</span><div><b>${this.esc(titulo)}</b><p>${this.esc(texto)}</p></div></article>`;
  },

  abrirUbicaciones() {
    const ps = this.loteResultado || [];
    const ub = StockModel.agruparUbicaciones(ps);
    const codigo = ps[0]?.id_lote_real || '';
    this.modal(`<header><h2>📍 Lote ${this.esc(codigo)} — detalle por ubicación</h2><button onclick="StockController.cerrarModal()">×</button></header>${ub.length > 1 ? `<div class="lote-duplicate">⚠️ Lote repartido en ${ub.length} ubicaciones — revisar posible duplicidad.</div>` : ''}<div class="locations">${ub.map(u => { const a = ALMACENES_PIVOT.find(x => x.id === u.almacen); return `<article style="--camera:${a?.color || '#64748b'}"><header><b>${this.esc(a?.nombre || u.almacen)}</b><strong>${this.fmt(u.kilos)} kg</strong></header><p>📦 ${this.fmt(u.cajas)} cajas</p><small>Estado(s): ${u.estados.map(x => this.esc(x)).join(', ')}</small></article>`; }).join('')}</div><footer>Total repartido en ${ub.length} ${ub.length === 1 ? 'almacén' : 'almacenes'} <b>${this.fmt(ub.reduce((s,u) => s + u.cajas,0))} cajas · ${this.fmt(ub.reduce((s,u) => s + u.kilos,0))} kg</b></footer>`,'locations-modal');
  },

  abrirTexto(titulo,texto) {
    this.modal(`<header><h2>${this.esc(titulo)}</h2><button onclick="StockController.cerrarModal()">×</button></header><p class="modal-copy">${this.esc(texto)}</p>`);
  },

  modal(html,clase='') {
    document.getElementById('stockModal')?.remove();
    document.body.insertAdjacentHTML('beforeend',`<div id="stockModal" class="stock-modal-backdrop" onclick="if(event.target===this)StockController.cerrarModal()"><section class="stock-modal ${clase}">${html}</section></div>`);
  },

  cerrarModal() { document.getElementById('stockModal')?.remove(); },
  toast(text,type='success') { return NotificationService.show(text,{type}); }
};
