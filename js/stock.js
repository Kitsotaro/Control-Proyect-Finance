// ============================================================
// STOCK.JS — Pestaña "Stock & Catálogo": métricas de bodega,
// filtro por tipo de empaque, umbrales de semáforo, listado de
// productos y el modal de edición de catálogo.
// ============================================================

let estadoModalSeleccionado = 'ACTIVO';

// UMBRALES DE SEMÁFORO POR TIPO DE EMPAQUE
async function cargarUmbrales() {
  const rows = await leerRango('UMBRALES!A2:C');
  umbralesPorEmpaque = {};
  rows.forEach(r => {
    if (!r[0]) return;
    // OJO: no se puede usar isNaN(parsearNumero(...)) para detectar "celda
    // vacía" — parsearNumero() nunca devuelve NaN, siempre 0. Por eso se
    // revisa primero si la celda tiene contenido, y solo entonces se
    // parsea; así una celda realmente vacía sigue cayendo al default,
    // igual que antes.
    const tieneMin = r[1] !== undefined && r[1] !== '';
    const tieneMax = r[2] !== undefined && r[2] !== '';
    umbralesPorEmpaque[r[0]] = {
      min: tieneMin ? parsearNumero(r[1]) : DEFAULT_STOCK_MIN,
      max: tieneMax ? parsearNumero(r[2]) : DEFAULT_STOCK_MAX
    };
  });
}

function obtenerUmbral(tipoEmpaque) {
  if (umbralesPorEmpaque[tipoEmpaque]) return umbralesPorEmpaque[tipoEmpaque];
  if (umbralesPorEmpaque['TODOS']) return umbralesPorEmpaque['TODOS'];
  return { min: DEFAULT_STOCK_MIN, max: DEFAULT_STOCK_MAX };
}

async function reescribirHojaUmbrales() {
  const rows = Object.keys(umbralesPorEmpaque).map(tipo => [
    tipo, umbralesPorEmpaque[tipo].min, umbralesPorEmpaque[tipo].max
  ]);
  await gapi.client.sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: 'UMBRALES!A2:C',
    valueInputOption: 'USER_ENTERED',
    resource: { values: rows }
  });
}

function renderizarDashboardStock() {
  // El filtro (y con él, la lista) va PRIMERO — así, si el gráfico llegara a
  // fallar por cualquier motivo, la lista de productos ya quedó dibujada.
  poblarFiltroEmpaque();
  try {
    renderizarGraficoStock();
  } catch (err) {
    console.warn('No se pudo dibujar el gráfico de Stock:', err);
  }
}

// TARJETA FUSIONADA "Valor Total / Invertido en Bodega" — antes eran 2
// tarjetas separadas; ahora es una sola con 2 tabs. Se cachean ambos
// valores cada vez que se recalculan (actualizarMetricasBodega), y el tab
// activo solo decide cuál de los dos YA calculados se pinta — así cambiar
// de tab es instantáneo, sin recorrer catalogoProductos de nuevo.
let vistaValorBodega = 'TOTAL'; // 'TOTAL' | 'INVERTIDO'
let ultimoValorTotalBodega = 0;
let ultimoValorInvertidoBodega = 0;

function cambiarVistaValorBodega(vista) {
  vistaValorBodega = vista;
  document.getElementById('btn-vb-total').classList.toggle('active', vista === 'TOTAL');
  document.getElementById('btn-vb-invertido').classList.toggle('active', vista === 'INVERTIDO');
  renderizarValorBodega();
}

function renderizarValorBodega() {
  const valor = vistaValorBodega === 'TOTAL' ? ultimoValorTotalBodega : ultimoValorInvertidoBodega;
  document.getElementById('metric-valor-bodega').innerText = `$${valor.toFixed(2)}`;
}

// El ⓘ de esta tarjeta es uno solo (no dos) — el texto que muestra depende
// de qué tab esté activo en ese momento.
function mostrarInfoValorBodega(el) {
  const texto = vistaValorBodega === 'TOTAL'
    ? 'Cuánto valen TODAS las unidades que tienes en bodega ahora mismo, SUMANDO también lo que llegó gratis por bonificación. Úsalo para cuadrar contra tu conteo físico real.'
    : 'Cuánto dinero REAL pagaste por lo que sigue en bodega — NO cuenta lo que llegó gratis por bonificación. Te dice cuánto capital tienes metido en inventario.';
  toggleInfoTip(el, texto);
}

// Recalcula "Valor Real Bodega" y "Total en Bodega" a partir de una lista ya
// filtrada (siempre solo ACTIVOS). Se llama desde renderizarListaStock() cada
// vez que cambia el Tipo de Producto o el buscador, para que las métricas de
// arriba siempre coincidan con lo que se está mostrando.
function actualizarMetricasBodega(listaActiva) {
  let valorTotalBodega = 0;
  let valorInvertidoBodega = 0;
  let totalEnBodega = 0;
  listaActiva.forEach(p => {
    // No puede haber más unidades "bonificadas restantes" que stock total:
    // si ya se vendió parte de esa bonificación, lo que queda en bodega es
    // 100% pagado, aunque no sepamos exactamente cuáles unidades se fueron.
    const bonifEnStockActual = Math.min(p.stockBonificado || 0, p.stock);

    valorTotalBodega += p.stock * p.pDist;
    valorInvertidoBodega += (p.stock - bonifEnStockActual) * p.pDist;
    totalEnBodega += p.stock;
  });

  ultimoValorTotalBodega = valorTotalBodega;
  ultimoValorInvertidoBodega = valorInvertidoBodega;
  renderizarValorBodega();

  document.getElementById('metric-total-unidades').innerText = totalEnBodega.toString();
}

// FILTRO DE TIPO DE EMPAQUE + UMBRALES DE SEMÁFORO EN VIVO
function poblarFiltroEmpaque() {
  const select = document.getElementById('filter-tipo-empaque');
  if (!select) return;

  const tiposDistintos = [...new Set(catalogoProductos.map(p => p.tipoEmpaque).filter(Boolean))].sort();
  const valorAnterior = select.value;

  select.innerHTML = '<option value="TODOS">Todo</option>' +
    tiposDistintos.map(t => `<option value="${t}">${t}</option>`).join('');

  const opcionesDisponibles = [...select.options].map(o => o.value);
  if (valorAnterior && opcionesDisponibles.includes(valorAnterior)) {
    select.value = valorAnterior;
  } else {
    select.value = 'TODOS';
  }

  onCambioFiltroEmpaque();
}

function onCambioFiltroEmpaque() {
  const filtro = document.getElementById('filter-tipo-empaque').value;
  const u = obtenerUmbral(filtro);
  document.getElementById('umbral-stock-bajo').value = u.min;
  document.getElementById('umbral-stock-alto').value = u.max;
  renderizarListaStock();
}

async function onCambioUmbral() {
  const filtro = document.getElementById('filter-tipo-empaque').value;
  const min = parseFloat(document.getElementById('umbral-stock-bajo').value);
  const max = parseFloat(document.getElementById('umbral-stock-alto').value);
  umbralesPorEmpaque[filtro] = {
    min: isNaN(min) ? DEFAULT_STOCK_MIN : min,
    max: isNaN(max) ? DEFAULT_STOCK_MAX : max
  };

  renderizarListaStock();
  try {
    await reescribirHojaUmbrales();
  } catch (err) {
    mostrarDialogo({ titulo: 'Error al guardar umbral', mensaje: err.message });
  }
}

function renderizarListaStock() {
  const container = document.getElementById('lista-productos-stock');
  const mostrarObsoletos = document.getElementById('chk-mostrar-obsoletos').checked;
  const filtroEmpaque = document.getElementById('filter-tipo-empaque').value;
  const textoBusqueda = (document.getElementById('buscar-stock').value || '').toLowerCase().trim();
  container.innerHTML = '';

  // Filtros de Tipo de Producto + búsqueda, compartidos entre la lista y las
  // métricas de arriba. "Mostrar Obsoletos" en cambio NO afecta las métricas:
  // esa casilla solo controla qué se ve en la lista, no cuenta como inventario activo.
  const coincideFiltros = p => {
    if (filtroEmpaque !== 'TODOS' && p.tipoEmpaque !== filtroEmpaque) return false;
    if (textoBusqueda && !coincideBusqueda(p, textoBusqueda)) return false;
    return true;
  };

  actualizarMetricasBodega(catalogoProductos.filter(p => p.estado === 'ACTIVO' && coincideFiltros(p)));

  let lista = catalogoProductos.filter(p => (mostrarObsoletos || p.estado === 'ACTIVO') && coincideFiltros(p));

  lista = lista.sort((a, b) => {
    const prioridad = (p) => {
      const u = obtenerUmbral(p.tipoEmpaque);
      return (p.stock <= u.min) ? 1 : (p.stock <= u.max) ? 2 : 3;
    };
    return prioridad(a) - prioridad(b);
  });

  lista.forEach(p => {
    const u = obtenerUmbral(p.tipoEmpaque);
    const semaforoClase = (p.stock <= u.min) ? 'desabastecido' : (p.stock <= u.max) ? 'stock-bajo' : 'stock-optimo';
    const semaforoTexto = (p.stock <= u.min) ? '🔴 Desabastecido' : (p.stock <= u.max) ? '🟡 Stock Bajo' : '🟢 Stock Óptimo';
    const valorBodega = p.stock * p.pDist;

    const div = document.createElement('div');
    div.className = `product-item ${semaforoClase}`;
      div.innerHTML = `
      <div class="prod-info">
        <span class="prod-title">${escaparHTML(p.marca)} ${escaparHTML(p.linea)} ${escaparHTML(p.volumen)} ${escaparHTML(p.variante)}</span>
        <span class="prod-sub">SKU: ${escaparHTML(p.sku)} | Stock: <strong>${p.stock} ${escaparHTML(p.magnitud)}</strong></span>
        <span class="prod-sub">Dist: $${p.pDist.toFixed(5)} | Cons: $${p.pCons.toFixed(2)} | Bod: $${valorBodega.toFixed(2)}</span>
        <span class="prod-badge">${semaforoTexto} (${p.estado})</span>
      </div>
      <div>
        <button class="btn-secondary-sm" onclick="abrirModalEdicion(${p.idProducto})">✏️ Editar</button>
      </div>
    `;
    container.appendChild(div);
  });
}

// MODAL DE EDICIÓN DE PRODUCTO
function abrirModalEdicion(idProducto) {
  const prod = catalogoProductos.find(p => p.idProducto === idProducto);
  if (!prod) return;

  document.getElementById('modal-id-producto').value = prod.idProducto;
  document.getElementById('modal-titulo').innerText = `Editar: ${prod.marca} ${prod.linea}`;
  document.getElementById('modal-marca').value = prod.marca;
  document.getElementById('modal-linea').value = prod.linea;
  document.getElementById('modal-presentacion').value = prod.magnitud;
  document.getElementById('modal-volumen').value = prod.volumen;
  document.getElementById('modal-variante').value = prod.variante || '';
  document.getElementById('modal-tipo-empaque').value = prod.tipoEmpaque || '';
  document.getElementById('modal-p-distributor').value = prod.pDist;
  document.getElementById('modal-p-consumer').value = prod.pCons;

  setEstadoModal(prod.estado);
  document.getElementById('modal-editar').classList.remove('hidden');
}

function setEstadoModal(estado) {
  estadoModalSeleccionado = estado;
  document.getElementById('btn-estado-activo').classList.toggle('active', estado === 'ACTIVO');
  document.getElementById('btn-estado-obsoleto').classList.toggle('active', estado === 'OBSOLETO');
}

function cerrarModal() {
  document.getElementById('modal-editar').classList.add('hidden');
}

async function guardarCambiosModal() {
  const idProducto = parseInt(document.getElementById('modal-id-producto').value);
  const prod = catalogoProductos.find(p => p.idProducto === idProducto);
  if (!prod) return;

  const nuevaMarca = document.getElementById('modal-marca').value.trim();
  const nuevaLinea = document.getElementById('modal-linea').value.trim();
  const nuevaPresentacion = document.getElementById('modal-presentacion').value.trim();
  const nuevoVolumen = document.getElementById('modal-volumen').value.trim();
  const nuevaVariante = document.getElementById('modal-variante').value.trim();
  const nuevoTipoEmpaque = document.getElementById('modal-tipo-empaque').value.trim();
  const newPDist = parseFloat(document.getElementById('modal-p-distributor').value) || 0;
  const newPCons = parseFloat(document.getElementById('modal-p-consumer').value) || 0;

  const cambioIdentidad = (
    nuevaMarca !== prod.marca ||
    nuevaLinea !== prod.linea ||
    nuevaPresentacion !== prod.magnitud ||
    nuevoVolumen !== prod.volumen ||
    nuevaVariante !== (prod.variante || '') ||
    nuevoTipoEmpaque !== (prod.tipoEmpaque || '')
  );

  const ejecutarGuardado = async () => {
    try {
      if (newPDist !== prod.pDist || newPCons !== prod.pCons) {
        await registrarHistoricoPrecio(prod.sku, prod.pDist, newPDist, prod.pCons, newPCons);
      }

      prod.marca = nuevaMarca;
      prod.linea = nuevaLinea;
      prod.magnitud = nuevaPresentacion;
      prod.volumen = nuevoVolumen;
      prod.variante = nuevaVariante;
      prod.tipoEmpaque = nuevoTipoEmpaque;
      prod.pDist = newPDist;
      prod.pCons = newPCons;
      prod.estado = estadoModalSeleccionado;

      // El ID_PRODUCTO nunca cambia (es la llave real); el SKU sí se regenera si cambió la identidad,
      // ya que es solo una etiqueta legible derivada de estos campos. Se excluye a este mismo
      // producto del catálogo al calcularlo, para que no se "auto-compare" contra sus propios
      // datos ya actualizados arriba.
      if (cambioIdentidad) {
        const catalogoSinEsteProducto = catalogoProductos.filter(p => p.idProducto !== prod.idProducto);
        prod.sku = generarSKUCompacto(nuevaMarca, nuevaLinea, nuevaPresentacion, nuevoVolumen, nuevaVariante, catalogoSinEsteProducto);
      }

      await reescribirHojaCatalogo();
      cerrarModal();
      renderizarDashboardStock();
      document.getElementById('status').innerText = 'Cambios guardados exitosamente.';
    } catch (err) {
      mostrarDialogo({ titulo: 'Error al guardar', mensaje: 'No se pudo guardar: ' + err.message });
    }
  };

  if (cambioIdentidad) {
    mostrarDialogo({
      titulo: '⚠️ Dato sensible',
      mensaje: 'Cambiar Marca, Producto, Presentación, Contenido, Variante o Tipo de Empaque actualiza el SKU de este producto. Si el cambio es grande (ej. pasar de Coca-Cola a Pepsi), es mejor crear un ítem nuevo y marcar este como obsoleto. ¿Continuar de todas formas?',
      textoConfirmar: 'Sí, guardar cambios',
      textoCancelar: 'Cancelar',
      onConfirmar: ejecutarGuardado
    });
  } else {
    await ejecutarGuardado();
  }
}
