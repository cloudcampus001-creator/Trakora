export const printThermalReceipt = async (transaction, schoolConfig) => {
  try {
    // 1. Request device (Using the specific service we found)
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: ['000018f0-0000-1000-8000-00805f9b34fb'] }]
    });

    const server = await device.gatt.connect();
    const service = await server.getPrimaryService('000018f0-0000-1000-8000-00805f9b34fb');
    // Using the characteristic you identified in image_c7855f.png
    const characteristic = await service.getCharacteristic('bef8d6c9-9c21-4c9e-b632-bd58c1009f9f');

    // 2. Build Binary Commands (ESC/POS Language)
    // 0x1B, 0x40 = Reset Printer
    // 0x0A = Line Feed (Tells printer to print the line)
    const encoder = new TextEncoder();
    const textData = encoder.encode("TESTING PRINT HEAD\n\n\n\n");
    const resetCommand = new Uint8Array([0x1B, 0x40]); 
    const feedCommand = new Uint8Array([0x0A, 0x0A, 0x0A]); // Force paper feed

    // 3. Send the command sequence
    await characteristic.writeValue(resetCommand);
    await characteristic.writeValue(textData);
    await characteristic.writeValue(feedCommand);

    alert("Commands sent! Did it print?");
    device.gatt.disconnect();
  } catch (error) {
    alert("Error: " + error.message);
  }
};