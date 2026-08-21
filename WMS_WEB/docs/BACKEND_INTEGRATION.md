# Integración WMS_WEB ↔ Supabase

Este documento registra la migración del frontend al backend WMS real.

## Regla de arquitectura

Supabase es la **única fuente de verdad** para identidad, roles, permisos y datos operacionales WMS.

El frontend puede conservar almacenamiento local únicamente para:

- shell/PWA y archivos estáticos offline;
- caché explícita de recursos;
- preferencias visuales;
- referencias estáticas necesarias para arrancar la interfaz;
- token/sesión cuando corresponda.

No se permite usar `localStorage`, matrices JavaScript, mocks o caches como sustituto de stock, usuarios, permisos, estados, bitácoras, verificaciones, eventos u otros datos de negocio.

Cuando un submenú queda migrado, su implementación local anterior se elimina si ya no tiene consumidores. No se mantienen dos fuentes de verdad "por si acaso".

## Fuente de verdad

- SAP: `public."Lotes_en_Stock"`.
- Estado operacional: tablas/vistas/RPC WMS en Supabase.
- Identidad: Supabase Auth, correo + contraseña.
- Autorización: RBAC WMS + permisos exigidos dentro de los RPC.
- El navegador nunca decide permisos ni estados operacionales.

## Metodología

La migración se cierra **submenú por submenú**:

1. Inventariar botones, métodos, filtros y acciones existentes.
2. Detectar datos locales/simulados involucrados.
3. Contrastar cada lectura/acción con backend real.
4. Corregir primero el backend si la regla autoritativa está incompleta.
5. Adaptar el frontend: agregar, automatizar o retirar controles según la regla real.
6. Mantener estructura visual/CSS salvo cambio de negocio necesario.
7. Validar datos reales, estados vacíos, errores, permisos, límites y concurrencia.
8. Eliminar la implementación anterior que ya haya quedado sustituida.
9. Sólo entonces cerrar el submenú.

---

## 01 — Login / sesión

**Estado: cerrado y activo.**

- Login real con Supabase Auth.
- `wms_sesion_actual()` valida usuario WMS, rol y permisos.
- Sin usuarios ni contraseñas locales.
- Sesión restaurada y revalidada contra backend.
- Logout invalida Auth.
- Recuperación por correo.

### Header transversal

Se conserva su estructura/CSS.

- Usuario, rol y sesión provienen de Supabase.
- `ACTUALIZAR DATOS` revalida sesión y vuelve a consultar la vista activa.
- El estado visible representa backend real.
- Tema claro/oscuro puede permanecer como preferencia local.
- No existe fallback operacional local.

---

## 02 — Panel de Control

### 02.1 — Resumen Ejecutivo

**Estado: cerrado.**

RPC:

- `wms_dashboard_resumen`
- `wms_dashboard_estado_detalle`
- `wms_dashboard_ocupacion_tendencia`

Reglas principales:

- PROTER = CAM302.
- Una identidad WMS por `id_lote`, aunque SAP tenga varias filas.
- Cantidades por almacén usan exclusivamente el saldo del almacén consultado.
- Capacidad viene de `wms_configuracion`.
- Detalle KPI y búsqueda se ejecutan en PostgreSQL.
- Paginación interna completa el total aunque el RPC limite cada página a 200.
- Panel no consulta `MapaModel`/localStorage para completar datos.

### Tendencia de ocupación / stock

El histórico usa snapshots reales capturados al finalizar `wms_sincronizar_padre(...)`.

Por almacén conserva métricas agregadas:

- pallets;
- cajas;
- kilos;
- capacidad/ocupación cuando existe;
- entradas y salidas entre sincronizaciones.

PROTER/Post Túnel muestran tendencia de ocupación. Los almacenes sin capacidad configurada muestran tendencia de stock, sin inventar porcentajes.

Baseline cámaras:

- PROTER: 430/508 = 84,65%.
- POST TÚNEL: 343/356 = 96,35%.

---

### 02.2 — Análisis Operacional

**Estado: cerrado.**

RPC:

- `wms_analisis_operacional`
- `wms_analisis_almacenes_catalogo`

`TODOS` significa **PROTER + POST TÚNEL** y mantiene el análisis físico combinado.

Además el selector se construye dinámicamente desde los almacenes vigentes de `Lotes_en_Stock`. Actualmente:

- PROTER / CAM302: 430 pallets.
- POST TÚNEL / PTUN02: 343.
- ANDÉN DE PRODUCCIÓN / ANPRO02: 30.
- PATIO / PATIO02: 231.
- ANDÉN DE DESPACHO / ADESP02: 29.
- CÁMARA VIRTUAL / CVIRT02: 1.

Filtros de período: `HOY`, `7D`, `30D`, `90D`, `TODO`.

Se separan:

1. ocupación de stock SAP;
2. posiciones del Mapa WMS;
3. flujo de entradas/salidas entre snapshots.

Los almacenes sin capacidad devuelven `ocupación = null` y la vista presenta stock/kilos/flujo en vez de una ocupación ficticia.

Frontend específico:

- `js/models/dashboardAnalysisModel.js`
- `js/controllers/dashboardAnalysisController.js`

La implementación antigua de Análisis fue retirada de `dashboardModel.js` y `dashboardController.js`.

---

### 02.3 — Monitor en Tiempo Real

**Estado: cerrado.**

RPC:

- `wms_monitor_resumen()`
- `wms_monitor_eventos(p_desde,p_limite,p_tipo)`

Permisos:

- sólo `authenticated` / `service_role`;
- backend exige `historial.ver` y `stock.ver` donde corresponde;
- `anon` no tiene `EXECUTE`.

#### Estado superior

El Monitor ya no interpreta una respuesta HTTP exitosa como "SAP sincronizado". El backend calcula la sincronización real comparando:

- IDs lógicos del padre SAP;
- instancias WMS activas;
- timestamp más reciente de `Lotes_en_Stock`;
- timestamp SAP del último snapshot capturado.

Estado actual validado:

- 1.062 IDs SAP lógicos;
- 1.062 instancias WMS activas;
- diferencia 0;
- snapshot SAP y padre con el mismo timestamp;
- `sincronizado = true`.

Si el padre cambia y todavía no se capturó un nuevo snapshot, el Monitor genera una alerta crítica indicando específicamente que existe una actualización SAP más reciente.

#### Ocupación

Se muestran como capas distintas:

- ocupación de stock de cámaras: 773/864 = 89,5%;
- PROTER: 430/508 = 84,6%;
- POST TÚNEL: 343/356 = 96,3%;
- posiciones del Mapa WMS: capa secundaria, actualmente 0 hasta migrar/cargar Mapa.

El Monitor nunca convierte un mapa vacío en "cámara vacía".

#### Feed de eventos

Filtros entregados por backend:

- Todos;
- Sincronización;
- Mapa;
- Gruero;
- Verificaciones;
- Inventario;
- Carga / Despacho;
- Operaciones.

El feed integra eventos reales de las tablas WMS y agrega eventos de snapshot SAP como `SINCRONIZACION`.

Actualmente existe un evento real de sincronización; los demás filtros están vacíos porque todavía no existen operaciones registradas en sus tablas.

No se generan eventos ficticios para poblar la pantalla.

#### Refresco y conectividad

- refresco cada 15 segundos sólo cuando Monitor está activo y la pestaña está visible;
- `online/offline` fuerza revalidación;
- cambio de filtro fuerza consulta nueva;
- `requestId` evita que una respuesta antigua sobrescriba una más nueva;
- el refresco periódico evita consultas duplicadas mientras otra está en curso;
- la tarjeta "Última actividad" usa la actividad global del sistema, no el filtro seleccionado;
- sin conexión se conserva el shell offline, pero no se muestran datos WMS locales como reemplazo.

Frontend específico:

- `js/models/dashboardMonitorModel.js`
- `js/controllers/dashboardMonitorController.js`

La implementación antigua de Monitor fue retirada de `dashboardModel.js` y `dashboardController.js`.

---

## Limpieza del Panel

El Panel queda organizado así:

- `dashboardModel.js`: núcleo remoto + Resumen Ejecutivo + helpers compartidos.
- `dashboardController.js`: núcleo visual + Resumen Ejecutivo + delegación de submenús.
- `dashboardAnalysisModel.js`: Análisis Operacional.
- `dashboardAnalysisController.js`: Análisis Operacional y helpers gráficos propios.
- `dashboardMonitorModel.js`: Monitor en Tiempo Real.
- `dashboardMonitorController.js`: Monitor, filtros y refresco.

No quedan implementaciones duplicadas de Análisis ni Monitor en los archivos base.

`PanelControlModel` permanece **temporalmente** porque Bitácora/Registro de Verificaciones legacy todavía lo consumen. Por ejemplo, `bitacoraController.js` continúa llamando `PanelControlModel.filterBitacoras`, `getBitacoras`, `resumenVerificaciones`, etc. Cuando esas vistas se migren en Operaciones, esos consumidores se reemplazarán y el bloque/file local podrá eliminarse.

Bitácora y Registro de Verificaciones ya fueron movidos en navegación a **Operaciones**.

---

## Offline

"Frontend limpio" no significa eliminar el soporte offline.

Se mantienen:

- Service Worker;
- shell de la aplicación;
- CSS/JS/assets cacheados;
- referencias estáticas útiles;
- preferencias de interfaz.

Se eliminan progresivamente:

- usuarios locales;
- stock local de negocio;
- estados simulados;
- eventos ficticios;
- bitácoras/verificaciones locales cuando llegue su migración;
- cualquier fallback que pueda contradecir Supabase.

---

## Rama

Toda la integración se mantiene en una sola rama: **`WMS_WEB`**.

Para probar: GitHub → rama `WMS_WEB` → **Code → Download ZIP**.

## Orden de migración

1. Login / sesión — cerrado.
2. Panel de Control:
   - Resumen Ejecutivo — cerrado.
   - Análisis Operacional — cerrado.
   - Monitor en Tiempo Real — cerrado.
3. Stock — siguiente fase, submenú por submenú.
4. Mapa / Gruero.
5. Operaciones / Movimientos / Despacho / Aprobaciones / Bitácora / Verificaciones.
6. Andén.
7. Inventario.
8. Reportes / Etiquetas.
9. Usuarios / administración.
