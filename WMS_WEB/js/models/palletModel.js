/**
 * Modelo de Datos y Funciones Auxiliares para Pallets en WMS_WEB
 * Fuente de verdad extraída de Modelo/calculos_mapa_pallets.py en Programa MVC
 */
const PalletModel = {
  numeroArticulo(pallet) {
    const articulo = String(pallet?.articulo || '').trim();
    return pallet?.numero_articulo || `${IDENTIDAD_PLANTA.temporadaActual}${articulo}`;
  },

  idLoteReal(pallet) {
    if (pallet?.id_lote_real) return String(pallet.id_lote_real);
    const articulo = String(pallet?.articulo || '').trim();
    const numero = String(pallet?.numero_pallet || '').trim();
    const numeroId = numero.length < 3 ? numero.padStart(3, '0') : numero;
    return `${IDENTIDAD_PLANTA.temporadaActual}${IDENTIDAD_PLANTA.codigoPlantaLote}${articulo}${numeroId}`;
  },

  desglosarIdLote(idLote) {
    const valor = String(idLote || '').trim();
    const corteArticulo = 4 + IDENTIDAD_PLANTA.largoCodigoArticulo;
    return {
      temporada: valor.slice(0, 2),
      planta: valor.slice(2, 4),
      articulo: valor.slice(4, corteArticulo),
      numero_pallet: valor.slice(corteArticulo)
    };
  },

  kilos(pallet) {
    return (Number(pallet?.cajas) || 0) * IDENTIDAD_PLANTA.kilosPorCaja;
  },

  descripcion(pallet) {
    const articulo = String(pallet?.articulo || '').trim();
    return CATALOGO_ARTICULOS[articulo]?.descripcion || pallet?.descripcion || `Artículo ${articulo}`;
  },

  datosPresentacion(pallet) {
    return {
      ...pallet,
      descripcion: this.descripcion(pallet),
      numero_articulo: this.numeroArticulo(pallet),
      id_lote_real: this.idLoteReal(pallet),
      kilos: this.kilos(pallet),
      kilos_stock: this.kilos(pallet)
    };
  },

  siguienteLetra(usadas) {
    const alfabeto = IDENTIDAD_PLANTA.alfabetoEspanol;
    for (let largo = 1; ; largo += 1) {
      const total = Math.pow(alfabeto.length, largo);
      for (let indice = 0; indice < total; indice += 1) {
        let n = indice;
        let codigo = '';
        for (let pos = 0; pos < largo; pos += 1) {
          codigo = alfabeto[n % alfabeto.length] + codigo;
          n = Math.floor(n / alfabeto.length);
        }
        if (!usadas.has(codigo)) return codigo;
      }
    }
  },
  /**
   * Genera el Código Visual Técnico (ej: "A20") sin separadores.
   */
  codigoVisual(pallet, letrasPorArticulo = LETRAS_POR_ARTICULO) {
    if (pallet._codigo_visual_manual) {
      return pallet._codigo_visual_manual;
    }
    const letra = letrasPorArticulo[pallet.articulo] || "?";
    const numero = pallet.numero_pallet || "00";
    return `${letra}${numero}`;
  },

  /**
   * Genera el Código Visual Legible para pantalla (ej: "A-20").
   */
  codigoVisualLegible(pallet, letrasPorArticulo = LETRAS_POR_ARTICULO) {
    if (pallet._codigo_visual_manual) {
      const match = pallet._codigo_visual_manual.match(/^([A-ZÑ]+)(\d*)$/);
      if (match && match[2]) {
        return `${match[1]}-${match[2]}`;
      }
      return pallet._codigo_visual_manual;
    }
    const letra = letrasPorArticulo[pallet.articulo] || "?";
    const numero = pallet.numero_pallet || "00";
    return `${letra}-${numero}`;
  },

  /**
   * Normaliza texto ingresado por el usuario (mayúsculas, sin espacios ni guiones).
   */
  normalizarCodigo(texto) {
    return (texto || "").toString().trim().toUpperCase().replace(/-/g, "").replace(/\s+/g, "");
  },

  /**
   * Las TRES formas en que un operador puede escribir un pallet en cualquier
   * buscador del sistema, y las únicas:
   *
   *   1. el ID de lote completo   ->  263011027001
   *   2. el código visual con guion ->  A-01
   *   3. el mismo código sin guion  ->  A01   (es lo que muestra el mapa)
   *
   * NO se aceptan el id interno (PLT-PRO-1000) ni el campo `lote` crudo
   * (L-202600): se comprobó vista por vista que no aparecen en ninguna
   * pantalla del sistema, así que nadie puede leerlos para escribirlos.
   *
   * Esta es la única fuente de verdad: la usan el buscador del mapa y el de
   * Despacho, para que los dos entiendan exactamente lo mismo.
   */
  clavesDeBusqueda(pallet) {
    const claves = new Set();
    [this.idLoteReal(pallet), this.codigoVisual(pallet), this.codigoVisualLegible(pallet)]
      .forEach(valor => {
        const texto = String(valor ?? '').trim().toUpperCase();
        if (!texto) return;
        claves.add(texto);
        const plano = this.normalizarCodigo(texto);
        if (plano) claves.add(plano);
      });
    return claves;
  },

  /**
   * Normaliza un número de lote para comparación.
   */
  normalizarLote(texto) {
    return (texto || "").toString().trim().toUpperCase();
  },

  /**
   * Determina el color de celda de un pallet según la cámara y su estado/artículo.
   */
  colorCeldaCarga(pallet, mapa, dbPallets = []) {
    if (pallet.repetido) {
      return COLOR_MAPA_REPETIDO; // "#FFFFFF"
    }
    if (pallet.no_existe) {
      return COLOR_MAPA_NO_EXISTE; // "#60A5FA"
    }
    if (mapa === "postunel") {
      return this.colorParaArticuloPostunel(pallet.articulo, dbPallets);
    }
    return COLORES_MAPA_ESTADO[pallet.estado] || "#64748B";
  },

  /**
   * Color dinámico para artículos en Postúnel.
   */
  colorParaArticuloPostunel(articulo, dbPallets) {
    const articulosDisponibles = Array.from(new Set(
      dbPallets
        .filter(p => p.ubicacion === "POST TUNEL" && p.banda !== null && p.banda !== undefined)
        .map(p => p.articulo)
    )).sort();

    const indice = articulosDisponibles.indexOf(articulo);
    if (indice === -1) return "#64748B";
    return PALETA_ARTICULOS_POSTUNEL[indice % PALETA_ARTICULOS_POSTUNEL.length];
  }
};
