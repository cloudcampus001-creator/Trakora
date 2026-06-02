/**
 * Trakora — Bluetooth CPCL Receipt Printer
 * Calibrated for 58 mm paper (PT-260 & compatible)
 *
 * Key constraints discovered from hardware testing:
 *  - Font 4 max ≈ 20 chars per line at x = 10
 *  - Line height must be 40 dots (LH = 30 causes overlapping)
 *  - Lines must be sent one-by-one; 512-byte chunks can split CPCL
 *    commands and corrupt the output
 */

export const printThermalReceipt = async (transaction, schoolConfig) => {
  const schoolName = (schoolConfig?.name || 'SCHOOL').toUpperCase();
  const now        = new Date();
  const dateStr    = now.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const timeStr    = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const refId      = transaction.id
    ? `TRK-${transaction.id.replace(/-/g, '').substring(0, 12).toUpperCase()}`
    : 'N/A';
  // Use US locale to get commas, then replace commas with standard ASCII spaces
  const amount = Number(transaction.amount || 0).toLocaleString('en-US').replace(/,/g, ' ');
  const payMethod = (transaction.payment_method || 'ESPECES')
    .replace('_SIMULATED', '')
    .replace(/_/g, ' ');

  // Safe truncation — font 4 fits ~20 chars at x=10 on 58 mm paper
  const t = (str, max = 20) => String(str || '').substring(0, max);

  try {
    alert('Connecting and scanning for print channel...');

    // 1. Request device
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: ['000018f0-0000-1000-8000-00805f9b34fb'] }],
    });
    const server = await device.gatt.connect();

    // 2. Find writable characteristic
    const services = await server.getPrimaryServices();
    let writeChar = null;
    for (const service of services) {
      const chars = await service.getCharacteristics();
      writeChar = chars.find(c => c.properties.write || c.properties.writeWithoutResponse);
      if (writeChar) break;
    }
    if (!writeChar) throw new Error('Could not find a writable channel. Please restart the printer.');

    // 3. Build CPCL
    const LH  = 40;  // Font-4 line height that works on this hardware
    const BIG = 55;  // Line height after font-7 (large text)
    const SEP  = '-'.repeat(20); // Safe for 58 mm paper
    const SEP2 = '='.repeat(20);

    const lines = [];
    let y = 10;
    const push = (...args) => lines.push(...args);

    push(`! 0 200 200 1600 1`); // Tall enough for all optional fields

    // ── Header ───────────────────────────────────────────────────────────────
    push(`TEXT 7 0 10 ${y} ${t(schoolName, 10)}`);        y += BIG;
    push(`TEXT 4 0 10 ${y} RECU DE PAIEMENT`);             y += LH;
    push(`TEXT 4 0 10 ${y} OFFICIAL RECEIPT`);             y += LH;
    push(`TEXT 4 0 10 ${y} ${SEP2}`);                       y += LH;

    // ── Date / Time / Reference ───────────────────────────────────────────────
    push(`TEXT 4 0 10 ${y} Date: ${dateStr}`);              y += LH;
    push(`TEXT 4 0 10 ${y} Heure: ${timeStr}`);             y += LH;
    push(`TEXT 4 0 10 ${y} Ref: ${t(refId, 16)}`);          y += LH;
    push(`TEXT 4 0 10 ${y} ${SEP}`);                        y += LH;

    // ── Student Information ───────────────────────────────────────────────────
    push(`TEXT 4 0 10 ${y} INFO. ETUDIANT`);                y += LH;
    push(`TEXT 4 0 10 ${y} Nom: ${t(transaction.student_name, 15)}`);    y += LH;
    push(`TEXT 4 0 10 ${y} Matr: ${t(transaction.matricule, 14)}`);      y += LH;

    if (transaction.class_name)     { push(`TEXT 4 0 10 ${y} Classe: ${t(transaction.class_name, 12)}`);   y += LH; }
    if (transaction.gender)         { push(`TEXT 4 0 10 ${y} Sexe: ${t(transaction.gender, 14)}`);          y += LH; }
    if (transaction.date_of_birth)  { push(`TEXT 4 0 10 ${y} Naiss: ${t(transaction.date_of_birth, 13)}`); y += LH; }
    if (transaction.place_of_birth) { push(`TEXT 4 0 10 ${y} Lieu: ${t(transaction.place_of_birth, 14)}`); y += LH; }
    if (transaction.parent_phone)   { push(`TEXT 4 0 10 ${y} Tel: ${t(transaction.parent_phone, 15)}`);    y += LH; }

    push(`TEXT 4 0 10 ${y} ${SEP}`);                        y += LH;

    // ── Payment Details ───────────────────────────────────────────────────────
    push(`TEXT 4 0 10 ${y} DETAILS PAIEMENT`);              y += LH;
    push(`TEXT 4 0 10 ${y} ${t('Objet: ' + (transaction.type || 'N/A'), 20)}`); y += LH;
    push(`TEXT 4 0 10 ${y} ${t('Mode: ' + payMethod, 20)}`); y += LH;
    push(`TEXT 4 0 10 ${y} ${SEP}`);                        y += LH;

    // ── Amount (font-7 for emphasis, number only; XAF on the next line) ───────
    push(`TEXT 4 0 10 ${y} MONTANT PAYE:`);                 y += LH;
    push(`TEXT 7 0 10 ${y} ${t(amount, 10)}`);              y += BIG;
    push(`TEXT 4 0 10 ${y} XAF`);                           y += LH;
    push(`TEXT 4 0 10 ${y} ${SEP}`);                        y += LH;

    // ── Bursar Validation ─────────────────────────────────────────────────────
    push(`TEXT 4 0 10 ${y} Par: ${t(transaction.bursar_name || 'Economat', 15)}`); y += LH;
    push(`TEXT 4 0 10 ${y} Signature: _________`);          y += LH;
    push(`TEXT 4 0 10 ${y} ${SEP2}`);                       y += LH;

    // ── Footer ────────────────────────────────────────────────────────────────
    push(`TEXT 4 0 10 ${y} Conservez ce recu`);             y += LH;
    push(`TEXT 4 0 10 ${y} Keep this receipt`);             y += LH;
    push(`TEXT 4 0 10 ${y} ${dateStr} ${timeStr.substring(0, 5)}`); y += LH;
    push(`TEXT 4 0 10 ${y} MERCI / THANK YOU`);             y += LH;
    push(`TEXT 4 0 10 ${y} Trakora Finance`);               y += LH;

    push(`FORM`);
    push(`PRINT`);

    // 4. Send line-by-line — never splits a CPCL command across packets
    const encoder = new TextEncoder();
    for (const line of lines) {
      const packet = encoder.encode(line + '\r\n');
      if (writeChar.properties.writeWithoutResponse) {
        await writeChar.writeValueWithoutResponse(packet);
      } else {
        await writeChar.writeValue(packet);
      }
      await new Promise(r => setTimeout(r, 20)); // Pacing between lines
    }

    alert('Receipt sent successfully!');
    device.gatt.disconnect();

  } catch (error) {
    alert('Error: ' + error.message);
    console.error(error);
  }
};