/** Lote Detallado: UI existente alimentada exclusivamente por Supabase. */
const LoteDetalladoController = {
  container:null,
  resultado:null,
  texto:'',
  requestId:0,

  esc(v) { return SeguridadService.escaparHtml(v); },
  fmt(v) { return Number(v || 0).toLocaleString('es-CL'); },

  init(container) {
    this.container = container;
    this.resultado = null;
    this.texto = '';
    this.requestId += 1;
    this.render();
  },

  render() {
    if (!this.container) return;
    this.container.innerHTML = `<section class="stock-view lote-view">
      ${DashboardController.operationalHeader({ eyebrow:'CONSULTA DE INVENTARIO', title:'Lote Detallado', status:'Identidad lógica, estados WMS y saldo SAP desde Supabase' })}
      <form class="lote-search panel-surface" onsubmit="LoteDetalladoController.buscar(event)">
        <label><span>N° de Lote o código visual</span><input id="loteSearchInput" class="form-control" value="${this.esc(this.texto)}" placeholder="Ej: 263011055163" autocomplete="off"></label>
        <button class="stock-action primary" type="submit">🔍 Buscar</button>
        <button class="stock-action" type="button" onclick="LoteDetalladoController.limpiar()">🧹 Limpiar</button>
      </form>
      <div id="loteResult">${this.estadoInicial()}</div>
    </section>`;
    DashboardController.startOperationalClock();
  },

  estadoInicial() {
    return `<div class="lote-empty panel-surface"><span>🔎</span><b>Ingresa un ID de lote o código visual y presiona Buscar</b><p>El backend resuelve la referencia visual cuando existe catálogo configurado.</p></div>`;
  },

  async buscar(event) {
    event?.preventDefault();
    const input = document.getElementById('loteSearchInput');
    this.texto = String(input?.value || '').trim();
    const result = document.getElementById('loteResult');
    if (!this.texto) {
      this.resultado = null;
      if (result) result.innerHTML = this.estadoInicial();
      this.toast('Ingresá un ID de lote o código visual.','warning');
      input?.focus();
      return;
    }

    const req = ++this.requestId;
    if (result) result.innerHTML = '<div class="lote-empty panel-surface"><span>⌛</span><b>Consultando Supabase…</b><p>Validando identidad lógica, saldo SAP, estados WMS y auditoría.</p></div>';
    try {
      const data = await LoteDetalladoModel.buscar(this.texto);
      if (req !== this.requestId || !this.container) return;
      this.resultado = data;
      if (result) result.innerHTML = this.renderResultado(data);
      if (data.ok) this.toast('Lote encontrado en Supabase.','success');
      else this.toast(data.error || 'No se encontró el lote.','error');
    } catch (error) {
      if (req !== this.requestId) return;
      this.resultado = null;
      const msg = error?.permiso
        ? 'Tu sesión no posee permiso para consultar lotes.'
        : error?.red
          ? 'No fue posible conectar con Supabase. Lote Detallado no usa datos locales de respaldo.'
          : (error?.message || 'No fue posible consultar el lote.');
      if (result) result.innerHTML = `<div class="lote-empty warning panel-surface"><span>⚠️</span><b>${this.esc(msg)}</b><p>La consulta no fue sustituida por datos simulados.</p></div>`;
      this.toast(msg,'error');
    }
  },

  renderResultado(data) {
    if (!data?.ok) {
      const candidatos = data?.ambiguo && data.candidatos?.length
        ? `<p>Candidatos: ${data.candidatos.map(x => this.esc(x)).join(', ')}</p>`
        : '<p>Verifica el ID completo y vuelve a intentar.</p>';
      return `<div class="lote-empty warning panel-surface"><span>⚠️</span><b>${this.esc(data?.error || 'No se encontró el lote.')}</b>${candidatos}</div>`;
    }
    return this.ficha(data);
  },

  badge(text,tipo='') {
    const value = String(text || '—');
    let color = '#64748b';
    if (tipo === 'estado') color = COLORES_MAPA_ESTADO[value] || '#64748b';
    else if (tipo === 'calidad') color = value === 'BLOQUEADO' ? '#ef4444' : value === 'LIBERADO' ? '#10b981' : '#f59e0b';
    else if (tipo === 'detector') color = value === 'SI' ? '#10b981' : value === 'SIN INFORMACIÓN' ? '#f59e0b' : '#ef4444';
    else if (tipo === 'reserva') color = value === 'SIN RESERVA' ? '#64748b' : '#f59e0b';
    return `<span class="stock-badge" style="--badge-color:${color}">${this.esc(value)}</span>`;
  },

  condiciones(p) {
    if (!p.condicionesWms?.length) return '<span class="ops-state-empty">Sin condiciones pendientes</span>';
    return `<span class="ops-state-chips">${p.condicionesWms.map(x => this.badge(x,'estado')).join('')}</span>`;
  },

  stateStrip(p) {
    return `<div class="ops-state-strip lote-state-strip" aria-label="Capas de estado WMS del lote">
      <div><small>FLUJO OPERATIVO</small><span>${this.badge(p.flujoOperativo,'estado')}</span></div>
      <div class="ops-state-conditions"><small>CONDICIÓN / REQUISITO</small>${this.condiciones(p)}</div>
    </div>`;
  },

  auditBlock(p) {
    const a = p.auditoria;
    if (!a) return `<article class="ops-card-audit empty panel-surface"><span class="ops-audit-title">AUDITORÍA · ÚLTIMO MOVIMIENTO</span><p>Sin movimientos WMS registrados para este pallet.</p></article>`;
    const fecha = a.fecha ? new Date(a.fecha).toLocaleString('es-CL') : '—';
    return `<article class="ops-card-audit panel-surface"><span class="ops-audit-title">AUDITORÍA · ÚLTIMO MOVIMIENTO</span><dl>
      <div><dt>Evento</dt><dd>${this.esc(a.evento || '—')}</dd></div>
      <div><dt>Contexto</dt><dd>${this.esc(a.contexto || '—')}</dd></div>
      <div><dt>Anterior</dt><dd>${this.esc(a.valor_anterior || '—')}</dd></div>
      <div><dt>Nuevo</dt><dd>${this.esc(a.valor_nuevo || '—')}</dd></div>
      <div><dt>Usuario</dt><dd>${this.esc(a.usuario || '—')}</dd></div>
      <div><dt>Fecha</dt><dd>${this.esc(fecha)}</dd></div>
      <div class="wide"><dt>Motivo</dt><dd>${this.esc(a.motivo || 'Sin motivo informado')}</dd></div>
    </dl></article>`;
  },

  ficha(p) {
    const reserva = p.reserva || 'SIN RESERVA';
    const ubicacionTexto = p.multiAlmacenSap
      ? `${p.almacenesSap} almacenes SAP`
      : (p.ocurrencias[0]?.almacen || p.almacenSap?.clave || '—');
    const temperatura = p.temperatura == null ? '—' : `${p.temperatura}`;
    const temperaturaNota = p.temperaturaFuente || 'Sin fuente de temperatura conectada';
    const codigo = p.codigoVisual || '—';
    const campos = [
      ['N° de artículo',p.numeroArticulo || p.itemcode || '—'],
      ['Descripción del artículo',p.itemname || '—'],
      ['Saldo SAP',ubicacionTexto],
      ['Fecha de admisión',p.fechaAdmision],
      ['Fecha de fabricación',p.fechaFabricacion],
      ['N° de pallet',p.numeroPallet || '—'],
      ['Cantidad por lote (cajas)',this.fmt(p.cajas)],
      ['Detector de metales',p.detector],
      ['Temperatura',`${temperatura} · ${temperaturaNota}`],
      ['Id Lote (real)',p.idLote],
      ['Código visual',codigo]
    ];
    const multi = p.multiAlmacenSap
      ? `<div class="lote-duplicate">ℹ️ Pallet lógico con saldo distribuido en ${p.almacenesSap} almacenes SAP: ${p.ocurrencias.map(x => this.esc(x.almacen)).join(', ')}.</div>`
      : '';
    const mapaText = p.mapa.cantidad > 0 ? `${p.mapa.cantidad} posición${p.mapa.cantidad === 1 ? '' : 'es'} WMS` : 'Sin posición WMS registrada';
    const decision = p.decisionGerencia !== 'Sin decisión gerencial'
      ? `<div class="ops-decision-strip"><small>DECISIÓN GERENCIA</small><span>${this.badge(p.decisionGerencia,'estado')}${p.modalidadGerencia !== '—' ? `<em>${this.esc(p.modalidadGerencia)}</em>` : ''}</span></div>`
      : '';

    return `<div class="lote-result">
      <article class="lote-hero panel-surface">
        <div class="lote-identity"><h2>📦 Lote ${this.esc(p.idLote)}</h2><p>${this.esc(p.itemname || p.itemcode || 'Sin descripción')}</p></div>
        <div class="lote-mini"><span><b>${this.fmt(p.kilos)} kg</b><small>Kilos totales SAP</small></span><span><b>${this.fmt(p.cajas)}</b><small>Cajas totales SAP</small></span><span><b>${p.almacenesSap}</b><small>Almacenes SAP</small></span></div>
        <div class="lote-states"><span><small>ESTADO WMS</small>${this.badge(p.estadoWmsEfectivo,'estado')}</span></div>
      </article>
      ${this.stateStrip(p)}
      ${decision}
      ${multi}
      ${this.info('🔬',`Info calidad · ${p.estadoCalidad}`,p.infoCalidad || 'Sin información de calidad registrada','#f59e0b')}
      ${this.info('📝','Info general',p.infoGeneral || 'Sin información general registrada','#38bdf8')}
      ${this.info('🗂️','Info detallada',p.infoDetallada || 'Sin información detallada registrada','#a855f7')}
      <article class="lote-details panel-surface"><h3>📋 Información adicional del lote</h3><div class="lote-fields">
        <div><small>Calidad SAP</small>${this.badge(p.estadoSap,'calidad')}</div>
        <div><small>Estado WMS registrado</small>${this.badge(p.estadoWmsRegistrado,'estado')}</div>
        <div><small>Estado WMS efectivo</small>${this.badge(p.estadoWmsEfectivo,'estado')}</div>
        <div><small>Flujo operativo</small>${this.badge(p.flujoOperativo,'estado')}</div>
        <div><small>Condiciones WMS</small><b>${this.esc(p.condicionesDisplay)}</b></div>
        <div><small>Decisión gerencia</small><b>${this.esc(p.decisionGerencia)}</b></div>
        <div><small>Modalidad</small><b>${this.esc(p.modalidadGerencia)}</b></div>
        ${campos.map(([a,b]) => `<div><small>${this.esc(a)}</small><b>${this.esc(b)}</b></div>`).join('')}
        <div><small>Reserva SAP</small>${this.badge(reserva,'reserva')}</div><div><small>Mapa WMS</small><b>${this.esc(mapaText)}</b></div>
      </div></article>
      ${this.auditBlock(p)}
      <button class="stock-action location" onclick="LoteDetalladoController.abrirUbicaciones()">📍 Ver ubicaciones SAP${p.mapa.cantidad ? ' y Mapa WMS' : ''}</button>
    </div>`;
  },

  info(icon,titulo,texto,color) {
    return `<article class="lote-info panel-surface" style="--info:${color}"><i></i><span>${icon}</span><div><b>${this.esc(titulo)}</b><p>${this.esc(texto)}</p></div></article>`;
  },

  abrirUbicaciones() {
    const p = this.resultado;
    if (!p?.ok) return;
    const sap = p.ocurrencias.map(u => `<article style="--camera:${this.colorAlmacen(u.almacen)}"><header><b>${this.esc(u.almacen)}</b><strong>${this.fmt(u.kilos)} kg</strong></header><p>📦 ${this.fmt(u.cajas)} cajas · ${this.esc(u.whscode || 'SAP')}</p><small>${this.esc(u.estadoCalidad)} · DM ${this.esc(u.detector)}${u.reserva ? ` · Reserva ${this.esc(u.reserva)}` : ''}</small></article>`).join('');
    const mapa = p.mapa.posiciones.length
      ? `<h3>Posiciones físicas WMS</h3><div class="locations">${p.mapa.posiciones.map(u => `<article><header><b>${this.esc(u.camara)}</b><strong>${this.esc([u.banda != null ? `Banda ${u.banda}` : '',u.posicion != null ? `P${u.posicion}` : '',u.altura].filter(Boolean).join(' · ') || 'Posición')}</strong></header><small>Fuente: Mapa WMS</small></article>`).join('')}</div>`
      : `<h3>Posiciones físicas WMS</h3><p class="muted">Sin posiciones registradas en Mapa WMS.</p>`;

    this.modal(`<header><h2>📍 Lote ${this.esc(p.idLote)} — ubicaciones</h2><button onclick="LoteDetalladoController.cerrarModal()">×</button></header>${p.multiAlmacenSap ? `<div class="lote-duplicate">ℹ️ Saldo SAP válido distribuido en ${p.almacenesSap} almacenes. No se considera duplicidad por sí solo.</div>` : ''}<h3>Ocurrencias SAP</h3><div class="locations">${sap}</div>${mapa}<footer>Saldo lógico total <b>${this.fmt(p.cajas)} cajas · ${this.fmt(p.kilos)} kg</b></footer>`,'locations-modal');
  },

  colorAlmacen(nombre) {
    return ALMACENES_PIVOT.find(x => x.id === nombre)?.color || '#64748b';
  },

  limpiar() {
    this.requestId += 1;
    this.resultado = null;
    this.texto = '';
    this.cerrarModal();
    const result = document.getElementById('loteResult');
    if (result) result.innerHTML = this.estadoInicial();
    const input = document.getElementById('loteSearchInput');
    if (input) { input.value = ''; input.focus(); }
    this.toast('Búsqueda limpia.','info');
  },

  modal(html,clase='') {
    document.getElementById('stockModal')?.remove();
    document.body.insertAdjacentHTML('beforeend',`<div id="stockModal" class="stock-modal-backdrop" onclick="if(event.target===this)LoteDetalladoController.cerrarModal()"><section class="stock-modal ${clase}">${html}</section></div>`);
  },

  cerrarModal() { document.getElementById('stockModal')?.remove(); },
  toast(text,type='success') { return NotificationService.show(text,{type}); }
};
