// ============================================================
// COSTOS.JS — Pestaña "💵 Costos Operativos": registro y listado de
// costos operativos simples (Mantenimiento vehicular, Alquiler de
// bodega/local, Seguro del vehículo, Luz, Agua, Viáticos, y cualquier
// categoría nueva que se escriba — Categoría es texto libre con
// autocompletado, no una lista cerrada). Combustible queda aparte, en su
// propio diseño, por su complejidad extra (odómetro, precio por galón,
// teórico vs. real).
//
// Misma filosofía append-only que LOG_TRANS: un costo nunca se borra ni
// se edita directamente, solo se marca ESTADO = ANULADO y su fila
// original queda intacta como constancia.
// ============================================================

let costosCache = []; // se llena al abrir la pestaña; el render solo LEE de aquí

const CATEGORIAS_COSTO_BASE = ['Mantenimiento vehicular', 'Alquiler de bodega/local', 'Seguro del vehículo', 'Luz', 'Agua', 'Viáticos'];

window.addEventListener('DOMContentLoaded', () => {
  const fechaInput = document.getElementById('costo-fecha');
  if (fechaInput) fechaInput.value = obtenerFechaLocal();

  crearAutocomplete(
    'costo-categoria', 'ac-categoria-costo',
    (query) => sugerirCategoriasCosto(query),
    (categoria) => {
      document.getElementById('costo-categoria').value = categoria;
      actualizarColorGuardarCosto(); // elegir del dropdown no dispara 'input' solo
    },
    (categoria) => escaparHTML(categoria),
    'hint-categoria-costo'
  );

  document.getElementById('costo-categoria').addEventListener('input', actualizarColorGuardarCosto);
});

// Sugerencias de Categoría: las 6 categorías base + cualquier otra que ya
// se haya usado antes (costosCache) — así una categoría nueva que se
// escriba queda disponible como sugerencia la próxima vez sin tocar código.
function sugerirCategoriasCosto(query) {
  const q = query.toLowerCase();
  const yaUsadas = costosCache.map(({ r }) => r[3]).filter(Boolean);
  const todas = [...new Set([...CATEGORIAS_COSTO_BASE, ...yaUsadas])];
  return todas.filter(v => v.toLowerCase().includes(q));
}

// Botón Guardar en naranja mientras la categoría escrita sea NUEVA (no
// coincide con ninguna ya conocida) — mismo lenguaje visual que ya usa el
// resto de la app para "esto vas a crear algo nuevo/delicado" (ej. el
// aviso al cambiar la identidad de un producto en Stock). Reusa la clase
// .btn-nuevo-producto que ya existe (mismo naranja), no crea una nueva.
function actualizarColorGuardarCosto() {
  const categoria = document.getElementById('costo-categoria').value.trim();
  const btn = document.getElementById('btn-save-costo');
  if (!btn) return;
  const esConocida = sugerirCategoriasCosto('').some(c => c.toLowerCase() === categoria.toLowerCase());
  btn.classList.toggle('btn-nuevo-producto', categoria !== '' && !esConocida);
}

// FOLIO CORRELATIVO PROPIO (prefijo GO-, independiente de IN-/FAC- que usa
// Registrar) — mismo patrón que generarFolioCorrelativo() de core.js, pero
// apuntando a COSTOS_OPERATIVOS en vez de LOG_TRANS.
async function generarFolioCosto() {
  try {
    const rows = await leerRango('COSTOS_OPERATIVOS!A:A');
    let maxNum = 0;
    rows.forEach(r => {
      if (r[0] && r[0].startsWith('GO-')) {
        const num = parseInt(r[0].replace('GO-', ''));
        if (num > maxNum) maxNum = num;
      }
    });
    const siguiente = String(maxNum + 1).padStart(6, '0');
    document.getElementById('costo-folio').value = `GO-${siguiente}`;
  } catch (e) {
    document.getElementById('costo-folio').value = 'GO-000001';
  }
}

// GUARDAR: valida categoría elegida y monto > 0. Seguro anti doble-envío
// igual que guardarMovimiento() en registro.js.
let guardandoCosto = false;
async function guardarCostoOperativo(event) {
  event.preventDefault();
  if (guardandoCosto) return;

  const folio = document.getElementById('costo-folio').value;
  const fecha = document.getElementById('costo-fecha').value;
  const categoria = document.getElementById('costo-categoria').value.trim();
  const monto = parseFloat(document.getElementById('costo-monto').value);
  const descripcion = document.getElementById('costo-descripcion').value.trim();

  if (!categoria) {
    mostrarDialogo({ titulo: 'Falta la categoría', mensaje: 'Selecciona una categoría antes de guardar.' });
    return;
  }
  if (isNaN(monto) || monto <= 0) {
    mostrarDialogo({ titulo: 'Monto inválido', mensaje: 'El monto debe ser mayor a cero.' });
    return;
  }

  guardandoCosto = true;
  const btn = document.getElementById('btn-save-costo');
  btn.disabled = true;
  document.getElementById('status').innerText = 'Guardando costo...';

  try {
    await gapi.client.sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: 'COSTOS_OPERATIVOS!A:G',
      valueInputOption: 'USER_ENTERED',
      resource: {
        values: [[folio, obtenerTimestampLocal(), fecha, categoria, monto, descripcion, '']]
      }
    });

    document.getElementById('status').innerText = '¡Costo guardado correctamente!';
    document.getElementById('form-costos').reset();
    document.getElementById('costo-fecha').value = obtenerFechaLocal();
    actualizarColorGuardarCosto();
    await generarFolioCosto();
    await renderizarListaCostos();
  } catch (err) {
    document.getElementById('status').innerText = 'Error al guardar: ' + err.message;
  } finally {
    guardandoCosto = false;
    btn.disabled = false;
  }
}

// LISTADO: más reciente arriba (la hoja solo AGREGA filas al final, igual
// que LOG_TRANS, así que basta con invertir el orden de lectura).
async function renderizarListaCostos() {
  const contenedor = document.getElementById('lista-costos');
  if (!contenedor) return;

  try {
    // Columnas de fecha/hora: 1=TIMESTAMP_LOG, 2=FECHA_GASTO.
    const rows = await leerRangoConFechas('COSTOS_OPERATIVOS!A2:G', [1, 2]);
    costosCache = rows.map((r, idx) => ({ r, filaSheet: idx + 2 }));
    costosCache.reverse();

    contenedor.innerHTML = '';

    if (costosCache.length === 0) {
      contenedor.innerHTML = `<div class="placeholder-busqueda">Todavía no hay costos registrados</div>`;
      return;
    }

    costosCache.forEach(({ r, filaSheet }) => {
      const folio = r[0] || '';
      const fecha = r[2] || '';
      const categoria = r[3] || '';
      const monto = parsearNumero(r[4]);
      const descripcion = r[5] || '';
      const estaAnulado = (r[6] || '') === 'ANULADO';

      const div = document.createElement('div');
      div.className = `product-item mov-entrada${estaAnulado ? ' mov-anulada' : ''}`;

      const accionHtml = estaAnulado
        ? `<span class="badge-anulada">ANULADO</span>`
        : `<button type="button" class="btn-secondary-sm" data-accion="anular">🗑️ Anular</button>`;

      // SEGURIDAD: categoría y descripción pasan por escaparHTML() antes
      // de ir dentro de innerHTML (la descripción la escribe la persona).
      div.innerHTML = `
        <div class="prod-info">
          <span class="prod-title">${escaparHTML(categoria)}</span>
          <span class="prod-sub"><strong>Folio: ${folio} | ${fecha}</strong></span>
          <span class="prod-sub">${escaparHTML(descripcion) || '(sin descripción)'}</span>
        </div>
        <div class="mov-acciones">
          <strong>$${monto.toFixed(2)}</strong>
          ${accionHtml}
        </div>
      `;
      contenedor.appendChild(div);

      const btnAnular = div.querySelector('[data-accion="anular"]');
      if (btnAnular) {
        btnAnular.addEventListener('click', () => confirmarAnulacionCosto({ filaSheet, folio, fecha }));
      }
    });
  } catch (err) {
    contenedor.innerHTML = '';
    document.getElementById('status').innerText = 'Error al cargar costos: ' + err.message;
  }
}

// ANULAR: mismo criterio de "hoy vs. otro día" que ventas.js, pero sin
// tocar stock (los costos operativos no afectan inventario).
function confirmarAnulacionCosto({ filaSheet, folio, fecha }) {
  const hoy = obtenerFechaLocal();
  const esHoy = fecha === hoy;

  mostrarDialogo({
    titulo: esHoy ? '¿Anular este costo?' : '⚠️ Anular costo de otro día',
    mensaje: esHoy
      ? `Se anulará el folio ${folio}. Esta acción no se puede deshacer (pero puedes volver a registrarlo si fue un error).`
      : `El folio ${folio} es del ${fecha}, no de hoy. Anular costos de días anteriores puede afectar reportes ya revisados para esa fecha. ¿Deseas continuar de todas formas?`,
    textoConfirmar: 'Sí, anular',
    textoCancelar: 'Cancelar',
    onConfirmar: () => ejecutarAnulacionCosto({ filaSheet, folio })
  });
}

async function ejecutarAnulacionCosto({ filaSheet, folio }) {
  document.getElementById('status').innerText = `Anulando folio ${folio}...`;
  try {
    await gapi.client.sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `COSTOS_OPERATIVOS!G${filaSheet}`,
      valueInputOption: 'USER_ENTERED',
      resource: { values: [['ANULADO']] }
    });
    document.getElementById('status').innerText = `Folio ${folio} anulado correctamente.`;
    await renderizarListaCostos();
  } catch (err) {
    document.getElementById('status').innerText = 'Error al anular: ' + err.message;
    mostrarDialogo({ titulo: 'Error al anular', mensaje: 'No se pudo anular: ' + err.message });
  }
}

// ORQUESTADOR: se llama al abrir la pestaña (ver switchTab en core.js) —
// genera el folio siguiente y carga el historial.
async function inicializarCostos() {
  await generarFolioCosto();
  await renderizarListaCostos();
}

// ===== SUB-NAVEGACIÓN: COSTOS FIJOS vs. COMBUSTIBLE =====
// Misma pestaña "💵 Costos Operativos", dos vistas alternables (igual
// patrón que Entrada/Venta en Registrar) — evita agregar una pestaña
// nueva al nav solo para Combustible.
function setVistaCostos(vista) {
  document.getElementById('btn-costos-fijos').classList.toggle('active', vista === 'FIJOS');
  document.getElementById('btn-costos-combustible').classList.toggle('active', vista === 'COMBUSTIBLE');
  document.getElementById('vista-costos-fijos').classList.toggle('hidden', vista !== 'FIJOS');
  document.getElementById('vista-combustible').classList.toggle('hidden', vista !== 'COMBUSTIBLE');

  if (vista === 'COMBUSTIBLE' && typeof inicializarCombustible === 'function') {
    inicializarCombustible();
  }
}
