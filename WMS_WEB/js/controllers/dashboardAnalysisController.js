/** Submenú Análisis Operacional: catálogo dinámico y lectura por almacén SAP. */
(() => {
  DashboardController.analysisSummary = function(label, value, detail, tone) {
    return `<article class="analysis-summary-card ${tone}"><span>${this.escape(label)}</span><strong>${this.escape(value)}</strong><small>${this.escape(detail)}</small></article>`;
  };

  DashboardController.chartCard = function(title, sub, content, cls = '') {
    return `<article class="chart-card panel-surface ${cls}"><header><div><h3>${this.escape(title)}</h3><p>${this.escape(sub)}</p></div></header><div class="chart-body">${content}</div></article>`;
  };

  DashboardController.bars = function(items, colors = [], horizontal = false) {
    if (!items.length) return this.empty('No hay datos disponibles');
    const max = Math.max(...items.map(x => Number(x.valor || 0)), 1);
    return `<div class="chart-bars ${horizontal ? 'horizontal' : ''}">${items.map((x, i) => {
      const valor = Number(x.valor || 0);
      const pct = valor > 0 ? Math.max(3, valor / max * 100) : 0;
      return `<div class="chart-bar-item"><div class="chart-value">${valor.toLocaleString('es-CL')}</div><div class="chart-bar-track"><span style="${horizontal ? 'width' : 'height'}:${pct}%;background:${colors[i] || '#10b981'}"></span></div><div class="chart-label" title="${this.escape(x.nombre)}">${this.escape(x.nombre)}</div></div>`;
    }).join('')}</div>`;
  };

  DashboardController.donut = function(items) {
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
  };

  DashboardController.analysisStockBars = function(items) {
    if (!items.length) return this.empty('No hay almacenes en el alcance seleccionado');
    return `<div class="capacity-bars">${items.map(x => {
      const cap = x.capacidad !== null && x.capacidad > 0;
      const pct = cap && x.porcentaje !== null ? Number(x.porcentaje) : null;
      return `<article><header><b>${this.escape(x.nombre)}</b><span>${pct === null ? 'Stock' : `${pct.toFixed(1)}%`}</span></header><div><i style="width:${pct === null ? 0 : Math.min(100, Math.max(0, pct))}%"></i></div><footer><span>${Number(x.pallets || 0).toLocaleString('es-CL')} pallets</span><span>${cap ? `${Number(x.disponibles || 0).toLocaleString('es-CL')} disponibles · cap. ${Number(x.capacidad).toLocaleString('es-CL')}` : 'Sin capacidad física configurada'}</span></footer></article>`;
    }).join('')}</div>`;
  };

  DashboardController.capacityBars = function(items) {
    if (!items.length) return this.empty('No hay cámaras en el alcance seleccionado');
    return `<div class="capacity-bars">${items.map(x => `<article><header><b>${this.escape(x.nombre)}</b><span>${Number(x.porcentaje || 0).toFixed(1)}%</span></header><div><i style="width:${Math.min(100, Math.max(0, Number(x.porcentaje || 0)))}%"></i></div><footer><span>${Number(x.posicionado ?? x.posicionados ?? 0).toLocaleString('es-CL')} posicionados</span><span>${Number(x.capacidad || 0).toLocaleString('es-CL')} posiciones</span></footer></article>`).join('')}</div>`;
  };

  DashboardController.occupancyTrendChart = function(series) {
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
        const x = minT === maxT || !Number.isFinite(ts)
          ? (s.puntos.length === 1 ? 50 : 5 + i / Math.max(1, s.puntos.length - 1) * 90)
          : 5 + (ts - minT) / (maxT - minT) * 90;
        const pct = Math.max(0, Math.min(100, Number(p.valor || 0)));
        return { x, y: 90 - pct * .75, pct };
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
  };

  DashboardController.lineChart = function(items) {
    if (!items.length) return this.empty('Sin registros para este período');
    const max = Math.max(...items.map(x => Number(x.valor || 0)), 1);
    const min = Math.min(...items.map(x => Number(x.valor || 0)));
    const den = Math.max(1, max - min);
    const pts = items.map((x, i) => `${items.length === 1 ? 50 : 5 + i / (items.length - 1) * 90},${82 - (Number(x.valor || 0) - min) / den * 65}`).join(' ');
    return `<svg class="line-chart" viewBox="0 0 100 100" preserveAspectRatio="none"><defs><linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#10b981" stop-opacity=".45"/><stop offset="1" stop-color="#10b981" stop-opacity="0"/></linearGradient></defs><polygon points="5,90 ${pts} 95,90" fill="url(#area)"/><polyline points="${pts}" fill="none" stroke="#10b981" stroke-width="2" vector-effect="non-scaling-stroke"/></svg><div class="axis-labels"><span>${this.escape(items[0].fecha)}</span><span>${this.escape(items.at(-1).fecha)}</span></div>`;
  };

  DashboardController.flow = function(items) {
    const max = Math.max(...items.map(x => Number(x.valor || 0)), 1);
    return `<div class="flow-chart">${items.map((x, i) => {
      const valor = Number(x.valor || 0);
      const width = valor > 0 ? Math.max(22, valor / max * 100) : 0;
      return `<div class="flow-step"><span>${this.escape(x.nombre)}</span><div style="width:${width}%">${valor.toLocaleString('es-CL')}</div>${i < items.length - 1 ? '<i>›</i>' : ''}</div>`;
    }).join('')}</div>`;
  };

  DashboardController.renderAnalisis = async function(container) {
    container.innerHTML = `<section class="panel-control-view">${this.operationalHeader({ eyebrow: 'ANÁLISIS DE LA OPERACIÓN', title: 'Análisis Operacional', status: 'Stock, tendencia y actividad desde Supabase' })}${this.loading('Calculando análisis desde Supabase…')}</section>`;
    this.startOperationalClock();
    try {
      const a = await DashboardModel.analisis(this.analysisFilters);
      const periodoTexto = ({ HOY:'Hoy','7D':'Últimos 7 días','30D':'Últimos 30 días','90D':'Últimos 90 días',TODO:'Todo el registro' })[a.periodo] || a.periodo;
      const options = a.almacenesDisponibles.map(x => `<option value="${this.escape(x.valor)}">${this.escape(x.esAlcanceFisico ? `Todos · ${x.nombre}` : `${x.nombre}${x.whscode ? ` · ${x.whscode}` : ''}`)}</option>`).join('');
      const flujo = `↗ ${a.movimientosStock.entradas.toLocaleString('es-CL')} / ↘ ${a.movimientosStock.salidas.toLocaleString('es-CL')}`;
      const summary3 = a.tieneCapacidad
        ? this.analysisSummary('Ocupación de stock', `${Number(a.ocupacionStock || 0).toFixed(1)}%`, `${a.palletsStock.toLocaleString('es-CL')} de ${Number(a.capacidadStock || 0).toLocaleString('es-CL')} pallets · ${Number(a.disponiblesStock || 0).toLocaleString('es-CL')} disponibles`, Number(a.ocupacionStock || 0) >= 85 ? 'risk' : 'capacity')
        : this.analysisSummary('Kilos actuales', a.kilos.toLocaleString('es-CL'), 'Saldo SAP del almacén', 'capacity');
      const summary4 = a.tieneCapacidad
        ? this.analysisSummary('Posiciones WMS', a.posicionados.toLocaleString('es-CL'), `${a.ocupacionMapa == null ? '—' : a.ocupacionMapa.toFixed(1) + '%'} de ocupación física registrada`, 'slots')
        : this.analysisSummary('Flujo del período', flujo, 'Entradas / salidas detectadas entre sincronizaciones', 'slots');

      let tendencia;
      if (a.tieneCapacidad || a.esAlcanceFisico) {
        const adaptada = a.tendenciaStock.map(s => ({ nombre:s.nombre, puntos:s.puntos.map(p => ({ fecha:p.fecha, valor:p.ocupacion == null ? 0 : p.ocupacion, deltaPallets:p.deltaPallets })) }));
        tendencia = this.occupancyTrendChart(adaptada);
      } else {
        const puntos = a.tendenciaStock[0]?.puntos || [];
        tendencia = this.lineChart(puntos.map(p => ({ fecha: p.fecha ? new Date(p.fecha).toLocaleDateString('es-CL',{day:'2-digit',month:'2-digit'}) : '—', valor:p.pallets })));
      }

      const capacitySection = a.tieneCapacidad || a.esAlcanceFisico
        ? `<h2 class="group-title">Capacidad</h2><div class="analysis-grid">${this.chartCard('Ocupación de stock por Cámara','Pallets SAP sobre capacidad configurada',this.analysisStockBars(a.camarasStock))}${this.chartCard('Capacidad de stock utilizada',`${a.palletsStock.toLocaleString('es-CL')} de ${Number(a.capacidadStock || 0).toLocaleString('es-CL')} pallets`,`<div class="gauge-wrap"><div class="gauge ${Number(a.ocupacionStock || 0)>85?'danger':Number(a.ocupacionStock || 0)>60?'warn':''}" style="--pct:${Number(a.ocupacionStock || 0)}"><strong>${Math.round(Number(a.ocupacionStock || 0))}%</strong></div></div>`)}${this.chartCard('Posiciones registradas en Mapa WMS','Capa física independiente del saldo SAP',this.capacityBars(a.camarasMapa),'wide')}</div>`
        : `<h2 class="group-title">Lectura de almacén</h2>${this.chartCard('Stock del almacén','Sin capacidad física configurada; se analiza por stock y movimiento',this.analysisStockBars(a.camarasStock),'wide')}`;

      container.innerHTML = `<section class="panel-control-view">
        ${this.operationalHeader({ eyebrow:'ANÁLISIS DE LA OPERACIÓN', title:'Análisis Operacional', status:'Stock, tendencia y actividad desde Supabase' })}
        <section class="analysis-toolbar panel-surface"><div><span>ALCANCE ANALÍTICO</span><b>Stock actual + actividad del período seleccionado</b></div><label><span>Almacén</span><select id="analysisWarehouse">${options}</select></label><label><span>Período de actividad</span><select id="analysisPeriod"><option value="HOY">Hoy</option><option value="7D">7 días</option><option value="30D">30 días</option><option value="90D">90 días</option><option value="TODO">Todo</option></select></label></section>
        <div class="analysis-summary">${this.analysisSummary('Pallets actuales',a.stock.toLocaleString('es-CL'),a.nombreAlcance,'stock')}${this.analysisSummary('Cajas actuales',a.cajas.toLocaleString('es-CL'),'Saldo SAP del alcance','boxes')}${summary3}${summary4}</div>
        <h2 class="group-title">Tendencias</h2><div class="analysis-grid">${this.chartCard(a.tieneCapacidad||a.esAlcanceFisico?'Tendencia de ocupación':'Tendencia de stock',`${periodoTexto} · snapshots del almacén`,tendencia)}${this.chartCard('Actividad registrada',`${periodoTexto} · movimientos SAP + eventos WMS`,this.bars(a.actividad,['#10b981','#f59e0b','#06b6d4','#ef4444','#8b5cf6']))}</div>
        <h2 class="group-title">Distribución</h2><div class="analysis-grid">${this.chartCard('Distribución por Estado','Participación sobre pallets del alcance actual',this.donut(a.distribucion))}${this.chartCard('Top 5 Productos','Artículos con más cajas dentro del alcance actual',this.bars(a.topProductos,[],true))}</div>
        ${capacitySection}
        <h2 class="group-title">Lectura operacional actual</h2>${this.chartCard('Distribución actual por etapa','Condiciones WMS actuales; pueden superponerse',this.flow(a.flujo),'wide')}
        <h2 class="group-title">Insights calculados</h2><section class="analysis-insights panel-surface">${a.insights.length?a.insights.map(x=>`<article class="${x.tipo}"><i>${x.tipo==='warning'?'!':x.tipo==='success'?'✓':'i'}</i><div><b>${this.escape(x.titulo)}</b><span>${this.escape(x.detalle)}</span></div></article>`).join(''):this.empty('No hay observaciones relevantes para este alcance.')}</section>
      </section>`;

      const warehouse=container.querySelector('#analysisWarehouse'), period=container.querySelector('#analysisPeriod');
      warehouse.value=a.camara; period.value=a.periodo;
      warehouse.onchange=()=>{ this.analysisFilters.camara=warehouse.value; this.renderAnalisis(container); };
      period.onchange=()=>{ this.analysisFilters.periodo=period.value; this.renderAnalisis(container); };
      this.startOperationalClock();
    } catch(error) { this.errorView(container,'Análisis Operacional',error); }
  };
})();
