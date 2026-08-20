/**
 * Login WMS_WEB.
 * Replica el flujo del login de Programa MVC y conserva la arquitectura
 * de controlador + modelo que ya utiliza este proyecto web.
 */
const AuthController = {
  container: null,
  pendingUser: null,
  theme: 'dark',
  loadingTimers: [],

  BRAND: {
    empresa: 'Frigorífico Olmué',
    sistema: 'Sistema Frigorífico Parral',
    componente: 'Componente Administrador',
    titulo: 'Gestión logística en frío,<br><span class="auth-title-accent">en tiempo real</span>',
    descripcion: 'Controlá cámaras, inventario y despacho desde un solo lugar. Rápido, claro y siempre sincronizado.',
    pieSeguridad: 'Acceso seguro · Sistema Frigorífico Parral'
  },

  init(containerElement) {
    this.container = containerElement;
    this.pendingUser = null;
    this.theme = localStorage.getItem('wms_web_dashboard_theme') === 'light' ? 'light' : 'dark';
    document.body.classList.toggle('dashboard-light', this.theme === 'light');
    this.clearLoadingTimers();
    this.renderShell();
    this.showLogin();
  },

  renderShell() {
    this.container.innerHTML = `
      <main class="auth-view-wrapper auth-theme-${this.theme}" aria-labelledby="authTitle">
        <div class="auth-top-background-banner" aria-hidden="true"></div>
        <section class="auth-card-container">
          <aside class="auth-banner-side" aria-label="Identidad del sistema">
            <span class="auth-orb auth-orb-one" aria-hidden="true"></span>
            <span class="auth-orb auth-orb-two" aria-hidden="true"></span>

            <div class="auth-brand-header">
              <span class="auth-snowflake" aria-hidden="true">❄</span>
              <strong>${this.BRAND.empresa}</strong>
            </div>

            <div class="auth-brand-main">
              <div class="auth-logo-frame">
                <img src="assets/logo.png" alt="Logo Frigorífico Olmué" class="auth-hero-logo">
              </div>
              <h1>${this.BRAND.titulo}</h1>
              <p>${this.BRAND.descripcion}</p>
            </div>

            <div class="auth-metrics" aria-label="Resumen del sistema">
              <div><strong>2</strong><span>cámaras</span></div>
              <i aria-hidden="true"></i>
              <div><strong>24/7</strong><span>operativo</span></div>
            </div>
          </aside>

          <section class="auth-form-side">
            <header class="auth-panel-top">
              <button type="button" class="auth-theme-toggle" onclick="AuthController.toggleTheme()" aria-label="Cambiar a modo ${this.theme === 'dark' ? 'claro' : 'oscuro'}">
                <span class="auth-theme-icon" aria-hidden="true">${this.theme === 'light' ? '☀️' : '🌙'}</span>
                <span class="auth-theme-label">Modo ${this.theme === 'light' ? 'Claro' : 'Oscuro'}</span>
              </button>
            </header>

            <div id="authPanelContent" class="auth-panel-content" aria-live="polite"></div>

            <footer class="auth-security-footer">
              <span aria-hidden="true">◇</span>
              <span>${this.BRAND.pieSeguridad}</span>
            </footer>
          </section>
        </section>
      </main>
    `;
  },

  showLogin() {
    this.clearLoadingTimers();
    const panel = this.getPanel();
    panel.innerHTML = `
      <div class="auth-state auth-state-form">
        <h2 id="authTitle">Bienvenido de vuelta</h2>
        <p class="auth-state-intro">Ingresá tu contraseña para acceder al panel de control.</p>

        <form id="wmsLoginForm" onsubmit="AuthController.handleLogin(event)" novalidate>
          <div class="form-group">
            <label for="wmsLoginPass">Contraseña de acceso</label>
            <div class="auth-input-wrap">
              <span class="auth-input-icon" aria-hidden="true">🔒</span>
              <input type="password" id="wmsLoginPass" class="form-control auth-control" placeholder="Contraseña de acceso" autocomplete="current-password" aria-describedby="wmsLoginError">
              <button type="button" class="auth-password-toggle" onclick="AuthController.togglePassword(this)" aria-label="Mostrar contraseña">👁</button>
            </div>
          </div>

          <p id="wmsLoginError" class="auth-inline-message auth-error" role="alert" hidden></p>

          <div class="auth-actions">
            <button type="submit" class="btn-primary auth-submit">Iniciar sesión <span aria-hidden="true">→</span></button>
            <button type="button" class="auth-link" onclick="AuthController.showRecovery()">¿Olvidaste tu contraseña?</button>
          </div>
        </form>
      </div>
    `;
    requestAnimationFrame(() => document.getElementById('wmsLoginPass')?.focus());
  },

  showRecovery() {
    this.clearLoadingTimers();
    const panel = this.getPanel();
    panel.innerHTML = `
      <div class="auth-state auth-state-form">
        <h2 id="authTitle">Recuperar contraseña</h2>
        <p class="auth-state-intro">Ingresá tus datos y un administrador te ayudará a restablecer el acceso.</p>

        <form id="wmsRecoveryForm" onsubmit="AuthController.handleRecovery(event)" novalidate>
          <div class="form-group">
            <label for="recoveryName">Nombre completo</label>
            <div class="auth-input-wrap">
              <span class="auth-input-icon" aria-hidden="true">👤</span>
              <input type="text" id="recoveryName" class="form-control auth-control" placeholder="Nombre completo" autocomplete="name">
            </div>
          </div>
          <div class="form-group">
            <label for="recoveryRole">Cargo o área</label>
            <div class="auth-input-wrap">
              <span class="auth-input-icon" aria-hidden="true">🪪</span>
              <input type="text" id="recoveryRole" class="form-control auth-control" placeholder="Cargo o área" autocomplete="organization-title">
            </div>
          </div>

          <p id="wmsRecoveryError" class="auth-inline-message auth-error" role="alert" hidden></p>

          <div class="auth-actions auth-actions-recovery">
            <button type="submit" class="btn-primary auth-submit">Enviar solicitud <span aria-hidden="true">↗</span></button>
            <button type="button" class="auth-link auth-back-link" onclick="AuthController.showLogin()">← Volver al inicio de sesión</button>
          </div>
        </form>
      </div>
    `;
    requestAnimationFrame(() => document.getElementById('recoveryName')?.focus());
  },

  handleLogin(event) {
    event.preventDefault();
    const input = document.getElementById('wmsLoginPass');
    const error = document.getElementById('wmsLoginError');
    const password = input.value;

    /* Freno progresivo. Hoy la contraseña es ademas el identificador, asi que
       probar claves al azar identifica usuarios: a partir del quinto fallo se
       obliga a esperar, duplicando la espera cada vez. Media hora sin fallar y
       el contador vuelve a cero. */
    const puerta = SeguridadService.puedeIntentar();
    if (!puerta.permitido) {
      error.textContent = `Demasiados intentos fallidos. Espere ${puerta.esperaSeg} segundo${puerta.esperaSeg === 1 ? '' : 's'}.`;
      error.hidden = false;
      input.classList.add('is-invalid');
      input.value = '';
      return;
    }

    const user = UserModel.findUserByPass(password);

    if (!user) {
      SeguridadService.registrarFallo();
      error.textContent = 'Contraseña incorrecta';
      error.hidden = false;
      input.classList.add('is-invalid');
      input.value = '';
      input.focus();
      return;
    }

    error.hidden = true;
    input.classList.remove('is-invalid');
    this.pendingUser = user;
    /* Entrada correcta: se limpia el contador de fallos y arranca el reloj
       de vigencia de la sesion. */
    SeguridadService.reiniciarIntentos();
    SeguridadService.marcarInicioSesion();
    UserModel.setCurrentUser(user);
    this.showLoading();
  },

  handleRecovery(event) {
    event.preventDefault();
    const nameInput = document.getElementById('recoveryName');
    const roleInput = document.getElementById('recoveryRole');
    const error = document.getElementById('wmsRecoveryError');
    const name = nameInput.value.trim();
    const role = roleInput.value.trim();

    nameInput.classList.toggle('is-invalid', !name);
    roleInput.classList.toggle('is-invalid', !role);

    if (!name || !role) {
      error.textContent = 'Completá nombre y cargo/área.';
      error.hidden = false;
      (!name ? nameInput : roleInput).focus();
      return;
    }

    this.showRecoverySent(name, role);
  },

  showRecoverySent(name, role) {
    this.getPanel().innerHTML = `
      <div class="auth-state auth-state-center auth-state-success">
        <div class="auth-success-icon" aria-hidden="true">✓</div>
        <h2 id="authTitle">¡Solicitud enviada!</h2>
        <p>Se notificó al administrador sobre el requerimiento de <strong>${this.escapeHtml(name)}</strong> (${this.escapeHtml(role)}).</p>
        <button type="button" class="btn-primary auth-submit auth-success-button" onclick="AuthController.showLogin()">Entendido</button>
      </div>
    `;
  },

  showLoading() {
    this.getPanel().innerHTML = `
      <div class="auth-state auth-state-center">
        <div class="auth-spinner" aria-hidden="true"></div>
        <h2 id="authTitle" class="auth-loading-title">Iniciando sesión...</h2>
        <div class="auth-progress-track" role="progressbar" aria-label="Carga del entorno" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
          <span class="auth-progress-bar"></span>
        </div>
        <p class="auth-loading-step"></p>
      </div>
    `;

    this.queueLoadingStep(180, 30, 'Verificando conexión...', 'Comprobando acceso a la red');
    this.queueLoadingStep(620, 55, 'Verificando conexión...', navigator.onLine ? 'Conexión verificada' : 'Modo local (sin red)');
    this.queueLoadingStep(980, 80, 'Cargando entorno...', 'Sincronizando inventario');
    this.queueLoadingStep(1330, 95, 'Cargando entorno...', 'Cargando módulos de seguridad');
    this.queueLoadingStep(1650, 100, 'Cargando entorno...', 'Carga completada');
    this.loadingTimers.push(setTimeout(() => this.showReady(), 1850));
  },

  queueLoadingStep(delay, progress, title, step) {
    this.loadingTimers.push(setTimeout(() => {
      const progressBar = this.container?.querySelector('.auth-progress-bar');
      const progressTrack = this.container?.querySelector('.auth-progress-track');
      const titleNode = this.container?.querySelector('.auth-loading-title');
      const stepNode = this.container?.querySelector('.auth-loading-step');
      if (!progressBar || !progressTrack || !titleNode || !stepNode) return;
      progressBar.style.width = `${progress}%`;
      progressTrack.setAttribute('aria-valuenow', String(progress));
      titleNode.textContent = title;
      stepNode.textContent = step;
    }, delay));
  },

  showReady() {
    this.getPanel().innerHTML = `
      <div class="auth-state auth-state-center auth-state-success">
        <div class="auth-success-icon" aria-hidden="true">✓</div>
        <h2 id="authTitle">¡Entorno listo!</h2>
        <p>Abriendo el panel...</p>
      </div>
    `;
    this.loadingTimers.push(setTimeout(() => {
      if (this.pendingUser) AppController.onLoginSuccess(this.pendingUser);
    }, 500));
  },

  togglePassword(button) {
    const input = document.getElementById('wmsLoginPass');
    if (!input) return;
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    button.textContent = show ? '🙈' : '👁';
    button.setAttribute('aria-label', show ? 'Ocultar contraseña' : 'Mostrar contraseña');
    input.focus();
  },

  toggleTheme() {
    this.theme = this.theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('wms_web_dashboard_theme', this.theme);
    document.body.classList.toggle('dashboard-light', this.theme === 'light');
    const wrapper = this.container?.querySelector('.auth-view-wrapper');
    if (!wrapper) return;
    wrapper.classList.toggle('auth-theme-dark', this.theme === 'dark');
    wrapper.classList.toggle('auth-theme-light', this.theme === 'light');
    wrapper.querySelector('.auth-theme-icon').textContent = this.theme === 'dark' ? '🌙' : '☀️';
    wrapper.querySelector('.auth-theme-label').textContent = this.theme === 'dark' ? 'Modo Oscuro' : 'Modo Claro';
    wrapper.querySelector('.auth-theme-toggle')?.setAttribute('aria-label', `Cambiar a modo ${this.theme === 'dark' ? 'claro' : 'oscuro'}`);
  },

  getPanel() {
    return document.getElementById('authPanelContent');
  },

  clearLoadingTimers() {
    this.loadingTimers.forEach(clearTimeout);
    this.loadingTimers = [];
  },

  escapeHtml(value) {
    const element = document.createElement('span');
    element.textContent = value;
    return element.innerHTML;
  }
};
