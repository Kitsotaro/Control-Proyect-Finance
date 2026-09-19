// ============================================================
// TEMA.JS — Interruptor de tema claro/oscuro (un solo botón).
//
// El atributo data-theme del <html> ya se define muy temprano, en un
// <script> chiquito al inicio de index.html (antes de que carguen los
// estilos), para evitar el "parpadeo" de un color equivocado al recargar.
// ============================================================

const CLAVE_TEMA = 'finanzas-tema';

function alternarTema() {
  const actual = document.documentElement.getAttribute('data-theme') || 'oscuro';
  const nuevo = actual === 'oscuro' ? 'claro' : 'oscuro';
  document.documentElement.setAttribute('data-theme', nuevo);
  localStorage.setItem(CLAVE_TEMA, nuevo);
  actualizarBotonTema(nuevo);

  // Chart.js no se actualiza solo: si el gráfico de Stock está visible,
  // se vuelve a dibujar para que sus textos usen los colores del tema nuevo.
  const tabStock = document.getElementById('tab-stock');
  if (tabStock && tabStock.classList.contains('active') && typeof renderizarGraficoStock === 'function') {
    try {
      renderizarGraficoStock();
    } catch (err) {
      console.warn('No se pudo redibujar el gráfico de Stock al cambiar de tema:', err);
    }
  }
}

function actualizarBotonTema(tema) {
  const btn = document.getElementById('btn-toggle-tema');
  if (!btn) return;
  // El ícono muestra el modo AL QUE CAMBIARÍAS si tocas el botón — sin texto
  // porque ahora vive junto a la franja de estado, no en su propia fila.
  const vaA = tema === 'oscuro' ? 'claro' : 'oscuro';
  btn.textContent = tema === 'oscuro' ? '☀️' : '🌙';
  btn.setAttribute('aria-label', `Cambiar a modo ${vaA}`);
}

window.addEventListener('DOMContentLoaded', () => {
  const temaActual = document.documentElement.getAttribute('data-theme') || 'oscuro';
  actualizarBotonTema(temaActual);
});
