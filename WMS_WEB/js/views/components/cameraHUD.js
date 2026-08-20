/**
 * Componente HUD y Barra de Herramientas del Mapa (Modos 2D Grilla y 2.5D Isométrico)
 */
const CameraHUD = {
  render(containerElement, callbacks = {}) {
    containerElement.innerHTML = `
      <div class="camera-hud-wrapper">
        <!-- Selector de Cámara -->
        <div class="hud-group">
          <label class="hud-label">Cámara Frigorífica:</label>
          <select id="hudCameraSelect" class="form-control-sm">
            <option value="PROTER">🏭 Cámara Proter</option>
            <option value="POST TUNEL">🧊 Cámara Post Túnel</option>
          </select>
        </div>

        <!-- Selector de Modo de Vista (2D, 2.5D - 1D Eliminado) -->
        <div class="hud-group">
          <label class="hud-label">Visualización:</label>
          <div class="view-mode-toggle">
            <button id="btnView25D" class="toggle-btn active" title="Vista 2.5D Isométrica Frigorífica 3D"><i class="wi wi-cube"></i>2.5D Isométrico</button>
            <button id="btnView2D" class="toggle-btn" title="Vista 2D Planta Grilla de Control"><i class="wi wi-grid"></i>2D Grilla</button>
          </div>
        </div>

        <!-- Buscador Rápido -->
        <div class="hud-group hud-search">
          <input type="text" id="hudSearchInput" class="form-control-sm" placeholder="Buscar Lote (L-202601) o Código Visual (A-20)...">
          <button id="btnHudSearch" class="btn-sm btn-primary"><i class="wi wi-search"></i>Buscar</button>
        </div>

        <!-- Leyenda de Ocupación -->
        <div class="hud-group hud-stats" id="hudOccupancyWidget">
          <span class="badge badge-success">Capacidad: 180 / 508</span>
        </div>
      </div>
    `;

    const select = document.getElementById('hudCameraSelect');
    if (select) {
      select.addEventListener('change', (e) => {
        if (callbacks.onChangeCamera) callbacks.onChangeCamera(e.target.value);
      });
    }

    const btn25D = document.getElementById('btnView25D');
    const btn2D = document.getElementById('btnView2D');

    const updateActiveToggle = (activeBtn) => {
      [btn25D, btn2D].forEach(b => b.classList.remove('active'));
      activeBtn.classList.add('active');
    };

    if (btn25D) {
      btn25D.addEventListener('click', () => {
        updateActiveToggle(btn25D);
        if (callbacks.onChangeViewMode) callbacks.onChangeViewMode('2.5D');
      });
    }
    if (btn2D) {
      btn2D.addEventListener('click', () => {
        updateActiveToggle(btn2D);
        if (callbacks.onChangeViewMode) callbacks.onChangeViewMode('2D');
      });
    }

    const btnSearch = document.getElementById('btnHudSearch');
    const inputSearch = document.getElementById('hudSearchInput');
    if (btnSearch && inputSearch) {
      const doSearch = () => {
        const text = inputSearch.value.trim();
        if (!text) {
          NotificationService.warning('Ingresá un lote o código visual para buscar.');
          inputSearch.focus();
          return;
        }
        if (callbacks.onSearch) callbacks.onSearch(text);
      };
      btnSearch.addEventListener('click', doSearch);
      inputSearch.addEventListener('keyup', (e) => {
        if (e.key === 'Enter') doSearch();
      });
    }
  }
};
