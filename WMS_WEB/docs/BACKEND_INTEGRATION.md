# Integración WMS_WEB ↔ Supabase

Supabase es la única fuente de verdad para identidad, permisos y datos operacionales WMS. El frontend conserva únicamente shell/cache offline, assets y preferencias visuales; no usa datos locales como respaldo de negocio.

## Metodología

La migración se cierra submenú por submenú:

1. Inventariar botones, filtros, métodos y acciones actuales.
2. Contrastar cada lectura/acción con el backend real.
3. Adaptar la UI a las reglas de Supabase.
4. Validar permisos, estados vacíos, concurrencia y responsive.
5. Retirar la implementación local cuando ya no tenga consumidores.

## Estado actual

### Login / sesión

**Cerrado.** Supabase Auth + `wms_sesion_actual()` + RBAC. Sin usuarios/contraseñas locales.

### Panel de Control

**Cerrado.**

- Resumen Ejecutivo remoto.
- Tendencia de ocupación por snapshots reales.
- Análisis Operacional remoto con almacenes dinámicos.
- Monitor en Tiempo Real remoto.
- Monitor distingue 1.064 filas SAP / 1.062 pallets lógicos / 1.062 instancias WMS.

### Stock y Lotes

**Stock en Planta cerrado.**

- Detalle General conserva 1.064 ocurrencias SAP.
- Resúmenes que dicen pallets usan identidades lógicas.
- Tarjetas priorizan Estado WMS → Flujo → Condición; SAP queda en detalle.
- Auditoría expandida muestra último movimiento cuando existe.

**Lote Detallado cerrado.**

- Una identidad lógica por pallet.
- Ocurrencias SAP multi-almacén separadas.
- Posiciones físicas WMS separadas.

### Operaciones

**Movimientos de Cámara, Despacho y Gestión de Aprobaciones conectados a Supabase.**

- Movimientos usa `wms_operaciones_movimientos_listar` / `wms_operaciones_reclasificar`.
- Despacho sólo envía a PEDIDO mediante `wms_operaciones_pedido_aplicar`.
- Gestión de Aprobaciones sólo expone APROBAR / REPROCESO; no existe Rechazar definitivo.
- APROBAR exige modalidad LIBERADO / RETAIL y Supabase resuelve el estado final.
- Permisos privados de Operaciones alineados mediante `operaciones_private_rpc_permissions`.
- Payloads de lectura de las tres tarjetas unificados con última auditoría completa mediante `operaciones_tarjetas_auditoria_uniforme`.

**Bitácora y Registro de Verificaciones cerrados y remotos.** Ambos quedan al final del submenú Operaciones.

### Reportes Operacionales

**Visualizar Stock cerrado contra backend.**

Nueva capa:

- `js/models/reportesStockModel.js`
- `js/controllers/reportesStockController.js`
- `js/services/reportesStockBridge.js`

RPC:

- `wms_reportes_catalogos`
- `wms_reportes_stock_listar`
- `wms_reportes_stock_exportar`
- `wms_reportes_stock_valores_filtro`

Conserva búsqueda, filtros de almacén/estado, filtros por columna, paginación, copiar fila, copiar todo y Excel. El total base correcto es **1.064 registros SAP**. La tarjeta usa el estándar WMS-first y no consulta `StockModel`.

`ReportesModel` permanece temporalmente sólo por **Generar Reporte**, que se migrará en una fase propia.

## Estándar de tarjetas

Ver `docs/TARJETAS_ESTADO_WMS.md`.

Jerarquía compacta:

1. Estado WMS efectivo.
2. Flujo operativo.
3. Condición/requisito.
4. Kilos/cajas/fecha.
5. Decisión/modalidad si existen.

SAP, detector, reserva, almacén y auditoría quedan en detalle expandido.

## Offline

Se mantienen Service Worker, shell, JS/CSS/assets cacheados y preferencias de UI. Sin conexión no se inventan ni restauran datos WMS locales como reemplazo de Supabase.

## Rama

Toda la integración continúa exclusivamente en **`WMS_WEB`**. El PR permanece draft y no se mergea hasta instrucción explícita.
