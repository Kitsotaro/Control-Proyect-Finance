// ============================================================
// VENTAS.JS — Anulación de movimientos ya guardados (Ledger/Auditoría).
//
// LOG_TRANS es append-only: nunca se reescribe una fila con datos nuevos.
// Lo único que se le permite tocar a un movimiento ya guardado es su
// columna ESTADO_MOV, para marcarlo como ANULADA — el resto de la fila
// queda intacta para siempre, como constancia de lo que pasó.
//
// "Editar" un movimiento = Anular este + registrar uno nuevo corregido
// desde la pestaña Registrar (con su propio folio nuevo). Por eso aquí
// NO hay una función de editar: alcanza con anular + volver a capturar.
// ============================================================

// Punto de entrada desde el botón "🗑️ Anular" de cada movimiento en el
// Dashboard. Decide qué diálogo mostrar según si el movimiento es de HOY
// o de un día anterior (anular algo viejo puede afectar reportes o
// estadísticas que ya se hayan revisado para ese día).
function confirmarAnulacion({ filaSheet, folio, fechaMov, sku, cantidadSigno, bonif }) {
  const hoy = obtenerFechaLocal();
  const esHoy = fechaMov === hoy;

  mostrarDialogo({
    titulo: esHoy ? '¿Anular movimiento?' : '⚠️ Anular movimiento de otro día',
    mensaje: esHoy
      ? `Se anulará el folio ${folio}. El stock se ajustará de inmediato. Esta acción no se puede deshacer (pero puedes volver a registrar el movimiento correcto después).`
      : `El folio ${folio} es del ${fechaMov}, no de hoy. Anular movimientos de días anteriores puede afectar reportes o estadísticas que ya hayas revisado para esa fecha. Si el objetivo es corregir un dato, normalmente es mejor anular y registrar un movimiento nuevo con la fecha correcta. ¿Deseas continuar de todas formas?`,
    textoConfirmar: 'Sí, anular',
    textoCancelar: 'Cancelar',
    onConfirmar: () => ejecutarAnulacion({ filaSheet, folio, sku, cantidadSigno, bonif })
  });
}

async function ejecutarAnulacion({ filaSheet, folio, sku, cantidadSigno, bonif }) {
  document.getElementById('status').innerText = `Anulando folio ${folio}...`;
  try {
    await gapi.client.sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `LOG_TRANS!T${filaSheet}`,
      valueInputOption: 'USER_ENTERED',
      resource: { values: [['ANULADA']] }
    });

    // v2.2: revierte cantidad Y bonificación juntas — una Entrada con
    // bonificación sumó cantidadSigno+bonif al guardarse (ver registro.js),
    // así que anularla debe restar exactamente lo mismo. En una Venta,
    // bonif siempre es 0, así que esto no cambia nada para ese caso.
    const prodIndex = catalogoProductos.findIndex(p => p.sku === sku);
    if (prodIndex >= 0) {
      catalogoProductos[prodIndex].stock -= (cantidadSigno + (bonif || 0));
      // v2.2: si esta Entrada tenía bonificación, revierte también el
      // contador de "stock bonificado" — sin bajar de 0 (podría ya haberse
      // vendido parte de esa bonificación desde que se registró).
      catalogoProductos[prodIndex].stockBonificado = Math.max(0, (catalogoProductos[prodIndex].stockBonificado || 0) - (bonif || 0));
      await reescribirHojaCatalogo();
    } else {
      console.warn(`Anulación de ${folio}: el SKU ${sku} ya no existe en el catálogo, no se ajustó stock.`);
    }

    document.getElementById('status').innerText = `Folio ${folio} anulado correctamente.`;
    await cargarDatosIniciales();
    renderizarVentasHoy();
  } catch (err) {
    document.getElementById('status').innerText = 'Error al anular: ' + err.message;
    mostrarDialogo({ titulo: 'Error al anular', mensaje: 'No se pudo anular: ' + err.message });
  }
}