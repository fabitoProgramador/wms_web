/** Andén de Carga: dos cargas independientes, packing list e historial editable. */
const AndenController = {
  activeTab: 'embarque',
  subsection: 'en_curso',
  historyType: 'embarque',
  historySearch: '',
  historyDate: '',
  historyFolio: null,
  historyMode: null,
  container: null,
  offlineBound: false,

  esc(v) { return MapaController.esc(v); },
  dateTimeHint() { const d = new Date(), pad = value => String(value).padStart(2, '0'); return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; },
  async init(containerElement) { this.container = containerElement;containerElement.innerHTML='<section class="map-offline-loading"><span>Preparando Andén offline…</span></section>';const availability=await MapaOfflineService.initialize();if(!availability.ok){containerElement.innerHTML='<section class="map-offline-empty"><b>Conexión inicial requerida</b><p>No existe información local del mapa para operar el Andén.</p></section>';return;} if(!this.offlineBound){this.offlineBound=true;window.addEventListener('wms-map-offline-status',()=>this.renderOfflineStatus());} this.render(); },
  render() {
    if (!this.container) return;
    this.container.innerHTML = `<section class="map-submodule dock-module">${DashboardController.operationalHeader({ eyebrow:'MAPA · ANDÉN', title:'Andén de Carga', status:'Preparación, despacho y trazabilidad de cargas Proter y Post Túnel' })}<div id="dockOfflineStatus" class="map-offline-status compact" aria-live="polite"></div><div class="dock-top-tabs"><button data-sub="en_curso" class="${this.subsection === 'en_curso' ? 'active' : ''}"><i class="wi wi-truck"></i>Andén en curso</button><button data-sub="historial" class="${this.subsection === 'historial' ? 'active' : ''}"><i class="wi wi-history"></i>Historial</button></div><div id="dockContent"></div></section>`;
    this.container.querySelectorAll('[data-sub]').forEach(b => b.onclick = () => { this.subsection = b.dataset.sub; if (this.subsection !== 'historial') { this.historyFolio = null; this.historyMode = null; } this.render(); });
    DashboardController.startOperationalClock();
    this.renderOfflineStatus(); if (this.subsection === 'historial') this.renderHistory(); else this.renderCurrent();
  },

  async renderOfflineStatus(){const root=document.getElementById('dockOfflineStatus');if(!root)return;const s=await MapaOfflineService.status(),stamp=s.snapshot?.timestamp?new Date(s.snapshot.timestamp).toLocaleString('es-CL'):'sin copia local';root.innerHTML=`<span class="map-connectivity ${s.online?'online':'offline'}">${s.online?'● En línea':'● Sin conexión'}</span><span>${s.syncing?'Sincronizando…':s.pending?`${s.pending} pendiente${s.pending===1?'':'s'}`:'Datos sincronizados'}</span>${s.conflicts?`<span class="has-conflict">${s.conflicts} conflicto${s.conflicts===1?'':'s'}</span>`:''}<small>Última copia: ${this.esc(stamp)}</small>`;},

  segmented(active, prefix = 'dock') {
    return `<div class="segmented dock-segmented"><button data-${prefix}="embarque" class="${active === 'embarque' ? 'active' : ''}"><i class="wi wi-anchor"></i>Embarque · Proter</button><button data-${prefix}="postunel" class="${active === 'postunel' ? 'active' : ''}"><i class="wi wi-snow"></i>Post Túnel</button></div>`;
  },

  field(key, label, value, attrs = '') { return `<label class="dock-field"><span>${label}</span><input name="${key}" value="${this.esc(value)}" ${attrs}></label>`; },
  destinationPicker(data, directories) {
    const selected = directories.destinos.find(item => ['empresa','domicilio','ciudad'].every(key => String(item[key] || '').trim().toLowerCase() === String(data[key] || '').trim().toLowerCase()));
    return `<label class="dock-field destination-picker"><span>Empresa / sucursal</span><input id="dockDestinationPicker" list="destinationNames" value="${this.esc(selected?.nombre || '')}" placeholder="Seleccionar destino…" autocomplete="off"><small>Seleccioná una opción para completar los datos.</small></label>`;
  },
  renderCurrent() {
    const root = document.getElementById('dockContent'), state = MapaModel.getState(), data = state.forms[this.activeTab], pallets = MapaModel.palletsCarga(this.activeTab), cajas = pallets.reduce((s, p) => s + (Number(p.cajas) || 0), 0), dirs = MapaModel.getDirectories();
    root.innerHTML = `<div class="dock-current-head">${this.segmented(this.activeTab, 'tab')}<div class="dock-folio"><span>Folio</span><b>${MapaModel.folioPrevisto(this.activeTab)}</b></div></div>
      <form id="dockForm"><div class="dock-layout"><section class="dock-card destination-card"><h3>▣ Destino de carga</h3>${this.destinationPicker(data, dirs)}${this.field('empresa','Empresa',data.empresa,'placeholder="Razón social"')}${this.field('domicilio','Domicilio',data.domicilio)}${this.field('ciudad','Ciudad',data.ciudad)}<small>Los datos autocompletados quedan editables. Un destino nuevo se guarda al despachar.</small></section><div class="dock-side-stack"><section class="dock-card"><h3>♨ Validación de andén</h3><div class="dock-fields-row">${this.field('fecha_hora','Fecha y hora',data.fecha_hora,`placeholder="${this.dateTimeHint()}"`)}${this.field('temperatura','Temp. (°C)',data.temperatura,'placeholder="16,5"')}</div></section><section class="dock-summary"><span><small>Pallets</small><b>${pallets.length}</b></span><span><small>Cajas</small><b>${cajas.toLocaleString('es-CL')}</b></span></section></div></div>
      <section class="dock-card"><h3>🚚 Logística</h3><div class="dock-fields-row four">${this.field('chofer','Chofer',data.chofer,'list="driverNames" autocomplete="off"')}${this.field('rut','RUT',data.rut,'list="driverRuts" autocomplete="off"')}${this.field('patente_camion','Patente camión',data.patente_camion)}${this.field('patente_rampla','Patente rampla',data.patente_rampla)}</div><small>Nombre o RUT autocompletan el resto; todo queda editable.</small></section>
      <section class="dock-card pallets-card"><header><h3>▦ Pallets cargados <small>en vivo desde el mapa</small></h3><div class="manual-load"><input id="dockManualCode" placeholder="Ej: B47"><button type="button" id="dockManualAdd">Agregar de pasillo</button></div></header><div class="load-grid">${this.palletCells(pallets, true)}</div><div class="load-key"><span><i></i>desde el mapa</span><span><i class="manual"></i>agregado de pasillo</span></div></section>
      <section class="dock-card"><h3>☷ Observaciones de descarga</h3><textarea name="observaciones" rows="6" placeholder="Estado de la rampla, sellos, incidencias…">${this.esc(data.observaciones)}</textarea></section>
      <div class="dock-actions"><button type="button" class="dispatch-button" id="dockDispatch"><i class="wi wi-check  wi-lg"></i><span><b>Guardar y despachar</b><small>${pallets.length} pallets saldrán del mapa</small></span></button><span></span><button type="button" class="btn-secondary" id="dockPdf"><i class="wi wi-pdf"></i>Packing list PDF</button><button type="button" class="btn-secondary" id="dockExcel"><i class="wi wi-sheet"></i>Excel</button></div></form>
      <datalist id="destinationNames">${dirs.destinos.map(d => `<option value="${this.esc(d.nombre)}">${this.esc(`${d.empresa} · ${d.ciudad}`)}</option>`).join('')}</datalist><datalist id="driverNames">${dirs.choferes.map(d => `<option value="${this.esc(d.nombre)}">${this.esc(`${d.rut} · ${d.patente_camion}`)}</option>`).join('')}</datalist><datalist id="driverRuts">${dirs.choferes.map(d => `<option value="${this.esc(d.rut)}">${this.esc(`${d.nombre} · ${d.patente_camion}`)}</option>`).join('')}</datalist>${this.recentLoads()}`;
    root.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { this.activeTab = b.dataset.tab; this.renderCurrent(); });
    root.querySelectorAll('#dockForm [name]').forEach(input => input.oninput = () => this.persistForm());
    document.getElementById('dockDestinationPicker').oninput = e => this.autocompleteDestination(root, dirs, e.target.value);
    ['chofer','rut'].forEach(key => root.querySelector(`[name=${key}]`).oninput = e => { this.persistForm(); this.autocompleteDriver(root, dirs, e.target.value); });
    const manual = () => { const i = document.getElementById('dockManualCode'), pallet = MapaModel.buscarPalletGlobalPorCodigo(i.value.trim()),origin=MapaController.positionOf(pallet); if (pallet?.banda !== null && pallet?.banda !== undefined) UndoService.guardarSnapshot(pallet.ubicacion, MapaModel.getPallets()); const r = MapaModel.agregarCodigoACarga(this.activeTab, i.value.trim()); if (!r.ok) return MapaController.toast(r.error, 'error');MapaController.recordMovement('AGREGAR_CARGA',pallet,origin,MapaController.positionOf(pallet),{loadTab:this.activeTab}); this.renderCurrentPreservingScroll('dockManualCode'); };
    document.getElementById('dockManualAdd').onclick = manual; document.getElementById('dockManualCode').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); manual(); } };
    root.querySelectorAll('.load-pallet').forEach(b => b.onclick = () => {const pallet=MapaModel.getPallets().find(p=>p.id===b.dataset.id),origin=MapaController.positionOf(pallet); const r = MapaModel.quitarDeCarga(this.activeTab, b.dataset.id);if(r.ok)MapaController.recordMovement('QUITAR_CARGA',pallet,origin,MapaController.positionOf(pallet),{loadTab:this.activeTab}); this.renderCurrentPreservingScroll(); if (r.aviso) MapaController.toast(r.aviso); });
    document.getElementById('dockDispatch').onclick = () => this.dispatch(); document.getElementById('dockExcel').onclick = () => this.exportCurrent('excel'); document.getElementById('dockPdf').onclick = () => this.exportCurrent('pdf');
    root.querySelectorAll('[data-recent]').forEach(b => b.onclick = () => { this.historyType = this.activeTab; this.subsection = 'historial'; this.historyFolio = b.dataset.recent; this.historyMode = 'ver'; this.render(); });
    document.getElementById('dockFullHistory')?.addEventListener('click', () => { this.historyType = this.activeTab; this.subsection = 'historial'; this.historyFolio = null; this.historyMode = null; this.render(); });
  },

  persistForm() {
    const state = MapaModel.getState(), form = document.getElementById('dockForm'); if (!form) return;
    form.querySelectorAll('[name]').forEach(i => state.forms[this.activeTab][i.name] = i.value); MapaModel.saveState(state);MapaOfflineService.scheduleSnapshot('local-anden');
  },

  renderCurrentPreservingScroll(focusId = '') {
    const viewport = document.getElementById('mainViewport'), top = viewport?.scrollTop || 0; this.renderCurrent();
    requestAnimationFrame(() => { if (viewport) viewport.scrollTop = top; if (focusId) document.getElementById(focusId)?.focus(); });
  },

  autocompleteDestination(root, directories, value) {
    const normalize = text => String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[–—-]+/g, ' ').replace(/\s+/g, ' ').trim().toLocaleLowerCase('es-CL');
    const query = normalize(value); if (!query) return;
    const found = directories.destinos.find(item => normalize(item.nombre) === query); if (!found) return;
    ['empresa','domicilio','ciudad'].forEach(key => { const input = root.querySelector(`[name=${key}]`); if (input) input.value = found[key] || ''; }); this.persistForm();
  },

  autocompleteDriver(root, directories, value) {
    const query = String(value || '').trim().toLowerCase(), rutQuery = query.replaceAll('.', ''); if (query.length < 3) return;
    const found = directories.choferes.find(item => item.nombre.toLowerCase().startsWith(query) || item.rut.replaceAll('.', '').toLowerCase().startsWith(rutQuery)); if (!found) return;
    const values = { chofer: found.nombre, rut: found.rut, patente_camion: found.patente_camion, patente_rampla: found.patente_rampla };
    Object.entries(values).forEach(([key, source]) => { const input = root.querySelector(`[name=${key}]`); if (input && !input.value.trim()) input.value = source || ''; }); this.persistForm();
  },

  palletCells(pallets, removable = false) {
    if (!pallets.length) return '<p class="empty-message">La carga está vacía. Agregá pallets desde el mapa o digitá los de pasillo.</p>';
    return pallets.map(p => `<button type="button" class="load-pallet ${p._manual_pasillo ? 'manual' : ''}" data-id="${this.esc(p.id)}" ${removable ? 'title="Tocar para quitar"' : 'disabled'}><strong>${this.esc(PalletModel.codigoVisual(p))}</strong><small>${this.esc(p.articulo)}</small><span class="load-origin">${p._manual_pasillo ? 'Pasillo' : 'Mapa'}</span><i style="--state:${COLORES_MAPA_ESTADO[p.estado] || '#64748B'}">${ABREVIATURAS_ESTADO_MAPA[p.estado] || '—'}</i></button>`).join('');
  },

  dispatch() {
    this.persistForm(); const data = MapaModel.getState().forms[this.activeTab],before=MapaModel.palletsCarga(this.activeTab).map(p=>({p,origin:MapaController.positionOf(p)})), result = MapaModel.guardarCarga(this.activeTab, data);
    if (!result.ok) return MapaController.toast(result.error, 'error');before.forEach(x=>MapaController.recordMovement('DESPACHAR',x.p,x.origin,null,{loadTab:this.activeTab,folio:result.folio})); MapaController.toast(`Carga ${result.folio} guardada localmente: ${result.cantidad} pallets${navigator.onLine?'.':' · pendiente de sincronización.'}`); this.renderCurrent();
  },

  recentLoads() {
    const loads = MapaModel.getLoads().filter(c => c.pestana === this.activeTab).slice(0, 5);
    return `<section class="recent-loads"><header><h3>CARGAS RECIENTES</h3><button id="dockFullHistory">Ver historial completo<i class="wi wi-right"></i></button></header>${loads.map(c => `<div><b>${this.esc(c.folio)}</b><span>${this.esc(c.datos.empresa || '—')}</span><time>${this.esc(c.guardada_en)}</time><small>${c.pallets.length} plt</small><button data-recent="${this.esc(c.folio)}">Ver</button></div>`).join('') || '<p class="empty-message">Todavía no hay cargas despachadas en esta pestaña.</p>'}</section>`;
  },

  exportCurrent(format) {
    this.persistForm(); const pallets = MapaModel.palletsCarga(this.activeTab); if (!pallets.length) return MapaController.toast('No hay pallets para generar el packing list.', 'error');
    const record = { folio: MapaModel.folioPrevisto(this.activeTab), pestana: this.activeTab, guardada_en: new Date().toLocaleString('es-CL'), datos: MapaModel.getState().forms[this.activeTab], pallets: pallets.map(p => ({ ...p, codigo: PalletModel.codigoVisual(p), _snapshot: p })) };
    this.exportPacking(record, format);
  },

  packingInfo(record) {
    const d = record.datos || {}, rawTemperature = String(d.temperatura || '').trim();
    return {
      folio: record.folio,
      frigorifico: 'FRIGORÍFICO OLMUÉ',
      planta: 'Planta Parral',
      cliente: d.empresa || '—',
      sede: [d.domicilio, d.ciudad].filter(Boolean).join(', ') || '—',
      fecha: d.fecha_hora || record.guardada_en || '—',
      temperatura: rawTemperature ? (rawTemperature.includes('°') ? rawTemperature : `${rawTemperature} °C`) : '—',
      chofer: d.chofer || '—',
      rut: d.rut || '—',
      camion: d.patente_camion || '—',
      rampla: d.patente_rampla || '—',
      observaciones: d.observaciones || 'Sin observaciones.'
    };
  },

  packingModel(record) {
    const blockedStates = new Set(['BLOQUEADOS', 'RECHAZO', 'PROHIBICIONES', 'REPROCESO']);
    const items = (record.pallets || []).map((entry, index) => {
      const pallet = entry._snapshot || entry, blocked = blockedStates.has(String(pallet.estado || '').toUpperCase());
      const general = [pallet.detalle_calidad, pallet.info_general].filter(Boolean).join(' ').trim();
      return {
        numero: index + 1,
        id: PalletModel.idLoteReal(pallet),
        sku: PalletModel.numeroArticulo(pallet),
        descripcion: PalletModel.descripcion(pallet),
        kilos: Number(PalletModel.kilos(pallet)) || 0,
        cajas: Number(pallet.cajas) || 0,
        fecha: pallet.fecha_fabricacion || '—',
        calidad: blocked ? 'BLOQUEADO' : 'LIBERADO',
        infoCalidad: pallet.info_calidad || (blocked ? 'Verificación por DF' : ''),
        infoGeneral: general,
        dm: pallet.dm || 'Sí',
        reserva: blocked ? 'Bloqueado' : 'Libre',
        organico: Boolean(CATALOGO_ARTICULOS[pallet.articulo]?.esOrganico)
      };
    });
    const groups = { CONVENCIONAL: new Map(), 'ORGÁNICO': new Map() };
    items.forEach(item => {
      const origin = item.organico ? 'ORGÁNICO' : 'CONVENCIONAL', bySku = groups[origin];
      if (!bySku.has(item.sku)) bySku.set(item.sku, { descripcion: item.descripcion, items: [], kilos: 0, cajas: 0 });
      const group = bySku.get(item.sku); group.items.push(item); group.kilos += item.kilos; group.cajas += item.cajas;
    });
    return {
      info: this.packingInfo(record),
      headers: ['N°', 'ID LOTE', 'N° ARTÍCULO', 'DESCRIPCIÓN DEL ARTÍCULO', 'KG (NETO)', 'CAJAS', 'FECHA FABRICACIÓN', 'EST CALIDAD', 'INFO. CALIDAD', 'INFO. GENERAL', 'DM', 'RESERVA'],
      items,
      groups,
      totals: { pallets: items.length, kilos: items.reduce((sum, item) => sum + item.kilos, 0), cajas: items.reduce((sum, item) => sum + item.cajas, 0) }
    };
  },
  exportPacking(record, format) { return this.exportPackingFiel(record, format); },

  packingXlsxDocument(record){
    const model=this.packingModel(record),{info,groups,totals}=model,rows=[],merge=[],heights={1:35,2:20,11:26};const addMerged=(value,style,from,to)=>{const row=rows.length+1,arr=Array(12).fill('');arr[from-1]={v:value,s:style};rows.push(arr);merge.push(`${ExportService.columnaExcel(from-1)}${row}:${ExportService.columnaExcel(to-1)}${row}`);return row;};
    let r=Array(12).fill('');r[2]={v:info.frigorifico,s:'title'};r[6]={v:info.planta,s:'released'};r[9]={v:`FOLIO ${info.folio}`,s:'meta'};rows.push(r);merge.push('C1:F1','G1:I1','J1:L1');r=Array(12).fill('');r[2]={v:'Packing List de Despacho',s:'subtitle'};r[9]={v:'PACKING LIST',s:'sku'};rows.push(r);merge.push('C2:I2','J2:L2');rows.push([]);
    r=Array(12).fill('');r[0]={v:'DESTINO DE CARGA',s:'metaTitle'};r[4]={v:'VALIDACIÓN ANDÉN',s:'metaTitle'};r[8]={v:'LOGÍSTICA (NARIZ)',s:'metaTitle'};rows.push(r);merge.push('A4:D4','E4:H4','I4:L4');r=Array(12).fill('');r[0]={v:`${info.cliente}\n${info.sede}`,s:'meta'};r[4]={v:`Fecha: ${info.fecha}\nTemp. Despacho: ${info.temperatura}`,s:'meta'};r[8]={v:`Camión: ${info.camion} | Rampla: ${info.rampla}\nChofer: ${info.chofer} (${info.rut})`,s:'meta'};rows.push(r);rows.push(Array(12).fill(''));merge.push('A5:D6','E5:H6','I5:L6');rows.push([]);r=Array(12).fill('');r[0]={v:`OBSERVACIONES DE CONTROL OPERATIVO:\n${info.observaciones}`,s:'observation'};rows.push(r);rows.push(Array(12).fill(''));merge.push('A8:L9');rows.push([]);
    rows.push(model.headers.map((v,index)=>({v,s:[3,8,9].includes(index)?'packHeaderLeft':'header'})));
    let index=1;Object.entries(groups).forEach(([origin,bySku])=>{if(!bySku.size)return;addMerged(`CLASIFICACIÓN DE ORIGEN: ${origin}`,origin==='ORGÁNICO'?'originOrganic':'origin',1,12);bySku.forEach((group,sku)=>{addMerged(`SKU ${sku} — ${group.descripcion}`,origin==='ORGÁNICO'?'skuOrganic':'sku',1,12);group.items.forEach(x=>{rows.push([{v:String(index++).padStart(2,'0'),s:'packIndex'},{v:x.id,s:'packLot'},{v:x.sku,s:'packArticle'},{v:x.descripcion,s:'packDescription'},{v:x.kilos,s:'packKg'},{v:x.cajas,s:'packBoxes'},{v:x.fecha,s:'packDate'},{v:x.calidad,s:x.calidad==='BLOQUEADO'?'blocked':'released'},{v:x.infoCalidad,s:'packInfo'},{v:x.infoGeneral,s:'packGeneral'},{v:x.dm,s:'packDm'},{v:x.reserva,s:'packReserve'}]);heights[rows.length]=25;});r=Array(12).fill('');r[0]={v:`TOTAL SKU ${sku} → ${group.items.length} PLT`,s:'subtotal'};r[4]={v:group.kilos,s:'subtotal'};r[5]={v:group.cajas,s:'subtotal'};rows.push(r);heights[rows.length]=18;merge.push(`A${rows.length}:D${rows.length}`);});});
    r=Array(12).fill('');r[0]={v:`TOTAL CONSOLIDADO GENERAL DE LA CARGA: ${totals.pallets} PALLETS TOT.`,s:'grand'};r[4]={v:totals.kilos,s:'grand'};r[5]={v:totals.cajas,s:'grand'};rows.push(r);heights[rows.length]=22;merge.push(`A${rows.length}:D${rows.length}`);rows.push([],[],[],[]);r=Array(12).fill('');r[0]={v:'Supervisor de Frigorífico',s:'signature'};r[4]={v:'Conductor Transportista',s:'signature'};r[9]={v:'Recepción Conforme Cliente',s:'signature'};rows.push(r);merge.push(`A${rows.length}:C${rows.length}`,`E${rows.length}:H${rows.length}`,`J${rows.length}:L${rows.length}`);
    return{nombreHoja:'Packing List',filas:rows,combinar:merge,anchos:[5,16,13,24,14,9,16,14,20,26,6,11],altos:heights,congelar:{y:11,celda:'A12'},papelLegal:true,horizontal:true,grilla:false,ajustarAlto:rows.length<=56?2:0,areaImpresion:`A1:L${rows.length}`,repetirFilas:'11:11',centrarHorizontal:true,margenes:{left:.3,right:.3,top:.4,bottom:.4,header:.2,footer:.2}};
  },

  packingPdfText(value){return this.esc(value||'').replace(/([^\s]{18})/g,'$1<wbr>');},
  packingPdfHtml(record){
    const model=this.packingModel(record),{info,groups,totals}=model;let index=1;
    const body=Object.entries(groups).map(([origin,bySku])=>{if(!bySku.size)return'';const skus=[...bySku.entries()].map(([sku,group])=>{const detail=group.items.map(x=>`<tr class="detail"><td class="center muted">${String(index++).padStart(2,'0')}</td><td class="center lot">${this.packingPdfText(x.id)}</td><td class="center">${this.packingPdfText(x.sku)}</td><td>${this.packingPdfText(x.descripcion)}</td><td class="right kg">${x.kilos.toLocaleString('es-CL',{minimumFractionDigits:1})}</td><td class="center">${x.cajas.toLocaleString('es-CL')}</td><td class="center">${this.esc(x.fecha)}</td><td class="center"><b class="quality ${x.calidad==='BLOQUEADO'?'blocked':'released'}">${x.calidad}</b></td><td><span class="clamp">${this.packingPdfText(x.infoCalidad)}</span></td><td><span class="clamp">${this.packingPdfText(x.infoGeneral)}</span></td><td class="center">${this.esc(x.dm)}</td><td class="center muted">${this.esc(x.reserva)}</td></tr>`).join('');return`<tr class="sku ${origin==='ORGÁNICO'?'organic':''}"><td colspan="12">SKU ${this.esc(sku)} — ${this.esc(group.descripcion)}</td></tr>${detail}<tr class="subtotal"><td colspan="4" class="right">TOTAL SKU ${this.esc(sku)} → ${group.items.length} PLT</td><td class="right">${group.kilos.toLocaleString('es-CL',{minimumFractionDigits:1})}</td><td class="center">${group.cajas.toLocaleString('es-CL')}</td><td colspan="6"></td></tr>`;}).join('');return`<tr class="origin ${origin==='ORGÁNICO'?'organic':''}"><td colspan="12">CLASIFICACIÓN DE ORIGEN: ${origin}</td></tr>${skus}`;}).join('');
    const base=location.origin+location.pathname.replace(/[^/]+$/,'');
    return `<!doctype html><html><head><meta charset="utf-8"><title>Packing List ${this.esc(info.folio)}</title><style>@page{size:legal portrait;margin:10mm}*{box-sizing:border-box}body{margin:0;font:8.5pt 'Segoe UI',Arial,sans-serif;color:#2d3748}.head{display:table;width:100%;padding-bottom:10px;margin-bottom:12px;border-bottom:2px solid #edf2f7}.head-left,.head-right{display:table-cell;vertical-align:middle}.head-left{width:68%}.head-right{width:32%;text-align:right}.logo{float:left;width:145px;height:70px;object-fit:contain;margin-right:18px}.title{padding-top:8px;color:#2b6cb0;font-size:16pt;font-weight:800;white-space:nowrap}.plant{margin-left:6px;color:#10b981;font-size:10pt}.subtitle{color:#718096;font-size:9pt}.folio,.badge{display:inline-block;padding:4px 12px;border-radius:14px;font-weight:700}.folio{background:#edf2f7;color:#4a5568}.badge{margin-top:6px;background:#ebf8ff;color:#2b6cb0}.cards{display:table;width:100%;margin:0 0 12px;border-spacing:8px 0}.card{display:table-cell;width:33.33%;padding:10px;border:1px solid #e2e8f0;border-radius:8px;background:#f7fafc;vertical-align:top}.card small{display:block;margin-bottom:4px;color:#a0aec0;font-weight:700}.obs{margin-bottom:15px;padding:8px 12px;border:1px solid #feebc8;border-left:4px solid #dd6b20;border-radius:6px;background:#fffaf0;color:#7b341e}.obs b{display:block;color:#c05621;font-size:7.5pt}table{width:100%;border-collapse:collapse;table-layout:auto;margin-bottom:15px}thead{display:table-header-group}tr{break-inside:avoid;page-break-inside:avoid}th{padding:7px 4px;background:#2b6cb0;color:#fff;font-size:7.4pt;text-align:left;overflow-wrap:anywhere}td{padding:5px 5px;border-bottom:1px solid #edf2f7;vertical-align:middle;overflow-wrap:anywhere}.center{text-align:center}.right{text-align:right}.muted{color:#718096}.lot{color:#2b6cb0;font-family:Consolas,monospace;font-weight:700}.kg{color:#2b6cb0;font-weight:700}.origin td{padding:7px;background:#2d3748;color:#fff;font-size:9pt;font-weight:700}.origin.organic td{background:#276749}.sku td{border-left:4px solid #3182ce;background:#ebf8ff;color:#2b6cb0;font-weight:700}.sku.organic td{border-color:#38a169;background:#f0fff4;color:#276749}.detail td{height:40px}.quality{padding:2px 5px;border-radius:4px;font-size:7pt}.quality.blocked{background:#feebc8;color:#c05621}.quality.released{background:#c6f6d5;color:#22543d}.clamp{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;line-height:1.25}.subtotal td{border-block:1px solid #cbd5e0;background:#f7fafc;font-weight:800}.grand td{padding:9px 6px;background:#2b6cb0;color:#fff;font-size:9.5pt;font-weight:700}.signatures{display:table;width:100%;margin-top:55px}.signatures span{display:table-cell;width:33.33%;padding:6px 15px 0;border-top:1px solid #cbd5e0;text-align:center;color:#718096;font-weight:600}</style></head><body><header class="head"><div class="head-left"><img class="logo" src="${base}assets/logo.png"><div class="title">${info.frigorifico}<span class="plant">${info.planta}</span></div><div class="subtitle">Packing List de Despacho</div></div><div class="head-right"><div class="folio">FOLIO ${this.esc(info.folio)}</div><br><div class="badge">PACKING LIST</div></div></header><section class="cards"><div class="card"><small>DESTINO DE CARGA</small><b>${this.esc(info.cliente)}</b><br>${this.esc(info.sede)}</div><div class="card"><small>VALIDACIÓN ANDÉN</small><b>Fecha:</b> ${this.esc(info.fecha)}<br><b>Temperatura Despacho:</b> ${this.esc(info.temperatura)}</div><div class="card"><small>LOGÍSTICA (NARIZ)</small><b>Patente Camión:</b> ${this.esc(info.camion)}<br><b>Patente Rampla:</b> ${this.esc(info.rampla)}<br><b>Chofer:</b> ${this.esc(info.chofer)} (${this.esc(info.rut)})</div></section><section class="obs"><b>OBSERVACIONES DE CONTROL OPERATIVO</b>${this.esc(info.observaciones)}</section><table><colgroup>${[3,11,8,14,8,6,10,8,10,13,4,5].map(width=>`<col style="width:${width}%">`).join('')}</colgroup><thead><tr>${model.headers.map(x=>`<th>${x}</th>`).join('')}</tr></thead><tbody>${body}<tr class="grand"><td colspan="4" class="right">TOTAL CONSOLIDADO GENERAL DE LA CARGA: ${totals.pallets} PALLETS TOT.</td><td class="right">${totals.kilos.toLocaleString('es-CL',{minimumFractionDigits:1})} kg</td><td class="center">${totals.cajas.toLocaleString('es-CL')}</td><td colspan="6"></td></tr></tbody></table><footer class="signatures"><span>Supervisor de Frigorífico</span><span>Conductor Transportista</span><span>Recepción Conforme Cliente</span></footer></body></html>`;
  },
  async exportPackingFiel(record,format){
    if(!record)return MapaController.toast('No se encontró la carga solicitada.','error');
    if(!record.pallets?.length)return MapaController.toast('No hay pallets para generar el packing list.','error');
    if(format==='excel'){const doc=this.packingXlsxDocument(record);try{const response=await fetch('assets/logo.png');if(response.ok)doc.logoBytes=new Uint8Array(await response.arrayBuffer());}catch(_error){}ExportService.descargarXlsxDocumento(`PackingList_${record.folio}.xlsx`,doc);return MapaController.toast(`Excel ${record.folio} generado con formato operativo.`);}
    const win=window.open('','_blank');if(!win)return MapaController.toast('El navegador bloqueó la ventana del PDF.','error');win.opener=null;win.document.write(`${this.packingPdfHtml(record)}<script>window.addEventListener('load',()=>setTimeout(()=>window.print(),400))<\/script>`);win.document.close();
  },

  renderHistory() {
    if (this.historyFolio) return this.renderHistoryRecord();
    const root = document.getElementById('dockContent'), loads = MapaModel.getLoads().filter(c => c.pestana === this.historyType).filter(c => !this.historyDate || c.guardada_en.includes(this.historyDate)).filter(c => { const q = this.historySearch.toLowerCase(); return !q || [c.folio,c.datos.empresa,c.datos.patente_camion,c.datos.patente_rampla,c.datos.chofer].some(x => String(x || '').toLowerCase().includes(q)); });
    root.innerHTML = `<div class="history-toolbar">${this.segmented(this.historyType, 'history')}<label>🔍<input id="historySearch" value="${this.esc(this.historySearch)}" placeholder="Folio, empresa o patente"></label><input id="historyDate" value="${this.esc(this.historyDate)}" placeholder="Fecha (dd/mm)"></div><div class="load-history-list">${loads.map(c => `<article><header><div><i>🚚</i><span><b>${this.esc(c.folio)}</b><small>${this.esc(c.datos.empresa || '—')} · ${this.esc(c.guardada_en)}</small></span></div><em>${c.pallets.length} pallets · ${c.pallets.reduce((s,p)=>s+(Number(p.cajas)||0),0).toLocaleString('es-CL')} cajas</em></header><footer><button data-view="${this.esc(c.folio)}"><i class="wi wi-eye"></i>Visualizar datos</button><button data-edit="${this.esc(c.folio)}"><i class="wi wi-edit"></i>Modificar</button><button data-pdf="${this.esc(c.folio)}"><i class="wi wi-pdf"></i>PDF</button><button data-xlsx="${this.esc(c.folio)}"><i class="wi wi-sheet"></i>Excel</button></footer></article>`).join('') || '<p class="empty-message">No hay cargas despachadas que coincidan.</p>'}</div>`;
    root.querySelectorAll('[data-history]').forEach(b => b.onclick = () => { this.historyType = b.dataset.history; this.renderHistory(); });
    document.getElementById('historySearch').oninput = e => this.debounceHistory('historySearch', e.target.value);
    document.getElementById('historyDate').oninput = e => this.debounceHistory('historyDate', e.target.value);
    root.querySelectorAll('[data-view]').forEach(b => b.onclick = () => { this.historyFolio = b.dataset.view; this.historyMode = 'ver'; this.renderHistory(); });
    root.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => { this.historyFolio = b.dataset.edit; this.historyMode = 'modificar'; this.renderHistory(); });
    root.querySelectorAll('[data-pdf]').forEach(b => b.onclick = () => this.exportPacking(MapaModel.getLoads().find(c => c.folio === b.dataset.pdf), 'pdf'));
    root.querySelectorAll('[data-xlsx]').forEach(b => b.onclick = () => this.exportPacking(MapaModel.getLoads().find(c => c.folio === b.dataset.xlsx), 'excel'));
  },
  debounceHistory(field, value) { clearTimeout(this._historyTimer); this._historyTimer = setTimeout(() => { this[field] = value; this.renderHistory(); const input = document.getElementById(field); input?.focus(); input?.setSelectionRange(value.length, value.length); }, 120); },

  renderHistoryRecord() {
    const root = document.getElementById('dockContent'), c = MapaModel.getLoads().find(x => x.folio === this.historyFolio); if (!c) { this.historyFolio = null; return this.renderHistory(); }
    const d = c.datos, edit = this.historyMode === 'modificar';
    const values = edit ? `<form id="historyEditForm"><div class="dock-layout"><section class="dock-card"><h3>▣ Destino de carga</h3>${this.field('empresa','Empresa',d.empresa)}${this.field('domicilio','Domicilio',d.domicilio)}${this.field('ciudad','Ciudad',d.ciudad)}</section><section class="dock-card"><h3>♨ Validación de andén</h3>${this.field('fecha_hora','Fecha y hora',d.fecha_hora)}${this.field('temperatura','Temperatura',d.temperatura)}</section></div><section class="dock-card"><h3>🚚 Logística</h3><div class="dock-fields-row four">${this.field('chofer','Chofer',d.chofer)}${this.field('rut','RUT',d.rut)}${this.field('patente_camion','Patente camión',d.patente_camion)}${this.field('patente_rampla','Patente rampla',d.patente_rampla)}</div></section><section class="dock-card"><h3>Observaciones</h3><textarea name="observaciones" rows="5">${this.esc(d.observaciones)}</textarea></section></form>` : `<div class="history-read-grid"><section class="dock-card"><h3>Destino de carga</h3><p><b>Empresa:</b> ${this.esc(d.empresa || '—')}</p><p><b>Domicilio:</b> ${this.esc(d.domicilio || '—')}</p><p><b>Ciudad:</b> ${this.esc(d.ciudad || '—')}</p></section><section class="dock-card"><h3>Validación y logística</h3><p><b>Fecha:</b> ${this.esc(d.fecha_hora || '—')} · <b>Temp.:</b> ${this.esc(d.temperatura || '—')}</p><p><b>Chofer:</b> ${this.esc(d.chofer || '—')} · <b>RUT:</b> ${this.esc(d.rut || '—')}</p><p><b>Patentes:</b> ${this.esc(d.patente_camion || '—')} / ${this.esc(d.patente_rampla || '—')}</p></section></div><section class="dock-card"><h3>Observaciones</h3><p>${this.esc(d.observaciones || 'Sin observaciones.')}</p></section>`;
    const historicalPallets = c.pallets.map(e => ({ ...(e._snapshot || {}), id: e.id, _manual_pasillo: e.de_pasillo }));
    root.innerHTML = `<button class="history-back" id="historyBack"><i class="wi wi-left"></i>Volver al historial</button><header class="history-record-heading"><i>${edit ? '✎' : '🚚'}</i><div><h2>${edit ? 'Modificar ' : ''}${this.esc(c.folio)}</h2><p>Despachada el ${this.esc(c.guardada_en)}${edit ? ' · los pallets quitados vuelven al mapa' : ''}</p></div></header>${values}<section class="dock-card"><h3>Pallets de la carga (${c.pallets.length}) ${edit ? '<small>tocá uno para quitarlo y devolverlo al mapa</small>' : ''}</h3><div class="load-grid">${this.palletCells(historicalPallets, edit)}</div></section><div class="dock-actions">${edit ? '<button class="btn-primary" id="historySave">Guardar cambios</button>' : '<button class="btn-primary" id="historyModify">Modificar esta carga</button>'}<span></span><button class="btn-secondary" id="historyPdf"><i class="wi wi-pdf"></i>Packing list PDF</button><button class="btn-secondary" id="historyExcel"><i class="wi wi-sheet"></i>Excel</button></div>`;
    document.getElementById('historyBack').onclick = () => { this.historyFolio = null; this.historyMode = null; this.renderHistory(); };
    document.getElementById('historyModify')?.addEventListener('click', () => { this.historyMode = 'modificar'; this.renderHistory(); });
    document.getElementById('historySave')?.addEventListener('click', () => { const form = document.getElementById('historyEditForm'), changes = {}; form.querySelectorAll('[name]').forEach(i => changes[i.name] = i.value); MapaModel.actualizarCargaHistorica(c.folio, changes); MapaController.toast('Cambios guardados.'); this.historyMode = 'ver'; this.renderHistory(); });
    if (edit) root.querySelectorAll('.load-pallet').forEach(b => b.onclick = () => { const r = MapaModel.quitarPalletHistorico(c.folio, b.dataset.id); if (!r.ok) return; if (r.mensaje) MapaController.toast(r.mensaje); if (r.cargaEliminada) { this.historyFolio = null; this.historyMode = null; } this.renderHistory(); });
    document.getElementById('historyPdf').onclick = () => this.exportPacking(c, 'pdf'); document.getElementById('historyExcel').onclick = () => this.exportPacking(c, 'excel');
  }
};
