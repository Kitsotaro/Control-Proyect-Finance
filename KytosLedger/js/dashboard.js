// ============================================================
// DASHBOARD.JS — Pestaña "Dashboard": listado de movimientos
// (entradas/salidas) con filtro de fecha, buscador (Omnibox oculto),
// tooltip de detalle, anulación de movimientos y sus métricas.
//
// Orden de la lista: más reciente arriba. Como LOG_TRANS solo AGREGA
// filas al final (nunca inserta en medio), basta con invertir el orden
// de lectura para lograrlo — no hace falta ordenar por fecha/hora.
//
// v2.0: LOG_TRANS ya no tiene columna CANT_EMPAQUE — todos los índices
// r[N] de este archivo a partir de CANTIDAD están un puesto más atrás
// que antes. Ver el mapa de columnas en core.js/inicializarEncabezadosBD.
// ============================================================

let modoDashboard = 'VENTA';

window.addEventListener('DOMContentLoaded', () => {
  const filtroFechaVentas = document.getElementById('filtro-fecha-ventas');
  if (filtroFechaVentas) filtroFechaVentas.value = obtenerFechaLocal();
});

// DASHBOARD: RANGO DE FECHAS
function onToggleRangoFechas() {
  const activo = document.getElementById('chk-rango-fechas').checked;
  document.getElementById('group-fecha-fin').classList.toggle('hidden', !activo);
  document.getElementById('label-fecha-inicio').textContent = activo ? 'Desde' : 'Filtrar por Fecha';
  if (activo && !document.getElementById('filtro-fecha-fin').value) {
    document.getElementById('filtro-fecha-fin').value = obtenerFechaLocal();
  }
  renderizarVentasHoy();
}

function resetearFiltroFechaVentas() {
  const hoy = obtenerFechaLocal();
  document.getElementById('filtro-fecha-ventas').value = hoy;
  if (document.getElementById('chk-rango-fechas').checked) {
    document.getElementById('filtro-fecha-fin').value = hoy;
  }
  renderizarVentasHoy();
}

// DASHBOARD: SLIDE ENTRADAS / SALIDAS
function setModoDashboard(modo) {
  modoDashboard = modo;
  document.getElementById('btn-dash-entradas').classList.toggle('active', modo === 'ENTRADA');
  document.getElementById('btn-dash-salidas').classList.toggle('active', modo === 'VENTA');
  document.getElementById('detalle-titulo').textContent = modo === 'ENTRADA' ? 'Detalle de Entradas' : 'Detalle de Salidas';
  actualizarEtiquetasMetricas();
  renderizarVentasHoy();
}

function actualizarEtiquetasMetricas() {
  const titulo1 = document.getElementById('metric-venta-hoy-titulo');
  const titulo2 = document.getElementById('metric-utilidad-hoy-titulo');
  if (modoDashboard === 'ENTRADA') {
    titulo1.innerHTML = `Total Invertido <span class="info-icon" onclick="toggleInfoTip(this, 'Suma de lo invertido (cantidad × precio distribuidor) en las entradas del período seleccionado. No incluye movimientos anulados.')">ⓘ</span>`;
    titulo2.innerHTML = `Unidades Ingresadas <span class="info-icon" onclick="toggleInfoTip(this, 'Suma de las cantidades registradas en las entradas del período seleccionado. No incluye movimientos anulados.')">ⓘ</span>`;
  } else {
    titulo1.innerHTML = `Ventas Totales <span class="info-icon" onclick="toggleInfoTip(this, 'Suma de los ingresos por ventas (cantidad × precio consumidor) en el período seleccionado. No incluye movimientos anulados.')">ⓘ</span>`;
    titulo2.innerHTML = `Margen/Ganancia <span class="info-icon" onclick="toggleInfoTip(this, 'Suma de la utilidad neta (precio de venta menos costo) generada por las ventas del período seleccionado. No incluye movimientos anulados.')">ⓘ</span>`;
  }
}

// BUSCADOR (OMNIBOX OCULTO) — aparece/desaparece con el botón "🔍 Buscar".
function toggleBuscadorDashboard() {
  const grupo = document.getElementById('grupo-buscar-dashboard');
  grupo.classList.toggle('hidden');
  if (grupo.classList.contains('hidden')) {
    document.getElementById('buscar-dashboard').value = '';
  }
  renderizarVentasHoy();
}

function coincideBusquedaDashboard(r, textoBusqueda) {
  const palabras = textoBusqueda.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (palabras.length === 0) return true;
  const textoCompleto = [r[0], r[4], r[5], r[6], r[7], r[8], r[9]].join(' ').toLowerCase();
  return palabras.every(palabra => textoCompleto.includes(palabra));
}

async function renderizarVentasHoy() {
  const usaRango = document.getElementById('chk-rango-fechas').checked;
  const hoy = obtenerFechaLocal();
  const fechaInicio = document.getElementById('filtro-fecha-ventas').value || hoy;
  const fechaFin = usaRango ? (document.getElementById('filtro-fecha-fin').value || fechaInicio) : fechaInicio;
  const textoBusqueda = (document.getElementById('buscar-dashboard').value || '').toLowerCase().trim();

  try {
    // v2.0: rango hasta columna T (antes U), por la eliminación de CANT_EMPAQUE.
    // Columnas de fecha/hora: 1=TIMESTAMP_LOG, 2=FECHA_MOV.
    const rows = await leerRangoConFechas('LOG_TRANS!A2:T', [1, 2]);

    // Junta las filas que coinciden con los filtros, guardando su número
    // REAL de fila en la hoja (idx+2) antes de cambiar el orden — así el
    // botón Anular siempre apunta a la fila correcta sin importar cómo
    // se muestre después.
    const filasCoincidentes = [];
    rows.forEach((r, idx) => {
      const fechaMov = r[2];
      const tipo = r[3];
      if (tipo !== modoDashboard || fechaMov < fechaInicio || fechaMov > fechaFin) return;
      if (textoBusqueda && !coincideBusquedaDashboard(r, textoBusqueda)) return;
      filasCoincidentes.push({ r, filaSheet: idx + 2 });
    });

    // Más reciente arriba: invertir el orden de lectura basta, porque
    // LOG_TRANS solo agrega filas al final.
    filasCoincidentes.reverse();

    let total1 = 0;
    let total2 = 0;
    const lista = document.getElementById('lista-ventas-hoy');
    lista.innerHTML = '';

    filasCoincidentes.forEach(({ r, filaSheet }) => {
      // Columnas (v2.0, sin CANT_EMPAQUE): 10 CANTIDAD, 12 P_DISTRIBUIDOR,
      // 13 P_CONSUMIDOR, 14 TOTAL_INVERSION, 16 TOTAL_VENTA,
      // 17 UTILIDAD_NETA, 19 ESTADO_MOV.
      const estaAnulada = (r[19] || '') === 'ANULADA';
      const cantidad = Math.abs(parsearNumero(r[10]));
      let valorMostrado;

      // Los movimientos ANULADOS siguen visibles (esto es un Ledger de
      // auditoría), pero ya NO suman a las métricas de arriba.
      if (modoDashboard === 'VENTA') {
        const vta = parsearNumero(r[16]);
        const util = parsearNumero(r[17]);
        if (!estaAnulada) { total1 += vta; total2 += util; }
        valorMostrado = `$${vta.toFixed(2)}`;
      } else {
        const inv = parsearNumero(r[14]);
        const bonif = Math.abs(parsearNumero(r[11]));
        // v2.2: "Unidades Ingresadas" refleja lo que físicamente entró a
        // bodega (cantidad + bonificación), no solo lo que se pagó.
        if (!estaAnulada) { total1 += inv; total2 += cantidad + bonif; }
        valorMostrado = `$${inv.toFixed(2)}`;
      }

      const presentacion = r[7] || '';
      const sku = r[4] || '';
      const variante = r[9] || '';
      const pDist = parsearNumero(r[12]);
      const pCons = parsearNumero(r[13]);
      const horaCaptura = r[1] || ''; // TIMESTAMP_LOG: fecha+hora EXACTA de captura (distinto de Fecha Movimiento)

      const lineasDetalle = [
        `SKU: ${sku}`,
        `Variante: ${variante || '(sin variante)'}`,
        `Capturado: ${horaCaptura || '(sin dato)'}`,
        `Dist: $${pDist.toFixed(5)} · Cons: $${pCons.toFixed(2)}`
      ];
      if (modoDashboard === 'VENTA') {
        const utilidadNeta = parsearNumero(r[17]);
        lineasDetalle.push(`Ganancia: $${utilidadNeta.toFixed(2)}`);
      }
      const detalleTexto = lineasDetalle.join('\n'); // va a .textContent en toggleInfoTip: no necesita escaparHTML

      const div = document.createElement('div');
      div.className = `product-item ${modoDashboard === 'ENTRADA' ? 'mov-entrada' : 'mov-salida'}${estaAnulada ? ' mov-anulada' : ''}`;

      const accionHtml = estaAnulada
        ? `<span class="badge-anulada">ANULADA</span>`
        : `<button type="button" class="btn-secondary-sm" data-accion="anular">🗑️ Anular</button>`;

      // SEGURIDAD: MARCA/LINEA/VOLUMEN/PRESENTACION son texto libre del
      // catálogo (van con innerHTML) — pasan por escaparHTML(). El folio
      // (r[0]) lo genera el propio código, no hace falta escaparlo.
      div.innerHTML = `
        <div class="prod-info">
          <span class="prod-title">${escaparHTML(r[5])} ${escaparHTML(r[6])} ${escaparHTML(r[8])}</span>
          <span class="prod-sub"><strong>Folio: ${r[0]} | ${escaparHTML(presentacion)} | Cant: ${cantidad}</strong> <span class="info-icon">ⓘ</span></span>
        </div>
        <div class="mov-acciones">
          <strong>${valorMostrado}</strong>
          ${accionHtml}
        </div>
      `;
      lista.appendChild(div);

      // Tooltip de detalle: conectado por JS (no onclick inline) para evitar
      // problemas con comillas/caracteres raros en datos de producto.
      const iconoDetalle = div.querySelector('.info-icon');
      if (iconoDetalle) {
        iconoDetalle.addEventListener('click', () => toggleInfoTip(iconoDetalle, detalleTexto));
      }

      // Botón Anular: igual razón, se conecta por JS pasando los datos
      // exactos de ESTA fila (cerrados en el forEach, sin ambigüedad).
      const btnAnular = div.querySelector('[data-accion="anular"]');
      if (btnAnular) {
        btnAnular.addEventListener('click', () => confirmarAnulacion({
          filaSheet, folio: r[0], fechaMov: r[2], sku, cantidadSigno: parsearNumero(r[10]), bonif: parsearNumero(r[11])
        }));
      }
    });

    document.getElementById('metric-venta-hoy').innerText = `$${total1.toFixed(2)}`;
    document.getElementById('metric-utilidad-hoy').innerText = modoDashboard === 'ENTRADA' ? total2.toString() : `$${total2.toFixed(2)}`;
  } catch (err) {
    document.getElementById('status').innerText = 'Error al cargar movimientos: ' + err.message;
  }
}
