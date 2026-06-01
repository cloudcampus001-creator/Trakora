export const printThermalReceipt = async (transaction, schoolConfig) => {
  try {
    // 1. Request the Bluetooth device (Triggers the browser popup)
    const device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      // Common UUIDs for Chinese portable thermal printers like the MY-7565
      optionalServices: [
        '000018f0-0000-1000-8000-00805f9b34fb', 
        'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
        '49535343-fe7d-4ae5-8fa9-9fafd205e455'
      ] 
    });

    // 2. Connect to the printer's internal GATT server
    const server = await device.gatt.connect();

    // 3. Find the primary data service
    const services = await server.getPrimaryServices();
    if (services.length === 0) throw new Error("No Bluetooth services found.");
    const service = services[0]; 

    // 4. Find the characteristic that allows us to write data to the printer
    const characteristics = await service.getCharacteristics();
    const writeCharacteristic = characteristics.find(
      c => c.properties.write || c.properties.writeWithoutResponse
    );

    if (!writeCharacteristic) throw new Error("Could not find a writable connection.");

    // 5. Setup ESC/POS Commands for styling (Center, Left, Bold)
    const ESC = '\x1B';
    const CENTER = ESC + 'a\x01';
    const LEFT = ESC + 'a\x00';
    const BOLD_ON = ESC + 'E\x01';
    const BOLD_OFF = ESC + 'E\x00';

    // 6. Build the text-based receipt (A standard 58mm printer holds 32 characters per line)
    const text = 
      CENTER + BOLD_ON + 
      (schoolConfig?.name || 'CLOUD CAMPUS') + '\n' + 
      BOLD_OFF + 
      "Official Receipt\n" + 
      "--------------------------------\n" + 
      LEFT + 
      `Date: ${new Date().toLocaleDateString()} \n` +
      `Time: ${new Date().toLocaleTimeString()} \n` +
      `Receipt No: #${transaction.id.slice(-6).toUpperCase()} \n` +
      `Cashier: ${transaction.bursar_name || 'System Auto'} \n` +
      "--------------------------------\n" + 
      BOLD_ON + "STUDENT DETAILS\n" + BOLD_OFF +
      `Name: ${transaction.student_name}\n` +
      `Matricule: ${transaction.matricule || 'N/A'}\n` +
      "--------------------------------\n" + 
      "DESCRIPTION               AMOUNT\n" +
      // Pad the type string to align the amount to the right
      `${transaction.type.padEnd(20)} ${Number(transaction.amount).toLocaleString()}\n` +
      "--------------------------------\n" + 
      BOLD_ON +
      `TOTAL PAID:           ${Number(transaction.amount).toLocaleString()} XAF\n` +
      BOLD_OFF +
      `Method: ${transaction.payment_method}\n` +
      "--------------------------------\n" + 
      CENTER +
      "Thank you for your payment!\n" +
      "Powered by Cloud Campus\n" +
      "\n\n\n\n"; // Feeds extra paper so the bursar can tear it cleanly

    // 7. Encode the string into bytes
    const encoder = new TextEncoder();
    const data = encoder.encode(text);

    // 8. Stream the bytes in 20-byte chunks to prevent overwhelming the printer's memory
    const CHUNK_SIZE = 20;
    for (let i = 0; i < data.length; i += CHUNK_SIZE) {
      const chunk = data.slice(i, i + CHUNK_SIZE);
      await writeCharacteristic.writeValue(chunk);
    }

    // 9. Disconnect cleanly
    device.gatt.disconnect();
    console.log("Receipt printed successfully!");

  } catch (error) {
    console.error("Bluetooth Printing Failed:", error);
    // If the user cancels the popup, it throws a DOMException, which we can safely ignore
    if (error.name !== 'NotFoundError') {
        alert("Bluetooth Error: " + error.message);
    }
  }
};