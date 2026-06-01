/**
 * Trakora — Receipt Engine (Streamlined)
 *
 * Dual-mode printing:
 *  1. Browser window print (HTML) — Always runs, no hardware needed
 *  2. Bluetooth CPCL thermal       — PT260 & compatible printers
 *
 * Connection strategy: single service filter → discover services →
 * find writable characteristic → send. No extra complexity.
 */

// ─── MAIN EXPORT ──────────────────────────────────────────────────────────────

export const printThermalReceipt = async (transaction, schoolConfig) => {
  // 1. Always open the browser print window — works everywhere
  openBrowserPrintWindow(transaction, schoolConfig);

  // 2. Attempt Bluetooth CPCL if the API is available
  if (navigator.bluetooth) {
    try {
      await printViaBluetoothCPCL(transaction, schoolConfig);
    } catch (err) {
      // Silent fail — the browser window already produced the receipt
      console.warn('[Trakora Printer] Bluetooth print skipped:', err.message);
    }
  }
};


// ─── BLUETOOTH CPCL THERMAL PRINT ─────────────────────────────────────────────

async function printViaBluetoothCPCL(transaction, schoolConfig) {
  const schoolName = (schoolConfig?.name || 'SCHOOL').toUpperCase();
  const now        = new Date();
  const dateStr    = now.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const timeStr    = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const refId      = transaction.id
    ? `TRK-${transaction.id.replace(/-/g, '').substring(0, 12).toUpperCase()}`
    : 'N/A';
  const amount    = Number(transaction.amount || 0).toLocaleString('fr-FR');
  const payMethod = (transaction.payment_method || 'ESPECES')
    .replace('_SIMULATED', '')
    .replace(/_/g, ' ');

  // Truncate to prevent overflow on 58 mm paper (~32 chars/line at font 4)
  const t = (str, max = 28) => String(str || '').substring(0, max);

  alert('Connecting and scanning for print channel...');

  // ── 1. Request device ────────────────────────────────────────────────────────
  const device = await navigator.bluetooth.requestDevice({
    filters: [{ services: ['000018f0-0000-1000-8000-00805f9b34fb'] }],
  });
  const server = await device.gatt.connect();

  // ── 2. Discover services and find writable characteristic ────────────────────
  const services = await server.getPrimaryServices();
  let writeCharacteristic = null;

  for (const service of services) {
    const characteristics = await service.getCharacteristics();
    writeCharacteristic = characteristics.find(
      c => c.properties.write || c.properties.writeWithoutResponse
    );
    if (writeCharacteristic) break; // Found it — stop looking
  }

  if (!writeCharacteristic) {
    throw new Error('Could not find a writable channel. Please restart the printer.');
  }

  // ── 3. Build CPCL receipt ────────────────────────────────────────────────────
  const SEP  = '-'.repeat(36);
  const SEP2 = '='.repeat(36);

  const lines = [];
  let y = 10;
  const LH = 30; // Standard line height in dots
  const SH = 24; // Small / tight line height

  const push = (...args) => lines.push(...args);

  // CPCL form header (! OFFSET HRES VRES HEIGHT COPIES)
  push(`! 0 200 200 1200 1`);

  // School name (large, centered)
  push(`TEXT 7 0 20 ${y} ${t(schoolName, 20)}`);             y += 48;
  push(`TEXT 4 0 10 ${y} RECU DE PAIEMENT OFFICIEL`);         y += LH;
  push(`TEXT 4 0 10 ${y} OFFICIAL PAYMENT RECEIPT`);          y += LH;
  push(`TEXT 4 0 10 ${y} ${SEP2}`);                            y += LH;

  // Date / Time / Reference
  push(`TEXT 4 0 10 ${y} Date: ${dateStr}  Heure: ${timeStr}`); y += LH;
  push(`TEXT 4 0 10 ${y} Reference: ${refId}`);                y += LH;
  push(`TEXT 4 0 10 ${y} ${SEP}`);                              y += LH;

  // Student information
  push(`TEXT 4 1 10 ${y} INFORMATIONS ETUDIANT`);              y += LH;
  push(`TEXT 4 0 10 ${y} Nom: ${t(transaction.student_name)}`);     y += LH;
  push(`TEXT 4 0 10 ${y} Matricule: ${t(transaction.matricule, 22)}`); y += LH;

  if (transaction.class_name)    { push(`TEXT 4 0 10 ${y} Classe: ${t(transaction.class_name)}`);        y += LH; }
  if (transaction.gender)        { push(`TEXT 4 0 10 ${y} Sexe: ${t(transaction.gender, 10)}`);           y += LH; }
  if (transaction.date_of_birth) { push(`TEXT 4 0 10 ${y} Date Naiss.: ${transaction.date_of_birth}`);   y += LH; }
  if (transaction.place_of_birth){ push(`TEXT 4 0 10 ${y} Lieu Naiss.: ${t(transaction.place_of_birth)}`); y += LH; }
  if (transaction.parent_phone)  { push(`TEXT 4 0 10 ${y} Tel. Parent: ${t(transaction.parent_phone, 20)}`); y += LH; }

  push(`TEXT 4 0 10 ${y} ${SEP}`); y += LH;

  // Payment details
  push(`TEXT 4 1 10 ${y} DETAILS DU PAIEMENT`);               y += LH;
  push(`TEXT 4 0 10 ${y} Objet: ${t(transaction.type, 26)}`);  y += LH;
  push(`TEXT 4 0 10 ${y} Mode: ${t(payMethod, 26)}`);           y += LH;
  push(`TEXT 4 0 10 ${y} ${SEP}`);                              y += LH;

  // Amount (large font)
  push(`TEXT 4 0 10 ${y} MONTANT PAYE / AMOUNT PAID:`);        y += SH;
  push(`TEXT 7 0 20 ${y} ${t(amount + ' XAF', 22)}`);           y += 55;
  push(`TEXT 4 0 10 ${y} ${SEP}`);                              y += LH;

  // Bursar validation
  push(`TEXT 4 0 10 ${y} Recu par: ${t(transaction.bursar_name || 'Economat', 24)}`); y += LH;
  push(`TEXT 4 0 10 ${y} Signature: _____________________`);    y += LH;
  push(`TEXT 4 0 10 ${y} ${SEP2}`);                             y += LH;

  // Footer
  push(`TEXT 4 0 10 ${y} Conservez ce recu / Keep this receipt`); y += LH;
  push(`TEXT 4 0 10 ${y} Imprime le: ${dateStr} a ${timeStr}`);   y += LH;
  push(`TEXT 4 0 10 ${y} *** MERCI / THANK YOU ***`);             y += LH;
  push(`TEXT 4 0 10 ${y} Trakora School Finance System`);          y += LH;

  push(`FORM`);
  push(`PRINT`);

  const cpclStr = lines.join('\r\n') + '\r\n';

  // ── 4. Send to printer in BLE-safe chunks ────────────────────────────────────
  const encoder  = new TextEncoder();
  const bytes    = encoder.encode(cpclStr);
  const CHUNK_SZ = 512;

  for (let i = 0; i < bytes.length; i += CHUNK_SZ) {
    const chunk = bytes.slice(i, i + CHUNK_SZ);
    if (writeCharacteristic.properties.writeWithoutResponse) {
      await writeCharacteristic.writeValueWithoutResponse(chunk);
    } else {
      await writeCharacteristic.writeValue(chunk);
    }
    await new Promise(r => setTimeout(r, 60)); // Small inter-chunk pause
  }

  alert('Receipt sent successfully!');
  device.gatt.disconnect();
}


// ─── BROWSER PRINT WINDOW ─────────────────────────────────────────────────────

function openBrowserPrintWindow(transaction, schoolConfig) {
  const schoolName = (schoolConfig?.name || 'ÉTABLISSEMENT').toUpperCase();
  const now        = new Date();

  const dateStr = now.toLocaleDateString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
  const timeStr = now.toLocaleTimeString('fr-FR', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });

  const refId = transaction.id
    ? `TRK-${transaction.id.replace(/-/g, '').substring(0, 12).toUpperCase()}`
    : `TRK-${Date.now().toString().slice(-10)}`;

  const amount    = Number(transaction.amount || 0).toLocaleString('fr-FR');
  const payMethod = (transaction.payment_method || 'ESPÈCES / CASH')
    .replace('_SIMULATED', '')
    .replace(/_/g, ' ');

  const row = (label, value) =>
    value
      ? `<tr>
           <td class="lbl">${label}</td>
           <td class="val">${value}</td>
         </tr>`
      : '';

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Reçu — ${transaction.student_name || 'Paiement'}</title>
  <style>
    @page { size: 80mm auto; margin: 2mm 3mm; }
    @media print { .no-print { display: none !important; } body { padding: 0; } }

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: 'Courier New', Courier, monospace;
      font-size: 11px;
      color: #000;
      background: #fff;
      width: 76mm;
      padding: 4mm 2mm;
    }

    .c   { text-align: center; }
    .b   { font-weight: bold; }
    .lg  { font-size: 15px; }
    .xlg { font-size: 22px; }
    .sm  { font-size: 9.5px; }
    .xs  { font-size: 8.5px; }

    .solid { border-top: 2px solid #000; margin: 5px 0; }
    .dash  { border-top: 1px dashed #000; margin: 4px 0; }

    .section-hd {
      font-weight: bold;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      background: #111;
      color: #fff;
      padding: 2px 5px;
      margin: 5px 0 3px;
    }

    table { width: 100%; border-collapse: collapse; }
    td { vertical-align: top; padding: 2px 0; }
    td.lbl {
      color: #444;
      width: 82px;
      padding-right: 4px;
      font-size: 10.5px;
      white-space: nowrap;
    }
    td.val { font-weight: bold; text-align: right; word-break: break-word; font-size: 11px; }

    .amount-box { border: 2px solid #000; padding: 6px 4px; margin: 6px 0; text-align: center; }
    .amount-label { font-size: 9.5px; letter-spacing: 0.8px; text-transform: uppercase; margin-bottom: 3px; }

    .sig-line { display: inline-block; width: 90px; border-bottom: 1px solid #000; margin-bottom: -2px; }

    .stamp { border: 1px dashed #555; padding: 4px 6px; text-align: center; margin-top: 7px; }

    .btn-print {
      display: block; width: 100%; margin: 10mm auto 4mm; padding: 10px;
      background: #111; color: #fff; border: none; border-radius: 6px;
      font-size: 13px; font-weight: bold; cursor: pointer; font-family: sans-serif;
    }
  </style>
</head>
<body>

  <div class="c b lg" style="letter-spacing:2px;">${schoolName}</div>
  <div class="c b" style="font-size:12.5px; margin-top:3px; letter-spacing:0.5px;">REÇU DE PAIEMENT OFFICIEL</div>
  <div class="c sm" style="color:#555; margin-top:1px;">OFFICIAL PAYMENT RECEIPT</div>

  <div class="solid" style="margin-top:7px;"></div>

  <table>
    ${row('Date:', dateStr)}
    ${row('Heure / Time:', timeStr)}
    ${row('Référence:', `<span class="xs">${refId}</span>`)}
  </table>

  <div class="dash"></div>

  <div class="section-hd">▌ Informations Étudiant / Student Info</div>
  <table>
    ${row('Nom / Name:', transaction.student_name || 'N/A')}
    ${row('Matricule:', transaction.matricule || 'N/A')}
    ${row('Classe / Class:', transaction.class_name || null)}
    ${row('Sexe / Gender:', transaction.gender || null)}
    ${row('Date Naiss.:', transaction.date_of_birth || null)}
    ${row('Lieu Naiss.:', transaction.place_of_birth || null)}
    ${row('Tél. Parent:', transaction.parent_phone || null)}
  </table>

  <div class="dash"></div>

  <div class="section-hd">▌ Détails du Paiement / Payment Details</div>
  <table>
    ${row('Objet / Purpose:', transaction.type || 'N/A')}
    ${row('Mode de paiement:', payMethod)}
  </table>

  <div class="dash"></div>

  <div class="amount-box">
    <div class="amount-label b">Montant Payé / Amount Paid</div>
    <div class="xlg b">${amount}&nbsp;XAF</div>
  </div>

  <div class="dash"></div>

  <div class="section-hd">▌ Validation Économe / Bursar Validation</div>
  <table>
    ${row('Reçu par / Rec. by:', transaction.bursar_name || 'Économat')}
    <tr>
      <td class="lbl">Signature:</td>
      <td class="val"><span class="sig-line">&nbsp;</span></td>
    </tr>
  </table>

  <div class="solid" style="margin-top:9px;"></div>

  <div class="stamp">
    <div class="b xs">Ce document est un reçu officiel de paiement.</div>
    <div class="xs">This is an official payment receipt.</div>
    <div class="xs" style="margin-top:2px;">Conservez-le précieusement / Keep it safely.</div>
  </div>

  <div class="c b" style="margin-top:8px; font-size:13px;">★ MERCI &nbsp;/&nbsp; THANK YOU ★</div>

  <div class="xs c" style="color:#666; margin-top:5px;">Imprimé le ${dateStr} à ${timeStr}</div>
  <div class="xs c" style="color:#999; margin-top:1px;">Trakora School Finance System</div>

  <div style="height:12mm;"></div>

  <button class="btn-print no-print" onclick="window.print()">🖨️&nbsp; Imprimer / Print</button>

</body>
</html>`;

  const popup = window.open('', '_blank', 'width=440,height=740,scrollbars=yes,resizable=yes');
  if (popup) {
    popup.document.write(html);
    popup.document.close();
    popup.focus();
    popup.print();
  } else {
    alert(
      '⚠️  Reçu bloqué par le navigateur.\n' +
      'Veuillez autoriser les fenêtres popup pour ce site et réessayer.\n\n' +
      'Receipt blocked by browser.\n' +
      'Please allow popups for this site and try again.'
    );
  }
}