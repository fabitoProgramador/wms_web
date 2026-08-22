/**
 * Configuración visual del mapa.
 *
 * Los artículos, descripciones y letras NO viven en este archivo. Se cargan
 * desde Supabase y, para offline, desde snapshots backend explícitos.
 * CATALOGO_ARTICULOS queda vacío sólo para compatibilidad con renderizadores
 * históricos que verifican su existencia antes de usarlo.
 */
const CATALOGO_ARTICULOS = {};
const LETRAS_POR_ARTICULO = {};

// Paleta puramente visual para diferenciar artículos presentes en Post Túnel.
const PALETA_ARTICULOS_POSTUNEL = [
  "#E77474", "#E79374", "#E7B174", "#E7D074", "#DFE774", "#C0E774",
  "#A2E774", "#84E774", "#74E784", "#74E7A2", "#7474E7", "#9374E7",
  "#B174E7", "#D074E7", "#E774DF", "#E774C0", "#E774A2", "#E77484"
];
