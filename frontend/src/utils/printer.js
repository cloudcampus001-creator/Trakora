export const printThermalReceipt = async (transaction, schoolConfig) => {
  try {
    alert("Connecting and scanning for print channel...");
    
    // 1. Request device (Filter by printer service)
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: ['000018f0-0000-1000-8000-00805f9b34fb'] }]
    });

    const server = await device.gatt.connect();
    
    // 2. Discover all services
    const services = await server.getPrimaryServices();
    let writeCharacteristic = null;

    // 3. Loop through services and characteristics to find the 'write' channel
    for (const service of services) {
      const characteristics = await service.getCharacteristics();
      writeCharacteristic = characteristics.find(
        c => c.properties.write || c.properties.writeWithoutResponse
      );
      if (writeCharacteristic) break; // Found it!
    }

    if (!writeCharacteristic) {
      throw new Error("Could not find a writable channel. Please restart the printer.");
    }

    // 4. Build CPCL Commands (Language for your PT260)
    const cpclCommands = [
      '! 0 200 200 400 1\r\n',
      'TEXT 7 0 10 10 CLOUD CAMPUS\r\n',
      'TEXT 4 0 10 60 --------------------\r\n',
      `TEXT 4 0 10 100 Student: ${transaction.student_name}\r\n`,
      `TEXT 4 0 10 140 Amount: ${Number(transaction.amount).toLocaleString()} XAF\r\n`,
      'PRINT\r\n'
    ].join('');

    // 5. Send
    const encoder = new TextEncoder();
    await writeCharacteristic.writeValue(encoder.encode(cpclCommands));
    
    alert("Data sent successfully via dynamic channel!");
    device.gatt.disconnect();
  } catch (error) {
    alert("Error: " + error.message);
    console.error(error);
  }
};