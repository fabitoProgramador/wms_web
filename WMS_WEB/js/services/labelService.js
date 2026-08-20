/**
 * Adaptador de datos del Centro de Etiquetas.
 * Lee exclusivamente de los modelos locales existentes; no crea ni persiste pallets.
 */
const LabelService = {
  companyName: 'Fruticola Olmue',
  toLabel(pallet) {
    const lotCode = PalletModel.idLoteReal(pallet);
    return {
      companyName: this.companyName,
      articleCode: PalletModel.numeroArticulo(pallet),
      articleDescription: PalletModel.descripcion(pallet),
      lotCode,
      barcodeValue: lotCode,
      symbology: PalletLabelTemplate.DEFAULT_SYMBOLOGY,
      reference: PalletModel.codigoVisualLegible(pallet),
      source: 'pallet'
    };
  },
  officialLot(value) { return String(value || '').trim().replace(/[\s-]+/g, ''); },
  anticipatedLabel(value) {
    const lotCode = this.officialLot(value);
    if (!/^\d+$/.test(lotCode)) return null;
    const parts = PalletModel.desglosarIdLote(lotCode);
    const article = String(parts.articulo || '');
    const description = CATALOGO_ARTICULOS[article]?.descripcion;
    if (!description || lotCode.length <= 4 + IDENTIDAD_PLANTA.largoCodigoArticulo) return null;
    return {
      companyName: this.companyName,
      articleCode: `${parts.temporada}${article}`,
      articleDescription: description,
      lotCode,
      barcodeValue: lotCode,
      symbology: PalletLabelTemplate.DEFAULT_SYMBOLOGY,
      reference: lotCode,
      source: 'anticipated'
    };
  },
  /**
   * Referencia corta del mapa: "A20", "a-20", "A020" -> letra + número de
   * pallet. Es sólo una forma rápida de entrada; internamente siempre se
   * trabaja con el ID oficial que se arma en officialFromShort().
   */
  shortReference(value) {
    const match = String(value || '').trim().toUpperCase().replace(/[\s-]+/g, '').match(/^([A-ZÑ]{1,2})(\d{1,4})$/);
    if (!match) return null;
    return { letra: match[1], numero: match[2].padStart(3, '0') };
  },

  /** Artículo real al que corresponde una letra visual del mapa. */
  articleForLetter(letra) {
    return Object.keys(LETRAS_POR_ARTICULO).find(articulo => String(LETRAS_POR_ARTICULO[articulo]).toUpperCase() === String(letra).toUpperCase()) || null;
  },

  /** A20 -> A020 -> artículo -> ID de lote oficial. */
  officialFromShort(value) {
    const short = this.shortReference(value);
    if (!short) return null;
    const articulo = this.articleForLetter(short.letra);
    if (!articulo) return null;
    return { articulo, numero: short.numero, normalizada: `${short.letra}${short.numero}`, lotCode: `${IDENTIDAD_PLANTA.temporadaActual}${IDENTIDAD_PLANTA.codigoPlantaLote}${articulo}${short.numero}` /* misma formula que PalletModel.idLoteReal */ };
  },

  /**
   * Orden de resolución, de lo más específico a lo más deducido:
   *   1. pallet real por código, ID o lote;
   *   2. coincidencia en stock;
   *   3. referencia corta del mapa (A20) traducida a ID oficial;
   *   4. ID de lote todavía no consolidado, deduciendo el artículo del propio ID.
   * El usuario nunca elige el tipo de entrada.
   */
  resolve(value) {
    const query = String(value || '').trim();
    if (!query) return { ok: false, error: 'Ingresá o escaneá un ID de lote o referencia de pallet.' };
    const resolved = MapaModel.resolverPallet(query);
    if (resolved.ok) return { ok: true, label: this.toLabel(resolved.pallet), pallet: resolved.pallet };
    const stockMatch = StockModel.resolverBusqueda(query)[0];
    if (stockMatch) return { ok: true, label: this.toLabel(stockMatch), pallet: stockMatch };
    const short = this.officialFromShort(query);
    if (short) {
      const byLot = MapaModel.resolverPallet(short.lotCode);
      if (byLot.ok) return { ok: true, label: this.toLabel(byLot.pallet), pallet: byLot.pallet };
      const anticipatedShort = this.anticipatedLabel(short.lotCode);
      if (anticipatedShort) return { ok: true, label: { ...anticipatedShort, reference: short.normalizada }, pallet: null };
    }
    const anticipated = this.anticipatedLabel(query);
    if (anticipated) return { ok: true, label: anticipated, pallet: null };
    return { ok: false, error: 'No se encontró el pallet ni un artículo maestro para el código ingresado.' };
  },

  /**
   * Pallets consolidados más recientes: los que tienen datos maestros
   * completos, ordenados por fecha de ingreso descendente. Es la fuente real
   * más cercana a "recién salido de producción" que expone el proyecto hoy.
   */
  production(limit = 24) {
    const parseFecha = value => {
      const texto = String(value || '').trim();
      const iso = texto.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])).getTime();
      const dmy = texto.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
      if (dmy) return new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1])).getTime();
      return 0;
    };
    return MapaModel.getPallets()
      .filter(p => !p.pendiente_verificacion && String(p.articulo || '').trim() && PalletModel.idLoteReal(p))
      .map(p => ({ pallet: p, orden: parseFecha(p.fecha_admision || p.fecha_ingreso) }))
      .sort((a, b) => b.orden - a.orden || String(PalletModel.idLoteReal(b.pallet)).localeCompare(String(PalletModel.idLoteReal(a.pallet))))
      .slice(0, limit)
      .map(x => this.toLabel(x.pallet));
  },

  /** ¿Ese ID de lote existe hoy como pallet consolidado? */
  consolidated(lotCode) {
    const resolved = MapaModel.resolverPallet(String(lotCode || ''));
    return resolved.ok ? this.toLabel(resolved.pallet) : null;
  }
};
