export const printThermalReceipt = async (transaction, schoolConfig) => {
  try {
    alert("Searching for printer...");
    
    const device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: [
        '000018f0-0000-1000-8000-00805f9b34fb', 
        'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
        '49535343-fe7d-4ae5-8fa9-9fafd205e455',
        '00001800-0000-1000-8000-00805f9b34fb'
      ] 
    });

    alert("Connecting to: " + device.name);
    const server = await device.gatt.connect();
    
    const services = await server.getPrimaryServices();
    // Try to find a service that looks like a printer (often starts with 000018)
    const service = services.find(s => s.uuid.startsWith('000018')) || services[0];
    
    const characteristics = await service.getCharacteristics();
    // This looks for the most compatible write characteristic
    const writeCharacteristic = characteristics.find(
      c => c.properties.write || c.properties.writeWithoutResponse
    );

    if (!writeCharacteristic) throw new Error("No write characteristic found.");
    alert("Printer ready. Sending data...");

    // COMMANDS
    const ESC = '\x1B';
    const INIT = ESC + '@'; // Reset printer
    const CENTER = ESC + 'a\x01';
    const BOLD_ON = ESC + 'E\x01';
    const BOLD_OFF = ESC + 'E\x00';
    const FEED = '\n\n\n\n';

    const text = 
      INIT + CENTER + BOLD_ON + (schoolConfig?.name || 'CLOUD CAMPUS') + '\n' +
      "Official Receipt\n" + 
      "--------------------------------\n" +
      `Receipt: #${transaction.id.slice(-6).toUpperCase()}\n` +
      `Student: ${transaction.student_name}\n` +
      "--------------------------------\n" +
      `${transaction.type.padEnd(20)} ${Number(transaction.amount).toLocaleString()}\n` +
      "--------------------------------\n" +
      BOLD_ON + `TOTAL: ${Number(transaction.amount).toLocaleString()} XAF` + BOLD_OFF +
      "\n\n\n" + FEED;

    const encoder = new TextEncoder();
    const data = encoder.encode(text);

    // Write in small chunks with a tiny delay to ensure the printer keeps up
    for (let i = 0; i < data.length; i += 20) {
      const chunk = data.slice(i, i + 20);
      await writeCharacteristic.writeValue(chunk);
      // Tiny delay to prevent buffer overflow
      await new Promise(r => setTimeout(r, 50)); 
    }

    alert("Print command sent successfully!");
    device.gatt.disconnect();

  } catch (error) {
    console.error(error);
    alert("Error: " + error.message);
  }
};