/**
 * Trakora — Bluetooth CPCL Receipt Printer
 * Calibrated for 58 mm paper (PT-260 & compatible)
 */
import { toast } from 'react-hot-toast';

export const printThermalReceipt = async (transaction, schoolConfig, silent = false) => {
  const schoolName = (schoolConfig?.name || 'SCHOOL').toUpperCase();
  const now        = new Date();
  const dateStr    = now.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const timeStr    = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const refId      = transaction.id
    ? `TRK-${transaction.id.replace(/-/g, '').substring(0, 12).toUpperCase()}`
    : 'N/A';
  
  // Safe formatting using en-US to prevent Chinese GBK character glitches on the PT-260
  const amount    = Number(transaction.amount || 0).toLocaleString('en-US').replace(/,/g, ' ');
  const payMethod = (transaction.payment_method || 'ESPECES')
    .replace('_SIMULATED', '')
    .replace(/_/g, ' ');

  const t = (str, max = 20) => String(str || '').substring(0, max);

  try {
    if (!silent) console.log('Connecting and scanning for print channel...');

    // Request device (Browser will try to auto-connect if already paired in this session)
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: ['000018f0-0000-1000-8000-00805f9b34fb'] }],
    });
    const server = await device.gatt.connect();

    // Find writable characteristic
    const services = await server.getPrimaryServices();
    let writeChar = null;
    for (const service of services) {
      const chars = await service.getCharacteristics();
      writeChar = chars.find(c => c.properties.write || c.properties.writeWithoutResponse);
      if (writeChar) break;
    }
    if (!writeChar) throw new Error('Could not find a writable channel.');

    // Build CPCL Layout
    const LH  = 40;  
    const BIG = 55;  
    const SEP  = '-'.repeat(20); 
    const SEP2 = '='.repeat(20);

    const lines = [];
    let y = 10;
    const push = (...args) => lines.push(...args);

    push(`! 0 200 200 1600 1`); 
    push(`TEXT 7 0 10 ${y} ${t(schoolName, 10)}`);        y += BIG;
    push(`TEXT 4 0 10 ${y} RECU DE PAIEMENT`);             y += LH;
    push(`TEXT 4 0 10 ${y} OFFICIAL RECEIPT`);             y += LH;
    push(`TEXT 4 0 10 ${y} ${SEP2}`);                       y += LH;

    push(`TEXT 4 0 10 ${y} Date: ${dateStr}`);              y += LH;
    push(`TEXT 4 0 10 ${y} Heure: ${timeStr}`);             y += LH;
    push(`TEXT 4 0 10 ${y} Ref: ${t(refId, 16)}`);          y += LH;
    push(`TEXT 4 0 10 ${y} ${SEP}`);                        y += LH;

    push(`TEXT 4 0 10 ${y} INFO. ETUDIANT`);                y += LH;
    push(`TEXT 4 0 10 ${y} Nom: ${t(transaction.student_name, 15)}`);    y += LH;
    push(`TEXT 4 0 10 ${y} Matr: ${t(transaction.matricule, 14)}`);      y += LH;

    if (transaction.class_name)     { push(`TEXT 4 0 10 ${y} Classe: ${t(transaction.class_name, 12)}`);   y += LH; }
    if (transaction.gender)         { push(`TEXT 4 0 10 ${y} Sexe: ${t(transaction.gender, 14)}`);          y += LH; }
    if (transaction.date_of_birth)  { push(`TEXT 4 0 10 ${y} Naiss: ${t(transaction.date_of_birth, 13)}`); y += LH; }
    if (transaction.place_of_birth) { push(`TEXT 4 0 10 ${y} Lieu: ${t(transaction.place_of_birth, 14)}`); y += LH; }
    if (transaction.parent_phone)   { push(`TEXT 4 0 10 ${y} Tel: ${t(transaction.parent_phone, 15)}`);    y += LH; }

    push(`TEXT 4 0 10 ${y} ${SEP}`);                        y += LH;

    push(`TEXT 4 0 10 ${y} DETAILS PAIEMENT`);              y += LH;
    push(`TEXT 4 0 10 ${y} ${t('Objet: ' + (transaction.type || 'N/A'), 20)}`); y += LH;
    push(`TEXT 4 0 10 ${y} ${t('Mode: ' + payMethod, 20)}`); y += LH;
    push(`TEXT 4 0 10 ${y} ${SEP}`);                        y += LH;

    push(`TEXT 4 0 10 ${y} MONTANT PAYE:`);                 y += LH;
    push(`TEXT 7 0 10 ${y} ${t(amount, 10)}`);              y += BIG;
    push(`TEXT 4 0 10 ${y} XAF`);                           y += LH;
    push(`TEXT 4 0 10 ${y} ${SEP}`);                        y += LH;

    push(`TEXT 4 0 10 ${y} Par: ${t(transaction.bursar_name || 'Economat', 15)}`); y += LH;
    push(`TEXT 4 0 10 ${y} Signature: _________`);          y += LH;
    push(`TEXT 4 0 10 ${y} ${SEP2}`);                       y += LH;

    push(`TEXT 4 0 10 ${y} Conservez ce recu`);             y += LH;
    push(`TEXT 4 0 10 ${y} Keep this receipt`);             y += LH;
    push(`TEXT 4 0 10 ${y} ${dateStr} ${timeStr.substring(0, 5)}`); y += LH;
    push(`TEXT 4 0 10 ${y} MERCI / THANK YOU`);             y += LH;
    push(`TEXT 4 0 10 ${y} Trakora Finance`);               y += LH;

    push(`FORM`);
    push(`PRINT`);

    // Send line-by-line — never splits a CPCL command across packets
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

    if (!silent) toast.success('Receipt sent to printer!');
    device.gatt.disconnect();

  } catch (error) {
    console.error("Bluetooth Printing Failed:", error);
    if (!silent) toast.error('Printer Error: ' + error.message, { duration: 4000 });
  }
};