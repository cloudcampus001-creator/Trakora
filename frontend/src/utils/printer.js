export const printThermalReceipt = async (transaction, schoolConfig) => {
  try {
    alert("Connecting... please wait.");
    const device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: [
        '000018f0-0000-1000-8000-00805f9b34fb', // Common printer service
        '00001800-0000-1000-8000-00805f9b34fb',
        'e7810a71-73ae-499d-8c15-faa9aef0c3f2'
      ]
    });

    const server = await device.gatt.connect();
    const services = await server.getPrimaryServices();
    const encoder = new TextEncoder();
    const data = encoder.encode("TEST PRINT\n\n\n\n");

    let foundWritable = false;

    // Loop through EVERYTHING
    for (const service of services) {
      console.log("Checking Service: " + service.uuid);
      const characteristics = await service.getCharacteristics();
      
      for (const char of characteristics) {
        console.log("Checking Characteristic: " + char.uuid);
        
        // Only try to write if the characteristic supports 'write'
        if (char.properties.write || char.properties.writeWithoutResponse) {
          try {
            console.log("Attempting to write to: " + char.uuid);
            await char.writeValue(data);
            alert("SUCCESS! Wrote to: " + char.uuid);
            foundWritable = true;
            // If this works, we stop.
            return; 
          } catch (e) {
            console.error("Failed to write to " + char.uuid, e);
          }
        }
      }
    }

    if (!foundWritable) {
      alert("No writable characteristics found. The printer is connected, but I cannot find a 'write' channel.");
    }

    device.gatt.disconnect();
  } catch (error) {
    alert("Error: " + error.message);
  }
};