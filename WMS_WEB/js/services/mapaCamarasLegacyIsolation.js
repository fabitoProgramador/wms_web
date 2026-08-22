/**
 * Aislamiento entre los visores de cámaras migrados y MapaModel legacy.
 *
 * Los renderizadores todavía consumen el shape histórico de MapaModel, pero
 * ninguna fila proveniente de Supabase puede recibir datos simulados.
 */
const MapaCamarasLegacyIsolation = {
  instalado:false,
  originales:{},

  esBackend(p){
    return Boolean(p?._backend_proter || p?._backend_postunel || p?._backend_catalog);
  },

  install(){
    if(this.instalado)return;
    this.originales.normalizar=MapaModel.normalizarContratoDatos;
    this.originales.letras=MapaModel.sincronizarLetrasPersistentes;
    this.originales.fechaOrden=MapaModel.fechaOrden;
    this.originales.kilos=PalletModel.kilos;

    const self=this;
    MapaModel.normalizarContratoDatos=function(pallets,{recalcularNumerosDemo=false}={}){
      if(!Array.isArray(pallets))return pallets;
      const legacy=pallets.filter(p=>!self.esBackend(p));
      self.originales.normalizar.call(this,legacy,{recalcularNumerosDemo});

      pallets.filter(p=>self.esBackend(p)).forEach(p=>{
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
        // No completar detector, reserva, calidad, textos ni kilos desde reglas
        // demo. Null conserva el significado real: dato no disponible.
      });
      return pallets;
    };

    MapaModel.sincronizarLetrasPersistentes=function(pallets){
      // Las letras de pallets backend vienen exclusivamente de Articulos_Codigo.
      // El generador local sólo puede seguir atendiendo consumidores legacy.
      const legacy=(Array.isArray(pallets)?pallets:[]).filter(p=>!self.esBackend(p));
      return self.originales.letras.call(this,legacy);
    };

    MapaModel.fechaOrden=function(value){
      const raw=String(value||'').trim();
      if(/^\d{4}-\d{2}-\d{2}/.test(raw))return raw.slice(0,10).replaceAll('-','');
      return self.originales.fechaOrden.call(this,value);
    };

    PalletModel.kilos=function(pallet){
      if(self.esBackend(pallet)){
        return pallet?.kilos===null||pallet?.kilos===undefined?0:Number(pallet.kilos)||0;
      }
      return self.originales.kilos.call(this,pallet);
    };

    this.instalado=true;
  }
};
