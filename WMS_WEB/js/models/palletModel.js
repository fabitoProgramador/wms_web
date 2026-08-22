/**
 * Helpers de presentación para pallets.
 * Ningún helper fabrica datos maestros: ID, descripción, kilos y código visual
 * se toman del backend/snapshot confirmado. Sólo se normaliza formato.
 */
const PalletModel = {
  numeroArticulo(pallet) {
    if (pallet?.numero_articulo) return String(pallet.numero_articulo);
    if (pallet?.itemcode) return String(pallet.itemcode);
    const id = this.idLoteReal(pallet);
    return id.length >= 9 ? `${id.slice(0, 2)}${id.slice(4, 9)}` : '';
  },

  idLoteReal(pallet) {
    return String(pallet?.id_lote_real || pallet?.id_lote || pallet?.lote || '').trim();
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
    const value = pallet?.kilos_logicos ?? pallet?.kilos ?? pallet?.kilos_stock;
    if (value === null || value === undefined || value === '') return 0;
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  },

  descripcion(pallet) {
    return pallet?.descripcion || pallet?.itemname || 'Sin descripción SAP disponible';
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

  // Se conserva como utilidad visual para código no productivo; la asignación
  // real artículo->letra se realiza exclusivamente mediante RPC de Supabase.
  siguienteLetra(usadas) {
    const alfabeto = IDENTIDAD_PLANTA.alfabetoEspanol;
    for (let largo = 1; ; largo += 1) {
      const total = Math.pow(alfabeto.length, largo);
      for (let indice = 0; indice < total; indice += 1) {
        let n = indice, codigo = '';
        for (let pos = 0; pos < largo; pos += 1) {
          codigo = alfabeto[n % alfabeto.length] + codigo;
          n = Math.floor(n / alfabeto.length);
        }
        if (!usadas.has(codigo)) return codigo;
      }
    }
  },

  codigoVisual(pallet, letrasPorArticulo = LETRAS_POR_ARTICULO) {
    if (pallet?._codigo_visual_manual) return String(pallet._codigo_visual_manual).replace(/-/g, '');
    if (pallet?.codigo_visual_backend) return String(pallet.codigo_visual_backend).replace(/-/g, '');
    const letra = letrasPorArticulo?.[pallet?.articulo];
    const numero = String(pallet?.numero_pallet || '').replace(/^0+(?=\d)/, '');
    return letra && numero ? `${letra}${numero}` : '?';
  },

  codigoVisualLegible(pallet, letrasPorArticulo = LETRAS_POR_ARTICULO) {
    if (pallet?.codigo_visual_legible_backend) return String(pallet.codigo_visual_legible_backend);
    const raw = this.codigoVisual(pallet, letrasPorArticulo);
    const match = raw.match(/^([A-ZÑ]{1,2})(\d+)$/i);
    return match ? `${match[1].toUpperCase()}-${match[2]}` : raw;
  },

  normalizarCodigo(texto) {
    return (texto || '').toString().trim().toUpperCase().replace(/-/g, '').replace(/\s+/g, '');
  },

  clavesDeBusqueda(pallet) {
    const claves = new Set();
    [this.idLoteReal(pallet), this.codigoVisual(pallet), this.codigoVisualLegible(pallet)]
      .forEach(valor => {
        const texto = String(valor ?? '').trim().toUpperCase();
        if (!texto || texto === '?') return;
        claves.add(texto);
        const plano = this.normalizarCodigo(texto);
        if (plano) claves.add(plano);
      });
    return claves;
  },

  normalizarLote(texto) { return (texto || '').toString().trim().toUpperCase(); },

  colorCeldaCarga(pallet, mapa, dbPallets = []) {
    if (pallet.repetido) return COLOR_MAPA_REPETIDO;
    if (pallet.no_existe || pallet.no_existe_padre) return COLOR_MAPA_NO_EXISTE;
    if (mapa === 'postunel') return this.colorParaArticuloPostunel(pallet.articulo, dbPallets);
    return COLORES_MAPA_ESTADO[pallet.estado] || '#64748B';
  },

  colorParaArticuloPostunel(articulo, dbPallets) {
    const articulosDisponibles = Array.from(new Set(
      (dbPallets || []).filter(p => p.ubicacion === 'POST TUNEL' && p.banda !== null && p.banda !== undefined).map(p => p.articulo).filter(Boolean)
    )).sort();
    const indice = articulosDisponibles.indexOf(articulo);
    return indice === -1 ? '#64748B' : PALETA_ARTICULOS_POSTUNEL[indice % PALETA_ARTICULOS_POSTUNEL.length];
  }
};
