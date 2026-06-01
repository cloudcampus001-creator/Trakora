export const printThermalReceipt = async (transaction, schoolConfig) => {
  try {
    // 1. Request the device with expanded UUID coverage for the MY-7565
    const device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: [
        0x18F0, 
        0xFF00, // Very common primary service for Baihuo/portable printers
        '000018f0-0000-1000-8000-00805f9b34fb', 
        '0000ff00-0000-1000-8000-00805f9b34fb',
        'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
        '49535343-fe7d-4ae5-8fa9-9fafd205e455'
      ] 
    });

    const server = await device.gatt.connect();
    const services = await server.getPrimaryServices();
    
    let writeCharacteristic = null;

    // 2. Loop through EVERY service to find the active print channel
    for (const service of services) {
      const characteristics = await service.getCharacteristics();
      for (const characteristic of characteristics) {
        if (characteristic.properties.writeWithoutResponse || characteristic.properties.write) {
          writeCharacteristic = characteristic;
          break; // Found the correct channel
        }
      }
      if (writeCharacteristic) break; // Stop searching once found
    }

    if (!writeCharacteristic) {
      throw new Error("Could not find a writable print channel. Ensure the printer is ready.");
    }

    // 3. Set up ESC/POS Commands
    const ESC = '\x1B';
    const INIT = ESC + '@'; // Initialize printer (Clears any stuck memory buffers)
    const CENTER = ESC + 'a\x01';
    const LEFT = ESC + 'a\x00';
    const BOLD_ON = ESC + 'E\x01';
    const BOLD_OFF = ESC + 'E\x00';

    // 4. Build the receipt
    const text = 
      INIT + // Send clear command first
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
      `${transaction.type.padEnd(20)} ${Number(transaction.amount).toLocaleString()}\n` +
      "--------------------------------\n" + 
      BOLD_ON +
      `TOTAL PAID:           ${Number(transaction.amount).toLocaleString()} XAF\n` +
      BOLD_OFF +
      `Method: ${transaction.payment_method}\n` +
      "--------------------------------\n" + 
      CENTER +
      "Thank you for your payment!\n" +
      "\n\n\n"; 

    // 5. Encode the text into bytes
    const encoder = new TextEncoder();
    const data = encoder.encode(text);

    // 6. Stream the bytes in small 20-byte chunks 
    const CHUNK_SIZE = 20;
    for (let i = 0; i < data.length; i += CHUNK_SIZE) {
      const chunk = data.slice(i, i + CHUNK_SIZE);
      
      // Android Chrome prefers writeValueWithoutResponse to prevent freezing
      if (writeCharacteristic.properties.writeWithoutResponse) {
        await writeCharacteristic.writeValueWithoutResponse(chunk);
      } else {
        await writeCharacteristic.writeValue(chunk); 
      }
      
      // Tiny 10ms delay to give the MY-7565 buffer time to process the bytes
      await new Promise(resolve => setTimeout(resolve, 10)); 
    }

    // 7. Clean up
    device.gatt.disconnect();
    
    // Give the bursar confirmation that the data sent successfully
    alert("Receipt printed successfully!");

  } catch (error) {
    console.error("Bluetooth Error:", error);
    if (error.name !== 'NotFoundError') {
        alert("Print Error: " + error.message);
    }
  }
};