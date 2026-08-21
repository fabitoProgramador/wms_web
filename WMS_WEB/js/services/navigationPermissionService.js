/**
 * Aplica a la navegación los permisos declarados en SECCIONES.
 *
 * Es un adaptador transversal pequeño: conserva las reglas existentes de
 * AppController.availableSections() (incluido Gruero) y únicamente descarta
 * secciones cuyo `permiso` no figure en la sesión validada por Supabase.
 */
const NavigationPermissionService = {
  install(controller) {
    if (!controller || controller.__wmsPermissionNavigationInstalled) return;
    const original = controller.availableSections.bind(controller);
    controller.availableSections = () => {
      const user = UserModel.getCurrentUser();
      return original().filter(section => !section.permiso || UserModel.hasPermission(section.permiso, user));
    };
    controller.__wmsPermissionNavigationInstalled = true;
  }
};
