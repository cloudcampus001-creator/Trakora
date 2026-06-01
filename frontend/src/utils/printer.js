export const generateReceiptBytes = (receiptData) => {
  // Destructure the incoming data to ensure we have all required fields
  const {
    schoolName = "Cloud Campus",
    bursarName = "System Bursar",
    studentName = "N/A",
    matricule = "N/A",
    studentClass = "N/A",
    amount = 0,
    purpose = "General Payment",
  } = receiptData;

  const encoder = new TextEncoder();
  const bytes = [];

  // Helper function to dynamically push text or hex commands into the buffer
  const push = (...args) => {
    args.forEach((arg) => {
      if (typeof arg === "string") {
        bytes.push(...encoder.encode(arg));
      } else if (Array.isArray(arg)) {
        bytes.push(...arg);
      } else {
        bytes.push(arg);
      }
    });
  };

  // Standard ESC/POS Hex Commands
  const ESC = 0x1B;
  const GS = 0x1D;
  const INIT = [ESC, 0x40];
  const ALIGN_CENTER = [ESC, 0x61, 0x01];
  const ALIGN_LEFT = [ESC, 0x61, 0x00];
  const BOLD_ON = [ESC, 0x45, 0x01];
  const BOLD_OFF = [ESC, 0x45, 0x00];
  const CUT_PAPER = [GS, 0x56, 0x41, 0x10]; 
  
  const LF = "\n";
  const LINE = "--------------------------------\n"; // 32-character separator

  // Automatically generate the exact print time
  const printTime = new Date().toLocaleString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  // --- START PRINTING SEQUENCE ---

  push(INIT);

  // 1. Header (School Name)
  push(ALIGN_CENTER);
  push(BOLD_ON);
  push(schoolName.toUpperCase(), LF);
  push(BOLD_OFF);
  push(LINE);
  push("OFFICIAL PAYMENT RECEIPT", LF);
  push(LINE);

  // 2. Meta Information
  push(ALIGN_LEFT);
  push(`Date : ${printTime}`, LF);
  push(`Served By : ${bursarName}`, LF);
  push(LINE);

  // 3. Student Information
  push(BOLD_ON);
  push("STUDENT DETAILS", LF);
  push(BOLD_OFF);
  push(`Name      : ${studentName}`, LF);
  push(`Matricule : ${matricule}`, LF);
  push(`Class     : ${studentClass}`, LF);
  push(LINE);

  // 4. Financial/Payment Information
  push(BOLD_ON);
  push("PAYMENT DETAILS", LF);
  push(BOLD_OFF);
  push(`Purpose   : ${purpose}`, LF);
  push(`Amount    : ${amount.toLocaleString()} XAF`, LF);
  push(LINE);

  // 5. Footer & Cut Command
  push(ALIGN_CENTER);
  push("Thank you for your payment.", LF);
  push("Powered by Trakora", LF);
  
  // Feed paper a few lines before cutting
  push(LF, LF, LF, LF); 
  push(CUT_PAPER);

  // Return the raw byte array formatted for the Bluetooth peripheral
  return new Uint8Array(bytes);
};