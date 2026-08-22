/**
 * Aislamiento temporal entre el visor PROTER ya migrado y MapaModel legacy.
 *
 * MapaModel sigue siendo necesario para Post Túnel y para los renderizadores,
 * pero no puede recalcular ni inventar datos sobre filas provenientes de
 * Supabase. Este adaptador se elimina cuando el mapa completo deje de depender
 * del modelo legacy.
 */
const MapaProterLegacyIsolation = {
  instalado:false,
  originales:{},

  install(){
    if(this.instalado)return;
    this.originales.normalizar=MapaModel.normalizarContratoDatos;
    this.originales.letras=MapaModel.sincronizarLetrasPersistentes;
    this.originales.fechaOrden=MapaModel.fechaOrden;
    this.originales.kilos=PalletModel.kilos;

    const self=this;
    MapaModel.normalizarContratoDatos=function(pallets,{recalcularNumerosDemo=false}={}){
      if(!Array.isArray(pallets))return pallets;
      const legacy=pallets.filter(p=>!p._backend_proter&&!p._backend_catalog);
      self.originales.normalizar.call(this,legacy,{recalcularNumerosDemo});
      pallets.filter(p=>p._backend_proter||p._backend_catalog).forEach(p=>{
        p.cajas=p.cajas===null||p.cajas===undefined?null:Number(p.cajas);
        p.kilos=p.kilos===null||p.kilos===undefined?null:Number(p.kilos);
        p.cajas_logicas=p.cajas_logicas===null||p.cajas_logicas===undefined?p.cajas:Number(p.cajas_logicas);
        p.kilos_logicos=p.kilos_logicos===null||p.kilos_logicos===undefined?p.kilos:Number(p.kilos_logicos);
        p.descripcion=p.descripcion||'Sin descripción SAP disponible';
        p.numero_articulo=p.numero_articulo||'';
        p.id_lote_real=String(p.id_lote_real||p.lote||'');
        p.lote=p.id_lote_real;
        if(p.banda===undefined)p.banda=null;
        if(p.posicion===undefined)p.posicion=null;
        if(p.altura===undefined)p.altura=null;
        // Nada de textos, detector, reserva, kilos o calidad simulados. Null es
        // información válida cuando el backend todavía no dispone del dato.
      });
      return pallets;
    };

    MapaModel.sincronizarLetrasPersistentes=function(pallets){
      const legacy=(Array.isArray(pallets)?pallets:[]).filter(p=>!p._backend_proter&&!p._backend_catalog);
      return self.originales.letras.call(this,legacy);
    };

    MapaModel.fechaOrden=function(value){
      const raw=String(value||'').trim();
      if(/^\d{4}-\d{2}-\d{2}/.test(raw))return raw.slice(0,10).replaceAll('-','');
      return self.originales.fechaOrden.call(this,value);
    };

    PalletModel.kilos=function(pallet){
      if(pallet?._backend_proter||pallet?._backend_catalog){
        return pallet?.kilos===null||pallet?.kilos===undefined?0:Number(pallet.kilos)||0;
      }
      return self.originales.kilos.call(this,pallet);
    };

    this.instalado=true;
  }
};
