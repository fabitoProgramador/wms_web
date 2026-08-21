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
- `public.wms_analisis_operacional('PROTER','TODO')` únicamente para la serie histórica de recepciones SAP mostrada en la tarjeta superior.

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
- La tarjeta de recepciones ya no muestra un porcentaje de “tendencia” deducido de un snapshot. Presenta el histórico mensual real de fecha de recepción SAP, evitando una métrica engañosa.
- Los RPC requieren rol `authenticated` y el permiso backend `stock.ver`.
- No se modificó CSS.

Datos de validación del snapshot cargado:

- `Lotes_en_Stock`: 1.064 filas exactas del Excel fuente.
- 1.062 `id_lote` lógicos / 1.062 instancias WMS activas.
- PROTER (`CAM302`): 430 pallets, 28.346,017 cajas, 308.922,81 kg, capacidad 508, ocupación 84,6% y 78 disponibles.
- KPI actuales PROTER: 350 bloqueados y 80 liberados; los demás parten en cero hasta que existan estados/procesos WMS correspondientes.
- El hash de las 28 columnas del snapshot coincide exactamente con `stock.xlsx`.

### 02.2 — Análisis Operacional

Estado: **conectado al backend, pendiente de auditoría funcional submenú por submenú**.

Contrato previsto:

- `public.wms_analisis_operacional(p_almacen,p_periodo)`

No se marca cerrado hasta revisar individualmente filtros, gráficos, cálculos, estados vacíos, permisos y semántica de cada indicador.

### 02.3 — Monitor en Tiempo Real

Estado: **conectado al backend, pendiente de auditoría funcional submenú por submenú**.

Contratos previstos:

- `public.wms_monitor_resumen()`
- `public.wms_monitor_eventos(...)`

No se marca cerrado hasta revisar filtros, actualización periódica, eventos, alertas, conectividad, estados vacíos y permisos.

### Limpieza frontend del Panel

- `js/models/dashboardModel.js` es el adaptador remoto del Panel.
- Resumen Ejecutivo no consulta `MapaModel`, `OperacionesModel`, verificaciones locales ni almacenamiento local para obtener información operacional.
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
   - Análisis Operacional — siguiente auditoría.
   - Monitor en Tiempo Real — pendiente posterior.
3. Stock Planta y Lote Detallado.
4. Mapa / Gruero.
5. Operaciones / Movimientos / Despacho / Aprobaciones / Bitácora / Verificaciones.
6. Andén / Despacho complementario.
7. Inventario.
8. Reportes / Etiquetas.
9. Usuarios / administración.

El orden puede ajustarse si una dependencia real exige adelantar una sección.
