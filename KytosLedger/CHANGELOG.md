# Changelog — Kytos Ledger (Finanzas Privadas)

## v2.0

### 🏗️ Arquitectura
- `app.js` monolítico dividido en 11 módulos: `core.js`, `sku.js`, `tema.js`, `registro.js`, `stock.js`, `dashboard.js`, `graficos.js`, `ventas.js`, `analitica.js`, `costos.js`, `combustible.js`.
- `style.css` dividido en `base.css` + `tema-claro.css` + `tema-oscuro.css` — antes el tema oscuro estaba fijo/hardcodeado.
- `sw.js` reescrito: estrategia red-primero-caché-como-respaldo (antes cache-first, solo 2 archivos cacheados) — ya no depende de recordar subir un número de versión para ver cambios reflejados.

### 🐛 Corrección de datos críticos
- **Bug de coma decimal**: el Google Sheet, en configuración regional española, devolvía números con coma ("8,5"); `parseFloat()` los truncaba en toda la app (Bodega, Dashboard, CPP, ROI, Combustible). Corregido centralizando toda lectura en `leerRango()` (pide valores sin formatear) + `parsearNumero()` (interpreta coma o punto).
- **Bug de fechas** (efecto secundario del fix anterior): Sheets entrega las fechas como número de serie al pedir valores sin formatear, rompiendo los filtros de fecha. Corregido con `normalizarFechaCelda()` / `leerRangoConFechas()`, aplicado a `LOG_TRANS`, `COSTOS_OPERATIVOS`, `COSTOS_COMBUSTIBLE` y `CATALOGO`.
- Ambos confirmados matemáticamente contra un Excel de prueba y contra el Sheet real (antes/después).
- **Seguridad XSS**: `escaparHTML()` aplicado a todo texto libre de catálogo/historial (marca, línea, descripción, categoría, etc.) antes de insertarse en el DOM.
- Eliminada la columna `CANT_EMPAQUE` (obsoleta) de `LOG_TRANS`.

### 📦 Stock & Catálogo
- Semáforo de stock con umbrales configurables por tipo de empaque (antes fijo para todos).
- Valorización de Bodega (CPP × stock) por producto.
- Tarjetas "Valor Total" y "Valor Invertido en Bodega" fusionadas en una sola con toggle (antes 2 tarjetas separadas) — números agrandados por ser los datos más consultados.
- Modal de edición de catálogo, con confirmación explícita al cambiar datos sensibles (Marca/Producto/Presentación/Volumen/Variante/Tipo de Empaque) porque regeneran el SKU.

### 📊 Dashboard
- Filtro por rango de fechas (antes solo un día a la vez).
- Buscador (omnibox oculto, activado con botón).
- Tooltip de detalle por movimiento.
- Anulación de movimientos — ledger de auditoría: nunca se borra una fila, solo se marca `ANULADA`.

### 📈 Panorama (pestaña nueva — llamada "Analítica" durante el desarrollo)
- **Costo Promedio Ponderado (CPP)** por SKU, recalculado automáticamente con cada compra.
- **ROI del Negocio** + **ROI y Rotación por Producto**, con selector de período (Semana / Quincena / Mes / Trimestre / Semestre / Año / Personalizado).
- **Proyección de Agotamiento** — días estimados de stock restante según ritmo de venta reciente.
- **Resumen de Combustible** — rendimiento (km/galón) por vehículo.
- **Punto de Equilibrio** — Gastos Fijos del período ÷ Margen de Contribución (%), con comparación contra ventas reales y semáforo de avance.
- Los 3 selectores de período (ROI, Combustible, Equilibrio) comparten una sola lista fuente de presets (`PRESETS_PERIODO`) en vez de opciones repetidas en el HTML.

### 💵 Costos Operativos (pestaña nueva)
- Registro de costos fijos (Mantenimiento vehicular, Alquiler, Seguro, Luz, Agua, Viáticos...) — Categoría es texto libre con autocompletado, no una lista cerrada: se puede escribir una categoría nueva en cualquier momento.
- El botón Guardar cambia a naranja mientras la categoría escrita sea nueva (mismo lenguaje visual que "esto vas a crear/es delicado" del resto de la app).
- Sub-pestaña Combustible: carga por vehículo, odómetro, precio por galón, teórico vs. real.
- Misma filosofía append-only que `LOG_TRANS`: nunca se borra un costo, solo se anula.

### 🎨 Diseño / UI-UX
- Tema Claro añadido (antes solo existía el oscuro).
- Formulario de Entrada reordenado: Buscador + Cantidad, Marca + Producto, Tipo de Empaque + Presentación + Contenido, Variante + Cantidad Bonificada.
- Tab (⇥) corregido en Venta: los campos de solo lectura ya no interceptan la tabulación.
- Nav con scroll horizontal + flechas funcionales: clicleables, desaparecen por completo al llegar a cada extremo (antes eran solo decorativas y la derecha nunca desaparecía del todo).
- Botón de tema reubicado: de un botón de texto en su propia fila, a un ícono fijo al final de la cinta de pestañas.
- Contraste corregido en botones verdes activos (texto blanco + verde más intenso, en vez de texto oscuro casi ilegible).
- Autocompletado propio (reemplaza `<datalist>`, no estilizable) para Marca, Producto, Presentación, Variante, Tipo de Empaque, Categoría de Costo.
- SKU inteligente autogenerado a partir de Marca + Producto + correlativo.
- Corrección de un texto con escape roto (`\u00f3` literal en vez de "ó") en un tooltip.

### 🔒 Robustez
- Bloqueo de doble-envío en formularios (Entrada, Venta, Costos).
- Confirmación explícita antes de anular movimientos de días anteriores al actual (pueden afectar reportes ya revisados).
