const express = require("express");
const bodyParser = require("body-parser");
const path = require("path");
const { SerialPort } = require("serialport");

const app = express();
const PORT = 3000;

// Update this with your actual Epic Edge device path
const SERIAL_PATH = "/dev/tty.usbmodemEpic_Edge1"; // use tty.*
const BAUD_RATE = 9600;

let printerPort;

// --- OPEN SERIAL PORT ---
try {
  printerPort = new SerialPort({
    path: SERIAL_PATH,
    baudRate: BAUD_RATE,
    dataBits: 8,
    stopBits: 1,
    autoOpen: true,
  });

  printerPort.on("open", () => {
    console.log(`✅ Printer connected at ${SERIAL_PATH}`);
  });

  printerPort.on("error", (err) => {
    console.error("❌ Printer error:", err.message);
  });
} catch (err) {
  console.error("❌ Failed to open printer:", err.message);
}

// Middleware
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "public")));

// --- Number to Pesos function ---
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
    "THIRTEEN",
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
        let scaleWord = scales[scaleIdx] ? " " + scales[scaleIdx] : "";
        words = chunkWords + scaleWord + (words ? " " + words : "");
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

  return result.charAt(0).toUpperCase() + result.slice(1).toLowerCase();
}

// --- Ticket builder ---
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
  // Helpers
  function escX(pos) {
    const n1 = Math.floor(pos / 256);
    const n2 = pos % 256;
    return Buffer.from([0x1b, 0x58, n1, n2]);
  }
  function escY(y) {
    return Buffer.from([0x1b, 0x59, y]);
  }
  function centerX(text, fontWidthDots = 12, pageWidthDots = 1100) {
    const safeText = text || "";
    const pos = Math.max(
      0,
      Math.floor((pageWidthDots - safeText.length * fontWidthDots) / 2)
    );
    return Buffer.from([0x1b, 0x58, Math.floor(pos / 256), pos % 256]);
  }
  function rightX(text, fontWidthDots = 12, pageWidthDots = 1000, margin = 50) {
    const safeText = text || "";
    const pos = Math.max(
      0,
      pageWidthDots - safeText.length * fontWidthDots - margin
    );
    return Buffer.from([0x1b, 0x58, Math.floor(pos / 256), pos % 256]);
  }
  function centerBarcode(data, moduleWidth = 6, pageWidthDots = 1000) {
    const safeData = data || "";
    const totalModules = Math.round(safeData.length * 7);
    const pos = Math.floor((pageWidthDots - totalModules * moduleWidth) / 2);
    return escX(pos);
  }

  const portrait = Buffer.from([0x1d, 0x56, 0x00]);
  const portraitCenter = Buffer.from([0x1b, 0x61, 1]);
  const reset = Buffer.from([0x1b, 0x2a]);
  const landscape = Buffer.from([0x1d, 0x56, 0x04]);
  const fontNormal = Buffer.from([0x1b, 0x46, 10, 10, 0]);
  const fontLargeBold = Buffer.from([0x1b, 0x46, 22, 22, 1]);
  const fontThin = Buffer.from([0x1b, 0x46, 8, 8, 0]);
  const cleanValidation = (validation || "").replace(/\D/g, "");

  const safeValidation = validation || "";
  const safeVoucherType = voucherType || "";
  const safeAmount = amount || 0;
  const safeValidDate = validDate || "";
  const safeAssetId = assetId || "";
  const safeTicketNo = ticketNo || "";
  const safeTime = time || "";

  const barcode = Buffer.concat([
    Buffer.from([0x1d, 0x68, 210]),
    Buffer.from([0x1d, 0x77, 6]),
    Buffer.from([0x1d, 0x6b, 0x09, cleanValidation.length]),
    Buffer.from(cleanValidation, "ascii"),
  ]);

  return Buffer.concat([
    reset,
    portrait,
    portraitCenter,
    fontNormal,
    Buffer.from(`${safeValidation}\n`, "ascii"),
    reset,
    landscape,
    centerX(safeVoucherType, 22, 900),
    escY(5),
    fontLargeBold,
    Buffer.from(`${safeVoucherType}\n`, "ascii"),
    centerBarcode(cleanValidation, 4),
    escY(12),
    barcode,
    Buffer.from("\n", "ascii"),
    centerX(`VALIDATION ${safeValidation}`, 10, 950),
    escY(40),
    fontNormal,
    Buffer.from(`VALIDATION ${safeValidation}\n`, "ascii"),
    centerX(numberToPesos(safeAmount), 10, 950),
    escY(43),
    fontThin,
    Buffer.from(`${numberToPesos(safeAmount)}\n`, "ascii"),
    centerX(`PHP${safeAmount}`, 24, 950),
    escY(50),
    fontLargeBold,
    Buffer.from(`PHP${safeAmount}\n`, "ascii"),
    escX(0),
    escY(50),
    fontThin,
    Buffer.from(`${safeValidDate}\n`, "ascii"),
    escX(0),
    escY(53),
    fontThin,
    Buffer.from(`ASSET# ${safeAssetId}   Ticket# ${safeTicketNo}\n`, "ascii"),
    rightX(safeTime, 12, 950, 0),
    escY(50),
    fontThin,
    Buffer.from(`${safeTime}\n`, "ascii"),
    rightX("Never Expires", 10, 950, 0),
    escY(53),
    fontThin,
    Buffer.from(`Never Expires\n`, "ascii"),
    Buffer.from([0x0c]),
  ]);
}

// --- Helper: send DLE EOT command ---
function requestPrinterStatus(n = 2) {
  return new Promise((resolve, reject) => {
    if (!printerPort || !printerPort.isOpen) {
      return reject(new Error("Printer not connected"));
    }

    const cmd = Buffer.from([0x10, 0x04, n]); // DLE EOT n
    let timer;

    const onData = (data) => {
      clearTimeout(timer);
      printerPort.off("data", onData);

      const status = data[0];
      console.log("📥 Status response:", status.toString(2).padStart(8, "0"));

      // Paper status (n=2)
      if (n === 2 && status & 0x60) {
        return reject(new Error("❌ Paper out or near end"));
      }

      resolve(status);
    };

    printerPort.on("data", onData);
    printerPort.write(cmd, (err) => {
      if (err) {
        printerPort.off("data", onData);
        return reject(new Error("Failed to request status: " + err.message));
      }
    });

    // timeout if no response
    timer = setTimeout(() => {
      printerPort.off("data", onData);
      reject(new Error("Status request timeout"));
    }, 500);
  });
}

// --- Print queue ---
const printQueue = [];
let isPrinting = false;

async function processQueue() {
  if (isPrinting || printQueue.length === 0) return;
  isPrinting = true;

  const { data, ticketNo } = printQueue.shift();

  try {
    printerPort.write(data, async (err) => {
      if (err) {
        console.error("❌ Print failed for ticket", ticketNo, err.message);
      } else {
        console.log("✅ Printed ticket", ticketNo);
      }
      // ✅ After printing, check paper status
      await requestPrinterStatus(2);
      isPrinting = false;
      processQueue(); // continue with next job
    });
  } catch (err) {
    console.error("❌ Exception while printing", ticketNo, err);
    isPrinting = false;
    processQueue();
  }
}

// --- /print endpoint ---
app.post("/print", (req, res) => {
  let tickets = [];

  if (Array.isArray(req.body)) {
    tickets = req.body;
  } else if (req.body.tickets && Array.isArray(req.body.tickets)) {
    tickets = req.body.tickets;
  }

  if (!tickets.length) {
    return res
      .status(400)
      .json({ success: false, message: "No tickets provided" });
  }

  console.log("📥 Incoming tickets:", tickets);

  for (const ticket of tickets) {
    const data = buildTicket(ticket);

    printQueue.push({
      data,
      ticketNo: ticket.ticketNo,
    });
    processQueue();
  }

  res.json({
    success: true,
    message: `${tickets.length} ticket(s) queued for print`,
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
