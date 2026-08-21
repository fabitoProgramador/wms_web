# Integración WMS_WEB ↔ Supabase

Este documento registra la migración controlada desde los datos locales del frontend hacia el backend WMS real.

## Regla principal

La migración se realiza **sección por sección**. Mientras `SUPABASE_CONFIG.HABILITADO` permanezca en `false`, el frontend conserva el comportamiento local actual. No se debe eliminar lógica local de una sección antes de contrastarla método por método con sus RPC, permisos y reglas de negocio del backend.

## Fuente de verdad

- SAP: `public."Lotes_en_Stock"`.
- Estado operacional WMS: tablas/RPC WMS de Supabase.
- Identidad: Supabase Auth por **correo + contraseña**.
- Autorización: RBAC WMS (`wms_roles`, `wms_permisos`, `wms_rol_permisos`) y RLS/RPC.
- El navegador nunca es fuente de verdad para permisos ni estados operacionales.

## Fase 01 — Login / sesión

Estado: **preparado, no activado**.

Contrato remoto:

1. Login visual envía correo + contraseña a Supabase Auth.
2. Si Auth valida, el frontend llama `public.wms_sesion_actual()`.
3. El backend comprueba usuario WMS, rol activo, correo sincronizado, vigencia y permisos.
4. El frontend recibe usuario/rol/permisos y los adapta temporalmente al shell legacy.
5. Al recargar, se refresca el token y se vuelve a validar `wms_sesion_actual()`; no se confía sólo en localStorage.
6. Logout invalida también la sesión Auth.
7. Recuperación usa el correo de Supabase Auth.

Archivos involucrados:

- `js/config/supabaseConfig.js`
- `js/services/supabaseService.js`
- `js/services/backendBootstrapService.js`
- `js/controllers/authController.js`
- `index.html`
- `sw.js`

No se modificó el CSS del Login. Se reutilizan las clases y estructura visual existentes.

## Regla para las siguientes secciones

Antes de modificar una vista:

1. Inventariar métodos/controladores/modelos actuales.
2. Identificar datos locales y mutaciones simuladas.
3. Contrastar cada acción con RPC/tabla/vista y permiso real del backend.
4. Detectar botones/selects que ya no correspondan por automatización del backend.
5. Mantener la composición visual salvo que una regla de negocio obligue a retirar/agregar un control.
6. Implementar adaptador remoto detrás de `HABILITADO`.
7. Probar modo local y contrato remoto antes de avanzar a la siguiente sección.

## Orden sugerido

1. Login / sesión.
2. Panel de Control.
3. Stock Planta y Lote Detallado.
4. Mapa / Gruero.
5. Operaciones / Pedidos / Aprobaciones.
6. Andén / Despacho.
7. Inventario.
8. Verificaciones / Bitácora.
9. Reportes / Etiquetas.
10. Usuarios / administración.

La lista puede ajustarse si una dependencia real del frontend exige adelantar una sección.
