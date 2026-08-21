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

#### Tendencia de ocupación

La tendencia mide **cambio neto real de stock de cámara entre sincronizaciones SAP**, no fecha de recepción del producto.

Se creó `wms_private.stock_ocupacion_snapshots`, que guarda únicamente una fotografía agregada por cámara:

- pallets;
- cajas;
- kilos;
- capacidad;
- porcentaje de ocupación;
- fecha de captura y fecha del snapshot SAP.

`wms_private.capturar_stock_ocupacion_snapshot()` se ejecuta al finalizar `wms_sincronizar_padre(...)`. Si el saldo no cambió, no crea un punto duplicado. Si cambia, el siguiente punto calcula delta de pallets, cajas, kilos y puntos porcentuales de ocupación.

Esto permite representar correctamente entradas hacia PROTER y salidas desde PROTER sin modificar ni duplicar el detalle de `Lotes_en_Stock`.

La primera fotografía real es el baseline actual. No se inventó un histórico anterior porque el snapshot SAP actual no permite reconstruir de manera fiable a qué hora ocurrió cada entrada/salida pasada.

Prueba transaccional validada: mover temporalmente un pallet de PROTER a Andén produjo `-1 pallet`, `-8 cajas`, `-80 kg` y `-0,20 pp`; la transacción se revirtió después de comprobar el cálculo.

Datos baseline:

- PROTER: 430/508 pallets, 84,65%.
- POST TÚNEL: 343/356 pallets, 96,35%.

### 02.2 — Análisis Operacional

Estado: **cerrado contra backend**.

Contrato:

- `public.wms_analisis_operacional(p_almacen,p_periodo)`

Filtros validados:

- Cámara: `TODOS`, `PROTER`, `POST TUNEL`.
- Período: `HOY`, `7D`, `30D`, `90D`, `TODO`.
- `TODOS` significa **PROTER + POST TÚNEL**, no todos los almacenes SAP. Patio, Andén, despacho virtual u otras ubicaciones no se mezclan con la capacidad física de las cámaras.
- El período afecta tendencia/actividad histórica; stock, distribución y capacidad representan el estado actual del alcance seleccionado.

Lecturas separadas:

1. **Ocupación de stock SAP**: pallets presentes en cámara / capacidad configurada.
2. **Ocupación del Mapa WMS**: posiciones físicas registradas en `Posiciones_Mapa` / capacidad del mapa.

Estas métricas no se mezclan. Un mapa todavía vacío puede marcar 0 posiciones WMS sin convertir falsamente el stock SAP en 0% de ocupación.

Datos actuales validados:

- PROTER: 430/508 = 84,6%, 78 disponibles.
- POST TÚNEL: 343/356 = 96,3%, 13 disponibles.
- Ambas cámaras: 773/864 = 89,5%, 91 disponibles.
- El universo combinado contiene 773 `id_lote` únicos en las dos cámaras en este snapshot.
- `Posiciones_Mapa` todavía no tiene posiciones para este stock, por lo que la ocupación de mapa permanece 0% y se muestra como capa independiente.

La vista muestra:

- pallets actuales;
- cajas actuales;
- ocupación de stock;
- posiciones WMS;
- tendencia de ocupación por cámara a partir de snapshots;
- actividad de verificaciones/rechazos/despachos del período;
- distribución por estado;
- Top 5 productos por cajas;
- capacidad de stock por cámara;
- capacidad total de stock;
- posiciones registradas en Mapa WMS;
- lectura operacional por etapas;
- insights calculados por backend.

`Despachados` cuenta pallets pertenecientes a despachos `CERRADO` según `fecha_operacional` y utiliza el almacén snapshot del despacho. No se infiere un despacho por la desaparición de un pallet del padre SAP.

Las barras con valor cero ya no dibujan un ancho mínimo artificial. Los insights de “cámara con mayor ocupación” utilizan ocupación de stock SAP, no el mapa WMS vacío.

Se validó el RPC con la sesión Auth/RBAC real del usuario administrador, además de sus cálculos internos. `wms_analisis_operacional` y `wms_dashboard_ocupacion_tendencia` no tienen ejecución para `anon`.

No se modificó CSS.

### 02.3 — Monitor en Tiempo Real

Estado: **conectado al backend, pendiente de auditoría funcional submenú por submenú**.

Contratos previstos:

- `public.wms_monitor_resumen()`
- `public.wms_monitor_eventos(...)`

No se marca cerrado hasta revisar filtros, actualización periódica, eventos, alertas, conectividad, estados vacíos y permisos.

### Limpieza frontend del Panel

- `js/models/dashboardModel.js` es el adaptador remoto del Panel.
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
