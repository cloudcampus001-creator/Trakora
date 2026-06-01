/**
 * Trakora — Bluetooth CPCL Receipt Printer
 * PT260 & compatible thermal printers
 */

export const printThermalReceipt = async (transaction, schoolConfig) => {
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

  const t = (str, max = 28) => String(str || '').substring(0, max);

  try {
    alert('Connecting and scanning for print channel...');

    // 1. Request device
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: ['000018f0-0000-1000-8000-00805f9b34fb'] }],
    });
    const server = await device.gatt.connect();

    // 2. Find writable characteristic
    const services = await server.getPrimaryServices();
    let writeCharacteristic = null;

    for (const service of services) {
      const characteristics = await service.getCharacteristics();
      writeCharacteristic = characteristics.find(
        c => c.properties.write || c.properties.writeWithoutResponse
      );
      if (writeCharacteristic) break;
    }

    if (!writeCharacteristic) {
      throw new Error('Could not find a writable channel. Please restart the printer.');
    }

    // 3. Build CPCL receipt
    const SEP  = '-'.repeat(36);
    const SEP2 = '='.repeat(36);
    const lines = [];
    let y = 10;
    const LH = 30;
    const SH = 24;
    const push = (...args) => lines.push(...args);

    push(`! 0 200 200 1200 1`);

    push(`TEXT 7 0 20 ${y} ${t(schoolName, 20)}`);              y += 48;
    push(`TEXT 4 0 10 ${y} RECU DE PAIEMENT OFFICIEL`);          y += LH;
    push(`TEXT 4 0 10 ${y} OFFICIAL PAYMENT RECEIPT`);           y += LH;
    push(`TEXT 4 0 10 ${y} ${SEP2}`);                             y += LH;

    push(`TEXT 4 0 10 ${y} Date: ${dateStr}  Heure: ${timeStr}`); y += LH;
    push(`TEXT 4 0 10 ${y} Reference: ${refId}`);                 y += LH;
    push(`TEXT 4 0 10 ${y} ${SEP}`);                              y += LH;

    push(`TEXT 4 1 10 ${y} INFORMATIONS ETUDIANT`);               y += LH;
    push(`TEXT 4 0 10 ${y} Nom: ${t(transaction.student_name)}`);      y += LH;
    push(`TEXT 4 0 10 ${y} Matricule: ${t(transaction.matricule, 22)}`); y += LH;

    if (transaction.class_name)     { push(`TEXT 4 0 10 ${y} Classe: ${t(transaction.class_name)}`);          y += LH; }
    if (transaction.gender)         { push(`TEXT 4 0 10 ${y} Sexe: ${t(transaction.gender, 10)}`);             y += LH; }
    if (transaction.date_of_birth)  { push(`TEXT 4 0 10 ${y} Date Naiss.: ${transaction.date_of_birth}`);     y += LH; }
    if (transaction.place_of_birth) { push(`TEXT 4 0 10 ${y} Lieu Naiss.: ${t(transaction.place_of_birth)}`); y += LH; }
    if (transaction.parent_phone)   { push(`TEXT 4 0 10 ${y} Tel. Parent: ${t(transaction.parent_phone, 20)}`); y += LH; }

    push(`TEXT 4 0 10 ${y} ${SEP}`); y += LH;

    push(`TEXT 4 1 10 ${y} DETAILS DU PAIEMENT`);                y += LH;
    push(`TEXT 4 0 10 ${y} Objet: ${t(transaction.type, 26)}`);   y += LH;
    push(`TEXT 4 0 10 ${y} Mode: ${t(payMethod, 26)}`);            y += LH;
    push(`TEXT 4 0 10 ${y} ${SEP}`);                               y += LH;

    push(`TEXT 4 0 10 ${y} MONTANT PAYE / AMOUNT PAID:`);         y += SH;
    push(`TEXT 7 0 20 ${y} ${t(amount + ' XAF', 22)}`);            y += 55;
    push(`TEXT 4 0 10 ${y} ${SEP}`);                               y += LH;

    push(`TEXT 4 0 10 ${y} Recu par: ${t(transaction.bursar_name || 'Economat', 24)}`); y += LH;
    push(`TEXT 4 0 10 ${y} Signature: _____________________`);     y += LH;
    push(`TEXT 4 0 10 ${y} ${SEP2}`);                              y += LH;

    push(`TEXT 4 0 10 ${y} Conservez ce recu / Keep this receipt`); y += LH;
    push(`TEXT 4 0 10 ${y} Imprime le: ${dateStr} a ${timeStr}`);   y += LH;
    push(`TEXT 4 0 10 ${y} *** MERCI / THANK YOU ***`);             y += LH;
    push(`TEXT 4 0 10 ${y} Trakora School Finance System`);          y += LH;

    push(`FORM`);
    push(`PRINT`);

    const cpclStr = lines.join('\r\n') + '\r\n';

    // 4. Send in BLE-safe chunks
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
      await new Promise(r => setTimeout(r, 60));
    }

    alert('Receipt sent successfully!');
    device.gatt.disconnect();

  } catch (error) {
    alert('Error: ' + error.message);
    console.error(error);
  }
};