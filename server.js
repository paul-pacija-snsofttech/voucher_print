const express = require("express");
const bodyParser = require("body-parser");
const path = require("path");
const { SerialPort } = require("serialport");

const app = express();
const PORT = 3000;

// Update this with your actual Epic Edge device path (check with ls /dev/tty.*)
const SERIAL_PATH = "/dev/cu.usbmodemEpic_Edge1";
const BAUD_RATE = 9600;

let printerPort;

// Open serial port
try {
  printerPort = new SerialPort({
    path: SERIAL_PATH,
    baudRate: BAUD_RATE,
    autoOpen: true,
  });

  printerPort.on("open", () =>
    console.log(`✅ Printer connected at ${SERIAL_PATH}`)
  );
  printerPort.on("error", (err) =>
    console.error("❌ Printer error:", err.message)
  );
} catch (err) {
  console.error("❌ Failed to open printer:", err.message);
}

// Middleware
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "public")));

// function for converting number to pesos
function numberToPesos(num) {
  if (typeof num !== "number") num = parseFloat(num);
  if (isNaN(num)) return "Invalid amount";

  const ones = [
    "",
    "ONE",
    "TWO",
    "THREE",
    "FOUR",
    "FIVE",
    "SIX",
    "SEVEN",
    "EIGHT",
    "NINE",
    "TEN",
    "ELEVEN",
    "TWELVE",
    "thirteen",
    "FOURTEEN",
    "FIFTEEN",
    "SIXTEEN",
    "SEVENTEEN",
    "EIGHTEEN",
    "NINETEEN",
  ];
  const tens = [
    "",
    "",
    "TWENTY",
    "THIRTY",
    "FORTY",
    "FIFTY",
    "SIXTY",
    "SEVENTY",
    "EIGHTY",
    "NINETY",
  ];
  const scales = ["", "THOUSAND", "MILLION", "BILLION"];

  function inWords(n) {
    if (n === 0) return "ZERO";
    let words = "";

    let scaleIdx = 0;
    while (n > 0) {
      let chunk = n % 1000;
      if (chunk) {
        let chunkWords = "";
        let hundreds = Math.floor(chunk / 100);
        let remainder = chunk % 100;

        if (hundreds) {
          chunkWords += ones[hundreds] + " HUNDRED";
          if (remainder) chunkWords += " ";
        }
        if (remainder < 20) {
          chunkWords += ones[remainder];
        } else {
          let t = Math.floor(remainder / 10);
          let o = remainder % 10;
          chunkWords += tens[t];
          if (o) chunkWords += "-" + ones[o];
        }

        words =
          chunkWords + " " + scales[scaleIdx] + (words ? " " + words : "");
      }
      n = Math.floor(n / 1000);
      scaleIdx++;
    }

    return words.trim();
  }

  const pesos = Math.floor(num);
  const centavos = Math.round((num - pesos) * 100);

  let result = inWords(pesos) + " PESO" + (pesos === 1 ? "" : "S");
  if (centavos > 0) {
    result +=
      " AND " + inWords(centavos) + " CENTAVO" + (centavos === 1 ? "" : "S");
  } else {
    result += " AND NO CENTAVO";
  }

  return result.charAt(0).toUpperCase() + result.slice(1);
}

/**
 * Build ticket with landscape + barcode
 */
function buildTicket({
  location,
  assetId,
  floorLocation,
  voucherType,
  validDate,
  amount,
  validation,
  ticketNo,
  time,
}) {
  // --- Helpers ---
  function escX(pos) {
    const n1 = Math.floor(pos / 256);
    const n2 = pos % 256;
    return Buffer.from([0x1b, 0x58, n1, n2]); // ESC X
  }
  function escY(y) {
    return Buffer.from([0x1b, 0x59, y]); // ESC Y (mm)
  }

  // NEW: center helper (ESC mode doesn’t have CENTER)
  function centerX(text, fontWidthDots = 12, pageWidthDots = 980) {
    // total width of text in dots
    const textWidth = text.length * fontWidthDots;

    // position so that text is centered
    const pos = Math.max(0, Math.floor((pageWidthDots - textWidth) / 2));

    const n1 = Math.floor(pos / 256);
    const n2 = pos % 256;

    console.log(n1, n2);

    return Buffer.from([0x1b, 0x58, n1, n2]); // ESC X
  }

  // Right alignment (align so text ends at right margin)
  function rightX(text, fontWidthDots = 12, pageWidthDots = 1000, margin = 50) {
    const textWidth = text.length * fontWidthDots;
    const pos = Math.max(0, pageWidthDots - textWidth - margin);
    const n1 = Math.floor(pos / 256);
    const n2 = pos % 256;
    return Buffer.from([0x1b, 0x58, n1, n2]); // ESC X
  }

  function centerBarcode(data, moduleWidth = 6, pageWidthDots = 1000) {
    const dataLength = data.length;

    // Empirical formula based on Epic Edge behavior
    const modulesPerChar = 6.2; // instead of 11

    const totalModules = Math.round(dataLength * modulesPerChar);
    const barcodeWidth = totalModules * moduleWidth;

    const pos = Math.floor((pageWidthDots - barcodeWidth) / 2);
    return escX(pos);
  }

  // --- Base setup ---
  const reset = Buffer.from([0x1b, 0x2a]); // Reset
  const landscape = Buffer.from([0x1d, 0x56, 0x01]); // Landscape
  const fontNormal = Buffer.from([0x1b, 0x46, 12, 12, 0]); // 12pt
  const fontSmall = Buffer.from([0x1b, 0x46, 8, 8, 0]); // 8pt
  const fontLargeBold = Buffer.from([0x1b, 0x46, 24, 24, 1]); // 24pt bold
  const fontThin = Buffer.from([0x1b, 0x46, 10, 10, 0]); // thin (Arial-ish)

  const cleanValidation = (validation || "").replace(/\D/g, ""); // for barcode

  // --- Barcode (Code128-B) ---
  const barcode = Buffer.concat([
    Buffer.from([0x1d, 0x68, 210]), // Height
    Buffer.from([0x1d, 0x77, 6]), // Width
    Buffer.from([0x1d, 0x6b, 0x09, cleanValidation.length]),
    Buffer.from(cleanValidation, "ascii"),
  ]);

  // --- Content ---
  return Buffer.concat([
    reset,
    landscape,

    // VoucherType centered
    centerX(voucherType, 24, 950),
    escY(5),
    fontLargeBold,
    Buffer.from(`${voucherType}\n`, "ascii"),

    // Barcode centered
    centerBarcode(cleanValidation, 4),
    escY(12),
    barcode,
    Buffer.from("\n", "ascii"),

    // Validation centered
    centerX(`VALIDATION ${validation}`, 12),
    escY(40),
    fontNormal,
    Buffer.from(`VALIDATION ${validation}\n`, "ascii"),

    // Amount in words centered
    centerX(numberToPesos(amount), 10, 900),
    escY(45),
    fontThin,
    Buffer.from(`${numberToPesos(amount)}\n`, "ascii"),

    // Amount numeric centered
    centerX(`PHP${amount}`, 24),
    escY(50),
    fontLargeBold,
    Buffer.from(`PHP${amount}\n`, "ascii"),

    // Date + asset info left
    escX(0),
    escY(48),
    fontNormal,
    Buffer.from(`${validDate}\n`, "ascii"),

    escX(0),
    escY(53),
    fontThin,
    Buffer.from(`ASSET# ${assetId}   Ticket# ${ticketNo}\n`, "ascii"),

    // Time + expiry right
    rightX(time, 12, 950, 0),
    escY(48),
    fontNormal,
    Buffer.from(`${time}\n`, "ascii"),

    rightX("Never Expires", 10, 950, 0),
    escY(53),
    fontThin,
    Buffer.from(`Never Expires\n`, "ascii"),

    Buffer.from([0x0c]), // Form feed
  ]);
}

function buildDiagnosticTicket() {
  function escX(pos) {
    const n1 = Math.floor(pos / 256);
    const n2 = pos % 256;
    return Buffer.from([0x1b, 0x58, n1, n2]); // ESC X
  }
  function escY(y) {
    return Buffer.from([0x1b, 0x59, y]); // ESC Y (mm)
  }

  const reset = Buffer.from([0x1b, 0x2a]);
  const landscape = Buffer.from([0x1d, 0x56, 0x01]); // page mode landscape
  const fontNormal = Buffer.from([0x1b, 0x46, 12, 12, 0]);
  const fontLarge = Buffer.from([0x1b, 0x46, 18, 12, 1]);

  const buffers = [reset, landscape, fontNormal];

  // Print markers at fixed intervals (every 100 dots)
  for (let x = 0; x <= 1200; x += 100) {
    buffers.push(escX(x), escY(10), Buffer.from(`|${x}|\n`, "ascii"));
  }

  // Print a centered test text using our "guess"
  const testText = "CENTER TEST";
  const guessPageWidth = 950;
  const textWidth = testText.length * 12; // 12 dots/char
  const pos = Math.floor((guessPageWidth - textWidth) / 2);

  buffers.push(
    escX(pos),
    escY(30),
    fontLarge,
    Buffer.from(`${testText}\n`, "ascii")
  );

  // Force page eject
  buffers.push(Buffer.from([0x0c]));

  return Buffer.concat(buffers);
}

// API endpoint to print
app.post("/print", (req, res) => {
  if (!printerPort || !printerPort.isOpen) {
    return res
      .status(500)
      .json({ success: false, message: "Printer not connected" });
  }

  const {
    location,
    assetId,
    floorLocation,
    voucherType,
    validDate,
    amount,
    validation,
    ticketNo,
    time,
  } = req.body;

  const data = buildTicket({
    location: location || "CASINO PLUS QA",
    assetId: assetId || "A1234",
    floorLocation: floorLocation || "Ground Floor",
    voucherType: voucherType || "CASHOUT TICKET",
    validDate: validDate || "01.01.2025",
    amount: amount || "0.00",
    validation: validation || "010000000000000001",
    ticketNo: ticketNo || "0001",
    time: time || "12:00:00",
  });

  // const data = buildDiagnosticTicket();

  printerPort.write(data, (err) => {
    if (err) {
      console.error("❌ Write error:", err.message);
      return res.status(500).json({ success: false, message: err.message });
    }
    console.log("🖨️ Ticket sent (landscape + barcode)");
    res.json({ success: true, message: "Ticket printed successfully!" });
  });
});

// Serve UI
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public/index.html"));
});

// Start server
app.listen(PORT, () => {
  console.log(`🌐 Open http://localhost:${PORT}`);
});
