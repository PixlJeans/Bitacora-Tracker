// Fictional sample data for screenshots (no real client data).
const names = ['CONDOMINIO VISTA DEL BOSQUE','RESIDENCIAL LOS ROBLES','BODEGAS INDUSTRIALES EL COYOL','PLANTA DE TRATAMIENTO SAN RAFAEL','TORRE MÉDICA LA SABANA','LOTIFICACIÓN BRISAS DEL RÍO','HOTEL PLAYA HERMOSA','CENTRO COMERCIAL LAS FLORES','PROYECTO HABITACIONAL MONTE VERDE','AMPLIACIÓN PLANTA LÁCTEA','CONDOMINIO TERRAZAS DEL ESTE','BOULEVARD COMERCIAL ESCAZÚ'];
const statuses = ['open','open','open','new','open','open','closing','open','new','open','open','open'];
const today = new Date('2026-11-26T12:00');
const iso = d => d.toISOString().slice(0,10);
const projects = names.map((n,i) => {
  const opened = new Date(today); opened.setMonth(opened.getMonth() - (3 + i*3)); opened.setDate(3 + (i*5)%25);
  const visits = [], uploads = [];
  for (let m=1; m< (3+i*3); m++){ const x=new Date(opened); x.setMonth(x.getMonth()+m); if (x>=today) break; const k=iso(x).slice(0,7); if (m < (3+i*3)-1 || i%3) { visits.push(k); uploads.push(k);} }
  const regencias=[]; for(let k=1;k<20;k++){ const x=new Date(opened); x.setMonth(x.getMonth()+6*k); if (x>=new Date(today.getTime()-86400000*20)) break; regencias.push(iso(x)); }
  return {
    id: 'p'+i, code: `D1-${String(100+i*37).padStart(4,'0')}-20${22+(i%4)}`, name: n, status: statuses[i],
    labelId: ['pending','inProgress','done'][i%3], openedOn: iso(opened), notes: '', uploads, visits, regencias,
    archived: false, archivedOn: null, entries: [], lastUpdated: iso(today), createdOn: iso(today),
    location: i%4===3 ? null : { lat: 9.93 + i*0.02, lng: -84.08 - i*0.03, text: '', source: 'photo' },
    setenaUrl: 'https://bitacora.setena.go.cr/BitacoraDigital/PrimerIngresoBitacora/1',
    setena: { avance: 10+i*7, lastEntry: iso(new Date(today.getTime()-86400000*(5+i*6))), entries: 8+i*4, people: ['CARLOS ALBERTO JIMÉNEZ PÉREZ (Activo)'], others: [], participationClosed: false, approvedOn: iso(opened), readAt: iso(today) }
  };
});
const data = { version: 4, importSession: null, projects, labels: [
  { id: 'pending', name: 'Pendiente', color: '#ef4444' },{ id: 'inProgress', name: 'En proceso', color: '#facc15' },{ id: 'done', name: 'Listo', color: '#4ade80' }],
  reviews: [], snoozed: [], settings: { reminderTime:'08:00', notifications:false, autoStart:false, theme: process.env.THEME||'light', accent:'#007dc4', textSize:100, csvSeparator:';', tutorialSeen:true, radiusKm:15, home:null, roundTrip:true, look:1 } };
// rich history for the first project (timeline)
const p0 = projects[0]; p0.deliveries = {};
p0.visits.forEach((mk, j) => { const day = p0.openedOn.slice(8); p0.deliveries['m:'+mk] = { planned:null,due:null,visit:`${mk}-${day}`,photos:null,letter:null,uploaded:`${mk}-${String(Math.min(28,Number(day)+1)).padStart(2,'0')}`,received:null,letterText:'',files:[],
  notes: `SETENA ${day}/${mk.slice(5)}/${mk.slice(0,4)}: Se realizó la visita de inspección. Se observa avance en movimiento de tierras; se recomienda colocar barreras de sedimentos en el costado norte.\nSETENA ${day}/${mk.slice(5)}/${mk.slice(0,4)}: Se adjuntan fotografías de la visita.` }; });
p0.setenaStart = p0.openedOn;
p0.docs = { [p0.openedOn + '_a1b2c3d4.pdf']: { kind:'letter', placed:true } };
process.stdout.write(JSON.stringify(data));
