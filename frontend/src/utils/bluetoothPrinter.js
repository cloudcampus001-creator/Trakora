export async function connectAndPrintReceipt(txData) {
  try {
    // Standard ESC/POS commands in Hex arrays
    const ENCODER = new TextEncoder();
    const RESET = new Uint8Array([0x1B, 0x40]);
    const CENTER = new Uint8Array([0x1B, 0x61, 0x01]);
    const LEFT = new Uint8Array([0x1B, 0x61, 0x00]);
    const BOLD_ON = new Uint8Array([0x1B, 0x45, 0x01]);
    const BOLD_OFF = new Uint8Array([0x1B, 0x45, 0x00]);
    const FEED_CUT = new Uint8Array([0x1D, 0x56, 0x41, 0x08]);

    // Connect to the device using Web Bluetooth
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: ['000018f0-0000-1000-8000-00805f9b34fb'] }, { namePrefix: 'MTP' }, { namePrefix: 'PT' }]
    });
    
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService('000018f0-0000-1000-8000-00805f9b34fb');
    const characteristic = await service.getCharacteristic('00002af1-0000-1000-8000-00805f9b34fb');

    async function send(bytes) {
      await characteristic.writeValue(bytes);
    }

    // Assemble text lines for the print output
    await send(RESET);
    await send(CENTER);
    await send(BOLD_ON);
    await send(ENCODER.encode(`${txData.school_name}\n`));
    await send(ENCODER.encode(`OFFICIAL PAYMENT RECEIPT\n`));
    await send(BOLD_OFF);
    await send(ENCODER.encode(`--------------------------------\n`));
    await send(LEFT);
    await send(ENCODER.encode(`Matricule: ${txData.matricule}\n`));
    await send(ENCODER.encode(`Student:   ${txData.student_name}\n`));
    await send(ENCODER.encode(`Class:     ${txData.class_name}\n`));
    await send(ENCODER.encode(`Type:      ${txData.type}\n`));
    await send(BOLD_ON);
    await send(ENCODER.encode(`Amount:    ${txData.amount} XAF\n`));
    await send(BOLD_OFF);
    await send(ENCODER.encode(`Date:      ${new Date(txData.created_at).toLocaleString()}\n`));
    await send(ENCODER.encode(`Ref ID:    ${txData.tx_id.substring(0,8)}\n`));
    await send(ENCODER.encode(`--------------------------------\n`));
    await send(CENTER);
    
    // Add an ASCII visual indicator for verification verification 
    await send(ENCODER.encode(`[ QR CODE SECURE AUTH ]\n`));
    await send(ENCODER.encode(`Scan to verify authenticity:\n`));
    await send(ENCODER.encode(`verify.edu-ledger.com/tx/${txData.tx_id}\n\n`));
    
    await send(FEED_CUT);
    return true;
  } catch (error) {
    console.error("Hardware printing execution fault: ", error);
    alert("Printer Connection Failed. Ensure Bluetooth is active and printer is paired.");
    return false;
  }
}