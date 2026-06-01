export const printThermalReceipt = async (transaction, schoolConfig) => {
  try {
    // 1. Request device
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: ['000018f0-0000-1000-8000-00805f9b34fb'] }]
    });

    const server = await device.gatt.connect();
    const service = await server.getPrimaryService('000018f0-0000-1000-8000-00805f9b34fb');
    // Using the characteristic you identified previously
    const characteristic = await service.getCharacteristic('bef8d6c9-9c21-4c9e-b632-bd58c1009f9f');

    // 2. Build CPCL Command Set
    // ! 0 200 200 200 1 : Start Label (offset 0, horiz res 200, vert res 200, height 200, count 1)
    // TEXT 7 0 10 10 : Font 7, Size 0, X=10, Y=10
    const cpclCommands = [
      '! 0 200 200 400 1\r\n',
      'TEXT 7 0 10 10 CLOUD CAMPUS\r\n',
      'TEXT 4 0 10 60 --------------------\r\n',
      `TEXT 4 0 10 100 Student: ${transaction.student_name}\r\n`,
      `TEXT 4 0 10 140 Amount: ${Number(transaction.amount).toLocaleString()} XAF\r\n`,
      'PRINT\r\n'
    ].join('');

    // 3. Encode and send
    const encoder = new TextEncoder();
    const data = encoder.encode(cpclCommands);
    
    await characteristic.writeValue(data);
    
    alert("CPCL Command sent!");
    device.gatt.disconnect();
  } catch (error) {
    alert("Error: " + error.message);
  }
};