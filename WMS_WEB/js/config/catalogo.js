/**
 * Catálogo maestro de artículos para WMS_WEB.
 * Fuente de verdad extraída de config/catalogo_articulos.py en Programa MVC
 * Las letras del mapa no son parte del catálogo ni del código de artículo.
 */
const CATALOGO_ARTICULOS = {
  "11027": { descripcion: "Frambuesa Orgánica", esOrganico: true },
  "11039": { descripcion: "Frambuesa Convencional", esOrganico: false },
  "11041": { descripcion: "Frambuesa Convencional", esOrganico: false },
  "12015": { descripcion: "Arándano Orgánico", esOrganico: true },
  "12020": { descripcion: "Arándano Convencional", esOrganico: false },
  "12509": { descripcion: "Frambuesa Orgánica", esOrganico: true },
  "12702": { descripcion: "Frambuesa Orgánica", esOrganico: true },
  "18300": { descripcion: "Frutilla Convencional", esOrganico: false },
  "18305": { descripcion: "Frutilla Orgánica", esOrganico: true },
  "18356": { descripcion: "Mora Convencional", esOrganico: false }
};

// Estado independiente del motor visual del mapa: { articuloReal: letraVisual }.
// Se completa desde los artículos presentes en inventario, como en Programa MVC.
const LETRAS_POR_ARTICULO = {};

const PALETA_ARTICULOS_POSTUNEL = [
  "#E77474", "#E79374", "#E7B174", "#E7D074", "#DFE774", "#C0E774",
  "#A2E774", "#84E774", "#74E784", "#74E7A2", "#7474E7", "#9374E7",
  "#B174E7", "#D074E7", "#E774DF", "#E774C0", "#E774A2", "#E77484"
];
