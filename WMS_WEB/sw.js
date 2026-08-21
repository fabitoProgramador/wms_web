/* Shell offline específico del módulo Mapa y dependencias necesarias para arrancarlo. */
const CACHE='wms-map-shell-v118';
const CORE=[
  './','./index.html','./assets/logo.png','./assets/icono.ico',
  './css/main.css','./css/components.css','./css/dashboard.css','./css/gruero.css','./css/inventory-operation.css','./css/mapa-2d5.css','./css/labels.css','./css/responsive.css','./css/theme-system.css',
  './js/config/almacenes.js','./js/config/identidadPlanta.js','./js/config/turnos.js','./js/config/catalogo.js','./js/config/estados.js','./js/config/mapaConfig.js','./js/config/destinosAnden.js','./js/config/navegacion.js','./js/config/supabaseConfig.js',
  './js/services/seguridadService.js','./js/services/supabaseService.js','./js/services/backendBootstrapService.js','./js/services/notificationService.js','./js/services/cameraScannerService.js','./js/services/undoService.js','./js/services/exportService.js','./js/services/grueroCodeResolver.js','./js/services/mapaOfflineService.js','./js/services/inventoryOperationService.js','./js/services/labelFormatService.js','./js/services/zebraPrintService.js','./js/services/labelService.js',
  './js/models/userModel.js','./js/models/palletModel.js','./js/models/mapaModel.js','./js/models/panelControlModel.js','./js/models/stockModel.js','./js/models/labelHistoryModel.js','./js/models/inventoryOperationModel.js',
  './js/views/renderers/pixiMapVisualLayer.js','./js/views/renderers/mapaIsometricRenderer.js','./js/views/renderers/mapa2DRenderer.js','./js/views/renderers/mapa1DRenderer.js','./js/views/components/palletDrawer.js','./js/views/components/palletLabelTemplate.js','./js/views/components/cameraHUD.js',
  './js/controllers/authController.js','./js/controllers/dashboardController.js','./js/controllers/mapaController.js','./js/controllers/andenController.js','./js/controllers/grueroController.js','./js/controllers/inventoryOperationController.js','./js/controllers/stockController.js','./js/controllers/labelController.js','./js/controllers/appController.js'
];
const OPTIONAL=['https://cdn.jsdelivr.net/npm/pixi.js@7.4.2/dist/pixi.min.js'];
self.addEventListener('install',event=>event.waitUntil((async()=>{const cache=await caches.open(CACHE);await cache.addAll(CORE);await Promise.allSettled(OPTIONAL.map(url=>cache.add(url)));await self.skipWaiting();})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{const keys=await caches.keys();await Promise.all(keys.filter(key=>(key.startsWith('wms-map-shell-')||key.startsWith('wms-gruero-shell-'))&&key!==CACHE).map(key=>caches.delete(key)));await self.clients.claim();})()));
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url),sameOrigin=url.origin===self.location.origin;
  if(event.request.mode==='navigate')return event.respondWith(fetch(event.request).then(response=>{const shell=url.pathname.endsWith('/')||url.pathname.endsWith('/index.html');if(shell){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put('./index.html',copy));}return response;}).catch(()=>caches.match('./index.html',{ignoreSearch:true})));
  if(!sameOrigin&&!OPTIONAL.includes(url.href))return;
  event.respondWith(caches.match(event.request,{ignoreSearch:sameOrigin}).then(cached=>{const network=fetch(event.request).then(response=>{if(response.ok||response.type==='opaque')caches.open(CACHE).then(cache=>cache.put(event.request,response.clone()));return response;}).catch(()=>cached);return cached||network;}));
});
