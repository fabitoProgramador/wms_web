/**
 * Bitácora operacional remota.
 *
 * Fuente de verdad: RPC public.wms_bitacora_* / wms_*_bitacora.
 * Este modelo NO lee ni escribe localStorage.
 */
const BitacoraModel = {
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
      timeZone: 'America/Santiago', year:'numeric', month:'2-digit', day:'2-digit'
    }).formatToParts(new Date());
    const get = t => parts.find(x => x.type === t)?.value;
    return `${get('year')}-${get('month')}-${get('day')}`;
  },

  limpiarTextoRows(rows = [], fields = []) {
    return (rows || []).map(row => Object.fromEntries(fields.map(f => [f, String(row?.[f] ?? '').trim()])))
      .filter(row => fields.every(f => row[f]));
  },

  ajustes({ verificados = [], rechazados = [], reproceso = 0 } = {}) {
    const out = [];
    const append = (tipo, rows) => (rows || []).forEach(row => {
      const motivo = String(row?.motivo || '').trim();
      const cantidad = Math.max(0, parseInt(row?.cantidad, 10) || 0);
      if (motivo && cantidad > 0) out.push({ tipo, motivo, cantidad });
    });
    append('VERIFICADO', verificados);
    append('RECHAZADO', rechazados);
    const rep = Math.max(0, parseInt(reproceso, 10) || 0);
    if (rep > 0) out.push({ tipo:'REPROCESO', cantidad:rep });
    return out;
  },

  separarAjustes(rows = []) {
    const value = { verificados:[], rechazados:[], reproceso:0 };
    (rows || []).forEach(row => {
      const tipo = String(row?.tipo || '').toUpperCase();
      const item = { motivo:String(row?.motivo || '').trim(), cantidad:this.numero(row?.cantidad) };
      if (tipo === 'VERIFICADO') value.verificados.push(item);
      else if (tipo === 'RECHAZADO') value.rechazados.push(item);
      else if (tipo === 'REPROCESO') value.reproceso += item.cantidad;
    });
    return value;
  },

  async rpc(nombre, parametros = {}) {
    const response = await SupabaseService.rpc('bitacora', nombre, parametros);
    if (!response.ok) {
      const error = new Error(response.error || `No fue posible ejecutar bitacora.${nombre}.`);
      error.estado = response.estado;
      error.permiso = response.permiso;
      error.red = response.red;
      error.conflictoVersion = /CONFLICTO_VERSION_BITACORA/i.test(String(response.error || ''));
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

  detalle(id, { incluirPendientes = true, limitePendientes = 50, offsetPendientes = 0 } = {}) {
    return this.rpc('detalle', {
      p_bitacora_id: Number(id),
      p_incluir_pendientes: Boolean(incluirPendientes),
      p_limite_pendientes: limitePendientes,
      p_offset_pendientes: offsetPendientes
    });
  },

  pendientes(limite = 50, offset = 0) {
    return this.rpc('pendientes', { p_limite:limite, p_offset:offset });
  },

  precarga(turno) {
    return this.rpc('precarga', { p_turno:turno });
  },

  turno(fecha, turno) {
    return this.rpc('turno', { p_fecha_operacional:this.fechaIso(fecha), p_turno:turno });
  },

  kpiDetalle(bitacoraId, tipo) {
    return this.rpc('kpiDetalle', { p_bitacora_id:Number(bitacoraId), p_tipo:tipo });
  },

  pendienteAuditoria(instanciaId, limite = 30) {
    return this.rpc('pendienteAuditoria', { p_instancia_id:Number(instanciaId), p_limite:limite });
  },

  crear({ fecha, turno, planificacion = [], resumen = [], verificados = [], rechazados = [], reproceso = 0 } = {}) {
    const fechaIso = this.fechaIso(fecha) || this.hoyIso();
    return this.rpc('crear', {
      p_fecha_operacional: fechaIso,
      p_turno: turno,
      p_planificacion: this.limpiarTextoRows(planificacion, ['etiqueta','valor']),
      p_resumen_manual: this.limpiarTextoRows(resumen, ['texto']),
      p_ajustes_kpi: this.ajustes({ verificados, rechazados, reproceso }),
      p_operacion_uuid: this.uuid()
    });
  },

  modificar({ id, version, turno, planificacion = [], resumen = [], verificados = [], rechazados = [], reproceso = 0 } = {}) {
    return this.rpc('modificar', {
      p_bitacora_id: Number(id),
      p_version_esperada: Number(version),
      p_turno: turno,
      p_planificacion: this.limpiarTextoRows(planificacion, ['etiqueta','valor']),
      p_resumen_manual: this.limpiarTextoRows(resumen, ['texto']),
      p_ajustes_kpi: this.ajustes({ verificados, rechazados, reproceso }),
      p_operacion_uuid: this.uuid()
    });
  },

  anular({ id, version, motivo = '' } = {}) {
    return this.rpc('anular', {
      p_bitacora_id: Number(id),
      p_version_esperada: Number(version),
      p_motivo: String(motivo || '').trim() || null,
      p_operacion_uuid: this.uuid()
    });
  }
};