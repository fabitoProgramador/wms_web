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

## Fase 02 — Panel de Control

Estado: **migrado a backend**.

### Resumen Ejecutivo

Fuente única:

- `public.wms_dashboard_resumen(p_almacen_codigo)`
- `public.wms_dashboard_estado_detalle(...)`

Reglas aplicadas:

- Resumen PROTER trabaja con `CAM302`.
- Un `id_lote` conserva una sola identidad WMS aunque exista en varias filas SAP.
- Para un almacén concreto, cajas/kilos corresponden exclusivamente al saldo de ese almacén.
- Los pallets `MULTI` no desaparecen del KPI si poseen una ocurrencia SAP en el almacén consultado.
- Capacidad física proviene de `wms_configuracion`, no de una constante JavaScript.
- “Cámaras activas” representa las cámaras físicas PROTER/POST TÚNEL con stock, no todos los almacenes SAP.
- El detalle de KPI se busca/pagina en backend; no filtra una matriz local.

### Análisis Operacional

Fuente única:

- `public.wms_analisis_operacional(p_almacen,p_periodo)`

El backend calcula stock, cajas, kilos, ingresos, actividad, distribución, top productos, capacidad, etapas e insights. El frontend sólo adapta esos datos a los gráficos existentes.

Para PROTER/POST TÚNEL se usa saldo específico del almacén; para TODOS se conserva una identidad lógica por pallet.

### Monitor en Tiempo Real

Fuente única:

- `public.wms_monitor_resumen()`
- `public.wms_monitor_eventos(...)`

El Monitor ya no mezcla eventos, verificaciones, cargas o colas simuladas del navegador. Si Supabase no está disponible, muestra indisponibilidad; no reemplaza el backend con datos locales.

### Limpieza frontend

- Nuevo `js/models/dashboardModel.js`: adaptador remoto exclusivo del Panel.
- `DashboardController` no consulta `MapaModel`, `OperacionesModel`, verificaciones locales ni almacenamiento local para obtener información operacional.
- `PanelControlModel` continúa cargado **temporalmente sólo** porque Bitácora y Registro de Verificaciones todavía no han llegado a su fase de migración. No es fuente del Panel de Control.
- No se modificó el CSS del Panel.
- La acción “Ubicar en mapa” no consume el mapa local; se habilitará cuando el módulo Mapa sea migrado al backend.

## Regla para las siguientes secciones

Antes de modificar una vista:

1. Inventariar métodos, controladores y modelos actuales.
2. Identificar datos locales/simulados que deben desaparecer.
3. Contrastar cada lectura y acción con RPC, tabla/vista y permiso real del backend.
4. Detectar controles que ya no correspondan por automatización del backend.
5. Mantener la composición visual salvo que una regla real obligue a cambiar un control.
6. Reemplazar la fuente local por el contrato remoto.
7. Limpiar la lógica local que ya no tenga consumidores válidos.
8. Probar el módulo con datos reales antes de avanzar.

## Regla durante la transición

Una sección todavía no migrada se considera **legacy pendiente**. Sus datos locales no deben interpretarse como información real ni utilizarse para validar reglas de negocio.

## Rama de trabajo

Toda la integración nueva se mantiene en una sola rama: **`WMS_WEB`**.

Para probar una versión completa: seleccionar `WMS_WEB` en GitHub → **Code → Download ZIP**.

## Orden de migración

1. Login / sesión — completado.
2. Panel de Control — backend migrado.
3. Stock Planta y Lote Detallado.
4. Mapa / Gruero.
5. Operaciones / Pedidos / Aprobaciones.
6. Andén / Despacho.
7. Inventario.
8. Verificaciones / Bitácora.
9. Reportes / Etiquetas.
10. Usuarios / administración.

La lista puede ajustarse si una dependencia real exige adelantar una sección.
