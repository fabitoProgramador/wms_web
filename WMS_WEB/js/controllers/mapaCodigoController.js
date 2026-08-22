/**
 * Mapa -> Agregar Código remoto.
 * Mantiene la UI de tarjetas, pero el catálogo y su auditoría viven en Supabase.
 */
const MapaCodigoController = {
  container:null,
  query:'',
  data:null,
  requestId:0,
  searchTimer:null,
  editingCodigo:null,

  esc(v){ return SeguridadService.escaparHtml(v); },
  fmt(v){ return Number(v||0).toLocaleString('es-CL'); },
  toast(text,type='success'){ return NotificationService.show(text,{type}); },
  canManage(){ return UserModel.hasPermission('articulos.gestionar'); },

  init(container){
    this.container=container;
    this.query='';
    this.data=null;
    this.editingCodigo=null;
    clearTimeout(this.searchTimer);
    this.renderShell();
    this.cargar();
  },

  renderShell(){
    if(!this.container)return;
    this.container.innerHTML=`<section class="map-submodule code-module">
      ${DashboardController.operationalHeader({eyebrow:'MAPA · CODIFICACIÓN VISUAL',title:'Agregar Código',status:'Catálogo artículo → letra administrado por Supabase'})}
      <div class="code-summary" aria-label="Resumen de códigos">
        <article><small>ARTÍCULOS</small><b id="codeTotal">—</b></article>
        <article class="assigned"><small>ASIGNADOS</small><b id="codeAssigned">—</b></article>
        <article class="pending"><small>PENDIENTES</small><b id="codePending">—</b></article>
      </div>
      <div class="code-toolbar">
        <label><i class="wi wi-search"></i><input id="codeSearch" value="${this.esc(this.query)}" placeholder="Buscar por letra, artículo o descripción" autocomplete="off"></label>
        <small id="codeResultCount">Consultando Supabase…</small>
      </div>
      <div id="codeTable"><div class="panel-empty">Cargando catálogo visual…</div></div>
    </section>`;
    const input=document.getElementById('codeSearch');
    if(input)input.oninput=e=>this.onSearch(e.target.value);
    DashboardController.startOperationalClock();
  },

  onSearch(value){
    this.query=String(value||'');
    clearTimeout(this.searchTimer);
    this.searchTimer=setTimeout(()=>this.cargar(true),250);
  },

  async cargar(restoreFocus=false){
    const req=++this.requestId;
    try{
      const data=await MapaCodigoModel.catalogo(this.query,8);
      if(req!==this.requestId||AppController.activeView!=='mapa_codigo')return;
      this.data=data;
      this.render();
      if(restoreFocus){
        const input=document.getElementById('codeSearch');
        input?.focus();
        input?.setSelectionRange(input.value.length,input.value.length);
      }
    }catch(error){
      if(req!==this.requestId||!this.container)return;
      const msg=error?.permiso?'Tu sesión no posee permiso para consultar el catálogo visual.'
        :error?.red?'No fue posible conectar con Supabase. Las letras visuales no usan respaldo local.'
        :(error?.message||'No fue posible consultar el catálogo visual.');
      const root=document.getElementById('codeTable');
      if(root)root.innerHTML=`<div class="panel-empty"><b>${this.esc(msg)}</b></div>`;
      const count=document.getElementById('codeResultCount');if(count)count.textContent='Sin datos remotos';
      this.toast(msg,'error');
    }
  },

  render(){
    if(!this.data)return;
    const r=this.data.resumen;
    const set=(id,value)=>{const el=document.getElementById(id);if(el)el.textContent=value;};
    set('codeTotal',this.fmt(r.articulos));
    set('codeAssigned',this.fmt(r.asignados));
    set('codePending',this.fmt(r.pendientes));
    set('codeResultCount',`${this.fmt(this.data.items.length)} resultado(s) · siguiente letra libre: ${this.data.siguienteLetra||'—'}${this.canManage()?'':' · solo lectura'}`);
    const root=document.getElementById('codeTable');if(!root)return;
    root.innerHTML=`<div class="code-card-list">${this.data.items.length?this.data.items.map(item=>this.card(item)).join(''):'<div class="ops-empty">Ningún artículo coincide con la búsqueda.</div>'}</div>${this.historial()}`;
    root.querySelectorAll('.code-edit').forEach(btn=>btn.onclick=()=>this.editar(btn.dataset.art));
    root.querySelectorAll('.code-release').forEach(btn=>btn.onclick=()=>this.liberar(btn.dataset.art));
  },

  card(item){
    if(this.editingCodigo===item.codigo&&this.canManage())return this.formCard(item);
    const letra=item.letra;
    const detalleMapa=item.palletsMapa||item.palletsNoExiste
      ?` · ${this.fmt(item.palletsMapa)} en mapa${item.palletsNoExiste?` · ${this.fmt(item.palletsNoExiste)} sin padre SAP`:''}`
      :'';
    return `<article class="code-card ${letra?'assigned':'pending'}" data-art="${this.esc(item.codigo)}">
      <div class="code-card-head">
        <span class="code-letter">${letra?this.esc(letra):'<i class="wi wi-plus"></i>'}</span>
        <div class="code-card-id"><b>${this.esc(item.codigo)}</b><small>${this.esc(item.descripcion)}${this.esc(detalleMapa)}</small></div>
      </div>
      <div class="code-card-metrics">
        <div><small>PALLETS</small><span>${this.fmt(item.pallets)}</span></div>
        <div><small>CAJAS</small><span>${this.fmt(item.cajas)}</span></div>
      </div>
      <div class="code-card-actions">${this.canManage()?`<button class="code-edit" data-art="${this.esc(item.codigo)}">${letra?'<i class="wi wi-edit"></i>Editar letra':'<i class="wi wi-plus"></i>Asignar letra'}</button>${letra?`<button class="code-release" data-art="${this.esc(item.codigo)}"><i class="wi wi-unlink"></i>Liberar</button>`:''}`:'<small>Consulta de solo lectura según permisos de la sesión.</small>'}</div>
    </article>`;
  },

  formCard(item){
    const suggested=item.letra||this.data?.siguienteLetra||'';
    return `<article class="code-card ${item.letra?'assigned':'pending'} editing" data-art="${this.esc(item.codigo)}">
      <form class="inline-code-form" onsubmit="MapaCodigoController.guardar(event,'${this.esc(item.codigo)}')">
        <strong>${this.esc(item.codigo)}</strong>
        <label>Nueva letra<input name="letter" maxlength="2" value="${this.esc(suggested)}" autocomplete="off" required></label>
        <label>Motivo<input name="motivo" placeholder="Opcional · queda en auditoría"></label>
        <div class="inline-code-actions"><button class="btn-primary" type="submit">Guardar</button><button type="button" class="btn-secondary" onclick="MapaCodigoController.cancelarEdicion()">Cancelar</button></div>
        <small class="code-form-error"></small>
      </form>
    </article>`;
  },

  editar(codigo){
    if(!this.canManage())return;
    this.editingCodigo=codigo;
    this.render();
    requestAnimationFrame(()=>document.querySelector(`.code-card[data-art="${CSS.escape(codigo)}"] input[name=letter]`)?.focus());
  },

  cancelarEdicion(){this.editingCodigo=null;this.render();},

  async guardar(event,codigo){
    event.preventDefault();
    if(!this.canManage())return this.toast('Tu sesión no posee permiso para gestionar códigos visuales.','error');
    const form=event.currentTarget;
    const letter=String(form.elements.letter.value||'').trim().toUpperCase();
    const motivo=String(form.elements.motivo.value||'').trim();
    const errorNode=form.querySelector('.code-form-error');
    const submit=form.querySelector('button[type=submit]');
    if(submit)submit.disabled=true;
    try{
      const result=await MapaCodigoModel.guardar(codigo,letter,motivo);
      if(result?.ok===false){if(errorNode)errorNode.textContent=result.error||'No fue posible guardar la letra.';return;}
      this.editingCodigo=null;
      await this.cargar();
      this.toast(`Artículo ${codigo}: letra ${result?.letra||letter} guardada en Supabase.`,'success');
    }catch(error){
      if(errorNode)errorNode.textContent=error?.message||'No fue posible guardar la letra.';
    }finally{if(submit)submit.disabled=false;}
  },

  async liberar(codigo){
    if(!this.canManage())return this.toast('Tu sesión no posee permiso para gestionar códigos visuales.','error');
    const item=this.data?.items.find(x=>x.codigo===codigo);if(!item?.letra)return;
    if(!window.confirm(`¿Liberar la letra ${item.letra} del artículo ${codigo}?`))return;
    const motivo=window.prompt('Motivo de liberación (opcional):','Liberación manual de letra visual');
    if(motivo===null)return;
    try{
      const result=await MapaCodigoModel.liberar(codigo,motivo);
      if(result?.ok===false)return this.toast(result.error||'No fue posible liberar la letra.','error');
      await this.cargar();
      this.toast(`Letra ${item.letra} liberada del artículo ${codigo}.`,'success');
    }catch(error){this.toast(error?.message||'No fue posible liberar la letra.','error');}
  },

  historial(){
    const rows=this.data?.historial||[];
    if(!rows.length)return '';
    return `<section class="letter-history"><h3>HISTORIAL DE CAMBIOS</h3>${rows.map(h=>`<div><time>${this.esc(h.fecha?new Date(h.fecha).toLocaleString('es-CL'):'—')}</time><b>${this.esc(h.codigo)}: ${this.esc(h.letraAnterior)} → ${this.esc(h.letraNueva)}</b><span>${this.esc(h.accion)} · ${this.esc(h.usuario)}${h.rol?` · ${this.esc(h.rol)}`:''}${h.motivo?` · ${this.esc(h.motivo)}`:''}</span></div>`).join('')}</section>`;
  }
};
