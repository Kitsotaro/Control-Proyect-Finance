// ============================================================
// GRAFICOS.JS — Gráfico de "Distribución de Stock": Pastel y Barras
// comparten la MISMA navegación jerárquica (chartJerarquiaPath) — es
// el mismo GPS, solo cambia cómo se dibuja lo que hay en pantalla.
//
// - PASTEL: como siempre, drill-down al tocar una porción.
// - BARRAS: mismo nivel/datos que el pastel, pero en % del total del
//   nivel actual (así nunca hay una barra "disparada" por mezclar
//   unidades distintas), con eje fijo 0-100%. Además soporta un
//   filtro de cantidad (Todo / 10 items / Top 5) para ver rápido qué
//   está desabastecido y qué sobra sin saturar la vista.
// ============================================================

let stockChartInstance = null;
const NIVELES_JERARQUIA = ['marca', 'linea', 'magnitud', 'volumen', 'variante'];
let chartJerarquiaPath = [];
let tipoGraficoStock = 'PASTEL'; // 'PASTEL' | 'BARRAS'
let filtroCantidadBarras = 'TODO'; // 'TODO' | '10' | 'TOP5'

const COLORES_GRAFICO = ['#22c55e', '#3b82f6', '#eab308', '#ef4444', '#a855f7', '#ec4899', '#14b8a6', '#f97316'];

// Lee el valor ACTUAL de una variable de color del tema (cambia solo con claro/oscuro),
// para que Chart.js (que no entiende var(--...) directamente) siempre pinte con el
// color correcto del tema activo en ese momento.
function colorTema(variable) {
  return getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
}

// ===== TOGGLE PASTEL / BARRAS =====
function alternarTipoGraficoStock() {
  tipoGraficoStock = tipoGraficoStock === 'PASTEL' ? 'BARRAS' : 'PASTEL';
  renderizarGraficoStock();
}

function actualizarBotonTipoGrafico() {
  const btn = document.getElementById('btn-tipo-grafico');
  if (!btn) return;
  // El texto muestra el modo AL QUE CAMBIARÍAS si tocas el botón (mismo patrón que el toggle de tema)
  btn.textContent = tipoGraficoStock === 'PASTEL' ? '📊 Ver en Barras' : '🥧 Ver en Pastel';
}

function onCambioFiltroCantidadBarras() {
  filtroCantidadBarras = document.getElementById('filter-cantidad-barras').value;
  renderizarGraficoStock();
}

// ===== NAVEGACIÓN JERÁRQUICA (compartida por Pastel y Barras) =====
function irANivelBreadcrumb(index) {
  chartJerarquiaPath = chartJerarquiaPath.slice(0, index + 1);
  renderizarGraficoStock();
}

function renderizarBreadcrumb() {
  const cont = document.getElementById('chart-breadcrumb');
  if (chartJerarquiaPath.length === 0) {
    cont.innerHTML = '<span class="breadcrumb-item active">Todas las marcas</span>';
    return;
  }
  let html = `<span class="breadcrumb-item" onclick="irANivelBreadcrumb(-1)">Todas</span>`;
  chartJerarquiaPath.forEach((paso, i) => {
    const esUltimo = i === chartJerarquiaPath.length - 1;
    html += ` <span class="breadcrumb-sep">›</span> <span class="breadcrumb-item ${esUltimo ? 'active' : ''}" onclick="irANivelBreadcrumb(${i})">${escaparHTML(paso.valor)}</span>`;
  });
  cont.innerHTML = html;
}

// Calcula los datos del nivel actual (agrupados por el campo que toca según
// cuán profundo esté el drill-down). Devuelve null si ya no hay más niveles
// para explorar (se llegó al fondo: Marca→Línea→Presentación→Volumen→Variante).
function obtenerDatosNivelActual() {
  const nivelActual = NIVELES_JERARQUIA[chartJerarquiaPath.length];
  if (!nivelActual) {
    chartJerarquiaPath.pop(); // no hay más niveles; deshace el último click
    return null;
  }

  const productosFiltrados = catalogoProductos.filter(p =>
    p.estado === 'ACTIVO' && chartJerarquiaPath.every(paso => p[paso.nivel] === paso.valor)
  );

  const agrupado = {};
  productosFiltrados.forEach(p => {
    const key = p[nivelActual] || '(Sin dato)';
    agrupado[key] = (agrupado[key] || 0) + p.stock;
  });

  return { nivelActual, agrupado };
}

// ===== DISPATCHER PRINCIPAL =====
function renderizarGraficoStock() {
  actualizarBotonTipoGrafico();

  const datos = obtenerDatosNivelActual();
  if (!datos) return; // ya no hay más niveles para explorar

  renderizarBreadcrumb();

   const selectCantidad = document.getElementById('filter-cantidad-barras');
  const iconoInfo = document.getElementById('info-icono-barras');
  if (tipoGraficoStock === 'BARRAS') {
    selectCantidad.classList.remove('hidden');
    iconoInfo.classList.remove('hidden');
    renderizarBarrasNivel(datos);
  } else {
    selectCantidad.classList.add('hidden');
    iconoInfo.classList.add('hidden');
    renderizarPastelNivel(datos);
  }
}

// ===== VISTA PASTEL =====
function renderizarPastelNivel({ nivelActual, agrupado }) {
  const etiquetas = Object.keys(agrupado);
  const ctx = document.getElementById('stockPieChart').getContext('2d');
  if (stockChartInstance) stockChartInstance.destroy();

  stockChartInstance = new Chart(ctx, {
    type: 'pie',
    data: {
      labels: etiquetas,
      datasets: [{
        data: Object.values(agrupado),
        backgroundColor: COLORES_GRAFICO
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { color: colorTema('--text') } } },
      onClick: (evt, elements) => {
        if (elements.length > 0) {
          chartJerarquiaPath.push({ nivel: nivelActual, valor: etiquetas[elements[0].index] });
          renderizarGraficoStock();
        }
      }
    }
  });
}

// ===== VISTA BARRAS =====
// Recorta la lista ya ordenada (de mayor a menor %) según el filtro elegido.
// Si el total de ítems ya es menor o igual al tope, se muestran todos (no
// tiene sentido "recortar" algo que ya es corto).
function filtrarPorCantidad(itemsOrdenados) {
  const total = itemsOrdenados.length;
  if (filtroCantidadBarras === '10') {
    if (total <= 10) return itemsOrdenados;
    return [...itemsOrdenados.slice(0, 5), ...itemsOrdenados.slice(-5)];
  }
  if (filtroCantidadBarras === 'TOP5') {
    if (total <= 5) return itemsOrdenados;
    return [...itemsOrdenados.slice(0, 3), ...itemsOrdenados.slice(-2)];
  }
  return itemsOrdenados; // 'TODO'
}

function renderizarBarrasNivel({ nivelActual, agrupado }) {
  const totalNivel = Object.values(agrupado).reduce((suma, v) => suma + v, 0);

  // % de cada categoría sobre el total del nivel actual — así una Marca
  // chica en unidades pero con % relevante no queda invisible, y una que
  // mezcle empaques distintos no "dispara" la barra sin control.
  let items = Object.keys(agrupado).map(label => ({
    label,
    pct: totalNivel > 0 ? (agrupado[label] / totalNivel) * 100 : 0
  }));

  items.sort((a, b) => b.pct - a.pct);
  items = filtrarPorCantidad(items);

  const ctx = document.getElementById('stockPieChart').getContext('2d');
  if (stockChartInstance) stockChartInstance.destroy();

  stockChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: items.map(i => i.label),
      datasets: [{
        data: items.map(i => i.pct),
        backgroundColor: items.map((i, idx) => COLORES_GRAFICO[idx % COLORES_GRAFICO.length])
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          min: 0,
          max: 100,
          ticks: { color: colorTema('--subtext'), callback: (valor) => valor + '%' },
          grid: { color: colorTema('--card-border') }
        },
        y: {
          ticks: { color: colorTema('--text') },
          grid: { display: false }
        }
      },
      plugins: {
        legend: { display: false }, // cada barra ya trae su propia etiqueta en el eje; una leyenda aparte sobraba y confundía
        tooltip: {
          callbacks: {
            label: (contexto) => `${contexto.parsed.x.toFixed(1)}%`
          }
        }
      },
      onClick: (evt, elements) => {
        if (elements.length > 0) {
          const idx = elements[0].index;
          chartJerarquiaPath.push({ nivel: nivelActual, valor: items[idx].label });
          renderizarGraficoStock();
        }
      }
    }
  });
}
