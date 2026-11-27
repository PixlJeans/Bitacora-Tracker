// Every file of a project by what it CONTAINS (v68): OCR'd scans, photos saved as PDF, the guarantee, Word files
// with a .pdf name, another project's regencia, and files the app had put in the wrong folder.
import assert from 'node:assert';
import { classifyDoc } from '../src/lib/docKind';
import { docxText, isZip } from '../src/lib/docx';
import { normalize, replaceAll, getData } from '../src/lib/store';
import { backend } from '../src/lib/backend';
import { scanFolders } from '../src/lib/scan';
import { docReader } from '../src/lib/docSort';
import { timelineOf } from '../src/lib/timeline';

// ---- the classifier on real OCR readings (shortened) ----
{
  const bond = classifyDoc('e ENTRADA DE VALOR ADE 213983 MINAE-SECRETARIA TECN.NAC. AMBIEN. (SETENA) Apartado Postal 5208-1000 OTROS VALORES CARTA DE , FINANCIERA DESYFIN. COLONES F.Emision FVencimiento Descripcion EXP ADM D1-0848-2022 PROYECT PUENTE LA GRAN VIA DESARROLLADOR LAURA UREÑA CIA DEL 10-07-2024 AL 10-07-2025', 'D1-0848-2022');
  assert.deepEqual(bond, { kind: 'guarantee', expediente: 'D1-0848-2022', validFrom: '2024-07-10', validTo: '2025-07-10' });
  assert.equal(classifyDoc('Transferencia de fondos Rápida Detalle de movimientos Cliente: 3925-INVERSIONES CALINDA S.A. Estado: Aplicada sin errores GARANTIAS AMBIENTALES MIN CR93015120210010005107 Colones Garantia EXP D1 0950 2023 SET 850,000.00', 'D1-0950-2023').kind, 'guarantee');
  assert.equal(classifyDoc('Pagar / Planillas y Proveedores Fecha: 24/02/2026 Detalle de Transacción Nombre: GARANTIAS AMBIENTALES MINAE COLONES Monto: 9,133,951.30 Concepto: CONDOMINIOS ELEGANZA Estado: En tránsito', 'D1-0384-2021').kind, 'guarantee');
  assert.equal(classifyDoc('Cartago, 09 de octubre del 2025. Señores Secretaría Técnica Nacional Ambiental (SETENA) ATENCIÓN: DEPARTAMENTO DE AUDITORÍA Y SEGUIMIENTO AMBIENTAL (ASA) Referencia: Exp. Adm.: D1-12553-2014-SETENA Por este medio, adjunto la renovación del Certificado de la Garantía Ambiental.', 'D1-12553-2014').kind, 'guarantee', 'the renewal letter goes with the guarantee');
  assert.equal(classifyDoc('Cartago, 07 de agosto del 2024. Señores Secretaría Técnica Nacional Ambiental ATENCIÓN: DEPARTAMENTO DE AUDITORÍA REFERENCIA: Exp. D1-0848-2022 adjunto el informe solicitado sobre la visita', 'D1-0848-2022').kind, 'letter', 'an ordinary letter stays a letter');
  // a regencia still wins over a guarantee mentioned inside it, and SETENA's own notices stay SETENA's
  assert.equal(classifyDoc('Informe de Regencia Ambiental IRA-I-2026 Proyecto: KIND Expediente Administrativo: D1-0007-2025-SETENA Periodo de Regencia Enero - Junio 2026 la garantía ambiental está vigente', 'D1-0007-2025').kind, 'regencia');
  assert.equal(classifyDoc('INF-TEC-DT-ASA-0339-2023 Asunto: Cierre de etapa única. Se recomienda la devolución de la garantía ambiental del proyecto', 'D1-0550-2020').kind, 'setena');
  // a regencia by another firm, scanned
  assert.equal(classifyDoc('W kama MB Pr INFORME DE REGENCIA AMBIENTAL SEMESTRAL Proyecto Desarrollo Horizontal Alma del Río Razón social proyecto: Alma del Rio Residencias', 'D1-0796-2023').kind, 'regencia');
  // a closing request SETENA did not accept (it came as a Word file named .pdf)
  assert.deepEqual(classifyDoc('Estimado(a) señor(a):\nLe informamos que su solicitud de cierre no ha sido aceptada. Le solicitamos presentar su gestión de manera formal a través del siguiente enlace oficial:\nhttps://portal.setena.go.cr/correspondencia?id=28', 'D1-13049-2014'), { kind: 'setena', closingRejected: true });
}

// ---- Word file with a .pdf name ----
{
  const b64 = 'UEsDBBQAAAAIAAF8e13HHBc8CgAAAAgAAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbLMJqSxILda3AwBQSwMEFAAAAAgAAXx7XSWMTGjiAAAAZQEAABEAAAB3b3JkL2RvY3VtZW50LnhtbG2QQWrDQAxFryIImGTjoXYXxU7SVXe5hDqjOAJ7NJHkht6+jCFQSjdPC+l/Sf/4GJLEdaHs5+Nj+JT0XWup0Ao/f5jzgkn2eACjZte9voyiezwMx1D7lbqx/JVeCDhfRRdcxOC+EtgKJjNH9jVBIohMqgRZ4IZgnAQwUnFM2MKFnrObvCgZZUetJhOZc72lH3P1WTCTImy7ZkBwxa9m1/X9aJBoBuNpZcpOQHnGSCBXjozzADf3YkMIRdRxbo2cMraTtFFDFFWyIjlRjozvnE7dW4NLGVPxU//P/+GZYfgV7A9QSwECFAMUAAAACAABfHtdxxwXPAoAAAAIAAAAEwAAAAAAAAAAAAAAgAEAAAAAW0NvbnRlbnRfVHlwZXNdLnhtbFBLAQIUAxQAAAAIAAF8e10ljExo4gAAAGUBAAARAAAAAAAAAAAAAACAATsAAAB3b3JkL2RvY3VtZW50LnhtbFBLBQYAAAAAAgACAIAAAABMAQAAAAA=';
  const u = Uint8Array.from(Buffer.from(b64, 'base64'));
  assert.equal(isZip(u.buffer), true);
  assert.equal(isZip(new TextEncoder().encode('%PDF-1.7').buffer), false);
  const t = await docxText(u.buffer);
  assert(t.includes('su solicitud de cierre no ha sido aceptada'), t);
  assert(t.includes('id=28&dpt=3'), 'entities decoded');
}

// ---- the scanner: OCR, content wins, another project's regencia goes to its project ----
{
  const mk = (id: string, code: string, name: string, docs: any = {}, extra: any = {}) => ({ id, code, name, status: 'open', openedOn: '2024-01-15', createdOn: '2024-01-15', noOpeningDate: false, docs, ...extra });
  replaceAll(normalize({ projects: [
    mk('a', 'D1-0211-2023', 'HACIENDA'),
    // B already has its own copy of IRA-I-2022; C has nothing for IRA-I-2026
    mk('b', 'D1-0550-2020', 'ALMAZARA', { '2022-05-23_b2bf67c2.pdf': { kind: 'regencia', ira: 'IRA-I-2022', period: 'Abril - Mayo del 2022', placed: true } }),
    mk('c', 'D1-0950-2023', 'CERRITOS'),
    // D: a regencia the app had put in «Notas de recibido» (read before), and an old scan read before OCR existed
    mk('d', 'D1-0171-2022', 'LOTES', {
      '2025-05-28_658bd73e.pdf': { kind: 'regencia', ira: 'IRA-II-2025', period: 'Febrero 2025 - Mayo 2025', sigV: 2, noPlace: true, placed: true },
      '2023-09-04_24fef898.pdf': { kind: 'notext', placed: true }
    }, { deliveries: { 'r:2025-07-15': { received: '2025-05-28', files: [] } } })
  ] }));
  const A = 'Proyectos/D1-0211-2023 - HACIENDA', D = 'Proyectos/D1-0171-2022 - LOTES';
  let tree: { path: string; size: number; modified: number }[] = [
    { path: `${A}/2026/07 - Julio/Regencias/2026-07-23_68abcf2c.pdf`, size: 1, modified: 0 },   // C's regencia (C lacks it)
    { path: `${A}/2022/05 - Mayo/Regencias/2022-05-23_50967adc.pdf`, size: 1, modified: 0 },    // B's regencia (B has it)
    { path: `${A}/2026/04 - Abril/Regencias/2026-04-17_2c99890b.pdf`, size: 1, modified: 0 },   // a scan: guarantee transfer
    { path: `${A}/2026/04 - Abril/Regencias/2026-04-17_b61215f5.pdf`, size: 1, modified: 0 },   // a scan: regencia, OCR misread number
    { path: `${D}/2025/05 - Mayo/Notas de recibido/2025-05-28_658bd73e.pdf`, size: 1, modified: 0 },
    { path: `${D}/2023/09 - Septiembre/Documentos/2023-09-04_24fef898.pdf`, size: 1, modified: 0 }  // a photo saved as PDF
  ];
  const texts: Record<string, string> = {
    '68abcf2c': 'Informe de Regencia Ambiental IRA-I-2026 Proyecto: CONDOMINIO COLINAS DEL ESTE Expediente Administrativo: D1-0950-2023-SETENA Periodo de Regencia Enero - Junio 2026',
    '50967adc': 'Informe de Regencia Ambiental IRA-I-2022 Proyecto: CONDOMINIO ALMAZARA Expediente Administrativo: D1-0550-2020-SETENA Periodo de Regencia Abril - Mayo del 2022',
    '2c99890b': '', 'b61215f5': '', '24fef898': '', '658bd73e': 'x'
  };
  const ocr: Record<string, { text: string; photo: boolean }> = {
    '2c99890b': { text: 'Transferencia de fondos Rápida GARANTIAS AMBIENTALES MIN Garantia EXP D1 0950 2023 SET', photo: false },
    'b61215f5': { text: 'Informe de Regencia Ambiental IRA-I-2026 Proyecto: HACIENDA II Expediente Administrativo: D1-02111-2023-SETENA Periodo de Regencia Enero - Junio 2026', photo: false },
    '24fef898': { text: '', photo: true }
  };
  const id = (p: string) => /_([0-9a-f]{8})\.pdf$/.exec(p)![1];
  const read: string[] = [];
  docReader.text = async (p: string) => { read.push(id(p)); return texts[id(p)]; };
  docReader.ocr = async (p: string) => ocr[id(p)];
  const moves: string[] = [];
  (backend as any).listTree = async (folder: string) => tree.filter(t => t.path.startsWith(folder + '/'));
  (backend as any).moveAttachment = async (path: string, folder: string) => {
    const n = path.split('/').pop()!;
    if (process.env.DBG) console.log('MOVE', path, folder, new Error().stack!.split('\n').slice(2,5).join(' | '));
    moves.push(`${n} → ${folder.replace(/^Proyectos\//, '').replace(/ - [A-Z ]+\//, '/')}`);
    tree = tree.map(t => t.path === path ? { ...t, path: `${folder}/${n}` } : t);
    return `${folder}/${n}`;
  };
  await scanFolders(true);
  assert.deepEqual(moves.sort(), [
    '2022-05-23_50967adc.pdf → D1-0550-2020/2022/05 - Mayo/Regencias',
    '2023-09-04_24fef898.pdf → D1-0171-2022/2023/09 - Septiembre/Fotos',
    '2025-05-28_658bd73e.pdf → D1-0171-2022/2025/05 - Mayo/Regencias',
    '2026-04-17_2c99890b.pdf → D1-0211-2023/2026/04 - Abril/Garantía ambiental',
    '2026-07-23_68abcf2c.pdf → D1-0950-2023/2026/07 - Julio/Regencias en otra bitácora'
  ]);
  assert(!read.includes('658bd73e'), 'a file read before is moved without reading it again');
  const P = (code: string) => getData().projects.find(x => x.code === code)!;
  assert.equal(P('D1-0211-2023').docs!['2026-07-23_68abcf2c.pdf'].movedTo, 'D1-0950-2023');
  assert.deepEqual({ ...P('D1-0950-2023').docs!['2026-07-23_68abcf2c.pdf'], period: undefined, ira: undefined, project: undefined },
    { ...P('D1-0950-2023').docs!['2026-07-23_68abcf2c.pdf'], kind: 'regencia', uploadedIn: 'D1-0211-2023', misfiled: true, period: undefined, ira: undefined, project: undefined });
  assert.equal(P('D1-0550-2020').docs!['2022-05-23_50967adc.pdf'].misfiled, undefined, 'its own copy is there: not a warning');
  assert.equal(P('D1-0211-2023').docs!['2026-04-17_b61215f5.pdf'].kind, 'regencia', 'OCR misread the number: still this project\'s regencia');
  assert.equal(P('D1-0211-2023').docs!['2026-04-17_b61215f5.pdf'].ocr, 1);
  assert.equal(P('D1-0171-2022').docs!['2023-09-04_24fef898.pdf'].kind, 'photo');
  assert.equal(P('D1-0171-2022').deliveries!['r:2025-07-15']?.received ?? null, null, 'the regencia copy no longer counts as its receipt');
  // the warning shows in the other project's history
  assert(timelineOf(P('D1-0950-2023')).some(x => /subida en la bitácora de D1-0211-2023 \(no en la suya\)/.test(x.title)));
  // nothing moves or is read again on the next scan
  moves.length = 0; read.length = 0;
  await scanFolders(true);
  assert.deepEqual(moves, []); assert.deepEqual(read, []);
  console.log('files OK');
}
process.exit(0);
