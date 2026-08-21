/**
 * Login WMS_WEB.
 *
 * MIGRACIÓN CONTROLADA
 * --------------------------------------------------------------------
 * La composición visual se conserva. Sólo cambia el contrato de datos:
 * - modo local (SUPABASE_CONFIG.HABILITADO=false): sigue usando UserModel;
 * - modo remoto: correo + contraseña -> Supabase Auth -> wms_sesion_actual().
 *
 * Esto permite probar cada sección sin obligar a migrar toda la aplicación
 * en un solo despliegue.
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

  backendActivo() {
    return typeof SUPABASE_CONFIG !== 'undefined' && SUPABASE_CONFIG.listo();
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
        <p class="auth-state-intro">Ingresá tus credenciales para acceder al panel de control.</p>

        <form id="wmsLoginForm" onsubmit="AuthController.handleLogin(event)" novalidate>
          <div class="form-group">
            <label for="wmsLoginEmail">Correo electrónico</label>
            <div class="auth-input-wrap">
              <span class="auth-input-icon" aria-hidden="true">✉</span>
              <input type="email" id="wmsLoginEmail" class="form-control auth-control" placeholder="nombre@empresa.cl" autocomplete="username" aria-describedby="wmsLoginError">
            </div>
          </div>

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

    requestAnimationFrame(() => {
      (this.backendActivo()
        ? document.getElementById('wmsLoginEmail')
        : document.getElementById('wmsLoginPass'))?.focus();
    });
  },

  showRecovery() {
    this.clearLoadingTimers();
    const panel = this.getPanel();
    panel.innerHTML = `
      <div class="auth-state auth-state-form">
        <h2 id="authTitle">Recuperar contraseña</h2>
        <p class="auth-state-intro">Ingresá el correo asociado a tu cuenta WMS.</p>

        <form id="wmsRecoveryForm" onsubmit="AuthController.handleRecovery(event)" novalidate>
          <div class="form-group">
            <label for="recoveryEmail">Correo electrónico</label>
            <div class="auth-input-wrap">
              <span class="auth-input-icon" aria-hidden="true">✉</span>
              <input type="email" id="recoveryEmail" class="form-control auth-control" placeholder="nombre@empresa.cl" autocomplete="email">
            </div>
          </div>

          <p id="wmsRecoveryError" class="auth-inline-message auth-error" role="alert" hidden></p>

          <div class="auth-actions auth-actions-recovery">
            <button type="submit" class="btn-primary auth-submit">Recuperar acceso <span aria-hidden="true">↗</span></button>
            <button type="button" class="auth-link auth-back-link" onclick="AuthController.showLogin()">← Volver al inicio de sesión</button>
          </div>
        </form>
      </div>
    `;
    requestAnimationFrame(() => document.getElementById('recoveryEmail')?.focus());
  },

  async handleLogin(event) {
    event.preventDefault();
    const emailInput = document.getElementById('wmsLoginEmail');
    const passInput = document.getElementById('wmsLoginPass');
    const error = document.getElementById('wmsLoginError');
    const submit = event.currentTarget?.querySelector('.auth-submit');
    const email = String(emailInput?.value || '').trim();
    const password = String(passInput?.value || '');

    const puerta = SeguridadService.puedeIntentar();
    if (!puerta.permitido) {
      error.textContent = `Demasiados intentos fallidos. Espere ${puerta.esperaSeg} segundo${puerta.esperaSeg === 1 ? '' : 's'}.`;
      error.hidden = false;
      passInput?.classList.add('is-invalid');
      if (passInput) passInput.value = '';
      return;
    }

    if (this.backendActivo()) {
      const emailValido = Boolean(email && email.includes('@'));
      const passValida = Boolean(password);
      emailInput?.classList.toggle('is-invalid', !emailValido);
      passInput?.classList.toggle('is-invalid', !passValida);
      if (!emailValido || !passValida) {
        error.textContent = !emailValido ? 'Ingresá un correo electrónico válido.' : 'Ingresá tu contraseña.';
        error.hidden = false;
        (!emailValido ? emailInput : passInput)?.focus();
        return;
      }

      if (submit) submit.disabled = true;
      const result = await SupabaseService.ingresar(email, password);
      if (submit) submit.disabled = false;

      if (!result.ok || !result.usuario) {
        SeguridadService.registrarFallo();
        error.textContent = result.error || 'No fue posible iniciar sesión.';
        error.hidden = false;
        emailInput?.classList.add('is-invalid');
        passInput?.classList.add('is-invalid');
        if (passInput) passInput.value = '';
        passInput?.focus();
        return;
      }

      error.hidden = true;
      emailInput?.classList.remove('is-invalid');
      passInput?.classList.remove('is-invalid');
      SeguridadService.reiniciarIntentos();
      this.pendingUser = result.usuario;

      // Cache de presentación temporal. La autorización real sigue en RLS/RPC.
      UserModel.setCurrentUser(result.usuario);
      this.showLoading();
      return;
    }

    // Modo local transitorio: mantiene la autenticación histórica por clave.
    // El nuevo input de correo ya está presente, pero no se exige hasta activar
    // Supabase para no romper las cuentas locales de desarrollo actuales.
    const user = UserModel.findUserByPass(password);
    if (!user) {
      SeguridadService.registrarFallo();
      error.textContent = 'Contraseña incorrecta';
      error.hidden = false;
      passInput?.classList.add('is-invalid');
      if (passInput) passInput.value = '';
      passInput?.focus();
      return;
    }

    error.hidden = true;
    passInput?.classList.remove('is-invalid');
    this.pendingUser = user;
    SeguridadService.reiniciarIntentos();
    SeguridadService.marcarInicioSesion();
    UserModel.setCurrentUser(user);
    this.showLoading();
  },

  async handleRecovery(event) {
    event.preventDefault();
    const emailInput = document.getElementById('recoveryEmail');
    const error = document.getElementById('wmsRecoveryError');
    const submit = event.currentTarget?.querySelector('.auth-submit');
    const email = String(emailInput?.value || '').trim();
    const valido = Boolean(email && email.includes('@'));

    emailInput?.classList.toggle('is-invalid', !valido);
    if (!valido) {
      error.textContent = 'Ingresá un correo electrónico válido.';
      error.hidden = false;
      emailInput?.focus();
      return;
    }

    if (!this.backendActivo()) {
      error.hidden = true;
      this.showRecoverySent(email, false);
      return;
    }

    if (submit) submit.disabled = true;
    const result = await SupabaseService.recuperarPassword(email);
    if (submit) submit.disabled = false;

    if (!result.ok) {
      error.textContent = result.error || 'No fue posible procesar la recuperación.';
      error.hidden = false;
      return;
    }

    error.hidden = true;
    this.showRecoverySent(email, true);
  },

  showRecoverySent(email, enviado) {
    this.getPanel().innerHTML = `
      <div class="auth-state auth-state-center auth-state-success">
        <div class="auth-success-icon" aria-hidden="true">✓</div>
        <h2 id="authTitle">${enviado ? 'Revisá tu correo' : 'Recuperación preparada'}</h2>
        <p>${enviado
          ? `Si existe una cuenta asociada a <strong>${this.escapeHtml(email)}</strong>, recibirá las instrucciones para restablecer su contraseña.`
          : 'El flujo de recuperación ya está preparado para Supabase. Se activará junto con el backend del Login.'}</p>
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
    this.queueLoadingStep(620, 55, 'Verificando sesión...', this.backendActivo() ? 'Validando identidad y rol WMS' : (navigator.onLine ? 'Conexión verificada' : 'Modo local (sin red)'));
    this.queueLoadingStep(980, 80, 'Cargando entorno...', this.backendActivo() ? 'Aplicando permisos del backend' : 'Sincronizando inventario');
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
    return SeguridadService.escaparHtml(value);
  }
};
