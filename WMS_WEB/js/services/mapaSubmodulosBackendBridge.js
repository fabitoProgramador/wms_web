/**
 * Puente TEMPORAL de Mapa para dos submódulos ya migrados.
 *
 * El visor principal 2D/2.5D y su offline siguen en MapaController/MapaModel
 * hasta su fase quirúrgica. Este bridge reemplaza únicamente los puntos de
 * entrada de Agregar Código e Inventario de Cámara para que esas vistas no
 * vuelvan a ejecutar lógica/localStorage legacy.
 *
 * Debe eliminarse cuando el visor principal de Mapa se migre y MapaController
 * pueda quedar como fachada remota definitiva.
 */
const MapaSubmodulosBackendBridge = {
  instalado:false,

  install() {
    if (this.instalado) return;
    if (typeof MapaController === 'undefined' || typeof MapaCodigoController === 'undefined' || typeof MapaInventarioController === 'undefined') {
      throw new Error('No fue posible instalar el puente remoto de submódulos de Mapa.');
    }

    MapaController.initCodigo = container => MapaCodigoController.init(container);
    MapaController.initInventario = container => MapaInventarioController.init(container);
    this.instalado = true;
  }
};
