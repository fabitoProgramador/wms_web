/** Shell principal, navegación por acordeón y sidebar responsive. */
const AppController = {
  activeView: 'dashboard', sidebarCollapsed: false, mobileSidebarOpen: false, openCategory: 'Panel de Control',
  panelIds: ['dashboard','graficos','monitor_tiempo_real','bitacora','registro_verificaciones'],
  async init() { if('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(()=>{}); try { await MapaOfflineService.initialize(); } catch (_) {} const user=UserModel.getCurrentUser();
    /* Una sesion abierta en un PC de camara que nadie cierra es una cuenta
       abierta para el turno siguiente. Caduca por inactividad (2 h) y, como
       tope, por duracion total (14 h). */
    if (user) {
      const sesion = SeguridadService.estadoSesion();
      if (!sesion.vigente) {
        UserModel.clearSession();
        SeguridadService.limpiarMarcasSesion();
        this.showAuthView();
        this.avisarCaducidad();
        return;
      }
    }
    user?this.showMainApp(user):this.showAuthView(); },
  avisarCaducidad() {
    const texto = 'La sesión alcanzó su duración máxima. Vuelva a ingresar.';
    setTimeout(() => { try { NotificationService.show(texto, { type: 'warning' }); } catch (_) {} }, 400);
  },
  showAuthView() { document.getElementById('appRoot').innerHTML='<div id="authViewContainer"></div>'; AuthController.init(document.getElementById('authViewContainer')); },
  onLoginSuccess(user) { this.showMainApp(user); },
  /* Escape unico del proyecto: SeguridadService.escaparHtml. Antes cada
     archivo tenia el suyo y seis de ellos no escapaban comillas, lo que dejaba
     abierta la inyeccion dentro de atributos. */
  esc(v) { return SeguridadService.escaparHtml(v); },
  initials(name) { return String(name||'U').split(/\s+/).slice(0,2).map(x=>x[0]).join('').toUpperCase(); },
  isNarrow() { return window.innerWidth <= 1024; },
  showMainApp(user) {
    const savedTheme=localStorage.getItem('wms_web_dashboard_theme')||'dark'; document.body.classList.toggle('dashboard-light',savedTheme==='light');
    if(this.isNarrow()) this.mobileSidebarOpen=false;
    document.getElementById('appRoot').innerHTML=`<div class="app-shell">
      <div id="sidebarBackdrop" class="sidebar-backdrop ${this.mobileSidebarOpen?'':'hidden'}" onclick="AppController.closeSidebarMobile()"></div>
      <aside id="mainSidebar" class="sidebar ${this.sidebarCollapsed?'collapsed':''} ${this.mobileSidebarOpen?'mobile-open':''}" aria-label="Navegación principal">
        <div class="sidebar-brand"><img src="assets/logo.png" alt="Logo Olmué" class="brand-logo-img" onerror="this.src='assets/icono.ico'"><div class="sidebar-brand-text"><h3>PLANTA OLMUÉ</h3><small>PARRAL WMS WEB</small></div><button class="sidebar-close-mobile" onclick="AppController.closeSidebarMobile()" aria-label="Cerrar menú">×</button></div>
        <span class="sidebar-caption">MÓDULOS DEL SISTEMA</span><nav class="sidebar-nav">${this.renderNavItems()}</nav>
        <div class="sidebar-version"><span>WMS Web</span><small>Versión 2.0</small></div>
        <button class="sidebar-user user-menu-trigger" data-user-trigger onclick="AppController.toggleUserOverlay(event)" aria-expanded="false" aria-controls="userOverlayMenu"><div class="user-avatar">${this.initials(user.name)}</div><div class="user-info"><strong>${this.esc(user.name)}</strong><small>${this.esc(user.role)}</small></div><span class="user-menu-chevron wi wi-chevron" aria-hidden="true"></span></button>
      </aside>
      <main class="main-content"><header class="top-header"><div class="header-left"><button class="btn-toggle-sidebar" onclick="AppController.toggleSidebar()" aria-label="Abrir o cerrar menú"><i class="wi wi-menu"></i></button></div><div class="header-context"><img src="assets/icono.ico" alt="" class="header-logo"><div class="header-title"><h2 id="sectionTitle"></h2><p>SISTEMA FRIGORÍFICO PARRAL <i></i> En línea</p></div></div><div class="header-actions"><button class="sync-button" onclick="AppController.syncTurn()" aria-label="Sincronizar turno"><i class="wi wi-sync"></i><span>SINCRONIZAR TURNO</span></button><button type="button" id="noticeBellBtn" class="header-bell" onclick="AppController.toggleNoticeCenter(event)" aria-label="Centro de notificaciones" aria-expanded="false" aria-controls="noticeCenterPanel"><i class="wi wi-bell" aria-hidden="true"></i><b id="noticeBellCount" hidden>0</b></button><button class="header-user user-menu-trigger" data-user-trigger onclick="AppController.toggleUserOverlay(event)" aria-label="Abrir menú de usuario" aria-expanded="false" aria-controls="userOverlayMenu"><div class="user-avatar">${this.initials(user.name)}</div><div><b>${this.esc(user.name)}</b><span>${user.admin?'Administrador':this.esc(user.role)}</span></div></button><aside id="userOverlayMenu" class="user-overlay-menu hidden" aria-label="Usuario y sesión"><header><div class="user-avatar">${this.initials(user.name)}</div><div><strong>${this.esc(user.name)}</strong><span>${user.admin?'Administrador del Sistema':this.esc(user.role)}</span></div><button onclick="AppController.closeUserOverlay()" aria-label="Cerrar menú de usuario">×</button></header>${user.rut?`<p>RUT ${this.esc(user.rut)}</p>`:''}<div class="user-session-status"><i></i><span>Sesión activa</span></div><button class="user-overlay-logout" onclick="AppController.logout()"><i class="wi wi-logout"></i>CERRAR SESIÓN</button></aside></div></header><div id="mainViewport" class="main-viewport"></div></main>
    </div>`;
    this.mountShellDecor(savedTheme);
    document.querySelector('.user-session-status')?.insertAdjacentHTML('afterend','<button class="user-overlay-edit" onclick="AppController.openProfileEditor()"><i class="wi wi-edit"></i>EDITAR MIS DATOS</button>');
    this.updateUserChrome(user);
    if(!this._resizeBound){window.addEventListener('resize',()=>this.applyResponsiveSidebar());this._resizeBound=true;}
    if(!this._userMenuBound){document.addEventListener('click',e=>{const menu=document.getElementById('userOverlayMenu');if(menu&&!menu.classList.contains('hidden')&&!menu.contains(e.target)&&!e.target.closest('[data-user-trigger]'))this.closeUserOverlay();const campana=document.getElementById('noticeCenterPanel');if(campana&&!campana.classList.contains('hidden')&&!this._clicDentroDeCampana)this.closeNoticeCenter();});/* El panel se cerraba al tocar sus propias pestanas. Motivo: el manejador de arriba corre en burbuja, o sea DESPUES de que setNoticeFilter ya reemplazo el innerHTML del panel; para entonces el boton pulsado ya no esta en el documento y `contains(e.target)` daba falso. Se anota en fase de captura, antes de cualquier repintado, si el clic nacio dentro. */document.addEventListener('click',e=>{this._clicDentroDeCampana=Boolean(e.target?.closest?.('#noticeCenterPanel,#noticeBellBtn'));},true);document.addEventListener('keydown',e=>{if(e.key==='Escape'){this.closeUserOverlay();this.closeProfileEditor();this.closeNoticeCenter();}});NotificationService.center.subscribe(()=>this.refreshNoticeBell());this.refreshNoticeBell();this._userMenuBound=true;} this.navigate(this.activeView);
  },
  availableSections() { const user=UserModel.getCurrentUser(); return UserModel.isGruero(user) ? SECCIONES.filter(s=>['gruero','operacion_inventario'].includes(s.id)) : SECCIONES.filter(s=>!s.roles || UserModel.canAccessGruero(user)); },
  renderNavItems() {
    const groups={}; this.availableSections().forEach(s=>(groups[s.categoria]||=[]).push(s));
    return Object.entries(groups).map(([cat,items])=>`<section class="nav-group ${this.openCategory===cat?'open':''}" data-category="${this.esc(cat)}"><button class="nav-group-toggle" onclick="AppController.toggleCategory('${this.esc(cat)}')"><span>${this.categoryIcon(cat)}</span><b>${this.esc(cat)}</b><i>⌄</i></button><div class="nav-submenu">${items.map(s=>`<button class="nav-item ${this.activeView===s.id?'active':''}" data-id="${s.id}" onclick="AppController.navigate('${s.id}')"><span class="nav-icon">${s.icono}</span><span class="nav-label">${this.esc(s.titulo)}</span></button>`).join('')}</div></section>`).join('');
  },
  categoryIcon(c){return {'Panel de Control':'▦','Mapa de Cámara':'⌖','Operaciones':'⇄','Stock y Lotes':'□','Reportes Operacionales':'▤','Configuración':'⚙'}[c]||'•';},
  refreshNav(){const nav=document.querySelector('.sidebar-nav');if(!nav)return;nav.querySelectorAll('.nav-group').forEach(group=>group.classList.toggle('open',group.dataset.category===this.openCategory));nav.querySelectorAll('.nav-item').forEach(item=>item.classList.toggle('active',item.dataset.id===this.activeView));},
  toggleCategory(cat){if(this.sidebarCollapsed&&!this.isNarrow())this.sidebarCollapsed=false;this.openCategory=this.openCategory===cat?null:cat;this.refreshNav();document.getElementById('mainSidebar')?.classList.toggle('collapsed',this.sidebarCollapsed);},
  toggleSidebar(){if(this.isNarrow()){this.mobileSidebarOpen=!this.mobileSidebarOpen;document.getElementById('mainSidebar')?.classList.toggle('mobile-open',this.mobileSidebarOpen);document.getElementById('sidebarBackdrop')?.classList.toggle('hidden',!this.mobileSidebarOpen);}else{this.sidebarCollapsed=!this.sidebarCollapsed;document.getElementById('mainSidebar')?.classList.toggle('collapsed',this.sidebarCollapsed);}},
  closeSidebarMobile(){this.mobileSidebarOpen=false;document.getElementById('mainSidebar')?.classList.remove('mobile-open');document.getElementById('sidebarBackdrop')?.classList.add('hidden');},
  toggleUserOverlay(event){event?.stopPropagation();const fromSidebar=event?.currentTarget?.classList?.contains('sidebar-user');if(fromSidebar&&this.isNarrow())this.closeSidebarMobile();const menu=document.getElementById('userOverlayMenu');if(!menu)return;const opening=menu.classList.contains('hidden');menu.classList.toggle('hidden',!opening);document.querySelectorAll('[data-user-trigger]').forEach(x=>x.setAttribute('aria-expanded',String(opening)));},
  closeUserOverlay(){document.getElementById('userOverlayMenu')?.classList.add('hidden');document.querySelectorAll('[data-user-trigger]').forEach(x=>x.setAttribute('aria-expanded','false'));},
  /* ==================================================================
   * CENTRO DE NOTIFICACIONES (campana de la cabecera)
   *
   * El globo de aviso dura segundos y se pierde si el operador no está
   * mirando. Acá queda el registro de lo que pasó en la planta, con
   * retención de 3 horas; las alertas de pallet y de calidad se marcan
   * como persistentes y no caducan hasta que alguien las cierra.
   * ================================================================== */
  noticeIcons: { success: 'wi-checkc', info: 'wi-alert', warning: 'wi-alert', error: 'wi-close', offline: 'wi-unlink' },
  noticeFilter: 'todas',   // todas | comunicados | criticas | operaciones
  noticeExpanded: false,
  NOTICE_PREVIEW: 6,

  noticeAge(ts){
    const seg = Math.max(0, Math.round((Date.now() - Number(ts || 0)) / 1000));
    if (seg < 60) return 'Recién';
    const min = Math.round(seg / 60);
    if (min < 60) return `Hace ${min} min`;
    const hr = Math.floor(min / 60);
    return `Hace ${hr} h${min % 60 ? ` ${min % 60} min` : ''}`;
  },
  /** Críticas: lo que exige una acción. Operaciones: el resto del movimiento. */
  noticeIsCritical(x){ return x.type === 'error' || x.type === 'warning' || x.persistent === true; },
  noticeMatches(x){
    if (this.noticeFilter === 'comunicados') return x.origen === 'gerencia';
    if (this.noticeFilter === 'criticas') return this.noticeIsCritical(x);
    if (this.noticeFilter === 'operaciones') return x.origen !== 'gerencia' && !this.noticeIsCritical(x);
    return true;
  },

  renderNoticeCenter(){
    const panel = document.getElementById('noticeCenterPanel');
    if (!panel) return;
    const todas = NotificationService.center.entries();
    const rows = todas.filter(x => this.noticeMatches(x));
    const visibles = this.noticeExpanded ? rows : rows.slice(0, this.NOTICE_PREVIEW);
    const restantes = rows.length - visibles.length;
    const comunicados = todas.filter(x => x.origen === 'gerencia').length;
    const tabs = [['todas', 'Todas'], ['comunicados', `Comunicados${comunicados ? ` (${comunicados})` : ''}`], ['criticas', 'Críticas'], ['operaciones', 'Operaciones']];
    const sinLeer = todas.filter(x => !x.read).length;

    panel.innerHTML = `<header class="notice-head">
        <h2>Notificaciones</h2>
        <div class="notice-head-acciones">
          ${this.puedePublicarComunicado() ? `<button type="button" class="notice-nuevo" onclick="AppController.openComunicado()"><i class="wi wi-edit" aria-hidden="true"></i>Comunicado</button>` : ''}
          ${sinLeer ? `<button type="button" class="notice-mark" onclick="AppController.markNoticesRead()">Marcar leídas</button>` : ''}
        </div>
      </header>
      <nav class="notice-tabs" aria-label="Filtrar notificaciones">${tabs.map(([id, label]) => `<button type="button" class="${this.noticeFilter === id ? 'active' : ''}" onclick="AppController.setNoticeFilter('${id}')">${label}</button>`).join('')}</nav>
      <div class="notice-list">${visibles.length ? visibles.map(x => `<article class="notice-item ${this.esc(x.type)}${x.read ? '' : ' unread'}${x.persistent ? ' pinned' : ''}${x.origen === 'gerencia' ? ' comunicado' : ''}">
          <span class="notice-badge"><i class="wi ${x.origen === 'gerencia' ? 'wi-siren' : (this.noticeIcons[x.type] || 'wi-alert')}" aria-hidden="true"></i></span>
          <div class="notice-body">
            <div class="notice-title"><b>${this.esc(x.title || this.noticeHeading(x.type))}</b><time>${this.esc(this.noticeAge(x.ts))}</time>${x.read ? '' : '<i class="notice-dot" aria-label="Sin leer"></i>'}</div>
            ${x.origen === 'gerencia'
              ? `<div class="notice-rico">${this.limpiarHtmlComunicado(x.cuerpoHtml || this.esc(x.message))}</div>
                 ${x.codigos?.length ? `<div class="notice-codigos">${x.codigos.map(c => `<code>${this.esc(c)}</code>`).join('')}</div>` : ''}
                 <small class="notice-firma">${this.esc(x.area || 'Comunicado')} · ${this.esc(x.autor || '')}${x.vence ? ` · vigente hasta ${this.esc(new Date(x.vence).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' }))}` : ' · sin vencimiento'}</small>`
              : `<p>${this.esc(x.message)}</p>${x.persistent ? '<small>Queda fija hasta resolverse</small>' : ''}`}
          </div>
          <button type="button" class="notice-drop" onclick="AppController.dismissNotice('${this.esc(x.id)}')" aria-label="Quitar aviso"><i class="wi wi-close" aria-hidden="true"></i></button>
        </article>`).join('') : `<div class="notice-empty"><i class="wi wi-bell" aria-hidden="true"></i><b>Sin notificaciones</b><span>${this.noticeFilter === 'todas' ? 'Acá quedan los avisos del sistema durante 3 horas.' : 'No hay avisos en esta categoría.'}</span></div>`}</div>
      ${rows.length ? `<footer class="notice-foot">${restantes > 0
          ? `<button type="button" onclick="AppController.expandNotices()">Ver todas las notificaciones (${restantes} más) <i class="wi wi-right" aria-hidden="true"></i></button>`
          : `<button type="button" class="quiet" onclick="AppController.clearNotices()">Limpiar los vencibles</button>`}</footer>` : ''}`;
  },
  noticeHeading(type){
    return { success: 'Operación completada', info: 'Información', warning: 'Atención', error: 'Error', offline: 'Sin conexión' }[type] || 'Aviso';
  },
  /* ==================================================================
   * COMUNICADOS DE GERENCIA
   *
   * Son el segundo tipo de aviso: no los genera la aplicación, los escribe
   * una persona —Gerencia de Planta, Control de Calidad o Frigorífico—
   * para que le lleguen a todo el equipo. Por eso llevan autor, área,
   * pallets asociados, vigencia propia y texto con formato.
   *
   * ALCANCE REAL: el registro vive en este navegador y se comparte entre
   * las pestañas del mismo equipo. Para que un comunicado salte a OTROS
   * computadores hace falta el adaptador de servidor, que todavía no
   * existe; el formato ya queda listo para ese día.
   * ================================================================== */
  AREAS_COMUNICADO: ['Gerencia de Planta', 'Control de Calidad', 'Frigorífico', 'Operaciones'],
  VIGENCIAS: [['24', '24 horas'], ['72', '3 días'], ['168', '7 días'], ['0', 'Sin vencimiento']],
  PRIORIDADES: [['info', 'Informativa'], ['warning', 'Importante'], ['error', 'Crítica']],
  /* Etiquetas permitidas al guardar. Todo lo demás se descarta: el cuerpo
     lo escribe un usuario y después se pinta en la pantalla de los demás. */
  HTML_PERMITIDO: ['B', 'STRONG', 'I', 'EM', 'U', 'MARK', 'BR', 'P', 'DIV', 'UL', 'OL', 'LI'],

  /** Publicar comunicados es cosa de jefatura y de calidad, no de todos. */
  puedePublicarComunicado(user = UserModel.getCurrentUser()){
    if (!user) return false;
    if (['ADMIN', 'PLANT_MANAGER'].includes(user.accessLevel)) return true;
    const cargo = String(user.role || user.cargo || '').toLocaleLowerCase('es');
    /* Calidad publica por su función. Del resto, sólo jefaturas: "Operador de
       Frigorífico" no debe poder lanzar un comunicado a toda la planta sólo
       porque su cargo contiene la palabra frigorífico. */
    if (/calidad/.test(cargo)) return true;
    return /\b(jefe|jefa|gerente|subgerente|supervisor|supervisora|encargado|encargada)\b/.test(cargo);
  },
  areaSugerida(user = UserModel.getCurrentUser()){
    const cargo = String(user?.role || user?.cargo || '').toLocaleLowerCase('es');
    if (cargo.includes('calidad')) return 'Control de Calidad';
    if (cargo.includes('frigor')) return 'Frigorífico';
    if (/gerente|jefe/.test(cargo)) return 'Gerencia de Planta';
    return 'Operaciones';
  },

  /**
   * Deja sólo el formato permitido. Recorre el árbol y, si encuentra una
   * etiqueta fuera de la lista, la reemplaza por su texto; y borra TODOS
   * los atributos, que es por donde entrarían eventos o estilos ajenos.
   */
  limpiarHtmlComunicado(html){
    const caja = document.createElement('div');
    caja.innerHTML = String(html || '');
    const recorrer = nodo => {
      [...nodo.childNodes].forEach(hijo => {
        if (hijo.nodeType === 3) return;                                  // texto: se conserva
        if (hijo.nodeType !== 1) { hijo.remove(); return; }               // comentarios y demás: fuera
        if (!this.HTML_PERMITIDO.includes(hijo.tagName)) {
          const texto = document.createTextNode(hijo.textContent || '');
          hijo.replaceWith(texto);
          return;
        }
        [...hijo.attributes].forEach(attr => hijo.removeAttribute(attr.name));
        recorrer(hijo);
      });
    };
    recorrer(caja);
    return caja.innerHTML.trim();
  },

  openComunicado(){
    if (!this.puedePublicarComunicado()) return;
    this.closeNoticeCenter();
    document.getElementById('comunicadoModal')?.remove();
    const user = UserModel.getCurrentUser() || {};
    const root = document.createElement('div');
    root.id = 'comunicadoModal';
    root.className = 'comunicado-backdrop';
    root.innerHTML = `<section class="comunicado-dialog" role="dialog" aria-modal="true" aria-labelledby="comunicadoTitulo">
      <header>
        <div><span>COMUNICADO INTERNO</span><h2 id="comunicadoTitulo">Publicar aviso al equipo</h2></div>
        <button type="button" onclick="AppController.closeComunicado()" aria-label="Cerrar"><i class="wi wi-close" aria-hidden="true"></i></button>
      </header>
      <div class="comunicado-body">
        <label class="comunicado-campo wide"><span>Título</span>
          <input id="comTitulo" maxlength="90" placeholder="Ej.: Detención programada de Cámara Proter">
        </label>
        <label class="comunicado-campo"><span>Área que publica</span>
          <select id="comArea">${this.AREAS_COMUNICADO.map(a => `<option ${this.areaSugerida(user) === a ? 'selected' : ''}>${this.esc(a)}</option>`).join('')}</select>
        </label>
        <label class="comunicado-campo"><span>Prioridad</span>
          <select id="comTipo">${this.PRIORIDADES.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select>
        </label>
        <label class="comunicado-campo"><span>Vigencia</span>
          <select id="comVigencia">${this.VIGENCIAS.map(([v, t], i) => `<option value="${v}" ${i === 1 ? 'selected' : ''}>${t}</option>`).join('')}</select>
        </label>
        <div class="comunicado-campo wide">
          <span>Mensaje</span>
          <div class="comunicado-toolbar" role="toolbar" aria-label="Formato del mensaje">
            <button type="button" data-fmt="bold" title="Negrita" aria-label="Negrita"><b>B</b></button>
            <button type="button" data-fmt="italic" title="Cursiva" aria-label="Cursiva"><i>I</i></button>
            <button type="button" data-fmt="underline" title="Subrayado" aria-label="Subrayado"><u>U</u></button>
            <button type="button" data-fmt="hiliteColor" title="Resaltar" aria-label="Resaltar"><mark>H</mark></button>
            <span class="comunicado-sep" aria-hidden="true"></span>
            <button type="button" data-fmt="insertUnorderedList" title="Viñetas" aria-label="Lista con viñetas">••</button>
            <button type="button" data-fmt="insertOrderedList" title="Numeración" aria-label="Lista numerada">1.</button>
            <span class="comunicado-sep" aria-hidden="true"></span>
            <button type="button" data-fmt="removeFormat" title="Quitar formato" aria-label="Quitar formato">Aa</button>
          </div>
          <div id="comCuerpo" class="comunicado-editor" contenteditable="true" role="textbox" aria-multiline="true" data-vacio="Escribí el comunicado. Podés usar negrita, cursiva, subrayado, resaltado y listas."></div>
        </div>
        <label class="comunicado-campo wide"><span>Pallets o lotes asociados (opcional)</span>
          <input id="comCodigos" placeholder="Separados por coma o espacio. Ej.: 263011027001, A-01, PLT-PRO-1000">
        </label>
        <p class="comunicado-nota"><b>Quién lo verá.</b> El comunicado queda visible en la campana de todos los usuarios de este equipo y de sus pestañas abiertas. Para que llegue a otros computadores hace falta el servidor central, que todavía no está conectado.</p>
      </div>
      <footer>
        <span>Publica <b>${this.esc(user.name || 'Usuario')}</b> · ${this.esc(user.role || 'Sin cargo')}</span>
        <div><button type="button" class="comunicado-cancel" onclick="AppController.closeComunicado()">Cancelar</button>
        <button type="button" class="comunicado-enviar" onclick="AppController.publicarComunicado()">Publicar</button></div>
      </footer>
    </section>`;
    document.body.appendChild(root);
    root.addEventListener('click', e => { if (e.target === root) this.closeComunicado(); });
    root.querySelectorAll('.comunicado-toolbar button').forEach(btn => {
      // mousedown y no click: así el editor no pierde la selección al pulsar.
      btn.addEventListener('mousedown', e => {
        e.preventDefault();
        const fmt = btn.dataset.fmt;
        document.getElementById('comCuerpo')?.focus();
        try { document.execCommand(fmt, false, fmt === 'hiliteColor' ? '#fde68a' : null); } catch (_) {}
      });
    });
    document.getElementById('comTitulo')?.focus();
  },
  closeComunicado(){ document.getElementById('comunicadoModal')?.remove(); },

  publicarComunicado(){
    if (!this.puedePublicarComunicado()) return;
    const titulo = document.getElementById('comTitulo')?.value.trim() || '';
    const cuerpo = this.limpiarHtmlComunicado(document.getElementById('comCuerpo')?.innerHTML || '');
    const texto = (document.getElementById('comCuerpo')?.textContent || '').trim();
    if (!titulo) return NotificationService.show('El comunicado necesita un título.', { type: 'warning', store: false });
    if (!texto) return NotificationService.show('El comunicado necesita un mensaje.', { type: 'warning', store: false });
    const horas = Number(document.getElementById('comVigencia')?.value || 72);
    const user = UserModel.getCurrentUser() || {};
    NotificationService.center.publicar({
      titulo,
      resumen: texto.slice(0, 220),
      cuerpoHtml: cuerpo,
      tipo: document.getElementById('comTipo')?.value || 'info',
      area: document.getElementById('comArea')?.value || '',
      autor: user.name || 'Usuario',
      codigos: (document.getElementById('comCodigos')?.value || '').split(/[\s,;]+/).map(x => x.trim()).filter(Boolean),
      vence: horas > 0 ? Date.now() + horas * 60 * 60 * 1000 : null
    });
    this.closeComunicado();
    this.refreshNoticeBell();
    NotificationService.show('Comunicado publicado para el equipo.', { type: 'success', store: false });
  },

  setNoticeFilter(id){ this.noticeFilter = id; this.noticeExpanded = false; this.renderNoticeCenter(); },
  expandNotices(){ this.noticeExpanded = true; this.renderNoticeCenter(); },
  markNoticesRead(){ NotificationService.center.markAllRead(); this.renderNoticeCenter(); this.refreshNoticeBell(); },

  refreshNoticeBell(){
    const btn = document.getElementById('noticeBellBtn'), tag = document.getElementById('noticeBellCount');
    if (!btn || !tag) return;
    const rows = NotificationService.center.entries();
    const n = rows.filter(x => !x.read).length;
    tag.textContent = n > 99 ? '99+' : String(n);
    tag.hidden = n === 0;
    btn.classList.toggle('has-alert', rows.some(x => x.persistent));
    if (!document.getElementById('noticeCenterPanel')?.classList.contains('hidden')) this.renderNoticeCenter();
  },

  toggleNoticeCenter(event){
    event?.stopPropagation();
    this.closeUserOverlay();
    let panel = document.getElementById('noticeCenterPanel');
    if (!panel) {
      panel = document.createElement('aside');
      panel.id = 'noticeCenterPanel';
      panel.className = 'notice-center hidden';
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-label', 'Centro de notificaciones');
      (document.querySelector('.header-actions') || document.body).appendChild(panel);
    }
    const abrir = panel.classList.contains('hidden');
    panel.classList.toggle('hidden', !abrir);
    // Los globos viven en la misma esquina que el panel: mientras el panel
    // esta abierto se ocultan, porque ahi ya esta el registro completo.
    document.body.classList.toggle('notice-center-open', abrir);
    document.getElementById('noticeBellBtn')?.setAttribute('aria-expanded', String(abrir));
    if (abrir) { this.noticeExpanded = false; this.renderNoticeCenter(); }
  },
  closeNoticeCenter(){
    document.getElementById('noticeCenterPanel')?.classList.add('hidden');
    document.body.classList.remove('notice-center-open');
    document.getElementById('noticeBellBtn')?.setAttribute('aria-expanded', 'false');
  },
  dismissNotice(id){ NotificationService.center.remove(id); this.renderNoticeCenter(); this.refreshNoticeBell(); },
  clearNotices(){ NotificationService.center.clearTransient(); this.noticeExpanded = false; this.renderNoticeCenter(); this.refreshNoticeBell(); },


  profileFields(user, formId, modal = false){return `<form id="${formId}" class="user-profile-form" onsubmit="AppController.saveProfile(event,${modal?'true':'false'})" novalidate><div class="user-profile-grid"><label><span>Nombre completo</span><input name="name" value="${this.esc(user.name)}" autocomplete="name" required minlength="3"></label><label><span>Cargo o área</span><input name="role" value="${this.esc(user.role)}" autocomplete="organization-title" required minlength="2"></label><label><span>RUT</span><input name="rut" value="${this.esc(user.rut||'')}" autocomplete="off"></label><label><span>Nueva contraseña</span><input name="password" type="password" autocomplete="new-password" minlength="4" placeholder="Dejar en blanco para conservar"></label></div><p class="user-profile-error" role="alert" hidden></p><div class="user-profile-actions"><button type="button" class="btn-secondary" onclick="${modal?'AppController.closeProfileEditor()':'AppController.logout()'}">${modal?'Cancelar':'Cerrar sesión'}</button><button type="submit" class="btn-primary">Guardar cambios</button></div></form>`;},
  openProfileEditor(){const user=UserModel.getCurrentUser();if(!user)return;this.closeUserOverlay();this.closeProfileEditor();const root=document.createElement('div');root.id='userProfileModal';root.className='user-profile-backdrop';root.innerHTML=`<section class="user-profile-dialog" role="dialog" aria-modal="true" aria-labelledby="userProfileTitle"><header><div><span class="user-avatar">${this.initials(user.name)}</span><div><small>CUENTA PERSONAL</small><h2 id="userProfileTitle">Editar mis datos</h2></div></div><button type="button" onclick="AppController.closeProfileEditor()" aria-label="Cerrar edición de perfil">×</button></header><p>Actualizá únicamente los datos de tu sesión. Los permisos administrativos no se modifican aquí.</p>${this.profileFields(user,'modalProfileForm',true)}</section>`;document.getElementById('appRoot')?.appendChild(root);root.querySelector('input[name=name]')?.focus();},
  closeProfileEditor(){document.getElementById('userProfileModal')?.remove();},
  saveProfile(event,modal=false){event.preventDefault();const form=event.currentTarget,data=new FormData(form),result=UserModel.updateCurrentUserProfile({name:data.get('name'),role:data.get('role'),rut:data.get('rut'),password:data.get('password')});const error=form.querySelector('.user-profile-error');if(!result.ok){error.textContent=result.error;error.hidden=false;return;}error.hidden=true;this.updateUserChrome(result.user);if(modal)this.closeProfileEditor();else this.renderAdministration(document.getElementById('mainViewport'));},
  updateUserChrome(user){const initials=this.initials(user.name);document.querySelectorAll('.user-avatar').forEach(x=>x.textContent=initials);const sidebar=document.querySelector('.sidebar-user .user-info');if(sidebar){sidebar.querySelector('strong').textContent=user.name;sidebar.querySelector('small').textContent=user.role;}const header=document.querySelector('.header-user>div:last-child');if(header){header.querySelector('b').textContent=user.name;header.querySelector('span').textContent=user.role;}const overlay=document.getElementById('userOverlayMenu');if(overlay){const identity=overlay.querySelector('header>div:nth-child(2)');if(identity){identity.querySelector('strong').textContent=user.name;identity.querySelector('span').textContent=user.role;}let rut=overlay.querySelector(':scope>p');if(user.rut){if(!rut){rut=document.createElement('p');overlay.querySelector('header')?.after(rut);}rut.textContent=`RUT ${user.rut}`;}else rut?.remove();}},
  renderAdministration(viewport){const user=UserModel.getCurrentUser(),canManage=UserModel.canManageUsers(user);viewport.innerHTML=`<section class="user-settings-view">${DashboardController.operationalHeader({eyebrow:'CONFIGURACIÓN',title:'Administración de Usuarios',status:canManage?'Cuenta, sesión y administración autorizada':'Cuenta, sesión y preferencias personales'})}<div class="user-settings-layout"><article class="user-settings-card identity"><span class="user-avatar large">${this.initials(user.name)}</span><div><small>USUARIO ACTIVO</small><h2>${this.esc(user.name)}</h2><p>${this.esc(user.role)}</p>${user.rut?`<span>RUT ${this.esc(user.rut)}</span>`:''}<span class="identity-access">🛡 ${this.esc(UserModel.accessLabel(user))}</span></div></article><article class="user-settings-card"><div class="settings-card-head"><div><small>PERFIL PERSONAL</small><h2>Modificar mis datos</h2></div><span class="session-live"><i></i> Sesión activa</span></div>${this.profileFields(user,'settingsProfileForm',false)}</article></div>${canManage?'<div id="userAdminMount"></div>':''}</section>`;if(canManage)UserAdminController.init(document.getElementById('userAdminMount'));DashboardController.startOperationalClock();},
  applyResponsiveSidebar(){if(!this.isNarrow())this.closeSidebarMobile();},
  mountShellDecor(theme){
    const main=document.querySelector('.main-content');
    if(main&&!main.querySelector('.dashboard-top-banner'))main.insertAdjacentHTML('afterbegin','<div class="dashboard-top-banner" aria-hidden="true"></div>');
    const actions=document.querySelector('.header-actions');
    if(actions&&!document.getElementById('themeToggle'))actions.insertAdjacentHTML('afterbegin',`<button type="button" id="themeToggle" class="header-theme-toggle" onclick="AppController.toggleTheme()" title="Cambiar a tema ${theme==='light'?'oscuro':'claro'}" aria-label="Cambiar a tema ${theme==='light'?'oscuro':'claro'}"><span id="themeIcon" aria-hidden="true">${theme==='light'?'☀️':'🌙'}</span></button>`);
  },
  toggleTheme(){const light=document.body.classList.toggle('dashboard-light');const theme=light?'light':'dark';localStorage.setItem('wms_web_dashboard_theme',theme);const next=light?'oscuro':'claro',i=document.getElementById('themeIcon'),button=document.getElementById('themeToggle');if(i)i.textContent=light?'☀️':'🌙';if(button){button.title=`Cambiar a tema ${next}`;button.setAttribute('aria-label',`Cambiar a tema ${next}`);}},
  syncTurn(){const viewport=document.getElementById('mainViewport');this.navigate(this.activeView);const btn=document.querySelector('.sync-button');if(btn){btn.classList.add('synced');setTimeout(()=>btn.classList.remove('synced'),800);}},
  navigate(sectionId) {
    const sec=this.availableSections().find(s=>s.id===sectionId)||this.availableSections()[0]; if(!sec)return; if(sec.id!=='dashboard')clearInterval(DashboardController.resumenClockTimer); this.closeUserOverlay(); this.activeView=sec.id; this.openCategory=sec.categoria;
    const title=document.getElementById('sectionTitle');if(title){title.textContent=sec.categoria;title.title=sec.categoria;}this.refreshNav();if(this.isNarrow())this.closeSidebarMobile();
    const viewport=document.getElementById('mainViewport');if(!viewport)return;viewport.scrollTop=0;
    switch(sec.id){
      case'dashboard':case'graficos':case'monitor_tiempo_real':DashboardController.init(viewport,sec.id);break;
      case'gruero':GrueroController.init(viewport);break;
      case'operacion_inventario':InventoryOperationController.init(viewport);break;
      case'bitacora':BitacoraController.initBitacora(viewport);break;case'registro_verificaciones':BitacoraController.initVerificaciones(viewport);break;
      case'mapa_vista':MapaController.init(viewport,'PROTER');break;case'mapa_postunel':MapaController.init(viewport,'POST TUNEL');break;case'mapa_codigo':MapaController.initCodigo(viewport);break;case'inventario':MapaController.initInventario(viewport);break;
      case'stock_planta':StockController.initStockPlanta(viewport);break;case'lote_detallado':StockController.initLoteDetallado(viewport);break;case'centro_etiquetas':LabelController.init(viewport);break;case'anden_carga':AndenController.init(viewport);break;case'movimientos':OperacionesController.initMovimientos(viewport);break;case'despacho':OperacionesController.initDespacho(viewport);break;case'aprobaciones':OperacionesController.initAprobaciones(viewport);break;case'generar_reporte':ReportesController.initGenerarReporte(viewport);break;case'visualizar_stock':ReportesController.initVisualizarStock(viewport);break;
      case'administracion':this.renderAdministration(viewport);break;default:DashboardController.init(viewport,'dashboard');
    }
  },
  logout(){this.closeUserOverlay();UserModel.clearSession();this.showAuthView();}
};
