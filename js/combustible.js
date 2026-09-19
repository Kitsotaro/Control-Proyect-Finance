// ============================================================
// COMBUSTIBLE.JS — Sub-pestaña "⛽ Combustible" dentro de Costos
// Operativos: catálogo de vehículos (buscador + alta rápida vía modal)
// y el log de cargas de combustible (odómetro, galones, monto pagado).
//
// Diseño ya cerrado en conversación: SIN precio de combustible ni
// comparación teórico-vs-real (demasiado ruido: tráfico, ruta y la carga
// que lleva el vehículo). El "rendimiento" (km recorridos ÷ galones) sale
// SOLO de datos reales, calculado recorriendo el historial de CADA
// vehículo en orden — igual filosofía que el CPP con productos — nunca
// se guarda como columna fija. La primera carga de un vehículo nuevo no
// tiene "anterior" contra qué restar, así que no muestra rendimiento;
// eso es correcto, no un hueco que tapar.
// ============================================================

let vehiculoSeleccionado = null; // objeto de catalogoVehiculos una vez elegido
let combustibleCache = []; // filas crudas de COSTOS_COMBUSTIBLE, más reciente primero

window.addEventListener('DOMContentLoaded', () => {
  const fechaInput = document.getElementById('combustible-fecha');
  if (fechaInput) fechaInput.value = obtenerFechaLocal();
  inicializarBuscadorVehiculo();
});

// ===== BUSCADOR DE VEHÍCULO (Omnibox, mismo patrón que producto en Registrar) =====
function inicializarBuscadorVehiculo() {
  const input = document.getElementById('buscar-vehiculo');
  const dropdown = document.getElementById('dropdown-vehiculos');
  if (!input || !dropdown) return;

  function coincideVehiculo(v, texto) {
    const palabras = texto.toLowerCase().trim().split(/\s+/).filter(Boolean);
    const textoCompleto = [v.placa, v.marca, v.modelo].join(' ').toLowerCase();
    return palabras.every(p => textoCompleto.includes(p));
  }

  function buscar(query) {
    let resultados = query.trim()
      ? catalogoVehiculos.filter(v => v.estado === 'ACTIVO' && coincideVehiculo(v, query)).slice(0, 7)
      : [];
    resultados.push('NUEVO'); // opción permanente, siempre al final
    return resultados;
  }

  function seleccionar(item) {
    if (item === 'NUEVO') {
      vehiculoSeleccionado = null;
      input.value = '';
      abrirModalVehiculo();
      return;
    }

    vehiculoSeleccionado = item;
    input.value = `[${item.placa}] ${item.marca} ${item.modelo}`;
    actualizarHintOdometro(item.placa);
    document.getElementById('btn-save-combustible').disabled = false;
  }

  crearAutocomplete('buscar-vehiculo', 'dropdown-vehiculos', buscar, seleccionar, item => {
    if (item === 'NUEVO') return `<div class="ac-item-main">➕ Agregar vehículo nuevo</div>`;
    return `
      <div class="ac-item-main">${item.marca} ${item.modelo}${item.color ? ' · ' + item.color : ''}</div>
      <div class="ac-item-sub">Placa: ${item.placa} · ${item.tipoCombustible || 'sin tipo definido'}</div>
    `;
  });

  // Si tocan el campo después de haber elegido un vehículo, se limpia la
  // selección — mismo criterio que el buscador de Venta en registro.js.
  input.addEventListener('input', () => {
    if (vehiculoSeleccionado) {
      vehiculoSeleccionado = null;
      document.getElementById('btn-save-combustible').disabled = true;
      document.getElementById('hint-odometro-anterior').textContent = '';
    }
  });
}

// Última lectura de odómetro de ESE vehículo (la carga más reciente NO
// anulada). null = todavía no tiene ninguna carga registrada.
function obtenerUltimoOdometro(placa) {
  const filasDelVehiculo = combustibleCache.filter(({ r }) => r[3] === placa && (r[7] || '') !== 'ANULADO');
  if (filasDelVehiculo.length === 0) return null;
  // combustibleCache ya viene invertido (más reciente primero).
  return parsearNumero(filasDelVehiculo[0].r[4]);
}

function actualizarHintOdometro(placa) {
  const hint = document.getElementById('hint-odometro-anterior');
  const ultimo = obtenerUltimoOdometro(placa);
  hint.textContent = ultimo === null
    ? 'Sin registros previos — esta será la primera carga de este vehículo'
    : `Última lectura registrada: ${ultimo.toLocaleString('es-SV')} km`;
}

// ===== MODAL: VEHÍCULO NUEVO =====
function abrirModalVehiculo() {
  document.getElementById('vehiculo-placa').value = '';
  document.getElementById('vehiculo-marca').value = '';
  document.getElementById('vehiculo-modelo').value = '';
  document.getElementById('vehiculo-color').value = '';
  document.getElementById('vehiculo-tipo-combustible').value = '';
  document.getElementById('modal-vehiculo').classList.remove('hidden');
}

function cerrarModalVehiculo() {
  document.getElementById('modal-vehiculo').classList.add('hidden');
}

async function guardarVehiculoNuevo() {
  const placa = document.getElementById('vehiculo-placa').value.trim();
  const marca = document.getElementById('vehiculo-marca').value.trim();
  const modelo = document.getElementById('vehiculo-modelo').value.trim();
  const color = document.getElementById('vehiculo-color').value.trim();
  const tipoCombustible = document.getElementById('vehiculo-tipo-combustible').value;

  if (!placa || !marca || !modelo || !tipoCombustible) {
    mostrarDialogo({ titulo: 'Faltan datos', mensaje: 'Placa, Marca, Modelo y Tipo de Combustible son obligatorios.' });
    return;
  }

  // Comparación normalizada (mayúsculas/espacios) para no duplicar el
  // mismo vehículo por diferencias de escritura — mismo criterio que
  // generarSKUCompacto() usa para productos.
  const yaExiste = catalogoVehiculos.some(v => normalizarTexto(v.placa) === normalizarTexto(placa));
  if (yaExiste) {
    mostrarDialogo({ titulo: 'Placa ya registrada', mensaje: `Ya existe un vehículo con la placa ${placa}.` });
    return;
  }

  try {
    await gapi.client.sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: 'VEHICULOS!A:F',
      valueInputOption: 'USER_ENTERED',
      resource: { values: [[placa, marca, modelo, color, tipoCombustible, 'ACTIVO']] }
    });

    const nuevoVehiculo = { placa, marca, modelo, color, tipoCombustible, estado: 'ACTIVO' };
    catalogoVehiculos.push(nuevoVehiculo);

    cerrarModalVehiculo();
    document.getElementById('buscar-vehiculo').value = `[${placa}] ${marca} ${modelo}`;
    vehiculoSeleccionado = nuevoVehiculo;
    actualizarHintOdometro(placa);
    document.getElementById('btn-save-combustible').disabled = false;
    document.getElementById('status').innerText = 'Vehículo registrado correctamente.';
  } catch (err) {
    mostrarDialogo({ titulo: 'Error al guardar', mensaje: 'No se pudo guardar el vehículo: ' + err.message });
  }
}

// ===== VALIDACIONES DE INGRESO (Odómetro, Galones, Monto) =====
// Mismo criterio que validarPrecioDistribuidor/validarPrecioConsumidor en
// core.js: solo se toca el valor cuando hay una violación, para no
// interrumpir la escritura normal mientras se teclea.

// Odómetro: entero (sin fracciones de km), máximo 7 dígitos. Permite 0
// (vehículo recién comprado) — la validación de "menor al anterior" en
// guardarCargaCombustible() ya cubre que no se use 0 de forma indebida
// en una carga que NO es la primera de ese vehículo.
function validarOdometro(input) {
  let val = input.value;
  if (val === '') return;

  let cambio = false;
  if (val.includes('.')) {
    val = val.split('.')[0];
    cambio = true;
  }
  if (val.length > 7) {
    val = val.slice(0, 7);
    cambio = true;
  }
  if (cambio) input.value = val;
}

// Galones: máximo 3 dígitos enteros (hasta 999), hasta 5 decimales.
function validarGalones(input) {
  const val = input.value;
  const warn = document.getElementById('warn-galones');
  let [entero, decimales] = val.split('.');
  let cambio = false;

  if (entero && entero.length > 3) {
    entero = entero.slice(0, 3);
    cambio = true;
  }
  if (decimales && decimales.length > 5) {
    decimales = decimales.slice(0, 5);
    cambio = true;
  }

  if (cambio) {
    input.value = decimales !== undefined ? `${entero}.${decimales}` : (entero || '');
  }
  if (warn) warn.classList.toggle('hidden', !cambio);
}

// Monto pagado: máximo 2 decimales. Es una función PROPIA (no se reutiliza
// validarPrecioConsumidor de core.js) porque esa apunta al aviso
// "warn-pcons" del formulario de Registrar — reutilizarla aquí encendería
// por error ese aviso en otra pestaña en vez del de este formulario.
function validarMontoCombustible(input) {
  const val = input.value;
  const warn = document.getElementById('warn-monto-combustible');
  if (val.includes('.')) {
    const decimals = val.split('.')[1];
    if (decimals && decimals.length > 2) {
      if (warn) warn.classList.remove('hidden');
      input.value = parseFloat(val).toFixed(2);
      return;
    }
  }
  if (warn) warn.classList.add('hidden');
}

// ===== FOLIO CORRELATIVO (prefijo CB-, independiente de IN-/FAC-/GO-) =====
async function generarFolioCombustible() {
  try {
    const rows = await leerRango('COSTOS_COMBUSTIBLE!A:A');
    let maxNum = 0;
    rows.forEach(r => {
      if (r[0] && r[0].startsWith('CB-')) {
        const num = parseInt(r[0].replace('CB-', ''));
        if (num > maxNum) maxNum = num;
      }
    });
    const siguiente = String(maxNum + 1).padStart(6, '0');
    document.getElementById('combustible-folio').value = `CB-${siguiente}`;
  } catch (e) {
    document.getElementById('combustible-folio').value = 'CB-000001';
  }
}

// ===== GUARDAR CARGA =====
let guardandoCombustible = false;
async function guardarCargaCombustible(event) {
  event.preventDefault();
  if (guardandoCombustible) return;

  if (!vehiculoSeleccionado) {
    mostrarDialogo({ titulo: 'Falta el vehículo', mensaje: 'Busca un vehículo existente o registra uno nuevo antes de guardar.' });
    return;
  }

  const folio = document.getElementById('combustible-folio').value;
  const fecha = document.getElementById('combustible-fecha').value;
  const odometro = parseFloat(document.getElementById('combustible-odometro').value);
  const galones = parseFloat(document.getElementById('combustible-galones').value);
  const monto = parseFloat(document.getElementById('combustible-monto').value);

  if (isNaN(odometro) || odometro < 0 || isNaN(galones) || galones <= 0 || isNaN(monto) || monto <= 0) {
    mostrarDialogo({ titulo: 'Datos inválidos', mensaje: 'Odómetro no puede ser negativo. Galones y monto deben ser mayores a cero.' });
    return;
  }

  // Aviso preventivo (no bloquea del todo, pero exige confirmar) si el
  // odómetro nuevo es MENOR al último registrado — casi siempre es un
  // error de tipeo, y corrige el vehículo equivocado antes de guardar.
  const ultimoOdometro = obtenerUltimoOdometro(vehiculoSeleccionado.placa);
  if (ultimoOdometro !== null && odometro < ultimoOdometro) {
    mostrarDialogo({
      titulo: 'Odómetro menor al anterior',
      mensaje: `La última lectura registrada de este vehículo fue ${ultimoOdometro.toLocaleString('es-SV')} km. Revisa el valor antes de guardar.`
    });
    return;
  }

  guardandoCombustible = true;
  const btn = document.getElementById('btn-save-combustible');
  btn.disabled = true;
  document.getElementById('status').innerText = 'Guardando carga de combustible...';

  try {
    await gapi.client.sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: 'COSTOS_COMBUSTIBLE!A:H',
      valueInputOption: 'USER_ENTERED',
      resource: {
        values: [[folio, obtenerTimestampLocal(), fecha, vehiculoSeleccionado.placa, odometro, galones, monto, '']]
      }
    });

    document.getElementById('status').innerText = '¡Carga guardada correctamente!';
    document.getElementById('form-combustible').reset();
    document.getElementById('combustible-fecha').value = obtenerFechaLocal();
    vehiculoSeleccionado = null;
    document.getElementById('hint-odometro-anterior').textContent = '';
    btn.disabled = true; // hasta que se elija un vehículo de nuevo
    await generarFolioCombustible();
    await cargarHistorialCombustible();
    await renderizarListaCombustible();
  } catch (err) {
    document.getElementById('status').innerText = 'Error al guardar: ' + err.message;
    btn.disabled = false; // el vehículo sigue seleccionado, puede reintentar
  } finally {
    guardandoCombustible = false;
  }
}

// ===== HISTORIAL + RENDIMIENTO (calculado, NUNCA guardado en Sheets) =====
// Recorre el historial en orden CRONOLÓGICO (más viejo primero) para saber,
// por cada vehículo, cuál era su odómetro anterior en ese punto — misma
// filosofía que calcularCPPPorSKU() en analitica.js: si algún día se anula
// una carga, el resto se recalcula solo, sin números viejos regados por ahí.
function calcularRendimientos(filasEnOrdenCronologico) {
  const ultimoOdometroPorPlaca = {};
  const rendimientoPorFila = {}; // { filaSheet: {kmRecorridos, rendimiento|null} | null }

  filasEnOrdenCronologico.forEach(({ r, filaSheet }) => {
    if ((r[7] || '') === 'ANULADO') return; // anulados no cuentan, nunca pasaron

    const placa = r[3];
    const odometro = parsearNumero(r[4]);
    const galones = parsearNumero(r[5]);
    const anterior = ultimoOdometroPorPlaca[placa];

    if (anterior !== undefined) {
      const kmRecorridos = odometro - anterior;
      rendimientoPorFila[filaSheet] = {
        kmRecorridos,
        rendimiento: galones > 0 ? kmRecorridos / galones : null
      };
    } else {
      rendimientoPorFila[filaSheet] = null; // primera carga de este vehículo
    }

    ultimoOdometroPorPlaca[placa] = odometro;
  });

  return rendimientoPorFila;
}

async function cargarHistorialCombustible() {
  try {
    // Columnas de fecha/hora: 1=TIMESTAMP_LOG, 2=FECHA_MOV.
    const rows = await leerRangoConFechas('COSTOS_COMBUSTIBLE!A2:H', [1, 2]);
    combustibleCache = rows.map((r, idx) => ({ r, filaSheet: idx + 2 }));
    combustibleCache.reverse(); // más reciente primero, para mostrarse
  } catch (err) {
    combustibleCache = [];
    document.getElementById('status').innerText = 'Error al cargar combustible: ' + err.message;
  }
}

function renderizarListaCombustible() {
  const contenedor = document.getElementById('lista-combustible');
  if (!contenedor) return;

  contenedor.innerHTML = '';

  if (combustibleCache.length === 0) {
    contenedor.innerHTML = `<div class="placeholder-busqueda">Todavía no hay cargas de combustible registradas</div>`;
    return;
  }

  // El cálculo necesita orden cronológico real (más viejo primero); se usa
  // una copia — combustibleCache se queda invertido, para mostrarse.
  const rendimientos = calcularRendimientos([...combustibleCache].reverse());

  combustibleCache.forEach(({ r, filaSheet }) => {
    const folio = r[0] || '';
    const fecha = r[2] || '';
    const placa = r[3] || '';
    const odometro = parsearNumero(r[4]);
    const galones = parsearNumero(r[5]);
    const monto = parsearNumero(r[6]);
    const estaAnulado = (r[7] || '') === 'ANULADO';

    const vehiculo = catalogoVehiculos.find(v => v.placa === placa);
    const nombreVehiculo = vehiculo ? `${vehiculo.marca} ${vehiculo.modelo}` : placa;

    const datosRendimiento = rendimientos[filaSheet];
    let lineaRendimiento = '';
    if (!estaAnulado) {
      if (!datosRendimiento) {
        lineaRendimiento = 'Primera carga de este vehículo (sin rendimiento aún)';
      } else if (datosRendimiento.rendimiento === null) {
        lineaRendimiento = `${datosRendimiento.kmRecorridos.toLocaleString('es-SV')} km recorridos`;
      } else {
        lineaRendimiento = `${datosRendimiento.kmRecorridos.toLocaleString('es-SV')} km · ${datosRendimiento.rendimiento.toFixed(1)} km/galón`;
      }
    }

    const div = document.createElement('div');
    div.className = `product-item mov-entrada${estaAnulado ? ' mov-anulada' : ''}`;

    const accionHtml = estaAnulado
      ? `<span class="badge-anulada">ANULADO</span>`
      : `<button type="button" class="btn-secondary-sm" data-accion="anular">🗑️ Anular</button>`;

    // SEGURIDAD: marca/modelo del vehículo son texto libre, pasan por escaparHTML().
    div.innerHTML = `
      <div class="prod-info">
        <span class="prod-title">${escaparHTML(nombreVehiculo)} (${escaparHTML(placa)})</span>
        <span class="prod-sub"><strong>Folio: ${folio} | ${fecha}</strong></span>
        <span class="prod-sub">Odómetro: ${odometro.toLocaleString('es-SV')} km | ${galones} gal</span>
        ${lineaRendimiento ? `<span class="prod-sub">${lineaRendimiento}</span>` : ''}
      </div>
      <div class="mov-acciones">
        <strong>$${monto.toFixed(2)}</strong>
        ${accionHtml}
      </div>
    `;
    contenedor.appendChild(div);

    const btnAnular = div.querySelector('[data-accion="anular"]');
    if (btnAnular) {
      btnAnular.addEventListener('click', () => confirmarAnulacionCombustible({ filaSheet, folio, fecha }));
    }
  });
}

// ===== ANULAR =====
function confirmarAnulacionCombustible({ filaSheet, folio, fecha }) {
  const hoy = obtenerFechaLocal();
  const esHoy = fecha === hoy;

  mostrarDialogo({
    titulo: esHoy ? '¿Anular esta carga?' : '⚠️ Anular carga de otro día',
    mensaje: esHoy
      ? `Se anulará el folio ${folio}. Esta acción no se puede deshacer (pero puedes volver a registrarla si fue un error). El rendimiento del resto del historial de este vehículo se recalcula solo.`
      : `El folio ${folio} es del ${fecha}, no de hoy. Anular cargas de días anteriores afecta el cálculo de rendimiento de las cargas posteriores de ese vehículo. ¿Deseas continuar de todas formas?`,
    textoConfirmar: 'Sí, anular',
    textoCancelar: 'Cancelar',
    onConfirmar: () => ejecutarAnulacionCombustible({ filaSheet, folio })
  });
}

async function ejecutarAnulacionCombustible({ filaSheet, folio }) {
  document.getElementById('status').innerText = `Anulando folio ${folio}...`;
  try {
    await gapi.client.sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `COSTOS_COMBUSTIBLE!H${filaSheet}`,
      valueInputOption: 'USER_ENTERED',
      resource: { values: [['ANULADO']] }
    });
    document.getElementById('status').innerText = `Folio ${folio} anulado correctamente.`;
    await cargarHistorialCombustible();
    renderizarListaCombustible();
  } catch (err) {
    document.getElementById('status').innerText = 'Error al anular: ' + err.message;
    mostrarDialogo({ titulo: 'Error al anular', mensaje: 'No se pudo anular: ' + err.message });
  }
}

// ===== ORQUESTADOR: se llama al abrir la sub-vista Combustible (ver setVistaCostos en costos.js) =====
async function inicializarCombustible() {
  await generarFolioCombustible();
  await cargarHistorialCombustible();
  renderizarListaCombustible();
}
