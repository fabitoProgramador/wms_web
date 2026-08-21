/** Submenú Análisis Operacional: catálogo dinámico y lectura por almacén SAP. */
(() => {
  DashboardController.analysisStockBars = function(items) {
    if (!items.length) return this.empty('No hay almacenes en el alcance seleccionado');
    return `<div class="capacity-bars">${items.map(x => {
      const cap = x.capacidad !== null && x.capacidad > 0;
      const pct = cap && x.porcentaje !== null ? Number(x.porcentaje) : null;
      return `<article><header><b>${this.escape(x.nombre)}</b><span>${pct === null ? 'Stock' : `${pct.toFixed(1)}%`}</span></header><div><i style="width:${pct === null ? 0 : Math.min(100, Math.max(0, pct))}%"></i></div><footer><span>${Number(x.pallets || 0).toLocaleString('es-CL')} pallets</span><span>${cap ? `${Number(x.disponibles || 0).toLocaleString('es-CL')} disponibles · cap. ${Number(x.capacidad).toLocaleString('es-CL')}` : 'Sin capacidad física configurada'}</span></footer></article>`;
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
