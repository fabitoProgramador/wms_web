# Integración WMS_WEB ↔ Supabase

Este documento registra la conexión definitiva del frontend con el backend WMS real.

## Regla principal

Supabase es la **única fuente de verdad** para identidad, roles, permisos y datos operacionales WMS. Los datos locales históricos del navegador no se utilizan como base de negocio.

`localStorage`/`sessionStorage` sólo pueden usarse para preferencias de interfaz, caché/offline explícita o tokens de sesión; nunca para reemplazar tablas/RPC del backend.

## Fuente de verdad

- SAP: `public."Lotes_en_Stock"`.
- Estado operacional WMS: tablas/RPC WMS de Supabase.
- Identidad: Supabase Auth por **correo + contraseña**.
- Autorización: RBAC WMS (`wms_roles`, `wms_permisos`, `wms_rol_permisos`) y RLS/RPC.
- El navegador nunca decide permisos ni estados operacionales.

## Metodología de migración

La migración se cierra **submenú por submenú**, no por módulo completo.

Para cada submenú:

1. Inventariar métodos, botones, filtros y acciones actuales.
2. Identificar cualquier dato local/simulado que participe en la vista.
3. Contrastar cada lectura y acción con RPC, tabla/vista y permiso real del backend.
4. Corregir primero el backend si la regla autoritativa está incompleta.
5. Adaptar el frontend al contrato real: agregar, automatizar o retirar controles cuando corresponda.
6. Mantener estructura visual/CSS salvo que una regla de negocio exija un cambio de interfaz.
7. Validar datos reales, estados vacíos, errores, permisos y límites/paginación.
8. Sólo después marcar ese submenú como cerrado y avanzar al siguiente.

## Fase 01 — Login / sesión

Estado: **completada y activa**.

1. Login envía correo + contraseña a Supabase Auth.
2. Si Auth valida, el frontend llama `public.wms_sesion_actual()`.
3. El backend comprueba usuario WMS, rol, correo, vigencia y permisos.
4. El frontend recibe usuario/rol/permisos sin cambiar el diseño del Login.
5. Al recargar se restaura el token desde `sessionStorage` y se vuelve a validar el backend.
6. No existe fallback a usuarios ni contraseñas locales.
7. Logout invalida la sesión Auth.
8. Recuperación usa Supabase Auth por correo.

### Header transversal

La estructura y CSS del header se mantienen.

- El estado visible representa Supabase, no un texto local estático.
- El antiguo botón `SINCRONIZAR TURNO` conserva el mismo componente visual, pero ahora aparece como `ACTUALIZAR DATOS` y revalida `wms_sesion_actual()` antes de volver a consultar la vista activa.
- Usuario, rol y RUT provienen de la sesión Supabase/WMS.
- No existe fallback a datos operacionales locales cuando el backend falla.
- `Editar mis datos` se oculta temporalmente porque aún no existe un RPC específico de edición de perfil personal. Se resolverá en Administración de Usuarios; no se deja un botón visualmente activo sin contrato backend.
- Tema claro/oscuro puede seguir siendo una preferencia local porque no es un dato de negocio.

## Fase 02 — Panel de Control

Se valida por submenú.

### 02.1 — Resumen Ejecutivo

Estado: **cerrado contra backend**.

Fuente única:

- `public.wms_dashboard_resumen(p_almacen_codigo)`
- `public.wms_dashboard_estado_detalle(...)`
- `public.wms_dashboard_ocupacion_tendencia(p_almacen,p_limite)`

Reglas y validaciones aplicadas:

- Resumen PROTER trabaja con `CAM302`.
- Un `id_lote` conserva una sola identidad WMS aunque exista en varias filas SAP.
- Para un almacén concreto, cajas/kilos corresponden exclusivamente al saldo de ese almacén.
- Los pallets `MULTI` no desaparecen del KPI si poseen una ocurrencia SAP en el almacén consultado.
- Capacidad proviene de `wms_configuracion`, no de una constante JavaScript.
- “Cámaras activas” representa PROTER/POST TÚNEL con stock, no todos los almacenes SAP.
- El detalle KPI se busca en PostgreSQL; no filtra una matriz local.
- El RPC limita cada página a 200 filas. `DashboardModel.estadoDetalle()` recorre las páginas necesarias hasta completar `total_resultados`; por ejemplo, 350 bloqueados no quedan truncados a 200.
- La búsqueda por lote, artículo, descripción, código visual o almacén usa el RPC.
- Se protege la interfaz contra respuestas de búsquedas antiguas que lleguen después de una consulta más nueva.
- El detalle muestra ID lote, artículo, descripción, almacén/posición WMS, cajas, kilos y estado operacional disponible.
- `Ubicar en mapa` permanece deshabilitado hasta que Mapa sea migrado; Resumen no consulta `MapaModel` ni localStorage como sustituto.
- El catálogo `Articulos_Codigo` actualmente está vacío; por eso `codigo_visual` puede ser nulo. La vista utiliza `ItemCode`/`id_lote` como fallback sin inventar letras en JavaScript. El catálogo se resolverá en la fase correspondiente.
- Los RPC requieren rol `authenticated` y el permiso backend `stock.ver`.
- No se modificó CSS.

#### Tendencia de ocupación / stock

El histórico se basa en **snapshots reales entre sincronizaciones SAP**, no en `fecha_rec` del producto.

`wms_private.stock_ocupacion_snapshots` conserva una fotografía agregada por cada almacén vigente del padre:

- pallets;
- cajas;
- kilos;
- capacidad y porcentaje cuando existe capacidad configurada;
- entradas y salidas de pallets entre sincronizaciones;
- cajas/kilos asociados a entradas y salidas;
- fecha de captura y fecha del snapshot SAP.

`wms_private.stock_almacen_membresia_actual` conserva sólo la membresía actual `id_lote + almacén` necesaria para distinguir entradas y salidas sin duplicar históricos completos del padre.

`wms_private.capturar_stock_ocupacion_snapshot()` se ejecuta al finalizar `wms_sincronizar_padre(...)`. Si el saldo no cambió, no crea ruido. Si cambia, el siguiente punto puede mostrar variación neta y también entradas/salidas por almacén.

Para PROTER y POST TÚNEL, donde existe capacidad configurada, el gráfico se interpreta como **tendencia de ocupación**. Para Patio, Andenes y otras ubicaciones sin capacidad física configurada se interpreta como **tendencia de stock**, sin inventar un porcentaje de ocupación.

La primera fotografía real es el baseline actual. No se inventó un histórico anterior porque el snapshot SAP actual no permite reconstruir de manera fiable a qué hora ocurrió cada entrada/salida pasada.

Pruebas transaccionales validadas:

- PROTER → Andén: `-1 pallet`, `-8 cajas`, `-80 kg`, `-0,20 pp` en PROTER.
- Andén de Producción → PROTER: una misma sincronización registró `1 salida` en Andén y `1 entrada` en PROTER, con `224,321 cajas` y `2.543,8 kg`; la transacción se revirtió después de comprobar el cálculo.

Datos baseline de cámaras:

- PROTER: 430/508 pallets, 84,65%.
- POST TÚNEL: 343/356 pallets, 96,35%.

### 02.2 — Análisis Operacional

Estado: **cerrado contra backend**.

Contratos:

- `public.wms_analisis_operacional(p_almacen,p_periodo)`
- `public.wms_analisis_almacenes_catalogo()`

Filtros validados:

- Alcance físico especial `TODOS`: **PROTER + POST TÚNEL**.
- Almacenes individuales: catálogo dinámico obtenido desde `Lotes_en_Stock`; el frontend no mantiene una lista local fija.
- Período: `HOY`, `7D`, `30D`, `90D`, `TODO`.
- El período afecta tendencia/actividad histórica; stock y distribución representan el estado actual del alcance seleccionado.

Almacenes vigentes actuales detectados automáticamente:

- PROTER (`CAM302`): 430 pallets.
- POST TÚNEL (`PTUN02`): 343 pallets.
- ANDÉN DE PRODUCCIÓN (`ANPRO02`): 30 pallets.
- PATIO (`PATIO02`): 231 pallets.
- ANDÉN DE DESPACHO (`ADESP02`): 29 pallets.
- CÁMARA VIRTUAL (`CVIRT02`): 1 pallet.

`TODOS` mantiene su significado físico: 430 + 343 = **773 pallets** en PROTER + POST TÚNEL. Los demás almacenes se consultan individualmente y no contaminan la capacidad combinada de cámaras.

Lecturas separadas:

1. **Ocupación de stock SAP**: pallets presentes / capacidad configurada, sólo donde existe una capacidad real.
2. **Ocupación del Mapa WMS**: posiciones físicas registradas en `Posiciones_Mapa` / capacidad del mapa.
3. **Flujo entre sincronizaciones**: entradas y salidas de pallets por almacén detectadas al comparar membresía SAP entre snapshots.

Estas métricas no se mezclan. Un almacén sin capacidad configurada devuelve `ocupación = null`, no `0%`, y la vista reemplaza esa tarjeta por kilos actuales y flujo del período.

Datos actuales validados:

- PROTER: 430/508 = 84,6%, 78 disponibles.
- POST TÚNEL: 343/356 = 96,3%, 13 disponibles.
- Ambas cámaras: 773/864 = 89,5%, 91 disponibles.
- Andén de Producción: 30 pallets, 3.403,889 cajas, 39.006 kg, sin porcentaje de ocupación artificial.
- Patio: 231 pallets, 9.401,3 cajas, 93.968,088 kg, sin porcentaje de ocupación artificial.
- Andén de Despacho: 29 pallets, 1.867,8 cajas, 18.678 kg.
- Cámara Virtual: 1 pallet, 70 cajas, 840 kg.

La vista muestra dinámicamente según el almacén:

- pallets actuales;
- cajas actuales;
- kilos actuales cuando no existe capacidad;
- ocupación de stock cuando existe capacidad;
- entradas y salidas SAP del período;
- tendencia de ocupación para cámaras o tendencia de stock para almacenes sin capacidad;
- actividad de verificaciones/rechazos/despachos del período;
- distribución por estado;
- Top 5 productos por cajas;
- capacidad y mapa WMS sólo cuando aplican;
- lectura operacional por etapas;
- insights calculados por backend.

`Despachados` cuenta pallets pertenecientes a despachos `CERRADO` según `fecha_operacional` y utiliza el almacén snapshot del despacho. No se infiere un despacho por la desaparición de un pallet del padre SAP.

Las barras con valor cero no dibujan un ancho mínimo artificial. Los insights de “cámara con mayor ocupación” utilizan ocupación de stock SAP, no el mapa WMS vacío.

Se validó el catálogo y los RPC con la sesión Auth/RBAC real, además de sus cálculos internos. `wms_analisis_operacional`, `wms_analisis_almacenes_catalogo` y `wms_dashboard_ocupacion_tendencia` no tienen ejecución para `anon`.

Frontend del submenú:

- `js/models/dashboardAnalysisModel.js`: adapta catálogo, métricas, flujos y tendencias remotas.
- `js/controllers/dashboardAnalysisController.js`: renderiza el selector dinámico y adapta la misma composición visual a cámaras y almacenes sin capacidad.
- No se modificó CSS.

### 02.3 — Monitor en Tiempo Real

Estado: **conectado al backend, pendiente de auditoría funcional submenú por submenú**.

Contratos previstos:

- `public.wms_monitor_resumen()`
- `public.wms_monitor_eventos(...)`

No se marca cerrado hasta revisar filtros, actualización periódica, eventos, alertas, conectividad, estados vacíos y permisos.

### Limpieza frontend del Panel

- `js/models/dashboardModel.js` es el adaptador remoto base del Panel.
- `js/models/dashboardAnalysisModel.js` y `js/controllers/dashboardAnalysisController.js` encapsulan la ampliación del submenú Análisis Operacional sin convertir el controlador base en una lista hardcodeada de almacenes.
- Resumen Ejecutivo y Análisis Operacional no consultan `MapaModel`, `OperacionesModel`, verificaciones locales ni almacenamiento local para obtener información operacional.
- `PanelControlModel` continúa cargado **temporalmente** sólo porque Bitácora y Registro de Verificaciones todavía conservan lógica legacy hasta su migración.
- Bitácora y Registro de Verificaciones ya fueron movidos en navegación desde `Panel de Control` a `Operaciones`.
- No se modificó el CSS del Panel.

## Regla durante la transición

Una sección todavía no migrada se considera **legacy pendiente**. Sus datos locales no deben interpretarse como información real ni utilizarse para validar reglas de negocio.

## Rama de trabajo

Toda la integración nueva se mantiene en una sola rama: **`WMS_WEB`**.

Para probar una versión completa: seleccionar `WMS_WEB` en GitHub → **Code → Download ZIP**.

## Orden actual de migración

1. Login / sesión — completado.
2. Panel de Control:
   - Resumen Ejecutivo — completado.
   - Análisis Operacional — completado.
   - Monitor en Tiempo Real — siguiente auditoría.
3. Stock Planta y Lote Detallado.
4. Mapa / Gruero.
5. Operaciones / Movimientos / Despacho / Aprobaciones / Bitácora / Verificaciones.
6. Andén / Despacho complementario.
7. Inventario.
8. Reportes / Etiquetas.
9. Usuarios / administración.

El orden puede ajustarse si una dependencia real exige adelantar una sección.
