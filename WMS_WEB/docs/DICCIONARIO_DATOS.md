# Diccionario de datos y reglas de negocio

Fecha de auditoría: 2026-08-08  
Fuente funcional: `Programa MVC`  
Implementación auditada: `WMS_WEB`

## 1. Contrato general

`Programa MVC` todavía no consulta una base de datos real. Su repositorio
`RepositorioPallets` genera una lista en memoria y luego la enriquece. La carpeta
`Datos` contiene la interfaz prevista para Supabase, pero la conexión devuelve
`None` mientras no exista configuración real.

`WMS_WEB` también usa datos de demostración. Los genera `MapaModel` y los
persiste en `localStorage` bajo una frontera de repositorio (`getPallets` /
`savePallets`). Los datos de prueba no deben interpretarse como datos reales de
planta. Cuando se conecte una base real, debe reemplazarse esa frontera, no las
reglas de presentación de `PalletModel`.

Reglas esenciales:

- El código de artículo real y su descripción son datos diferentes.
- `lote` (`L-9042`, por ejemplo) es la referencia interna usada para agrupar y
  procesar lotes en la simulación. No es el ID de lote completo mostrado en las
  tablas operacionales.
- El ID de lote completo se compone como temporada + planta fija + artículo +
  número correlativo de pallet dentro del artículo.
- La letra identifica visualmente a un artículo en el mapa. No pertenece al
  artículo, al lote, al pallet ni al ID de lote real.
- Los kilos generales de stock son siempre `cajas × 12`.
- `ubicacion` es el almacén lógico. La posición física del mapa se representa
  separadamente mediante banda/zona, posición y altura.

## 2. Diccionario campo por campo

| Campo | Origen original | Dato recibido/almacenado | Transformación | Dato mostrado y uso | Relación / futura BD |
|---|---|---|---|---|---|
| `id` | Repositorio de pallets | Texto, p. ej. `PLT-2026-001` | Ninguna | Identificador técnico del registro/pallet; aparece en procesos internos y algunos documentos | Clave primaria estable del pallet en BD; no confundir con ID de lote |
| `lote` | Repositorio de pallets | Texto de agrupación, p. ej. `L-9042` | La búsqueda detallada acepta el valor completo o sin prefijo `L-` | Se usa como entrada en despacho masivo, agrupación y búsqueda exacta; las tablas principales muestran `id_lote_real` | Debe venir del origen operacional si sigue existiendo esta agrupación |
| `temporada` | Configuración `TEMPORADA_ACTUAL` | `26` | Se antepone al artículo y al ID de lote | Forma parte de `numero_articulo` e `id_lote_real`; no se muestra necesariamente aislada | Configuración por temporada; no hardcodear dentro de vistas |
| `planta` del ID de lote | Configuración `CODIGO_PLANTA` | `30`, fijo para Parral | Se inserta en posiciones 3-4 de `id_lote_real` | Parte del ID completo | No se obtiene desde `ubicacion` ni desde `PLANTA_POR_ALMACEN` |
| `articulo` | Pallet / SAP futuro | Código real, normalmente 5 caracteres, p. ej. `11041`; el código podría contener letras según comentarios del original | Ninguna para persistirlo | Código maestro usado en filtros, relaciones y asignación visual | FK hacia maestro de artículos; nunca sustituir por descripción, letra o `codigo5_por_articulo` |
| `numero_articulo` | Derivado | No es un código independiente | `temporada + articulo`, p. ej. `26` + `11041` = `2611041` | Columna **N° ARTÍCULO** en Stock y Operaciones | Puede calcularse en adaptador de lectura; no debe reemplazar `articulo` |
| `descripcion` | `config/catalogo_articulos.py` | Texto maestro asociado al código | Búsqueda por `articulo`; fallback original `Artículo {codigo}` | Columna **DESCRIPCIÓN** | Debe venir del maestro de artículos o de una relación en BD, no duplicarse como fuente contradictoria en cada pallet |
| `es_organico` / `esOrganico` | Catálogo de artículos | Booleano | Ninguna | Clasificación del artículo donde corresponda | Atributo del maestro de artículos, no del código visual |
| `numero_pallet` | Calculado al enriquecer el repositorio | Texto con mínimo 2 dígitos: `01`, `02`… | Contador correlativo dentro de cada `articulo`, recorriendo todos los almacenes y lotes | Se usa en ficha de lote y en el código visual | Debe ser único dentro del artículo según esta regla; no numerar por cámara ni por lote |
| `id_lote_real` | Calculado y guardado por el repositorio original | 12 o 13 dígitos usualmente | `temporada(2) + planta fija(2) + articulo(5) + numero_pallet(mín. 3)`; si el correlativo ya tiene 4 dígitos no se trunca | **LOTE / ID LOTE** en Stock, Movimientos, Aprobaciones y fichas de mapa | En BD puede recibirse como valor autoritativo, pero debe respetar exactamente esta composición; ejemplo `263011041001` |
| `letra_visual` | Estado `letras_por_articulo` del repositorio | Mapeo independiente `{articulo: letra}` | Primera letra española libre: A…N, Ñ, O…Z, luego AA, AB…; es única y se puede editar/liberar en la sección de códigos del mapa | Solo código corto del mapa y filtros por código | Persistir en una tabla/configuración de mapeo si se requiere estabilidad entre sesiones; no guardarla en el catálogo de artículos |
| `codigo_visual` | Derivado para mapa | No es ID persistente del pallet | `letra_visual + numero_pallet`; técnico `A01`, legible `A-01` | Celdas, búsqueda y fichas del mapa | Relación reversible con artículo + número de pallet mientras el mapeo de letras sea vigente |
| `codigo5_por_articulo` | Generador legado del original | Código artificial `11000 + n×13` | Asignación secuencial separada | Exclusivamente exportaciones específicas “Mapa por Código” del escritorio | No representa el artículo real y no debe incorporarse a `id_lote_real`; pendiente revisar en la fase de mapa/reportes |
| `estado` | Pallet | Texto de negocio | Comparación normalizada solo donde el controlador lo necesita | Estado completo en tablas y tarjetas | Vocabulario original: `LIBERADO`, `RECHAZO`, `VERIFICACIÓN`, `REPROCESO`, `SIN DM`, `PEDIDO`, `SIN INFORMACIÓN`, `BLOQUEADOS`, `LOTES INCOMPLETOS`, `AUTORIZADOS A ENVIAR`, `PROHIBICIONES` |
| abreviación de estado | Configuración del mapa | No se almacena como estado | Mapeo visual: `LIB`, `RCH`, `VER`, `RPR`, `SDM`, `PED`, `S/I`, `BLQ`, `INC`, `AUT`, `PRH` | Solo leyendas/celdas compactas del mapa | Nunca sustituir el estado completo en tablas o BD |
| `cajas` | Pallet | Entero | Sumas por lote, artículo, cámara y estado | Columnas y KPIs de cajas | Dato cuantitativo que debe venir de inventario/BD |
| `kilos` general | Calculado | El pallet base original no tiene kilos autoritativos | `cajas × 12` | Stock, Movimientos, Aprobaciones, totales y pivots | No almacenar un valor de demostración independiente que pueda contradecir cajas |
| `kilos` de packing especial | Adaptador de packing list del escritorio | Temporal/simulado | `cajas ×` un peso determinístico elegido entre 10,0; 11,4 y 12,0 kg | Solo packing list especial | Excepción de reporte, no regla canónica de stock. En BD debe provenir del peso real del documento si existe |
| `ubicacion` | Pallet | ID lógico de almacén | Se relaciona con nombre/color/código SAP | Filtros, tablas, KPIs y agrupaciones | Valores originales: PROTER, POST TUNEL, CAMARA CERO, ANDÉN DE PRODUCCIÓN, ANDÉN DE DESPACHO, PATIO, CÁMARA VIRTUAL |
| `codigo_sap_almacen` | Configuración de almacenes | Relación por `ubicacion` | Lookup | Etiquetas/reportes donde corresponda | `CAM302`, `PTUN02`, `ANPRO02`, `ADESP02`, `PATIO02`, `CVIRT02`; Cámara Cero no tiene código configurado |
| `banda` / zona | Posición física del mapa | Número o texto; puede ser nulo | Normalización específica del mapa; bandas `01`/`02` pueden conservar cero inicial | Coordenada física compacta | Debe provenir en el futuro de posiciones de mapa, no inferirse de `ubicacion` |
| `posicion` | Posición física del mapa | Entero o nulo | Compactación al mover/eliminar pallets | Coordenada física | Relación separada del almacén lógico |
| `altura` | Posición física del mapa | Nivel o nulo | Ninguna fuera del motor de mapa | Coordenada física | Relación separada del almacén lógico |
| `repetido` | Calculado por mapa | Booleano temporal | Cuenta códigos visuales ocupados repetidos | Overlay blanco `REPETIDO` | No es un estado de negocio ni debe reemplazar `estado` |
| `no_existe` | Enriquecimiento simulado original | Booleano temporal | Simulación determinística por lote | Overlay azul `NO EXISTE` del mapa | No es un estado de negocio; en BD debería provenir de una validación real contra posición/inventario |
| `fecha_admision` | Enriquecimiento actual, BD futura | Texto `dd/mm/aaaa` | Simulado determinísticamente por lote | Stock, aprobaciones y detalle | Debe venir de recepción/admisión real |
| `fecha_fabricacion` | Enriquecimiento actual, BD futura | Texto `dd/mm/aaaa` | Simulado determinísticamente por lote | Stock y detalle | Debe venir de producción o trazabilidad real |
| `fecha_ingreso` de WMS_WEB | Semilla web | ISO `aaaa-mm-dd` | Se convierte a `dd/mm/aaaa` al presentar en Operaciones | Compatibilidad temporal de la demo web | Sustituir por `fecha_admision` real al conectar BD |
| `detector_metales` | Enriquecimiento actual, BD futura | `APROBADO` / `RECHAZADO` | Hoy simulado a partir de estado/lote | Tablas y ficha detallada | Debe provenir del control real, no deducirse del estado en producción |
| `temperatura` | Enriquecimiento actual, BD futura | Texto con °C | Hoy simulada según lote/ubicación | Ficha detallada y packing | Debe recibirse como número + unidad/fecha de medición en un diseño de BD real |
| `info_calidad` | Enriquecimiento actual, BD futura | Texto | Hoy texto determinístico por lote | Celdas/modales de calidad y motivo de aprobación | Debe provenir de control de calidad |
| `calidad_estado` | Enriquecimiento actual | `OK` / `ALERTA` | Hoy derivado de estados de alerta | Badge visual | Puede ser calculado desde reglas o recibido; documentar su autoridad al diseñar BD |
| `info_general` | Enriquecimiento actual, BD futura | Texto | Hoy texto determinístico por lote | Celdas/modales | Debe provenir de observaciones operacionales |
| `info_detallada` | Placeholder original | Texto temporal | Sin transformación | Ficha de lote | El original declara explícitamente que falta definir su contenido; no inventar semántica |
| `reservado` | Enriquecimiento actual | `SÍ` / `NO` | Hoy `SÍ` cuando estado es `PEDIDO` | Tabla/ficha | En producción debería proceder de reserva/pedido real |
| `clasificacion_envio` | Acción de despacho | Texto opcional | Se asigna al enviar a `AUTORIZADOS A ENVIAR` | Despacho y vistas relacionadas | Valores originales controlados por el flujo de despacho; persistir con auditoría |

## 3. Diferencias detectadas y correcciones realizadas

| Diferencia previa en WMS_WEB | Causa | Corrección 4.1.0 |
|---|---|---|
| `kilos` contenía valores independientes (p. ej. 600 kg para 60 cajas) | Semilla web inventaba kilos sin aplicar la regla original | Migración y adaptadores calculan siempre `cajas × 12`; Stock, Operaciones, Andén, inventario 1D, drawer y exportaciones usan la misma regla |
| `numero_pallet` comenzaba nuevamente en cada cámara y era global dentro de ella | Se usó el índice de cada bucle de semilla | La migración de la semilla web recalcula el correlativo por artículo sobre todo el inventario |
| Operaciones mostraba `lote` interno y `articulo` crudo | Los campos derivados solo existían dentro de Stock | El contrato compartido ahora entrega `id_lote_real` y `numero_articulo` a todas las vistas |
| El ID real se armaba con literales `26` y `30` dentro de Stock | Regla duplicada y no centralizada | Nueva configuración `IDENTIDAD_PLANTA` y funciones únicas en `PalletModel` |
| El catálogo incluía `letra: A…J` | Se confundió dato maestro con referencia visual | Las letras se eliminaron del catálogo y se asignan en un mapeo independiente a partir de artículos presentes en inventario |
| Stock aceptaba directamente `id_lote_real` en “Lote Detallado” | Comportamiento añadido sin respaldo del resolvedor original | Se restauró la búsqueda original: lote interno exacto (con/sin `L-`) o código visual letra+número |
| Operaciones y Stock generaban textos de calidad diferentes para el mismo pallet | Cada módulo tenía su propio fallback | Operaciones consume el mismo enriquecimiento temporal de Stock |
| CSV, packing HTML, Andén y fichas visuales usaban lote interno/kilos ficticios | Consumían directamente la semilla | Ahora usan los adaptadores de ID de lote, N° de artículo, descripción y kilos |

## 4. Datos que siguen siendo temporales o hardcodeados

- Los 300 pallets de `WMS_WEB`, sus lotes, cajas, estados, ubicaciones y fechas
  son una semilla de demostración persistida localmente. No provienen de una
  consulta ni deben desplegarse como datos productivos.
- `Programa MVC` también usa una semilla, pero más extensa (aprox. 610 pallets
  y siete almacenes). No se copió esa base ficticia a WMS_WEB: la auditoría
  corrige reglas, no reemplaza una simulación por otra.
- Fechas de admisión/fabricación, temperatura, detector, calidad, información
  general, reserva y `no_existe` son enriquecimientos simulados mientras no
  exista una fuente real.
- Folio, destino, chofer y patente por defecto en `ExportService` son valores de
  demostración. Deben llegar desde el formulario/documento real en la fase de
  Reportes; no son reglas de negocio confirmadas.
- La asignación web de letras ya está separada del catálogo, pero todavía no
  implementa la interfaz completa del original para editar/liberar letras ni
  su auditoría. Eso corresponde a la futura fase de Mapa y no fue alterado aquí.
- `codigo5_por_articulo` no se implementó como código productivo en WMS_WEB. Su
  único uso original es una exportación específica del mapa y debe revisarse en
  esa fase, sin confundirlo con `articulo`.

## 5. Contrato mínimo para una futura base de datos

La fuente real debería entregar, como mínimo, `id`, `lote`, `articulo`,
`cajas`, `estado` y `ubicacion`, más las fechas y controles reales disponibles.
Debe decidirse con el origen si `numero_pallet` e `id_lote_real` llegan ya
validados o se calculan en el adaptador. En ambos casos:

1. `articulo` conserva el código real sin prefijos visuales.
2. `numero_pallet` mantiene el correlativo dentro del artículo.
3. `id_lote_real` usa temporada + planta fija + artículo + correlativo mínimo 3.
4. `kilos` generales se calculan desde cajas salvo que una fuente autoritativa
   documentada cambie expresamente esa regla.
5. Descripción y organicidad se resuelven desde el maestro de artículos.
6. Letras y códigos visuales permanecen en una capa de mapa separada.
7. Posición física y almacén lógico se modelan como relaciones distintas.
8. Estados sintéticos del mapa (`REPETIDO`, `NO EXISTE`) no se guardan como
   estados comerciales del pallet.
