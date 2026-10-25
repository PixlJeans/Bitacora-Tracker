import { extraerBitacoras } from '../src/lib/parser';
const casos: Record<string,string> = {
tabla: `SECRETARÍA TÉCNICA NACIONAL AMBIENTAL
Número de bitácora   Nombre del proyecto   Estado
D1-0170-2020   CONDOMINIO VISTA DEL BOSQUE   Abierta
D1-0245-2019   PLANTA DE TRATAMIENTO LAS BRISAS   Solicitud de Cierre
D1 - 12 - 2021   BODEGAS INDUSTRIALES EL COYOL   Nueva
Página 1 de 2`,
flecha: `D1-0170-2020 → CONDOMINIO VISTA DEL BOSQUE
D1-0333-2022 → URBANIZACIÓN LOS ROBLES`,
secciones: `BITÁCORAS ABIERTAS
D1-0170-2020 CONDOMINIO VISTA DEL BOSQUE
D1-0180-2020 CENTRO COMERCIAL PLAZA SUR
SOLICITUD DE CIERRE
D1-0099-2018 TORRE MÉDICA SAN JOSÉ
NUEVAS
D1-0501-2024 PARQUE SOLAR GUANACASTE`,
partido: `D1-0170-2020   CONDOMINIO VISTA DEL   Abierta
BOSQUE ETAPA II
D1-0200-2021   HOTEL PLAYA
Nueva`,
  fechas: `D1-0170-2020   CONDOMINIO VISTA DEL BOSQUE   15/01/2020   Abierta
D1-0300-2024   Hotel Playa Grande   Nueva   2024-03-05
D1-0301-2024  Abierta  apertura 7 de setiembre de 2024
Parque Industrial Norte`,
  nombreAntes: `TORRE MÉDICA SAN JOSÉ
D1-0099-2018   Solicitud de Cierre`,
};
for (const [k,v] of Object.entries(casos)) { console.log('---', k); for (const e of extraerBitacoras(v)) console.log(e.numero, '|', e.nombre, '|', e.estado, e.estadoDetectado?'':'(?)', e.apertura ?? '', e.dudas.join('; ')); }
process.exit(0);
