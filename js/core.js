// ============================================================
// CORE.JS — Configuración global, autenticación con Google, estado
// compartido entre módulos, utilidades genéricas (diálogos, tooltips,
// autocompletado, validación de precios), lectura/escritura base
// en Google Sheets (catálogo, folio, ID de producto) y verificación/
// creación de hojas nuevas en bases de datos ya existentes.
//
// Este archivo se carga PRIMERO: los demás módulos usan sus variables
// y funciones.
// ============================================================

// CONFIGURACIÓN CENTRAL
const CLIENT_ID = '1070607567316-mdbd97lbkprgpc4spj71e5f8anovr6it.apps.googleusercontent.com';
const SCOPES = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/spreadsheets';
const DB_FILE_NAME = 'StockCentral_DB';

// CONTROL DE ACCESO: quién puede usar la app además de vos.
//
// Verifica el correo contra una hoja de Google Sheets PRIVADA (tuya, no
// publicada) a través de un Apps Script propio — el script corre con TUS
// permisos y solo devuelve un sí/no por correo consultado, nunca la lista
// completa. Así la hoja de licencias nunca queda expuesta, ni siquiera
// como CSV público (que sí expondría los correos a cualquiera con el link).
//
// Reemplazá esto por la URL que te da Apps Script al publicar el
// despliegue (ver instrucciones aparte) — termina en /exec.
const URL_VERIFICACION_ACCESO = 'https://script.google.com/macros/s/TU_ID_DE_DESPLIEGUE/exec';

const DEFAULT_STOCK_MIN = 4;
const DEFAULT_STOCK_MAX = 6;

// Encabezados de hojas agregadas después del lanzamiento original — un solo
// lugar para no repetir la lista entre la creación de una BD nueva
// (inicializarEncabezadosBD) y el "parche" para BDs que ya existían antes
// de que esa hoja existiera (ver asegurarHojaExiste()).
const ENCABEZADOS_COSTOS_OPERATIVOS = ['ID_GASTO', 'TIMESTAMP_LOG', 'FECHA_GASTO', 'CATEGORIA', 'MONTO', 'DESCRIPCION', 'ESTADO'];
const ENCABEZADOS_VEHICULOS = ['PLACA', 'MARCA', 'MODELO', 'COLOR', 'TIPO_COMBUSTIBLE', 'ESTADO'];
const ENCABEZADOS_COSTOS_COMBUSTIBLE = ['ID_GASTO', 'TIMESTAMP_LOG', 'FECHA_MOV', 'PLACA', 'ODOMETRO', 'GALONES', 'MONTO_PAGADO', 'ESTADO'];

let SPREADSHEET_ID = '';
let tokenClient;
let gapiInited = false;
let gsisInited = false;

// ESTADO GLOBAL COMPARTIDO ENTRE MÓDULOS
// (tipoMovimiento vive aquí porque tanto registro.js como el folio de
// este archivo lo necesitan)
let tipoMovimiento = 'ENTRADA';
let catalogoProductos = [];
let catalogoVehiculos = [];
let umbralesPorEmpaque = {};

// NUEVO: activa el Service Worker (sw.js). El archivo ya existía pero
// nunca se registraba, así que la app nunca funcionaba offline ni era
// instalable de verdad.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(err => {
      console.warn('No se pudo registrar el Service Worker:', err);
    });
  });
}

function gapiLoaded() {
  gapi.load('client', async () => {
    await gapi.client.init({
      discoveryDocs: [
        'https://sheets.googleapis.com/$discovery/rest?version=v4',
        'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest'
      ]
    });
    gapiInited = true;
    checkAuthReady();
  });
}

function gisLoaded() {
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPES,
    callback: '',
  });
  gsisInited = true;
  checkAuthReady();
}

window.onload = () => { gapiLoaded(); gisLoaded(); };

function checkAuthReady() {
  if (gapiInited && gsisInited) {
    document.getElementById('status').innerText = 'Listo para conectar.';
  }
}

// Correo de la cuenta ya conectada — about.get funciona con el scope
// drive.file que ya usa la app (no hace falta pedir un scope nuevo solo
// para saber quién sos).
async function obtenerCorreoUsuario() {
  try {
    const res = await gapi.client.drive.about.get({ fields: 'user' });
    return (res.result.user && res.result.user.emailAddress)
      ? res.result.user.emailAddress.toLowerCase().trim()
      : '';
  } catch (err) {
    return '';
  }
}

// Consulta el Apps Script (ver URL_VERIFICACION_ACCESO) para saber si
// este correo está autorizado. Ante cualquier falla de conexión, niega el
// acceso por defecto (fail-closed) — para un control de acceso, es más
// seguro trabarse por un problema de red que dejar pasar a alguien por
// error. Si preferís lo contrario (dejar pasar cuando el chequeo falla),
// cambiá el "return false" del catch por "return true".
async function verificarAccesoUsuario(email) {
  if (!email) return false;
  try {
    const resp = await fetch(`${URL_VERIFICACION_ACCESO}?email=${encodeURIComponent(email)}`);
    const data = await resp.json();
    return data.autorizado === true;
  } catch (err) {
    console.warn('No se pudo verificar el acceso:', err);
    return false;
  }
}

function handleAuthClick() {
  tokenClient.callback = async (resp) => {
    if (resp.error) throw (resp);

    document.getElementById('status').innerText = 'Verificando acceso...';
    const email = await obtenerCorreoUsuario();
    const autorizado = await verificarAccesoUsuario(email);

    if (!autorizado) {
      mostrarDialogo({
        titulo: 'Acceso no autorizado',
        mensaje: `La cuenta ${email || 'conectada'} no tiene acceso habilitado a esta aplicación. Si creés que esto es un error, contactá al administrador.`
      });
      gapi.client.setToken(null); // limpia el token de esta sesión — no queda "medio conectado"
      document.getElementById('status').innerText = 'Listo para conectar.';
      return;
    }

    document.getElementById('auth-section').classList.add('hidden');
    document.getElementById('main-app').classList.remove('hidden');
    // El cálculo inicial de las flechas (en inicializarNavPestanas, al cargar
    // la página) ocurre con el nav todavía oculto detrás de auth-section —
    // en ese momento su ancho es 0, así que el cálculo sale mal y se queda
    // "pegado" así el resto de la sesión. Se repite aquí, apenas el nav
    // pasa a visible, para que arranque con el estado correcto.
    actualizarFlechasNav();
    document.getElementById('status').innerText = 'Verificando base de datos en Google Drive...';
    await cargarDatosIniciales();
  };

  if (gapi.client.getToken() === null) {
    tokenClient.requestAccessToken({prompt: 'consent'});
  } else {
    tokenClient.requestAccessToken({prompt: ''});
  }
}

// NAVEGACIÓN ENTRE PESTAÑAS
function switchTab(tabId, event) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));

  document.getElementById(tabId).classList.add('active');
  if (event && event.currentTarget) {
    event.currentTarget.classList.add('active');
  }

  if (tabId === 'tab-stock') {
    renderizarDashboardStock();
  } else if (tabId === 'tab-ventas') {
    renderizarVentasHoy();
  } else if (tabId === 'tab-analitica') {
    renderizarAnalitica();
  } else if (tabId === 'tab-costos') {
    inicializarCostos();
  }
}

// DIÁLOGO PERSONALIZADO (reemplaza alert()/confirm() nativos del navegador)
function mostrarDialogo({ titulo = 'Aviso', mensaje = '', textoConfirmar = 'Entendido', textoCancelar = null, onConfirmar = null, onCancelar = null }) {
  document.getElementById('dialogo-titulo').textContent = titulo;
  document.getElementById('dialogo-mensaje').textContent = mensaje;

  const btnConfirmar = document.getElementById('dialogo-btn-confirmar');
  const btnCancelar = document.getElementById('dialogo-btn-cancelar');

  btnConfirmar.textContent = textoConfirmar;
  btnConfirmar.onclick = () => {
    cerrarDialogo();
    if (onConfirmar) onConfirmar();
  };

  if (textoCancelar) {
    btnCancelar.textContent = textoCancelar;
    btnCancelar.classList.remove('hidden');
    btnCancelar.onclick = () => {
      cerrarDialogo();
      if (onCancelar) onCancelar();
    };
  } else {
    btnCancelar.classList.add('hidden');
  }

  document.getElementById('dialogo-personalizado').classList.remove('hidden');

  // SEGURIDAD: mueve el foco del teclado al diálogo. Sin esto, un Enter
  // presionado mientras escribías en el formulario de atrás terminaba
  // ENVIANDO ese formulario en vez de cerrar este aviso — así se coló el
  // bug de "Stock insuficiente". Con Cancelar presente, el foco por
  // defecto va ahí (más seguro para acciones delicadas: anular, importar,
  // cambiar SKU). Con una sola opción, va a Confirmar.
  if (textoCancelar) {
    btnCancelar.focus();
  } else {
    btnConfirmar.focus();
  }
}

function cerrarDialogo() {
  document.getElementById('dialogo-personalizado').classList.add('hidden');
}

// TOOLTIPS INFORMATIVOS (ⓘ) — funcionan con tap (móvil) y hover (desktop)
function toggleInfoTip(el, texto) {
  const existente = el.querySelector('.info-tip');
  cerrarTodosLosInfoTips();
  if (existente) return; // si ya estaba abierto, el cierre de arriba basta (toggle)

  const tip = document.createElement('div');
  tip.className = 'info-tip';
  tip.textContent = texto;
  el.appendChild(tip);

  // Si no cabe arriba (cerca del borde superior de la pantalla), se
  // muestra abajo. Si se corta por la izquierda o la derecha, se desplaza
  // horizontalmente lo justo para que quede completo y legible.
  const margen = 8;
  const rectTip = tip.getBoundingClientRect();

  if (rectTip.top < margen) {
    tip.classList.add('info-tip-abajo');
  }

  if (rectTip.left < margen) {
    tip.style.transform = `translateX(calc(-50% + ${margen - rectTip.left}px))`;
  } else if (rectTip.right > window.innerWidth - margen) {
    tip.style.transform = `translateX(calc(-50% - ${(rectTip.right - (window.innerWidth - margen)).toFixed(0)}px))`;
  }

  setTimeout(() => {
    document.addEventListener('click', function cerrarAlTocarFuera(e) {
      if (!el.contains(e.target)) {
        cerrarTodosLosInfoTips();
        document.removeEventListener('click', cerrarAlTocarFuera);
      }
    });
  }, 0);
}

function cerrarTodosLosInfoTips() {
  document.querySelectorAll('.info-tip').forEach(t => t.remove());
}

// ===== AUTOCOMPLETADO PROPIO (usado por Registrar, Venta y a futuro Stock/SKU) =====
function crearAutocomplete(inputId, dropdownId, getOpciones, onSeleccionar, renderItem, hintId) {
  const input = document.getElementById(inputId);
  const dropdown = document.getElementById(dropdownId);
  const hint = hintId ? document.getElementById(hintId) : null;
  if (!input || !dropdown) return;

  let opcionesActuales = [];
  let indiceResaltado = -1;

  function marcarResaltado() {
    Array.from(dropdown.children).forEach((el, i) => {
      const activo = i === indiceResaltado;
      el.classList.toggle('highlighted', activo);
      if (activo) el.scrollIntoView({ block: 'nearest' });
    });
  }

  function seleccionar(opt) {
    onSeleccionar(opt);
    dropdown.classList.add('hidden');
    if (hint) hint.classList.add('hidden');
  }

  function actualizarHint(query) {
    if (!hint) return;
    const q = query.trim().toLowerCase();
    if (!q) { hint.classList.add('hidden'); return; }
    const todasLasOpciones = getOpciones('');
    const existeExacto = todasLasOpciones.some(v => typeof v === 'string' && v.toLowerCase() === q);
    hint.classList.toggle('hidden', existeExacto);
  }

  function render(query) {
    opcionesActuales = getOpciones(query.trim());
    indiceResaltado = opcionesActuales.length > 0 ? 0 : -1;
    dropdown.innerHTML = '';

    if (!query.trim() || opcionesActuales.length === 0) {
      dropdown.classList.add('hidden');
    } else {
      opcionesActuales.slice(0, 8).forEach((opt, i) => {
        const item = document.createElement('div');
        item.className = 'autocomplete-item' + (i === 0 ? ' highlighted' : '');
        item.innerHTML = renderItem(opt);
        item.addEventListener('mousedown', (e) => {
          e.preventDefault();
          seleccionar(opt);
        });
        dropdown.appendChild(item);
      });
      dropdown.classList.remove('hidden');
    }
    actualizarHint(query);
  }

  input.addEventListener('input', () => render(input.value));
  input.addEventListener('focus', () => { if (input.value.trim()) render(input.value); });
  input.addEventListener('blur', () => setTimeout(() => { dropdown.classList.add('hidden'); }, 150));

  input.addEventListener('keydown', (e) => {
    if (dropdown.classList.contains('hidden') || opcionesActuales.length === 0) return;
    const maxIndex = Math.min(opcionesActuales.length, 8) - 1;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      indiceResaltado = Math.min(indiceResaltado + 1, maxIndex);
      marcarResaltado();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      indiceResaltado = Math.max(indiceResaltado - 1, 0);
      marcarResaltado();
    } else if (e.key === 'Enter') {
      if (indiceResaltado >= 0) {
        e.preventDefault();
        seleccionar(opcionesActuales[indiceResaltado]);
      }
    } else if (e.key === 'Escape') {
      dropdown.classList.add('hidden');
    }
  });
}

function sugerirValoresUnicos(campo, query) {
  const q = query.toLowerCase();
  const valores = [...new Set(catalogoProductos.map(p => p[campo]).filter(Boolean))];
  return valores.filter(v => v.toLowerCase().includes(q));
}

// Compara un producto contra un texto de búsqueda de VARIAS palabras: cada
// palabra debe aparecer en ALGÚN campo (SKU, marca, producto, presentación,
// contenido o variante), sin importar el orden ni en qué campo esté cada una.
// Así "petit 330" o "petit 3" encuentran "CBC Petit 330 mL" aunque "330"
// esté en el volumen y "petit" en el nombre del producto.
function coincideBusqueda(producto, textoBusqueda) {
  const palabras = textoBusqueda.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (palabras.length === 0) return true;
  const textoCompleto = [
    producto.sku, producto.marca, producto.linea,
    producto.magnitud, producto.volumen, producto.variante
  ].join(' ').toLowerCase();
  return palabras.every(palabra => textoCompleto.includes(palabra));
}

// SEGURIDAD: escapa caracteres de HTML (&, <, >, ", ') antes de insertar
// texto libre del catálogo o del historial (marca, línea, presentación,
// variante, volumen, SKU) con innerHTML. Sin esto, un producto guardado con
// algo como <img src=x onerror=...> se ejecutaría como código al mostrarse
// en Stock, Dashboard, Analítica o los buscadores.
//
// REGLA: todo texto libre que venga de catalogoProductos o de LOG_TRANS debe
// pasar por aquí antes de ir dentro de un innerHTML. Números y textos fijos
// que pone el propio código (semáforos, estados, folios) no lo necesitan.
// Si en cambio el texto va a un .value o a un .textContent, NO hace falta
// escaparlo — esos dos ya tratan el texto como texto plano, nunca como código.
function escaparHTML(texto) {
  const mapa = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(texto ?? '').replace(/[&<>"']/g, (c) => mapa[c]);
}

// Normaliza texto SOLO para comparar si dos productos son "el mismo"
// (mayúsculas/minúsculas y espacios de más no deberían crear un producto
// nuevo). NUNCA se usa para guardar ni mostrar — lo que el usuario escribió
// se guarda tal cual; esto es solo para la comparación interna.
function normalizarTexto(texto) {
  return (texto || '').toString().trim().toLowerCase().replace(/\s+/g, ' ');
}

// FECHA Y HORA LOCALES (no UTC) — new Date().toISOString() SIEMPRE da la hora
// UTC, que en El Salvador (UTC-6) puede diferir 6 horas de la hora real del
// dispositivo, y cerca de la medianoche incluso cambiar el DÍA. Estas dos
// funciones arman la fecha/hora a mano con los valores LOCALES del reloj del
// dispositivo, para que lo guardado siempre coincida con lo que la persona ve.
function obtenerFechaLocal() {
  const ahora = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${ahora.getFullYear()}-${pad(ahora.getMonth() + 1)}-${pad(ahora.getDate())}`;
}

function obtenerTimestampLocal() {
  const ahora = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const hora = `${pad(ahora.getHours())}:${pad(ahora.getMinutes())}:${pad(ahora.getSeconds())}`;
  return `${obtenerFechaLocal()} ${hora}`;
}

// VALIDACIONES DE PRECIOS CON DECIMALES (usadas en Registrar y en el modal de Stock)
function validarPrecioDistribuidor(input) {
  const val = input.value;
  const warn = document.getElementById('warn-pdist');
  if (val.includes('.')) {
    const decimals = val.split('.')[1];
    if (decimals && decimals.length > 5) {
      if (warn) warn.classList.remove('hidden');
      input.value = parseFloat(val).toFixed(5);
      return;
    }
  }
  if (warn) warn.classList.add('hidden');
}

function validarPrecioConsumidor(input) {
  const val = input.value;
  const warn = document.getElementById('warn-pcons');
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

// ===== LECTURA ROBUSTA DE GOOGLE SHEETS =====
// TODA lectura de un rango de la hoja pasa por AQUÍ — ningún otro archivo
// debe llamar gapi.client.sheets.spreadsheets.values.get() directamente.
// Centralizarlo es lo que evita que este bug (o uno parecido) se vuelva a
// colar si mañana se agrega una consulta nueva y se nos olvida el detalle.
//
// EL BUG QUE ESTO CORRIGE: por defecto, la API de Sheets devuelve los
// números "formateados" como se ven en pantalla. En una hoja configurada
// en español, un precio guardado como 8.5 viaja como el TEXTO "8,5" — y
// parseFloat("8,5") se detiene en la coma, leyendo silenciosamente 8 en
// vez de 8.5. Eso truncaba precios, galones y montos en toda la app sin
// avisar. Pidiendo 'UNFORMATTED_VALUE', Sheets siempre devuelve el número
// real (8.5), sin importar el idioma de la hoja.
async function leerRango(rango) {
  const res = await gapi.client.sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: rango,
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  return res.result ? res.result.values || [] : [];
}

// Convierte a número de forma robusta, sin importar si el separador
// decimal es coma o punto. Es una SEGUNDA capa de seguridad además de
// leerRango(): con leerRango() los números ya llegan crudos desde Sheets,
// pero esto cubre cualquier otro caso donde un número pueda llegar como
// texto con coma (ej. un valor pegado a mano, o una hoja vieja editada a
// mano). Reemplaza a parseFloat() en todo lo que se lee de una fila de
// Sheets — para valores de un <input> (que el navegador ya entrega en
// punto, sin importar el idioma del sistema) parseFloat sigue siendo
// correcto y no hace falta cambiarlo.
//
// Regla para el caso ambiguo (trae AMBOS símbolos, ej. "1.234,56"): el que
// aparece MÁS A LA DERECHA es el decimal real; el otro se asume separador
// de miles y se descarta. Si trae solo uno de los dos, se asume que ES el
// decimal (aquí nunca se separan miles con puntos ni comas).
function parsearNumero(valor) {
  if (valor === null || valor === undefined || valor === '') return 0;
  if (typeof valor === 'number') return isNaN(valor) ? 0 : valor;

  let texto = String(valor).trim();
  if (texto === '') return 0;

  const tieneComa = texto.includes(',');
  const tienePunto = texto.includes('.');

  if (tieneComa && tienePunto) {
    texto = texto.lastIndexOf(',') > texto.lastIndexOf('.')
      ? texto.replace(/\./g, '').replace(',', '.')
      : texto.replace(/,/g, '');
  } else if (tieneComa) {
    texto = texto.replace(',', '.');
  }

  const n = parseFloat(texto);
  return isNaN(n) ? 0 : n;
}

// SEGUNDA CAUSA DEL MISMO BUG: 'UNFORMATTED_VALUE' devuelve un número de
// serie (días desde el 30-dic-1899) en vez de texto para cualquier celda
// que Sheets haya reconocido como fecha real — y eso pasa aunque se haya
// escrito como texto ISO ("2026-09-10"): Sheets la reconoce igual y la
// convierte sola, sin avisar. Sin esto, cualquier comparación de fecha
// (fechaMov < fechaInicio) o un .split('-') sobre esa celda se rompe.
//
// Si la celda YA es texto, se devuelve tal cual (nunca se inventa una
// conversión que no hace falta). Si es número, se reconstruye 'YYYY-MM-DD'
// (o 'YYYY-MM-DD HH:MM:SS' si trae hora) con la MISMA época que usa Sheets,
// para que el resultado sea idéntico al texto que el código original
// escribió — y las comparaciones sigan funcionando igual que siempre.
function normalizarFechaCelda(valor) {
  if (typeof valor !== 'number') return valor || '';

  const epoca = Date.UTC(1899, 11, 30);
  const fecha = new Date(epoca + Math.round(valor * 86400000));
  const pad = (n) => String(n).padStart(2, '0');
  const fechaStr = `${fecha.getUTCFullYear()}-${pad(fecha.getUTCMonth() + 1)}-${pad(fecha.getUTCDate())}`;

  const tieneHora = Math.abs(valor % 1) > 1e-9;
  if (!tieneHora) return fechaStr;

  const horaStr = `${pad(fecha.getUTCHours())}:${pad(fecha.getUTCMinutes())}:${pad(fecha.getUTCSeconds())}`;
  return `${fechaStr} ${horaStr}`;
}

// Como leerRango(), pero además normaliza (con normalizarFechaCelda) las
// columnas que se le indiquen en indicesFecha — para cualquier hoja que
// tenga una columna de fecha u hora (LOG_TRANS, COSTOS_OPERATIVOS,
// COSTOS_COMBUSTIBLE, CATALOGO). Centralizado aquí para no repetir este
// mapeo en cada archivo que lee una de esas hojas.
async function leerRangoConFechas(rango, indicesFecha) {
  const rows = await leerRango(rango);
  rows.forEach(r => {
    indicesFecha.forEach(i => { r[i] = normalizarFechaCelda(r[i]); });
  });
  return rows;
}

// LECTURA DE CATALOGO Y BD
async function cargarDatosIniciales() {
  try {
    SPREADSHEET_ID = await buscarOCrearBaseDatos();

    // "Parche" para bases de datos que ya existían antes de estas hojas:
    // si no están, las crea aquí mismo con sus encabezados. En una BD
    // nueva no hace nada (ya vienen incluidas desde
    // buscarOCrearBaseDatos/inicializarEncabezadosBD), solo cuesta una
    // consulta extra de verificación por hoja.
    await asegurarHojaExiste('COSTOS_OPERATIVOS', ENCABEZADOS_COSTOS_OPERATIVOS, 'COSTOS_OPERATIVOS!A1:G1');
    await asegurarHojaExiste('VEHICULOS', ENCABEZADOS_VEHICULOS, 'VEHICULOS!A1:F1');
    await asegurarHojaExiste('COSTOS_COMBUSTIBLE', ENCABEZADOS_COSTOS_COMBUSTIBLE, 'COSTOS_COMBUSTIBLE!A1:H1');
    // Mismo "parche", pero para una COLUMNA nueva dentro de una hoja que ya
    // existía (CATALOGO), en vez de una hoja completa — ver la función.
    await asegurarColumnaStockBonificado();

    const rows = await leerRangoConFechas('CATALOGO!A2:P', [10, 13, 14]);

    // v2.2: se agregó STOCK_BONIFICADO al final (columna P) — cuántas de
    // las unidades del stock actual llegaron gratis por bonificación y
    // todavía no se han vendido. Se usa en Stock para separar "Valor Total
    // de Bodega" de "Valor Invertido en Bodega" (ver stock.js).
    // Orden actual de columnas:
    // A:SKU B:MARCA C:LINEA D:PRESENTACION E:VOLUMEN F:VARIANTE
    // G:P_DIST H:P_CONS I:STOCK J:ESTADO K:ULTIMA_MODIF L:TIPO_EMPAQUE
    // M:ID_PRODUCTO N:FECHA_CREACION O:MODIFICACION_ANTERIOR P:STOCK_BONIFICADO
    catalogoProductos = rows.map(r => ({
      sku: r[0], marca: r[1], linea: r[2], magnitud: r[3],
      volumen: r[4], variante: r[5] || '',
      pDist: parsearNumero(r[6]), pCons: parsearNumero(r[7]),
      stock: parsearNumero(r[8]), estado: r[9] || 'ACTIVO',
      ultimaModif: r[10] || '',
      tipoEmpaque: r[11] || '',
      idProducto: parseInt(r[12]) || null,
      fechaCreacion: r[13] || '',
      modificacionAnterior: r[14] || '',
      stockBonificado: parsearNumero(r[15])
    }));

    // Catálogo de vehículos (para Costos Operativos → Combustible). Clave
    // = PLACA, no necesita un ID numérico aparte porque la placa no cambia.
    const rowsVehiculos = await leerRango('VEHICULOS!A2:F');
    catalogoVehiculos = rowsVehiculos.map(r => ({
      placa: r[0], marca: r[1], modelo: r[2], color: r[3],
      tipoCombustible: r[4] || '', estado: r[5] || 'ACTIVO'
    }));

    await cargarUmbrales();

    generarFolioCorrelativo();
    document.getElementById('status').innerText = 'Conectado a la base de datos.';
  } catch (err) {
    document.getElementById('status').innerText = 'Error al cargar: ' + err.message;
  }
}

// GENERA UN ID DE PRODUCTO CORRELATIVO Y ÚNICO (no UUID: volumen bajo, se prioriza legibilidad)
function generarIdProducto() {
  const maxId = catalogoProductos.reduce((max, p) => Math.max(max, p.idProducto || 0), 0);
  return maxId + 1;
}

const CLAVE_SPREADSHEET_ID = 'finanzas-spreadsheet-id'; // recuerda el archivo exacto entre sesiones — ver por qué en buscarOCrearBaseDatos

// Confirma que un ID de spreadsheet siga siendo válido y accesible. Un GET
// liviano (sin pedir datos de celdas, solo el ID de vuelta) alcanza para
// saber si el archivo sigue existiendo y esta cuenta todavía tiene acceso.
async function verificarSpreadsheetExiste(id) {
  try {
    await gapi.client.sheets.spreadsheets.get({ spreadsheetId: id, fields: 'spreadsheetId' });
    return true;
  } catch (err) {
    return false;
  }
}

async function buscarArchivoPorNombre(nombre) {
  const response = await gapi.client.drive.files.list({
    q: `name = '${nombre}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`,
    fields: 'files(id, name)',
    spaces: 'drive'
  });
  const files = response.result ? response.result.files : null;
  return (files && files.length > 0) ? files[0] : null;
}

async function crearBaseDatosNueva() {
  document.getElementById('status').innerText = 'Creando nueva base de datos en tu Drive...';

  const createRes = await gapi.client.sheets.spreadsheets.create({
    resource: {
      properties: { title: DB_FILE_NAME },
      sheets: [
        { properties: { title: 'LOG_TRANS' } },
        { properties: { title: 'CATALOGO' } },
        { properties: { title: 'LOG_HISTORICO_PRECIOS' } },
        { properties: { title: 'UMBRALES' } },
        { properties: { title: 'COSTOS_OPERATIVOS' } },
        { properties: { title: 'VEHICULOS' } },
        { properties: { title: 'COSTOS_COMBUSTIBLE' } }
      ]
    }
  });

  const newSpreadsheetId = createRes.result.spreadsheetId;
  await inicializarEncabezadosBD(newSpreadsheetId);
  return newSpreadsheetId;
}

// BUSCAR O CREAR LA BASE DE DATOS
//
// Camino normal (la enorme mayoría de las veces): ya guardamos el ID
// exacto la sesión anterior, en localStorage — se confirma con una sola
// llamada liviana y listo. Esto es lo que de verdad evita el problema de
// "2 archivos con el mismo nombre" (ej. un backup manual con el mismo
// nombre): ya no depende de cuál de los dos devuelva Google primero al
// buscar por nombre — siempre se vuelve a apuntar al mismo ID de la vez
// anterior, sin ambigüedad.
//
// La búsqueda por NOMBRE queda como respaldo: la primerísima vez que se
// conecta esta cuenta (todavía no hay nada guardado), o si el ID guardado
// dejara de servir (el archivo se borró, o se limpió el almacenamiento
// del navegador/PWA).
async function buscarOCrearBaseDatos() {
  const idGuardado = localStorage.getItem(CLAVE_SPREADSHEET_ID);
  if (idGuardado && await verificarSpreadsheetExiste(idGuardado)) {
    return idGuardado;
  }

  const existente = await buscarArchivoPorNombre(DB_FILE_NAME);
  const id = existente ? existente.id : await crearBaseDatosNueva();

  localStorage.setItem(CLAVE_SPREADSHEET_ID, id);
  return id;
}

// Verifica que una hoja exista en el spreadsheet actual; si no, la crea
// con sus encabezados. Sirve para agregar hojas NUEVAS (como
// COSTOS_OPERATIVOS, VEHICULOS o COSTOS_COMBUSTIBLE) a bases de datos que
// la persona ya tenía instaladas antes de que esa hoja existiera — sin
// esto, leerla directamente fallaría con un error de "rango no encontrado"
// en esas cuentas.
async function asegurarHojaExiste(nombreHoja, encabezados, rangoEncabezados) {
  const meta = await gapi.client.sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const yaExiste = meta.result.sheets.some(h => h.properties.title === nombreHoja);
  if (yaExiste) return;

  await gapi.client.sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    resource: { requests: [{ addSheet: { properties: { title: nombreHoja } } }] }
  });

  await gapi.client.sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: rangoEncabezados,
    valueInputOption: 'USER_ENTERED',
    resource: { values: [encabezados] }
  });
}

// Mismo "parche" que asegurarHojaExiste(), pero para una COLUMNA nueva
// dentro de una hoja que YA existía (CATALOGO) — a diferencia de una hoja
// completa, acá basta con escribir el encabezado en P1 si todavía está
// vacío; Sheets no necesita que la columna se "cree" de ninguna otra forma.
// Sin esto, las cuentas que ya tenían CATALOGO desde antes de v2.2 se
// quedarían sin encabezado en la columna P (aunque el código igual
// funcione, porque simplemente escribe ahí cuando haga falta).
async function asegurarColumnaStockBonificado() {
  const valores = await leerRango('CATALOGO!P1');
  const yaTieneEncabezado = valores && valores[0] && valores[0][0];
  if (yaTieneEncabezado) return;

  await gapi.client.sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: 'CATALOGO!P1',
    valueInputOption: 'USER_ENTERED',
    resource: { values: [['STOCK_BONIFICADO']] }
  });
}

async function inicializarEncabezadosBD(spreadsheetId) {
  // v2.0: se eliminó CANT_EMPAQUE (no tenía función activa) de LOG_TRANS
  // y de CATALOGO. En CATALOGO se agregan FECHA_CREACION y
  // MODIFICACION_ANTERIOR al final, para trazabilidad.
  // v2.2: se agrega STOCK_BONIFICADO al final de CATALOGO (ver
  // asegurarColumnaStockBonificado() para el caso de BDs ya existentes).
  const encabezadosLOG = [
    'TRANS_ID', 'TIMESTAMP_LOG', 'FECHA_MOV', 'TIPO_MOV', 'SKU_ITEM',
    'MARCA', 'LINEA_PROD', 'PRESENTACION', 'VOLUMEN', 'VARIANTE',
    'CANTIDAD', 'UNID_BONIF', 'P_DISTRIBUIDOR', 'P_CONSUMIDOR',
    'TOTAL_INVERSION', 'MARGEN_UNIT', 'TOTAL_VENTA', 'UTILIDAD_NETA', 'TIPO_EMPAQUE',
    'ESTADO_MOV'
  ];

  const encabezadosCatalogo = [
    'SKU_ITEM', 'MARCA', 'LINEA_PROD', 'PRESENTACION',
    'VOLUMEN', 'VARIANTE', 'P_DISTRIBUIDOR', 'P_CONSUMIDOR',
    'STOCK_ACTUAL', 'ESTADO_ITEM', 'ULTIMA_MODIF',
    'TIPO_EMPAQUE', 'ID_PRODUCTO', 'FECHA_CREACION', 'MODIFICACION_ANTERIOR',
    'STOCK_BONIFICADO'
  ];

  const encabezadosHistorico = [
    'ID_LOG', 'SKU_ITEM', 'P_DIST_ANT', 'P_DIST_NUEVO',
    'P_CONS_ANT', 'P_CONS_NUEVO', 'FECHA_CAMBIO', 'USUARIO'
  ];

  const encabezadosUmbrales = ['TIPO_EMPAQUE', 'STOCK_MIN', 'STOCK_MAX'];

  await gapi.client.sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: spreadsheetId,
    resource: {
      valueInputOption: 'USER_ENTERED',
      data: [
        { range: 'LOG_TRANS!A1:T1', values: [encabezadosLOG] },
        { range: 'CATALOGO!A1:P1', values: [encabezadosCatalogo] },
        { range: 'LOG_HISTORICO_PRECIOS!A1:H1', values: [encabezadosHistorico] },
        { range: 'UMBRALES!A1:C1', values: [encabezadosUmbrales] },
        { range: 'COSTOS_OPERATIVOS!A1:G1', values: [ENCABEZADOS_COSTOS_OPERATIVOS] },
        { range: 'VEHICULOS!A1:F1', values: [ENCABEZADOS_VEHICULOS] },
        { range: 'COSTOS_COMBUSTIBLE!A1:H1', values: [ENCABEZADOS_COSTOS_COMBUSTIBLE] }
      ]
    }
  });
}

async function generarFolioCorrelativo() {
  const prefijo = (tipoMovimiento === 'ENTRADA') ? 'IN-' : 'FAC-';
  try {
    const rows = await leerRango('LOG_TRANS!A:A');
    let maxNum = 0;
    rows.forEach(r => {
      if (r[0] && r[0].startsWith(prefijo)) {
        const num = parseInt(r[0].replace(prefijo, ''));
        if (num > maxNum) maxNum = num;
      }
    });
    const siguiente = String(maxNum + 1).padStart(6, '0');
    document.getElementById('trans-id').value = `${prefijo}${siguiente}`;
  } catch (e) {
    document.getElementById('trans-id').value = `${prefijo}000001`;
  }
}

// Reescribe TODA la hoja CATALOGO con el estado actual de catalogoProductos.
// De paso, mueve la trazabilidad un paso: antes de poner "ahora" en
// ULTIMA_MODIF, guarda lo que tenía antes en MODIFICACION_ANTERIOR.
//
// OJO (limitación conocida, ya existía antes de v2.0): esta función
// reescribe TODOS los productos cada vez que se llama, no solo el que
// cambió — así que ULTIMA_MODIF/MODIFICACION_ANTERIOR avanzan para todo
// el catálogo en cada guardado, no únicamente para el producto tocado.
// Hacerlo por producto individual queda para cuando migremos a un sistema
// contable más robusto (ya anotado en pendientes).
async function reescribirHojaCatalogo() {
  const ahora = obtenerTimestampLocal();

  const rows = catalogoProductos.map(p => {
    const modAnterior = p.ultimaModif || '';
    p.modificacionAnterior = modAnterior;
    p.ultimaModif = ahora;

    return [
      p.sku, p.marca, p.linea, p.magnitud, p.volumen, p.variante,
      p.pDist, p.pCons, p.stock, p.estado, p.ultimaModif,
      p.tipoEmpaque || '', p.idProducto,
      p.fechaCreacion || '', p.modificacionAnterior,
      p.stockBonificado || 0
    ];
  });

  await gapi.client.sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: 'CATALOGO!A2:P',
    valueInputOption: 'USER_ENTERED',
    resource: { values: rows }
  });
}

// Escribe UNA fila en LOG_HISTORICO_PRECIOS. Es la ÚNICA función que debe
// hacerlo — usada desde Stock (editar producto), Registrar (reabastecer con
// precio distinto) e Importar Excel, para que nunca vuelva a faltar en un
// camino sin faltar en todos.
async function registrarHistoricoPrecio(sku, pDistAnterior, pDistNuevo, pConsAnterior, pConsNuevo) {
  await gapi.client.sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: 'LOG_HISTORICO_PRECIOS!A:H',
    valueInputOption: 'USER_ENTERED',
    resource: {
      values: [[
        `LOG-${Date.now()}`, sku, pDistAnterior, pDistNuevo, pConsAnterior, pConsNuevo,
        obtenerTimestampLocal(), 'USUARIO_ACTIVO'
      ]]
    }
  });
}

// ===== NAV: FLECHAS DE SCROLL + NAVEGACIÓN CON FLECHAS DEL TECLADO =====
// El nav ahora se desplaza horizontalmente (ver base.css). Estas flechas
// (‹ ›) son solo una pista visual de que hay más pestañas hacia ese lado,
// y desaparecen al llegar al borde correspondiente.
function actualizarFlechasNav() {
  const nav = document.getElementById('top-nav');
  const flechaIzq = document.getElementById('nav-flecha-izq');
  const flechaDer = document.getElementById('nav-flecha-der');
  if (!nav || !flechaIzq || !flechaDer) return;

  const margen = 4; // tolerancia en px, evita parpadeo por redondeo
  const hayOverflow = nav.scrollWidth > nav.clientWidth + margen;
  const enElFinal = nav.scrollLeft + nav.clientWidth >= nav.scrollWidth - margen;

  // Ambas flechas se comportan igual: desaparecen del todo al llegar a su
  // borde correspondiente (antes la derecha solo se atenuaba, quedando
  // siempre visible — cambiado por confuso: ahora "desaparece" significa
  // lo mismo en los dos sentidos, sin quedar un remanente visual raro).
  flechaIzq.classList.toggle('hidden', !hayOverflow || nav.scrollLeft <= margen);
  flechaDer.classList.toggle('hidden', !hayOverflow || enElFinal);
}

// Clic/toque en una flecha del nav: desplaza el scroll horizontal del
// menú un tramo fijo en esa dirección (antes las flechas eran solo un
// indicador visual, sin poder tocarlas). El 'scroll' listener de abajo ya
// se encarga de refrescar qué flecha mostrar después de moverse.
function desplazarNav(direccion) {
  const nav = document.getElementById('top-nav');
  if (!nav) return;
  const distancia = 150;
  nav.scrollBy({ left: direccion === 'der' ? distancia : -distancia, behavior: 'smooth' });
}

// Flechas del teclado (← →): SOLO actúan si el foco ya está sobre un botón
// del nav — así no interfieren con las flechas usadas en inputs de fecha,
// número o el autocompletado en el resto de la app. Reutiliza switchTab()
// vía .click(), en vez de duplicar su lógica.
function inicializarNavPestanas() {
  const nav = document.getElementById('top-nav');
  if (!nav) return;

  actualizarFlechasNav();
  nav.addEventListener('scroll', actualizarFlechasNav);
  window.addEventListener('resize', actualizarFlechasNav);

  nav.addEventListener('keydown', (e) => {
    if (!e.target.classList.contains('nav-btn')) return;
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();

    const botones = Array.from(nav.querySelectorAll('.nav-btn'));
    const indiceActual = botones.indexOf(e.target);
    const indiceSiguiente = e.key === 'ArrowRight'
      ? Math.min(indiceActual + 1, botones.length - 1)
      : Math.max(indiceActual - 1, 0);

    const botonSiguiente = botones[indiceSiguiente];
    botonSiguiente.focus();
    botonSiguiente.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    botonSiguiente.click(); // dispara switchTab(), igual que un toque
  });
}

window.addEventListener('DOMContentLoaded', inicializarNavPestanas);
