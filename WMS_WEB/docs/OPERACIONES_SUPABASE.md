# Operaciones ↔ Supabase

Estado de la migración frontend de **Movimientos de Cámara, Despacho y Gestión de Aprobaciones**.

## Regla de arquitectura

El backend es autoritativo. El frontend no inventa estados, requisitos, decisiones gerenciales ni datos de negocio.

Las tres vistas migradas entran por:

- `js/models/operacionesBackendModel.js`
- `js/controllers/operacionesBackendController.js`
- `js/services/operacionesBackendBridge.js`

`operacionesModel.js` y `operacionesController.js` permanecen temporalmente cargados por compatibilidad con consumidores legacy, pero sus tres métodos `init*` son redirigidos por el bridge al controlador remoto.

No se usa `StockModel`, `MapaModel`, `PanelControlModel` ni `localStorage` como fuente de negocio dentro de la nueva capa.

## Navegación

1. Movimientos de Cámara
2. Despacho
3. Gestión de Aprobaciones
4. Centro de Etiquetas
5. Operación Gruero / Operación Inventario cuando corresponda por rol
6. Bitácora
7. Registro de Verificaciones

Bitácora y Registro de Verificaciones cierran el submenú cuando son visibles.

## Capas de estado de una tarjeta

La tarjeta compacta prioriza:

1. **Estado WMS efectivo**.
2. **Flujo / filtro operacional**.
3. **Condición / requisito**.
4. Kilos, cajas y fecha relevante.
5. Decisión gerencial + modalidad cuando existen.

La Calidad SAP se conserva en el detalle expandido, junto con Estado WMS registrado, Estado WMS efectivo, flujo, condiciones, detector, reserva, almacén y auditoría.

Ejemplo válido:

`SAP BLOQUEADO · WMS RECHAZADO · condición VERIFICACIÓN`.

RECHAZADO es el estado WMS base; VERIFICACIÓN es una condición. Reclasificar un RECHAZADO a VERIFICACIÓN o SIN DM no levanta automáticamente el rechazo.

El estándar transversal completo está en `docs/TARJETAS_ESTADO_WMS.md`.

## Movimientos de Cámara

RPC:

- lectura: `wms_operaciones_movimientos_listar`
- escritura: `wms_operaciones_reclasificar`

Destinos visibles:

- RECHAZO
- VERIFICACIÓN
- SIN DM
- SIN INFORMACIÓN
- LOTES INCOMPLETOS
- PROHIBICIONES

Los 11 filtros son facetas operacionales y no necesariamente excluyentes. El frontend no decide si el destino representa estado WMS, condición principal o condición adicional.

## Despacho

La pantalla se llama **Despacho** y ya no permite seleccionar AUTORIZADOS A ENVIAR, REPROCESO ni clasificación comercial.

RPC:

- resolver códigos: `wms_operaciones_resolver_codigos`
- enviar a Pedido: `wms_operaciones_pedido_aplicar`

Su única escritura lleva pallets a **PEDIDO** con motivo/orden obligatorio.

El resolver remoto devuelve la ficha operativa completa para las tarjetas, incluida la última auditoría cuando existe.

## Gestión de Aprobaciones

RPC:

- cola: `wms_operaciones_aprobaciones_listar`
- motivo: `wms_operaciones_aprobacion_motivo`
- decisión: `wms_operaciones_aprobacion_decidir`
- packing: `wms_operaciones_aprobacion_packing`

La cola contiene pallets `BLOQUEADOS` o `RECHAZADOS` sin decisión gerencial vigente.

Filtros remotos:

- Estado de cola.
- N° Artículo.

Cada cambio recalcula pallets, kilos, cajas, artículos distintos y observados.

Estado validado al migrar:

- 564 pallets BLOQUEADOS.
- 0 pallets RECHAZO WMS.
- 384.710,938 kg.
- 36.007,843 cajas.
- 28 artículos distintos.

Acciones visibles:

- APROBAR.
- REPROCESO.

`Rechazar definitivo` fue eliminado.

APROBAR exige modalidad `LIBERADO` o `RETAIL`. El backend registra `AUTORIZADO_ENVIAR + modalidad` y decide si libera inmediatamente o conserva condiciones pendientes.

## Auditoría uniforme

Las tres tarjetas de Operaciones muestran en el detalle expandido, cuando existe:

- evento;
- contexto;
- valor anterior;
- valor nuevo;
- usuario;
- fecha;
- motivo.

La migración `operaciones_tarjetas_auditoria_uniforme` amplió únicamente los payloads de lectura de Despacho y Aprobaciones para igualarlos con Movimientos. No modificó transiciones ni reglas de negocio.

## Permisos — resuelto

La migración `operaciones_private_rpc_permissions` alineó `EXECUTE` de los helpers privados con sus wrappers públicos vigentes:

- `authenticated` puede ejecutar las rutas actuales;
- `anon` no puede ejecutarlas;
- el overload legacy de aprobación que admitía RECHAZAR quedó sin acceso web;
- el helper legacy de despacho comercial quedó sin acceso web.

No se alteraron reglas de negocio, tablas ni estados.
