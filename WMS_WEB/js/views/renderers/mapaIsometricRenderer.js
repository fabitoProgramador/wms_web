/**
 * Renderer 2.5D ligero del módulo Mapa.
 *
 * No contiene reglas de negocio: consume el mismo arreglo de pallets y las
 * mismas callbacks que Mapa2DRenderer. La profundidad es CSS; no usa canvas,
 * WebGL ni listeners globales. Todos los eventos se delegan en una sola raíz.
 */
class MapaIsometricRenderer {
  constructor(containerElement, options = {}) {
    this.container = containerElement;
    this.cameraMode = options.cameraMode || 'PROTER';
    this.options = options;
    this.cells = new Map();
    this.slotData = new Map();
    this.data = [];
    this.summaryNode = null;
    this.pixiVisual = null;
    this.bindDelegatedEvents();
  }

  key(banda, posicion, altura) { return `${typeof banda}:${banda}|${posicion}|${altura}`; }

  render(db = this.options.data || MapaModel.getPallets()) {
    if (this.cells.size && this.container.firstElementChild) { this.syncData(db); return; }
    this.data = db;
    this.options.data = db;
    const positioned = db.filter(p => p.ubicacion === this.cameraMode && p.banda !== null);
    const bySlot = new Map(positioned.map(p => [this.key(p.banda, p.posicion, p.altura), p]));
    this.cells.clear();
    this.slotData.clear();
    this.container.innerHTML = '';

    const scene = document.createElement('div');
    scene.className = `map-25d-scene ${this.cameraMode === 'PROTER' ? 'proter' : 'postunel'}`;
    const chamber = document.createElement('div');
    chamber.className = 'map-25d-chamber';
    chamber.appendChild(this.cameraMode === 'PROTER' ? this.renderProter(bySlot) : this.renderPostunel(bySlot));
    chamber.appendChild(this.summary(positioned));
    scene.appendChild(chamber);
    this.container.appendChild(scene);
    this.mountPixiVisual(chamber);
    this.updateVisualState(this.options);
  }

  /** Visor operacional de una sola banda; comparte celdas y eventos 2.5D. */
  renderBand(banda, db = this.options.data || MapaModel.getPallets()) {
    this.data = db; this.options.data = db; this.cells.clear(); this.slotData.clear(); this.container.innerHTML = '';
    const positioned = db.filter(p => p.ubicacion === this.cameraMode && p.banda !== null);
    const bySlot = new Map(positioned.map(p => [this.key(p.banda, p.posicion, p.altura), p]));
    const scene = document.createElement('div'); scene.className = `map-25d-scene gruero-25d-scene ${this.cameraMode === 'PROTER' ? 'proter' : 'postunel'}`;
    const chamber = document.createElement('div'); chamber.className = 'map-25d-chamber';
    const title = document.createElement('header'); title.className = 'gruero-band-heading'; title.innerHTML = `<span>${this.cameraMode === 'PROTER' ? 'Cámara Proter' : 'Cámara Post Túnel'}</span><strong>${this.cameraMode === 'POST TUNEL' && (String(banda) === '01' || String(banda) === '02') ? 'ZONA' : 'BANDA'} ${banda} · 2.5D</strong>`;
    chamber.append(title, this.rackBand(banda, MapaModel.maxPositions(this.cameraMode, banda), bySlot, false, this.cameraMode === 'POST TUNEL'));
    scene.appendChild(chamber); this.container.appendChild(scene); this.mountPixiVisual(chamber); this.updateVisualState(this.options);
  }

  syncData(db) {
    this.data = db;
    this.options.data = db;
    const positioned = db.filter(p => p.ubicacion === this.cameraMode && p.banda !== null);
    const bySlot = new Map(positioned.map(p => [this.key(p.banda, p.posicion, p.altura), p]));
    this.cells.forEach((cell, key) => this.paintCell(cell, this.slotData.get(key), bySlot.get(key) || null));
    const previousSummary = this.summaryNode;
    const nextSummary = this.summary(positioned);
    previousSummary?.replaceWith(nextSummary);
    this.pixiVisual?.schedule(false);
    this.updateVisualState(this.options);
  }

  renderProter(bySlot) {
    const layout = document.createElement('div');
    layout.className = 'iso-proter-layout horizontal';
    const lowerBands = [];
    for (let banda = 29; banda >= 15; banda -= 1) {
      // Bandas 23–29 usan la misma geometría vertical que el resto del
      // rack. Sólo conservan una identidad cromática propia: no son un
      // segundo formato de celda ni alteran las coordenadas reales.
      lowerBands.push(this.rackBand(banda, posicionesPorBandaProter(banda), bySlot, true, false, banda >= 23));
    }
    layout.append(
      this.zone('upper', '', '', this.bandRange(0, 14).map(b => this.rackBand(b, posicionesPorBandaProter(b), bySlot, false)), false),
      this.aisle('PASILLO CENTRAL · TRÁNSITO YALE'),
      this.zone('lower', '', '', lowerBands, false)
    );
    return layout;
  }

  renderPostunel(bySlot) {
    const layout = document.createElement('div');
    layout.className = 'iso-post-layout horizontal';
    layout.appendChild(this.zone('evaporators', 'BAJO EVAPORADORES', 'Zonas 01 y 02 · 17 posiciones por nivel', ['01', '02'].map(z => this.rackBand(z, 17, bySlot, false, true))));
    const pairs = [];
    for (let n = 1; n <= 9; n += 1) {
      const pair = document.createElement('section');
      pair.className = 'iso-post-pair';
      const title = document.createElement('header');
      title.innerHTML = `<strong>PAR ${n} / ${19 - n}</strong><span>Bandas en espejo · 8 posiciones</span>`;
      const divider = document.createElement('div');
      divider.className = 'iso-pair-aisle';
      divider.textContent = 'PASILLO';
      pair.append(title, this.rackBand(n, 8, bySlot, false), divider, this.rackBand(19 - n, 8, bySlot, true));
      pairs.push(pair);
    }
    layout.appendChild(this.zone('mirrored', 'RACKS POST TÚNEL', 'Bandas 1–18 organizadas en nueve pares reales', pairs));
    return layout;
  }

  bandRange(start, end) { return Array.from({ length: end - start + 1 }, (_, i) => start + i); }

  zone(name, titleText, subtitle, children, showHeader = true) {
    const section = document.createElement('section');
    section.className = `iso-zone iso-zone-${name}`;
    const grid = document.createElement('div');
    grid.className = 'iso-zone-grid';
    children.forEach(child => grid.appendChild(child));
    if (showHeader) { const header = document.createElement('header'); header.className = 'iso-zone-heading'; const title = document.createElement('h3'); title.textContent = titleText; const sub = document.createElement('span'); sub.textContent = subtitle; header.append(title, sub); section.append(header); }
    section.append(grid);
    return section;
  }

  aisle(label) {
    const aisle = document.createElement('div');
    aisle.className = 'iso-transit-aisle';
    aisle.innerHTML = `<i></i><b>${label}</b><i></i>`;
    return aisle;
  }

  rackBand(id, positions, bySlot, reverse = false, special = false, exclusive = false) {
    const band = document.createElement('article');
    band.className = `iso-rack-band iso-vertical-band${reverse ? ' reversed' : ''}${special ? ' special' : ''}${exclusive ? ' exclusive' : ''}`;
    band.style.setProperty('--positions', positions);
    const label = this.bandLabel(id, special ? `ZONA ${id}` : `BANDA ${id}`);
    const heads = document.createElement('div'); heads.className = 'iso-vertical-level-head'; heads.innerHTML = '<b>C1</b><b>C2</b>';
    const rack = document.createElement('div'); rack.className = 'iso-rack-body iso-vertical-grid';
    const order = Array.from({ length: positions }, (_, i) => i + 1); if (reverse) order.reverse();
    order.forEach(position => {
      const row = document.createElement('div'); row.className = 'iso-vertical-position'; row.dataset.position = position;
      row.append(
        this.cell(id, position, 'C1', bySlot.get(this.key(id, position, 'C1')) || null),
        this.cell(id, position, 'C2', bySlot.get(this.key(id, position, 'C2')) || null)
      );
      rack.appendChild(row);
    });
    if (reverse) band.append(rack, heads, label); else band.append(label, heads, rack);
    return band;
  }

  rackLevel(banda, positions, altura, bySlot, reverse) {
    const level = document.createElement('div');
    level.className = `iso-rack-level level-${altura.toLowerCase()}`;
    const badge = document.createElement('b'); badge.className = 'iso-level-badge'; badge.textContent = altura;
    const slots = document.createElement('div'); slots.className = 'iso-rack-slots';
    const order = Array.from({ length: positions }, (_, i) => i + 1); if (reverse) order.reverse();
    order.forEach(position => slots.appendChild(this.cell(banda, position, altura, bySlot.get(this.key(banda, position, altura)) || null)));
    level.append(badge, slots);
    return level;
  }

  floorBand(id, positions, bySlot, reverse) {
    const band = document.createElement('article');
    band.className = `iso-floor-band iso-vertical-band${reverse ? ' reversed' : ''}`;
    band.style.setProperty('--positions', positions);
    const label = this.bandLabel(id, `BANDA ${id}`);
    const heads = document.createElement('div'); heads.className = 'iso-vertical-level-head floor-head'; heads.innerHTML = '<b>C1 · FRENTE</b><b>C2 · FONDO</b>';
    const body = document.createElement('div'); body.className = 'iso-floor-depth iso-vertical-grid';
    const order = Array.from({ length: positions }, (_, i) => i + 1); if (reverse) order.reverse();
    order.forEach(position => {
      const row = document.createElement('div'); row.className = 'iso-vertical-position'; row.dataset.position = position;
      row.append(
        this.cell(id, position, 'C1', bySlot.get(this.key(id, position, 'C1')) || null, true),
        this.cell(id, position, 'C2', bySlot.get(this.key(id, position, 'C2')) || null, true)
      );
      body.appendChild(row);
    });
    if (reverse) band.append(body, heads, label); else band.append(label, heads, body);
    return band;
  }

  bandLabel(id, text) {
    const label = document.createElement('button');
    label.type = 'button'; label.className = 'iso-band-label'; label.dataset.slotKey = this.key(id, 0, 'BAND');
    this.slotData.set(label.dataset.slotKey, { banda: id, posicion: 0, altura: 'BAND' });
    label.textContent = text; label.title = 'Tocar para vaciar toda la banda';
    return label;
  }

  cell(banda, posicion, altura, pallet, floor = false) {
    const slot = { banda, posicion, altura };
    const key = this.key(banda, posicion, altura);
    const cell = document.createElement('button');
    cell.type = 'button'; cell.className = `map-slot iso-slot${floor ? ' floor-slot' : ''}`;
    cell.dataset.slotKey = key; cell.dataset.banda = banda; cell.dataset.posicion = posicion; cell.dataset.altura = altura;
    this.slotData.set(key, slot);
    this.cells.set(key, cell);
    this.paintCell(cell, slot, pallet);
    return cell;
  }

  paintCell(cell, slot, pallet) {
    const { banda, posicion, altura } = slot;
    cell.classList.remove('occupied', 'empty', 'is-repeated', 'is-searched', 'is-fifo', 'is-muted', 'pending-sync', 'selected', 'drag-over');
    delete cell.dataset.palletId;
    cell.style.removeProperty('--slot-color');
    cell.draggable = false;
    cell.replaceChildren();
    if (pallet) {
      const map = this.cameraMode === 'PROTER' ? 'proter' : 'postunel';
      const color = pallet.pendiente_verificacion ? COLOR_MAPA_NUEVO_PENDIENTE : PalletModel.colorCeldaCarga(pallet, map, this.data);
      cell.classList.add('occupied'); cell.dataset.palletId = pallet.id; cell.draggable = true;
      cell.style.setProperty('--slot-color', color);
      const code = document.createElement('strong'); code.textContent = PalletModel.codigoVisual(pallet);
      const state = document.createElement('small'); state.className = 'iso-status-abbr'; state.textContent = ABREVIATURAS_ESTADO_MAPA[pallet.estado] || '—';
      cell.append(code, state);
      cell.title = `${PalletModel.codigoVisualLegible(pallet)} · ID lote ${PalletModel.idLoteReal(pallet)} · Artículo ${pallet.articulo} · ${pallet.estado}`;
      cell.setAttribute('aria-label', cell.title);
      if (pallet.repetido) cell.classList.add('is-repeated');
      if (this.options.isPending?.(pallet)) cell.classList.add('pending-sync');
    } else {
      cell.classList.add('empty');
      const marker = document.createElement('span'); marker.textContent = String(posicion).padStart(2, '0');
      cell.appendChild(marker); cell.title = `Banda ${banda} · P${posicion} · ${altura} · Vacío`;
      cell.setAttribute('aria-label', cell.title);
    }
  }

  summary(positioned) {
    const total = this.cameraMode === 'PROTER' ? 508 : 356;
    const states = new Map(); positioned.forEach(p => states.set(p.estado, (states.get(p.estado) || 0) + 1));
    const footer = document.createElement('footer'); footer.className = 'iso-scene-summary';
    const values = [['TOTAL POSICIONES', total], ['OCUPADAS', positioned.length], ['VACÍAS', total - positioned.length], ...[...states.entries()].slice(0, 4)];
    values.forEach(([label, value]) => { const item = document.createElement('div'); const small = document.createElement('small'); small.textContent = label; const strong = document.createElement('strong'); strong.textContent = Number(value).toLocaleString('es-CL'); item.append(small, strong); footer.appendChild(item); });
    this.summaryNode = footer;
    return footer;
  }

  updateVisualState(options = {}) {
    this.options = { ...this.options, ...options };
    const byId = new Map(this.data.map(p => [String(p.id), p]));
    this.cells.forEach(cell => {
      const pallet = byId.get(String(cell.dataset.palletId || ''));
      if (!pallet) return;
      cell.classList.toggle('is-searched', Boolean(this.options.isSearched?.(pallet)));
      cell.classList.toggle('is-fifo', Boolean(this.options.isFifo?.(pallet)));
      cell.classList.toggle('is-muted', this.options.matchesFilter ? !this.options.matchesFilter(pallet) : false);
      cell.classList.toggle('pending-sync', Boolean(this.options.isPending?.(pallet)));
    });
    this.pixiVisual?.schedule(false);
  }

  mountPixiVisual(chamber) {
    this.pixiVisual?.destroy();
    this.pixiVisual = typeof PixiMapVisualLayer === 'undefined' ? null : new PixiMapVisualLayer(chamber);
  }

  setZoom(zoom) { this.pixiVisual?.setZoom(zoom); }

  bindDelegatedEvents() {
    this.container.addEventListener('click', e => {
      const label = e.target.closest('.iso-band-label');
      if (label) { const slot = this.slotData.get(label.dataset.slotKey); this.options.onEmptyBand?.(slot.banda); return; }
      const cell = e.target.closest('.iso-slot'); if (!cell) return;
      const slot = this.slotData.get(cell.dataset.slotKey), pallet = this.data.find(p => String(p.id) === String(cell.dataset.palletId || '')) || null;
      this.options.onSelect?.(pallet, slot, cell);
    });
    this.container.addEventListener('dblclick', e => {
      const cell = e.target.closest('.iso-slot'); if (!cell) return; e.preventDefault();
      const slot = this.slotData.get(cell.dataset.slotKey), pallet = this.data.find(p => String(p.id) === String(cell.dataset.palletId || '')) || null;
      this.options.onEdit?.(pallet, slot, cell);
    });
    this.container.addEventListener('dragstart', e => { const cell = e.target.closest('.iso-slot.occupied'); if (cell) { e.dataTransfer.setData('text/plain', cell.dataset.palletId); e.dataTransfer.effectAllowed = 'move'; } });
    this.container.addEventListener('dragover', e => { const cell = e.target.closest('.iso-slot'); if (cell) { e.preventDefault(); cell.classList.add('drag-over'); } });
    this.container.addEventListener('dragleave', e => e.target.closest('.iso-slot')?.classList.remove('drag-over'));
    this.container.addEventListener('drop', e => { const cell = e.target.closest('.iso-slot'); if (!cell) return; e.preventDefault(); cell.classList.remove('drag-over'); this.options.onDrop?.(e.dataTransfer.getData('text/plain'), this.slotData.get(cell.dataset.slotKey)); });
  }
}
