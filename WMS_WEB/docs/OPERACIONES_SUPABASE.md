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

## Capas de estado de una tarjeta

Una tarjeta no debe resumir todo en un solo badge porque el backend permite capas que pueden coexistir.

La UI remota distingue explícitamente:

1. **Calidad SAP**: valor del padre SAP, por ejemplo `BLOQUEADO` o `LIBERADO`.
2. **Estado WMS registrado**: estado explícito almacenado por WMS (`LIBERADO`, `BLOQUEADO`, `RECHAZADO`) cuando existe.
3. **Estado operativo efectivo**: resultado autoritativo calculado por backend considerando SAP, WMS, bloqueos y requisitos.
4. **Flujo / filtro**: la categoría operacional por la que el pallet aparece en una consulta de los 11 estados.
5. **Condiciones / subestados**: `VERIFICACIÓN`, `SIN DM`, `SIN INFORMACIÓN`, `LOTE INCOMPLETO`, `PROHIBICIÓN`, `PEDIDO`, etc.
6. **Decisión de Gerencia** y **modalidad** cuando existen.

Ejemplo válido:

`SAP BLOQUEADO · WMS RECHAZADO · OPERATIVO RECHAZADO · condición VERIFICACIÓN`.

No es una contradicción: RECHAZADO es el estado WMS base y VERIFICACIÓN es una condición pendiente.

### RECHAZO + VERIFICACIÓN / SIN DM

`wms_operaciones_reclasificar` no borra un rechazo cuando se agrega una condición.

Si un pallet está `RECHAZADO` y se reclasifica a `VERIFICACIÓN` o `SIN DM`:

- conserva el estado WMS `RECHAZADO`;
- agrega/reemplaza la condición principal correspondiente;
- el filtro `VERIFICACIÓN` o `SIN DM` puede encontrarlo por esa condición;
- la tarjeta sigue mostrando claramente que el estado base continúa siendo RECHAZADO.

Levantar un rechazo es una operación distinta del backend (`wms_operaciones_levantar_rechazo`) y no se ejecuta implícitamente desde el frontend.

---

## Movimientos de Cámara

Lectura:

- `wms_operaciones_movimientos_listar`

Es el backend quien entrega:

- los 11 estados filtrables;
- detectores canónicos;
- estado SAP;
- estado WMS registrado y estado operativo;
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

La cola no se reconstruye en JavaScript. Supabase define qué pallets están pendientes.

Un pallet entra en la cola cuando su estado operativo está `BLOQUEADO` o `RECHAZADO` y todavía no tiene una decisión gerencial actual.

Por eso, reclasificar a RECHAZO hace que un pallet quede disponible en Aprobaciones si no tenía decisión gerencial. Si ya estaba BLOQUEADO y ya pertenecía a la cola, cambiarlo a RECHAZO no necesariamente aumenta el total de pendientes: cambia su clasificación de cola y aparecerá bajo el filtro `RECHAZO`.

### Filtros

Los filtros son remotos, no filtros JavaScript sobre una página descargada:

- **Estado**: `TODOS`, `BLOQUEADOS` y `RECHAZO` según lo que realmente exista en la cola.
- **N° Artículo**: códigos SAP `ItemCode` realmente presentes en la cola.

Al cambiar cualquiera de los selects, el backend recalcula para ese subconjunto:

- Pallets pendientes.
- Kilos comprometidos.
- Cajas asociadas.
- Artículos distintos.
- Observados.

El filtro Estado de Aprobaciones representa **estado de cola gerencial**, no condiciones como VERIFICACIÓN o SIN DM. Esas condiciones se ven en las tarjetas.

### Acciones

La UI consume `opciones.acciones` del backend. Actualmente:

- APROBAR
- REPROCESO

Se eliminó **Rechazar definitivo**.

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

### Reproceso

La misma RPC recibe `REPROCESO`. El backend crea la decisión gerencial y mantiene su auditoría.

### Packing List

- `wms_operaciones_aprobacion_packing`

El backend arma la selección autoritativa; el navegador sólo transforma la respuesta en XLSX mediante `ExportService`.

---

## Idempotencia y concurrencia

Las escrituras generan `operacion_uuid` en frontend y lo entregan a los RPC.

El motivo de aprobación respeta `motivo_version` y la decisión gerencial vuelve a consultar toda la cola filtrada antes de ejecutar, para no decidir sobre una pantalla desactualizada.

---

## Permisos RPC privados — RESUELTO

Se aplicó la migración Supabase:

- `operaciones_private_rpc_permissions`

La migración **no modifica reglas de negocio, tablas ni estados**. Sólo alinea permisos de ejecución entre los wrappers públicos `SECURITY INVOKER` y los helpers privados que realmente forman parte de la API web.

Resultado:

- `authenticated` tiene `EXECUTE` en los helpers privados vigentes usados por los RPC públicos de Operaciones;
- `anon` no tiene `EXECUTE` en esos helpers;
- se retiró acceso web al overload legacy de `op_operaciones_aprobacion_decidir` que todavía aceptaba `RECHAZAR`;
- se retiró acceso web al helper legacy de despacho comercial que permitía destinos que ya no pertenecen a la pantalla Despacho.

Con esto quedan resueltos los posibles `permission denied` detectados para:

- `wms_operaciones_pedido_aplicar(...)`;
- `wms_operaciones_aprobacion_decidir(..., p_modalidad, ...)`.

La lógica interna de ambos RPC permanece intacta.
