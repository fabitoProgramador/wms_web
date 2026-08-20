/**
 * Contrato de identidad de Planta Parral.
 * Fuente: Programa MVC/config/identidad_planta.py.
 *
 * El código de planta usado en el ID de lote es fijo (30). No debe
 * reemplazarse por el código SAP o por el código asociado al almacén actual.
 */
const IDENTIDAD_PLANTA = Object.freeze({
  temporadaActual: '26',
  codigoPlantaLote: '30',
  largoCodigoArticulo: 5,
  kilosPorCaja: 12,
  alfabetoEspanol: 'ABCDEFGHIJKLMNÑOPQRSTUVWXYZ'
});
