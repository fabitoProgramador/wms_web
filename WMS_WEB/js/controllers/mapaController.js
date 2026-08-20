/** Orquestador web del módulo Mapa. El visor fiel consume MapaModel. */
const MapaController = {
  activeCamera: 'PROTER',
  selectedPalletId: null,
  selectedSlot: null,
  inventoryCamera: 'proter',
  inventoryFilter: 'todos',
  inventorySearch: '',
  inventoryPage: 1,
  zoom: 1,
  viewerMode: '2D',
  renderer: null,
  viewCache: new Map(),
  pendingMovePalletId: null,
  pendingPalletIds: new Set(),
  overlayAnchor: null,
  selectedCellElement: null,

  /* Escape unico del proyecto: SeguridadService.escaparHtml. Antes cada
     archivo tenia el suyo y seis de ellos no escapaban comillas, lo que dejaba
     abierta la inyeccion dentro de atributos. */
  esc(v) { return SeguridadService.escaparHtml(v); },
  cameraLabel() { return this.activeCamera === 'PROTER' ? 'CÁMARA PROTER' : 'CÁMARA POST TÚNEL'; },
  tab() { return this.activeCamera === 'PROTER' ? 'embarque' : 'postunel'; },
  state() { return MapaModel.getState(); },
  saveState(s) { MapaModel.saveState(s); MapaOfflineService.scheduleSnapshot('local-preferences'); },

  async init(containerElement, camera = this.activeCamera) {
    containerElement.innerHTML='<section class="map-offline-loading"><span>Preparando mapa operacional…</span></section>';
    const availability=await MapaOfflineService.initialize();
    if(!availability.ok){containerElement.innerHTML='<section class="map-offline-empty"><b>Conexión inicial requerida</b><p>Este dispositivo todavía no tiene un snapshot local del mapa. Conectate a internet para preparar el funcionamiento offline.</p></section>';return;}
    this.pendingPalletIds=await MapaOfflineService.pendingPalletIds();
    this.cancelTouchMove(false);
    this.activeCamera = camera;
    this.selectedPalletId = null;
    this.selectedSlot = null;
    this.viewCache = new Map();
    containerElement.innerHTML = `<section class="map-module" data-camera="${camera}">
      ${DashboardController.operationalHeader({ eyebrow:'MAPA OPERACIONAL', title:this.cameraLabel(), status:'Ubicación, edición y preparación de carga' })}
      <div class="map-context-bar"><div id="mapOfflineStatus" class="map-offline-status" aria-live="polite"></div><div class="map-heading-actions"><div class="map-capacity" id="mapCapacity"></div><div id="mapHeaderTools" class="map-header-tools"></div><div class="map-view-switch" role="group" aria-label="Tipo de vista"><button data-viewer="2D">2D</button><button data-viewer="2.5D">2.5D</button></div></div></div>
      <div id="mapToolbar"></div><div id="mapLegend"></div><div id="mapOverlayRoot" class="map-overlay-root" aria-live="polite"></div>
      <div class="map-stage"><div class="map-scroll" id="faithfulMapViewport"><div id="faithfulMapCanvas"></div></div></div>
    </section>`;
    containerElement.querySelectorAll('[data-viewer]').forEach(button => { button.onclick = () => this.setViewerMode(button.dataset.viewer); });
    this.updateViewerSwitch(); this.renderToolbar(); this.renderLegend(); this.renderMap(true); this.bindKeyboard(); this.bindOverlayPositioning(); this.bindOfflineStatus(); this.renderOfflineStatus(); DashboardController.startOperationalClock();
  },

  bindOfflineStatus(){if(this._offlineBound)return;this._offlineBound=true;window.addEventListener('wms-map-offline-status',async()=>{this.pendingPalletIds=await MapaOfflineService.pendingPalletIds();this.renderOfflineStatus();const module=document.querySelector('.map-module');if(module)this.refreshVisuals();});},
  async renderOfflineStatus(){const root=document.getElementById('mapOfflineStatus');if(!root)return;const status=await MapaOfflineService.status(),stamp=status.snapshot?.timestamp?new Date(status.snapshot.timestamp).toLocaleString('es-CL'):'sin snapshot';root.innerHTML=`<span class="${status.online?'online':'offline'}">● ${status.online?'En línea':'Sin conexión'}</span><span>${status.syncing?'Sincronizando…':status.pending?`${status.pending} movimiento${status.pending===1?'':'s'} pendiente${status.pending===1?'':'s'}`:'✓ Sincronizado localmente'}</span>${status.conflicts?`<button id="mapConflictBtn"><i class="wi wi-alert"></i>${status.conflicts} conflicto${status.conflicts===1?'':'s'}</button>`:''}<small>Datos: ${this.esc(stamp)}</small>`;document.getElementById('mapConflictBtn')?.addEventListener('click',()=>this.openConflictOverlay());},
  positionOf(p){return p?{ubicacion:p.ubicacion,banda:p.banda,posicion:p.posicion,altura:p.altura,estado:p.estado}:null;},
  recordMovement(action,pallet,origin,destination,extra={}){if(!pallet)return;this.pendingPalletIds.add(pallet.id);MapaOfflineService.record({action,palletId:pallet.id,palletCode:PalletModel.codigoVisual(pallet),palletRealId:PalletModel.idLoteReal(pallet),origin,destination,beforeState:origin,...extra}).catch(()=>this.toast('El cambio se aplicó localmente, pero no pudo registrarse en la cola offline.','error'));},
  recordPositionDifferences(before,action){const oldById=new Map(before.map(p=>[p.id,p]));MapaModel.getPallets().forEach(p=>{const old=oldById.get(p.id),origin=this.positionOf(old),destination=this.positionOf(p);if(JSON.stringify(origin)!==JSON.stringify(destination))this.recordMovement(action,p,origin,destination);});},

  setViewerMode(mode) {
    if (!['2D', '2.5D'].includes(mode) || mode === this.viewerMode) return;
    this.viewerMode = mode; this.updateViewerSwitch(); this.renderMap(false);
  },

  updateViewerSwitch() {
    document.querySelectorAll('.map-view-switch [data-viewer]').forEach(button => {
      const active = button.dataset.viewer === this.viewerMode;
      button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
    });
  },

  createRenderer(mode, layer, options) {
    return mode === '2D' ? new Mapa2DRenderer(layer, options) : new MapaIsometricRenderer(layer, options);
  },

  /* ------------------------------------------------------------------ *
   * BUSQUEDA DE LOTES EN EL MAPA
   *
   * Identificadores por los que se puede buscar un pallet. Son varios a
   * proposito: el operador pega lo que tiene a mano, y lo que exporta
   * Visualizar Stock en la columna "ID LOTE" es el ID de lote OFICIAL
   * (id_lote_real, doce digitos), no el codigo interno `lote` (L-xxxx).
   * Comparar solo contra `lote` hacia que pegar la planilla no encontrara
   * absolutamente nada, aunque los pallets estuvieran a la vista.
   * ------------------------------------------------------------------ */
  /* Las claves las define PalletModel.clavesDeBusqueda: son las mismas que
     entiende el buscador de Despacho. No se duplican aca. */
  searchKeys(pallet) {
    return [...PalletModel.clavesDeBusqueda(pallet)];
  },

  isSearchedBy(pallet, searches) {
    if (!searches || !searches.size) return false;
    return this.searchKeys(pallet).some(k => searches.has(k));
  },

  rendererOptions(data) {
    const state = this.state(), filter = state.filters[this.activeCamera], searches = new Set((state.searches[this.activeCamera] || []).map(x => String(x).toUpperCase()));
    const fifo = state.fifo[this.activeCamera] ? MapaModel.fifoIds(this.activeCamera) : new Set();
    return {
      cameraMode: this.activeCamera,
      data,
      isSearched: p => this.isSearchedBy(p, searches),
      isFifo: p => fifo.has(p.id),
      isPending: p => this.pendingPalletIds.has(p.id),
      /* Resaltar es apagar el resto.
       * Marcar el pallet buscado con un borde no alcanza: en una cámara con
       * 180 chips de colores el borde se pierde. Cuando hay una búsqueda
       * activa, todo lo que no coincide se atenúa igual que con el filtro
       * por estado, que es el comportamiento que el operador ya conoce. */
      matchesFilter: p => MapaModel.coincideFiltro(p, this.activeCamera, filter)
        && (!searches.size || this.isSearchedBy(p, searches)),
      onSelect: (p, slot, el) => this.selectCell(p, slot, el),
      onEdit: (p, slot, el) => this.beginCellEdit(p, slot, el),
      onDrop: (id, slot) => this.dropPallet(id, slot),
      onEmptyBand: banda => this.emptyBand(banda)
    };
  },

  renderMap(force = false) {
    const host = document.getElementById('faithfulMapCanvas'); if (!host) return;
    const data = MapaModel.getPallets(), options = this.rendererOptions(data);
    let entry = this.viewCache.get(this.viewerMode);
    if (!entry) {
      const layer = document.createElement('div'); layer.className = 'map-view-layer'; layer.dataset.mode = this.viewerMode; host.appendChild(layer);
      entry = { layer, renderer: this.createRenderer(this.viewerMode, layer, options), stale: true, zoom: null };
      this.viewCache.set(this.viewerMode, entry);
    }
    this.viewCache.forEach((cached, mode) => { cached.layer.hidden = mode !== this.viewerMode; });
    entry.renderer.options = { ...entry.renderer.options, ...options };
    if (force || entry.stale) { entry.renderer.render(data); entry.stale = false; }
    else entry.renderer.updateVisualState?.(options);
    this.renderer = entry.renderer;
    host.style.zoom = this.zoom;
    if (entry.zoom !== this.zoom) { entry.zoom = this.zoom; entry.renderer.setZoom?.(this.zoom); }
    if (this.selectedPalletId) entry.layer.querySelector(`[data-pallet-id="${CSS.escape(this.selectedPalletId)}"]`)?.classList.add('selected');
    const occupied = data.filter(p => p.ubicacion === this.activeCamera && p.banda !== null).length;
    const total = this.activeCamera === 'PROTER' ? 508 : 356;
    const cap = document.getElementById('mapCapacity'); if (cap) cap.innerHTML = `<strong>${occupied}</strong><span>de ${total} slots ocupados</span>`;
    this.renderOverlay();
  },

  renderToolbar() {
    const root = document.getElementById('mapToolbar'); if (!root) return;
    const headerTools = document.getElementById('mapHeaderTools');
    const s = this.state(), searchCount = s.searches[this.activeCamera]?.length || 0, filter = s.filters[this.activeCamera], tab = this.tab();
    const totalCarga = s.cargo[tab].length + s.manuals[tab].length;
    root.innerHTML = `<div class="map-toolbar" role="toolbar" aria-label="Herramientas del mapa">
      <button class="map-search-trigger ${searchCount ? 'active' : ''}" id="mapSearchBtn"><i class="wi wi-search"></i><span>${searchCount ? `${searchCount} lote(s) resaltados` : 'Buscar lotes en el mapa…'}</span></button>
      <button class="map-tool ${s.fifo[this.activeCamera] ? 'active fifo' : ''}" id="mapFifoBtn"><i class="wi wi-sync"></i>FIFO</button>
      <button class="map-tool ${filter !== null ? 'active filter' : ''}" id="mapFilterBtn"><i class="wi wi-filter"></i>FILTROS${filter !== null ? ` (${filter.length})` : ''}</button>
      <button class="map-tool ${totalCarga ? 'active cargo' : ''}" id="mapCargoBtn"><i class="wi wi-truck"></i>CARGA (${totalCarga})</button>
      <button class="map-tool" id="mapExportBtn"><i class="wi wi-download"></i>EXPORTAR</button>
      <button class="map-history" id="mapUndoBtn" ${UndoService.puedeDeshacer(this.activeCamera) ? '' : 'disabled'} title="Deshacer"><i class="wi wi-undo"></i></button>
      <button class="map-history" id="mapRedoBtn" ${UndoService.puedeRehacer(this.activeCamera) ? '' : 'disabled'} title="Rehacer"><i class="wi wi-redo"></i></button>
      ${searchCount ? '<button class="map-clear" id="mapClearSearch">× Limpiar búsqueda</button>' : ''}
      ${filter !== null ? '<button class="map-clear" id="mapClearFilter">× Limpiar filtros</button>' : ''}
    </div>`;
    if (headerTools) headerTools.innerHTML = `<button class="map-tool map-refresh" id="mapRefreshBtn"><i class="wi wi-sync"></i><span>ACTUALIZAR</span></button><div class="map-zoom" aria-label="Zoom del mapa"><button id="mapZoomOut" aria-label="Alejar"><i class="wi wi-minus"></i></button><label><input id="mapZoomValue" type="number" min="65" max="160" step="1" value="${Math.round(this.zoom * 100)}" aria-label="Porcentaje de zoom"><span>%</span></label><button id="mapZoomIn" aria-label="Acercar">+</button><input id="mapZoomRange" type="range" min="65" max="160" step="1" value="${Math.round(this.zoom * 100)}" aria-label="Ajustar zoom"></div>`;
    document.getElementById('mapSearchBtn').onclick = event => this.openOverlay('search', event.currentTarget);
    document.getElementById('mapFifoBtn').onclick = () => { const x = this.state(); x.fifo[this.activeCamera] = !x.fifo[this.activeCamera]; this.saveState(x); this.refreshVisuals(); };
    document.getElementById('mapFilterBtn').onclick = event => this.openOverlay('filter', event.currentTarget);
    document.getElementById('mapCargoBtn').onclick = event => this.openOverlay('cargo', event.currentTarget);
    document.getElementById('mapExportBtn').onclick = event => document.getElementById('mapExportPopover') ? this.closeOverlay() : this.openOverlay('export', event.currentTarget);
    document.getElementById('mapRefreshBtn').onclick = () => this.refreshFromServer();
    document.getElementById('mapUndoBtn').onclick = () => this.undo();
    document.getElementById('mapRedoBtn').onclick = () => this.redo();
    document.getElementById('mapZoomOut').onclick = () => this.setZoom(this.zoom - .05);
    document.getElementById('mapZoomIn').onclick = () => this.setZoom(this.zoom + .05);
    const zoomValue = document.getElementById('mapZoomValue'), zoomRange = document.getElementById('mapZoomRange');
    zoomRange.oninput = e => this.setZoom(Number(e.target.value) / 100, false);
    zoomValue.oninput = e => { if (e.target.value !== '') this.setZoom(Number(e.target.value) / 100, false); };
    zoomValue.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); zoomValue.blur(); } };
    document.getElementById('mapClearSearch')?.addEventListener('click', () => { const x = this.state(); x.searches[this.activeCamera] = []; this.saveState(x); this.refreshVisuals(); this.toast('Búsqueda del mapa eliminada.','info'); });
    document.getElementById('mapClearFilter')?.addEventListener('click', () => { const x = this.state(); x.filters[this.activeCamera] = null; this.saveState(x); this.refreshVisuals(); this.toast('Filtros del mapa eliminados.','info'); });
  },

  renderLegend() {
    const root = document.getElementById('mapLegend'); if (!root) return;
    if (this.activeCamera === 'PROTER') {
      root.innerHTML = `<div class="map-legend-scroll">${Object.entries(COLORES_MAPA_ESTADO).map(([e, c]) => `<span title="${this.esc(e)}"><i style="--legend:${c}"></i>${ABREVIATURAS_ESTADO_MAPA[e] || e.slice(0, 3)}</span>`).join('')}<span title="Mismo código visual en más de una posición"><i style="--legend:${COLOR_MAPA_REPETIDO}"></i>REP</span><span title="Código sin registro válido"><i style="--legend:${COLOR_MAPA_NO_EXISTE}"></i>N/E</span></div>`;
    } else {
      root.innerHTML = `<div class="map-legend-scroll"><span title="Mismo código visual en más de una posición"><i style="--legend:${COLOR_MAPA_REPETIDO}"></i>REPETIDO</span><span title="Código sin registro válido"><i style="--legend:${COLOR_MAPA_NO_EXISTE}"></i>NO EXISTE</span></div>`;
    }
  },

  refresh() { this.viewCache.forEach(entry => { entry.stale = true; }); this.renderToolbar(); this.renderLegend(); this.renderMap(true); },
  async refreshFromServer(){const result=await MapaOfflineService.refreshFromServer();if(result.offline)return this.toast('Sin conexión — usando última información disponible.');if(result.unconfigured)return this.toast('Servidor de mapa no configurado — se conserva el snapshot local.');if(!result.ok)return this.toast(result.error||'No fue posible actualizar el mapa.','error');this.viewCache.forEach(entry=>entry.stale=true);this.refresh();this.toast('✓ Snapshot del mapa actualizado.');},
  refreshVisuals() { this.renderToolbar(); this.renderLegend(); this.renderMap(false); },
  setZoom(value) {
    const numeric = Number(value); if (!Number.isFinite(numeric)) return;
    this.zoom = Math.min(1.6, Math.max(.65, Number(numeric.toFixed(2)))); const c = document.getElementById('faithfulMapCanvas'); if (c) c.style.zoom = this.zoom;
    const entry = this.viewCache.get(this.viewerMode); if (entry) { entry.zoom = this.zoom; entry.renderer.setZoom?.(this.zoom); }
    const percent = Math.round(this.zoom * 100), number = document.getElementById('mapZoomValue'), range = document.getElementById('mapZoomRange'); if (number) number.value = percent; if (range) range.value = percent;
  },

  selectCell(pallet, slot, element) {
    if (this.pendingMovePalletId) { this.chooseTouchDestination(pallet, slot, element); return; }
    this.selectedPalletId = pallet?.id || null; this.selectedSlot = slot;
    document.querySelectorAll('.map-view-layer:not([hidden]) .map-slot.selected').forEach(x => x.classList.remove('selected')); element?.classList.add('selected');
    this.selectedCellElement = element || document.querySelector('.map-view-layer:not([hidden]) .map-slot.selected');
    this.openOverlay(pallet ? 'detail' : 'empty', this.selectedCellElement);
  },

  renderOverlay() { const root = document.getElementById('mapOverlayRoot'); if (root && !root.dataset.mode) root.innerHTML = ''; },
  closeOverlay() {
    const popover = document.getElementById('mapExportPopover');
    if (popover) { popover.classList.add('is-closing'); setTimeout(() => popover.remove(), 130); }
    const root = document.getElementById('mapOverlayRoot'); if (root) { root.innerHTML = ''; delete root.dataset.mode; }
    this.overlayAnchor = null;
  },

  openOverlay(mode, anchor = null) {
    const root = document.getElementById('mapOverlayRoot'); if (!root) return;
    if (typeof Element !== 'undefined' && anchor instanceof Element) {
      this.overlayAnchor = anchor;
      // Se recuerda tambien el id del boton, no solo el elemento: acciones como
      // "Marcar todos" redibujan la barra y el elemento original queda
      // desconectado del documento. Sin el id, el overlay perdia su ancla y
      // saltaba a la esquina del mapa, obligando a reabrir FILTROS.
      this.overlayAnchorId = anchor.id || null;
    }
    if (!this.overlayAnchor && ['detail','empty','move','edit-code','move-confirm'].includes(mode)) this.overlayAnchor = this.selectedCellElement;
    root.dataset.mode = mode;
    if (mode === 'search') this.overlaySearch(root);
    else if (mode === 'filter') this.overlayFilter(root);
    else if (mode === 'cargo') this.overlayCargo(root);
    else if (mode === 'export') this.overlayExport(root);
    else if (mode === 'detail') this.overlayDetail(root);
    else if (mode === 'empty') this.overlayEmpty(root);
    else if (mode === 'move') this.overlayMove(root);
    else if (mode === 'edit-code') this.overlayEditCode(root);
  },

  async openConflictOverlay(){const root=document.getElementById('mapOverlayRoot');if(!root)return;const conflicts=await MapaOfflineService.conflicts(),rows=conflicts.length?conflicts.map(item=>`<article class="map-conflict-row"><b>${this.esc(item.palletCode||item.palletRealId||item.palletId)}</b><span>${this.esc(item.action||'Movimiento')}</span><p>${this.esc(item.reason||item.lastError||'Estado remoto diferente')}</p><small>${this.esc(new Date(item.detectedAt||item.updatedAt).toLocaleString('es-CL'))}</small></article>`).join(''):'<p>No hay conflictos pendientes.</p>';root.dataset.mode='conflicts';this.overlayShell(root,'⚠ Conflictos de sincronización',`<p>No se sobrescribió el estado remoto. Estos movimientos permanecen pendientes de revisión.</p><div class="map-conflict-list">${rows}</div>`,'map-conflict-overlay');},

  overlayShell(root, title, body, cls = '') {
    root.innerHTML = `<aside class="map-overlay ${cls}"><header><h3>${title}</h3><button id="mapOverlayClose" aria-label="Cerrar">×</button></header>${body}</aside>`;
    document.getElementById('mapOverlayClose').onclick = () => this.closeOverlay();
    const overlay = root.querySelector('.map-overlay');
    if (overlay && ['search','filter','cargo','detail','empty','move','edit-code','move-confirm'].includes(root.dataset.mode)) {
      overlay.classList.add('is-contextual-overlay');
      const position = () => this.positionContextOverlay(overlay, this.overlayAnchor, root.dataset.mode);
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(position); else position();
    }
  },

  bindOverlayPositioning() {
    this._positionOverlayHandler ||= () => {
      if (this._positionOverlayFrame) return;
      const refresh = () => { this._positionOverlayFrame = null; this.repositionContextOverlay(); };
      this._positionOverlayFrame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(refresh) : setTimeout(refresh, 0);
    };
    window.removeEventListener('resize', this._positionOverlayHandler);
    window.addEventListener('resize', this._positionOverlayHandler, { passive: true });
    window.removeEventListener('scroll', this._positionOverlayHandler);
    window.addEventListener('scroll', this._positionOverlayHandler, { passive: true });
    this._mapScrollElement?.removeEventListener('scroll', this._positionOverlayHandler);
    this._mapScrollElement = document.getElementById('faithfulMapViewport');
    this._mapScrollElement?.addEventListener('scroll', this._positionOverlayHandler, { passive: true });
  },

  repositionContextOverlay() {
    const root = document.getElementById('mapOverlayRoot'), overlay = root?.querySelector('.is-contextual-overlay');
    if (overlay && root?.dataset.mode) this.positionContextOverlay(overlay, this.overlayAnchor, root.dataset.mode);
  },

  positionContextOverlay(overlay, anchor, mode) {
    const module = document.querySelector('.map-module'), stage = document.querySelector('.map-stage');
    if (!module || !overlay) return;
    const moduleRect = module.getBoundingClientRect(), stageRect = stage?.getBoundingClientRect(), gap = 8, pad = 10;
    const viewport = { left: pad, top: pad, right: window.innerWidth - pad, bottom: window.innerHeight - pad };
    const bounds = stageRect ? {
      left: Math.max(viewport.left, stageRect.left + pad), top: Math.max(viewport.top, stageRect.top + pad),
      right: Math.min(viewport.right, stageRect.right - pad), bottom: Math.min(viewport.bottom, stageRect.bottom - pad)
    } : viewport;
    // Si el ancla quedo desconectada por un redibujado, se recupera por su id
    // antes de caer al rectangulo del escenario: asi el overlay se mantiene
    // pegado a su boton en vez de saltar a la esquina.
    if ((!anchor || !anchor.isConnected) && this.overlayAnchorId) {
      const vivo = document.getElementById(this.overlayAnchorId);
      if (vivo) { anchor = vivo; this.overlayAnchor = vivo; }
    }
    const fallback = stageRect || moduleRect, anchorRect = anchor?.isConnected ? anchor.getBoundingClientRect() : fallback;
    const detail = ['detail','empty','move','edit-code','move-confirm'].includes(mode);
    overlay.style.setProperty('visibility', 'hidden', 'important');
    overlay.style.setProperty('max-height', '', 'important');
    overlay.style.setProperty('height', '', 'important');
    overlay.style.setProperty('width', '', 'important');
    overlay.style.setProperty('position', window.matchMedia('(max-width: 640px)').matches && detail ? 'fixed' : 'absolute', 'important');
    overlay.style.setProperty('inset', 'auto', 'important');
    const rect = overlay.getBoundingClientRect(), width = Math.min(rect.width, Math.max(250, bounds.right - bounds.left)), height = rect.height;
    const clamp = (value, min, max) => Math.min(Math.max(value, min), Math.max(min, max));
    let left, top, availableHeight;
    if (detail) {
      const sideSpace = { right: bounds.right - anchorRect.right - gap, left: anchorRect.left - bounds.left - gap };
      const hasSide = Math.max(sideSpace.right, sideSpace.left) >= Math.min(width, 320);
      if (hasSide) {
        left = sideSpace.right >= sideSpace.left ? anchorRect.right + gap : anchorRect.left - width - gap;
        top = clamp(anchorRect.top + (anchorRect.height / 2) - (height / 2), bounds.top, bounds.bottom - Math.min(height, bounds.bottom - bounds.top));
        availableHeight = bounds.bottom - bounds.top;
      } else {
        const below = bounds.bottom - anchorRect.bottom - gap, above = anchorRect.top - bounds.top - gap;
        const opensBelow = below >= Math.min(height, 250) || below >= above;
        availableHeight = opensBelow ? below : above;
        top = opensBelow ? anchorRect.bottom + gap : anchorRect.top - Math.min(height, availableHeight) - gap;
        left = clamp(anchorRect.left + (anchorRect.width / 2) - (width / 2), bounds.left, bounds.right - width);
      }
    } else {
      const below = viewport.bottom - anchorRect.bottom - gap, above = anchorRect.top - viewport.top - gap;
      const opensBelow = below >= Math.min(height, 190) || below >= above;
      availableHeight = opensBelow ? below : above;
      top = opensBelow ? anchorRect.bottom + gap : anchorRect.top - Math.min(height, availableHeight) - gap;
      left = clamp(anchorRect.left, viewport.left, viewport.right - width);
    }
    const maxHeight = Math.max(detail ? 250 : 170, Math.min(availableHeight, detail ? 640 : 560));
    left = clamp(left, detail ? bounds.left : viewport.left, (detail ? bounds.right : viewport.right) - width);
    top = clamp(top, detail ? bounds.top : viewport.top, (detail ? bounds.bottom : viewport.bottom) - Math.min(height, maxHeight));
    // El ancho calculado tambien se aplica. Antes solo se usaba para acomodar
    // la posicion, mientras el elemento conservaba el ancho del CSS, que en
    // telefono se mide contra el modulo del mapa —mas ancho que la pantalla,
    // porque el mapa se desplaza— y el overlay terminaba saliendose por la
    // derecha. En escritorio el calculo coincide con el CSS y no cambia nada.
    overlay.style.setProperty('width', `${Math.round(width)}px`, 'important');
    if (overlay.style.position === 'fixed') {
      overlay.style.setProperty('left', `${Math.round(left)}px`, 'important');
      overlay.style.setProperty('top', `${Math.round(top)}px`, 'important');
    } else {
      overlay.style.setProperty('left', `${Math.round(left - moduleRect.left)}px`, 'important');
      overlay.style.setProperty('top', `${Math.round(top - moduleRect.top)}px`, 'important');
    }
    overlay.style.setProperty('max-height', `${Math.floor(maxHeight)}px`, 'important');
    overlay.style.setProperty('visibility', 'visible', 'important');
  },

  overlaySearch(root) {
    const value = (this.state().searches[this.activeCamera] || []).join('\n');
    this.overlayShell(root, '🔍 Buscar lotes', `<p>Pegá uno o varios lotes. Se aceptan líneas, comas, tabulaciones y punto y coma.</p><div class="search-input-shell"><textarea id="mapSearchText" rows="10" autofocus placeholder="Un lote, pallet o código por línea…">${this.esc(value)}</textarea><small id="mapSearchCounter" aria-live="polite"></small></div><div class="overlay-actions"><button class="btn-secondary" id="mapSearchClear">Limpiar</button><button class="btn-primary" id="mapSearchApply">Resaltar en mapa</button></div>`, 'search-overlay');
    const input = document.getElementById('mapSearchText');
    // Se acepta lo que realmente sale de Excel: saltos CRLF, comas, tabulaciones,
    // punto y coma, comillas de celda y espacios duros (\u00a0), que al pegar
    // desde una planilla vienen mezclados y antes dejaban el codigo inservible.
    const parse = raw => String(raw || '')
      .replace(/\u00a0/g, ' ')
      .replace(/[,\t;\r|]/g, '\n')
      .split('\n')
      .map(x => x.trim().replace(/^["']+|["']+$/g, '').trim().toUpperCase())
      .filter(Boolean);
    const updateCounter = () => { const entered = parse(input.value); document.getElementById('mapSearchCounter').textContent = `${entered.length} código${entered.length === 1 ? '' : 's'} preparado${entered.length === 1 ? '' : 's'} · ${new Set(entered).size} único${new Set(entered).size === 1 ? '' : 's'}`; };
    input.addEventListener('input', updateCounter); updateCounter(); input.focus();
    /* Aplicar la busqueda.
     *
     * NO se usa GrueroCodeResolver aca. Ese resolutor esta hecho para el
     * gruero: identifica UN pallet y, si el codigo aparece en mas de un
     * registro, se niega a decidir ("Codigo ambiguo") para que nadie mueva
     * el pallet equivocado. Eso es correcto para mover, pero es justo lo
     * contrario de lo que necesita una busqueda: un ID de lote cubre por
     * definicion VARIOS pallets, asi que el resolutor los rechazaba todos y
     * el mapa no resaltaba nada aunque los pallets estuvieran ahi.
     *
     * Aca la ambiguedad no es un peligro, es el objetivo: buscar un lote
     * debe encender todos sus pallets. Por eso se compara directo contra
     * todos los identificadores de cada pallet de la camara activa. */
    document.getElementById('mapSearchApply').onclick = () => {
      const entered = parse(input.value);
      if (!entered.length) { this.toast('Ingresá al menos un lote, pallet o código para buscar.', 'warning'); input.focus(); return; }
      const enCamara = MapaModel.getPallets().filter(p => p.ubicacion === this.activeCamera);
      const indice = new Map();
      enCamara.forEach(p => this.searchKeys(p).forEach(k => {
        if (!indice.has(k)) indice.set(k, []);
        indice.get(k).push(p);
      }));
      const encontrados = [], faltantes = [], palletsTocados = new Set();
      [...new Set(entered)].forEach(code => {
        const hits = indice.get(code);
        if (hits && hits.length) { encontrados.push(code); hits.forEach(p => palletsTocados.add(p.id)); }
        else faltantes.push(code);
      });
      if (!encontrados.length) {
        this.toast(`Ninguno de los ${entered.length} código(s) corresponde a un pallet de ${this.activeCamera}. Revisá que sea la cámara correcta.`, 'error');
        input.focus(); return;
      }
      const s = this.state();
      s.searches[this.activeCamera] = encontrados;   // se guarda lo que escribió el usuario
      this.saveState(s);
      this.closeOverlay();
      this.refreshVisuals();
      this.toast(`${encontrados.length} código(s) encontrado(s) · ${palletsTocados.size} pallet(s) resaltado(s)${faltantes.length ? ` · ${faltantes.length} sin coincidencia` : ''}.`, faltantes.length ? 'warning' : 'success');
    };
    document.getElementById('mapSearchClear').onclick = () => { input.value=''; const s = this.state(); s.searches[this.activeCamera] = []; this.saveState(s); this.refreshVisuals(); input.focus(); this.toast('Búsqueda limpia. Podés ingresar nuevos códigos.','info'); };
  },

  filterOptions() {
    if (this.activeCamera === 'PROTER') return Object.keys(COLORES_MAPA_ESTADO).concat(['REPETIDO', 'NO EXISTE']);
    return [...new Set(MapaModel.getPallets().filter(p => p.ubicacion === 'POST TUNEL' && p.banda !== null).map(p => p.articulo))].sort().concat(['REPETIDO', 'NO EXISTE']);
  },

  overlayFilter(root) {
    const options = this.filterOptions(), state = this.state(), selected = state.filters[this.activeCamera] === null ? new Set(options) : new Set(state.filters[this.activeCamera]);
    const pallets = MapaModel.getPallets();
    const rows = options.map(x => { const color = x === 'REPETIDO' ? COLOR_MAPA_REPETIDO : x === 'NO EXISTE' ? COLOR_MAPA_NO_EXISTE : this.activeCamera === 'PROTER' ? COLORES_MAPA_ESTADO[x] : PalletModel.colorParaArticuloPostunel(x, pallets); return `<label class="map-check"><input type="checkbox" value="${this.esc(x)}" ${selected.has(x) ? 'checked' : ''}><i style="--legend:${color}"></i><span>${this.esc(x)}</span></label>`; }).join('');
    this.overlayShell(root, this.activeCamera === 'PROTER' ? '🎨 Filtros por estado' : '🎨 Filtros por artículo', `<p>Lo no seleccionado se atenúa; las posiciones no desaparecen.</p><div class="filter-shortcuts"><button id="filterAll">Marcar todos</button><button id="filterNone">Desmarcar todos</button></div><div class="map-check-list">${rows}</div>`, 'filter-overlay');
    const apply = () => { const checked = [...root.querySelectorAll('input:checked')].map(x => x.value); const s = this.state(); s.filters[this.activeCamera] = checked.length === options.length ? null : checked; this.saveState(s); this.refreshVisuals(); root.dataset.mode = 'filter'; this.overlayFilter(root); };
    root.querySelectorAll('input').forEach(cb => cb.onchange = apply);
    document.getElementById('filterAll').onclick = () => { const s = this.state(); s.filters[this.activeCamera] = null; this.saveState(s); this.refreshVisuals(); this.openOverlay('filter'); };
    document.getElementById('filterNone').onclick = () => { const s = this.state(); s.filters[this.activeCamera] = []; this.saveState(s); this.refreshVisuals(); this.openOverlay('filter'); };
  },

  overlayDetail(root) {
    const p = MapaModel.getPallets().find(x => x.id === this.selectedPalletId); if (!p) return this.closeOverlay();
    const detail = StockModel.normalizar(p, StockModel.atributosSimulados(String(p.lote || p.id || ''), p));
    const state = this.state(), inLoad = state.cargo[this.tab()].includes(p.id), visual = PalletModel.codigoVisualLegible(p), realId = PalletModel.idLoteReal(p);
    const kilos = Number(detail.kilos_stock ?? PalletModel.kilos(p)).toLocaleString('es-CL');
    const cajas = Number(detail.cajas ?? p.cajas ?? 0).toLocaleString('es-CL');
    const fabrication = detail.fecha_fabricacion || p.fecha_fabricacion || '—';
    const admission = detail.fecha_admision || p.fecha_admision || '—';
    const qualityStatus = detail.calidad_estado || '—';
    const qualityInfo = detail.info_calidad && detail.info_calidad !== '—' ? detail.info_calidad : 'Sin información de calidad registrada.';
    const generalInfo = detail.info_general && detail.info_general !== '—' ? detail.info_general : 'Sin información general registrada.';
    const reserved = String(detail.reservado || (p.estado === 'PEDIDO' ? 'SÍ' : 'NO')).toLocaleUpperCase('es-CL');
    const locationLabel = this.activeCamera === 'PROTER' ? `Banda ${this.esc(p.banda)} · Nivel ${this.esc(p.altura)} · Posición ${p.posicion}` : `Zona ${this.esc(p.banda)} · Nivel ${this.esc(p.altura)} · Posición ${p.posicion}`;
    const information = `<div class="pallet-information-compact">
      <div class="compact-info-row quality" style="--info:#10b981"><span>🔬</span><strong>Calidad <em>${this.esc(qualityStatus)}</em></strong><p>${this.esc(qualityInfo)}</p></div>
      <div class="compact-info-row general" style="--info:#38bdf8"><span>📝</span><strong>Info general</strong><p>${this.esc(generalInfo)}</p></div>
      <div class="compact-reserve ${reserved === 'SÍ' || reserved === 'SI' ? 'reserved' : ''}"><span>Reserva</span><b>${this.esc(reserved)}</b></div>
    </div>`;
    const shortcuts = `<div class="pallet-shortcuts" aria-label="Atajos de teclado"><span><kbd>P</kbd>Carga</span><span><kbd>Espacio</kbd>Editar</span><span><kbd>Supr</kbd>Vaciar</span><span><kbd>Esc</kbd>Cerrar</span></div>`;
    this.overlayShell(root, 'Detalle del pallet', `<div class="pallet-detail-hero"><div class="pallet-visual-code"><small>REFERENCIA VISUAL</small><strong>${this.esc(visual)}</strong></div><span class="map-state-badge" style="--state:${p.repetido ? COLOR_MAPA_REPETIDO : (COLORES_MAPA_ESTADO[p.estado] || '#64748B')}">${this.esc(p.estado)}</span></div><section class="pallet-real-id"><small>ID REAL DEL LOTE</small><strong>${this.esc(realId)}</strong><span>Artículo ${this.esc(p.articulo)} · Pallet ${this.esc(p.numero_pallet || '—')}</span></section><div class="pallet-detail-section product-section"><h4>Producto</h4><dl class="map-detail-grid product-summary"><div class="wide"><dt>Descripción</dt><dd>${this.esc(detail.descripcion || PalletModel.descripcion(p))}</dd></div><div><dt>Artículo</dt><dd>${this.esc(p.articulo)}</dd></div><div><dt>Fabricación</dt><dd>${this.esc(fabrication)}</dd></div><div class="stock-metric"><dt>Kilos</dt><dd>${kilos} <small>kg</small></dd></div><div class="stock-metric"><dt>Cajas</dt><dd>${cajas}</dd></div></dl></div><div class="pallet-detail-section insight-section"><h4>Información asociada</h4>${information}</div><div class="pallet-detail-section trace-section"><h4>Ubicación</h4><dl class="map-detail-grid traceability"><div class="wide"><dt>Posición actual</dt><dd>${locationLabel}</dd></div><div><dt>Admisión</dt><dd>${this.esc(admission)}</dd></div><div><dt>Cámara</dt><dd>${this.esc(p.ubicacion || '—')}</dd></div></dl></div>${p.repetido ? '<p class="map-warning">⚠ Repetido: la referencia visual aparece en más de una posición.</p>' : ''}${shortcuts}<div class="overlay-actions detail-action-grid"><button class="btn-primary" id="detailLoad"><i class="wi wi-truck"></i>${inLoad ? 'Quitar carga' : 'Agregar carga'}</button><button class="btn-secondary" id="detailTouchMove"><i class="wi wi-hand"></i>Elegir destino</button><button class="btn-secondary" id="detailMove"><i class="wi wi-swap"></i>Mover</button><button class="btn-secondary" id="detailEditCode"><i class="wi wi-edit"></i>Editar</button><button class="btn-secondary danger" id="detailDelete"><i class="wi wi-erase"></i>Vaciar</button></div>`, 'detail-overlay pallet-detail-overlay');
    document.getElementById('detailLoad').onclick = () => this.toggleSelectedLoad(p);
    document.getElementById('detailTouchMove').onclick = () => this.startTouchMove(p.id);
    document.getElementById('detailMove').onclick = () => this.openOverlay('move');
    document.getElementById('detailEditCode').onclick = () => this.openOverlay('edit-code');
    document.getElementById('detailDelete').onclick = () => this.removePalletFromPosition(p.id, this.selectedSlot);
  },

  toggleSelectedLoad(pallet = null) {
    const p = pallet || MapaModel.getPallets().find(x => x.id === this.selectedPalletId); if (!p) return;
    const origin=this.positionOf(p);
    const inLoad = this.state().cargo[this.tab()].includes(p.id); if (!inLoad && p.banda !== null) UndoService.guardarSnapshot(this.activeCamera, MapaModel.getPallets());
    const result = inLoad ? MapaModel.quitarDeCarga(this.tab(), p.id) : MapaModel.agregarACarga(p.id); if (!result.ok) return this.toast(result.error, 'error');
    this.recordMovement(inLoad?'QUITAR_CARGA':'AGREGAR_CARGA',p,origin,this.positionOf(p),{loadTab:this.tab()});
    this.closeOverlay(); this.refresh(); if (result.aviso) this.toast(result.aviso);
  },

  removePalletFromPosition(palletId, slot = this.selectedSlot, restoreKeyboard = false) {
    const p = MapaModel.getPallets().find(x => x.id === palletId); if (!p || p.banda === null) return;
    const target = slot || { banda: p.banda, posicion: p.posicion, altura: p.altura };
    const origin=this.positionOf(p);
    UndoService.guardarSnapshot(this.activeCamera, MapaModel.getPallets());
    MapaModel.quitarDePosicion(p.id); this.recordMovement('VACIAR_POSICION',p,origin,this.positionOf(p)); this.closeOverlay(); this.selectedPalletId = null; this.selectedSlot = target; this.refresh();
    if (restoreKeyboard) this.restoreKeyboardCell(target);
    this.toast('Posición vaciada. Podés deshacer la acción con Ctrl+Z.');
  },

  overlayEmpty(root) {
    const s = this.selectedSlot;
    this.overlayShell(root, `Slot vacío · B${this.esc(s.banda)} · P${s.posicion} · ${s.altura}`, '<p>La posición está disponible. En móvil podés crear el pallet sin editar la celda directamente.</p><button class="btn-primary wide" id="emptyAssign"><i class="wi wi-plus"></i>Asignar código visual</button>', 'detail-overlay');
    document.getElementById('emptyAssign').onclick = () => this.openOverlay('edit-code');
  },

  overlayEditCode(root) {
    const slot = this.selectedSlot, pallet = MapaModel.getPallets().find(x => x.id === this.selectedPalletId), value = pallet ? PalletModel.codigoVisual(pallet) : '';
    this.overlayShell(root, pallet ? `Editar ${this.esc(PalletModel.codigoVisualLegible(pallet))}` : 'Asignar pallet al slot', `<p>${pallet ? 'Modificá la referencia visual del pallet.' : `Destino: banda ${this.esc(slot.banda)}, posición ${slot.posicion}, nivel ${slot.altura}.`}</p><label class="touch-code-field"><span>Código visual</span><input id="touchCodeInput" maxlength="8" value="${this.esc(value)}" placeholder="Ej: A234" autocomplete="off" autocapitalize="characters"></label><div class="overlay-actions"><button class="btn-secondary" id="touchCodeCancel">Cancelar</button><button class="btn-primary" id="touchCodeSave">Guardar</button></div>`, 'edit-code-overlay touch-action-overlay');
    const input = document.getElementById('touchCodeInput'); input.focus(); input.select();
    const save = () => { const code = input.value.trim(); if (!code) return this.toast('Ingresá un código visual.', 'error'); const origin=this.positionOf(pallet);UndoService.guardarSnapshot(this.activeCamera, MapaModel.getPallets()); const result = MapaModel.editarCelda(this.activeCamera, slot.banda, slot.posicion, slot.altura, code); if (!result.ok) return this.toast(result.error || 'No se pudo guardar el código.', 'error');this.recordMovement(pallet?'EDITAR_REFERENCIA':'ASIGNAR_PALLET',result.pallet||pallet,origin,this.positionOf(result.pallet||pallet),{enteredCode:code}); this.closeOverlay(); this.refresh(); };
    document.getElementById('touchCodeCancel').onclick = () => this.closeOverlay(); document.getElementById('touchCodeSave').onclick = save; input.onkeydown = e => { if (e.key === 'Enter') save(); };
  },

  beginCellEdit(pallet, slot, cell) {
    if (!cell) return;
    const original = pallet ? PalletModel.codigoVisual(pallet) : '';
    cell.innerHTML = `<input class="map-cell-editor" aria-label="Código visual" maxlength="8" value="${this.esc(original)}">`;
    const input = cell.querySelector('input'); input.focus(); input.select();
    const finish = save => { if (save) { const origin=this.positionOf(pallet);UndoService.guardarSnapshot(this.activeCamera, MapaModel.getPallets());const result=MapaModel.editarCelda(this.activeCamera, slot.banda, slot.posicion, slot.altura, input.value);if(result.ok)this.recordMovement(pallet?'EDITAR_REFERENCIA':'ASIGNAR_PALLET',result.pallet||pallet,origin,this.positionOf(result.pallet||pallet),{enteredCode:input.value}); } this.refresh(); };
    input.onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); };
    input.onblur = () => setTimeout(() => { if (document.body.contains(input)) finish(false); }, 80);
  },

  startTouchMove(palletId) {
    const pallet = MapaModel.getPallets().find(x => x.id === palletId); if (!pallet) return;
    this.pendingMovePalletId = palletId; this.closeOverlay();
    document.querySelector('.map-module')?.classList.add('is-picking-destination');
    this.renderTouchMoveBanner(pallet);
  },

  renderTouchMoveBanner(pallet) {
    document.getElementById('mapTouchMoveBanner')?.remove(); const stage = document.querySelector('.map-stage'); if (!stage) return;
    const banner = document.createElement('div'); banner.id = 'mapTouchMoveBanner'; banner.className = 'map-touch-move-banner'; banner.innerHTML = `<span><b>Moviendo ${this.esc(PalletModel.codigoVisualLegible(pallet))}</b><small>Deslizá el mapa y tocá la celda de destino.</small></span><button type="button">Cancelar</button>`; banner.querySelector('button').onclick = () => this.cancelTouchMove(); stage.appendChild(banner);
  },

  cancelTouchMove(clearSelection = true) {
    this.pendingMovePalletId = null; document.getElementById('mapTouchMoveBanner')?.remove(); document.querySelector('.map-module')?.classList.remove('is-picking-destination'); document.querySelectorAll('.map-slot.touch-destination').forEach(x => x.classList.remove('touch-destination'));
    if (clearSelection) { document.querySelectorAll('.map-slot.selected').forEach(x => x.classList.remove('selected')); this.selectedPalletId = null; this.selectedSlot = null; }
  },

  chooseTouchDestination(occupant, slot, element) {
    const moving = MapaModel.getPallets().find(x => x.id === this.pendingMovePalletId); if (!moving) return this.cancelTouchMove();
    if (String(moving.banda) === String(slot.banda) && Number(moving.posicion) === Number(slot.posicion) && moving.altura === slot.altura) return this.toast('Ese pallet ya se encuentra en esa posición.', 'error');
    this.selectedSlot = slot; this.overlayAnchor = element || this.selectedCellElement; document.querySelectorAll('.map-slot.touch-destination').forEach(x => x.classList.remove('touch-destination')); element?.classList.add('touch-destination');
    const root = document.getElementById('mapOverlayRoot'), destination = `${this.activeCamera === 'PROTER' ? 'Banda' : 'Zona'} ${this.esc(slot.banda)} · P${slot.posicion} · ${slot.altura}`;
    root.dataset.mode = 'move-confirm';
    this.overlayShell(root, 'Confirmar movimiento', `<div class="touch-move-summary"><span><small>PALLET</small><b>${this.esc(PalletModel.codigoVisualLegible(moving))}</b></span><i>→</i><span><small>DESTINO</small><b>${destination}</b></span></div>${occupant ? `<p class="map-warning">⚠ La posición contiene ${this.esc(PalletModel.codigoVisualLegible(occupant))}. Al confirmar quedará sin posición asignada.</p>` : '<p>La posición seleccionada está vacía.</p>'}<div class="overlay-actions"><button class="btn-secondary" id="touchMoveBack">Elegir otra</button><button class="btn-primary" id="touchMoveConfirm">Confirmar movimiento</button></div>`, 'move-confirm-overlay touch-action-overlay');
    document.getElementById('mapOverlayClose').onclick = () => { element?.classList.remove('touch-destination'); this.closeOverlay(); };
    document.getElementById('touchMoveBack').onclick = () => { element?.classList.remove('touch-destination'); this.closeOverlay(); };
    document.getElementById('touchMoveConfirm').onclick = () => { const origin=this.positionOf(moving);UndoService.guardarSnapshot(this.activeCamera, MapaModel.getPallets()); MapaModel.moverPallet(moving.id, this.activeCamera, slot.banda, slot.posicion, slot.altura);this.recordMovement('MOVER_PALLET',moving,origin,this.positionOf(moving),{displacedPalletId:occupant?.id||null}); this.cancelTouchMove(); this.closeOverlay(); this.refresh(); this.toast(`${PalletModel.codigoVisualLegible(moving)} movido localmente${navigator.onLine?'.':' · pendiente de sincronización.'}`); };
  },

  overlayMove(root) {
    const p = MapaModel.getPallets().find(x => x.id === this.selectedPalletId); if (!p) return;
    const bands = this.activeCamera === 'PROTER' ? Array.from({ length: 30 }, (_, i) => i) : ['01', '02', ...Array.from({ length: 18 }, (_, i) => i + 1)];
    const options = bands.map(b => `<option value="${b}" ${String(b) === String(p.banda) ? 'selected' : ''}>${b}</option>`).join('');
    this.overlayShell(root, `Mover ${this.esc(PalletModel.codigoVisualLegible(p))}`, `<p>Seleccioná una ubicación exacta o volvé al detalle para elegir el destino directamente en el mapa.</p><div class="move-grid"><label>Banda<select id="moveBand">${options}</select></label><label>Posición<select id="movePos"></select></label><label>Nivel<select id="moveLevel"><option ${p.altura === 'C1' ? 'selected' : ''}>C1</option><option ${p.altura === 'C2' ? 'selected' : ''}>C2</option></select></label></div><div class="overlay-actions"><button class="btn-secondary" id="moveDelete">Vaciar esta celda</button><button class="btn-primary" id="moveSave">Mover pallet</button></div>`, 'move-overlay touch-action-overlay');
    const band = document.getElementById('moveBand'), pos = document.getElementById('movePos');
    const fill = () => { const raw = band.value; const b = this.activeCamera === 'PROTER' ? Number(raw) : (raw === '01' || raw === '02' ? raw : Number(raw)); pos.innerHTML = Array.from({ length: MapaModel.maxPositions(this.activeCamera, b) }, (_, i) => `<option ${i + 1 === Number(p.posicion) ? 'selected' : ''}>${i + 1}</option>`).join(''); }; fill(); band.onchange = fill;
    document.getElementById('moveSave').onclick = () => { const b = this.activeCamera === 'PROTER' ? Number(band.value) : (band.value === '01' || band.value === '02' ? band.value : Number(band.value)),origin=this.positionOf(p); UndoService.guardarSnapshot(this.activeCamera, MapaModel.getPallets()); MapaModel.moverPallet(p.id, this.activeCamera, b, Number(pos.value), document.getElementById('moveLevel').value);this.recordMovement('MOVER_PALLET',p,origin,this.positionOf(p)); this.closeOverlay(); this.refresh(); };
    document.getElementById('moveDelete').onclick = () => {const origin=this.positionOf(p); UndoService.guardarSnapshot(this.activeCamera, MapaModel.getPallets()); MapaModel.quitarDePosicion(p.id);this.recordMovement('VACIAR_POSICION',p,origin,this.positionOf(p)); this.closeOverlay(); this.refresh(); };
  },

  dropPallet(id, slot) { if (!id) return;const pallet=MapaModel.getPallets().find(p=>p.id===id),origin=this.positionOf(pallet); UndoService.guardarSnapshot(this.activeCamera, MapaModel.getPallets()); MapaModel.moverPallet(id, this.activeCamera, slot.banda, slot.posicion, slot.altura);this.recordMovement('MOVER_PALLET',pallet,origin,this.positionOf(pallet)); this.refresh(); },
  emptyBand(banda) { const affected=MapaModel.getPallets().filter(p => p.ubicacion === this.activeCamera && p.banda === banda).map(p=>({p,origin:this.positionOf(p)})); if (!affected.length) return; UndoService.guardarSnapshot(this.activeCamera, MapaModel.getPallets()); const removed = MapaModel.vaciarBanda(this.activeCamera, banda);affected.forEach(x=>this.recordMovement('VACIAR_POSICION',x.p,x.origin,this.positionOf(x.p),{bulkBand:banda})); this.refresh(); this.toast(`${this.activeCamera === 'PROTER' ? 'Banda' : 'Zona'} ${banda}: se retiraron ${removed} pallet(s).`); },
  reconcileCargo() {
    const state = this.state(), positioned = new Set(MapaModel.getPallets().filter(p => p.banda !== null).map(p => p.id));
    ['embarque','postunel'].forEach(tab => { state.cargo[tab] = state.cargo[tab].filter(id => !positioned.has(id)); });
    positioned.forEach(id => delete state.originals[id]); this.saveState(state);
  },
  undo() {const before=MapaModel.clone(MapaModel.getPallets()); if (UndoService.deshacer(this.activeCamera, MapaModel.getPallets())) { this.reconcileCargo();this.recordPositionDifferences(before,'DESHACER'); this.refresh(); } },
  redo() {const before=MapaModel.clone(MapaModel.getPallets()); if (UndoService.rehacer(this.activeCamera, MapaModel.getPallets())) { this.reconcileCargo();this.recordPositionDifferences(before,'REHACER'); this.refresh(); } },

  overlayCargo(root) {
    const tab = this.tab(), pallets = MapaModel.palletsCarga(tab), cajas = pallets.reduce((s, p) => s + (Number(p.cajas) || 0), 0), arts = new Set(pallets.map(p => p.articulo)).size;
    const cells = pallets.length ? pallets.map(p => `<button class="load-pallet ${p._manual_pasillo ? 'manual' : ''}" data-id="${this.esc(p.id)}" title="Tocar para quitar"><strong>${this.esc(PalletModel.codigoVisual(p))}</strong><small>${this.esc(p.articulo)}</small><i style="--state:${COLORES_MAPA_ESTADO[p.estado] || '#64748B'}">${ABREVIATURAS_ESTADO_MAPA[p.estado] || '—'}</i></button>`).join('') : '<p class="empty-message">Todavía no hay pallets en la carga.</p>';
    this.overlayShell(root, `🚚 ${tab === 'embarque' ? 'Embarque · Proter' : 'Post Túnel'}`, `<div class="manual-load"><input id="manualLoadCode" placeholder="Ej: B47" autofocus><button id="manualLoadAdd">Agregar</button></div><small>Digitá letra + número para pallets de pasillo o de una banda.</small><div class="load-progress"><b>${pallets.length} de 30 pallets</b><span>${pallets.length >= 30 ? 'rampla completa' : pallets.length >= 20 ? `faltan ${30 - pallets.length} para 30` : 'en preparación'}</span></div><div class="load-grid">${cells}</div><div class="load-totals"><span><small>Pallets</small><b>${pallets.length}</b></span><span><small>Cajas</small><b>${cajas.toLocaleString('es-CL')}</b></span><span><small>Artículos</small><b>${arts}</b></span></div><button class="btn-primary wide" id="goToDock">Continuar al Andén de Carga<i class="wi wi-right"></i></button>`, 'cargo-overlay');
    root.querySelectorAll('.load-pallet').forEach(btn => btn.onclick = () => {const pallet=MapaModel.getPallets().find(p=>p.id===btn.dataset.id),origin=this.positionOf(pallet); const r = MapaModel.quitarDeCarga(tab, btn.dataset.id);if(r.ok)this.recordMovement('QUITAR_CARGA',pallet,origin,this.positionOf(pallet),{loadTab:tab}); this.refresh(); this.openOverlay('cargo'); if (r.aviso) this.toast(r.aviso); });
    const add = () => { const input = document.getElementById('manualLoadCode'), pallet = MapaModel.buscarPalletGlobalPorCodigo(input.value.trim()),origin=this.positionOf(pallet); if (pallet?.banda !== null && pallet?.banda !== undefined) UndoService.guardarSnapshot(pallet.ubicacion, MapaModel.getPallets()); const result = MapaModel.agregarCodigoACarga(tab, input.value.trim()); if (!result.ok) return this.toast(result.error, 'error');this.recordMovement('AGREGAR_CARGA',pallet,origin,this.positionOf(pallet),{loadTab:tab}); this.refresh(); this.openOverlay('cargo'); };
    document.getElementById('manualLoadAdd').onclick = add; document.getElementById('manualLoadCode').onkeydown = e => { if (e.key === 'Enter') add(); };
    document.getElementById('goToDock').onclick = () => { this.closeOverlay(); AndenController.activeTab = tab; AppController.navigate('anden_carga'); };
  },

  overlayExport(root) {
    root.innerHTML = '';
    document.getElementById('mapExportPopover')?.remove();
    const module = document.querySelector('.map-module'), trigger = document.getElementById('mapExportBtn'); if (!module || !trigger) return;
    const popover = document.createElement('aside'); popover.id = 'mapExportPopover'; popover.className = 'map-export-popover';
    const areas=this.activeCamera==='PROTER'?[['todo','Mapa completo'],['lado_a','Lado A · 0–14'],['lado_b','Lado B · 15–29']]:[['todo','Mapa completo'],['especiales','Zonas 01 / 02'],['bandas','Bandas 1–18']];
    popover.innerHTML = `<header><div><small>SALIDA DEL MAPA</small><h3>Exportar mapa</h3></div><button id="mapExportClose" aria-label="Cerrar">×</button></header><p>Genera un documento claro e independiente del visor operativo, con filtros, FIFO, leyenda y códigos.</p><div class="export-color-pills" role="group" aria-label="Presentación"><button class="active" data-color="color"><i class="wi wi-palette"></i>Color</button><button data-color="bn"><i class="wi wi-contrast"></i>Blanco y negro</button></div><div class="export-color-pills" role="group" aria-label="Vista a exportar"><button class="${this.viewerMode==='2D'?'active':''}" data-print-view="2D">2D</button><button class="${this.viewerMode==='2.5D'?'active':''}" data-print-view="2.5D">2,5D</button></div><label class="export-area-label">Área a incluir<select id="exportArea">${areas.map(([v,n])=>`<option value="${v}">${n}</option>`).join('')}</select></label><small class="export-hint">La presentación elegida se aplica también al Excel. PDF e impresión siempre usan tema claro.</small><div class="export-menu-actions"><button id="exportExcel"><span class="wi wi-sheet"></span><b>Guardar como Excel</b><small>Mapa editable 2D</small></button><button id="exportPdf"><span class="wi wi-pdf"></span><b>Generar PDF</b><small>Vista previa A3</small></button><button id="exportPrint"><span class="wi wi-print"></span><b>Imprimir</b><small>Vista para impresora</small></button></div>`;
    module.appendChild(popover);
    const mr=module.getBoundingClientRect(),br=trigger.getBoundingClientRect(),width=Math.min(310,mr.width-20);
    popover.style.width=`${width}px`;popover.style.left=`${Math.max(10,Math.min(br.left-mr.left,mr.width-width-10))}px`;popover.style.top=`${br.bottom-mr.top+7}px`;
    let color='color',printView=this.viewerMode;popover.querySelectorAll('[data-color]').forEach(button=>button.onclick=()=>{color=button.dataset.color;popover.querySelectorAll('[data-color]').forEach(x=>x.classList.toggle('active',x===button));});popover.querySelectorAll('[data-print-view]').forEach(button=>button.onclick=()=>{printView=button.dataset.printView;popover.querySelectorAll('[data-print-view]').forEach(x=>x.classList.toggle('active',x===button));});
    document.getElementById('mapExportClose').onclick=()=>this.closeOverlay();
    document.getElementById('exportExcel').onclick=()=>{this.closeOverlay();this.exportExcel(color);};
    document.getElementById('exportPdf').onclick=()=>this.printMap(color,'pdf',document.getElementById('exportArea').value,printView);
    document.getElementById('exportPrint').onclick=()=>this.printMap(color,'print',document.getElementById('exportArea').value,printView);
  },

  exportExcel(colorMode='color') {
    const doc=this.mapExportDocument(colorMode),date=new Date(),stamp=`${String(date.getDate()).padStart(2,'0')}-${String(date.getMonth()+1).padStart(2,'0')}-${date.getFullYear()}`;
    ExportService.descargarXlsxDocumento(`Mapa_${this.activeCamera === 'PROTER'?'PROTER':'POSTUNEL'}_${colorMode==='bn'?'BN_':''}${stamp}.xlsx`,doc);
    this.toast(`Excel ${colorMode==='bn'?'en blanco y negro':'a color'} generado con disposición, filtros, búsqueda, FIFO, leyenda y códigos.`);
  },

  mapExportDocument(colorMode='color') {
    const camera=this.activeCamera,bn=colorMode==='bn',all=MapaModel.getPallets(),data=all.filter(p=>p.ubicacion===camera&&p.banda!==null),state=this.state(),filter=state.filters[camera],searches=new Set((state.searches[camera]||[]).map(x=>String(x).toUpperCase())),fifo=state.fifo[camera]?MapaModel.fifoIds(camera):new Set();
    const slot=(b,p,a)=>data.find(x=>String(x.banda)===String(b)&&Number(x.posicion)===p&&x.altura===a);
    const statusStyles={LIBERADO:'mapGreen',RECHAZO:'mapRed','VERIFICACIÓN':'mapAmber',REPROCESO:'mapPurple','SIN DM':'mapGray',PEDIDO:'mapPink','SIN INFORMACIÓN':'mapGray',BLOQUEADOS:'mapRed','LOTES INCOMPLETOS':'mapOrange','AUTORIZADOS A ENVIAR':'mapCyan',PROHIBICIONES:'mapPurple'};
    const postStyles=['mapGreen','mapBlue','mapAmber','mapPurple','mapPink','mapOrange','mapCyan'],patterns=['mapBnSolid','mapBnDotted','mapBnDashed','mapBnDouble'],bnStatusStyles={LIBERADO:'mapBnSolid',RECHAZO:'mapBnDotted','VERIFICACIÓN':'mapBnDashed',REPROCESO:'mapBnDouble','SIN DM':'mapBnSolid',PEDIDO:'mapBnDotted','SIN INFORMACIÓN':'mapBnDashed',BLOQUEADOS:'mapBnDouble','LOTES INCOMPLETOS':'mapBnSolid','AUTORIZADOS A ENVIAR':'mapBnDotted',PROHIBICIONES:'mapBnDashed'};
    const hash=value=>Math.abs(String(value??'').split('').reduce((n,c)=>n+c.charCodeAt(0),0));
    const baseStyle=p=>camera==='PROTER'?(statusStyles[p.estado]||'mapGray'):postStyles[hash(p.articulo)%postStyles.length];
    const styleFor=p=>{
      if(!MapaModel.coincideFiltro(p,camera,filter))return bn?'mapBnMuted':'mapMuted';
      const searched=this.isSearchedBy(p,searches);
      if(searched)return bn?'mapBnSearched':(fifo.has(p.id)?'mapSearchedFifo':'mapSearched');
      if(bn){if(fifo.has(p.id))return'mapBnFifo';if(p.repetido||p.no_existe)return'mapBnDouble';return camera==='PROTER'?(bnStatusStyles[p.estado]||'mapBnSolid'):patterns[hash(p.articulo)%patterns.length];}
      const base=p.repetido||p.no_existe?'mapWhite':baseStyle(p);return fifo.has(p.id)?`${base}Fifo`:base;
    };
    const mapCell=p=>{if(!p)return{v:'',s:'mapEmpty'};const abbr=p.no_existe?'N/E':p.repetido?'REP':camera==='PROTER'?(ABREVIATURAS_ESTADO_MAPA[p.estado]||''):p.articulo;return{v:`${PalletModel.codigoVisual(p)}\n${abbr}`,s:styleFor(p)};};
    const codes=new Map();data.forEach(p=>{const letter=(String(PalletModel.codigoVisual(p)).match(/^[A-ZÑ]+/i)||[])[0];if(letter&&!codes.has(letter))codes.set(letter,p.articulo);});
    const mapColumns=camera==='PROTER'?30:18,codeColumn=camera==='PROTER'?32:21,totalColumns=codeColumn+Math.max(1,Math.ceil(codes.size/26))*2,filas=[],combinar=[],altos={1:28,2:20},anchos=Array.from({length:totalColumns},(_,i)=>i<mapColumns?9:(i===mapColumns||i===mapColumns+1?3:(i-codeColumn)%2===0?7:12));
    const ensure=row=>{while(filas.length<=row)filas.push(Array.from({length:totalColumns},()=>({v:'',s:'normal'})));return filas[row];};
    const put=(row,col,value,style='normal')=>{ensure(row)[col]={v:value,s:style};};
    const merge=(row,start,end,value,style='normal')=>{put(row,start,value,style);combinar.push(`${ExportService.columnaExcel(start)}${row+1}:${ExportService.columnaExcel(end)}${row+1}`);};
    const bandHeader=(row,col,b)=>{merge(row,col,col+1,`${camera==='POST TUNEL'&&(String(b)==='01'||String(b)==='02')?'ZONA':'BANDA'} ${b}`,'mapBand');put(row+1,col,'C1','mapBand');put(row+1,col+1,'C2','mapBand');};
    const bandCells=(startRow,col,b,max,reverse=false)=>{for(let p=1;p<=max;p++){const row=reverse?startRow+(max-p):startRow+(p-1);put(row,col,mapCell(slot(b,p,'C1')).v,mapCell(slot(b,p,'C1')).s);put(row,col+1,mapCell(slot(b,p,'C2')).v,mapCell(slot(b,p,'C2')).s);altos[row+1]=26;}};
    merge(0,0,mapColumns-1,`MAPA FRIGORÍFICO — ${camera==='PROTER'?'CÁMARA PROTER':'CÁMARA POST TÚNEL'}`,'mapTitle');merge(1,0,mapColumns-1,this.mapExportMeta(),'mapMeta');
    if(camera==='PROTER'){
      const top=Array.from({length:15},(_,i)=>i),bottom=Array.from({length:15},(_,i)=>29-i);
      put(2,0,'LADO A (bandas 0 a 14)','origin');
      top.forEach((b,i)=>{bandHeader(3,i*2,b);bandCells(5,i*2,b,MapaModel.maxPositions('PROTER',b));});
      merge(15,0,29,'🚜 PASILLO — TRÁNSITO YALE','mapAisle');altos[16]=32;
      bottom.forEach((b,i)=>{const max=MapaModel.maxPositions('PROTER',b);bandCells(17,i*2,b,max);merge(26,i*2,i*2+1,`BANDA ${b}`,'mapBand');put(27,i*2,'C1','mapBand');put(27,i*2+1,'C2','mapBand');});
    }else{
      put(2,0,'01 / 02 (bajo evaporadores)','origin');
      ['01','02'].forEach((b,i)=>{merge(3,i*2,i*2+1,`BANDA ${b}`,'mapBand');bandCells(4,i*2,b,17);});
      put(22,0,'BANDAS 1 A 18 (espejo: 1↔18, 9↔10)','origin');
      for(let n=1;n<=9;n++){const col=(n-1)*2,lower=19-n;merge(23,col,col+1,`BANDA ${n}`,'mapBand');bandCells(24,col,n,8);merge(33,col,col+1,`BANDA ${lower}`,'mapBand');bandCells(34,col,lower,8);}
    }
    const codeOrder=letter=>String(letter).toUpperCase().replace(/[^A-Z]/g,'').split('').reduce((n,c)=>n*26+c.charCodeAt(0)-64,0);
    merge(0,codeColumn,totalColumns-1,'REFERENCIAS DEL MAPA','header');[...codes.entries()].sort(([a],[b])=>codeOrder(a)-codeOrder(b)).forEach(([letter,code],i)=>{const block=Math.floor(i/26),row=2+(i%26),col=codeColumn+block*2;if(i%26===0){put(1,col,'LETRA','mapBand');put(1,col+1,'CÓDIGO','mapBand');}put(row,col,letter,'mapBand');put(row,col+1,code,'meta');});
    const legendRow=camera==='PROTER'?30:45,selected=filter===null?(camera==='PROTER'?Object.keys(COLORES_MAPA_ESTADO):[...new Set(data.map(p=>p.articulo))]):filter;
    put(legendRow,0,camera==='PROTER'?'LEYENDA DE ESTADOS':'LEYENDA DE ARTÍCULOS','header');
    const legendValues=selected.filter(x=>x!=='REPETIDO'&&x!=='NO EXISTE').map(value=>({value,label:value,key:camera==='PROTER'?(ABREVIATURAS_ESTADO_MAPA[value]||value):value}));
    if(camera==='POST TUNEL'&&(filter===null||filter.includes('REPETIDO')))legendValues.push({value:'REPETIDO',label:'REPETIDO (mismo lote en más de una banda)',key:'REP'});
    if(camera==='POST TUNEL'&&(filter===null||filter.includes('NO EXISTE')))legendValues.push({value:'NO EXISTE',label:'NO EXISTE (código sin registro válido)',key:'N/E'});
    legendValues.forEach((item,i)=>{
      const special=item.value==='REPETIDO'||item.value==='NO EXISTE',sample=camera==='PROTER'?{estado:item.value,articulo:'',id:'',repetido:special,no_existe:item.value==='NO EXISTE'}:{estado:'',articulo:item.value,id:'',repetido:special,no_existe:item.value==='NO EXISTE'};
      const rowsPerBlock=camera==='PROTER'?6:8,groupWidth=camera==='PROTER'?5:4,block=Math.floor(i/rowsPerBlock),legendLine=legendRow+1+(i%rowsPerBlock),legendCol=block*groupWidth;
      put(legendLine,legendCol,item.key,bn?(special?'mapBnDouble':(camera==='PROTER'?(bnStatusStyles[item.value]||'mapBnSolid'):patterns[hash(item.value)%patterns.length])):(special?'mapWhite':baseStyle(sample)));
      merge(legendLine,legendCol+1,legendCol+groupWidth-1,item.label,'meta');
    });
    const noteRow=legendRow+2+(camera==='PROTER'?6:8);
    if(filter!==null)put(noteRow,0,`Filtro activo: ${filter.join(', ')||'ninguno'}`,'meta');
    if(searches.size){put(noteRow+(filter!==null?1:0),0,'BUS','mapSearched');merge(noteRow+(filter!==null?1:0),1,Math.min(mapColumns-1,8),`Búsqueda resaltada: ${searches.size} lote(s)`,'meta');}
    return{nombreHoja:camera==='PROTER'?'Mapa PROTER':'Mapa Postúnel',filas,combinar,anchos,altos,horizontal:true,grilla:false,ajustarAlto:1};
  },

  mapExportMeta(){const state=this.state(),filter=state.filters[this.activeCamera],searches=state.searches[this.activeCamera]||[];return[new Date().toLocaleString('es-CL'),filter===null?'Filtros: todos':`Filtros: ${filter.join(', ')||'ninguno'}`,searches.length?`Búsqueda: ${searches.length} lote(s)`:'Sin búsqueda activa',state.fifo[this.activeCamera]?'FIFO activo':'FIFO inactivo'].join(' · ');},
  buildMapPrintDocument(colorMode='color', area='todo', viewMode='2D') {
    const camera=this.activeCamera,data=MapaModel.getPallets().filter(p=>p.ubicacion===camera&&p.banda!==null),state=this.state(),filter=state.filters[camera],searches=new Set((state.searches[camera]||[]).map(x=>String(x).toUpperCase())),fifo=state.fifo[camera]?MapaModel.fifoIds(camera):new Set(),bn=colorMode==='bn',isProter=camera==='PROTER',slot=(b,pos,level)=>data.find(p=>String(p.banda)===String(b)&&Number(p.posicion)===pos&&p.altura===level),included=p=>MapaModel.coincideFiltro(p,camera,filter),codeMap=new Map();
    data.forEach(p=>{const letter=(String(PalletModel.codigoVisual(p)).match(/^[A-ZÑ]+/i)||[])[0];if(letter&&!codeMap.has(letter))codeMap.set(letter,p.articulo);});
    // El padre recicla cuatro bordes entre once estados. En papel B/N eso genera
    // ambigüedad, por lo que cada categoría recibe una firma compuesta y estable.
    const bwBorders=['solid','double','dashed','dotted'],bwWidths=['1.5px','2.2px','3px'],bwHatches=[
      'none',
      'repeating-linear-gradient(135deg,transparent 0 5px,rgba(17,24,39,.18) 5px 6px)',
      'repeating-linear-gradient(45deg,transparent 0 5px,rgba(17,24,39,.18) 5px 6px)',
      'repeating-linear-gradient(0deg,transparent 0 5px,rgba(17,24,39,.16) 5px 6px)',
      'repeating-linear-gradient(90deg,transparent 0 5px,rgba(17,24,39,.17) 5px 6px)',
      'repeating-linear-gradient(45deg,transparent 0 6px,rgba(17,24,39,.15) 6px 7px),repeating-linear-gradient(135deg,transparent 0 6px,rgba(17,24,39,.15) 6px 7px)',
      'repeating-linear-gradient(0deg,transparent 0 6px,rgba(17,24,39,.16) 6px 7px),repeating-linear-gradient(90deg,transparent 0 6px,rgba(17,24,39,.16) 6px 7px)'
    ];
    const stateOrder=Object.keys(COLORES_MAPA_ESTADO),articleOrder=[...new Set(data.map(p=>p.articulo))].sort((a,b)=>String(a).localeCompare(String(b),'es',{numeric:true}));
    const marker=(value,special='')=>{
      if(special==='REPETIDO')return{border:'double',width:'3.5px',hatch:'repeating-linear-gradient(90deg,transparent 0 4px,rgba(17,24,39,.22) 4px 5px)'};
      if(special==='NO EXISTE')return{border:'dashed',width:'3px',hatch:'repeating-linear-gradient(45deg,transparent 0 4px,rgba(17,24,39,.22) 4px 5px),repeating-linear-gradient(135deg,transparent 0 4px,rgba(17,24,39,.22) 4px 5px)'};
      if(special==='SEARCH')return{border:'double',width:'3px',hatch:'none'};
      const order=isProter?stateOrder:articleOrder,index=Math.max(0,order.indexOf(value)),border=bwBorders[index%bwBorders.length],hatch=bwHatches[Math.floor(index/bwBorders.length)%bwHatches.length],width=bwWidths[Math.floor(index/(bwBorders.length*bwHatches.length))%bwWidths.length];return{border,width,hatch};
    };
    const readable=color=>{const value=String(color||'').replace('#','');if(!/^[0-9a-f]{6}$/i.test(value))return'#111827';const r=parseInt(value.slice(0,2),16),g=parseInt(value.slice(2,4),16),b=parseInt(value.slice(4,6),16);return(.299*r+.587*g+.114*b)<132?'#fff':'#111827';};
    const cell=(p)=>{if(!p)return '<div class="print-slot empty"></div>';const muted=!included(p),searched=this.isSearchedBy(p,searches),special=p.no_existe?'NO EXISTE':p.repetido?'REPETIDO':'',abbr=special==='NO EXISTE'?'N/E':special==='REPETIDO'?'REP':isProter?(ABREVIATURAS_ESTADO_MAPA[p.estado]||''):p.articulo,baseColor=isProter?(COLORES_MAPA_ESTADO[p.estado]||'#64748b'):PalletModel.colorParaArticuloPostunel(p.articulo,data),color=special==='NO EXISTE'?'#60A5FA':special==='REPETIDO'?'#FFFFFF':baseColor,mark=marker(isProter?p.estado:p.articulo,special);return `<div class="print-slot ${muted?'muted':''} ${searched?'searched':''} ${fifo.has(p.id)?'fifo':''} ${viewMode==='2.5D'?'iso':''}" style="--fill:${bn||muted?'#fff':color};--ink:${bn||muted?'#111827':readable(color)};--border:${bn?mark.border:'solid'};--border-width:${bn?mark.width:'.65px'};--border-color:${bn?'#111827':'rgba(71,85,105,.26)'};--hatch:${bn?mark.hatch:'none'}"><b>${this.esc(PalletModel.codigoVisual(p))}</b><small>${this.esc(abbr)}</small></div>`;};
    const band=(b,lower=false)=>{const max=isProter?posicionesPorBandaProter(b):posicionesPorZonaPostunel(b),rows=[];for(let pos=1;pos<=max;pos++)rows.push(`<div class="print-row">${cell(slot(b,pos,'C1'))}${cell(slot(b,pos,'C2'))}</div>`);const heading=`<header><b>${isProter?'BANDA':(String(b)==='01'||String(b)==='02'?'ZONA':'BANDA')} ${this.esc(b)}</b><span>C1&nbsp;&nbsp;&nbsp;&nbsp;C2</span></header>`;return `<section class="print-rack ${lower?'lower':''} ${viewMode==='2.5D'?'rack-25d':''}">${lower?`<div class="print-cells">${rows.join('')}</div>${heading}`:`${heading}<div class="print-cells">${rows.join('')}</div>`}</section>`;};
    let mapHtml='',legend=[];
    if(isProter){const top=Array.from({length:15},(_,i)=>band(i)),bottom=Array.from({length:15},(_,i)=>band(29-i,true));mapHtml=`${area!=='lado_b'?`<div class="print-band-line">${top.join('')}</div>`:''}${area==='todo'?'<div class="print-aisle"><i></i><b>✦ PASILLO — TRÁNSITO YALE</b><i></i></div>':''}${area!=='lado_a'?`<div class="print-band-line">${bottom.join('')}</div>`:''}`;const selected=filter===null?Object.keys(COLORES_MAPA_ESTADO):filter;legend=selected.filter(x=>COLORES_MAPA_ESTADO[x]).map(x=>({key:ABREVIATURAS_ESTADO_MAPA[x]||x,label:x,value:x,color:COLORES_MAPA_ESTADO[x]}));if(filter===null||filter.includes('REPETIDO'))legend.push({key:'REP',label:'REPETIDO',value:'REPETIDO',color:'#fff',special:'REPETIDO'});if(filter===null||filter.includes('NO EXISTE'))legend.push({key:'N/E',label:'NO EXISTE',value:'NO EXISTE',color:'#60A5FA',special:'NO EXISTE'});
    }else{const specials=['01','02'].map(b=>band(b)),pairs=[];for(let n=1;n<=9;n++)pairs.push(`<div class="print-pair">${band(n)}${band(19-n,true)}</div>`);mapHtml=`${area!=='bandas'?`<div class="print-specials">${specials.join('')}</div>`:''}${area==='todo'?'<div class="print-separator"></div>':''}${area!=='especiales'?`<div class="print-post-bands">${pairs.join('')}</div>`:''}`;const selected=filter===null?articleOrder:filter;legend=selected.filter(x=>x!=='REPETIDO'&&x!=='NO EXISTE').map(x=>({key:x,label:`Artículo ${x}`,value:x,color:PalletModel.colorParaArticuloPostunel(x,data)}));if(filter===null||filter.includes('REPETIDO'))legend.push({key:'REP',label:'REPETIDO',value:'REPETIDO',color:'#fff',special:'REPETIDO'});if(filter===null||filter.includes('NO EXISTE'))legend.push({key:'N/E',label:'NO EXISTE',value:'NO EXISTE',color:'#60A5FA',special:'NO EXISTE'});}
    if(searches.size)legend.push({key:'BUS',label:`Búsqueda activa (${searches.size} lote${searches.size===1?'':'s'})`,value:'BUS',color:'#38bdf8',special:'SEARCH'});
    const legendHtml=legend.map(x=>{const mark=marker(x.value,x.special);return `<span><i style="--fill:${bn?'#fff':x.color};--ink:${bn?'#111827':readable(x.color)};--border:${bn?mark.border:'solid'};--border-width:${bn?mark.width:'0'};--border-color:${bn?'#111827':'transparent'};--hatch:${bn?mark.hatch:'none'}">${this.esc(x.key)}</i>${this.esc(x.label)}</span>`;}).join('');const codeOrder=letter=>String(letter).toUpperCase().replace(/[^A-Z]/g,'').split('').reduce((n,c)=>n*26+c.charCodeAt(0)-64,0),codeEntries=[...codeMap.entries()].sort(([a],[b])=>codeOrder(a)-codeOrder(b)),codeColumns=Math.max(1,Math.ceil(codeEntries.length/10)),codePanelWidth=Math.max(190,codeColumns*122+18),codes=codeEntries.map(([letter,article])=>`<div><b>${this.esc(letter)}</b><span>${this.esc(article)}</span></div>`).join('');const filterText=filter===null?'Todos':filter.length?filter.join(', '):'Ninguno',searchText=searches.size?`${searches.size} lote(s) resaltado(s)`:'Sin búsqueda activa';
    return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Mapa ${this.cameraLabel()}</title><style>@page{size:A3 landscape;margin:8mm 4mm}*{box-sizing:border-box}body{margin:0;background:#fff;color:#142030;font-family:"Segoe UI",Arial,sans-serif}.print-head{display:flex;justify-content:space-between;align-items:end;border-bottom:2px solid #2563ab;padding:0 0 7px;margin-bottom:9px}.print-head h1{margin:0;color:#2563ab;font-size:18px}.print-head p,.meta{margin:3px 0 0;color:#5f6f82;font-size:8px}.meta{text-align:right}.print-layout{display:block}.print-map{width:100%;border:1px solid #9bb1c9;border-radius:7px;padding:7px}.print-band-line{display:flex;gap:5px}.print-rack{width:calc((100% - 70px)/15);min-width:0;padding:4px;border:1px solid #9eabb9;border-radius:5px;background:#edf2f5}.print-rack header{display:flex;flex-direction:column;gap:2px;text-align:center;font-size:7px}.print-rack header span{font-size:6px;color:#5d6d7e}.print-cells{display:flex;flex-direction:column;gap:2px;margin-top:3px}.lower .print-cells{margin-top:0;margin-bottom:3px}.print-row{display:grid;grid-template-columns:1fr 1fr;gap:2px}.print-slot{height:22px;border:var(--border-width) var(--border) var(--border-color);border-radius:3px;background-color:var(--fill);background-image:var(--hatch);display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:7px;line-height:1;color:var(--ink)}.color .print-slot:not(.empty):not(.muted){background-image:linear-gradient(145deg,color-mix(in srgb,var(--fill) 70%,#fff),var(--fill))}.print-slot.searched{box-shadow:inset 0 0 0 2px #0e7490,0 0 0 1px #38bdf8}.bn .print-slot.searched{box-shadow:inset 0 0 0 2px #111,0 0 0 1px #111}.print-slot b{font-size:8px}.print-slot small{font-size:5.5px}.print-slot.empty{background:#f3f4f6;border:1px solid #d8dce1}.print-slot.muted{background:#e5e7eb!important;color:#9ca3af;border:1px solid #d1d5db}.print-slot.fifo{outline:2px solid #d99000;outline-offset:-2px}.bn .print-slot.fifo{outline-color:#111}.print-aisle{height:35px;margin:7px 0;display:flex;align-items:center;gap:9px;padding:0 10px;border:1px solid #be8c13;border-radius:4px;background:#293440}.print-aisle i{flex:1;border-top:2px dashed #f4b718}.print-aisle b{padding:5px 13px;border:1px solid #c89417;border-radius:12px;background:#fff;color:#374151;font-size:7px;white-space:nowrap}.bn .print-aisle{border-color:#555;background:#eee}.bn .print-aisle i{border-color:#111}.print-specials,.print-post-bands{display:flex;gap:7px}.print-specials .print-rack{width:73px}.print-post-bands{align-items:flex-start}.print-pair{display:flex;flex-direction:column;gap:7px;width:calc((100% - 56px)/9)}.print-pair .print-rack{width:100%}.print-separator{height:8px}.rack-25d{position:relative;border-color:#60758c;box-shadow:3px 3px 0 #c8d1d9,6px 6px 0 #e6edf1;background:linear-gradient(135deg,#f9fbfc,#dce5eb)}.rack-25d .print-slot{box-shadow:inset 2px 0 rgba(255,255,255,.55),1px 2px 0 rgba(38,57,73,.35)}.legend{display:flex;flex-wrap:wrap;gap:6px 12px;margin-top:8px;padding:7px;border-top:1px solid #cbd5e1;font-size:7px}.legend span{display:flex;align-items:center;gap:4px}.legend i{width:24px;height:16px;border:var(--border-width) var(--border) var(--border-color);border-radius:3px;background-color:var(--fill);background-image:var(--hatch);color:var(--ink);display:grid;place-items:center;font-style:normal;font-size:5px;font-weight:700}.color .legend i{border:0;background-image:linear-gradient(145deg,color-mix(in srgb,var(--fill) 70%,#fff),var(--fill))}.codes-panel{display:inline-block;width:min(100%,var(--codes-width));break-inside:avoid;margin-top:7px;padding:8px 10px;border:1px solid #cbd5e1;border-radius:6px;background:#f8fafc;vertical-align:top}.codes-panel header{display:flex;align-items:baseline;gap:8px;margin-bottom:6px}.codes-panel h2{margin:0;font-size:10px}.codes-panel p{margin:0;font-size:7.5px;color:#64748b}.codes-grid{display:grid;grid-template-columns:repeat(var(--code-columns),minmax(0,1fr));grid-template-rows:repeat(10,auto);grid-auto-flow:column;gap:0 12px}.codes-grid div{display:grid;grid-template-columns:26px minmax(66px,1fr);align-items:center;gap:5px;padding:3px 0;border-bottom:1px solid #d9e1e9;font-size:8.5px;line-height:1.15}.codes-grid b{color:#2563ab;font-size:9px}.codes-grid span{font-size:8.5px;font-weight:600;color:#334155}.filter-note{margin-top:4px;font-size:7px;color:#64748b}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}</style></head><body class="${bn?'bn':'color'}"><header class="print-head"><div><h1>MAPA FRIGORÍFICO — ${this.cameraLabel()}</h1><p>Disposición física del almacén · Vista ${viewMode}</p></div><div class="meta">${this.esc(new Date().toLocaleString('es-CL'))}<br>Filtro: ${this.esc(filterText)} · Búsqueda: ${this.esc(searchText)} · ${fifo.size?'FIFO activo':'FIFO inactivo'}</div></header><main class="print-layout"><section class="print-map">${mapHtml}<section class="legend">${legendHtml}</section>${filter!==null?`<p class="filter-note">Filtro activo: ${this.esc(filterText)}</p>`:''}${searches.size?`<p class="filter-note">Búsqueda resaltada: ${this.esc(searchText)}</p>`:''}<section class="codes-panel" style="--code-columns:${codeColumns};--codes-width:${codePanelWidth}px"><header><h2>IDENTIFICACIÓN VISUAL DEL PALLET</h2><p>LETRA · ARTÍCULO</p></header><div class="codes-grid">${codes}</div></section></section></main></body></html>`;
  },

  printMap(colorMode, purpose='pdf', area='todo', viewMode=this.viewerMode) {
    const win=window.open('', '_blank');if(!win)return this.toast('El navegador bloqueó la ventana de impresión.','error');this.closeOverlay();win.opener=null;const lifecycle=`<script>window.addEventListener('afterprint',()=>setTimeout(()=>window.close(),100));window.addEventListener('load',()=>setTimeout(()=>window.print(),250));<\/script>`;const documentHtml=this.buildMapPrintDocument(colorMode,area,viewMode).replace('</body>',`${lifecycle}</body>`);win.document.open();win.document.write(documentHtml);win.document.close();this.toast(purpose==='pdf'?'Vista previa PDF abierta: elegí “Guardar como PDF”.':'Vista de impresión abierta.');
  },

  bindKeyboard() {
    if (this._keyHandler) document.removeEventListener('keydown', this._keyHandler);
    this._keyHandler = e => {
      const detailOpen = document.getElementById('mapOverlayRoot')?.dataset.mode === 'detail';
      const detailShortcut = detailOpen && (['p', 'delete', 'backspace', 'escape', ' '].includes(e.key.toLowerCase()));
      if (!document.querySelector('.map-module') || e.target.matches('input,textarea,select') || (e.target.matches('button') && !e.target.classList.contains('map-slot') && !detailShortcut)) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); this.undo(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); this.redo(); return; }
      if (e.key === 'Escape' && this.pendingMovePalletId) { e.preventDefault(); this.cancelTouchMove(); this.closeOverlay(); return; }
      const selected = document.querySelector('.map-view-layer:not([hidden]) .map-slot.selected'); if (!selected) return;
      const keys = { ArrowLeft: [-1, 0], a: [-1, 0], A: [-1, 0], ArrowRight: [1, 0], d: [1, 0], D: [1, 0], ArrowUp: [0, -1], w: [0, -1], W: [0, -1], ArrowDown: [0, 1], s: [0, 1], S: [0, 1] };
      if (e.key === 'Escape') { e.preventDefault(); const overlay = document.getElementById('mapOverlayRoot'); if (overlay?.dataset.mode === 'detail') this.closeOverlay(); else { selected.classList.remove('selected'); this.selectedPalletId = null; this.selectedSlot = null; } return; }
      if (e.key.toLowerCase() === 'p') { e.preventDefault(); const id = selected.dataset.palletId; if (id) { this.selectedPalletId = id; this.toggleSelectedLoad(); } return; }
      if (e.key === 'Enter') { e.preventDefault(); if (!selected.dataset.palletId) return; const overlay = document.getElementById('mapOverlayRoot'); if (overlay?.dataset.mode === 'detail' && this.selectedPalletId === selected.dataset.palletId) this.closeOverlay(); else selected.click(); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); const id = selected.dataset.palletId; if (!id) return; this.removePalletFromPosition(id, this.slotFromCell(selected), true); return; }
      if (e.key === ' ') {
        e.preventDefault();
        const slot = this.slotFromCell(selected), p = MapaModel.getPallets().find(x => x.id === selected.dataset.palletId);
        if (detailOpen) this.closeOverlay();
        requestAnimationFrame(() => this.beginCellEdit(p || null, slot, selected));
        return;
      }
      if (!keys[e.key]) return; e.preventDefault();
      const cells = [...document.querySelectorAll('.map-slot')], r = selected.getBoundingClientRect(), [dx, dy] = keys[e.key];
      const candidates = cells.filter(c => c !== selected).map(c => ({ c, r: c.getBoundingClientRect() })).filter(x => dx ? (dx > 0 ? x.r.left > r.left + 3 : x.r.left < r.left - 3) : (dy > 0 ? x.r.top > r.top + 3 : x.r.top < r.top - 3));
      candidates.sort((a, b) => { const da = Math.abs((a.r.left - r.left) * (dx ? 1 : 3)) + Math.abs((a.r.top - r.top) * (dy ? 1 : 3)); const db = Math.abs((b.r.left - r.left) * (dx ? 1 : 3)) + Math.abs((b.r.top - r.top) * (dy ? 1 : 3)); return da - db; });
      if (candidates[0]) { selected.classList.remove('selected'); candidates[0].c.classList.add('selected'); candidates[0].c.focus({ preventScroll: true }); candidates[0].c.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
    };
    document.addEventListener('keydown', this._keyHandler);
  },

  slotFromCell(cell) {
    const raw = cell.dataset.banda; return { banda: this.activeCamera === 'POST TUNEL' && (raw === '01' || raw === '02') ? raw : Number(raw), posicion: Number(cell.dataset.posicion), altura: cell.dataset.altura };
  },

  restoreKeyboardCell(slot) {
    requestAnimationFrame(() => { const cell = this.renderer?.cells.get(this.renderer.key(slot.banda, slot.posicion, slot.altura)); if (!cell) return; document.querySelectorAll('.map-slot.selected').forEach(x => x.classList.remove('selected')); cell.classList.add('selected'); cell.focus({ preventScroll: true }); });
  },

  toast(message, type = 'ok') { return NotificationService.show(message, { type }); },

  initCodigo(container) {
    container.innerHTML = `<section class="map-submodule code-module">${DashboardController.operationalHeader({ eyebrow:'MAPA · CODIFICACIÓN VISUAL', title:'Agregar Código', status:'Administración de letras visuales por artículo' })}<div class="code-summary" aria-label="Resumen de códigos"><article><small>ARTÍCULOS</small><b id="codeTotal">0</b></article><article class="assigned"><small>ASIGNADOS</small><b id="codeAssigned">0</b></article><article class="pending"><small>PENDIENTES</small><b id="codePending">0</b></article></div><div class="code-toolbar"><label><i class="wi wi-search"></i><input id="codeSearch" placeholder="Buscar por letra o artículo" autocomplete="off"></label><small id="codeResultCount"></small></div><div id="codeTable"></div></section>`; DashboardController.startOperationalClock();
    document.getElementById('codeSearch').oninput = e => this.renderCodigo(e.target.value); this.renderCodigo('');
  },

  renderCodigo(filter = '') {
    const root = document.getElementById('codeTable'); if (!root) return;
    const pallets = MapaModel.getPallets().filter(p => !p.pendiente_verificacion && String(p.articulo || '').trim()), counts = {}, boxes = {};
    pallets.forEach(p => { counts[p.articulo] = (counts[p.articulo] || 0) + 1; boxes[p.articulo] = (boxes[p.articulo] || 0) + (Number(p.cajas) || 0); });
    const all = Object.keys(counts), noLetter = all.filter(a => !LETRAS_POR_ARTICULO[a]).sort(), withLetter = all.filter(a => LETRAS_POR_ARTICULO[a]).sort((a, b) => LETRAS_POR_ARTICULO[a].length - LETRAS_POR_ARTICULO[b].length || LETRAS_POR_ARTICULO[a].localeCompare(LETRAS_POR_ARTICULO[b], 'es'));
    const q = String(filter || '').trim().toUpperCase(), rows = noLetter.concat(withLetter).filter(a => !q || a.toUpperCase().includes(q) || String(LETRAS_POR_ARTICULO[a] || '').includes(q));
    const history = this.state().letterHistory.slice(0, 8);
    const setText=(id,value)=>{const node=document.getElementById(id);if(node)node.textContent=value;};setText('codeTotal',all.length);setText('codeAssigned',withLetter.length);setText('codePending',noLetter.length);setText('codeResultCount',`${rows.length} de ${all.length} artículos`);
    root.innerHTML = `<div class="code-card-list">${rows.map(a => this.codeCard(a, counts[a], boxes[a])).join('') || '<div class="ops-empty">Ningún código coincide con la búsqueda.</div>'}</div>${history.length ? `<section class="letter-history"><h3>HISTORIAL DE CAMBIOS MANUALES</h3>${history.map(h => `<div><time>${this.esc(h.fecha)}</time><b>${this.esc(h.articulo)}: ${this.esc(h.letra_anterior)} → ${this.esc(h.letra_nueva)}</b><span>por ${this.esc(h.registrado_por)}</span></div>`).join('')}</section>` : ''}`;
    root.querySelectorAll('.code-edit').forEach(b => b.onclick = () => this.editCodeRow(b.dataset.art));
    root.querySelectorAll('.code-release').forEach(b => b.onclick = () => { const l = MapaModel.liberarLetra(b.dataset.art); this.renderCodigo(document.getElementById('codeSearch')?.value || ''); this.toast(`Letra "${l}" liberada de ${b.dataset.art}.`); });
  },

  /* --- Agregar Codigo en tarjetas -----------------------------------------
     La tabla de 5 columnas se estiraba a 1.152px en PC (la letra a la
     izquierda y los botones perdidos al otro extremo) y pedia 190px de
     scroll lateral en telefono, donde ACCION quedaba fuera de pantalla.
     La tarjeta pone el foco donde corresponde: la letra y su articulo.
     Verde cuando la letra esta asignada, ambar cuando falta; ese color manda
     el riel y el velo, igual que en el resto del sistema. */
  codeCard(articulo, pallets, cajas) {
    const letra = LETRAS_POR_ARTICULO[articulo];
    const descripcion = (typeof CATALOGO_ARTICULOS !== 'undefined' && CATALOGO_ARTICULOS[articulo] && CATALOGO_ARTICULOS[articulo].descripcion) || 'Sin descripción en catálogo';
    return `<article class="code-card ${letra ? 'assigned' : 'pending'}" data-art="${this.esc(articulo)}">
      <div class="code-card-head">
        <span class="code-letter">${letra ? this.esc(letra) : '<i class="wi wi-plus"></i>'}</span>
        <div class="code-card-id"><b>${this.esc(articulo)}</b><small>${this.esc(descripcion)}</small></div>
      </div>
      <div class="code-card-metrics">
        <div><small>PALLETS</small><span>${Number(pallets || 0).toLocaleString('es-CL')}</span></div>
        <div><small>CAJAS</small><span>${Number(cajas || 0).toLocaleString('es-CL')}</span></div>
      </div>
      <div class="code-card-actions">
        <button class="code-edit" data-art="${this.esc(articulo)}">${letra ? '<i class="wi wi-edit"></i>Editar letra' : '<i class="wi wi-plus"></i>Asignar letra'}</button>
        ${letra ? `<button class="code-release" data-art="${this.esc(articulo)}"><i class="wi wi-unlink"></i>Liberar</button>` : ''}
      </div>
    </article>`;
  },

  editCodeRow(articulo) {
    const row = document.querySelector(`.code-card[data-art="${CSS.escape(articulo)}"]`); if (!row) return;
    row.classList.add('editing');
    row.innerHTML = `<form class="inline-code-form"><strong>${this.esc(articulo)}</strong><label>Nueva letra<input name="letter" maxlength="3" value="${this.esc(LETRAS_POR_ARTICULO[articulo] || '')}" autofocus></label><label>Responsable<input name="actor" placeholder="¿Quién hace el cambio?"></label><div class="inline-code-actions"><button class="btn-primary">Guardar</button><button type="button" class="btn-secondary">Cancelar</button></div><small></small></form>`;
    const form = row.querySelector('form'); form.querySelector('[name=letter]').focus(); form.querySelector('.btn-secondary').onclick = () => this.renderCodigo(document.getElementById('codeSearch')?.value || '');
    form.onsubmit = e => { e.preventDefault(); const r = MapaModel.editarLetra(articulo, form.elements.letter.value, form.elements.actor.value); if (!r.ok) { form.querySelector('small').textContent = r.error; return; } this.renderCodigo(document.getElementById('codeSearch')?.value || ''); };
  },

  initInventario(container) {
    container.innerHTML = `<section class="map-submodule inventory-module">${DashboardController.operationalHeader({ eyebrow:'CONTROL DE UBICACIONES', title:'Inventario de Cámara', status:'Cruce entre cámara SAP y posición física' })}<div id="inventoryRoot"></div></section>`; DashboardController.startOperationalClock(); this.renderInventario();
  },

  inventoryRows() {
    const db = MapaModel.getPallets(), sap = INVENTARIO_CAMARA_SAP[this.inventoryCamera];
    return db.filter(p => p.banda !== null ? (p._camara_fisica || (p.ubicacion === 'POST TUNEL' ? 'postunel' : 'proter')) === this.inventoryCamera : p.ubicacion === sap).map(p => {
      const has = p.banda !== null; const status = !has ? 'no_encontrado' : p.ubicacion === sap ? 'encontrado' : 'otra_camara'; return { p, status };
    });
  },

  renderInventario() {
    const root = document.getElementById('inventoryRoot'); if (!root) return;
    const all = this.inventoryRows(), counts = { encontrado: 0, otra_camara: 0, no_encontrado: 0 }; all.forEach(x => counts[x.status]++);
    const q = this.inventorySearch.trim().toLowerCase(), visible = all.filter(x => (this.inventoryFilter === 'todos' || x.status === this.inventoryFilter) && (!q || PalletModel.codigoVisual(x.p).toLowerCase().includes(q) || PalletModel.idLoteReal(x.p).toLowerCase().includes(q)));
    const shown = visible.slice(0, this.inventoryPage * 40);
    root.innerHTML = `<div class="inventory-sticky"><div class="inventory-camera-tabs"><button data-camera="proter" class="${this.inventoryCamera === 'proter' ? 'active' : ''}"><i class="wi wi-snow"></i>Cámara Proter</button><button data-camera="postunel" class="${this.inventoryCamera === 'postunel' ? 'active' : ''}"><i class="wi wi-cube"></i>Cámara Post Túnel</button></div><div class="inventory-filters"><label><i class="wi wi-search"></i><input id="inventorySearch" value="${this.esc(this.inventorySearch)}" placeholder="Pallet (letra + número) o ID de lote"></label><div class="segmented">${[['todos','Todos'],['encontrado','Encontrado'],['otra_camara','Otra cámara'],['no_encontrado','No encontrado']].map(([k,l]) => `<button data-filter="${k}" class="${this.inventoryFilter === k ? 'active' : ''}">${l}</button>`).join('')}</div></div><div class="inventory-counts"><article class="found"><b>${counts.encontrado}</b><span>Encontrados</span></article><article class="other"><b>${counts.otra_camara}</b><span>En otra cámara</span></article><article class="missing"><b>${counts.no_encontrado}</b><span>No encontrados</span></article></div></div><div class="inventory-list">${shown.map(x => this.inventoryCard(x.p, x.status)).join('') || '<div class="empty-message">No hay pallets que coincidan con el filtro.</div>'}</div>${shown.length < visible.length ? `<button class="show-more" id="inventoryMore">Mostrar más (${visible.length - shown.length} restantes)</button>` : ''}<div id="inventoryModal"></div>`;
    root.querySelectorAll('[data-camera]').forEach(b => b.onclick = () => { this.inventoryCamera = b.dataset.camera; this.inventoryPage = 1; this.renderInventario(); });
    root.querySelectorAll('[data-filter]').forEach(b => b.onclick = () => { this.inventoryFilter = b.dataset.filter; this.inventoryPage = 1; this.renderInventario(); });
    document.getElementById('inventorySearch').oninput = e => { const value = e.target.value; clearTimeout(this._inventorySearchTimer); this._inventorySearchTimer = setTimeout(() => { this.inventorySearch = value; this.inventoryPage = 1; this.renderInventario(); const input = document.getElementById('inventorySearch'); input?.focus(); input?.setSelectionRange(value.length, value.length); }, 120); };
    root.querySelectorAll('.inventory-card').forEach(c => c.onclick = () => this.inventoryDetail(c.dataset.id, c.dataset.status));
    document.getElementById('inventoryMore')?.addEventListener('click', () => { this.inventoryPage += 1; this.renderInventario(); });
  },

  inventoryCard(p, status) {
    const labels = { encontrado: 'Encontrado', otra_camara: 'Otra cámara', no_encontrado: 'No encontrado' }, location = status === 'encontrado' ? `Banda ${p.banda} · P${p.posicion} · ${p.altura}` : status === 'otra_camara' ? `SAP: ${p.ubicacion} · aquí en ${INVENTARIO_NOMBRE_CAMARA[this.inventoryCamera]}` : 'Sin posición · asignar';
    return `<button class="inventory-card ${status}" data-id="${this.esc(p.id)}" data-status="${status}"><i>${status === 'no_encontrado' ? '?' : this.esc(PalletModel.codigoVisual(p))}</i><span><strong>${this.esc(PalletModel.idLoteReal(p))}</strong><small>${this.esc(p.articulo)} · ${this.esc(PalletModel.descripcion(p))} · ${p.cajas} cajas</small></span><em><b>${labels[status]}</b><small>${this.esc(location)}</small></em></button>`;
  },

  inventoryDetail(id, status, assign = false) {
    const p = MapaModel.getPallets().find(x => x.id === id), root = document.getElementById('inventoryModal'); if (!p || !root) return;
    if (assign) return this.inventoryAssign(p, status);
    root.innerHTML = `<div class="map-modal-backdrop"><section class="inventory-dialog"><header><div><b>${this.esc(PalletModel.codigoVisual(p))}</b><span>${status.replace('_', ' ')}</span></div><button id="inventoryClose">×</button></header><div class="inventory-dialog-body"><dl class="map-detail-grid"><div><dt>Artículo</dt><dd>${this.esc(p.articulo)} · ${this.esc(PalletModel.descripcion(p))}</dd></div><div><dt>Cajas</dt><dd>${p.cajas}</dd></div><div><dt>Ubicación física</dt><dd>${p.banda === null ? 'Sin posición' : `Banda ${p.banda} · P${p.posicion} · ${p.altura}`}</dd></div><div><dt>Cámara SAP</dt><dd>${this.esc(p.ubicacion)}</dd></div><div><dt>Calidad</dt><dd>${this.esc(p.estado)}</dd></div><div><dt>Kilos</dt><dd>${PalletModel.kilos(p)}</dd></div></dl><div class="inventory-actions"><button class="btn-primary" id="inventoryGoMap">Ir a su ubicación en el mapa</button><button class="btn-secondary" id="inventoryAssign">Asignar / editar posición</button><button class="btn-secondary" id="inventoryFull">Ver ficha completa</button></div></div></section></div>`;
    document.getElementById('inventoryClose').onclick = () => root.innerHTML = '';
    root.querySelector('.map-modal-backdrop').onclick = e => { if (e.target === e.currentTarget) root.innerHTML = ''; };
    document.getElementById('inventoryAssign').onclick = () => this.inventoryDetail(id, status, true);
    document.getElementById('inventoryGoMap').onclick = () => { const physical = p._camara_fisica || (p.ubicacion === 'POST TUNEL' ? 'postunel' : 'proter'); this.selectedPalletId = p.id; AppController.navigate(physical === 'proter' ? 'mapa_vista' : 'mapa_postunel'); setTimeout(() => { const c = document.querySelector(`.map-view-layer:not([hidden]) [data-pallet-id="${CSS.escape(p.id)}"]`); c?.scrollIntoView({ block: 'center', inline: 'center' }); c?.click(); }, 60); };
    document.getElementById('inventoryFull').onclick = () => { const codigo = PalletModel.codigoVisual(p); AppController.navigate('lote_detallado'); setTimeout(() => { const input = document.getElementById('loteSearchInput'); if (!input) return; input.value = codigo; StockController.buscarLote(); }, 0); };
  },

  inventoryAssign(p, status) {
    const root = document.getElementById('inventoryModal'), bands = this.inventoryCamera === 'proter' ? Array.from({ length: 30 }, (_, i) => String(i)) : ['01', '02', ...Array.from({ length: 18 }, (_, i) => String(i + 1))];
    root.querySelector('.inventory-dialog-body').innerHTML = `<div class="inventory-assign-heading"><span>UBICACIÓN EN MAPA</span><h3>Asignar posición física</h3><p>Elegí la banda, posición y nivel donde quedó el pallet.</p></div><div class="inventory-position-form"><label><span>Banda</span><div class="select-shell"><select id="invBand"><option value="">Elegir…</option>${bands.map(b => `<option ${String(p.banda) === b ? 'selected' : ''}>${b}</option>`).join('')}</select></div></label><label><span>Posición</span><div class="select-shell"><select id="invPos"></select></div></label><label><span>Nivel</span><div class="select-shell"><select id="invLevel"><option ${p.altura === 'C1' ? 'selected' : ''}>C1</option><option ${p.altura === 'C2' ? 'selected' : ''}>C2</option></select></div></label></div><div class="inventory-position-preview" id="invPreview"><span>Destino seleccionado</span><strong>Completá banda, posición y nivel</strong></div><div class="inventory-assign-actions"><button class="btn-secondary" id="invBack">Volver</button><button class="btn-primary" id="invSave"><i class="wi wi-check"></i>Guardar posición</button></div>`;
    const b = document.getElementById('invBand'), pos = document.getElementById('invPos'), fill = () => { if (!b.value) return pos.innerHTML = '<option value="">Elegir…</option>'; const raw = b.value, band = this.inventoryCamera === 'postunel' && (raw === '01' || raw === '02') ? raw : Number(raw); pos.innerHTML = Array.from({ length: MapaModel.maxPositions(this.inventoryCamera === 'proter' ? 'PROTER' : 'POST TUNEL', band) }, (_, i) => `<option ${i + 1 === Number(p.posicion) ? 'selected' : ''}>${i + 1}</option>`).join(''); }; fill(); b.onchange = fill;
    const preview=()=>{const target=document.getElementById('invPreview').querySelector('strong');target.textContent=b.value&&pos.value?`Banda ${b.value} · Posición ${pos.value} · ${document.getElementById('invLevel').value}`:'Completá banda, posición y nivel';};preview();b.addEventListener('change',preview);pos.addEventListener('change',preview);document.getElementById('invLevel').addEventListener('change',preview);
    document.getElementById('invBack').onclick = () => this.inventoryDetail(p.id, status);
    document.getElementById('invSave').onclick = () => { if (!b.value || !pos.value) return this.toast('Elegí banda, posición y nivel antes de guardar.', 'error'); const db = MapaModel.getPallets(), target = db.find(x => x.id === p.id),origin=this.positionOf(target), raw = b.value; target.banda = this.inventoryCamera === 'postunel' && (raw === '01' || raw === '02') ? raw : Number(raw); target.posicion = Number(pos.value); target.altura = document.getElementById('invLevel').value; target._camara_fisica = this.inventoryCamera; MapaModel.recalcularRepetidos(db); MapaModel.savePallets(db);this.recordMovement('ASIGNAR_POSICION',target,origin,this.positionOf(target)); root.innerHTML = ''; this.renderInventario(); this.toast(`Posición asignada: banda ${raw} · P${pos.value} · ${target.altura}.`); };
  }
};
