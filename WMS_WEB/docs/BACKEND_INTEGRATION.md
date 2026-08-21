# Integración WMS_WEB ↔ Supabase

Este documento registra la conexión definitiva del frontend con el backend WMS real.

## Regla principal

Supabase es la **única fuente de verdad** para identidad, roles, permisos y datos operacionales WMS. Los datos locales históricos del navegador ya no deben utilizarse como base de negocio.

`localStorage`/`sessionStorage` sólo pueden usarse para preferencias de interfaz, caché/offline explícita o tokens de sesión; nunca para reemplazar tablas/RPC del backend.

## Fuente de verdad

- SAP: `public."Lotes_en_Stock"`.
- Estado operacional WMS: tablas/RPC WMS de Supabase.
- Identidad: Supabase Auth por **correo + contraseña**.
- Autorización: RBAC WMS (`wms_roles`, `wms_permisos`, `wms_rol_permisos`) y RLS/RPC.
- El navegador nunca decide permisos ni estados operacionales.

## Fase 01 — Login / sesión

Estado: **backend activo**.

Contrato:

1. Login visual envía correo + contraseña a Supabase Auth.
2. Si Auth valida, el frontend llama `public.wms_sesion_actual()`.
3. El backend comprueba usuario WMS, rol activo, correo sincronizado, vigencia y permisos.
4. El frontend recibe usuario/rol/permisos y los adapta al shell actual sin cambiar su diseño.
5. Al recargar, se restaura el token desde `sessionStorage` y se vuelve a validar `wms_sesion_actual()`.
6. No existe fallback a usuarios/contraseñas locales.
7. Logout invalida la sesión Auth y limpia la fachada de usuario en memoria.
8. Recuperación usa el correo de Supabase Auth.

Archivos involucrados:

- `js/config/supabaseConfig.js`
- `js/services/supabaseService.js`
- `js/services/backendBootstrapService.js`
- `js/services/seguridadService.js`
- `js/models/userModel.js`
- `js/controllers/authController.js`
- `index.html`
- `sw.js`

No se modificó el CSS del Login. Se reutilizan las clases y estructura visual existentes.

## Regla para las siguientes secciones

Antes de modificar una vista:

1. Inventariar métodos, controladores y modelos actuales.
2. Identificar datos locales/simulados que deben desaparecer.
3. Contrastar cada lectura y cada acción con RPC, tabla/vista y permiso real del backend.
4. Detectar botones/selects que ya no correspondan por automatización del backend.
5. Mantener la composición visual salvo que una regla de negocio obligue a retirar/agregar un control.
6. Reemplazar la fuente local por el contrato remoto real.
7. Probar el módulo con datos reales antes de avanzar a la siguiente sección.

## Regla durante la transición

Una sección todavía no migrada se considera **legacy pendiente**. Sus datos locales no deben interpretarse como información real del WMS ni utilizarse para validar reglas de negocio.

## Rama de trabajo

Toda la integración se mantiene en una sola rama: `backend-login-foundation`. No se crean ramas por módulo. Esto permite descargar siempre un único ZIP con el estado completo de la integración.

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
