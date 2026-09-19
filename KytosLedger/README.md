# Kytos Ledger

PWA de inventario, ventas y costos operativos para pequeños negocios de
distribución. Corre 100% en el navegador (sin servidor propio) y guarda
todos los datos en una hoja de Google Sheets en el propio Google Drive
de quien la usa.

## ✨ Qué hace

- **Registrar** — entradas (compras) y ventas (despacho), con búsqueda
  de producto, SKU inteligente autogenerado, importación desde Excel y
  detección de producto nuevo vs. existente.
- **Stock & Catálogo** — semáforo de inventario configurable por tipo
  de empaque, valorización de bodega, gráfico de distribución
  (pastel/barras) con navegación jerárquica Marca → Línea → Variante.
- **Dashboard** — historial de movimientos con filtro por rango de
  fechas, buscador y anulación (ledger de auditoría: nada se borra,
  solo se marca anulado).
- **Panorama** — Costo Promedio Ponderado, ROI del negocio y por
  producto, Proyección de Agotamiento, resumen de Combustible por
  vehículo, y Punto de Equilibrio.
- **Costos Operativos** — costos fijos (con categorías personalizables)
  y control de combustible por vehículo (odómetro, rendimiento teórico
  vs. real).
- Tema claro/oscuro, PWA instalable con soporte offline (Service
  Worker), diseñado mobile-first.

## 🧱 Stack técnico

JavaScript, HTML y CSS puros — sin frameworks ni bundler. La "base de
datos" es una hoja de Google Sheets, leída y escrita directamente desde
el navegador vía la API de Google (Sheets API + Drive API).

## 🚀 Cómo correrla

1. Cloná el repositorio.
2. Serví la carpeta con cualquier servidor estático (necesita ser
   `http://` o `https://`, no abrir `index.html` directo como archivo —
   el login de Google y el Service Worker no funcionan sobre `file://`).
   En Termux, por ejemplo: `python -m http.server 8000`.
3. Abrí la app y conectá tu cuenta de Google. La primera vez crea
   automáticamente su propia hoja de cálculo (`StockCentral_DB`) en tu
   Drive — no hace falta prepararla a mano.

## ⚙️ Configuración de Google Cloud

Para usar tu propia cuenta necesitás tu propio Client ID de OAuth (el
que trae el repo es el del autor, atado a sus orígenes autorizados):

1. Creá un proyecto en [Google Cloud Console](https://console.cloud.google.com/).
2. Habilitá **Google Sheets API** y **Google Drive API**.
3. Configurá una credencial OAuth 2.0 (tipo "Aplicación web") con tu
   dominio/`localhost` en "Orígenes de JavaScript autorizados".
4. Reemplazá `CLIENT_ID` en `core.js` con el tuyo.

## 📄 Licencia, privacidad y términos

- [`LICENSE`](./LICENSE) — derechos sobre el código.
- [`PRIVACY.md`](./PRIVACY.md) — qué datos toca la app y quién los ve.
- [`TERMS.md`](./TERMS.md) — términos de uso de la aplicación.

## Autor

Wilber Adonay Escobar Solorzano ("Kitsótaro")
