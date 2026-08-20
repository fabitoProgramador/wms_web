/**
 * Configuración Geométrica de Cámaras para WMS_WEB
 * Estructuras exactas extraídas de Programa MVC
 */
const RANGOS_BANDAS_PROTER = [
  { inicio: 0, fin: 14, posiciones: 9 },
  { inicio: 15, fin: 22, posiciones: 7 },
  { inicio: 23, fin: 29, posiciones: 9 }
];

/**
 * Devuelve cuántas posiciones tiene una banda de Proter (0-29).
 */
function posicionesPorBandaProter(banda) {
  for (const rango of RANGOS_BANDAS_PROTER) {
    if (banda >= rango.inicio && banda <= rango.fin) {
      return rango.posiciones;
    }
  }
  return 9;
}

/**
 * Genera los 508 slots de Proter: 30 bandas (0..29), 7 u 9 posiciones, 2 niveles (C1, C2).
 */
function generarSlotsProter() {
  const slots = [];
  for (const rango of RANGOS_BANDAS_PROTER) {
    for (let banda = rango.inicio; banda <= rango.fin; banda++) {
      for (let posicion = 1; posicion <= rango.posiciones; posicion++) {
        for (const altura of ["C1", "C2"]) {
          slots.push({ banda, posicion, altura });
        }
      }
    }
  }
  return slots;
}

function posicionesPorZonaPostunel(zona) {
  return zona === "01" || zona === "02" ? 17 : 8;
}

const INVENTARIO_CAMARA_SAP = Object.freeze({
  proter: "PROTER",
  postunel: "POST TUNEL"
});

const INVENTARIO_NOMBRE_CAMARA = Object.freeze({
  proter: "Proter",
  postunel: "Post Túnel"
});

const ANDEN_PREFIJO_FOLIO = Object.freeze({ embarque: "PL", postunel: "PT" });

/**
 * Genera los 356 slots de Postúnel: Zonas "01" y "02" (17 pos) + Bandas 1..18 (8 pos), 2 niveles (C1, C2).
 */
function generarSlotsPostunel() {
  const slots = [];
  // Zonas de Evaporadores 01 y 02
  for (const zona of ["01", "02"]) {
    for (let posicion = 1; posicion <= 17; posicion++) {
      for (const altura of ["C1", "C2"]) {
        slots.push({ banda: zona, posicion, altura });
      }
    }
  }
  // Bandas normales 1 a 18
  for (let banda = 1; banda <= 18; banda++) {
    for (let posicion = 1; posicion <= 8; posicion++) {
      for (const altura of ["C1", "C2"]) {
        slots.push({ banda, posicion, altura });
      }
    }
  }
  return slots;
}
