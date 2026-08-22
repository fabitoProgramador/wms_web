/**
 * Agregar Código: adaptador remoto del catálogo visual artículo -> letra.
 * La identidad del usuario y la auditoría las resuelve Supabase; no se guardan
 * letras ni responsables en localStorage.
 */
const MapaCodigoModel = {
  numero(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  },

  uuid() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 3 | 8)).toString(16);
    });
  },

  async rpc(nombre, parametros = {}) {
    const response = await SupabaseService.rpc('mapa', nombre, parametros);
    if (!response.ok) {
      const error = new Error(response.error || `No fue posible ejecutar mapa.${nombre}.`);
      error.estado = response.estado;
      error.permiso = response.permiso;
      error.red = response.red;
      throw error;
    }
    return response.datos;
  },

  normalizarItem(row = {}) {
    return {
      ...row,
      codigo: String(row.codigo || '').trim(),
      descripcion: row.descripcion || 'Sin descripción SAP disponible',
      letra: String(row.letra || '').trim().toUpperCase(),
      pallets: this.numero(row.pallets),
      cajas: this.numero(row.cajas),
      palletsStock: this.numero(row.pallets_stock),
      palletsMapa: this.numero(row.pallets_mapa),
      palletsNoExiste: this.numero(row.pallets_no_existe),
      activoEnInventario: Boolean(row.activo_en_inventario),
      asignadoEn: row.asignado_en || null
    };
  },

  async catalogo(busqueda = '', historialLimite = 8) {
    const data = await this.rpc('catalogoCodigos', {
      p_busqueda: String(busqueda || '').trim(),
      p_historial_limite: historialLimite
    });
    return {
      raw: data,
      resumen: {
        articulos: this.numero(data?.resumen?.articulos),
        asignados: this.numero(data?.resumen?.asignados),
        pendientes: this.numero(data?.resumen?.pendientes)
      },
      siguienteLetra: String(data?.siguiente_letra || '').trim().toUpperCase(),
      items: (data?.items || []).map(row => this.normalizarItem(row)),
      historial: (data?.historial || []).map(row => ({
        ...row,
        codigo: String(row.codigo || ''),
        accion: row.accion || '—',
        letraAnterior: row.letra_anterior || '—',
        letraNueva: row.letra_nueva || '—',
        usuario: row.usuario || 'Sistema',
        rol: row.rol || '',
        motivo: row.motivo || '',
        fecha: row.fecha || null
      }))
    };
  },

  async guardar(codigo, letra, motivo = '') {
    return this.rpc('guardarCodigo', {
      p_codigo: String(codigo || '').trim(),
      p_letra: String(letra || '').trim().toUpperCase(),
      p_motivo: String(motivo || '').trim() || null,
      p_operacion_uuid: this.uuid()
    });
  },

  async liberar(codigo, motivo = '') {
    return this.rpc('liberarCodigo', {
      p_codigo: String(codigo || '').trim(),
      p_motivo: String(motivo || '').trim() || null,
      p_operacion_uuid: this.uuid()
    });
  }
};
