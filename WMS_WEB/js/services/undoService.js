/**
 * Motor de Historial Deshacer/Rehacer (Ctrl+Z / Ctrl+Y) para WMS_WEB
 * Replica exactamente la lógica de calculos_mapa_historial.py en Programa MVC
 */
const UndoService = {
  historialProter: [],
  futuroProter: [],
  historialPostunel: [],
  futuroPostunel: [],

  /**
   * Guarda un snapshot del estado del mapa antes de un cambio
   */
  guardarSnapshot(ubicacion, dbPallets) {
    const copia = JSON.parse(JSON.stringify(dbPallets));
    if (ubicacion === "PROTER") {
      this.historialProter.push(copia);
      if (this.historialProter.length > 50) this.historialProter.shift();
      this.futuroProter = [];
    } else if (ubicacion === "POST TUNEL") {
      this.historialPostunel.push(copia);
      if (this.historialPostunel.length > 50) this.historialPostunel.shift();
      this.futuroPostunel = [];
    }
  },

  deshacer(ubicacion, dbPalletsActuales) {
    if (ubicacion === "PROTER" && this.historialProter.length > 0) {
      this.futuroProter.push(JSON.parse(JSON.stringify(dbPalletsActuales)));
      const estadoAnterior = this.historialProter.pop();
      MapaModel.savePallets(estadoAnterior);
      return estadoAnterior;
    } else if (ubicacion === "POST TUNEL" && this.historialPostunel.length > 0) {
      this.futuroPostunel.push(JSON.parse(JSON.stringify(dbPalletsActuales)));
      const estadoAnterior = this.historialPostunel.pop();
      MapaModel.savePallets(estadoAnterior);
      return estadoAnterior;
    }
    return null;
  },

  rehacer(ubicacion, dbPalletsActuales) {
    if (ubicacion === "PROTER" && this.futuroProter.length > 0) {
      this.historialProter.push(JSON.parse(JSON.stringify(dbPalletsActuales)));
      const estadoFuturo = this.futuroProter.pop();
      MapaModel.savePallets(estadoFuturo);
      return estadoFuturo;
    } else if (ubicacion === "POST TUNEL" && this.futuroPostunel.length > 0) {
      this.historialPostunel.push(JSON.parse(JSON.stringify(dbPalletsActuales)));
      const estadoFuturo = this.futuroPostunel.pop();
      MapaModel.savePallets(estadoFuturo);
      return estadoFuturo;
    }
    return null;
  },

  puedeDeshacer(ubicacion) {
    return ubicacion === 'PROTER' ? this.historialProter.length > 0 : this.historialPostunel.length > 0;
  },

  puedeRehacer(ubicacion) {
    return ubicacion === 'PROTER' ? this.futuroProter.length > 0 : this.futuroPostunel.length > 0;
  }
};
