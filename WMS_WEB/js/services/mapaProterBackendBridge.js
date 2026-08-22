/**
 * Puente de comportamiento exclusivo para Cámara PROTER.
 *
 * No reescribe los renderizadores ni Post Túnel. Sustituye únicamente las
 * acciones de negocio del visor PROTER para que el backend sea la autoridad.
 */
const MapaProterBackendBridge = {
  instalado: false,
  originales: {},

  canManage() { return UserModel.hasPermission('mapa.gestionar'); },
  esc(v) { return SeguridadService.escaparHtml(v); },
  realId(p) { return p ? PalletModel.idLoteReal(p) : ''; },
  esProter(ctrl) { return ctrl?.activeCamera === 'PROTER'; },

  install() {
    if (this.instalado) return;
    if (typeof MapaController === 'undefined' || typeof MapaProterBackendModel === 'undefined') {
      throw new Error('No fue posible instalar el contrato backend de Cámara PROTER.');
    }

    const ctrl = MapaController;
    ['init','positionOf','renderMap','overlayDetail','overlayEmpty','overlayEditCode','beginCellEdit','chooseTouchDestination','overlayMove','dropPallet','emptyBand','toggleSelectedLoad','overlayCargo','undo','redo'].forEach(name => {
      this.originales[name] = ctrl[name];
    });

    const bridge = this;

    ctrl.positionOf = function(p) {
      if (!p) return null;
      return {
        ubicacion: p.ubicacion,
        camara: p.ubicacion,
        banda: p.banda,
        posicion: p.posicion,
        altura: p.altura,
        estado: p.estado,
        ...(p.segmento_id !== null && p.segmento_id !== undefined ? { segmento_id: p.segmento_id } : {})
      };
    };

    ctrl.init = async function(container, camera = this.activeCamera) {
      if (camera !== 'PROTER') return bridge.originales.init.call(this, container, camera);
      const availability = await MapaOfflineService.initialize();
      if (!availability.backendProterReady) {
        container.innerHTML = `<section class="map-offline-empty"><b>Conexión inicial requerida para PROTER</b><p>Este equipo todavía no posee un snapshot PROTER confirmado por Supabase. No se mostrarán datos demo ni una copia legacy como si fueran datos reales.</p></section>`;
        return;
      }
      await bridge.originales.init.call(this, container, camera);
      bridge.consumirUbicacionPendiente(this);
    };

    ctrl.renderMap = function(force = false) {
      const result = bridge.originales.renderMap.call(this, force);
      if (bridge.esProter(this)) {
        const meta = MapaProterBackendModel.camaraMeta();
        const capacity = Number(meta?.capacidad) || 508;
        const occupied = MapaModel.getPallets().filter(p => p._backend_proter && !p._backend_catalog && p.ubicacion === 'PROTER' && p.banda !== null).length;
        const cap = document.getElementById('mapCapacity');
        if (cap) cap.innerHTML = `<strong>${occupied}</strong><span>de ${capacity} slots ocupados</span>`;
      }
      return result;
    };

    ctrl.overlayDetail = function(root) {
      if (!bridge.esProter(this)) return bridge.originales.overlayDetail.call(this, root);
      return bridge.overlayDetail(this, root);
    };
    ctrl.overlayEmpty = function(root) {
      if (!bridge.esProter(this)) return bridge.originales.overlayEmpty.call(this, root);
      return bridge.overlayEmpty(this, root);
    };
    ctrl.overlayEditCode = function(root) {
      if (!bridge.esProter(this)) return bridge.originales.overlayEditCode.call(this, root);
      return bridge.overlayEditCode(this, root);
    };
    ctrl.beginCellEdit = function(pallet, slot, cell) {
      if (!bridge.esProter(this)) return bridge.originales.beginCellEdit.call(this, pallet, slot, cell);
      return bridge.beginCellEdit(this, pallet, slot, cell);
    };
    ctrl.chooseTouchDestination = function(occupant, slot, element) {
      if (!bridge.esProter(this)) return bridge.originales.chooseTouchDestination.call(this, occupant, slot, element);
      return bridge.chooseTouchDestination(this, occupant, slot, element);
    };
    ctrl.overlayMove = function(root) {
      if (!bridge.esProter(this)) return bridge.originales.overlayMove.call(this, root);
      return bridge.overlayMove(this, root);
    };
    ctrl.dropPallet = function(id, slot) {
      if (!bridge.esProter(this)) return bridge.originales.dropPallet.call(this, id, slot);
      return bridge.mover(this, id, slot, { close: false });
    };
    ctrl.emptyBand = function(banda) {
      if (!bridge.esProter(this)) return bridge.originales.emptyBand.call(this, banda);
      return bridge.emptyBand(this, banda);
    };
    ctrl.toggleSelectedLoad = function(pallet = null) {
      if (!bridge.esProter(this)) return bridge.originales.toggleSelectedLoad.call(this, pallet);
      return bridge.toggleCarga(this, pallet);
    };
    ctrl.overlayCargo = function(root) {
      if (!bridge.esProter(this)) return bridge.originales.overlayCargo.call(this, root);
      return bridge.overlayCargo(this, root);
    };
    ctrl.undo = function() {
      if (!bridge.esProter(this)) return bridge.originales.undo.call(this);
      return bridge.undo(this);
    };
    ctrl.redo = function() {
      if (!bridge.esProter(this)) return bridge.originales.redo.call(this);
      return bridge.redo(this);
    };

    this.instalado = true;
  },

  consumirUbicacionPendiente(ctrl) {
    const target = ctrl.pendingLocate;
    if (!target || String(target.camara || '').toUpperCase() !== 'PROTER') return;
    const candidates = MapaModel.getPallets().filter(p => p._backend_proter && !p._backend_catalog && p.ubicacion === 'PROTER');
    const pallet = candidates.find(p => target.segmentoId != null && Number(p.segmento_id) === Number(target.segmentoId))
      || candidates.find(p => this.realId(p) === String(target.idLote || '')
        && String(p.banda) === String(target.banda)
        && Number(p.posicion) === Number(target.posicion)
        && p.altura === target.altura)
      || candidates.find(p => this.realId(p) === String(target.idLote || ''));
    ctrl.pendingLocate = null;
    if (!pallet) {
      ctrl.toast('La ubicación solicitada ya no existe en el snapshot actual de PROTER.', 'warning');
      return;
    }
    requestAnimationFrame(() => {
      const key = ctrl.renderer?.key(pallet.banda, pallet.posicion, pallet.altura);
      const cell = key ? ctrl.renderer?.cells?.get(key) : null;
      if (!cell) return ctrl.toast('El pallet existe, pero su celda no pudo localizarse en la vista actual.', 'warning');
      const slot = { banda: pallet.banda, posicion: pallet.posicion, altura: pallet.altura };
      cell.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
      ctrl.selectCell(pallet, slot, cell);
    });
  },

  estaEnCarga(pallet) {
    const id = this.realId(pallet);
    const state = MapaModel.getState();
    return (state.cargo?.embarque || []).some(entryId => {
      const entry = MapaModel.getPallets().find(p => p.id === entryId);
      return entry && this.realId(entry) === id;
    });
  },

  entradaCarga(pallet) {
    const id = this.realId(pallet);
    return MapaModel.getPallets().find(p => p._backend_catalog && this.realId(p) === id) || pallet;
  },

  palletsCarga() {
    const state = MapaModel.getState(), ids = new Set(state.cargo?.embarque || []);
    const seen = new Set();
    return MapaModel.getPallets().filter(p => ids.has(p.id)).filter(p => {
      const id = this.realId(p); if (!id || seen.has(id)) return false; seen.add(id); return true;
    });
  },

  overlayDetail(ctrl, root) {
    const p = MapaModel.getPallets().find(x => x.id === ctrl.selectedPalletId);
    if (!p) return ctrl.closeOverlay();
    const manage = this.canManage();
    const visual = PalletModel.codigoVisualLegible(p), realId = this.realId(p);
    const cajas = p.cajas == null ? '—' : Number(p.cajas).toLocaleString('es-CL');
    const kilos = p.kilos == null ? '—' : Number(p.kilos).toLocaleString('es-CL');
    const reserved = p.reservado === true ? 'SÍ' : p.reservado === false ? 'NO' : '—';
    const detector = p.detector_metales || 'SIN INFORMACIÓN';
    const quality = p.estado_sap || '—';
    const location = `Banda ${this.esc(p.banda)} · Nivel ${this.esc(p.altura)} · Posición ${p.posicion}`;
    const audit = p.ultima_auditoria;
    const auditHtml = audit ? `<div class="compact-info-row general" style="--info:#38bdf8"><span>↺</span><strong>Última auditoría <em>${this.esc(audit.evento || 'Evento WMS')}</em></strong><p>${this.esc([audit.usuario,audit.rol,audit.fecha ? new Date(audit.fecha).toLocaleString('es-CL') : null].filter(Boolean).join(' · '))}</p></div>` : '';
    const warnings = [
      p.repetido ? '⚠ La referencia aparece en más de una posición.' : '',
      p.no_existe ? '⚠ Esta posición WMS no tiene actualmente un pallet correspondiente en SAP.' : '',
      p.diferencia_almacen_mapa ? `⚠ SAP indica ${p.almacen_sap || 'otro almacén'}; la ubicación física WMS es PROTER.` : ''
    ].filter(Boolean).map(x => `<p class="map-warning">${this.esc(x)}</p>`).join('');
    const disabled = manage ? '' : 'disabled title="Sin permiso mapa.gestionar"';
    const inLoad = this.estaEnCarga(p);

    ctrl.overlayShell(root, 'Detalle del pallet', `<div class="pallet-detail-hero"><div class="pallet-visual-code"><small>REFERENCIA VISUAL</small><strong>${this.esc(visual)}</strong></div><span class="map-state-badge" style="--state:${p.repetido ? COLOR_MAPA_REPETIDO : (COLORES_MAPA_ESTADO[p.estado] || '#64748B')}">${this.esc(p.estado)}</span></div>
      <section class="pallet-real-id"><small>ID REAL DEL LOTE</small><strong>${this.esc(realId)}</strong><span>Artículo ${this.esc(p.articulo)} · Pallet ${this.esc(p.numero_pallet || '—')}</span></section>
      <div class="pallet-detail-section product-section"><h4>Producto</h4><dl class="map-detail-grid product-summary"><div class="wide"><dt>Descripción</dt><dd>${this.esc(p.descripcion || '—')}</dd></div><div><dt>Estado WMS</dt><dd>${this.esc(p.estado_wms || p.estado || '—')}</dd></div><div><dt>Calidad SAP</dt><dd>${this.esc(quality)}</dd></div><div class="stock-metric"><dt>Kilos físicos</dt><dd>${kilos} <small>kg</small></dd></div><div class="stock-metric"><dt>Cajas físicas</dt><dd>${cajas}</dd></div></dl></div>
      <div class="pallet-detail-section insight-section"><h4>Información asociada</h4><div class="pallet-information-compact"><div class="compact-info-row quality" style="--info:#10b981"><span>🔬</span><strong>Calidad <em>${this.esc(quality)}</em></strong><p>${this.esc(p.info_calidad || 'Sin información de calidad registrada.')}</p></div><div class="compact-info-row general" style="--info:#38bdf8"><span>📝</span><strong>Info general</strong><p>${this.esc(p.info_general || 'Sin información general registrada.')}</p></div><div class="compact-reserve ${reserved === 'SÍ' ? 'reserved' : ''}"><span>Reserva</span><b>${this.esc(reserved)}</b></div><div class="compact-reserve"><span>Detector</span><b>${this.esc(detector)}</b></div>${auditHtml}</div></div>
      <div class="pallet-detail-section trace-section"><h4>Ubicación</h4><dl class="map-detail-grid traceability"><div class="wide"><dt>Posición actual</dt><dd>${location}</dd></div><div><dt>Almacén SAP</dt><dd>${this.esc(p.almacen_sap || p.whscode || '—')}</dd></div><div><dt>Segmento WMS</dt><dd>${this.esc(p.segmento_id ?? 'pendiente de sincronizar')}</dd></div></dl></div>${warnings}
      <div class="pallet-shortcuts" aria-label="Atajos de teclado"><span><kbd>P</kbd>Carga</span><span><kbd>Espacio</kbd>Editar</span><span><kbd>Supr</kbd>Vaciar</span><span><kbd>Esc</kbd>Cerrar</span></div>
      <div class="overlay-actions detail-action-grid"><button class="btn-primary" id="detailLoad"><i class="wi wi-truck"></i>${inLoad ? 'Quitar carga' : 'Agregar carga'}</button><button class="btn-secondary" id="detailTouchMove" ${disabled}><i class="wi wi-hand"></i>Elegir destino</button><button class="btn-secondary" id="detailMove" ${disabled}><i class="wi wi-swap"></i>Mover</button><button class="btn-secondary" id="detailEditCode" ${disabled}><i class="wi wi-edit"></i>Editar</button><button class="btn-secondary danger" id="detailDelete" ${disabled}><i class="wi wi-erase"></i>Vaciar</button></div>`, 'detail-overlay pallet-detail-overlay');

    document.getElementById('detailLoad').onclick = () => this.toggleCarga(ctrl, p);
    if (manage) {
      document.getElementById('detailTouchMove').onclick = () => ctrl.startTouchMove(p.id);
      document.getElementById('detailMove').onclick = () => ctrl.openOverlay('move');
      document.getElementById('detailEditCode').onclick = () => ctrl.openOverlay('edit-code');
      document.getElementById('detailDelete').onclick = () => ctrl.removePalletFromPosition(p.id, ctrl.selectedSlot);
    }
  },

  overlayEmpty(ctrl, root) {
    const s = ctrl.selectedSlot, manage = this.canManage();
    ctrl.overlayShell(root, `Slot vacío · B${this.esc(s.banda)} · P${s.posicion} · ${s.altura}`, `<p>La posición está disponible. La identidad se resolverá contra Supabase o contra el último catálogo backend si el equipo está offline.</p><button class="btn-primary wide" id="emptyAssign" ${manage ? '' : 'disabled title="Sin permiso mapa.gestionar"'}><i class="wi wi-plus"></i>Asignar código visual</button>`, 'detail-overlay');
    if (manage) document.getElementById('emptyAssign').onclick = () => ctrl.openOverlay('edit-code');
  },

  overlayEditCode(ctrl, root) {
    const slot = ctrl.selectedSlot, pallet = MapaModel.getPallets().find(x => x.id === ctrl.selectedPalletId);
    const value = pallet && !pallet.sin_codigo_visual ? PalletModel.codigoVisual(pallet) : '';
    ctrl.overlayShell(root, pallet ? `Editar ${this.esc(PalletModel.codigoVisualLegible(pallet))}` : 'Asignar pallet al slot', `<p>${pallet ? 'Corregí la identidad de esta posición física. La operación queda auditada y no cambia la tabla SAP.' : `Destino: banda ${this.esc(slot.banda)}, posición ${slot.posicion}, nivel ${slot.altura}.`}</p><label class="touch-code-field"><span>ID lote o código visual</span><input id="touchCodeInput" maxlength="20" value="${this.esc(value)}" placeholder="Ej: A234 o ID completo" autocomplete="off" autocapitalize="characters"></label><div class="overlay-actions"><button class="btn-secondary" id="touchCodeCancel">Cancelar</button><button class="btn-primary" id="touchCodeSave">Guardar</button></div><small id="touchCodeError" style="color:#ef4444"></small>`, 'edit-code-overlay touch-action-overlay');
    const input = document.getElementById('touchCodeInput'); input.focus(); input.select();
    const save = () => this.guardarIdentidad(ctrl, pallet, slot, input.value, document.getElementById('touchCodeError'));
    document.getElementById('touchCodeCancel').onclick = () => ctrl.closeOverlay();
    document.getElementById('touchCodeSave').onclick = save;
    input.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); save(); } };
  },

  beginCellEdit(ctrl, pallet, slot, cell) {
    if (!this.canManage()) return ctrl.toast('Tu sesión no posee permiso para editar posiciones PROTER.', 'error');
    if (!cell) return;
    const original = pallet && !pallet.sin_codigo_visual ? PalletModel.codigoVisual(pallet) : '';
    cell.innerHTML = `<input class="map-cell-editor" aria-label="ID lote o código visual" maxlength="20" value="${this.esc(original)}">`;
    const input = cell.querySelector('input'); input.focus(); input.select();
    let done = false;
    const finish = async save => {
      if (done) return; done = true;
      if (save) await this.guardarIdentidad(ctrl, pallet, slot, input.value, null, { close: false });
      else ctrl.refresh();
    };
    input.onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); finish(true); } if (e.key === 'Escape') finish(false); };
    input.onblur = () => setTimeout(() => { if (!done && document.body.contains(input)) finish(false); }, 100);
  },

  async guardarIdentidad(ctrl, pallet, slot, code, errorNode = null, options = {}) {
    const value = String(code || '').trim();
    if (!value) { const m = 'Ingresá un ID de lote o código visual.'; if (errorNode) errorNode.textContent = m; else ctrl.toast(m, 'error'); return; }
    if (!this.canManage()) return ctrl.toast('Tu sesión no posee permiso para gestionar posiciones PROTER.', 'error');
    const result = await MapaProterBackendModel.resolverOperacional(value);
    if (!result?.ok) { const m = result?.error || 'No fue posible resolver el pallet.'; if (errorNode) errorNode.textContent = m; else ctrl.toast(m, 'error'); return; }
    const resolved = result.pallet;
    const db = MapaModel.getPallets();

    if (pallet) {
      if (pallet.segmento_id == null) { const m = 'Esta posición todavía está pendiente de sincronización. Sincronícela antes de corregir su identidad.'; if (errorNode) errorNode.textContent = m; else ctrl.toast(m, 'warning'); return; }
      if (this.realId(pallet) === String(resolved.id_lote || '')) { if (options.close !== false) ctrl.closeOverlay(); ctrl.refresh(); return; }
      MapaProterBackendModel.aplicarIdentidad(pallet, resolved);
      MapaModel.savePallets(db);
      ctrl.pendingPalletIds.add(pallet.id);
      await MapaOfflineService.record({
        action: 'REEMPLAZAR_SEGMENTO',
        palletId: pallet.id,
        palletCode: PalletModel.codigoVisual(pallet),
        palletRealId: this.realId(pallet),
        previousPalletRealId: String(result.codigo_original || ''),
        segmentoId: pallet.segmento_id,
        enteredCode: value,
        camera: 'PROTER',
        reason: 'Corrección de identidad desde Mapa PROTER'
      });
      if (options.close !== false) ctrl.closeOverlay();
      ctrl.refresh();
      ctrl.toast('Corrección registrada localmente y enviada a la cola auditada de PROTER.', result.offline ? 'warning' : 'success');
      return;
    }

    const occupied = db.find(p => p.ubicacion === 'PROTER' && p.banda !== null && String(p.banda) === String(slot.banda) && Number(p.posicion) === Number(slot.posicion) && p.altura === slot.altura);
    if (occupied) return ctrl.toast('La posición dejó de estar vacía. Actualizá el mapa antes de asignar.', 'error');
    UndoService.guardarSnapshot('PROTER', db);
    const created = MapaProterBackendModel.resolvedToSegment(resolved, slot);
    db.push(created); MapaModel.recalcularRepetidos(db); MapaModel.savePallets(db);
    ctrl.pendingPalletIds.add(created.id);
    await MapaOfflineService.record({
      action: 'ASIGNAR_PALLET',
      palletId: created.id,
      palletCode: PalletModel.codigoVisual(created),
      palletRealId: this.realId(created),
      origin: null,
      destination: ctrl.positionOf(created),
      enteredCode: value,
      camera: 'PROTER'
    });
    ctrl.selectedPalletId = created.id;
    if (options.close !== false) ctrl.closeOverlay();
    ctrl.refresh();
    ctrl.toast('Pallet asignado a PROTER y agregado a la cola de sincronización.', result.offline ? 'warning' : 'success');
  },

  chooseTouchDestination(ctrl, occupant, slot, element) {
    const moving = MapaModel.getPallets().find(x => x.id === ctrl.pendingMovePalletId);
    if (!moving) return ctrl.cancelTouchMove();
    if (String(moving.banda) === String(slot.banda) && Number(moving.posicion) === Number(slot.posicion) && moving.altura === slot.altura) return ctrl.toast('Ese pallet ya se encuentra en esa posición.', 'error');
    ctrl.selectedSlot = slot; ctrl.overlayAnchor = element || ctrl.selectedCellElement;
    document.querySelectorAll('.map-slot.touch-destination').forEach(x => x.classList.remove('touch-destination')); element?.classList.add('touch-destination');
    const root = document.getElementById('mapOverlayRoot'), destination = `Banda ${this.esc(slot.banda)} · P${slot.posicion} · ${slot.altura}`;
    root.dataset.mode = 'move-confirm';
    if (occupant && occupant.id !== moving.id) {
      ctrl.overlayShell(root, 'Destino ocupado', `<div class="touch-move-summary"><span><small>PALLET</small><b>${this.esc(PalletModel.codigoVisualLegible(moving))}</b></span><i>→</i><span><small>DESTINO</small><b>${destination}</b></span></div><p class="map-warning">⚠ La posición está ocupada por ${this.esc(PalletModel.codigoVisualLegible(occupant))}. Supabase no permite desalojar otro pallet implícitamente.</p><div class="overlay-actions"><button class="btn-primary" id="touchMoveBack">Elegir otra posición</button></div>`, 'move-confirm-overlay touch-action-overlay');
      document.getElementById('touchMoveBack').onclick = () => { element?.classList.remove('touch-destination'); ctrl.closeOverlay(); };
      return;
    }
    ctrl.overlayShell(root, 'Confirmar movimiento', `<div class="touch-move-summary"><span><small>PALLET</small><b>${this.esc(PalletModel.codigoVisualLegible(moving))}</b></span><i>→</i><span><small>DESTINO</small><b>${destination}</b></span></div><p>La posición seleccionada está vacía.</p><div class="overlay-actions"><button class="btn-secondary" id="touchMoveBack">Elegir otra</button><button class="btn-primary" id="touchMoveConfirm">Confirmar movimiento</button></div>`, 'move-confirm-overlay touch-action-overlay');
    document.getElementById('touchMoveBack').onclick = () => { element?.classList.remove('touch-destination'); ctrl.closeOverlay(); };
    document.getElementById('touchMoveConfirm').onclick = async () => { await this.mover(ctrl, moving.id, slot, { close: true }); ctrl.cancelTouchMove(); };
  },

  overlayMove(ctrl, root) {
    const p = MapaModel.getPallets().find(x => x.id === ctrl.selectedPalletId); if (!p) return;
    const bands = MapaProterBackendModel.bandas();
    const options = bands.map(b => `<option value="${b}" ${String(b) === String(p.banda) ? 'selected' : ''}>${b}</option>`).join('');
    ctrl.overlayShell(root, `Mover ${this.esc(PalletModel.codigoVisualLegible(p))}`, `<p>Seleccioná una ubicación exacta. El backend rechazará destinos ocupados o geometrías inválidas.</p><div class="move-grid"><label>Banda<select id="moveBand">${options}</select></label><label>Posición<select id="movePos"></select></label><label>Nivel<select id="moveLevel"><option ${p.altura === 'C1' ? 'selected' : ''}>C1</option><option ${p.altura === 'C2' ? 'selected' : ''}>C2</option></select></label></div><div class="overlay-actions"><button class="btn-secondary" id="moveDelete">Vaciar esta celda</button><button class="btn-primary" id="moveSave">Mover pallet</button></div>`, 'move-overlay touch-action-overlay');
    const band = document.getElementById('moveBand'), pos = document.getElementById('movePos');
    const fill = () => { pos.innerHTML = Array.from({ length: MapaProterBackendModel.maxPosiciones(Number(band.value)) }, (_, i) => `<option ${i + 1 === Number(p.posicion) ? 'selected' : ''}>${i + 1}</option>`).join(''); }; fill(); band.onchange = fill;
    document.getElementById('moveSave').onclick = () => this.mover(ctrl, p.id, { banda: Number(band.value), posicion: Number(pos.value), altura: document.getElementById('moveLevel').value }, { close: true });
    document.getElementById('moveDelete').onclick = () => ctrl.removePalletFromPosition(p.id, ctrl.selectedSlot);
  },

  async mover(ctrl, id, slot, options = {}) {
    if (!this.canManage()) return ctrl.toast('Tu sesión no posee permiso para mover pallets PROTER.', 'error');
    const db = MapaModel.getPallets(), pallet = db.find(p => p.id === id); if (!pallet) return;
    const occupant = db.find(p => p.ubicacion === 'PROTER' && p.banda !== null && p.id !== id && String(p.banda) === String(slot.banda) && Number(p.posicion) === Number(slot.posicion) && p.altura === slot.altura);
    if (occupant) return ctrl.toast(`Destino ocupado por ${PalletModel.codigoVisualLegible(occupant)}. No se desplazó ningún pallet.`, 'error');
    if (String(pallet.banda) === String(slot.banda) && Number(pallet.posicion) === Number(slot.posicion) && pallet.altura === slot.altura) return ctrl.toast('El pallet ya se encuentra en esa posición.', 'info');
    const origin = ctrl.positionOf(pallet);
    UndoService.guardarSnapshot('PROTER', db);
    const moved = MapaModel.moverPalletSeguro(id, 'PROTER', Number(slot.banda), Number(slot.posicion), slot.altura);
    if (!moved?.ok) return ctrl.toast(moved?.error || 'No fue posible mover el pallet.', 'error');
    ctrl.recordMovement('MOVER_PALLET', pallet, origin, ctrl.positionOf(pallet));
    if (options.close) ctrl.closeOverlay();
    ctrl.refresh();
    ctrl.toast('Movimiento aplicado al snapshot local y enviado a sincronización PROTER.', MapaOfflineService.reachable ? 'success' : 'warning');
  },

  async emptyBand(ctrl, banda) {
    if (!this.canManage()) return ctrl.toast('Tu sesión no posee permiso para vaciar bandas PROTER.', 'error');
    const db = MapaModel.getPallets(), affected = db.filter(p => p.ubicacion === 'PROTER' && String(p.banda) === String(banda));
    if (!affected.length) return;
    UndoService.guardarSnapshot('PROTER', db);
    affected.forEach(p => ctrl.pendingPalletIds.add(p.id));
    const removed = MapaModel.vaciarBanda('PROTER', Number(banda));
    await MapaOfflineService.record({ action:'VACIAR_BANDA', camera:'PROTER', band:String(banda), affectedIds:affected.map(p => p.id), reason:'Vaciar banda desde Mapa PROTER' });
    ctrl.refresh();
    ctrl.toast(`Banda ${banda}: ${removed} pallet(s) retirados mediante una operación atómica pendiente de confirmación backend.`, MapaOfflineService.reachable ? 'success' : 'warning');
  },

  toggleCarga(ctrl, pallet = null) {
    const p = pallet || MapaModel.getPallets().find(x => x.id === ctrl.selectedPalletId); if (!p) return;
    const entry = this.entradaCarga(p), idLote = this.realId(p), state = MapaModel.getState();
    state.cargo ||= { embarque: [], postunel: [] }; state.cargo.embarque ||= [];
    const db = MapaModel.getPallets();
    const existing = state.cargo.embarque.findIndex(entryId => { const x = db.find(row => row.id === entryId); return x && this.realId(x) === idLote; });
    if (existing >= 0) state.cargo.embarque.splice(existing, 1); else state.cargo.embarque.push(entry.id);
    MapaModel.saveState(state);
    ctrl.closeOverlay(); ctrl.refresh();
    ctrl.toast(existing >= 0 ? 'Pallet retirado de la preparación de carga.' : 'Pallet agregado a la preparación de carga. Su posición física no cambia hasta la operación real de Andén.', 'info');
  },

  overlayCargo(ctrl, root) {
    const pallets = this.palletsCarga(), cajas = pallets.reduce((s,p) => s + (Number(p.cajas) || 0), 0), arts = new Set(pallets.map(p => p.articulo)).size;
    const cells = pallets.length ? pallets.map(p => `<button class="load-pallet" data-id="${this.esc(p.id)}" title="Tocar para quitar"><strong>${this.esc(PalletModel.codigoVisual(p))}</strong><small>${this.esc(p.articulo)}</small><i style="--state:${COLORES_MAPA_ESTADO[p.estado] || '#64748B'}">${ABREVIATURAS_ESTADO_MAPA[p.estado] || '—'}</i></button>`).join('') : '<p class="empty-message">Todavía no hay pallets en la preparación de carga.</p>';
    ctrl.overlayShell(root, '🚚 Embarque · Proter', `<div class="manual-load"><input id="manualLoadCode" placeholder="Código visual o ID lote" autofocus><button id="manualLoadAdd">Agregar</button></div><small>Esta lista prepara el handoff. Seleccionar un pallet aquí NO borra su posición física; la salida real del mapa corresponde a la operación backend de Andén.</small><div class="load-progress"><b>${pallets.length} de 30 pallets</b><span>${pallets.length >= 30 ? 'rampla completa' : pallets.length >= 20 ? `faltan ${30-pallets.length} para 30` : 'en preparación'}</span></div><div class="load-grid">${cells}</div><div class="load-totals"><span><small>Pallets</small><b>${pallets.length}</b></span><span><small>Cajas</small><b>${cajas.toLocaleString('es-CL')}</b></span><span><small>Artículos</small><b>${arts}</b></span></div><button class="btn-primary wide" id="goToDock">Continuar al Andén de Carga<i class="wi wi-right"></i></button>`, 'cargo-overlay');
    root.querySelectorAll('.load-pallet').forEach(btn => btn.onclick = () => { const p = MapaModel.getPallets().find(x => x.id === btn.dataset.id); if (p) this.toggleCarga(ctrl,p); ctrl.openOverlay('cargo'); });
    const add = async () => {
      const input = document.getElementById('manualLoadCode'), value = input.value.trim(); if (!value) return;
      const r = await MapaProterBackendModel.resolverOperacional(value); if (!r?.ok) return ctrl.toast(r?.error || 'No se encontró el pallet.', 'error');
      const idLote = String(r.pallet.id_lote || ''); let entry = MapaModel.getPallets().find(p => p._backend_catalog && this.realId(p) === idLote);
      if (!entry) { entry = MapaProterBackendModel.catalogoPallet(r.pallet); const db = MapaModel.getPallets(); db.push(entry); MapaModel.savePallets(db); }
      if (!this.estaEnCarga(entry)) this.toggleCarga(ctrl, entry);
      ctrl.openOverlay('cargo');
    };
    document.getElementById('manualLoadAdd').onclick = add;
    document.getElementById('manualLoadCode').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); add(); } };
    document.getElementById('goToDock').onclick = () => { ctrl.closeOverlay(); AndenController.activeTab = 'embarque'; AppController.navigate('anden_carga'); };
  },

  async registrarDiferencias(ctrl, before, after, action) {
    const oldById = new Map(before.filter(p => p._backend_proter && !p._backend_catalog).map(p => [p.id,p]));
    const newById = new Map(after.filter(p => p._backend_proter && !p._backend_catalog).map(p => [p.id,p]));
    const ids = new Set([...oldById.keys(), ...newById.keys()]);
    for (const id of ids) {
      const old = oldById.get(id), now = newById.get(id);
      const oldPos = old ? ctrl.positionOf(old) : null, newPos = now ? ctrl.positionOf(now) : null;
      const oldHas = oldPos?.banda !== null && oldPos?.banda !== undefined;
      const newHas = newPos?.banda !== null && newPos?.banda !== undefined;
      if (!oldHas && !newHas) continue;
      const same = oldHas && newHas && String(oldPos.banda)===String(newPos.banda) && Number(oldPos.posicion)===Number(newPos.posicion) && oldPos.altura===newPos.altura;
      if (same) continue;
      const pallet = now || old;
      await MapaOfflineService.record({
        action,
        palletId:pallet.id,
        palletCode:PalletModel.codigoVisual(pallet),
        palletRealId:this.realId(pallet),
        origin:oldHas ? oldPos : null,
        destination:newHas ? newPos : null,
        beforeState:oldHas ? oldPos : null,
        camera:'PROTER'
      });
    }
  },

  async undo(ctrl) {
    const before = MapaModel.clone(MapaModel.getPallets());
    const restored = UndoService.deshacer('PROTER', MapaModel.getPallets()); if (!restored) return;
    const after = MapaModel.clone(MapaModel.getPallets());
    await this.registrarDiferencias(ctrl,before,after,'DESHACER');
    ctrl.refresh();
  },

  async redo(ctrl) {
    const before = MapaModel.clone(MapaModel.getPallets());
    const restored = UndoService.rehacer('PROTER', MapaModel.getPallets()); if (!restored) return;
    const after = MapaModel.clone(MapaModel.getPallets());
    await this.registrarDiferencias(ctrl,before,after,'REHACER');
    ctrl.refresh();
  }
};
