export const printThermalReceipt = async (transaction, schoolConfig) => {
  try {
    // 1. Request device
    const device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: ['000018f0-0000-1000-8000-00805f9b34fb', '00001800-0000-1000-8000-00805f9b34fb']
    });

    const server = await device.gatt.connect();
    const service = await server.getPrimaryService('000018f0-0000-1000-8000-00805f9b34fb'); // Try this service first
    const characteristic = await service.getCharacteristic('00002ae1-0000-1000-8000-00805f9b34fb'); // Standard Write characteristic

    // 2. The Simplest Possible Test
    // Just plain text, no ESC codes
    const encoder = new TextEncoder();
    const data = encoder.encode("HELLO WORLD TEST\n\n\n\n");

    // 3. Write data
    await characteristic.writeValue(data);
    
    alert("Data sent to printer!");
    device.gatt.disconnect();
  } catch (error) {
    alert("Error: " + error.message);
  }
};