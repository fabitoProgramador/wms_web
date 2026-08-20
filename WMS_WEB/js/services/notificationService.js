/** Sistema transversal de notificaciones no bloqueantes para toda la aplicación. */
const NotificationService = (() => {
  const defaults = { success: 3200, info: 3800, warning: 5200, error: 6500, offline: 6000 };
  const icons = { success: '✓', info: 'i', warning: '!', error: '×', offline: '↯' };
  let sequence = 0;

  function normalizeType(type) {
    const value = String(type || 'info').toLowerCase();
    if (value === 'ok') return 'success';
    return Object.hasOwn(defaults, value) ? value : 'info';
  }

  function host() {
    let node = document.getElementById('wmsNotificationHost');
    if (node) return node;
    node = document.createElement('section');
    node.id = 'wmsNotificationHost';
    node.className = 'wms-notification-host';
    node.setAttribute('aria-label', 'Notificaciones del sistema');
    node.setAttribute('aria-live', 'polite');
    node.setAttribute('aria-relevant', 'additions text');
    document.body.appendChild(node);
    return node;
  }

  function dismiss(target) {
    const node = typeof target === 'string' ? document.getElementById(target) : target;
    if (!node || node.dataset.closing === 'true') return;
    node.dataset.closing = 'true';
    clearTimeout(node._dismissTimer);
    node.classList.remove('show');
    node.classList.add('leaving');
    setTimeout(() => node.remove(), 190);
  }

  function show(message, options = {}) {
    const text = String(message ?? '').trim();
    if (!text) return null;
    const type = normalizeType(typeof options === 'string' ? options : options.type);
    const config = typeof options === 'string' ? {} : options;
    const container = host();
    const duplicate = [...container.children].find(node => node.dataset.message === text && node.dataset.type === type);
    if (duplicate) dismiss(duplicate);
    /* Tope de globos en pantalla.
     *
     * Antes esto era `while (container.children.length >= 4) dismiss(primero)`,
     * y colgaba el navegador: dismiss() no borra el nodo al instante, lo marca
     * como saliente y lo quita 190 ms despues. Al quinto aviso seguido el
     * contador de hijos nunca bajaba, dismiss() volvia a salir temprano sobre
     * el mismo nodo ya marcado, y el bucle no terminaba nunca: la pagina
     * quedaba congelada. Ahora se cuentan solo los que NO estan saliendo, asi
     * cada vuelta marca uno nuevo y el bucle siempre termina. */
    const vivos = () => [...container.children].filter(node => node.dataset.closing !== 'true');
    while (vivos().length >= 4) dismiss(vivos()[0]);

    const id = `wmsNotice${++sequence}`;
    const notice = document.createElement('article');
    notice.id = id;
    notice.className = `wms-notification ${type}`;
    notice.dataset.message = text;
    notice.dataset.type = type;
    notice.setAttribute('role', type === 'error' || type === 'warning' ? 'alert' : 'status');
    notice.setAttribute('aria-atomic', 'true');

    const icon = document.createElement('span');
    icon.className = 'wms-notification-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = icons[type];
    const content = document.createElement('div');
    content.className = 'wms-notification-content';
    if (config.title) {
      const title = document.createElement('strong');
      title.textContent = config.title;
      content.appendChild(title);
    }
    const body = document.createElement('p');
    body.textContent = text;
    content.appendChild(body);
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'wms-notification-close';
    close.setAttribute('aria-label', 'Cerrar notificación');
    close.textContent = '×';
    close.onclick = () => dismiss(notice);
    notice.append(icon, content, close);
    container.appendChild(notice);
    requestAnimationFrame(() => notice.classList.add('show'));

    // Todo aviso queda guardado en el centro de notificaciones de la campana,
    // aunque el globo desaparezca de pantalla a los pocos segundos.
    if (config.store !== false) archive({ type, title: config.title || '', message: text, persistent: config.persist === true });

    const duration = Number.isFinite(config.duration) ? config.duration : defaults[type];
    const startTimer = () => { if (duration > 0) notice._dismissTimer = setTimeout(() => dismiss(notice), duration); };
    const stopTimer = () => clearTimeout(notice._dismissTimer);
    notice.addEventListener('mouseenter', stopTimer);
    notice.addEventListener('mouseleave', startTimer);
    notice.addEventListener('focusin', stopTimer);
    notice.addEventListener('focusout', startTimer);
    startTimer();
    return id;
  }


  /* ==================================================================
   * CENTRO DE NOTIFICACIONES
   *
   * El globo dura segundos; el registro dura horas. Todo lo que se
   * notifica queda guardado para que el operador pueda revisar despues
   * lo que pasó en la planta mientras no miraba la pantalla.
   *
   * Retencion: 3 horas. Las alertas marcadas como `persist` —problemas
   * de pallet y alertas de calidad— NO caducan: quedan hasta que
   * alguien las cierra, porque representan algo por resolver.
   * ================================================================== */
  const STORE_KEY = 'wms_web_centro_notificaciones';
  /* Dos clases de aviso conviven en el mismo registro:
   *
   *   origen 'sistema'  → lo genera la aplicación en ESTE equipo mientras se
   *                       opera. Es ruido operacional útil por un rato y se
   *                       borra solo a las 2 horas.
   *   origen 'gerencia' → lo escribe una persona (Gerencia, Calidad o
   *                       Frigorífico) para el resto. No es ruido: es un
   *                       comunicado. Dura lo que su autor decida y la
   *                       limpieza de los vencibles no lo toca.
   *
   * En ambos casos, lo marcado como `persist` (alertas de pallet y de
   * calidad) sobrevive hasta que alguien lo cierre. */
  const RETENTION_MS = 2 * 60 * 60 * 1000;   // 2 horas para los avisos del sistema
  const MAX_ENTRIES = 200;
  const listeners = new Set();

  function readStore() {
    try { const data = JSON.parse(localStorage.getItem(STORE_KEY) || '[]'); return Array.isArray(data) ? data : []; }
    catch (_) { return []; }
  }
  function writeStore(rows) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(rows.slice(-MAX_ENTRIES))); } catch (_) {}
    listeners.forEach(fn => { try { fn(); } catch (_) {} });
  }
  /** Descarta lo caducado. Lo persistente sobrevive a la limpieza. */
  function vigente(x, ahora) {
    if (x.persistent === true) return true;                 // queda hasta resolverse
    if (x.origen === 'gerencia') return !x.vence || Number(x.vence) > ahora;
    return Number(x.ts || 0) >= ahora - RETENTION_MS;        // avisos del sistema: 2 h
  }
  function purge(rows = readStore()) {
    const ahora = Date.now();
    const vivos = rows.filter(x => vigente(x, ahora));
    if (vivos.length !== rows.length) writeStore(vivos);
    return vivos;
  }
  function archive(entry) {
    const rows = purge();
    rows.push({
      id: `NTF-${Date.now()}-${++sequence}`,
      ts: Date.now(),
      type: entry.type,
      title: entry.title || '',
      message: entry.message,
      persistent: entry.persistent === true,
      origen: entry.origen || 'sistema',
      read: false
    });
    writeStore(rows);
  }

  const center = {
    RETENTION_MS,
    /** Avisos vigentes, del mas reciente al mas antiguo. */
    entries() { return purge().slice().reverse(); },
    unread() { return purge().filter(x => !x.read).length; },
    markAllRead() { const rows = purge().map(x => ({ ...x, read: true })); writeStore(rows); },
    remove(id) { writeStore(purge().filter(x => x.id !== id)); },
    /** Limpia el ruido operacional. Los comunicados de gerencia y las
     *  alertas fijas se conservan a proposito: no son ruido. */
    clearTransient() { writeStore(purge().filter(x => x.persistent === true || x.origen === 'gerencia')); },

    /**
     * Publica un comunicado. A diferencia de `show()`, esto no lo genera la
     * aplicacion: lo escribe una persona para el resto del equipo.
     * @param {{titulo,cuerpoHtml,tipo,area,autor,codigos,vence}} datos
     */
    publicar(datos) {
      const rows = purge();
      const entrada = {
        id: `COM-${Date.now()}-${++sequence}`,
        ts: Date.now(),
        type: datos.tipo || 'info',
        title: String(datos.titulo || '').trim(),
        message: String(datos.resumen || '').trim(),
        cuerpoHtml: String(datos.cuerpoHtml || ''),
        origen: 'gerencia',
        area: String(datos.area || '').trim(),
        autor: String(datos.autor || '').trim(),
        codigos: Array.isArray(datos.codigos) ? datos.codigos.slice(0, 50) : [],
        vence: datos.vence ? Number(datos.vence) : null,
        persistent: false,
        read: false
      };
      rows.push(entrada);
      writeStore(rows);
      return entrada;
    },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    purge
  };

  function clear() { document.querySelectorAll('.wms-notification').forEach(dismiss); }
  ['success', 'info', 'warning', 'error', 'offline'].forEach(type => {
    show[type] = (message, options = {}) => show(message, { ...options, type });
  });

  window.addEventListener('offline', () => show.offline('Sin conexión · los cambios compatibles seguirán guardándose localmente.', { title: 'Modo offline' }));
  window.addEventListener('online', () => show.success('Conexión recuperada. La sincronización continuará automáticamente.', { title: 'En línea' }));
  // Limpieza periodica para que la campana no muestre avisos vencidos aunque
  // la pestaña quede abierta toda la jornada.
  setInterval(() => center.purge(), 5 * 60 * 1000);

  return {
    show, dismiss, clear,
    center,
    success: show.success,
    info: show.info,
    warning: show.warning,
    error: show.error,
    offline: show.offline
  };
})();
