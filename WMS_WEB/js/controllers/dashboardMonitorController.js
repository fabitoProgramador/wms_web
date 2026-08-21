/** Monitor en Tiempo Real: UI existente + contratos remotos de Supabase. */
(() => {
  DashboardController.monitorFilter = DashboardController.monitorFilter || 'TODOS';
  DashboardController.monitorContainer = null;
  DashboardController.monitorRefreshTimer = null;
  DashboardController.monitorRefreshDebounce = null;
  DashboardController.monitorRequestId = 0;
  DashboardController.monitorRefreshInFlight = false;
  DashboardController._monitorEventsBound = false;

  DashboardController.renderMonitor = async function(container) {
    this.monitorContainer = container;
    this.monitorFilter = String(this.monitorFilter || 'TODOS').toUpperCase();
    container.innerHTML = `<section class="panel-control-view monitor-view">
      ${this.operationalHeader({ title: 'Monitor en Tiempo Real', status: 'Centro de actividad operacional · Supabase' })}
      <section class="monitor-now panel-surface"><header><div><span>ESTADO OPERACIONAL ACTUAL</span><h2>Operación en curso</h2></div><time id="monitorLastUpdate">Actualizando…</time></header><div id="monitorNowGrid" class="monitor-now-grid"></div></section>
      <div id="monitorStats" class="monitor-stats" aria-label="Indicadores operacionales"></div>
      <div class="monitor-primary-grid">
        <article class="monitor-card monitor-feed-card panel-surface"><header class="monitor-card-head"><div><span>ACTIVIDAD OPERACIONAL</span><h3>Eventos registrados</h3></div><div id="monitorFeedFilters" class="monitor-feed-filters" role="group" aria-label="Filtrar eventos"><button type="button" class="active" data-monitor-filter="TODOS">Todos</button></div></header><div id="monitorTimeline" class="timeline operational-feed">${this.loading('Consultando eventos en Supabase…')}</div></article>
        <article class="monitor-card monitor-alert-card panel-surface"><header class="monitor-card-head"><div><span>PRIORIZACIÓN</span><h3>Alertas operacionales</h3></div></header><div id="monitorAlerts" class="alerts-list">${this.loading('Calculando alertas…')}</div></article>
      </div>
      <article class="monitor-card monitor-occupancy-card compact panel-surface"><header class="monitor-card-head"><div><span>STOCK DE CÁMARAS</span><h3>Ocupación por cámara</h3></div></header><div id="monitorOccupancy" class="segment-list">${this.loading('Consultando ocupación…')}</div></article>
    </section>`;
    this.bindMonitorUpdates();
    this.startOperationalClock();
    await this.refreshMonitor({ force: true });
  };

  DashboardController.bindMonitorUpdates = function() {
    if (!this._monitorEventsBound) {
      this._monitorEventsBound = true;
      ['online','offline'].forEach(name => window.addEventListener(name, () => this.scheduleMonitorRefresh()));
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') this.scheduleMonitorRefresh();
      });
    }
    clearInterval(this.monitorRefreshTimer);
    this.monitorRefreshTimer = setInterval(() => {
      if (AppController.activeView === 'monitor_tiempo_real' && document.visibilityState !== 'hidden') {
        this.refreshMonitor();
      }
    }, 15000);
  };

  DashboardController.scheduleMonitorRefresh = function() {
    if (AppController.activeView !== 'monitor_tiempo_real') return;
    clearTimeout(this.monitorRefreshDebounce);
    this.monitorRefreshDebounce = setTimeout(() => this.refreshMonitor({ force: true }), 180);
  };

  DashboardController.bindMonitorFilters = function(filtros = []) {
    const holder = this.monitorContainer?.querySelector('#monitorFeedFilters');
    if (!holder) return;
    holder.innerHTML = filtros.map(f => `<button type="button" data-monitor-filter="${this.escape(f.valor)}" class="${f.valor === this.monitorFilter ? 'active' : ''}">${this.escape(f.nombre)}</button>`).join('');
    holder.querySelectorAll('[data-monitor-filter]').forEach(button => {
      button.onclick = () => {
        const next = String(button.dataset.monitorFilter || 'TODOS').toUpperCase();
        if (next === this.monitorFilter) return;
        this.monitorFilter = next;
        holder.querySelectorAll('[data-monitor-filter]').forEach(x => x.classList.toggle('active', x === button));
        this.refreshMonitor({ force: true });
      };
    });
  };

  DashboardController.patchHtml = function(id, html) {
    const node = this.monitorContainer?.querySelector(`#${id}`);
    if (node && node.innerHTML !== html) node.innerHTML = html;
  };

  DashboardController.refreshMonitor = async function({ force = false } = {}) {
    if (AppController.activeView !== 'monitor_tiempo_real' || !this.monitorContainer) return;
    if (!navigator.onLine) {
      this.monitorRequestId += 1;
      this.monitorRefreshInFlight = false;
      this.patchHtml('monitorNowGrid', [
        ['Conectividad','Sin conexión','El shell puede seguir disponible; los datos WMS requieren Supabase','warning'],
        ['Backend','No disponible','No se utilizan datos operacionales locales','critical']
      ].map(x => `<article class="${x[3]}"><span>${x[0]}</span><b>${this.escape(x[1])}</b><small>${this.escape(x[2])}</small></article>`).join(''));
      this.patchHtml('monitorTimeline', this.empty('Sin conexión con Supabase. No se muestran eventos locales como reemplazo.'));
      this.patchHtml('monitorAlerts', this.empty('Las alertas operacionales requieren conexión con el backend.'));
      this.patchHtml('monitorOccupancy', this.empty('La ocupación operacional requiere conexión con Supabase.'));
      return;
    }
    if (this.monitorRefreshInFlight && !force) return;

    const filtro = this.monitorFilter;
    const requestId = ++this.monitorRequestId;
    this.monitorRefreshInFlight = true;
    try {
      const m = await DashboardModel.monitor(filtro);
      if (requestId !== this.monitorRequestId || filtro !== this.monitorFilter || AppController.activeView !== 'monitor_tiempo_real' || !this.monitorContainer) return;

      this.bindMonitorFilters(m.filtros);
      const sync = m.sincronizacion;
      const syncTone = sync.sincronizado ? 'success' : 'critical';
      const syncLabel = sync.sincronizado ? 'Sincronizado' : 'Pendiente';
      const syncDetail = `${sync.idsPadre.toLocaleString('es-CL')} SAP / ${sync.instanciasActivas.toLocaleString('es-CL')} WMS`;
      const ultimaGlobal = Date.parse(m.ultimaActividadEn || '') || 0;

      this.patchHtml('monitorNowGrid', [
        ['Conectividad','En línea','Supabase respondió correctamente','success'],
        ['SAP ↔ WMS',syncLabel,syncDetail,syncTone],
        ['Última actividad',ultimaGlobal ? this.eventDateTime(ultimaGlobal) : 'Sin actividad','Último evento o sincronización registrada por backend','info'],
        ['Stock WMS actual',m.stock.pallets.toLocaleString('es-CL'),`${m.stock.cajas.toLocaleString('es-CL')} cajas · ${m.stock.kilos.toLocaleString('es-CL')} kg`,'info']
      ].map(x => `<article class="${x[3]}"><span>${this.escape(x[0])}</span><b>${this.escape(x[1])}</b><small>${this.escape(x[2])}</small></article>`).join(''));

      this.patchHtml('monitorStats', [
        ['Ocupación stock',`${m.stockCamaras.porcentaje.toFixed(1)}%`,m.stockCamaras.porcentaje >= 90 ? 'danger' : 'info'],
        ['Pallets en cámaras',m.stockCamaras.pallets.toLocaleString('es-CL'),'info'],
        ['Pedidos',m.indicadores.pedidos.toLocaleString('es-CL'),'pink'],
        ['Reproceso',m.indicadores.reproceso.toLocaleString('es-CL'),'purple']
      ].map(x => `<article class="monitor-stat ${x[2]}"><span>${x[0]}</span><strong>${x[1]}</strong></article>`).join(''));

      this.patchHtml('monitorTimeline', m.actividad.length
        ? m.actividad.map(event => this.monitorEvent(event)).join('')
        : this.empty('No existen eventos registrados para este filtro.'));

      this.patchHtml('monitorAlerts', m.alertas.length
        ? m.alertas.map(a => `<div class="alert ${a.nivel}"><i>${a.nivel === 'critica' ? '×' : a.nivel === 'advertencia' || a.nivel === 'atencion' ? '!' : 'i'}</i><p><b>${this.escape(a.titulo)}</b><span>${this.escape(a.detalle)}</span></p></div>`).join('')
        : `<div class="alert correcta"><i>✓</i><p><b>Operación sin alertas activas</b><span>Backend, stock y reglas actuales no reportan condiciones que requieran atención.</span></p></div>`);

      const mapaPorCamara = new Map(m.mapa.camaras.map(c => [DashboardModel.normalizarEstado(c.nombre), c]));
      this.patchHtml('monitorOccupancy', m.stockCamaras.camaras.map(c => {
        const map = mapaPorCamara.get(DashboardModel.normalizarEstado(c.nombre));
        const mapText = map ? `Mapa WMS: ${map.posiciones.toLocaleString('es-CL')} posiciones · ${map.porcentaje.toFixed(1)}%` : 'Mapa WMS: sin registro de posiciones';
        return `<article><span><b>${this.escape(c.nombre)}</b><em>${c.pallets.toLocaleString('es-CL')} / ${c.capacidad.toLocaleString('es-CL')} pallets · ${c.porcentaje.toFixed(1)}%</em></span><div><i style="width:${Math.min(100,Math.max(0,c.porcentaje))}%"></i></div><small>${c.disponibles.toLocaleString('es-CL')} disponibles · ${this.escape(mapText)}</small></article>`;
      }).join('') || this.empty('No hay cámaras configuradas.'));

      const updated = this.monitorContainer.querySelector('#monitorLastUpdate');
      if (updated) updated.textContent = `Actualizado ${this.eventDateTime(Date.parse(m.actualizadoEn || '') || Date.now())}`;
    } catch (error) {
      if (requestId !== this.monitorRequestId) return;
      this.patchHtml('monitorNowGrid', `<article class="critical"><span>Backend</span><b>No disponible</b><small>${this.escape(error?.message || 'Error de consulta')}</small></article>`);
      this.patchHtml('monitorTimeline', this.empty('No fue posible obtener eventos de Supabase.'));
      this.patchHtml('monitorAlerts', this.empty('No fue posible calcular alertas sin backend.'));
      this.patchHtml('monitorOccupancy', this.empty('No fue posible consultar ocupación.'));
    } finally {
      if (requestId === this.monitorRequestId) this.monitorRefreshInFlight = false;
    }
  };

  DashboardController.eventDateTime = function(timestamp) {
    if (!timestamp) return '—';
    return new Date(timestamp).toLocaleString('es-CL', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
  };

  DashboardController.eventTime = function(timestamp) {
    return timestamp ? new Date(timestamp).toLocaleTimeString('es-CL', { hour:'2-digit', minute:'2-digit' }) : '—';
  };

  DashboardController.monitorEvent = function(event) {
    const icons = { sincronizacion:'↻', mapa:'⌖', gruero:'↔', verificacion:'✓', inventario:'▣', carga:'⇩', operacion:'◆' };
    const meta = [event.ubicacion && event.ubicacion !== 'TODOS' ? event.ubicacion : '', event.usuario, event.estado].filter(Boolean).join(' · ');
    return `<article class="monitor-event ${this.escape(event.severidad)}" data-event-type="${this.escape(event.tipo)}"><time>${this.eventTime(event.timestamp)}</time><i>${icons[event.tipo] || '•'}</i><div><header><b>${this.escape(event.titulo)}</b>${event.referencia ? `<strong>${this.escape(event.referencia)}</strong>` : ''}</header>${event.detalle ? `<p>${this.escape(event.detalle)}</p>` : ''}${meta ? `<small>${this.escape(meta)}</small>` : ''}</div></article>`;
  };
})();
