/**
 * Configuración temporal y única de turnos. Debe ajustarse aquí cuando Planta
 * defina horarios formales; ninguna vista replica estos rangos.
 */
const TURNOS_OPERACIONALES = {
  ZONA_HORARIA: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Santiago',
  DIA: { inicio: 7, fin: 19, etiqueta: 'Turno día', codigo: 'DIA' },
  NOCHE: { etiqueta: 'Turno noche', codigo: 'NOCHE' },
  resolver(fecha = new Date()) {
    const hora = Number(new Intl.DateTimeFormat('en-US', { hour: '2-digit', hourCycle: 'h23', timeZone: this.ZONA_HORARIA }).format(fecha));
    const turno = hora >= this.DIA.inicio && hora < this.DIA.fin ? this.DIA : this.NOCHE;
    return { ...turno, hora, zonaHoraria: this.ZONA_HORARIA };
  },
  formatoFecha(fecha = new Date()) { return new Intl.DateTimeFormat('es-CL', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', timeZone: this.ZONA_HORARIA }).format(fecha); },
  formatoHora(fecha = new Date()) { return new Intl.DateTimeFormat('es-CL', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: this.ZONA_HORARIA }).format(fecha); }
};
