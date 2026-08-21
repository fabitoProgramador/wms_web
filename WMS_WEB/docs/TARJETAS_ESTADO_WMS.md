# Estándar transversal de tarjetas WMS

Este patrón se aplica a vistas operacionales que representan pallets. La fuente de verdad es Supabase; la tarjeta no reconstruye estados desde datos locales.

## Jerarquía visible

La tarjeta compacta prioriza, en este orden:

1. **Estado WMS efectivo** — dato principal de la cabecera.
2. **Flujo operativo / faceta** — por ejemplo RECHAZO, VERIFICACIÓN, SIN DM, PEDIDO, REPROCESO.
3. **Condición / requisito WMS** — puede coexistir con el estado WMS.
4. Kilos, cajas y fecha relevante.
5. Decisión de Gerencia + modalidad cuando existen.

El estado/calidad SAP no desaparece, pero queda en el detalle expandido como dato del padre.

## Detalle expandido

Cuando el contrato backend lo entrega, el detalle contiene:

- Calidad / estado SAP.
- Estado WMS registrado.
- Estado WMS efectivo.
- Flujo operativo o cola gerencial.
- Condiciones WMS.
- Decisión de Gerencia y modalidad.
- Detector de metales.
- Reserva SAP.
- Almacén SAP.
- Ubicación física WMS cuando la vista/RPC posee esa información.
- Última auditoría: evento, contexto, valor anterior, valor nuevo, usuario, fecha y motivo.

No se consulta `MapaModel`, `StockModel` ni otra fuente local para completar campos que el RPC no entregue.

## Semántica importante

Los 11 estados/facetas operacionales no son necesariamente excluyentes.

Ejemplo válido:

- SAP: `BLOQUEADO`
- Estado WMS: `RECHAZADO`
- Flujo: `RECHAZO`
- Condición: `VERIFICACIÓN`

Asignar VERIFICACIÓN o SIN DM a un pallet RECHAZADO no levanta automáticamente el rechazo. El backend gobierna esa transición.

`AUTORIZADO A ENVIAR` es una decisión gerencial con modalidad `LIBERADO` o `RETAIL`; no se representa como una transición manual del frontend.

## Responsive

- PC / tablet: Estado WMS en cabecera; flujo y condición en una franja horizontal compacta.
- Teléfono: Estado WMS ocupa su propia línea; flujo y condición se apilan; kilos/cajas permanecen compactos; auditoría se muestra en una columna.
- La tarjeta cerrada muestra sólo lo necesario para decidir; la información extensa queda en el panel expandido.

## Vistas alineadas

- Operaciones → Movimientos de Cámara.
- Operaciones → Despacho.
- Operaciones → Gestión de Aprobaciones.
- Stock y Lotes → Stock en Planta → Detalle General.
- Stock y Lotes → Lote Detallado.
- Reportes Operacionales → Generar Reporte.
- Reportes Operacionales → Visualizar Stock.

### Lote Detallado

`wms_lote_detallado` resuelve ID de lote completo o código visual y devuelve una identidad lógica WMS. Conserva por separado:

- las ocurrencias SAP por almacén;
- el saldo total lógico;
- las posiciones físicas WMS;
- Estado WMS registrado y efectivo;
- flujo y condiciones;
- decisión/modalidad de Gerencia;
- última auditoría WMS.

Un mismo `id_lote` con saldo SAP en dos o más almacenes sigue siendo un pallet lógico y no se considera duplicado por ese solo hecho.

### Generar Reporte

Usa exclusivamente:

- `ReportesModel`
- `ReportesController`
- `wms_reportes_catalogos`
- `wms_reportes_compilar`

El navegador no calcula los 11 estados ni filtra una copia local. Supabase devuelve el tipo compilado, totales, snapshot, usuario emisor y vista previa con las mismas capas WMS de las tarjetas operacionales.

### Visualizar Stock

Usa exclusivamente:

- `ReportesStockModel`
- `ReportesStockController`
- `wms_reportes_catalogos`
- `wms_reportes_stock_listar`
- `wms_reportes_stock_exportar`
- `wms_reportes_stock_valores_filtro`

Conserva búsqueda, filtros de almacén/estado, filtros por columna, paginación, copiar fila, copiar todo y Excel, todos ejecutados contra Supabase. El total base es **1.064 registros SAP**, no 1.064 pallets.

Reportes Operacionales ya no necesita `reportesStockBridge.js`; ese archivo fue eliminado al completar ambos submódulos remotos.
