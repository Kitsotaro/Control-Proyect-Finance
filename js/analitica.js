// ============================================================
// ANALITICA.JS — Pestaña "📈 Analítica": Costo Promedio Ponderado (CPP),
// ROI + Rotación + Total Comprado (global y por producto), Proyección
// de Agotamiento, y Combustible (consumo, km y rendimiento por vehículo).
//
// CPP es un valor "de ahora mismo": recorre TODO el historial de cada
// SKU (sin filtro de fecha) para saber cuánto cuesta en promedio cada
// unidad que sigue en bodega. El ROI, la Rotación y el Total Comprado
// SÍ dependen del período elegido (mes/trimestre/semestre/año, o fechas
// a mano) — comparten el mismo selector, no hace falta uno nuevo.
// Combustible usa el mismo patrón de período, pero con su propio
// selector (es una pregunta distinta a la de ROI).
//
// CPP y ROI-por-Producto son BUSCADORES, no listas completas: con
// muchos productos, mostrarlos todos de una vez es más ruido que ayuda.
// Proyección de Agotamiento sigue el mismo patrón. Combustible, en
// cambio, SÍ se muestra completo (lista corta: son vehículos, no SKUs).
//
// v2.0: LOG_TRANS ya no tiene columna CANT_EMPAQUE — todos los índices
// r[N] de este archivo a partir de CANTIDAD están un puesto más atrás
// que antes. Ver el mapa de columnas en core.js/inicializarEncabezadosBD.
// ============================================================

// Caché: se llena UNA vez por consulta a LOG_TRANS (o cambio de período);
// los buscadores solo LEEN de aquí, así escribir en el buscador no
// dispara una consulta nueva a Google Sheets por cada letra.
let filasLogCache = [];
let cppCalculado = {};
let roiGlobalCalculado = 0;
let roiPorProductoCalculado = {};
let mostrarTodosLosDecimalesCPP = false;

const DEFAULT_ROI_MIN = 10; // %: igual o por debajo -> semáforo rojo (crítico)
const DEFAULT_ROI_MAX = 20; // %: igual o por encima -> semáforo verde (meta cumplida)

function obtenerUmbralROI() {
  if (umbralesPorEmpaque['ROI']) return umbralesPorEmpaque['ROI'];
  return { min: DEFAULT_ROI_MIN, max: DEFAULT_ROI_MAX };
}

// Recorta lo escrito a 0-100 (es un %) y guarda el umbral en la MISMA hoja
// UMBRALES que ya usa Stock, con la clave especial 'ROI' — no hace falta
// una hoja nueva ni tocar cargarUmbrales()/reescribirHojaUmbrales(), ya
// son genéricas y aceptan cualquier clave.
async function onCambioUmbralROI() {
  const inputBajo = document.getElementById('umbral-roi-bajo');
  const inputAlto = document.getElementById('umbral-roi-alto');

  const limitar = (valor, porDefecto) => {
    const n = parseFloat(valor);
    if (isNaN(n)) return porDefecto;
    return Math.min(100, Math.max(0, n));
  };

  const min = limitar(inputBajo.value, DEFAULT_ROI_MIN);
  const max = limitar(inputAlto.value, DEFAULT_ROI_MAX);
  inputBajo.value = min;
  inputAlto.value = max;

  umbralesPorEmpaque['ROI'] = { min, max };
  renderizarListaROIProducto();

  try {
    await reescribirHojaUmbrales();
  } catch (err) {
    mostrarDialogo({ titulo: 'Error al guardar umbral', mensaje: err.message });
  }
}

// ===== LISTA ÚNICA DE PRESETS DE PERÍODO =====
// Fuente única para los 3 selectores de período que existen en Analítica
// (ROI, Combustible y Punto de Equilibrio) — cada uno es independiente
// (responde una pregunta distinta, con su propio rango de fechas), pero
// los tres ofrecen las MISMAS opciones. Antes cada <select> traía su
// propia lista de <option> escrita a mano en el HTML: agregar o quitar un
// preset significaba editar 3 puntos distintos y podían desincronizarse.
// Ahora basta con tocar ESTA lista — los 3 selects se rellenan solos desde
// aquí (ver poblarSelectPeriodo) y calcularFechasPreset ya sabe resolver
// cada valor, así que un preset nuevo se agrega en un solo lugar.
const PRESETS_PERIODO = [
  { valor: 'SEMANA', etiqueta: 'Esta Semana' },
  { valor: 'QUINCENA', etiqueta: 'Esta Quincena' },
  { valor: 'MES', etiqueta: 'Este Mes' },
  { valor: 'TRIMESTRE', etiqueta: 'Este Trimestre' },
  { valor: 'SEMESTRE', etiqueta: 'Este Semestre' },
  { valor: 'ANIO', etiqueta: 'Este Año' },
  { valor: 'PERSONALIZADO', etiqueta: 'Personalizado' }
];

function poblarSelectPeriodo(selectId) {
  const select = document.getElementById(selectId);
  if (!select) return;
  select.innerHTML = PRESETS_PERIODO.map(p => `<option value="${p.valor}">${p.etiqueta}</option>`).join('');
}

window.addEventListener('DOMContentLoaded', () => {
  // Rellena los 3 selectores de período desde PRESETS_PERIODO (ver arriba)
  // antes de fijarles un valor por defecto.
  poblarSelectPeriodo('filter-periodo-roi');
  poblarSelectPeriodo('filter-periodo-combustible');
  poblarSelectPeriodo('filter-periodo-equilibrio');

  const fechas = calcularFechasPreset('MES');
  const inicioEl = document.getElementById('roi-fecha-inicio');
  const finEl = document.getElementById('roi-fecha-fin');
  if (inicioEl && finEl) {
    inicioEl.value = fechas.inicio;
    finEl.value = fechas.fin;
  }
  const ventanaEl = document.getElementById('proyeccion-ventana-dias');
  if (ventanaEl) ventanaEl.value = ventanaDiasProyeccion;

  // Combustible usa el mismo preset 'MES' por defecto, pero es un
  // selector INDEPENDIENTE del de ROI (son preguntas distintas).
  const fechasCombustible = calcularFechasPreset('MES');
  const inicioCombEl = document.getElementById('combustible-fecha-inicio');
  const finCombEl = document.getElementById('combustible-fecha-fin');
  if (inicioCombEl && finCombEl) {
    inicioCombEl.value = fechasCombustible.inicio;
    finCombEl.value = fechasCombustible.fin;
  }

  // Punto de Equilibrio: mismo preset 'MES' por defecto, tercer selector
  // INDEPENDIENTE (ni comparte el de ROI ni el de Combustible).
  const fechasEquilibrio = calcularFechasPreset('MES');
  const inicioEquilibrioEl = document.getElementById('equilibrio-fecha-inicio');
  const finEquilibrioEl = document.getElementById('equilibrio-fecha-fin');
  if (inicioEquilibrioEl && finEquilibrioEl) {
    inicioEquilibrioEl.value = fechasEquilibrio.inicio;
    finEquilibrioEl.value = fechasEquilibrio.fin;
  }
});

// ===== PERÍODO PARA ROI, COMBUSTIBLE Y PUNTO DE EQUILIBRIO =====
// new Date(año, mes, día) SIEMPRE usa los valores LOCALES que le pasas
// (a diferencia de parsear texto o de .valueAsDate) — no tiene el
// problema de UTC que ya resolvimos en otros archivos.
function calcularFechasPreset(preset) {
  const ahora = new Date();
  const anio = ahora.getFullYear();
  const mes = ahora.getMonth(); // 0 = enero
  const pad = (n) => String(n).padStart(2, '0');
  const fmt = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;

  if (preset === 'MES') {
    const ultimoDia = new Date(anio, mes + 1, 0).getDate();
    return { inicio: fmt(anio, mes, 1), fin: fmt(anio, mes, ultimoDia) };
  }
  if (preset === 'TRIMESTRE') {
    const mesInicio = Math.floor(mes / 3) * 3;
    const mesFin = mesInicio + 2;
    const ultimoDia = new Date(anio, mesFin + 1, 0).getDate();
    return { inicio: fmt(anio, mesInicio, 1), fin: fmt(anio, mesFin, ultimoDia) };
  }
  if (preset === 'SEMESTRE') {
    const mesInicio = mes < 6 ? 0 : 6;
    const mesFin = mesInicio + 5;
    const ultimoDia = new Date(anio, mesFin + 1, 0).getDate();
    return { inicio: fmt(anio, mesInicio, 1), fin: fmt(anio, mesFin, ultimoDia) };
  }
  if (preset === 'ANIO') {
    return { inicio: fmt(anio, 0, 1), fin: fmt(anio, 11, 31) };
  }
  if (preset === 'SEMANA') {
    // Semana de Lunes a Domingo. new Date() normaliza solo los días que se
    // pasan de mes/año (ej. "31 + 3" en un mes de 30 días cae bien en el
    // día 3 del mes siguiente), así que sumar/restar días sueltos es seguro
    // aunque la semana cruce de un mes o un año a otro.
    const diaSemana = ahora.getDay(); // 0=domingo, 1=lunes, ... 6=sábado
    const offsetLunes = (diaSemana === 0) ? -6 : 1 - diaSemana;
    const lunes = new Date(anio, mes, ahora.getDate() + offsetLunes);
    const domingo = new Date(anio, mes, ahora.getDate() + offsetLunes + 6);
    return {
      inicio: fmt(lunes.getFullYear(), lunes.getMonth(), lunes.getDate()),
      fin: fmt(domingo.getFullYear(), domingo.getMonth(), domingo.getDate())
    };
  }
  if (preset === 'QUINCENA') {
    // Quincena calendario: 1-15, o 16-fin de mes — el criterio más común
    // en El Salvador (ej. pago de planilla), no una ventana móvil de 15 días.
    const dia = ahora.getDate();
    if (dia <= 15) {
      return { inicio: fmt(anio, mes, 1), fin: fmt(anio, mes, 15) };
    }
    const ultimoDia = new Date(anio, mes + 1, 0).getDate();
    return { inicio: fmt(anio, mes, 16), fin: fmt(anio, mes, ultimoDia) };
  }
  return null; // 'PERSONALIZADO': se deja lo que el usuario haya puesto
}

function onCambioPeriodoROI() {
  const preset = document.getElementById('filter-periodo-roi').value;
  const fechas = calcularFechasPreset(preset);
  if (fechas) {
    document.getElementById('roi-fecha-inicio').value = fechas.inicio;
    document.getElementById('roi-fecha-fin').value = fechas.fin;
  }
  recalcularROI();
}

// Si la persona toca las fechas a mano, el preset pasa a "Personalizado"
// para que el select no mienta sobre qué rango se está viendo.
function onCambioFechaPersonalizadaROI() {
  document.getElementById('filter-periodo-roi').value = 'PERSONALIZADO';
  recalcularROI();
}

// ===== CPP: costo promedio ponderado, recorriendo el historial completo =====
// Devuelve { [sku]: { stock, cpp } } con el estado FINAL de cada producto,
// tal como quedaría después de aplicar todos sus movimientos en orden.
function calcularCPPPorSKU(rows) {
  const estado = {};

  rows.forEach(r => {
    if ((r[19] || '') === 'ANULADA') return; // los anulados no cuentan, nunca pasaron

    const sku = r[4];
    const tipo = r[3];
    const cantidad = Math.abs(parsearNumero(r[10]));
    const bonif = Math.abs(parsearNumero(r[11]));
    const pDist = parsearNumero(r[12]);

    if (!estado[sku]) estado[sku] = { stock: 0, cpp: 0 };
    const e = estado[sku];

    if (tipo === 'ENTRADA') {
      // El promedio se "mezcla": lo que ya tenías valorizado a tu CPP anterior,
      // más lo que compraste ahora, entre el nuevo total de unidades.
      // v2.2: la bonificación entra en stockNuevo (unidades físicas) pero
      // NO en valorNuevo (no cuesta nada) — por eso el CPP baja cuando hay
      // bonificación: el mismo dinero se reparte entre más unidades.
      const valorAnterior = e.stock * e.cpp;
      const valorNuevo = cantidad * pDist;
      const stockNuevo = e.stock + cantidad + bonif;
      e.cpp = stockNuevo > 0 ? (valorAnterior + valorNuevo) / stockNuevo : 0;
      e.stock = stockNuevo;
    } else if (tipo === 'VENTA') {
      e.stock -= cantidad; // una venta baja el stock; el CPP no cambia
    }
  });

  return estado;
}

function onCambioDecimalesCPP() {
  mostrarTodosLosDecimalesCPP = document.getElementById('chk-decimales-cpp').checked;
  renderizarListaCPP();
}

// Buscador de CPP: sin texto muestra una invitación a buscar; con texto,
// solo los productos que coinciden (mismo coincideBusqueda() de core.js
// que ya usan Stock, Registrar y Venta).
function renderizarListaCPP() {
  const contenedor = document.getElementById('lista-cpp');
  const textoBusqueda = (document.getElementById('buscar-cpp').value || '').trim();
  contenedor.innerHTML = '';

  if (!textoBusqueda) {
    contenedor.innerHTML = `<div class="placeholder-busqueda">🔍 Escribe el nombre o SKU de un producto para ver su CPP</div>`;
    return;
  }

  const coincidencias = catalogoProductos.filter(p => p.estado === 'ACTIVO' && coincideBusqueda(p, textoBusqueda));

  if (coincidencias.length === 0) {
    contenedor.innerHTML = `<div class="placeholder-busqueda">Sin resultados para "${escaparHTML(textoBusqueda)}"</div>`;
    return;
  }

  const decimales = mostrarTodosLosDecimalesCPP ? 5 : 2;

  coincidencias.forEach(p => {
    const e = cppCalculado[p.sku] || { stock: p.stock, cpp: p.pDist };
    const div = document.createElement('div');
    div.className = 'product-item';
    // SEGURIDAD: marca/línea/volumen/sku son texto libre del catálogo.
    // "En bodega" (Valorización) = CPP × stock actual, SIEMPRE en 2
    // decimales (es un monto total, no un costo unitario) sin importar el
    // checkbox de "Ver 5 decimales" (ese solo aplica al CPP unitario).
    div.innerHTML = `
      <div class="prod-info">
        <span class="prod-title">${escaparHTML(p.marca)} ${escaparHTML(p.linea)} ${escaparHTML(p.volumen)}</span>
        <span class="prod-sub">SKU: ${escaparHTML(p.sku)} | Stock actual: ${e.stock}</span>
      </div>
      <div class="mov-acciones">
        <strong>$${e.cpp.toFixed(decimales)}</strong>
        <span class="valor-bodega-cpp">En bodega: $${(e.cpp * e.stock).toFixed(2)}</span>
      </div>
    `;
    contenedor.appendChild(div);
  });
}

// ===== ROI + ROTACIÓN + TOTAL COMPRADO: por producto, mismo período =====
// Rotación y Total Comprado usan el MISMO período que ROI (conceptualmente
// responden a la misma pregunta: "en este período, cómo se comportó este
// producto") — evita agregar un segundo selector de fechas redundante.
// Total Comprado = unidades físicas que ENTRARON en el período (cantidad
// pagada + bonificación), mismo criterio que "Unidades Ingresadas" del
// Dashboard.
function calcularROI(rows, fechaInicio, fechaFin) {
  let inversionGlobal = 0;
  let gananciaGlobal = 0;
  const porProducto = {};

  rows.forEach(r => {
    if ((r[19] || '') === 'ANULADA') return;

    const fechaMov = r[2];
    if (fechaMov < fechaInicio || fechaMov > fechaFin) return;

    const sku = r[4];
    const tipo = r[3];
    if (!porProducto[sku]) porProducto[sku] = { inversion: 0, ganancia: 0, unidadesVendidas: 0, unidadesCompradas: 0 };

    if (tipo === 'ENTRADA') {
      const inv = parsearNumero(r[14]); // TOTAL_INVERSION
      const cantidad = Math.abs(parsearNumero(r[10]));
      const bonif = Math.abs(parsearNumero(r[11]));
      inversionGlobal += inv;
      porProducto[sku].inversion += inv;
      porProducto[sku].unidadesCompradas += cantidad + bonif; // físico entrado, no solo lo pagado
    } else if (tipo === 'VENTA') {
      const util = parsearNumero(r[17]); // UTILIDAD_NETA
      gananciaGlobal += util;
      porProducto[sku].ganancia += util;
      porProducto[sku].unidadesVendidas += Math.abs(parsearNumero(r[10])); // CANTIDAD
    }
  });

  const roiGlobal = inversionGlobal > 0 ? (gananciaGlobal / inversionGlobal) * 100 : 0;
  return { roiGlobal, porProducto };
}

// Recalcula el ROI (global y por producto) con el período actual de los
// campos de fecha, y refresca lo que esté en pantalla — usa filasLogCache,
// no vuelve a consultar Google Sheets.
function recalcularROI() {
  let fechaInicio = document.getElementById('roi-fecha-inicio').value;
  let fechaFin = document.getElementById('roi-fecha-fin').value;
  if (!fechaInicio || !fechaFin) {
    const fechas = calcularFechasPreset('MES');
    fechaInicio = fechas.inicio;
    fechaFin = fechas.fin;
    document.getElementById('roi-fecha-inicio').value = fechaInicio;
    document.getElementById('roi-fecha-fin').value = fechaFin;
  }

  const resultado = calcularROI(filasLogCache, fechaInicio, fechaFin);
  roiGlobalCalculado = resultado.roiGlobal;
  roiPorProductoCalculado = resultado.porProducto;

  document.getElementById('metric-roi-global').innerText = `${roiGlobalCalculado.toFixed(1)}%`;
  renderizarListaROIProducto();
}

// Buscador de ROI por producto: mismo patrón que el de CPP. Incluye
// Rotación (unidades vendidas en el período ÷ stock actual) — un producto
// puede tener margen excelente y aun así vender tan poco que el dinero
// invertido en él quede "dormido" en bodega; Rotación avisa justo eso,
// algo que el ROI solo no muestra. También incluye Total Comprado, para
// responder "¿cuánto entró de este producto en este período?" sin tener
// que ir a revisar el Dashboard movimiento por movimiento.
function renderizarListaROIProducto() {
  const contenedor = document.getElementById('lista-roi-productos');
  const textoBusqueda = (document.getElementById('buscar-roi-productos').value || '').trim();
  contenedor.innerHTML = '';

  if (!textoBusqueda) {
    contenedor.innerHTML = `<div class="placeholder-busqueda">🔍 Busca un producto para ver su ROI, Rotación y Total Comprado en el período elegido</div>`;
    return;
  }

  const coincidencias = catalogoProductos.filter(p => p.estado === 'ACTIVO' && coincideBusqueda(p, textoBusqueda));

  if (coincidencias.length === 0) {
    contenedor.innerHTML = `<div class="placeholder-busqueda">Sin resultados para "${escaparHTML(textoBusqueda)}"</div>`;
    return;
  }

  const umbral = obtenerUmbralROI();

  coincidencias.forEach(p => {
    const datos = roiPorProductoCalculado[p.sku] || { inversion: 0, ganancia: 0, unidadesVendidas: 0, unidadesCompradas: 0 };
    const roi = datos.inversion > 0 ? (datos.ganancia / datos.inversion) * 100 : 0;
    const claseRoi = (roi <= umbral.min) ? 'roi-critico' : (roi <= umbral.max) ? 'roi-medio' : 'roi-bueno';
    const semaforoTexto = (roi <= umbral.min) ? '🔴 Crítico' : (roi <= umbral.max) ? '🟡 Bajo meta' : '🟢 En meta';
    const rotacion = p.stock > 0 ? (datos.unidadesVendidas / p.stock) : null;
    const rotacionTexto = rotacion === null ? 'Sin stock para comparar' : `Rotación: ${rotacion.toFixed(1)}x (vendiste ${datos.unidadesVendidas} de ${p.stock} en existencia)`;

    const div = document.createElement('div');
    div.className = `product-item ${claseRoi}`;
    // SEGURIDAD: marca/línea/volumen son texto libre del catálogo.
    div.innerHTML = `
      <div class="prod-info">
        <span class="prod-title">${escaparHTML(p.marca)} ${escaparHTML(p.linea)} ${escaparHTML(p.volumen)}</span>
        <span class="prod-sub">Invertido: $${datos.inversion.toFixed(2)} | Ganancia: $${datos.ganancia.toFixed(2)}</span>
        <span class="prod-sub">Comprado en el período: ${datos.unidadesCompradas} unidades</span>
        <span class="prod-sub">${rotacionTexto}</span>
        <span class="prod-badge">${semaforoTexto}</span>
      </div>
      <div>
        <strong>${roi.toFixed(1)}%</strong>
      </div>
    `;
    contenedor.appendChild(div);
  });
}

// ===== PROYECCIÓN DE AGOTAMIENTO =====
// ¿En cuántos días se te acaba cada producto si sigues vendiendo al ritmo
// de los últimos N días? Ritmo diario = ventas de la ventana ÷ N días.
// Días restantes = Stock actual ÷ ritmo diario. La ventana (N) es ajustable
// para que la proyección sea más o menos sensible a cambios recientes.
let ventanaDiasProyeccion = 30;
let proyeccionCalculada = {}; // { [sku]: { ventasVentana, ritmoDiario, diasRestantes } }

const DEFAULT_PROYECCION_MIN = 7;  // días o menos: semáforo rojo (urgente reabastecer)
const DEFAULT_PROYECCION_MAX = 20; // días o más: semáforo verde (cómodo)

function obtenerUmbralProyeccion() {
  if (umbralesPorEmpaque['AGOTAMIENTO']) return umbralesPorEmpaque['AGOTAMIENTO'];
  return { min: DEFAULT_PROYECCION_MIN, max: DEFAULT_PROYECCION_MAX };
}

// Misma hoja UMBRALES, clave especial 'AGOTAMIENTO' — igual patrón que 'ROI'.
async function onCambioUmbralProyeccion() {
  const inputBajo = document.getElementById('umbral-proyeccion-bajo');
  const inputAlto = document.getElementById('umbral-proyeccion-alto');

  const limitar = (valor, porDefecto) => {
    const n = parseFloat(valor);
    if (isNaN(n) || n < 0) return porDefecto;
    return n;
  };

  const min = limitar(inputBajo.value, DEFAULT_PROYECCION_MIN);
  const max = limitar(inputAlto.value, DEFAULT_PROYECCION_MAX);
  inputBajo.value = min;
  inputAlto.value = max;

  umbralesPorEmpaque['AGOTAMIENTO'] = { min, max };
  renderizarListaProyeccion();

  try {
    await reescribirHojaUmbrales();
  } catch (err) {
    mostrarDialogo({ titulo: 'Error al guardar umbral', mensaje: err.message });
  }
}

function onCambioVentanaDias() {
  const val = parseInt(document.getElementById('proyeccion-ventana-dias').value);
  ventanaDiasProyeccion = (!isNaN(val) && val > 0) ? val : 30;
  document.getElementById('proyeccion-ventana-dias').value = ventanaDiasProyeccion;
  recalcularProyeccion();
}

// Resta N días a una fecha 'YYYY-MM-DD' usando valores LOCALES (mismo
// criterio anti-UTC que obtenerFechaLocal()/calcularFechasPreset() en este
// mismo archivo — new Date(y, m, d) arma la fecha con los valores tal cual,
// sin el corrimiento de zona horaria que da parsear texto directamente).
function restarDias(fechaStr, dias) {
  const [y, m, d] = fechaStr.split('-').map(Number);
  const fecha = new Date(y, m - 1, d);
  fecha.setDate(fecha.getDate() - dias);
  const pad = (n) => String(n).padStart(2, '0');
  return `${fecha.getFullYear()}-${pad(fecha.getMonth() + 1)}-${pad(fecha.getDate())}`;
}

function calcularProyeccion(rows, ventanaDias) {
  const hoy = obtenerFechaLocal();
  const fechaInicio = restarDias(hoy, ventanaDias);

  const ventasPorSku = {};
  rows.forEach(r => {
    if ((r[19] || '') === 'ANULADA') return;
    if (r[3] !== 'VENTA') return;
    const fechaMov = r[2];
    if (fechaMov < fechaInicio || fechaMov > hoy) return;
    const sku = r[4];
    const cantidad = Math.abs(parsearNumero(r[10]));
    ventasPorSku[sku] = (ventasPorSku[sku] || 0) + cantidad;
  });

  const resultado = {};
  catalogoProductos.forEach(p => {
    const ventasVentana = ventasPorSku[p.sku] || 0;
    const ritmoDiario = ventasVentana / ventanaDias;
    // null = sin ventas en la ventana; no se puede proyectar una división entre 0.
    const diasRestantes = ritmoDiario > 0 ? (p.stock / ritmoDiario) : null;
    resultado[p.sku] = { ventasVentana, ritmoDiario, diasRestantes };
  });
  return resultado;
}

function recalcularProyeccion() {
  proyeccionCalculada = calcularProyeccion(filasLogCache, ventanaDiasProyeccion);
  renderizarListaProyeccion();
}

// Buscador de Proyección: mismo patrón que CPP y ROI por Producto.
function renderizarListaProyeccion() {
  const contenedor = document.getElementById('lista-proyeccion');
  const textoBusqueda = (document.getElementById('buscar-proyeccion').value || '').trim();
  contenedor.innerHTML = '';

  if (!textoBusqueda) {
    contenedor.innerHTML = `<div class="placeholder-busqueda">🔍 Busca un producto para ver cuántos días de stock le quedan</div>`;
    return;
  }

  const coincidencias = catalogoProductos.filter(p => p.estado === 'ACTIVO' && coincideBusqueda(p, textoBusqueda));

  if (coincidencias.length === 0) {
    contenedor.innerHTML = `<div class="placeholder-busqueda">Sin resultados para "${escaparHTML(textoBusqueda)}"</div>`;
    return;
  }

  const umbral = obtenerUmbralProyeccion();

  coincidencias.forEach(p => {
    const datos = proyeccionCalculada[p.sku] || { ventasVentana: 0, ritmoDiario: 0, diasRestantes: null };
    let claseSemaforo, textoSemaforo, valorMostrado;

    if (datos.diasRestantes === null) {
      claseSemaforo = '';
      textoSemaforo = '⚪ Sin ventas recientes';
      valorMostrado = '—';
    } else {
      const dias = datos.diasRestantes;
      claseSemaforo = (dias <= umbral.min) ? 'proy-critico' : (dias <= umbral.max) ? 'proy-medio' : 'proy-bueno';
      textoSemaforo = (dias <= umbral.min) ? '🔴 Urgente' : (dias <= umbral.max) ? '🟡 Vigilar' : '🟢 Cómodo';
      valorMostrado = `${dias.toFixed(1)} días`;
    }

    const div = document.createElement('div');
    div.className = `product-item ${claseSemaforo}`;
    // SEGURIDAD: marca/línea/volumen son texto libre del catálogo.
    div.innerHTML = `
      <div class="prod-info">
        <span class="prod-title">${escaparHTML(p.marca)} ${escaparHTML(p.linea)} ${escaparHTML(p.volumen)}</span>
        <span class="prod-sub">Stock: ${p.stock} | Vendido en los últimos ${ventanaDiasProyeccion}d: ${datos.ventasVentana}</span>
        <span class="prod-badge">${textoSemaforo}</span>
      </div>
      <div>
        <strong>${valorMostrado}</strong>
      </div>
    `;
    contenedor.appendChild(div);
  });
}

// ===== COMBUSTIBLE: consumo, km recorridos y rendimiento por vehículo =====
// A diferencia de CPP/ROI/Proyección (que son por SKU y usan LOG_TRANS),
// esto agrupa por PLACA y usa COSTOS_COMBUSTIBLE. Reutiliza combustibleCache
// y el criterio de combustible.js (recorrer el historial en orden
// cronológico para saber el odómetro "de antes" de cada vehículo), pero
// acá el objetivo es un TOTAL del período, no el detalle carga por carga.
//
// Días sin carga para el aviso — fijo por ahora; si más adelante se quiere
// ajustable, se puede mover a la hoja UMBRALES con una clave especial,
// igual que 'ROI' y 'AGOTAMIENTO'.
const DIAS_SIN_CARGA_ALERTA = 15;

// LIMITACIÓN CONOCIDA: si un vehículo no tiene ninguna carga registrada
// ANTES del inicio del período, los km recorridos arrancan a contar desde
// su primera carga DENTRO del período (no hay una lectura "de antes" contra
// qué restar) — mismo criterio que ya se usa para la primera carga de un
// vehículo nuevo en combustible.js. No es un hueco a resolver, es el mismo
// límite de siempre: sin dato de antes, no hay antes que calcular.
function calcularResumenCombustible(filasEnOrdenCronologico, fechaInicio, fechaFin) {
  const resumenPorPlaca = {}; // { placa: { galones, gastado, kmInicio, kmFin } }

  filasEnOrdenCronologico.forEach(({ r }) => {
    if ((r[7] || '') === 'ANULADO') return; // anulados no cuentan, nunca pasaron
    const placa = r[3];
    const fecha = r[2];
    if (fecha > fechaFin) return; // fuera del período, por el lado de "después"

    const odometro = parsearNumero(r[4]);
    const galones = parsearNumero(r[5]);
    const monto = parsearNumero(r[6]);

    if (!resumenPorPlaca[placa]) resumenPorPlaca[placa] = { galones: 0, gastado: 0, kmInicio: null, kmFin: null };
    const e = resumenPorPlaca[placa];

    if (fecha < fechaInicio) {
      // Todavía antes del período: se guarda como línea base, y se sigue
      // actualizando hasta cruzar la fecha de inicio (así queda la lectura
      // MÁS RECIENTE de antes, no la primera que se encontró).
      e.kmInicio = odometro;
    } else {
      // Dentro del período (fechaInicio <= fecha <= fechaFin).
      if (e.kmInicio === null) e.kmInicio = odometro; // sin lectura previa — ver nota arriba
      e.kmFin = odometro;
      e.galones += galones;
      e.gastado += monto;
    }
  });

  return resumenPorPlaca;
}

// Días desde la última carga NO anulada de un vehículo hasta hoy — para el
// aviso de "sin carga reciente". SIEMPRE mira hasta hoy, sin importar el
// período elegido arriba: un vehículo puede no tener actividad en el mes
// que estás viendo y aun así haber cargado ayer (no amerita aviso).
function diasSinCargaPorPlaca(placa) {
  const filasVehiculo = combustibleCache.filter(({ r }) => r[3] === placa && (r[7] || '') !== 'ANULADO');
  if (filasVehiculo.length === 0) return null; // nunca ha cargado — no es "atraso", es que nunca empezó

  const ultimaFecha = filasVehiculo[0].r[2]; // combustibleCache viene más reciente primero
  const [y1, m1, d1] = ultimaFecha.split('-').map(Number);
  const [y2, m2, d2] = obtenerFechaLocal().split('-').map(Number);
  return Math.round((new Date(y2, m2 - 1, d2) - new Date(y1, m1 - 1, d1)) / 86400000);
}

function onCambioPeriodoCombustible() {
  const preset = document.getElementById('filter-periodo-combustible').value;
  const fechas = calcularFechasPreset(preset);
  if (fechas) {
    document.getElementById('combustible-fecha-inicio').value = fechas.inicio;
    document.getElementById('combustible-fecha-fin').value = fechas.fin;
  }
  recalcularCombustibleAnalitica();
}

function onCambioFechaPersonalizadaCombustible() {
  document.getElementById('filter-periodo-combustible').value = 'PERSONALIZADO';
  recalcularCombustibleAnalitica();
}

let combustibleAnaliticaCalculado = {};

// Vuelve a leer COSTOS_COMBUSTIBLE (cargarHistorialCombustible, de
// combustible.js) para que el resumen esté siempre fresco, sin importar si
// ya se había visitado Costos Operativos → Combustible antes o no.
async function recalcularCombustibleAnalitica() {
  let fechaInicio = document.getElementById('combustible-fecha-inicio').value;
  let fechaFin = document.getElementById('combustible-fecha-fin').value;
  if (!fechaInicio || !fechaFin) {
    const fechas = calcularFechasPreset('MES');
    fechaInicio = fechas.inicio;
    fechaFin = fechas.fin;
    document.getElementById('combustible-fecha-inicio').value = fechaInicio;
    document.getElementById('combustible-fecha-fin').value = fechaFin;
  }

  try {
    await cargarHistorialCombustible();
    const cronologico = [...combustibleCache].reverse(); // más viejo primero
    combustibleAnaliticaCalculado = calcularResumenCombustible(cronologico, fechaInicio, fechaFin);
    renderizarCombustibleAnalitica();
  } catch (err) {
    document.getElementById('status').innerText = 'Error al calcular combustible: ' + err.message;
  }
}

// Muestra TODOS los vehículos activos (no es un buscador: son pocos, a
// diferencia de los productos) con sus totales del período, más un aviso
// si llevan muchos días sin cargar — ese aviso ignora el período elegido.
function renderizarCombustibleAnalitica() {
  const contenedor = document.getElementById('lista-combustible-analitica');
  if (!contenedor) return;
  contenedor.innerHTML = '';

  const vehiculosActivos = catalogoVehiculos.filter(v => v.estado === 'ACTIVO');
  let totalGalones = 0;
  let totalGastado = 0;

  if (vehiculosActivos.length === 0) {
    contenedor.innerHTML = `<div class="placeholder-busqueda">Todavía no hay vehículos registrados</div>`;
  } else {
    vehiculosActivos.forEach(v => {
      const datos = combustibleAnaliticaCalculado[v.placa] || { galones: 0, gastado: 0, kmInicio: null, kmFin: null };
      totalGalones += datos.galones;
      totalGastado += datos.gastado;

      const kmRecorridos = (datos.kmInicio !== null && datos.kmFin !== null) ? Math.max(0, datos.kmFin - datos.kmInicio) : null;
      const rendimiento = (kmRecorridos && datos.galones > 0) ? kmRecorridos / datos.galones : null;
      const precioPromedio = datos.galones > 0 ? datos.gastado / datos.galones : null;

      const diasSinCarga = diasSinCargaPorPlaca(v.placa);
      const alertaSinCarga = diasSinCarga !== null && diasSinCarga >= DIAS_SIN_CARGA_ALERTA;

      const lineaKm = kmRecorridos === null
        ? 'Sin datos suficientes para calcular km en el período'
        : `${kmRecorridos.toLocaleString('es-SV')} km recorridos`;
      const lineaRendimiento = rendimiento === null ? '' : ` · ${rendimiento.toFixed(1)} km/galón`;
      const lineaPrecio = precioPromedio === null ? '' : ` · $${precioPromedio.toFixed(2)}/galón prom.`;

      const div = document.createElement('div');
      div.className = 'product-item';
      // SEGURIDAD: marca/modelo/placa son texto libre del catálogo de vehículos.
      div.innerHTML = `
        <div class="prod-info">
          <span class="prod-title">${escaparHTML(v.marca)} ${escaparHTML(v.modelo)} (${escaparHTML(v.placa)})</span>
          <span class="prod-sub">${datos.galones.toFixed(2)} galones · $${datos.gastado.toFixed(2)} gastado</span>
          <span class="prod-sub">${lineaKm}${lineaRendimiento}${lineaPrecio}</span>
          ${alertaSinCarga ? `<span class="prod-badge">⚠️ Sin carga hace ${diasSinCarga} días</span>` : ''}
        </div>
      `;
      contenedor.appendChild(div);
    });
  }

  document.getElementById('metric-combustible-galones').innerText = totalGalones.toFixed(2);
  document.getElementById('metric-combustible-gastado').innerText = `$${totalGastado.toFixed(2)}`;
}

// ===== PUNTO DE EQUILIBRIO (negocio completo, no por producto) =====
// Fórmula: Gastos Fijos del período ÷ Margen de Contribución (%) = cuánto
// necesitas VENDER en ese período solo para cubrir tus Costos Operativos —
// ni ganar ni perder. Todo lo que vendas de ahí en adelante ya es ganancia
// real. El Margen de Contribución (Utilidad Neta ÷ Venta Total, en %) usa
// el MISMO período que los Gastos Fijos de esta tarjeta — es información
// relacionada pero es una pregunta distinta a la del ROI de arriba, por
// eso tiene su propio selector en vez de compartir el de ROI.
let gastosOperativosCache = []; // filas crudas de COSTOS_OPERATIVOS — carga propia, independiente de costosCache (costos.js), para no depender de haber visitado esa pestaña antes
let equilibrioCalculado = { gastosFijos: 0, margenContribucion: 0, ventaTotal: 0, puntoEquilibrio: null };

function onCambioPeriodoEquilibrio() {
  const preset = document.getElementById('filter-periodo-equilibrio').value;
  const fechas = calcularFechasPreset(preset);
  if (fechas) {
    document.getElementById('equilibrio-fecha-inicio').value = fechas.inicio;
    document.getElementById('equilibrio-fecha-fin').value = fechas.fin;
  }
  recalcularEquilibrio();
}

function onCambioFechaPersonalizadaEquilibrio() {
  document.getElementById('filter-periodo-equilibrio').value = 'PERSONALIZADO';
  recalcularEquilibrio();
}

// Lectura propia de COSTOS_OPERATIVOS (no reutiliza costosCache de costos.js,
// que además viene invertida para mostrarse y solo se llena al abrir esa
// pestaña) — mismo criterio que Combustible en Analítica, que tampoco
// depende de haber abierto Costos Operativos → Combustible antes.
async function cargarGastosOperativos() {
  try {
    // Columnas de fecha/hora: 1=TIMESTAMP_LOG, 2=FECHA_GASTO.
    gastosOperativosCache = await leerRangoConFechas('COSTOS_OPERATIVOS!A2:G', [1, 2]);
  } catch (err) {
    gastosOperativosCache = [];
    document.getElementById('status').innerText = 'Error al cargar costos operativos: ' + err.message;
  }
}

function calcularPuntoEquilibrio(filasLog, filasGastos, fechaInicio, fechaFin) {
  let gastosFijos = 0;
  filasGastos.forEach(r => {
    if ((r[6] || '') === 'ANULADO') return; // anulados no cuentan, nunca pasaron
    const fecha = r[2];
    if (fecha < fechaInicio || fecha > fechaFin) return;
    gastosFijos += parsearNumero(r[4]); // MONTO
  });

  let ventaTotal = 0;
  let utilidadTotal = 0;
  filasLog.forEach(r => {
    if ((r[19] || '') === 'ANULADA') return;
    if (r[3] !== 'VENTA') return;
    const fechaMov = r[2];
    if (fechaMov < fechaInicio || fechaMov > fechaFin) return;
    ventaTotal += parsearNumero(r[16]); // TOTAL_VENTA
    utilidadTotal += parsearNumero(r[17]); // UTILIDAD_NETA
  });

  const margenContribucion = ventaTotal > 0 ? (utilidadTotal / ventaTotal) * 100 : 0;
  // Sin margen de contribución positivo (nunca vendiste, o vendiste por
  // debajo del costo en TODO el período) no existe un punto de equilibrio
  // alcanzable vendiendo más — cada unidad extra seguiría sin cubrir sus
  // propios gastos fijos. Se devuelve null para mostrarlo aparte, nunca $0.
  const puntoEquilibrio = margenContribucion > 0 ? gastosFijos / (margenContribucion / 100) : null;

  return { gastosFijos, margenContribucion, ventaTotal, puntoEquilibrio };
}

function recalcularEquilibrio() {
  let fechaInicio = document.getElementById('equilibrio-fecha-inicio').value;
  let fechaFin = document.getElementById('equilibrio-fecha-fin').value;
  if (!fechaInicio || !fechaFin) {
    const fechas = calcularFechasPreset('MES');
    fechaInicio = fechas.inicio;
    fechaFin = fechas.fin;
    document.getElementById('equilibrio-fecha-inicio').value = fechaInicio;
    document.getElementById('equilibrio-fecha-fin').value = fechaFin;
  }

  equilibrioCalculado = calcularPuntoEquilibrio(filasLogCache, gastosOperativosCache, fechaInicio, fechaFin);
  renderizarEquilibrio();
}

function renderizarEquilibrio() {
  const { gastosFijos, margenContribucion, ventaTotal, puntoEquilibrio } = equilibrioCalculado;

  document.getElementById('metric-equilibrio-gastos').innerText = `$${gastosFijos.toFixed(2)}`;
  document.getElementById('metric-equilibrio-margen').innerText = `${margenContribucion.toFixed(1)}%`;

  const contenedor = document.getElementById('equilibrio-resultado');

  if (puntoEquilibrio === null) {
    contenedor.innerHTML = `<div class="placeholder-busqueda">Sin margen de contribución positivo en este período — no se puede calcular el punto de equilibrio (revisa si hubo ventas registradas, o si alguna se vendió por debajo del costo)</div>`;
    return;
  }

  // % de avance hacia el punto de equilibrio con lo YA vendido en el
  // período. Tope en 999% solo para que un número extremo no rompa el
  // diseño de la tarjeta — no cambia el semáforo (ya es verde desde 100%).
  const progresoPct = puntoEquilibrio > 0 ? Math.min(999, (ventaTotal / puntoEquilibrio) * 100) : 100;
  const claseSemaforo = progresoPct >= 100 ? 'proy-bueno' : (progresoPct >= 50 ? 'proy-medio' : 'proy-critico');
  const textoSemaforo = progresoPct >= 100 ? '🟢 Punto de equilibrio cubierto' : (progresoPct >= 50 ? '🟡 Vas a mitad de camino' : '🔴 Lejos del punto de equilibrio');

  contenedor.innerHTML = `
    <div class="product-item ${claseSemaforo}">
      <div class="prod-info">
        <span class="prod-title">Necesitas vender $${puntoEquilibrio.toFixed(2)} en este período</span>
        <span class="prod-sub">Llevas vendido: $${ventaTotal.toFixed(2)} (${progresoPct.toFixed(1)}%)</span>
        <span class="prod-badge">${textoSemaforo}</span>
      </div>
    </div>
  `;
}

// ===== ORQUESTADOR: una sola lectura de LOG_TRANS por apertura de pestaña =====
async function renderizarAnalitica() {
  try {
    const umbralInicial = obtenerUmbralROI();
    document.getElementById('umbral-roi-bajo').value = umbralInicial.min;
    document.getElementById('umbral-roi-alto').value = umbralInicial.max;

    const umbralProyeccionInicial = obtenerUmbralProyeccion();
    document.getElementById('umbral-proyeccion-bajo').value = umbralProyeccionInicial.min;
    document.getElementById('umbral-proyeccion-alto').value = umbralProyeccionInicial.max;

    // v2.0: rango hasta columna T (antes U), por la eliminación de CANT_EMPAQUE.
    // Columnas de fecha/hora: 1=TIMESTAMP_LOG, 2=FECHA_MOV.
    filasLogCache = await leerRangoConFechas('LOG_TRANS!A2:T', [1, 2]);

    cppCalculado = calcularCPPPorSKU(filasLogCache);
    renderizarListaCPP();

    recalcularROI();
    recalcularProyeccion();
    await recalcularCombustibleAnalitica();

    await cargarGastosOperativos();
    recalcularEquilibrio();
  } catch (err) {
    document.getElementById('status').innerText = 'Error al calcular analítica: ' + err.message;
  }
}
