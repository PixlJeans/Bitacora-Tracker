// ===== Digital signatures of a PDF, read from the file itself =====
// pdf.js does not give the signer of a signature field, but every digital signature is stored in the file as a
// dictionary with «/Name (LAURA UREÑA ALFARO (FIRMA))» and «/M (D:20240912…)» a few bytes apart. They are turned
// into the same line the signature stamp shows, «Firmado digitalmente por NAME Fecha: 2024.09.12», so the
// regencia reader (docKind.signaturesOf) works the same for both.

/** The signatures found in the PDF's bytes: «NAME (FIRMA)» + its date. */
export function signaturesInPdf(data: ArrayBuffer | Uint8Array): { name: string; date: string }[] {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const s = new TextDecoder('latin1').decode(bytes);
  const dates = [...s.matchAll(/\/M\s*\(D:(\d{4})(\d{2})(\d{2})/g)].map(m => ({ at: m.index!, date: `${m[1]}-${m[2]}-${m[3]}` }));
  const out: { name: string; date: string }[] = [];
  const names = [...s.matchAll(/\/Name\s*\(((?:\\.|[^\\)])*)\)/g)];
  names.forEach((m, i) => {
    let name = m[1].replace(/\\([()\\])/g, '$1');
    // UTF-16 text strings start with the byte-order mark þÿ
    if (name.startsWith('\u00fe\u00ff')) name = [...name.slice(2)].reduce((a, c, j, arr) => (j % 2 ? a : a + String.fromCharCode((c.charCodeAt(0) << 8) | (arr[j + 1]?.charCodeAt(0) ?? 0))), '');
    // the date of the SAME signature dictionary: a «/M» between this name and the next one (or the previous one),
    // never further than a few hundred bytes
    const at = m.index!, prev = i ? names[i - 1].index! : -1, next = names[i + 1]?.index ?? Infinity;
    const after = dates.find(d => d.at > at && d.at < next && d.at - at < 600);
    const before = [...dates].reverse().find(d => d.at < at && d.at > prev && at - d.at < 600);
    const near = after ?? before;
    if (near && name.trim()) out.push({ name: name.trim(), date: near.date });
  });
  // signatures without a «/Name» (the SINPE «PERSONA FISICA» stamp): their visible stamp is a small drawing in the
  // file, «(NAME \(FIRMA\)) Tj … (PERSONA FISICA, CPF-…) Tj … (Fecha declarada: 07/11/2023 04:50:56 PM) Tj»
  for (const m of s.matchAll(/\(((?:[A-Z\u00c0-\u00dd]{2,}\s+){1,8})\\\(FIRMA\\\)\)\s*Tj[^]{0,300}?\(Fecha declarada:\s*(\d{2})\/(\d{2})\/(\d{4})/g)) {
    const name = `${m[1].trim()} (FIRMA)`, date = `${m[4]}-${m[3]}-${m[2]}`;
    if (!out.some(x => x.name.replace(/\s*\(FIRMA\)/i, '') === m[1].trim() && x.date === date)) out.push({ name, date });
  }
  return out;
}

/** The same, as the lines a signature stamp shows (appended to the PDF's text). */
export const signatureLines = (data: ArrayBuffer | Uint8Array) =>
  signaturesInPdf(data).map(x => `Firmado digitalmente por ${/\(FIRMA\)/i.test(x.name) ? x.name : `${x.name} (FIRMA)`} Fecha: ${x.date.replace(/-/g, '.')}`).join('\n');
