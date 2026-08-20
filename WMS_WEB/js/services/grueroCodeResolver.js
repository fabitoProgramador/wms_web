/**
 * Resolvedor único de códigos para Operaciones Gruero.
 * Lector HID, cámara e ingreso manual consumen exactamente este contrato.
 */
const GrueroCodeResolver = {
  boxParsers: [],

  normalize(value) {
    return String(value ?? '')
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .trim()
      .toUpperCase();
  },

  comparable(value) {
    return PalletModel.normalizarCodigo(this.normalize(value));
  },

  inputChannel(source) {
    const value = String(source || '').toLocaleUpperCase('es-CL');
    if (value.includes('CÁMARA') || value.includes('CAMARA')) return 'CAMARA';
    if (value.includes('LECTOR') || value.includes('HID') || value.includes('USB') || value.includes('BLUETOOTH')) return 'LECTOR';
    return 'MANUAL';
  },

  numericCode(value) {
    const normalized = this.normalize(value);
    if (!normalized || !/^[0-9\s|/_.-]+$/.test(normalized)) return null;
    return normalized.replace(/\D/g, '');
  },

  idPallet(temporada, planta, articulo, pallet) {
    return `${temporada}-${planta}-${articulo}-${pallet}`;
  },

  canonicalPalletId(pallet) {
    return this.numericCode(PalletModel.idLoteReal(pallet));
  },

  palletIdentity(pallet) {
    const parts = PalletModel.desglosarIdLote(PalletModel.idLoteReal(pallet));
    const numero = String(parts.numero_pallet || pallet.numero_pallet || '').trim();
    return {
      temporada: String(parts.temporada || ''),
      planta: String(parts.planta || ''),
      articulo: String(parts.articulo || pallet.articulo || ''),
      numeroPallet: numero,
      caja: null,
      loteProduccion: null,
      idPallet: this.idPallet(parts.temporada, parts.planta, parts.articulo || pallet.articulo || '', numero)
    };
  },
  /**
   * Estructura fija de los extremos:
   * TT + PP + AAAAA + ([lote producción] + pallet 3/4) + CCC.
   * La longitud del lote de producción no participa en la decisión.
   */
  boxCandidates(normalizedCode) {
    const digits = this.numericCode(normalizedCode);
    if (!digits || digits.length < 15) return [];
    const temporada = digits.slice(0, 2);
    const planta = digits.slice(2, 4);
    const articulo = digits.slice(4, 9);
    const caja = digits.slice(-3);
    const middle = digits.slice(9, -3);
    return [3, 4].filter(length => middle.length >= length).map(length => {
      const numeroPallet = middle.slice(-length);
      const loteProduccion = middle.slice(0, -length) || null;
      const canonicalId = `${temporada}${planta}${articulo}${numeroPallet}`;
      return {
        temporada, planta, articulo, numeroPallet, caja, loteProduccion,
        idPallet: this.idPallet(temporada, planta, articulo, numeroPallet),
        canonicalId,
        largoPallet: length
      };
    });
  },

  validateCandidates(candidates, pallets) {
    return candidates.map(candidate => ({
      ...candidate,
      matches: pallets.filter(pallet => this.canonicalPalletId(pallet) === candidate.canonicalId)
    })).filter(candidate => candidate.matches.length > 0);
  },

  exactMatches(normalizedCode, pallets) {
    const comparable = this.comparable(normalizedCode);
    const matches = [];
    pallets.forEach(pallet => {
      const kinds = [];
      if (this.comparable(PalletModel.idLoteReal(pallet)) === comparable || this.comparable(pallet.id) === comparable) kinds.push('pallet');
      if (this.comparable(PalletModel.codigoVisual(pallet)) === comparable || PalletModel.normalizarLote(pallet.lote) === PalletModel.normalizarLote(normalizedCode)) kinds.push('manual');
      if (kinds.length) matches.push({ pallet, kind: kinds.includes('pallet') ? 'pallet' : 'manual' });
    });
    return matches;
  },

  associatedBoxMatches(normalizedCode, pallets) {
    const comparable = this.comparable(normalizedCode);
    return pallets.filter(pallet => Array.isArray(pallet.cajas_asociadas) && pallet.cajas_asociadas.some(code => this.comparable(code) === comparable));
  },

  ambiguity(context, candidates, message = 'El código coincide con más de un pallet.') {
    return {
      ok: false,
      ...context,
      ambiguity: true,
      codeType: 'ambiguo',
      candidates: candidates.map(candidate => ({
        idPallet: candidate.idPallet || this.palletIdentity(candidate.pallet).idPallet,
        largoPallet: candidate.largoPallet || String(candidate.pallet?.numero_pallet || '').length
      })),
      error: `Código ambiguo: ${message} No se asignó ningún pallet.`
    };
  },

  resolverCodigo(rawValue, source = 'MANUAL') {
    const codigoOriginal = String(rawValue ?? '');
    const normalizedCode = this.normalize(codigoOriginal);
    const canalEntrada = this.inputChannel(source);
    const context = { source, canalEntrada, rawCode: codigoOriginal, codigoOriginal, normalizedCode, codigoNormalizado: normalizedCode };
    if (!normalizedCode) return { ok: false, ...context, error: 'Escaneá o ingresá un código.' };

    const pallets = MapaModel.getPallets();
    const exact = this.exactMatches(normalizedCode, pallets);
    if (exact.length > 1) return this.ambiguity(context, exact, 'la identificación directa existe en más de un registro.');
    if (exact.length === 1) {
      const origin = exact[0].kind === 'pallet' ? 'PALLET' : (canalEntrada === 'MANUAL' ? 'MANUAL' : 'PALLET');
      return this.result(exact[0].pallet, { ...context, codeType: 'pallet', origenCodigo: origin });
    }

    const candidates = this.boxCandidates(normalizedCode);
    const validCandidates = this.validateCandidates(candidates, pallets);
    const associated = this.associatedBoxMatches(normalizedCode, pallets);

    if (associated.length > 1) return this.ambiguity(context, associated.map(pallet => ({ pallet })), 'la caja está asociada a más de un pallet.');

    if (associated.length === 1) {
      const associatedPallet = associated[0];
      const conflicting = validCandidates.filter(candidate => !candidate.matches.includes(associatedPallet));
      if (conflicting.length) return this.ambiguity(context, validCandidates, 'la asociación de caja contradice los candidatos de 3/4 dígitos.');
      const parsed = validCandidates.find(candidate => candidate.matches.includes(associatedPallet));
      return this.result(associatedPallet, { ...context, ...(parsed || this.palletIdentity(associatedPallet)), codeType: 'caja', origenCodigo: 'CAJA', boxCode: normalizedCode });
    }

    const matches = validCandidates.flatMap(candidate => candidate.matches.map(pallet => ({ ...candidate, pallet })));
    if (matches.length > 1) return this.ambiguity(context, matches, 'son válidos los candidatos de pallet de 3 y/o 4 dígitos.');
    if (matches.length === 1) {
      const match = matches[0];
      const { pallet, matches: _matches, canonicalId: _canonicalId, ...parsed } = match;
      return this.result(pallet, { ...context, ...parsed, codeType: 'caja', origenCodigo: 'CAJA', boxCode: normalizedCode });
    }

    for (const entry of this.boxParsers) {
      const parsed = entry.parser({ rawCode: codigoOriginal, normalizedCode, comparable: this.comparable(normalizedCode), pallets });
      if (!parsed) continue;
      const parserMatches = parsed.pallet ? [parsed.pallet] : pallets.filter(item => item.id === parsed.palletId);
      if (parserMatches.length > 1) return this.ambiguity(context, parserMatches.map(pallet => ({ pallet })), `el parser ${entry.name} devolvió más de un resultado.`);
      if (parserMatches.length === 1) return this.result(parserMatches[0], { ...context, codeType: 'caja', origenCodigo: 'CAJA', parser: entry.name, boxCode: parsed.boxCode || normalizedCode });
    }

    return { ok: false, ...context, codeType: 'desconocido', candidates: candidates.map(({ canonicalId, ...candidate }) => candidate), error: 'Código no reconocido.' };
  },

  // Alias de compatibilidad para integraciones anteriores. Toda entrada nueva
  // debe utilizar resolverCodigo(), que contiene el flujo único y completo.
  resolve(rawValue, source = 'MANUAL') {
    return this.resolverCodigo(rawValue, source);
  },

  result(pallet, context) {
    const identity = this.palletIdentity(pallet);
    const structured = context.codeType === 'caja' ? {
      temporada: context.temporada || identity.temporada,
      planta: context.planta || identity.planta,
      articulo: context.articulo || identity.articulo,
      numeroPallet: context.numeroPallet || identity.numeroPallet,
      caja: context.caja || null,
      loteProduccion: context.loteProduccion || null,
      idPallet: context.idPallet || identity.idPallet
    } : identity;
    return {
      ok: true,
      pallet,
      ...context,
      ...structured,
      datosCodigo: {
        temporada: structured.temporada,
        planta: structured.planta,
        articulo: structured.articulo,
        pallet: structured.numeroPallet,
        caja: structured.caja,
        loteProduccion: structured.loteProduccion,
        idPallet: structured.idPallet
      },
      origenCodigo: context.origenCodigo || (context.codeType === 'caja' ? 'CAJA' : 'PALLET'),
      normalized: {
        idLoteReal: PalletModel.idLoteReal(pallet),
        articulo: String(pallet.articulo || ''),
        numeroPallet: String(pallet.numero_pallet || ''),
        referenciaVisual: PalletModel.codigoVisualLegible(pallet),
        ubicacion: pallet.ubicacion,
        banda: pallet.banda,
        posicion: pallet.posicion,
        nivel: pallet.altura
      }
    };
  }
};
