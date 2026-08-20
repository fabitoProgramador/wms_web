/** Datos y cálculos exclusivos de Panel de Control. */
const PanelControlModel = {
  CAPACIDAD_TOTAL: 1500,
  BITACORAS_KEY: 'wms_web_panel_bitacoras',
  BITACORAS_SCHEMA_KEY: 'wms_web_panel_bitacoras_schema',
  BITACORAS_SCHEMA_VERSION: '1.0.0',
  VERIFICACIONES_KEY: 'wms_web_panel_verificaciones',
  VERIFICACIONES_SCHEMA_KEY: 'wms_web_panel_verificaciones_schema',
  VERIFICACIONES_SCHEMA_VERSION: '1.0.0',
  ESTADOS: ['VERIFICACIÓN', 'SIN DM', 'RECHAZO', 'LIBERADO', 'PROHIBICIONES', 'LOTES INCOMPLETOS', 'AUTORIZADOS A ENVIAR', 'SIN INFORMACIÓN', 'BLOQUEADOS', 'PEDIDO', 'REPROCESO'],

  normalizarEstado(v) { return String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase(); },
  estadoIgual(a, b) { return this.normalizarEstado(a) === this.normalizarEstado(b); },
  pallets() { return MapaModel.getPallets(); },
  contarEstado(e, ps = this.pallets()) { return ps.filter(p => this.estadoIgual(p.estado, e)).length; },
  cajasEstado(e, ps = this.pallets()) { return ps.filter(p => this.estadoIgual(p.estado, e)).reduce((s, p) => s + (Number(p.cajas) || 0), 0); },
  fechaPallet(p) { return p.fecha_admision || p.fecha_ingreso || ''; },

  // Adaptador de serie del dashboard. Hoy MapaModel entrega datos simulados;
  // una API futura puede reemplazar sólo este proveedor sin tocar el gráfico.
  fechaOrdenable(fecha) {
    const texto = String(fecha || '').trim();
    const match = texto.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
    if (!match) return texto;
    const [, dia, mes, anio] = match;
    return `${anio.length === 2 ? `20${anio}` : anio}${mes.padStart(2, '0')}${dia.padStart(2, '0')}`;
  },
  fechaTimestamp(valor) {
    const texto = String(valor || '').trim();
    if (!texto) return 0;
    const match = texto.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})(?:[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (match) {
      const [, d, m, rawYear, h = '0', min = '0', sec = '0'] = match;
      const year = Number(rawYear.length === 2 ? `20${rawYear}` : rawYear);
      return new Date(year, Number(m) - 1, Number(d), Number(h), Number(min), Number(sec)).getTime();
    }
    const iso = Date.parse(texto);
    return Number.isFinite(iso) ? iso : 0;
  },
  periodoDias(periodo) { return ({ HOY: 1, '7D': 7, '30D': 30, '90D': 90 })[periodo] || Infinity; },
  enPeriodo(fecha, periodo = '30D', ahora = Date.now()) {
    const dias = this.periodoDias(periodo), timestamp = this.fechaTimestamp(fecha);
    return dias === Infinity || (timestamp > 0 && timestamp >= ahora - dias * 86400000 && timestamp <= ahora + 86400000);
  },
  capacidadCamara(nombre) {
    if (nombre === 'PROTER' && typeof generarSlotsProter === 'function') return generarSlotsProter().length;
    if (nombre === 'POST TUNEL' && typeof generarSlotsPostunel === 'function') return generarSlotsPostunel().length;
    return 0;
  },
  filtrarCamara(pallets, camara = 'TODOS') { return camara === 'TODOS' ? pallets : pallets.filter(p => p.ubicacion === camara); },
  serieOcupacion(pallets = this.pallets(), limite = 10) {
    const conteoPorFecha = {};
    pallets.forEach(pallet => {
      const fecha = this.fechaPallet(pallet);
      if (fecha) conteoPorFecha[fecha] = (conteoPorFecha[fecha] || 0) + 1;
    });
    return Object.entries(conteoPorFecha)
      .sort(([a], [b]) => this.fechaOrdenable(a).localeCompare(this.fechaOrdenable(b)))
      .slice(-limite)
      .map(([fecha, valor]) => ({ fecha, valor }));
  },

  resumen() {
    const pallets = this.pallets(), stock = pallets.length;
    const porEstado = this.ESTADOS.map(nombre => {
      const cantidad = this.contarEstado(nombre, pallets);
      return { nombre, pallets: cantidad, cajas: this.cajasEstado(nombre, pallets), porcentaje: stock ? cantidad / stock * 100 : 0 };
    });
    return {
      pallets, stock, porEstado,
      cajas: pallets.reduce((s, p) => s + (Number(p.cajas) || 0), 0),
      disponibles: Math.max(0, this.CAPACIDAD_TOTAL - stock),
      ocupacion: Math.min(100, stock / this.CAPACIDAD_TOTAL * 100),
      camaras: new Set(pallets.map(p => p.ubicacion).filter(Boolean)).size,
      tendencia: this.serieOcupacion(pallets)
    };
  },

  analisis({ camara = 'TODOS', periodo = '30D' } = {}) {
    const pallets = this.filtrarCamara(this.pallets(), camara), stock = pallets.length;
    const porFecha = {}, productos = {};
    pallets.forEach(p => {
      const fecha = this.fechaPallet(p);
      if (fecha && this.enPeriodo(fecha, periodo)) porFecha[fecha] = (porFecha[fecha] || 0) + 1;
      const articulo = p.articulo || 'SIN ARTÍCULO'; productos[articulo] = (productos[articulo] || 0) + (Number(p.cajas) || 0);
    });
    const porEstado = this.ESTADOS.map(nombre => ({ nombre, pallets: this.contarEstado(nombre, pallets), cajas: this.cajasEstado(nombre, pallets) }));
    const verificaciones = this.getVerificaciones().filter(v => this.enPeriodo(v.registrado_en || v.actualizado_en || v.fecha, periodo));
    const cargas = MapaModel.getLoads().filter(c => this.enPeriodo(c.guardada_en, periodo)).filter(c => camara === 'TODOS' || (camara === 'PROTER' ? c.pestana === 'embarque' : c.pestana === 'postunel'));
    const verificados = verificaciones.filter(v => v.tipo === 'verificado').reduce((s, v) => s + (v.pallets || []).length, 0);
    const rechazados = verificaciones.filter(v => v.tipo === 'rechazado').reduce((s, v) => s + (v.pallets || []).length, 0);
    const despachados = cargas.reduce((s, c) => s + (c.pallets || []).length, 0);
    const capacidades = (camara === 'TODOS' ? ['PROTER', 'POST TUNEL'] : [camara]).map(nombre => {
      const total = pallets.filter(p => p.ubicacion === nombre).length;
      const posicionados = pallets.filter(p => p.ubicacion === nombre && p.banda !== null && p.banda !== undefined).length;
      const capacidad = this.capacidadCamara(nombre);
      return { nombre, total, posicionados, capacidad, porcentaje: capacidad ? posicionados / capacidad * 100 : 0 };
    });
    const capacidadTotal = capacidades.reduce((s, c) => s + c.capacidad, 0), posicionados = capacidades.reduce((s, c) => s + c.posicionados, 0);
    const distribucion = porEstado.filter(x => x.pallets).sort((a, b) => b.pallets - a.pallets);
    const insights = [];
    if (distribucion[0]) insights.push({ tipo: 'info', titulo: `${distribucion[0].nombre} concentra el mayor volumen`, detalle: `${distribucion[0].pallets} pallets · ${stock ? (distribucion[0].pallets / stock * 100).toFixed(1) : 0}% del stock visible.` });
    const mayorOcupacion = [...capacidades].sort((a, b) => b.porcentaje - a.porcentaje)[0];
    if (mayorOcupacion) insights.push({ tipo: mayorOcupacion.porcentaje >= 85 ? 'warning' : 'success', titulo: `${mayorOcupacion.nombre}: ${mayorOcupacion.porcentaje.toFixed(1)}% de posiciones utilizadas`, detalle: `${mayorOcupacion.posicionados} de ${mayorOcupacion.capacidad} posiciones físicas.` });
    const sinInfo = this.contarEstado('SIN INFORMACIÓN', pallets);
    if (sinInfo) insights.push({ tipo: 'warning', titulo: `${sinInfo} pallets requieren información`, detalle: 'El indicador proviene del estado actual del stock.' });
    return {
      camara, periodo, pallets, stock,
      cajas: pallets.reduce((s, p) => s + (Number(p.cajas) || 0), 0),
      ingresos: Object.entries(porFecha).sort(([a], [b]) => this.fechaOrdenable(a).localeCompare(this.fechaOrdenable(b))).slice(-14).map(([fecha, valor]) => ({ fecha, valor })),
      distribucion,
      topProductos: Object.entries(productos).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([nombre, valor]) => ({ nombre, valor })),
      camaras: capacidades,
      capacidadTotal, posicionados, ocupacion: capacidadTotal ? posicionados / capacidadTotal * 100 : 0,
      actividad: [{ nombre: 'Verificados', valor: verificados }, { nombre: 'Rechazados', valor: rechazados }, { nombre: 'Despachados', valor: despachados }],
      flujo: [
        { nombre: 'Sin información', valor: this.contarEstado('SIN INFORMACIÓN', pallets) },
        { nombre: 'Por verificar', valor: this.contarEstado('VERIFICACIÓN', pallets) + this.contarEstado('SIN DM', pallets) },
        { nombre: 'Observados', valor: this.contarEstado('RECHAZO', pallets) + this.contarEstado('BLOQUEADOS', pallets) + this.contarEstado('PROHIBICIONES', pallets) },
        { nombre: 'Liberados', valor: this.contarEstado('LIBERADO', pallets) },
        { nombre: 'Preparación envío', valor: pallets.filter(p => p.clasificacion_envio || this.estadoIgual(p.estado, 'PEDIDO') || this.estadoIgual(p.estado, 'AUTORIZADOS A ENVIAR')).length }
      ],
      insights
    };
  },

  async eventosOperacionales() {
    const eventos = [], ids = new Set(), agregar = evento => {
      const timestamp = this.fechaTimestamp(evento?.fecha);
      if (timestamp && !ids.has(evento.id)) { ids.add(evento.id); eventos.push({ severidad: 'info', usuario: '', ubicacion: '', detalle: '', ...evento, timestamp }); }
    };
    const nombresMapa = { MOVER_PALLET: 'Pallet movido', ASIGNAR_POSICION: 'Posición asignada', VACIAR_POSICION: 'Posición liberada', VACIAR_BANDA: 'Banda liberada', AGREGAR_CARGA: 'Pallet agregado a carga', QUITAR_CARGA: 'Pallet retirado de carga', DESPACHAR: 'Carga despachada', DESHACER: 'Movimiento deshecho', REHACER: 'Movimiento rehecho', EDITAR_REFERENCIA: 'Referencia editada', ASIGNAR_PALLET: 'Pallet asignado' };
    const [mapaPendientes, mapaConflictos, grueroPendientes, sesionesInventario, colaInventario] = await Promise.all([
      MapaOfflineService.pending().catch(() => []),
      MapaOfflineService.conflicts().catch(() => []),
      GrueroSyncService.list().catch(() => []),
      InventoryOperationService.sessions().catch(() => []),
      InventoryOperationService.queue().catch(() => [])
    ]);
    [...mapaPendientes, ...mapaConflictos].forEach(m => agregar({ id: `mapa-${m.id}`, fecha: m.createdAt || m.updatedAt, tipo: 'mapa', severidad: m.status === 'CONFLICTO' ? 'critical' : 'attention', titulo: nombresMapa[m.action] || m.action || 'Operación de mapa', pallet: m.palletCode || m.palletRealId || '', detalle: m.status === 'CONFLICTO' ? (m.reason || m.lastError || 'Conflicto pendiente') : 'Movimiento local pendiente de sincronización', ubicacion: m.destination?.ubicacion || m.origin?.ubicacion || '', usuario: m.userName || '', sincronizacion: m.status || 'PENDIENTE_SYNC' }));
    [...GrueroSyncService.history(), ...grueroPendientes].forEach(m => agregar({ id: `gruero-${m.id}`, fecha: m.confirmedAt || m.createdAt || m.deviceTime, tipo: 'gruero', severidad: m.status === 'conflict' ? 'critical' : m.status === 'server_confirmed' ? 'success' : 'attention', titulo: ({ move: 'Movimiento realizado por gruero', load: 'Pallet enviado a carga', return: 'Pallet devuelto a posición anterior' })[m.type] || 'Operación de gruero', pallet: m.palletCode || m.palletRealId || '', detalle: m.destination ? `Destino: ${m.destination.ubicacion || '—'} · Banda ${m.destination.banda ?? '—'} · P${m.destination.posicion ?? '—'}` : '', ubicacion: m.destination?.ubicacion || m.previous?.ubicacion || '', usuario: m.userName || '', sincronizacion: m.status }));
    sesionesInventario.forEach(s => (s.auditoria || []).forEach(a => agregar({ id: `inventario-${s.id}-${a.id}`, fecha: a.fecha, tipo: 'inventario', severidad: a.tipo === 'CONTEO_CON_DIFERENCIA' ? 'warning' : 'success', titulo: ({ CORTE_INICIADO: 'Corte de inventario iniciado', PALLET_ESCANEADO: 'Pallet inventariado', CONTEO_CON_DIFERENCIA: 'Diferencia física registrada', REESCANEO_IGNORADO: 'Reescaneo detectado', INVENTARIO_CERRADO: 'Inventario cerrado' })[a.tipo] || a.tipo, pallet: a.palletId || '', detalle: `${s.almacen} · Sesión ${s.id}`, ubicacion: s.almacen, usuario: a.usuario || '' })));
    this.getVerificaciones().forEach(v => agregar({ id: `verificacion-${v.id}`, fecha: v.actualizado_en || v.registrado_en || v.fecha, tipo: 'verificacion', severidad: v.tipo === 'rechazado' ? 'warning' : 'success', titulo: v.tipo === 'rechazado' ? 'Rechazo registrado' : 'Verificación registrada', pallet: v.codigo_lote || '', detalle: `${(v.pallets || []).length} pallet(s) · Turno ${String(v.turno || '').toLowerCase()}`, usuario: v.usuario || '' }));
    OperacionesModel.history().forEach(h => agregar({ id: `operacion-${h.id}`, fecha: h.fecha, tipo: 'aprobacion', severidad: h.accion === 'rechazar' ? 'critical' : h.accion === 'reproceso' ? 'warning' : 'success', titulo: ({ aprobar: 'Pallets aprobados', reproceso: 'Pallets enviados a reproceso', rechazar: 'Rechazo definitivo', envio_gerencia: 'Lote enviado a aprobación', reclasificacion: 'Pallets reclasificados', despacho: 'Pallets despachados / reprocesados' })[h.accion] || h.accion, detalle: `${(h.pallet_ids || []).length} pallet(s)${h.lote_id ? ` · ${h.lote_id}` : ''}`, usuario: h.usuario || '' }));
    MapaModel.getLoads().forEach(c => agregar({ id: `carga-${c.folio}`, fecha: c.guardada_en, tipo: 'carga', severidad: 'success', titulo: 'Carga despachada', pallet: c.folio, detalle: `${(c.pallets || []).length} pallet(s) · ${c.datos?.empresa || 'Destino no informado'}`, ubicacion: c.pestana === 'postunel' ? 'POST TUNEL' : 'PROTER' }));
    return {
      eventos: eventos.sort((a, b) => b.timestamp - a.timestamp).slice(0, 250),
      pendientes: mapaPendientes.filter(x => x.status !== 'CONFLICTO').length + grueroPendientes.filter(x => x.status !== 'conflict').length + colaInventario.filter(x => x.status !== 'CONFLICTO').length,
      conflictos: mapaConflictos.length + GrueroSyncService.conflicts().length + colaInventario.filter(x => x.status === 'CONFLICTO').length
    };
  },

  async monitor() {
    const r = this.resumen(), camaras = {}, problemas = ['RECHAZO', 'BLOQUEADOS', 'PROHIBICIONES'];
    r.pallets.forEach(p => {
      const n = p.ubicacion || 'SIN UBICACIÓN';
      if (!camaras[n]) camaras[n] = { nombre: n, total: 0, problemas: 0 };
      camaras[n].total += 1;
      if (problemas.some(e => this.estadoIgual(p.estado, e))) camaras[n].problemas += 1;
    });
    const ocupacionCamaras = Object.values(camaras).sort((a, b) => b.total - a.total), alertas = [];
    const sinInfo = this.contarEstado('SIN INFORMACIÓN', r.pallets);
    if (sinInfo) alertas.push({ nivel: 'critica', titulo: 'Pallets sin información', detalle: `${sinInfo} pallets requieren clasificación.` });
    const porLote = {};
    r.pallets.forEach(p => { if (p.lote) (porLote[p.lote] ||= new Set()).add(p.ubicacion); });
    Object.entries(porLote).filter(([, u]) => u.size > 1).slice(0, 3).forEach(([lote, u]) => alertas.push({ nivel: 'advertencia', titulo: `Lote ${lote} distribuido`, detalle: `Presente en ${u.size} cámaras.` }));
    ocupacionCamaras.forEach(c => { c.capacidad = this.capacidadCamara(c.nombre); c.ocupacion = c.capacidad ? c.total / c.capacidad * 100 : 0; c.riesgo = c.total ? c.problemas / c.total * 100 : 0; });
    ocupacionCamaras.filter(c => c.ocupacion >= 85).forEach(c => alertas.push({ nivel: 'advertencia', titulo: `Alta ocupación en ${c.nombre}`, detalle: `${c.ocupacion.toFixed(1)}% de posiciones físicas utilizadas.` }));
    const actividad = await this.eventosOperacionales();
    if (!navigator.onLine) alertas.unshift({ nivel: 'advertencia', titulo: 'Operación sin conexión', detalle: `${actividad.pendientes} cambio(s) conservados localmente.` });
    if (actividad.conflictos) alertas.unshift({ nivel: 'critica', titulo: 'Conflictos de sincronización', detalle: `${actividad.conflictos} operación(es) requieren revisión.` });
    else if (actividad.pendientes) alertas.unshift({ nivel: 'atencion', titulo: 'Sincronización pendiente', detalle: `${actividad.pendientes} operación(es) esperan confirmación.` });
    const capacidadFisica = ocupacionCamaras.reduce((total, camara) => total + camara.capacidad, 0);
    const posicionados = ocupacionCamaras.reduce((total, camara) => total + camara.total, 0);
    return { ...r, ocupacionCamaras, ocupacionFisica: capacidadFisica ? posicionados / capacidadFisica * 100 : 0, alertas, actividad: actividad.eventos, pendientes: actividad.pendientes, conflictos: actividad.conflictos, criticas: ocupacionCamaras.filter(c => c.riesgo >= 10).length, pedidos: this.contarEstado('PEDIDO', r.pallets), reproceso: this.contarEstado('REPROCESO', r.pallets), actualizadoEn: new Date().toISOString() };
  },

  // Bitácora consulta los mismos pallets del mapa/KPI: no mantiene una lista
  // paralela de pendientes. La fecha de pedido sólo se muestra si la fuente la
  // entrega; nunca se inventa para simular una prioridad.
  palletsPendientesPedido() { return this.pallets().filter(p => this.estadoIgual(p.estado, 'PEDIDO')); },
  fechaPedidoVisible(fecha) {
    const match = String(fecha || '').trim().match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    return match ? `${match[1].padStart(2, '0')}/${match[2].padStart(2, '0')}/${match[3]}` : '';
  },
  diasAtrasoPedido(fecha) {
    const texto = this.fechaPedidoVisible(fecha);
    if (!texto) return null;
    const [d, m, a] = texto.split('/').map(Number);
    const timestamp = new Date(a, m - 1, d).getTime();
    return Number.isFinite(timestamp) ? Math.max(0, Math.floor((Date.now() - timestamp) / 86400000)) : null;
  },

  // Semilla de visualización copiada del RepositorioBitacoras del MVC. Sólo
  // se aplica cuando la instalación no posee bitácoras; jamás pisa registros
  // que el usuario ya haya creado.
  initialBitacoras() { return [
    { id: 'BIT-001', fecha: '17/07/2026', turno: 'DIA', planificacion: [{ id: 'p1', etiqueta: 'Meta de proceso', valor: '420 pallets liberados' }], resumen_dia: [{ id: 'r1', texto: 'Se realizó traspaso de Post Túnel a Proter.' }, { id: 'r2', texto: 'Cámara Cero quedó vacía tras el despacho de la mañana.' }], kpi_verificados: [{ id: 'v1', motivo: 'DF', cantidad: 20 }, { id: 'v2', motivo: 'DM completo', cantidad: 18 }, { id: 'v3', motivo: 'Por tierra', cantidad: 13 }], kpi_rechazados: [{ id: 'rz1', motivo: 'Calidad fuera de norma', cantidad: 2 }], kpi_reproceso: 4 },
    { id: 'BIT-002', fecha: '17/07/2026', turno: 'NOCHE', planificacion: [{ id: 'p1', etiqueta: 'Meta de proceso', valor: '420 pallets liberados' }], resumen_dia: [{ id: 'r1', texto: 'Sin incidencias relevantes durante el turno.' }], kpi_verificados: [{ id: 'v1', motivo: 'DF', cantidad: 15 }, { id: 'v2', motivo: 'Bolsa abierta', cantidad: 12 }, { id: 'v3', motivo: 'Hielo', cantidad: 11 }], kpi_rechazados: [{ id: 'rz1', motivo: 'Documentación', cantidad: 1 }], kpi_reproceso: 2 },
    { id: 'BIT-003', fecha: '18/07/2026', turno: 'DIA', planificacion: [{ id: 'p1', etiqueta: 'Meta de proceso', valor: '450 pallets liberados' }, { id: 'p2', etiqueta: 'Prioridad', valor: 'Despacho de arándano orgánico' }], resumen_dia: [{ id: 'r1', texto: 'Se realizó traspaso de Andén de Producción a Proter.' }, { id: 'r2', texto: 'Se realizó traspaso de Post Túnel a Proter.' }, { id: 'r3', texto: 'Cámara Cero quedó vacía tras el despacho de la tarde.' }], kpi_verificados: [{ id: 'v1', motivo: 'DF', cantidad: 18 }, { id: 'v2', motivo: 'DM completo', cantidad: 15 }, { id: 'v3', motivo: 'Por tierra', cantidad: 6 }, { id: 'v4', motivo: 'Bolsa con piquete', cantidad: 3 }], kpi_rechazados: [{ id: 'rz1', motivo: 'Calidad fuera de norma', cantidad: 2 }, { id: 'rz2', motivo: 'Documentación', cantidad: 1 }], kpi_reproceso: 5 }
  ]; },
  getBitacoras() {
    let rows;
    try { rows = JSON.parse(localStorage.getItem(this.BITACORAS_KEY) || 'null'); } catch (_) { rows = null; }
    const needsSeed = !Array.isArray(rows) || (!rows.length && localStorage.getItem(this.BITACORAS_SCHEMA_KEY) !== this.BITACORAS_SCHEMA_VERSION);
    if (needsSeed) { rows = this.initialBitacoras(); localStorage.setItem(this.BITACORAS_KEY, JSON.stringify(rows)); }
    localStorage.setItem(this.BITACORAS_SCHEMA_KEY, this.BITACORAS_SCHEMA_VERSION);
    return rows;
  },
  saveBitacoras(x) { localStorage.setItem(this.BITACORAS_KEY, JSON.stringify(x)); },
  totalMotivos(x = []) { return x.reduce((s, i) => s + (parseInt(i.cantidad, 10) || 0), 0); },
  filterBitacoras({ turno = 'TODOS', fecha = '', buscar = '' } = {}) {
    const q = buscar.trim().toLocaleLowerCase('es');
    return this.getBitacoras().filter(b => {
      const t = [...b.resumen_dia.map(x => x.texto), ...b.kpi_verificados.map(x => x.motivo), ...b.kpi_rechazados.map(x => x.motivo)].join(' ').toLocaleLowerCase('es');
      return (turno === 'TODOS' || b.turno === turno) && (!fecha || b.fecha.includes(fecha)) && (!q || t.includes(q));
    // El escritorio muestra primero el último registro guardado. No se
    // reordena por la fecha escrita: una bitácora histórica ingresada hoy
    // debe seguir siendo la más reciente de la lista.
    }).reverse();
  },
  precargaBitacora(turno) {
    // Igual que el MVC: la precarga toma la última bitácora GUARDADA del
    // mismo turno, no la que tenga la fecha calendario más alta.
    const b = [...this.getBitacoras()].reverse().find(x => x.turno === turno);
    return b ? { planificacion: b.planificacion.map(x => ({ ...x })), resumen_dia: b.resumen_dia.map(x => ({ ...x })) } : { planificacion: [], resumen_dia: [] };
  },
  upsertBitacora(data, id = null) {
    const items = this.getBitacoras();
    const clean = list => (list || []).filter(x => Object.values(x).some(v => String(v || '').trim()));
    // Un KPI incompleto no se guarda como motivo con cero.
    const cleanKpi = list => clean(list).map(x => ({ motivo: String(x.motivo || '').trim(), cantidad: Math.max(0, parseInt(x.cantidad, 10) || 0) })).filter(x => x.motivo && x.cantidad > 0);
    const value = { turno: data.turno === 'NOCHE' ? 'NOCHE' : 'DIA', planificacion: clean(data.planificacion), resumen_dia: clean(data.resumen_dia), kpi_verificados: cleanKpi(data.kpi_verificados), kpi_rechazados: cleanKpi(data.kpi_rechazados), kpi_reproceso: Math.max(0, parseInt(data.kpi_reproceso, 10) || 0) };
    const totalManual = this.totalMotivos(value.kpi_verificados) + this.totalMotivos(value.kpi_rechazados) + value.kpi_reproceso;
    const crearAuditoriaManual = previa => {
      if (!totalManual) return null;
      if (previa?.ajuste_manual) return { ...previa.ajuste_manual, origen: 'BITACORA_MANUAL', actualizado_en: new Intl.DateTimeFormat('es-CL', { dateStyle: 'short', timeStyle: 'medium' }).format(new Date()) };
      const usuario = UserModel.getCurrentUser() || {};
      return { origen: 'BITACORA_MANUAL', usuario: usuario.name || 'Responsable no registrado', cargo: usuario.cargo || usuario.role || 'Cargo no registrado', turno: value.turno, registrado_en: new Intl.DateTimeFormat('es-CL', { dateStyle: 'short', timeStyle: 'medium' }).format(new Date()) };
    };
    if (id) { const i = items.findIndex(x => x.id === id); if (i < 0) return null; items[i] = { ...items[i], ...value, ajuste_manual: crearAuditoriaManual(items[i]) }; this.saveBitacoras(items); return items[i]; }
    const item = { id: `BIT-${String(items.length + 1).padStart(3, '0')}`, fecha: this.hoy(), ...value, ajuste_manual: crearAuditoriaManual(null) }; items.push(item); this.saveBitacoras(items); return item;
  },
  deleteBitacora(id) { this.saveBitacoras(this.getBitacoras().filter(x => x.id !== id)); },

  // Misma semilla del RepositorioVerificaciones del MVC. Sólo se incorpora
  // una vez a instalaciones que aún no tienen registros propios.
  initialVerificaciones() { return [
    { id:'VER-0001', fecha:'17/07/2026', turno:'DIA', tipo:'verificado', codigo_lote:'L-9042', articulo:'11041', pallets:[{numero_pallet:'63',motivo:'DF',cajas:'3'},{numero_pallet:'65',motivo:'DM',cajas:''}], usuario:'Usuario WMS' },
    { id:'VER-0002', fecha:'17/07/2026', turno:'DIA', tipo:'verificado', codigo_lote:'L-7011', articulo:'Frambuesa IQF', pallets:[{numero_pallet:'12',motivo:'Tierra',cajas:'2'}], usuario:'Usuario WMS' },
    { id:'VER-0003', fecha:'17/07/2026', turno:'DIA', tipo:'rechazado', codigo_lote:'L-3122', articulo:'12702', pallets:[{numero_pallet:'8',motivo:'Calidad fuera de norma',cajas:'27'},{numero_pallet:'9',motivo:'Tierra',cajas:'31, 32'}], usuario:'Usuario WMS' },
    { id:'VER-0004', fecha:'18/07/2026', turno:'NOCHE', tipo:'verificado', codigo_lote:'L-9042', articulo:'11041', pallets:[{numero_pallet:'70',motivo:'DM',cajas:''}], usuario:'Usuario WMS' }
  ]; },
  normalizarPalletVerificacion(pallet = {}) {
    const numero_pallet = String(pallet.numero_pallet ?? pallet.numero ?? '').trim();
    // `numero` queda como alias de lectura para registros locales previos;
    // toda escritura nueva conserva el campo explícito del MVC.
    return { numero_pallet, numero: numero_pallet, motivo: String(pallet.motivo || '').trim(), cajas: Math.max(0, parseInt(pallet.cajas, 10) || 0) };
  },
  getVerificaciones() {
    let rows; try { rows = JSON.parse(localStorage.getItem(this.VERIFICACIONES_KEY) || 'null'); } catch (_) { rows = null; }
    const seedPending = localStorage.getItem(this.VERIFICACIONES_SCHEMA_KEY) !== this.VERIFICACIONES_SCHEMA_VERSION;
    if ((!Array.isArray(rows) || !rows.length) && seedPending) { rows = this.initialVerificaciones(); localStorage.setItem(this.VERIFICACIONES_KEY, JSON.stringify(rows)); }
    if (!Array.isArray(rows)) rows = [];
    localStorage.setItem(this.VERIFICACIONES_SCHEMA_KEY, this.VERIFICACIONES_SCHEMA_VERSION);
    return rows.map(v => ({ ...v, pallets: (v.pallets || []).map(p => this.normalizarPalletVerificacion(p)) }));
  },
  saveVerificaciones(x) { localStorage.setItem(this.VERIFICACIONES_KEY, JSON.stringify(x)); },
  filterVerificaciones({ turno = 'TODOS', fecha = '', buscar = '' } = {}) {
    const q = buscar.trim().toLocaleLowerCase('es');
    return this.getVerificaciones().filter(v => (turno === 'TODOS' || v.turno === turno) && (!fecha || v.fecha.includes(fecha)) && (!q || [v.codigo_lote, v.articulo, ...v.pallets.map(p => p.motivo)].join(' ').toLocaleLowerCase('es').includes(q))).sort((a, b) => this.parseFecha(b.fecha) - this.parseFecha(a.fecha));
  },
  resumenVerificaciones(fecha, turno) {
    const items = this.getVerificaciones().filter(v => v.fecha === fecha && v.turno === turno);
    const resumenTipo = tipo => {
      const registros = items.filter(v => v.tipo === tipo), motivos = {};
      const pallets = new Set();
      registros.forEach(v => v.pallets.forEach(p => {
        pallets.add(`${v.codigo_lote}|${p.numero_pallet}`);
        const key = p.motivo.trim().toLocaleLowerCase('es');
        if (key) { motivos[key] ||= { nombre: p.motivo.trim(), cantidad: 0 }; motivos[key].cantidad += 1; }
      }));
      return { total: pallets.size, motivos: Object.values(motivos).sort((a, b) => b.cantidad - a.cantidad) };
    };
    const verificados = resumenTipo('verificado'), rechazados = resumenTipo('rechazado');
    return { verificados: verificados.total, rechazados: rechazados.total, motivos: [...verificados.motivos, ...rechazados.motivos], motivosVerificados: verificados.motivos, motivosRechazados: rechazados.motivos };
  },
  resolveLote(codigo) {
    const q = String(codigo || '').trim().toUpperCase(); if (!q) return null;
    const posibles = [q, q.startsWith('L-') ? q.slice(2) : `L-${q}`];
    const p = this.pallets().find(x => posibles.includes(String(x.lote || '').toUpperCase()));
    return p ? { codigo_lote: p.lote, articulo: p.articulo } : null;
  },
  upsertVerificacion(data, id = null) {
    const lote = this.resolveLote(data.codigo_lote), pallets = (data.pallets || []).map(p => this.normalizarPalletVerificacion(p));
    if (!lote) return { ok: false, error: 'El lote no existe en el stock actual.' };
    if (!pallets.length) return { ok: false, error: 'Debe agregar al menos un pallet con su motivo.' };
    if (pallets.some(p => !p.numero_pallet || !p.motivo)) return { ok: false, error: 'Cada pallet debe indicar número y motivo.' };
    const items = this.getVerificaciones(), value = { fecha: data.fecha || this.hoy(), turno: data.turno === 'NOCHE' ? 'NOCHE' : 'DIA', tipo: data.tipo === 'rechazado' ? 'rechazado' : 'verificado', ...lote, pallets, usuario: (UserModel.getCurrentUser() || {}).name || 'Usuario WMS' };
    const ahora = new Intl.DateTimeFormat('es-CL', { dateStyle: 'short', timeStyle: 'medium' }).format(new Date());
    if (id) { const i = items.findIndex(x => x.id === id); if (i < 0) return { ok: false, error: 'El registro ya no existe.' }; items[i] = { ...items[i], ...value, actualizado_en: ahora }; this.saveVerificaciones(items); return { ok: true, item: items[i] }; }
    const item = { id: `VER-${String(items.length + 1).padStart(4, '0')}`, ...value, registrado_en: ahora }; items.push(item); this.saveVerificaciones(items); return { ok: true, item };
  },
  deleteVerificacion(id) { this.saveVerificaciones(this.getVerificaciones().filter(x => x.id !== id)); },
  deleteTurno(fecha, turno) { const b = this.getVerificaciones(), a = b.filter(x => x.fecha !== fecha || x.turno !== turno); this.saveVerificaciones(a); return b.length - a.length; },
  parseFecha(f) { const [d, m, y] = String(f).split('/').map(Number); return new Date(y || 0, (m || 1) - 1, d || 1).getTime(); },
  hoy() { return new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date()).replace(/-/g, '/'); }
};
