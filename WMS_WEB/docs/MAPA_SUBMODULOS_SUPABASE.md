# Mapa de Cámara — submódulos remotos

Alcance de esta fase: **Agregar Código** e **Inventario de Cámara**. El visor principal 2D/2.5D, Gruero y Operación Inventario quedan fuera de esta migración por ser módulos quirúrgicos.

## Agregar Código

Fuente única: Supabase.

Contratos:

- `wms_articulos_codigo_catalogo`
- `wms_articulo_codigo_guardar`
- `wms_articulo_codigo_liberar`

La asignación artículo → letra ya no vive en `LETRAS_POR_ARTICULO`/`localStorage`. El usuario autenticado se obtiene desde la sesión WMS; el formulario no pide un responsable manual. El motivo es opcional y queda auditado por backend.

Estado al cerrar esta fase: 32 artículos detectados, 0 letras asignadas, 32 pendientes. No se autoasignaron letras para no inventar una decisión operacional. La UI propone la `siguiente_letra` calculada por Supabase y permite cambiarla antes de guardar.

Una vez asignada una letra, los resolutores centrales de lote/mapa pueden buscar `A20`, `A-20`, `A 20`, etc., además del ID canónico.

Permisos: `articulos.ver` para lectura y `articulos.gestionar` para asignar/editar/liberar. La UI oculta acciones de escritura cuando falta el permiso; el backend continúa siendo la autoridad.

## Inventario de Cámara

Fuente única: `wms_mapa_inventario_camara` + `wms_mapa_snapshot` + `wms_mapa_sincronizar_operacion`.

Estados del cruce:

- `ENCONTRADO`: SAP pertenece a la cámara y existe posición WMS en esa cámara.
- `OTRA_CAMARA`: SAP/WMS difieren de cámara física.
- `NO_ENCONTRADO`: SAP pertenece a la cámara y aún no existe posición física WMS.
- `NO_EXISTE`: existe posición WMS pero el pallet ya no está en `Lotes_en_Stock`.

La geometría se obtiene del snapshot backend: PROTER 508 slots y POST TÚNEL 356 slots. El frontend no calcula geometría con `MapaModel`.

Al cerrar esta fase `Posiciones_Mapa` está vacío. Por eso el estado inicial correcto es:

- PROTER: 430 `NO_ENCONTRADO`.
- POST TÚNEL: 343 `NO_ENCONTRADO`.
- Encontrados/Otra cámara/No existe: 0 mientras no se registren posiciones.

Asignar una posición usa `COLOCAR`; editar una posición usa `MOVER` con `segmento_id`. Para pallets multiubicados el usuario elige el segmento concreto, como exige el backend. La posición destino, ocupación, geometría, Andén e idempotencia se validan en Supabase.

Se corrigió `wms_mapa_inventario_camara` para que sus contadores utilicen la misma regla multi-almacén (`stock_lote_en_almacen`) que el listado. Esto evita omitir pallets válidos con saldo SAP en más de un almacén.

Permisos: `mapa.ver` para consulta y `mapa.gestionar` para asignar/mover posiciones.

## Frontera con el visor principal

`mapaSubmodulosBackendBridge.js` es **temporal** y sustituye exclusivamente:

- `MapaController.initCodigo`
- `MapaController.initInventario`

No intercepta PROTER/Post Túnel, render 2D/2.5D, drag/drop, FIFO, carga, Gruero ni offline del visor principal. Se eliminará cuando ese visor se migre en su fase final.

El shell y JS pueden permanecer cacheados offline, pero estas dos vistas no usan datos de negocio locales como fallback.
