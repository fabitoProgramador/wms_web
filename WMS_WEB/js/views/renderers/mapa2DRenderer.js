/** Renderizador fiel 2D. No contiene reglas de negocio. */
class Mapa2DRenderer {
  constructor(containerElement, options = {}) {
    this.container = containerElement;
    this.cameraMode = options.cameraMode || 'PROTER';
    this.options = options;
    this.cells = new Map();
    this.data = [];
  }

  render(db = this.options.data || MapaModel.getPallets()) {
    if (this.cells.size && this.container.firstElementChild) { this.syncData(db); return; }
    this.data = db;
    this.options.data = db;
    const pallets = db.filter(p => p.ubicacion === this.cameraMode && p.banda !== null);
    const bySlot = new Map(pallets.map(p => [this.key(p.banda, p.posicion, p.altura), p]));
    this.cells.clear();
    this.container.innerHTML = '';
    const chamber = document.createElement('div');
    chamber.className = `map-faithful-chamber ${this.cameraMode === 'PROTER' ? 'proter' : 'postunel'}`;
    if (this.cameraMode === 'PROTER') this.renderProter(chamber, bySlot, db);
    else this.renderPostunel(chamber, bySlot, db);
    this.container.appendChild(chamber);
  }

  /** Vista operacional de una sola banda; reutiliza celdas, datos y callbacks del renderer 2D. */
  renderBand(banda, db = this.options.data || MapaModel.getPallets()) {
    this.data = db; this.options.data = db; this.cells.clear(); this.container.innerHTML = '';
    const positioned = db.filter(p => p.ubicacion === this.cameraMode && p.banda !== null);
    const bySlot = new Map(positioned.map(p => [this.key(p.banda, p.posicion, p.altura), p]));
    const chamber = document.createElement('div'); chamber.className = `gruero-band-chamber ${this.cameraMode === 'PROTER' ? 'proter' : 'postunel'}`;
    const title = document.createElement('header'); title.className = 'gruero-band-heading'; title.innerHTML = `<span>${this.cameraMode === 'PROTER' ? 'Cámara Proter' : 'Cámara Post Túnel'}</span><strong>${this.cameraMode === 'POST TUNEL' && (String(banda) === '01' || String(banda) === '02') ? 'ZONA' : 'BANDA'} ${banda}</strong>`;
    chamber.append(title, this.band(banda, MapaModel.maxPositions(this.cameraMode, banda), false, bySlot, db, this.cameraMode === 'POST TUNEL'));
    this.container.appendChild(chamber);
  }

  syncData(db) {
    this.data = db;
    this.options.data = db;
    const pallets = db.filter(p => p.ubicacion === this.cameraMode && p.banda !== null);
    const bySlot = new Map(pallets.map(p => [this.key(p.banda, p.posicion, p.altura), p]));
    this.cells.forEach((cell, key) => this.paintCell(cell, bySlot.get(key) || null));
    this.updateVisualState(this.options);
  }

  updateVisualState(options = {}) {
    this.options = { ...this.options, ...options };
    const db = this.options.data || MapaModel.getPallets();
    const byId = new Map(db.map(p => [String(p.id), p]));
    this.cells.forEach(cell => {
      const pallet = byId.get(String(cell.dataset.palletId || ''));
      if (!pallet) return;
      cell.classList.toggle('is-searched', Boolean(this.options.isSearched?.(pallet)));
      cell.classList.toggle('is-fifo', Boolean(this.options.isFifo?.(pallet)));
      cell.classList.toggle('is-muted', !this.options.matchesFilter?.(pallet));
      cell.classList.toggle('pending-sync', Boolean(this.options.isPending?.(pallet)));
    });
  }

  key(banda, posicion, altura) { return `${typeof banda}:${banda}|${posicion}|${altura}`; }

  renderProter(root, bySlot, db) {
    const arriba = document.createElement('div'); arriba.className = 'map-band-row';
    for (let b = 0; b <= 14; b += 1) arriba.appendChild(this.band(b, posicionesPorBandaProter(b), false, bySlot, db));
    const aisle = document.createElement('div'); aisle.className = 'map-aisle'; aisle.innerHTML = '<span class="map-road-line"></span><b>🚜 PASILLO — TRÁNSITO YALE</b><span class="map-road-line"></span>';
    const abajo = document.createElement('div'); abajo.className = 'map-band-row lower';
    for (let b = 29; b >= 15; b -= 1) abajo.appendChild(this.band(b, posicionesPorBandaProter(b), true, bySlot, db));
    root.append(arriba, aisle, abajo);
  }

  renderPostunel(root, bySlot, db) {
    const row = document.createElement('div'); row.className = 'map-post-row';
    row.appendChild(this.postSpecial('01', bySlot, db));
    row.appendChild(this.postSpecial('02', bySlot, db));
    for (let n = 1; n <= 9; n += 1) {
      const pair = document.createElement('div'); pair.className = 'map-post-pair';
      pair.appendChild(this.band(n, 8, false, bySlot, db, true));
      const beam = document.createElement('div'); beam.className = 'map-rack-beam'; beam.title = `Bandas ${n} y ${19 - n} en espejo`;
      pair.appendChild(beam);
      pair.appendChild(this.band(19 - n, 8, true, bySlot, db, true));
      row.appendChild(pair);
    }
    root.appendChild(row);
  }

  postSpecial(zona, bySlot, db) {
    const wrap = document.createElement('div'); wrap.className = 'map-post-special';
    wrap.appendChild(this.band(zona, 17, false, bySlot, db, true));
    return wrap;
  }

  band(id, positions, labelBelow, bySlot, db, post = false) {
    const band = document.createElement('section'); band.className = `map-band ${labelBelow ? 'label-below' : ''}`;
    const label = document.createElement('button'); label.type = 'button'; label.className = 'map-band-label'; label.textContent = post && (id === '01' || id === '02') ? `${id} ❄` : `BANDA ${id}`;
    label.title = 'Tocar para vaciar toda la banda'; label.addEventListener('click', () => this.options.onEmptyBand?.(id));
    const levels = document.createElement('div'); levels.className = 'map-level-head'; levels.innerHTML = '<span>C1</span><span>C2</span>';
    const grid = document.createElement('div'); grid.className = 'map-band-grid';
    const order = Array.from({ length: positions }, (_, i) => i + 1); if (labelBelow) order.reverse();
    order.forEach(pos => {
      const row = document.createElement('div'); row.className = 'map-position-row'; row.dataset.position = pos;
      ['C1', 'C2'].forEach(altura => row.appendChild(this.cell(id, pos, altura, bySlot.get(this.key(id, pos, altura)) || null, db)));
      grid.appendChild(row);
    });
    if (labelBelow) band.append(grid, levels, label); else band.append(label, levels, grid);
    return band;
  }

  cell(banda, posicion, altura, pallet, db) {
    const cell = document.createElement('button'); cell.type = 'button'; cell.className = 'map-slot';
    cell.dataset.banda = banda; cell.dataset.posicion = posicion; cell.dataset.altura = altura;
    const slot = { banda, posicion, altura };
    cell.addEventListener('click', () => this.options.onSelect?.(this.palletForCell(cell), slot, cell));
    cell.addEventListener('dblclick', e => { e.preventDefault(); this.options.onEdit?.(this.palletForCell(cell), slot, cell); });
    cell.addEventListener('dragstart', e => { if (cell.dataset.palletId) { e.dataTransfer.setData('text/plain', cell.dataset.palletId); e.dataTransfer.effectAllowed = 'move'; } });
    cell.addEventListener('dragover', e => { e.preventDefault(); cell.classList.add('drag-over'); });
    cell.addEventListener('dragleave', () => cell.classList.remove('drag-over'));
    cell.addEventListener('drop', e => { e.preventDefault(); cell.classList.remove('drag-over'); this.options.onDrop?.(e.dataTransfer.getData('text/plain'), slot); });
    this.cells.set(this.key(banda, posicion, altura), cell);
    this.paintCell(cell, pallet);
    return cell;
  }

  palletForCell(cell) { return this.data.find(p => String(p.id) === String(cell.dataset.palletId || '')) || null; }

  paintCell(cell, pallet) {
    cell.classList.remove('occupied', 'empty', 'is-repeated', 'is-searched', 'is-fifo', 'is-muted', 'pending-sync', 'selected', 'drag-over');
    delete cell.dataset.palletId;
    cell.style.removeProperty('--slot-color');
    cell.draggable = false;
    cell.replaceChildren();
    if (pallet) {
      cell.dataset.palletId = pallet.id; cell.draggable = true;
      const map = this.cameraMode === 'PROTER' ? 'proter' : 'postunel';
      const color = pallet.pendiente_verificacion ? COLOR_MAPA_NUEVO_PENDIENTE : PalletModel.colorCeldaCarga(pallet, map, this.data);
      cell.style.setProperty('--slot-color', color); cell.classList.add('occupied');
      if (pallet.repetido) cell.classList.add('is-repeated');
      if (this.options.isSearched?.(pallet)) cell.classList.add('is-searched');
      if (this.options.isFifo?.(pallet)) cell.classList.add('is-fifo');
      if (!this.options.matchesFilter?.(pallet)) cell.classList.add('is-muted');
      if (this.options.isPending?.(pallet)) cell.classList.add('pending-sync');
      cell.innerHTML = `<strong>${this.esc(PalletModel.codigoVisual(pallet))}</strong>`;
      cell.title = `${PalletModel.codigoVisualLegible(pallet)} · ID lote ${PalletModel.idLoteReal(pallet)} · Artículo ${pallet.articulo} · ${pallet.estado}`;
    } else {
      cell.classList.add('empty'); cell.innerHTML = '<span></span>'; cell.title = `Banda ${cell.dataset.banda} · P${cell.dataset.posicion} · ${cell.dataset.altura} · Vacío`;
    }
  }

  /* Escape unico del proyecto: SeguridadService.escaparHtml. Antes cada
     archivo tenia el suyo y seis de ellos no escapaban comillas, lo que dejaba
     abierta la inyeccion dentro de atributos. */
  esc(v) { return SeguridadService.escaparHtml(v); }
}
