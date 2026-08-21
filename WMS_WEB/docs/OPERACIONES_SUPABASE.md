# Operaciones ↔ Supabase

Estado de la migración frontend de **Movimientos de Cámara, Despacho y Gestión de Aprobaciones**.

## Regla de esta fase

El backend existente es autoritativo y **no se modifica para acomodarlo al frontend**.

Las tres vistas migradas entran por:

- `js/models/operacionesBackendModel.js`
- `js/controllers/operacionesBackendController.js`
- `js/services/operacionesBackendBridge.js`

`operacionesModel.js` y `operacionesController.js` permanecen temporalmente cargados por compatibilidad con consumidores legacy, pero sus tres métodos `init*` son redirigidos por el bridge al controlador remoto.

No se usa `StockModel`, `MapaModel`, `PanelControlModel` ni `localStorage` como fuente de negocio dentro de la nueva capa.

---

## Navegación

En Operaciones:

1. Movimientos de Cámara
2. Despacho
3. Gestión de Aprobaciones
4. Centro de Etiquetas
5. Operación Gruero / Operación Inventario cuando corresponda por rol
6. Bitácora
7. Registro de Verificaciones

Bitácora y Registro de Verificaciones cierran el submenú cuando son visibles.

`Despacho y Reproceso` fue renombrado a **Despacho**.

---

## Movimientos de Cámara

Lectura:

- `wms_operaciones_movimientos_listar`

Es el backend quien entrega:

- estados filtrables;
- detectores canónicos;
- estado SAP;
- estado/estado operativo WMS;
- condiciones WMS;
- decisión y modalidad de Gerencia;
- Pedido y días en Pedido;
- almacén SAP;
- auditoría.

Escritura:

- `wms_operaciones_reclasificar`

Destinos expuestos por la UI porque son exactamente los admitidos por el contrato actual:

- RECHAZO
- VERIFICACIÓN
- SIN DM
- SIN INFORMACIÓN
- LOTES INCOMPLETOS
- PROHIBICIONES

El frontend no decide si el resultado es estado WMS, condición principal o condición adicional. La respuesta backend entrega `semantica`.

Si un pallet en REPROCESO se deriva a VERIFICACIÓN, la lógica `VERIFICACION_EMERGENCIA` queda exclusivamente en backend.

---

## Despacho

La pantalla ya **no** permite seleccionar:

- AUTORIZADOS A ENVIAR;
- REPROCESO;
- clasificación de envío.

Esas decisiones pertenecen a Gestión de Aprobaciones.

La pantalla conserva el buscador/pegado masivo de códigos y usa:

- `wms_operaciones_resolver_codigos`
- `wms_operaciones_pedido_aplicar`

Su única acción es enviar pallets a **PEDIDO**.

El motivo/orden es obligatorio y tiene un área de texto ampliada.

El resolver del backend controla:

- ID de lote completo;
- código visual;
- códigos inexistentes;
- códigos ambiguos;
- confirmación parcial cuando existen códigos sin coincidencia.

---

## Gestión de Aprobaciones

Lectura:

- `wms_operaciones_aprobaciones_listar`

La cola no se reconstruye en JavaScript. Supabase define qué pallets están pendientes y devuelve filtros, resumen, motivo común y opciones permitidas.

La UI consume `opciones.acciones` del backend. Actualmente:

- APROBAR
- REPROCESO

Se eliminó de la nueva UI **Rechazar definitivo**.

### Motivo

- `wms_operaciones_aprobacion_motivo`

Guarda el motivo por `instancia_id` y usa `motivo_version` para concurrencia.

### Aprobar

- `wms_operaciones_aprobacion_decidir`

APROBAR obliga a seleccionar una modalidad devuelta por backend:

- LIBERADO
- RETAIL

La UI no convierte APROBAR directamente en LIBERADO.

El backend registra `AUTORIZADO_ENVIAR + modalidad` y determina después si:

- se libera inmediatamente; o
- permanece BLOQUEADO/PENDIENTE por condiciones WMS.

La respuesta muestra `liberados_inmediatos` y `bloqueados_por_condiciones`.

Por eso una tarjeta puede mostrar simultáneamente decisión gerencial, modalidad y condiciones como VERIFICACIÓN, SIN DM, SIN INFORMACIÓN, LOTE INCOMPLETO, PROHIBICIÓN o PEDIDO.

### Reproceso

La misma RPC recibe `REPROCESO`. El backend crea la decisión gerencial y mantiene su auditoría.

### Packing List

- `wms_operaciones_aprobacion_packing`

El backend arma la selección autoritativa; el navegador sólo transforma la respuesta en XLSX mediante `ExportService`.

---

## Idempotencia y concurrencia

Las escrituras nuevas generan `operacion_uuid` en frontend y lo entregan a los RPC.

El motivo de aprobación respeta `motivo_version` y la decisión gerencial vuelve a consultar toda la cola filtrada antes de ejecutar, para no decidir sobre una pantalla desactualizada.

---

## Bloqueo backend detectado — NO MODIFICADO

Durante la auditoría de permisos se confirmó que estos wrappers públicos están habilitados para `authenticated` y son `SECURITY INVOKER`:

- `wms_operaciones_pedido_aplicar(...)`
- `wms_operaciones_aprobacion_decidir(..., p_modalidad, ...)`

Sin embargo sus helpers actuales tienen `EXECUTE` sólo para `postgres`:

- `wms_private.op_operaciones_pedido_aplicar(...)`
- `wms_private.op_operaciones_aprobacion_decidir(..., p_modalidad, ...)`

Por ser wrappers `SECURITY INVOKER`, una sesión web autenticada puede recibir `permission denied` al atravesar esas dos rutas de escritura.

**No se cambió ningún GRANT, función, tabla ni regla del backend**, siguiendo la regla de esta fase.

Las rutas de lectura fueron verificadas con una sesión Auth/WMS vigente. También se comprobó que `wms_operaciones_reclasificar`, `wms_operaciones_aprobacion_motivo` y `wms_operaciones_aprobacion_packing` no presentan esa misma discrepancia de `EXECUTE` en sus helpers actuales.

Este punto debe validarse en la prueba funcional del navegador y, si se confirma el error, corregirse como incidencia backend separada sin volver a introducir lógica local en el frontend.
