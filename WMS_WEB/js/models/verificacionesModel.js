/**
 * Registro de Verificaciones remoto.
 *
 * Fuente de verdad: RPC public.wms_verificacion* / wms_verificaciones*.
 * No usa localStorage para datos de negocio.
 */
const VerificacionesModel = {
  numero(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  },

  uuid() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  },

  fechaIso(value) {
    const raw = String(value || '').trim();
    if (!raw) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    const m = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
    if (!m) return null;
    return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  },

  fechaVisible(value) {
    const iso = this.fechaIso(value);
    if (!iso) return String(value || '—');
    const [y,m,d] = iso.split('-');
    return `${d}/${m}/${y}`;
  },

  hoyIso() {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone:'America/Santiago', year:'numeric', month:'2-digit', day:'2-digit'
    }).formatToParts(new Date());
    const get = t => parts.find(x => x.type === t)?.value;
    return `${get('year')}-${get('month')}-${get('day')}`;
  },

  async rpc(nombre, parametros = {}) {
    const response = await SupabaseService.rpc('verificaciones', nombre, parametros);
    if (!response.ok) {
      const error = new Error(response.error || `No fue posible ejecutar verificaciones.${nombre}.`);
      error.estado = response.estado;
      error.permiso = response.permiso;
      error.red = response.red;
      error.conflictoVersion = /CONFLICTO_VERSION_VERIFICACION/i.test(String(response.error || ''));
      throw error;
    }
    return response.datos;
  },

  listar({ buscar = '', fecha = '', turno = 'TODOS', limite = 30, offset = 0 } = {}) {
    return this.rpc('listar', {
      p_buscar: String(buscar || '').trim() || null,
      p_fecha: this.fechaIso(fecha),
      p_turno: turno || 'TODOS',
      p_limite: limite,
      p_offset: offset
    });
  },

  turno(fecha, turno, limite = 200, offset = 0) {
    return this.rpc('turno', {
      p_fecha: this.fechaIso(fecha),
      p_turno: turno,
      p_limite: limite,
      p_offset: offset
    });
  },

  detalle(id) {
    return this.rpc('detalle', { p_verificacion_id:Number(id) });
  },

  resolverLote(codigo, limite = 30) {
    return this.rpc('resolverLote', { p_codigo:String(codigo || '').trim(), p_limite:limite });
  },

  folios(value) {
    if (Array.isArray(value)) return [...new Set(value.map(x => parseInt(x,10)).filter(x => Number.isInteger(x) && x > 0))].sort((a,b)=>a-b);
    return [...new Set(String(value || '').split(/[,;\s]+/).map(x => parseInt(String(x).replace(/\D/g,''),10)).filter(x => Number.isInteger(x) && x > 0))].sort((a,b)=>a-b);
  },

  async resolverDetalle(codigo) {
    const data = await this.resolverLote(codigo, 10);
    if (!data?.total) throw new Error(`No se encontró el pallet “${codigo}” en el stock actual.`);
    if (data.ambiguo || data.total !== 1) throw new Error(`El código “${codigo}” es ambiguo. Usa el ID de lote completo.`);
    const item = data.items?.[0];
    if (!item?.instancia_id || !item?.id_lote) throw new Error(`No se pudo resolver la instancia WMS de “${codigo}”.`);
    return item;
  },

  /**
   * Cada fila debe identificar un pallet real. La primera puede reutilizar el
   * código principal; si hay varias filas, las adicionales exigen su propio
   * ID/código para no adivinar identidades a partir de un número de pallet.
   */
  async prepararDetalles(codigoPrincipal, rows = []) {
    const limpios = (rows || []).map(row => ({
      codigo: String(row?.id_lote || row?.codigo || '').trim(),
      motivo: String(row?.motivo || '').trim(),
      folios: this.folios(row?.folios ?? row?.cajas)
    })).filter(row => row.codigo || row.motivo || row.folios.length);

    if (!limpios.length) throw new Error('Debe agregar al menos un pallet.');
    const resolved = [];
    for (let i = 0; i < limpios.length; i += 1) {
      const row = limpios[i];
      const codigo = row.codigo || (i === 0 ? String(codigoPrincipal || '').trim() : '');
      if (!codigo) throw new Error(`La fila ${i + 1} necesita un ID de lote o código visual.`);
      if (!row.motivo) throw new Error(`La fila ${i + 1} necesita un motivo.`);
      const pallet = await this.resolverDetalle(codigo);
      resolved.push({
        instancia_id: pallet.instancia_id,
        id_lote: pallet.id_lote,
        numero_pallet: pallet.numero_pallet || String(pallet.id_lote).slice(9),
        motivo: row.motivo,
        folios: row.folios,
        itemcode: pallet.itemcode,
        itemname: pallet.itemname,
        whscode: pallet.whscode,
        whsname: pallet.whsname
      });
    }

    const articulos = new Set(resolved.map(x => String(x.itemcode || '').trim()).filter(Boolean));
    if (articulos.size > 1) throw new Error('Todos los pallets del registro deben corresponder al mismo artículo.');
    return resolved;
  },

  async crear({ fecha, turno, tipo, codigo, detalles = [] } = {}) {
    const preparados = await this.prepararDetalles(codigo, detalles);
    const principal = String(codigo || '').trim() || preparados[0].id_lote;
    return this.rpc('crear', {
      p_fecha_operacional: this.fechaIso(fecha) || this.hoyIso(),
      p_turno: turno,
      p_tipo: String(tipo || '').toUpperCase(),
      p_codigo_lote: principal,
      p_detalles: preparados.map(x => ({ instancia_id:x.instancia_id, id_lote:x.id_lote, numero_pallet:x.numero_pallet, motivo:x.motivo, folios:x.folios })),
      p_operacion_uuid: this.uuid()
    });
  },

  async modificar({ id, version, fecha, turno, tipo, codigo, detalles = [] } = {}) {
    const preparados = await this.prepararDetalles(codigo, detalles);
    const principal = String(codigo || '').trim() || preparados[0].id_lote;
    return this.rpc('modificar', {
      p_verificacion_id: Number(id),
      p_version_esperada: Number(version),
      p_fecha_operacional: this.fechaIso(fecha) || this.hoyIso(),
      p_turno: turno,
      p_tipo: String(tipo || '').toUpperCase(),
      p_codigo_lote: principal,
      p_detalles: preparados.map(x => ({ instancia_id:x.instancia_id, id_lote:x.id_lote, numero_pallet:x.numero_pallet, motivo:x.motivo, folios:x.folios })),
      p_operacion_uuid: this.uuid()
    });
  },

  anular({ id, version, motivo = '' } = {}) {
    return this.rpc('anular', {
      p_verificacion_id: Number(id),
      p_version_esperada: Number(version),
      p_motivo: String(motivo || '').trim() || null,
      p_operacion_uuid: this.uuid()
    });
  },

  anularTurno({ fecha, turno, motivo = '' } = {}) {
    return this.rpc('anularTurno', {
      p_fecha: this.fechaIso(fecha),
      p_turno: turno,
      p_motivo: String(motivo || '').trim() || null,
      p_operacion_uuid: this.uuid()
    });
  }
};