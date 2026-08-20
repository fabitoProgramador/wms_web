/**
 * Configuración de Almacenes y Cámaras para WMS_WEB
 * Fuente de verdad extraída de config/almacenes.py en Programa MVC
 */
const ALMACENES_PIVOT = [
  { id: "PROTER", nombre: "Cámara Proter", icono: "🏭", sap: "CAM302", color: "#10B981" },
  { id: "POST TUNEL", nombre: "Cámara Post Túnel", icono: "🧊", sap: "PTUN02", color: "#F59E0B" },
  { id: "CAMARA CERO", nombre: "Cámara Cero", icono: "❄️", sap: null, color: "#38BDF8" },
  { id: "ANDÉN DE PRODUCCIÓN", nombre: "Andén de Producción", icono: "🏗️", sap: "ANPRO02", color: "#A855F7" },
  { id: "ANDÉN DE DESPACHO", nombre: "Andén de Despacho", icono: "🚚", sap: "ADESP02", color: "#06B6D4" },
  { id: "PATIO", nombre: "Patio de Almacenamiento", icono: "🌤️", sap: "PATIO02", color: "#F97316" },
  { id: "CÁMARA VIRTUAL", nombre: "Cámara Virtual", icono: "🌐", sap: "CVIRT02", color: "#EC4899" }
];

const COLORES_ALMACEN = ALMACENES_PIVOT.reduce((acc, item) => {
  acc[item.id] = item.color;
  return acc;
}, {});
