/* Capa visual PixiJS para el visor 2.5D. Consume geometría del DOM, no reglas. */
class PixiMapVisualLayer {
  constructor(host) {
    this.host = host; this.app = null; this.staticLayer = null; this.palletLayer = null; this.pallets = new Map(); this.frame = 0; this.lastGeometryScale = 1;
    if (!window.PIXI || !host) return;
    try {
      this.app = new PIXI.Application({ width: 1, height: 1, backgroundAlpha: 0, antialias: true, autoDensity: true, roundPixels: true, resolution: Math.min(window.devicePixelRatio || 1, 2) });
      this.app.renderer.roundPixels = true;
      this.app.view.className = 'pixi-map-canvas'; this.layer = document.createElement('div'); this.layer.className = 'pixi-map-visual-layer'; this.layer.appendChild(this.app.view); host.prepend(this.layer);
      this.staticLayer = new PIXI.Graphics(); this.palletLayer = new PIXI.Container(); this.app.stage.addChild(this.staticLayer, this.palletLayer);
      this.resizeObserver = new ResizeObserver(() => this.schedule(true)); this.resizeObserver.observe(host); host.addEventListener('click', () => this.schedule(false)); this.schedule(true);
    } catch (error) { console.warn('PixiJS no pudo inicializar la capa 2.5D.', error); this.destroy(); }
  }
  geometryScale(base) {
    // CSS zoom modifica getBoundingClientRect(), pero no el tamaño lógico del
    // canvas. Normalizamos ambas referencias para no mezclar coordenadas físicas
    // con coordenadas CSS y dejar residuos de la escena anterior.
    const logicalWidth = this.host.offsetWidth || this.host.scrollWidth || 1;
    return Math.max(.01, base.width / logicalWidth);
  }
  rect(element, base, scale = 1) { const r = element.getBoundingClientRect(); return { x:Math.round((r.left-base.left)/scale), y:Math.round((r.top-base.top)/scale), w:Math.max(1,Math.round(r.width/scale)), h:Math.max(1,Math.round(r.height/scale)) }; }
  color(value, fallback=0x38bdf8) { const n = Number.parseInt(String(value || '').replace('#',''), 16); return Number.isFinite(n) ? n : fallback; }
  schedule(staticScene=false) { if (!this.app) return; this.needsStatic ||= staticScene; if (this.frame) return; this.frame = requestAnimationFrame(() => { this.frame=0; this.draw(Boolean(this.needsStatic)); this.needsStatic=false; }); }
  setZoom() { this.schedule(true); }
  draw(rebuildStatic) {
    if (!this.app || !this.host.isConnected) return; const width=Math.max(1,Math.ceil(this.host.scrollWidth)), height=Math.max(1,Math.ceil(this.host.scrollHeight));
    if (this.app.renderer.width !== width || this.app.renderer.height !== height) { this.app.renderer.resize(width,height); rebuildStatic=true; }
    const base=this.host.getBoundingClientRect(), scale=this.geometryScale(base); if (Math.abs(scale-this.lastGeometryScale)>.001) rebuildStatic=true; this.lastGeometryScale=scale; if (rebuildStatic) this.drawStatic(base,width,height,scale); const alive=new Set();
    this.host.querySelectorAll('.iso-slot').forEach(cell => { const key=cell.dataset.slotKey; alive.add(key); const r=this.rect(cell,base,scale), signature=`${cell.dataset.palletId||''}|${cell.style.getPropertyValue('--slot-color')}|${cell.classList.contains('selected')}|${cell.classList.contains('pending-sync')}|${r.x}|${r.y}|${r.w}|${r.h}`; const entry=this.pallets.get(key); if(entry?.signature===signature)return; const graphic=entry?.graphic||new PIXI.Graphics(); if(!entry){this.palletLayer.addChild(graphic);this.pallets.set(key,{graphic,signature});}else entry.signature=signature; this.drawPallet(graphic,cell,r); });
    this.pallets.forEach((entry,key)=>{if(!alive.has(key)){entry.graphic.destroy();this.pallets.delete(key);}});
  }
  drawStatic(base,width,height,scale) { const g=this.staticLayer; g.clear(); g.beginFill(0x071018,.18).drawRect(0,0,width,height).endFill(); this.host.querySelectorAll('.iso-rack-band,.iso-floor-band').forEach(band=>{const r=this.rect(band,base,scale);g.lineStyle(2,0x607786,.72).drawRoundedRect(r.x+2,r.y+2,Math.max(1,r.w-4),Math.max(1,r.h-4),6);g.lineStyle(1,0xb6c6cf,.18).moveTo(r.x+5,r.y+8).lineTo(r.x+r.w-5,r.y+8);g.lineStyle(2,0x273b49,.85).moveTo(r.x+5,r.y+r.h-4).lineTo(r.x+r.w-3,r.y+r.h-4);}); this.host.querySelectorAll('.iso-transit-aisle,.iso-pair-aisle').forEach(aisle=>{const r=this.rect(aisle,base,scale);g.beginFill(0x0d1e29,.34).drawRect(r.x,r.y,r.w,r.h).endFill();g.lineStyle(1,0xf5b82d,.62).moveTo(r.x+2,r.y+2).lineTo(r.x+r.w-2,r.y+2).moveTo(r.x+2,r.y+r.h-2).lineTo(r.x+r.w-2,r.y+r.h-2);}); }
  drawPallet(g,cell,r) { g.clear(); if(!cell.classList.contains('occupied'))return; const color=this.color(cell.style.getPropertyValue('--slot-color')), selected=cell.classList.contains('selected'),pending=cell.classList.contains('pending-sync'); g.beginFill(0x000000,.32).drawRoundedRect(r.x+3,r.y+5,Math.max(1,r.w-1),Math.max(1,r.h-1),3).endFill();g.beginFill(color,.25).drawRoundedRect(r.x+1,r.y+1,Math.max(1,r.w-3),Math.max(1,r.h-4),3).endFill();g.lineStyle(selected?2.5:1,selected?0x38bdf8:color,selected?.95:.62).drawRoundedRect(r.x+1,r.y+1,Math.max(1,r.w-3),Math.max(1,r.h-4),3);g.lineStyle(1,0xffffff,.22).moveTo(r.x+4,r.y+5).lineTo(r.x+r.w-5,r.y+5);if(pending)g.beginFill(0xf59e0b,1).drawCircle(r.x+r.w-7,r.y+7,3.2).endFill(); }
  destroy() { cancelAnimationFrame(this.frame);this.resizeObserver?.disconnect();this.pallets.forEach(x=>x.graphic.destroy());this.pallets.clear();this.app?.destroy(true,{children:true});this.layer?.remove();this.app=null; }
}
