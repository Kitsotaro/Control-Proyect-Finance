// ============================================================
// SKU.JS — Generación del código SKU inteligente.
//
// Formato: [2-3 letras de Marca][2-3 letras de Producto]-[correlativo]
// Ejemplo: CBPE-001  (CBC + Pepsi, primera variante registrada)
//
// Reglas:
// - Las letras salen de Marca y Producto/Línea (se limpian espacios y símbolos).
// - Si el código de 2 letras de una Marca (o de un Producto, comparado solo
//   contra los productos de esa MISMA marca) ya lo usa un valor DISTINTO,
//   se extiende a 3 letras automáticamente — se resuelve solo, sin tabla manual.
// - El correlativo cuenta cuántas variantes (Presentación+Contenido+Variante)
//   ya existen para esa pareja Marca+Producto, y usa el siguiente número.
// - Si el producto (misma Marca+Producto+Presentación+Contenido+Variante)
//   YA existe en el catálogo, se reutiliza tal cual su SKU — nunca se le
//   cambia el código a algo que ya tenía uno.
// ============================================================

function limpiarLetras(texto) {
  const limpio = (texto || '').toUpperCase().replace(/[^A-Z]/g, '');
  return limpio || 'XX';
}

// Reparte un código de letras por cada valor DISTINTO de una lista, en el
// orden en que aparecen. Empieza en 2 letras; si choca con un valor
// distinto ya repartido, prueba con una letra más.
function repartirCodigosDeLetras(valoresEnOrden) {
  const codigoPorValor = new Map();
  const codigosUsados = new Set();

  valoresEnOrden.forEach(valor => {
    if (codigoPorValor.has(valor)) return; // este valor ya tiene código

    const letras = limpiarLetras(valor);
    let largo = 2;
    let codigo = letras.substring(0, largo);
    while (codigosUsados.has(codigo) && largo < letras.length) {
      largo++;
      codigo = letras.substring(0, largo);
    }
    while (codigosUsados.has(codigo)) {
      codigo += '2'; // caso extremo: dos nombres distintos que igual chocan en todas sus letras
    }

    codigosUsados.add(codigo);
    codigoPorValor.set(valor, codigo);
  });

  return codigoPorValor;
}

// catalogoBase es opcional: por defecto usa el catálogo real (catalogoProductos).
// Se puede pasar un catálogo de trabajo distinto (ver registro.js/stock.js)
// cuando hace falta simular o excluir algo antes de calcular el código.
function generarSKUCompacto(marca, linea, magnitud, volumen, variante, catalogoBase) {
  const catalogo = catalogoBase || catalogoProductos;
  const varianteNorm = variante || '';

  // 1) Si este producto EXACTO ya existe, se reutiliza su SKU tal cual.
  // Se compara con normalizarTexto() (ignora mayúsculas/minúsculas y
  // espacios de más) para no crear un producto duplicado solo porque esta
  // vez se escribió "Pepsi" y antes se había escrito "PEPSI".
  const existente = catalogo.find(p =>
    normalizarTexto(p.marca) === normalizarTexto(marca) &&
    normalizarTexto(p.linea) === normalizarTexto(linea) &&
    normalizarTexto(p.magnitud) === normalizarTexto(magnitud) &&
    normalizarTexto(p.volumen) === normalizarTexto(volumen) &&
    normalizarTexto(p.variante || '') === normalizarTexto(varianteNorm)
  );
  if (existente) return existente.sku;

  // 2) Código de Marca: choque revisado contra TODAS las marcas del catálogo.
  const marcasEnOrden = [];
  catalogo.forEach(p => { if (p.marca && !marcasEnOrden.includes(p.marca)) marcasEnOrden.push(p.marca); });
  if (marca && !marcasEnOrden.includes(marca)) marcasEnOrden.push(marca);
  const codigoMarca = repartirCodigosDeLetras(marcasEnOrden).get(marca);

  // 3) Código de Producto/Línea: choque revisado SOLO dentro de esa misma marca.
  const lineasEnOrden = [];
  catalogo.forEach(p => { if (p.marca === marca && p.linea && !lineasEnOrden.includes(p.linea)) lineasEnOrden.push(p.linea); });
  if (linea && !lineasEnOrden.includes(linea)) lineasEnOrden.push(linea);
  const codigoProducto = repartirCodigosDeLetras(lineasEnOrden).get(linea);

  // 4) Correlativo: cuántas variantes de esta Marca+Producto ya existen, + 1.
  const variantesExistentes = catalogo.filter(p => p.marca === marca && p.linea === linea).length;
  const correlativo = String(variantesExistentes + 1).padStart(3, '0');

  return `${codigoMarca}${codigoProducto}-${correlativo}`;
}
