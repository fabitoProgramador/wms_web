/**
 * Motor de Renderizado 1D Alta Densidad (Tabla/Lista de Selección) para WMS_WEB
 */
class Mapa1DRenderer {
  constructor(containerElement, options = {}) {
    this.container = containerElement;
    this.cameraMode = options.cameraMode || 'PROTER';
    this.onSelectPallet = options.onSelectPallet || null;
  }

  setCameraMode(mode) {
    this.cameraMode = mode;
    this.render();
  }

  render() {
    this.container.innerHTML = '';
    const pallets = MapaModel.getPallets().filter(p => p.ubicacion === this.cameraMode);

    const tableWrapper = document.createElement('div');
    tableWrapper.className = 'table-responsive-wrapper';

    const table = document.createElement('table');
    table.className = 'wms-table';

    table.innerHTML = `
      <thead>
        <tr>
          <th>Ubicación</th>
          <th>Código Visual</th>
          <th>N° Lote</th>
          <th>Producto</th>
          <th>Cajas</th>
          <th>Kilos</th>
          <th>Estado</th>
          <th>Ingreso</th>
          <th>Acciones</th>
        </tr>
      </thead>
      <tbody>
        ${pallets.map(p => `
          <tr data-id="${p.id}">
            <td><span class="badge badge-accent">B${p.banda}-P${p.posicion}-${p.altura}</span></td>
            <td><strong>${PalletModel.codigoVisualLegible(p)}</strong></td>
            <td>${PalletModel.idLoteReal(p)}</td>
            <td>${PalletModel.descripcion(p)}</td>
            <td>${p.cajas} cs</td>
            <td>${PalletModel.kilos(p)} kg</td>
            <td>
              <span class="status-badge" style="background-color: ${COLORES_MAPA_ESTADO[p.estado] || '#64748B'}; color: #FFF;">
                ${p.estado}
              </span>
            </td>
            <td>${p.fecha_ingreso || '-'}</td>
            <td>
              <button class="btn-sm btn-primary btn-inspect">Ver Detalle</button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    `;

    table.querySelectorAll('.btn-inspect').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tr = e.target.closest('tr');
        const id = tr.getAttribute('data-id');
        const pallet = pallets.find(p => p.id === id);
        if (this.onSelectPallet) {
          this.onSelectPallet(pallet, { banda: pallet.banda, posicion: pallet.posicion, altura: pallet.altura });
        }
      });
    });

    tableWrapper.appendChild(table);
    this.container.appendChild(tableWrapper);
  }
}
