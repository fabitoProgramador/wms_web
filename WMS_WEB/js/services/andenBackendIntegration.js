/**
 * Integración final de Andén remoto.
 * Mantiene el layout/CSS existente y adapta los controles de Andén al contrato
 * autoritativo de Supabase. No mantiene datos de negocio en localStorage.
 */
const AndenBackendIntegration = {
  installed: false,

  install() {
    if (this.installed) return;
    if (typeof AndenController === 'undefined' || typeof AndenBackendController === 'undefined' || typeof AndenBackendModel === 'undefined') {
      throw new Error('No fue posible instalar la integración remota de Andén.');
    }

    this.patchModel();
    this.patchController();

    // La navegación existente sigue llamando AndenController.init(). Se conserva
    // ese contrato para no tocar AppController, pero el módulo real es remoto.
    AndenController.init = container => AndenBackendController.init(container);
    this.installed = true;
  },

  normalize(value) {
    return String(value || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[–—]+/g, '-')
      .replace(/\s+/g, ' ')
      .trim().toLocaleLowerCase('es-CL');
  },

  normalizeRut(value) {
    return String(value || '').toUpperCase().replace(/[^0-9K]/g, '');
  },

  normalizePatent(value) {
    return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  },

  patchModel() {
    // La rama ya centraliza los nombres RPC en SUPABASE_CONFIG. Se completa
    // aquí el contrato de packing de Andén para no duplicar rutas REST.
    SUPABASE_CONFIG.RPC.anden.packing ||= 'wms_anden_packing';

    if (typeof AndenBackendModel.packing !== 'function') {
      AndenBackendModel.packing = function(despachoId) {
        return this.rpc('packing', { p_despacho_id: this.entero(despachoId) });
      };
    }

    if (typeof AndenBackendModel.ultimoUsoConductor !== 'function') {
      AndenBackendModel.ultimoUsoConductor = async function({ nombre = '', rut = '' } = {}) {
        const query = String(nombre || rut || '').trim();
        if (!query) return null;
        const [proter, post] = await Promise.all([
          this.historial('embarque', { busqueda: query, limite: 10, offset: 0 }).catch(() => null),
          this.historial('postunel', { busqueda: query, limite: 10, offset: 0 }).catch(() => null)
        ]);
        const rutNorm = AndenBackendIntegration.normalizeRut(rut);
        const nameNorm = AndenBackendIntegration.normalize(nombre);
        const rows = [...(proter?.items || []), ...(post?.items || [])].filter(row => {
          const rowRut = AndenBackendIntegration.normalizeRut(row.rut_conductor || row.rut || '');
          const rowName = AndenBackendIntegration.normalize(row.conductor || '');
          return (rutNorm && rowRut === rutNorm) || (nameNorm && rowName === nameNorm);
        });
        rows.sort((a, b) => {
          const ta = Date.parse(a.fecha_hora || a.fecha_operacional || '') || 0;
          const tb = Date.parse(b.fecha_hora || b.fecha_operacional || '') || 0;
          return tb - ta || Number(b.despacho_id || 0) - Number(a.despacho_id || 0);
        });
        return rows[0] || null;
      };
    }
  },

  patchController() {
    const C = AndenBackendController;
    const integration = this;
    const originalSaveCorrection = C.saveCorrection.bind(C);
    const originalRenderHistoryRecord = C.renderHistoryRecord.bind(C);

    C.emptyDraft = function() {
      return {
        destinoId: '', destinoNombre: '', empresa: '', sucursal: '', domicilio: '', ciudad: '',
        transportistaId: '', transportistaNombre: '', transportistaRut: '',
        conductorId: '', chofer: '', rut: '',
        camionId: '', patente_camion: '', ramplaId: '', patente_rampla: '',
        temperatura: '', observaciones: '', fechaHora: ''
      };
    };

    C.draftFromCurrent = function(current) {
      const c = current?.cabecera || {};
      const tr = this.selectedCatalog('transportistas', c.transportista_id);
      return {
        destinoId: c.destino_id ?? '', destinoNombre: c.destino || '', empresa: c.empresa_destino || '', sucursal: c.sucursal_destino || '', domicilio: c.domicilio_destino || '', ciudad: c.ciudad_destino || '',
        transportistaId: c.transportista_id ?? '', transportistaNombre: c.transportista || '', transportistaRut: tr?.rut || '',
        conductorId: c.conductor_id ?? '', chofer: c.conductor || '', rut: c.rut_conductor || '',
        camionId: c.camion_id ?? '', patente_camion: c.patente_camion || '', ramplaId: c.rampla_id ?? '', patente_rampla: c.patente_rampla || '',
        temperatura: c.temperatura ?? '', observaciones: c.observaciones ?? '', fechaHora: this.datetimeLocal(c.fecha_hora_despacho)
      };
    };

    C.draftFromHistory = function(c = {}) {
      const tr = this.selectedCatalog('transportistas', c.transportista_id);
      return {
        destinoId: c.destino_id ?? '', destinoNombre: c.destino || '', empresa: c.empresa_destino || '', sucursal: c.sucursal_destino || '', domicilio: c.domicilio_destino || '', ciudad: c.ciudad_destino || '',
        transportistaId: c.transportista_id ?? '', transportistaNombre: c.transportista || '', transportistaRut: tr?.rut || '',
        conductorId: c.conductor_id ?? '', chofer: c.conductor || '', rut: c.rut_conductor || '',
        camionId: c.camion_id ?? '', patente_camion: c.patente_camion || '', ramplaId: c.rampla_id ?? '', patente_rampla: c.patente_rampla || '',
        temperatura: c.temperatura ?? '', observaciones: c.observaciones ?? '', fechaHora: this.datetimeLocal(c.fecha_hora_despacho)
      };
    };

    C.inputField = function(name, label, value, { list = '', placeholder = '', attrs = '' } = {}) {
      const listAttr = list ? ` list="${this.esc(list)}"` : '';
      return `<label class="dock-field"><span>${this.esc(label)}</span><input name="${this.esc(name)}" value="${this.esc(value ?? '')}"${listAttr} placeholder="${this.esc(placeholder)}" autocomplete="off" ${attrs}></label>`;
    };

    C.dataList = function(id, items, valueFn, labelFn = () => '') {
      return `<datalist id="${this.esc(id)}">${items.map(item => `<option value="${this.esc(valueFn(item))}">${this.esc(labelFn(item))}</option>`).join('')}</datalist>`;
    };

    C.findDestination = function(value) {
      const q = integration.normalize(value);
      return this.catalogs.destinos.find(x => integration.normalize(x.nombre) === q) || null;
    };
    C.findTransport = function(value) {
      const q = integration.normalize(value);
      return this.catalogs.transportistas.find(x => integration.normalize(x.razon_social) === q) || null;
    };
    C.findDriver = function(value) {
      const q = integration.normalize(value), r = integration.normalizeRut(value);
      return this.catalogs.conductores.find(x => integration.normalize(x.nombre) === q || (r && integration.normalizeRut(x.rut) === r)) || null;
    };
    C.findVehicle = function(value, type) {
      const q = integration.normalizePatent(value);
      return this.catalogs.vehiculos.find(x => x.tipo === type && integration.normalizePatent(x.patente) === q) || null;
    };

    C.readDraft = function(form = document.getElementById('dockBackendForm')) {
      const data = { ...(this.drafts[this.activeTab] || this.emptyDraft()) };
      if (!form) return data;
      [
        'destinoNombre', 'empresa', 'domicilio', 'ciudad',
        'transportistaNombre', 'chofer', 'rut', 'patente_camion', 'patente_rampla',
        'temperatura', 'observaciones'
      ].forEach(key => {
        const node = form.querySelector(`[name=${key}]`);
        if (node) data[key] = node.value;
      });
      return data;
    };

    C.writeDraftToForm = function(form, draft, keys) {
      (keys || []).forEach(key => {
        const node = form?.querySelector(`[name=${key}]`);
        if (node) node.value = draft[key] ?? '';
      });
    };

    C.applyDestination = function(form, value) {
      const d = this.drafts[this.activeTab];
      const found = this.findDestination(value);
      d.destinoNombre = value;
      if (found) {
        d.destinoId = found.id;
        d.destinoNombre = found.nombre || '';
        d.empresa = found.empresa || '';
        d.sucursal = found.sucursal || '';
        d.domicilio = found.domicilio || '';
        d.ciudad = found.ciudad || '';
        this.writeDraftToForm(form, d, ['destinoNombre', 'empresa', 'domicilio', 'ciudad']);
      } else d.destinoId = '';
      this.onDraftChange(form);
    };

    C.applyTransport = function(form, value) {
      const d = this.drafts[this.activeTab];
      const found = this.findTransport(value);
      d.transportistaNombre = value;
      if (found) {
        d.transportistaId = found.id;
        d.transportistaNombre = found.razon_social || '';
        d.transportistaRut = found.rut || '';
        this.writeDraftToForm(form, d, ['transportistaNombre']);
      } else {
        d.transportistaId = '';
        d.transportistaRut = '';
      }
      this.onDraftChange(form);
    };

    C.applyVehicle = function(form, value, type) {
      const d = this.drafts[this.activeTab];
      const key = type === 'CAMION' ? 'camionId' : 'ramplaId';
      const textKey = type === 'CAMION' ? 'patente_camion' : 'patente_rampla';
      const found = this.findVehicle(value, type);
      d[textKey] = value;
      d[key] = found?.id || '';
      if (found) {
        d[textKey] = found.patente || '';
        this.writeDraftToForm(form, d, [textKey]);
      }
      this.onDraftChange(form);
    };

    C.applyDriver = async function(form, value) {
      const d = this.drafts[this.activeTab];
      const found = this.findDriver(value);
      if (!found) {
        if (form?.querySelector('[name=chofer]') === document.activeElement) d.chofer = value;
        if (form?.querySelector('[name=rut]') === document.activeElement) d.rut = value;
        d.conductorId = '';
        this.onDraftChange(form);
        return;
      }

      d.conductorId = found.id;
      d.chofer = found.nombre || '';
      d.rut = found.rut || '';
      if (found.transportista_id) {
        const tr = this.selectedCatalog('transportistas', found.transportista_id);
        d.transportistaId = found.transportista_id;
        d.transportistaNombre = tr?.razon_social || d.transportistaNombre || '';
        d.transportistaRut = tr?.rut || '';
      }
      this.writeDraftToForm(form, d, ['chofer', 'rut', 'transportistaNombre']);
      this.onDraftChange(form);

      const token = (this._driverLookupToken || 0) + 1;
      this._driverLookupToken = token;
      try {
        const last = await AndenBackendModel.ultimoUsoConductor({ nombre: found.nombre, rut: found.rut });
        if (token !== this._driverLookupToken || !last) return;
        const truck = last.patente_camion ? this.findVehicle(last.patente_camion, 'CAMION') : null;
        const trailer = last.patente_rampla ? this.findVehicle(last.patente_rampla, 'RAMPLA') : null;
        d.patente_camion = last.patente_camion || d.patente_camion || '';
        d.patente_rampla = last.patente_rampla || d.patente_rampla || '';
        d.camionId = truck?.id || '';
        d.ramplaId = trailer?.id || '';
        this.writeDraftToForm(form, d, ['patente_camion', 'patente_rampla']);
        this.onDraftChange(form);
      } catch (_) {}
    };

    C.resolveCatalogIds = async function(draft) {
      const d = draft;
      const destFound = this.findDestination(d.destinoNombre);
      if (destFound) {
        const changed = ['empresa', 'domicilio', 'ciudad'].some(k => integration.normalize(destFound[k]) !== integration.normalize(d[k]));
        d.destinoId = changed && this.canLogistics()
          ? await AndenBackendModel.guardarDestino({ nombre: d.destinoNombre, empresa: d.empresa, sucursal: d.sucursal || destFound.sucursal, domicilio: d.domicilio, ciudad: d.ciudad })
          : destFound.id;
      } else if (String(d.destinoNombre || '').trim()) {
        if (!this.canLogistics()) throw new Error('El destino no existe en el catálogo y tu usuario no puede crearlo.');
        d.destinoId = await AndenBackendModel.guardarDestino({ nombre: d.destinoNombre, empresa: d.empresa, sucursal: d.sucursal, domicilio: d.domicilio, ciudad: d.ciudad });
      }

      const trFound = this.findTransport(d.transportistaNombre);
      if (trFound) {
        d.transportistaId = trFound.id;
        d.transportistaRut = trFound.rut || d.transportistaRut || '';
      } else if (String(d.transportistaNombre || '').trim()) {
        if (!this.canLogistics()) throw new Error('El transportista no existe en el catálogo y tu usuario no puede crearlo.');
        d.transportistaId = await AndenBackendModel.guardarTransportista({ rut: d.transportistaRut, razonSocial: d.transportistaNombre });
      }

      const driverByRut = this.catalogs.conductores.find(x => integration.normalizeRut(x.rut) && integration.normalizeRut(x.rut) === integration.normalizeRut(d.rut));
      if (driverByRut) {
        d.conductorId = driverByRut.id;
      } else if (String(d.chofer || '').trim() || String(d.rut || '').trim()) {
        if (!String(d.chofer || '').trim() || !String(d.rut || '').trim()) throw new Error('Para registrar un conductor nuevo se requieren nombre y RUT.');
        if (!this.canLogistics()) throw new Error('El conductor no existe en el catálogo y tu usuario no puede crearlo.');
        d.conductorId = await AndenBackendModel.guardarConductor({ rut: d.rut, nombre: d.chofer, transportistaId: d.transportistaId });
      }

      const truck = this.findVehicle(d.patente_camion, 'CAMION');
      if (truck) d.camionId = truck.id;
      else if (String(d.patente_camion || '').trim()) {
        if (!this.canLogistics()) throw new Error('El camión no existe en el catálogo y tu usuario no puede crearlo.');
        d.camionId = await AndenBackendModel.guardarVehiculo('CAMION', { patente: d.patente_camion, transportistaId: d.transportistaId });
      }

      const trailer = this.findVehicle(d.patente_rampla, 'RAMPLA');
      if (trailer) d.ramplaId = trailer.id;
      else if (String(d.patente_rampla || '').trim()) {
        if (!this.canLogistics()) throw new Error('La rampla no existe en el catálogo y tu usuario no puede crearla.');
        d.ramplaId = await AndenBackendModel.guardarVehiculo('RAMPLA', { patente: d.patente_rampla, transportistaId: d.transportistaId });
      }

      if (this.canLogistics()) await this.loadCatalogs();
      return d;
    };

    C.renderCurrent = function() {
      const root = document.getElementById('dockContent');
      if (!root) return;
      const c = this.current || {}, draft = this.drafts[this.activeTab] || this.emptyDraft(), pallets = c.pallets || [], summary = c.resumen || {}, head = c.cabecera || {};
      const camiones = this.catalogs.vehiculos.filter(x => x.tipo === 'CAMION');
      const ramplas = this.catalogs.vehiculos.filter(x => x.tipo === 'RAMPLA');
      const logisticsButtons = this.canLogistics() ? '<button type="button" class="btn-secondary" data-new-catalog="transportista">+ Transportista</button><button type="button" class="btn-secondary" data-new-catalog="conductor">+ Conductor</button><button type="button" class="btn-secondary" data-new-catalog="camion">+ Camión</button><button type="button" class="btn-secondary" data-new-catalog="rampla">+ Rampla</button>' : '';
      const destinationButton = this.canLogistics() ? '<button type="button" class="btn-secondary" data-new-catalog="destino">+ Nuevo destino</button>' : '';

      root.innerHTML = `<div class="dock-current-head">${this.segmented(this.activeTab, 'tab')}<div class="dock-folio"><span>Folio</span><b>${this.esc(head.referencia || 'AUTOMÁTICO')}</b></div></div>
        <form id="dockBackendForm"><div class="dock-layout"><section class="dock-card destination-card"><h3>▣ Destino de carga</h3>
          ${this.inputField('destinoNombre', 'Empresa / sucursal', draft.destinoNombre, { list: 'dockDestinationNames', placeholder: 'Escribí o seleccioná un destino…' })}
          ${this.inputField('empresa', 'Empresa', draft.empresa, { placeholder: 'Razón social' })}
          ${this.inputField('domicilio', 'Domicilio', draft.domicilio)}
          ${this.inputField('ciudad', 'Ciudad', draft.ciudad)}
          <div class="dock-actions">${destinationButton}</div><small>Al elegir un destino se completan Empresa, Domicilio y Ciudad. Los tres datos siguen siendo editables.</small></section>
          <div class="dock-side-stack"><section class="dock-card"><h3>♨ Validación de andén</h3><div class="dock-fields-row">${this.inputField('temperatura', 'Temp. (°C)', draft.temperatura, { placeholder: 'Ej: -18,0', attrs: 'inputmode="decimal"' })}</div><small>La fecha y hora se registran automáticamente en Supabase al despachar.</small></section>
          <section class="dock-summary"><span><small>Pallets</small><b>${this.fmt(summary.pallets)}</b></span><span><small>Cajas</small><b>${this.fmt(summary.cajas)}</b></span><span><small>Kilos</small><b>${this.fmt(summary.kilos)}</b></span></section></div></div>

          <section class="dock-card"><h3>🚚 Logística</h3>
            <div class="dock-fields-row">${this.inputField('transportistaNombre', 'Empresa transportista', draft.transportistaNombre, { list: 'dockTransportNames', placeholder: 'Escribí o seleccioná transportista…' })}</div>
            <div class="dock-fields-row four">${this.inputField('chofer', 'Chofer', draft.chofer, { list: 'dockDriverNames', placeholder: 'Nombre del conductor' })}${this.inputField('rut', 'RUT', draft.rut, { list: 'dockDriverRuts', placeholder: 'RUT del conductor' })}${this.inputField('patente_camion', 'Patente camión', draft.patente_camion, { list: 'dockTruckPatents', placeholder: 'Patente camión' })}${this.inputField('patente_rampla', 'Patente rampla', draft.patente_rampla, { list: 'dockTrailerPatents', placeholder: 'Patente rampla' })}</div>
            <div class="dock-actions">${logisticsButtons}</div><small>Nombre o RUT del conductor completan sus datos y recuperan el último camión/rampla usados. Todo queda editable.</small><div id="dockCatalogEditor">${this.renderCatalogEditor()}</div></section>

          <section class="dock-card pallets-card"><header><h3>▦ Pallets en Andén <small>remoto y auditado</small></h3><div class="manual-load"><input id="dockManualCode" placeholder="ID lote o código visual"><button type="button" id="dockManualAdd" ${this.canManage() ? '' : 'disabled'}>Agregar de pasillo</button></div></header><div class="load-grid">${this.palletCells(pallets, true)}</div><div class="load-key"><span><i></i>desde el mapa</span><span><i class="manual"></i>agregado de pasillo</span></div></section>
          <section class="dock-card"><h3>☷ Observaciones de carga</h3><textarea name="observaciones" rows="6" placeholder="Estado de la rampla, sellos, incidencias…">${this.esc(draft.observaciones)}</textarea><small id="dockSaveState">${c.despacho_id ? 'Cambios vinculados al catálogo se guardan en Supabase.' : 'El borrador se mantiene sólo en memoria hasta agregar el primer pallet.'}</small></section>
          <div class="dock-actions"><button type="button" class="dispatch-button" id="dockDispatch" ${this.canClose() && c.despacho_id ? '' : 'disabled'}><i class="wi wi-check wi-lg"></i><span><b>Guardar y despachar</b><small>${this.fmt(summary.pallets)} pallets · fecha/hora automática</small></span></button><span></span><button type="button" class="btn-secondary" id="dockPdf" ${c.despacho_id ? '' : 'disabled'}><i class="wi wi-pdf"></i>Packing list PDF</button><button type="button" class="btn-secondary" id="dockExcel" ${c.despacho_id ? '' : 'disabled'}><i class="wi wi-sheet"></i>Excel</button></div>
        </form>
        ${this.dataList('dockDestinationNames', this.catalogs.destinos, x => x.nombre, x => [x.empresa, x.ciudad].filter(Boolean).join(' · '))}
        ${this.dataList('dockTransportNames', this.catalogs.transportistas, x => x.razon_social, x => x.rut || '')}
        ${this.dataList('dockDriverNames', this.catalogs.conductores, x => x.nombre, x => x.rut || '')}
        ${this.dataList('dockDriverRuts', this.catalogs.conductores, x => x.rut || '', x => x.nombre || '')}
        ${this.dataList('dockTruckPatents', camiones, x => x.patente, x => this.selectedCatalog('transportistas', x.transportista_id)?.razon_social || '')}
        ${this.dataList('dockTrailerPatents', ramplas, x => x.patente, x => this.selectedCatalog('transportistas', x.transportista_id)?.razon_social || '')}
        ${this.recentLoadsHtml()}`;

      root.querySelectorAll('[data-tab]').forEach(btn => btn.onclick = () => this.changeTab(btn.dataset.tab));
      const form = document.getElementById('dockBackendForm');
      form?.querySelectorAll('[name]').forEach(input => input.oninput = () => {
        this.drafts[this.activeTab] = this.readDraft(form);
        this.draftDirty[this.activeTab] = true;
        clearTimeout(this.saveTimer);
        if (this.current?.despacho_id && ['temperatura', 'observaciones'].includes(input.name)) this.saveTimer = setTimeout(() => this.saveHeader({ silent: true }), 450);
      });
      form?.querySelector('[name=destinoNombre]')?.addEventListener('change', e => this.applyDestination(form, e.target.value));
      form?.querySelector('[name=transportistaNombre]')?.addEventListener('change', e => this.applyTransport(form, e.target.value));
      form?.querySelector('[name=chofer]')?.addEventListener('change', e => this.applyDriver(form, e.target.value));
      form?.querySelector('[name=rut]')?.addEventListener('change', e => this.applyDriver(form, e.target.value));
      form?.querySelector('[name=patente_camion]')?.addEventListener('change', e => this.applyVehicle(form, e.target.value, 'CAMION'));
      form?.querySelector('[name=patente_rampla]')?.addEventListener('change', e => this.applyVehicle(form, e.target.value, 'RAMPLA'));
      root.querySelectorAll('[data-new-catalog]').forEach(btn => btn.onclick = () => { this.catalogEditor = btn.dataset.newCatalog; this.renderCurrent(); });
      document.getElementById('dockManualAdd')?.addEventListener('click', () => this.addPallet());
      document.getElementById('dockManualCode')?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); this.addPallet(); } });
      root.querySelectorAll('.load-pallet[data-id-lote]').forEach(btn => btn.onclick = () => this.removePallet(btn.dataset.idLote));
      document.getElementById('dockDispatch')?.addEventListener('click', () => this.dispatch());
      document.getElementById('dockPdf')?.addEventListener('click', () => this.exportCurrent('pdf'));
      document.getElementById('dockExcel')?.addEventListener('click', () => this.exportCurrent('excel'));
      root.querySelectorAll('[data-recent-id]').forEach(btn => btn.onclick = async () => { this.subsection = 'historial'; this.historyType = this.activeTab; this.historyId = Number(btn.dataset.recentId); await this.loadHistoryDetail(this.historyId); this.render(); });
      document.getElementById('dockFullHistory')?.addEventListener('click', async () => { this.subsection = 'historial'; this.historyType = this.activeTab; await this.loadHistory(true); this.render(); });
      this.bindCatalogEditor();
    };

    const originalDispatch = C.dispatch.bind(C);
    C.dispatch = async function() {
      if (!this.current?.despacho_id) return this.toast('Agregá al menos un pallet antes de despachar.', 'warning');
      const draft = this.readDraft();
      if (!String(draft.destinoNombre || '').trim()) return this.toast('Seleccioná o ingresá el destino antes de cerrar la carga.', 'warning');
      try {
        await this.resolveCatalogIds(draft);
        this.drafts[this.activeTab] = draft;
        this.draftDirty[this.activeTab] = true;
        return await originalDispatch();
      } catch (error) {
        this.toast(error.message || 'No fue posible validar los datos de despacho.', 'error');
      }
    };

    C.exportCurrent = async function(format) {
      if (!this.current?.despacho_id || !(this.current.pallets || []).length) return this.toast('No hay pallets en la carga para generar el packing list.', 'warning');
      try {
        const draft = this.readDraft();
        if (String(draft.destinoNombre || '').trim()) {
          await this.resolveCatalogIds(draft);
          this.drafts[this.activeTab] = draft;
          this.draftDirty[this.activeTab] = true;
          await this.saveHeader({ silent: true });
        }
        const record = await AndenBackendModel.packing(this.current.despacho_id);
        if (!record?.pallets?.length) return this.toast('El backend no entregó pallets para el packing list.', 'warning');
        if (record?.resumen_packing?.alertas_clasificacion?.requiere_revision) this.toast('El packing contiene artículos sin clasificación o con clasificación ambigua.', 'warning');
        AndenPackingService.exportPacking(record, format);
      } catch (error) { this.toast(error.message || 'No fue posible generar el packing list.', 'error'); }
    };

    C.exportHistory = async function(id, format) {
      try {
        const record = await AndenBackendModel.packing(id);
        if (!record) return this.toast('No se encontró el despacho solicitado.', 'warning');
        AndenPackingService.exportPacking(record, format);
      } catch (error) { this.toast(error.message || 'No fue posible generar el packing list.', 'error'); }
    };

    C.exportDetail = async function(detail, format) {
      const id = detail?.cabecera?.despacho_id || this.historyId;
      return this.exportHistory(id, format);
    };

    C.readHistoryDraft = function(form) {
      const d = this.historyDetail._draft || this.draftFromHistory(this.historyDetail.cabecera || {});
      [
        'destinoNombre', 'empresa', 'domicilio', 'ciudad',
        'transportistaNombre', 'chofer', 'rut', 'patente_camion', 'patente_rampla',
        'temperatura', 'observaciones'
      ].forEach(k => { const n = form?.querySelector(`[name=${k}]`); if (n) d[k] = n.value; });
      this.historyDetail._draft = d;
      return d;
    };

    C.auditDetailText = function(entry = {}) {
      const d = entry.detalle || {};
      const lot = d.id_lote ? `Lote ${d.id_lote}` : '';
      const value = v => v === null || v === undefined || v === '' ? '—' : String(v);
      const fieldLabels = {
        destino_id: 'Destino', transportista_id: 'Transportista', conductor_id: 'Conductor',
        camion_id: 'Camión', rampla_id: 'Rampla', fecha_hora_despacho: 'Fecha/hora',
        temperatura: 'Temperatura', observaciones: 'Observaciones'
      };
      switch (entry.evento) {
        case 'CREADO':
          return [d.referencia ? `Folio ${d.referencia}` : '', d.flujo_origen ? `Flujo ${d.flujo_origen}` : ''].filter(Boolean).join(' · ');
        case 'PALLET_AGREGADO':
          return [lot, d.estado_operativo ? `Estado ${d.estado_operativo}` : '', Number.isFinite(Number(d.segmentos_origen)) ? `Origen ${Number(d.segmentos_origen)} segmento(s)` : ''].filter(Boolean).join(' · ');
        case 'PALLET_BLOQUEADO_ADMITIDO':
          return [lot, 'Despacho permitido con estado BLOQUEADO'].filter(Boolean).join(' · ');
        case 'PALLET_CARGADO':
          return lot;
        case 'PALLET_RETIRADO':
          return [lot, d.motivo ? `Motivo: ${d.motivo}` : ''].filter(Boolean).join(' · ');
        case 'PALLET_DEVUELTO_MAPA':
          return [lot, d.motivo ? `Motivo: ${d.motivo}` : '', Number.isFinite(Number(d.desplazados_total)) ? `Desplazamientos: ${Number(d.desplazados_total)}` : '', d.sin_posicion_original ? 'Sin posición original registrada' : ''].filter(Boolean).join(' · ');
        case 'REABIERTO':
          return d.motivo ? `Motivo: ${d.motivo}` : '';
        case 'DATOS_ACTUALIZADOS':
          return Object.entries(d.cambios || {}).map(([key, change]) => `${fieldLabels[key] || key}: ${value(change?.de)} → ${value(change?.a)}`).join(' · ');
        case 'CERRADO':
        case 'RECERRADO': {
          const blocked = Array.isArray(d.pallets_bloqueados) ? d.pallets_bloqueados.map(x => x?.id_lote).filter(Boolean) : [];
          return [
            Number.isFinite(Number(d.pallets)) ? `${Number(d.pallets)} pallet(s)` : '',
            Number(d.pallets_bloqueados_total || 0) > 0 ? `${Number(d.pallets_bloqueados_total)} bloqueado(s): ${blocked.join(', ') || 'identificados en backend'}` : '0 bloqueados',
            d.observacion_cierre ? `Observación: ${d.observacion_cierre}` : ''
          ].filter(Boolean).join(' · ');
        }
        default:
          return lot || '';
      }
    };

    C.auditHtml = function(items) {
      if (!items?.length) return '';
      const rows = items.slice().reverse().map(a => {
        const detail = this.auditDetailText(a);
        return `<article><header><div><span><b>${this.esc(a.evento || 'EVENTO')}</b><small>${this.esc(a.usuario || a.rol || 'Sistema')} · ${this.esc(this.dateTime(a.fecha))}</small>${detail ? `<small>${this.esc(detail)}</small>` : ''}</span></div></header></article>`;
      }).join('');
      return `<section class="dock-card"><h3>Auditoría completa del despacho</h3><div class="load-history-list">${rows}</div></section>`;
    };

    C.renderHistoryRecord = function() {
      if (this.historyMode !== 'modificar') return originalRenderHistoryRecord();
      const root = document.getElementById('dockContent'), d = this.historyDetail;
      if (!root || !d) return;
      const c = d.cabecera || {}, draft = d._draft || this.draftFromHistory(c), pallets = d.pallets || [];
      d._draft = draft;
      const camiones = this.catalogs.vehiculos.filter(x => x.tipo === 'CAMION');
      const ramplas = this.catalogs.vehiculos.filter(x => x.tipo === 'RAMPLA');

      const values = `<form id="historyEditForm"><div class="dock-layout"><section class="dock-card"><h3>▣ Destino</h3>
        ${this.inputField('destinoNombre', 'Empresa / sucursal', draft.destinoNombre, { list: 'historyDestinationNames', placeholder: 'Escribí o seleccioná un destino…' })}
        ${this.inputField('empresa', 'Empresa', draft.empresa)}${this.inputField('domicilio', 'Domicilio', draft.domicilio)}${this.inputField('ciudad', 'Ciudad', draft.ciudad)}
        </section><section class="dock-card"><h3>♨ Validación</h3>${this.inputField('temperatura', 'Temperatura', draft.temperatura, { attrs: 'inputmode="decimal"' })}<small>La fecha/hora original del despacho se conserva y no se modifica.</small></section></div>
        <section class="dock-card"><h3>🚚 Logística</h3><div class="dock-fields-row">${this.inputField('transportistaNombre', 'Empresa transportista', draft.transportistaNombre, { list: 'historyTransportNames' })}</div><div class="dock-fields-row four">${this.inputField('chofer', 'Chofer', draft.chofer, { list: 'historyDriverNames' })}${this.inputField('rut', 'RUT', draft.rut, { list: 'historyDriverRuts' })}${this.inputField('patente_camion', 'Camión', draft.patente_camion, { list: 'historyTruckPatents' })}${this.inputField('patente_rampla', 'Rampla', draft.patente_rampla, { list: 'historyTrailerPatents' })}</div></section>
        <section class="dock-card"><h3>Observaciones</h3><textarea name="observaciones" rows="5">${this.esc(draft.observaciones)}</textarea></section>
        <section class="dock-card"><h3>Agregar pallet a corrección</h3><div class="manual-load"><input id="correctionAddCode" placeholder="ID lote o código visual"><button type="button" id="correctionAddBtn">Agregar</button></div></section></form>
        ${this.dataList('historyDestinationNames', this.catalogs.destinos, x => x.nombre, x => [x.empresa, x.ciudad].filter(Boolean).join(' · '))}
        ${this.dataList('historyTransportNames', this.catalogs.transportistas, x => x.razon_social, x => x.rut || '')}
        ${this.dataList('historyDriverNames', this.catalogs.conductores, x => x.nombre, x => x.rut || '')}
        ${this.dataList('historyDriverRuts', this.catalogs.conductores, x => x.rut || '', x => x.nombre || '')}
        ${this.dataList('historyTruckPatents', camiones, x => x.patente)}${this.dataList('historyTrailerPatents', ramplas, x => x.patente)}`;

      root.innerHTML = `<button class="history-back" id="historyBack"><i class="wi wi-left"></i>Volver al historial</button><header class="history-record-heading"><i>✎</i><div><h2>Corrección · ${this.esc(c.referencia || `#${this.historyId}`)}</h2><p>${this.esc(c.estado || '—')} · despacho original ${this.esc(this.dateTime(c.fecha_hora_despacho || c.cerrado_en))}</p></div></header>${values}<section class="dock-card"><h3>Pallets (${pallets.length}) <small>tocá uno para devolverlo a su origen físico</small></h3><div class="load-grid">${this.palletCells(pallets, true)}</div></section>${this.auditHtml(d.auditoria || [])}<div class="dock-actions"><button class="btn-primary" id="historySave">Guardar corrección y cerrar</button><span></span><button class="btn-secondary" id="historyPdf"><i class="wi wi-pdf"></i>Packing list PDF</button><button class="btn-secondary" id="historyExcel"><i class="wi wi-sheet"></i>Excel</button></div>`;

      document.getElementById('historyBack').onclick = () => { this.historyId = null; this.historyDetail = null; this.historyMode = 'ver'; this.renderHistory(); };
      const form = document.getElementById('historyEditForm');
      form?.querySelectorAll('[name]').forEach(x => x.oninput = () => this.readHistoryDraft(form));
      form?.querySelector('[name=destinoNombre]')?.addEventListener('change', e => {
        const found = this.findDestination(e.target.value); const target = this.historyDetail._draft;
        target.destinoNombre = e.target.value; target.destinoId = found?.id || '';
        if (found) { target.destinoNombre = found.nombre || ''; target.empresa = found.empresa || ''; target.sucursal = found.sucursal || ''; target.domicilio = found.domicilio || ''; target.ciudad = found.ciudad || ''; this.writeDraftToForm(form, target, ['destinoNombre', 'empresa', 'domicilio', 'ciudad']); }
      });
      form?.querySelector('[name=transportistaNombre]')?.addEventListener('change', e => {
        const found = this.findTransport(e.target.value); const target = this.historyDetail._draft;
        target.transportistaNombre = e.target.value; target.transportistaId = found?.id || '';
        if (found) { target.transportistaNombre = found.razon_social || ''; target.transportistaRut = found.rut || ''; this.writeDraftToForm(form, target, ['transportistaNombre']); }
      });
      const historyDriver = async e => {
        const found = this.findDriver(e.target.value), target = this.historyDetail._draft;
        if (!found) { target.conductorId = ''; return; }
        target.conductorId = found.id; target.chofer = found.nombre || ''; target.rut = found.rut || '';
        const tr = this.selectedCatalog('transportistas', found.transportista_id); if (tr) { target.transportistaId = tr.id; target.transportistaNombre = tr.razon_social || ''; target.transportistaRut = tr.rut || ''; }
        this.writeDraftToForm(form, target, ['chofer', 'rut', 'transportistaNombre']);
        try { const last = await AndenBackendModel.ultimoUsoConductor({ nombre: found.nombre, rut: found.rut }); if (last) { target.patente_camion = last.patente_camion || target.patente_camion || ''; target.patente_rampla = last.patente_rampla || target.patente_rampla || ''; target.camionId = this.findVehicle(target.patente_camion, 'CAMION')?.id || ''; target.ramplaId = this.findVehicle(target.patente_rampla, 'RAMPLA')?.id || ''; this.writeDraftToForm(form, target, ['patente_camion', 'patente_rampla']); } } catch (_) {}
      };
      form?.querySelector('[name=chofer]')?.addEventListener('change', historyDriver);
      form?.querySelector('[name=rut]')?.addEventListener('change', historyDriver);
      form?.querySelector('[name=patente_camion]')?.addEventListener('change', e => { const t = this.historyDetail._draft, v = this.findVehicle(e.target.value, 'CAMION'); t.patente_camion = e.target.value; t.camionId = v?.id || ''; });
      form?.querySelector('[name=patente_rampla]')?.addEventListener('change', e => { const t = this.historyDetail._draft, v = this.findVehicle(e.target.value, 'RAMPLA'); t.patente_rampla = e.target.value; t.ramplaId = v?.id || ''; });
      document.getElementById('correctionAddBtn').onclick = () => this.addCorrectionPallet();
      document.getElementById('correctionAddCode').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); this.addCorrectionPallet(); } };
      root.querySelectorAll('.load-pallet[data-id-lote]').forEach(btn => btn.onclick = () => this.returnCorrectionPallet(btn.dataset.idLote));
      document.getElementById('historySave').onclick = () => this.saveCorrection();
      document.getElementById('historyPdf').onclick = () => this.exportDetail(d, 'pdf');
      document.getElementById('historyExcel').onclick = () => this.exportDetail(d, 'excel');
    };

    C.saveCorrection = async function() {
      const form = document.getElementById('historyEditForm');
      if (form) this.readHistoryDraft(form);
      try {
        await this.resolveCatalogIds(this.historyDetail._draft);
        return await originalSaveCorrection();
      } catch (error) {
        this.toast(error.message || 'No fue posible validar los datos de la corrección.', 'error');
      }
    };

    C.populateRecentLoads = async function() {
      const root = document.getElementById('dockRecentLoads');
      if (!root) return;
      const tab = this.activeTab;
      root.innerHTML = '<p class="empty-message">Cargando despachos recientes…</p>';
      const rows = await this.recentLoads();
      if (tab !== this.activeTab || root !== document.getElementById('dockRecentLoads')) return;
      if (!rows.length) {
        root.innerHTML = '<p class="empty-message">Todavía no hay despachos cerrados en esta pestaña.</p>';
        return;
      }
      root.innerHTML = rows.map(c => `<div><b>${this.esc(c.folio || `#${c.despacho_id}`)}</b><span>${this.esc(c.empresa || c.destino || '—')}</span><time>${this.esc(this.dateTime(c.fecha_hora))}</time><small>${this.fmt(c.pallets)} plt · ${this.fmt(c.cajas)} cajas</small><button data-recent-backend-id="${this.esc(c.despacho_id)}">Ver</button></div>`).join('');
      root.querySelectorAll('[data-recent-backend-id]').forEach(btn => btn.onclick = async () => {
        this.subsection = 'historial';
        this.historyType = tab;
        this.historyId = Number(btn.dataset.recentBackendId);
        await this.loadHistoryDetail(this.historyId);
        this.historyMode = 'ver';
        this.render();
      });
    };

    const renderCurrentWithRecentLoads = C.renderCurrent.bind(C);
    C.renderCurrent = function() {
      renderCurrentWithRecentLoads();
      this.populateRecentLoads();
    };
  }
};
