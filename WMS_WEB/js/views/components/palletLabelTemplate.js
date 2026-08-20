/**
 * Plantilla oficial de etiqueta de pallet (100 × 50 mm).
 * No conoce de pantallas ni de datos WMS: sólo recibe el contrato imprimible.
 */
const PalletLabelTemplate = {
  DEFAULT_SYMBOLOGY: 'CODE39', // Provisional: la Zebra definirá la simbología final.
  esc(value) { const node = document.createElement('span'); node.textContent = String(value ?? ''); return node.innerHTML; },
  barcodeSvg(value, symbology = this.DEFAULT_SYMBOLOGY) {
    // Code 39 es un respaldo lineal configurable mientras se valida la Zebra.
    // Sólo codifica el ID oficial recibido; los asteriscos son sentinelas técnicos.
    const patterns = {
      '0':'101001101101','1':'110100101011','2':'101100101011','3':'110110010101','4':'101001101011','5':'110100110101','6':'101100110101','7':'101001011011','8':'110100101101','9':'101100101101',
      'A':'110101001011','B':'101101001011','C':'110110100101','D':'101011001011','E':'110101100101','F':'101101100101','G':'101010011011','H':'110101001101','I':'101101001101','J':'101011001101',
      'K':'110101010011','L':'101101010011','M':'110110101001','N':'101011010011','O':'110101101001','P':'101101101001','Q':'101010110011','R':'110101011001','S':'101101011001','T':'101011011001',
      'U':'110010101011','V':'100110101011','W':'110011010101','X':'100101101011','Y':'110010110101','Z':'100110110101','-':'100101011011','.':'110010101101',' ':'100110101101','$':'100100100101','/':'100100101001','+':'100101001001','%':'101001001001','*':'100101101101'
    };
    const normalized = String(value || '').toUpperCase().replace(/[^0-9A-Z .\-$/+%]/g, '');
    const encoded = `*${normalized}*`;
    const modules = encoded.split('').flatMap((char, index) => [...patterns[char]].concat(index < encoded.length - 1 ? ['0'] : []));
    const barWidth = 1.35, quiet = 12, width = quiet * 2 + modules.length * barWidth;
    let x = quiet, bars = '';
    modules.forEach(bit => { if (bit === '1') bars += `<rect x="${x.toFixed(2)}" y="0" width="${barWidth}" height="52"/>`; x += barWidth; });
    return `<svg class="pallet-label-barcode" data-symbology="${this.esc(symbology)}" viewBox="0 0 ${width.toFixed(2)} 52" role="img" aria-label="Código de barras para ${this.esc(value)}" preserveAspectRatio="none">${bars}</svg>`;
  },
  render({ companyName = 'Fruticola Olmue', articleCode = '', articleDescription = '', lotCode = '', barcodeValue = lotCode, symbology = this.DEFAULT_SYMBOLOGY } = {}) {
    const safe = value => this.esc(value);
    // El tamano y el fondo salen de la configuracion; la plantilla no los fija.
    const cfg = (typeof LabelFormatService !== 'undefined') ? LabelFormatService : null;
    const vars = cfg ? cfg.cssVars() : '';
    const medida = cfg ? cfg.format().label : '100 × 50 mm';
    return `<article class="pallet-label" style="${vars}" aria-label="Vista previa de etiqueta de pallet de ${this.esc(medida)}">
      <h2>${safe(companyName)}</h2>
      <dl class="pallet-label-fields">
        <dt>Codigo Articulo</dt><dd>${safe(articleCode)}</dd>
        <dt>Nombre Articulo</dt><dd class="pallet-label-description">${safe(articleDescription)}</dd>
        <dt>Codigo Lote</dt><dd>${safe(lotCode)}</dd>
      </dl>
      <div class="pallet-label-barcode-wrap">${this.barcodeSvg(barcodeValue, symbology)}<p>${safe(lotCode)}</p></div>
    </article>`;
  }
};
