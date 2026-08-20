/**
 * Componente Panel Deslizante de Inspección y Ficha Técnica de Pallet
 */
const PalletDrawer = {
  getDrawerElement() {
    let el = document.getElementById('palletDrawerContainer');
    if (!el) {
      el = document.createElement('div');
      el.id = 'palletDrawerContainer';
      el.className = 'pallet-drawer-container hidden';
      document.body.appendChild(el);
    }
    return el;
  },

  open(pallet, slot) {
    this.activePallet = pallet || null;
    const drawer = this.getDrawerElement();
    drawer.classList.remove('hidden');

    if (!pallet) {
      drawer.innerHTML = `
        <div class="drawer-header">
          <h3>Slot Vacío · B${slot ? slot.banda : ''}-P${slot ? slot.posicion : ''}-${slot ? slot.altura : ''}</h3>
          <button class="drawer-close" onclick="PalletDrawer.close()"><i class="wi wi-close"></i></button>
        </div>
        <div class="drawer-body">
          <div class="empty-slot-card">
            <span class="empty-icon">🔲</span>
            <p>Este espacio se encuentra disponible para asignación o traslado de pallets.</p>
            <button class="btn-primary" onclick="NotificationService.info('Seleccioná un pallet desde el mapa para asignarlo a este espacio.')"><i class="wi wi-plus"></i>Asignar Pallet a este Slot</button>
          </div>
        </div>
      `;
      return;
    }

    const colorState = COLORES_MAPA_ESTADO[pallet.estado] || '#64748B';
    const codigoLegible = PalletModel.codigoVisualLegible(pallet);

    drawer.innerHTML = `
      <div class="drawer-header" style="border-left: 6px solid ${colorState}">
        <div>
          <h2>Pallet ${codigoLegible}</h2>
          <span class="badge" style="background-color: ${colorState}; color: #fff;">${pallet.estado}</span>
        </div>
        <button class="drawer-close" onclick="PalletDrawer.close()"><i class="wi wi-close"></i></button>
      </div>
      <div class="drawer-body">
        <div class="drawer-section">
          <h4>Ubicación Física</h4>
          <div class="drawer-grid">
            <div><label>Cámara</label><strong>${pallet.ubicacion}</strong></div>
            <div><label>Banda</label><strong>Banda ${pallet.banda}</strong></div>
            <div><label>Posición</label><strong>Pos ${pallet.posicion}</strong></div>
            <div><label>Altura / Nivel</label><strong>Nivel ${pallet.altura}</strong></div>
          </div>
        </div>

        <div class="drawer-section">
          <h4>Información del Producto</h4>
          <div class="drawer-grid">
            <div><label>ID Lote</label><strong>${PalletModel.idLoteReal(pallet)}</strong></div>
            <div><label>N° Artículo</label><strong>${PalletModel.numeroArticulo(pallet)}</strong></div>
            <div style="grid-column: span 2"><label>Descripción</label><strong>${PalletModel.descripcion(pallet)}</strong></div>
            <div><label>Cajas</label><strong>${pallet.cajas} cs</strong></div>
            <div><label>Kilos Netos</label><strong>${PalletModel.kilos(pallet)} kg</strong></div>
          </div>
        </div>

        <div class="drawer-actions">
          <button class="btn-primary" onclick="NotificationService.info('Elegí el destino en el mapa para iniciar el traslado.')"><i class="wi wi-swap"></i>Mover Pallet</button>
          <button class="btn-secondary" onclick="PalletDrawer.openLabel()"><i class="wi wi-print"></i>Imprimir Etiqueta</button>
        </div>
      </div>
    `;
  },

  close() {
    const drawer = this.getDrawerElement();
    drawer.classList.add('hidden');
  },

  openLabel() {
    if (!this.activePallet) return;
    this.close();
    LabelController.openForPallet(this.activePallet);
  }
};
