import express from "express";
import { join } from "path";
import { SerialPort } from "serialport";
import { PRINTER_CMDS } from "./printerConstants.js";

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

  printerPort.on("open", async () => {
    console.log(`✅ Printer connected at ${SERIAL_PATH}`);

    // Run both GS z and GS S checks on connect
    await sendStatusRequest();
  });

  printerPort.on("error", (err) => {
    console.error("❌ Printer error:", err.message);
  });
} catch (err) {
  console.error("❌ Failed to open printer:", err.message);
}

// Middleware
app.use(express.json());
app.use(express.static(join(import.meta.dirname, "public")));

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
    result += " AND NO CENTAVOS";
  }

  return result.toUpperCase();
}

// --- Ticket builder ---
function buildTicket({
  template,
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

  switch (template) {
    case PRINTER_CMDS.TEMPLATE.A:
      return Buffer.concat([
        // validation on right side
        Buffer.from(PRINTER_CMDS.RESET_INIT),
        Buffer.from(PRINTER_CMDS.ORIENTATION(0)),
        Buffer.from(PRINTER_CMDS.ALIGN.CENTER),
        Buffer.from(PRINTER_CMDS.FONT_16CPI),
        Buffer.from(`${safeValidation}\n`, "ascii"),

        // TITLE
        Buffer.from(PRINTER_CMDS.RESET_INIT),
        Buffer.from(PRINTER_CMDS.ORIENTATION(1)),
        Buffer.from(PRINTER_CMDS.PRINT_DIRECTION(1)),
        Buffer.from(PRINTER_CMDS.ALIGN.CENTER),
        Buffer.from(PRINTER_CMDS.ALIGN.CENTER),
        Buffer.from(PRINTER_CMDS.LF),
        Buffer.from(PRINTER_CMDS.LF),
        Buffer.from(PRINTER_CMDS.TITLE(20, 1, 1)),
        Buffer.from(`${safeVoucherType}\n`, "ascii"),

        // BARCODE
        barcode,

        // VALIDATION
        Buffer.from(PRINTER_CMDS.TITLE(10, 1, 1)),
        Buffer.from(`VALIDATION ${safeValidation}\n`, "ascii"),

        // AMOUNT
        Buffer.from(PRINTER_CMDS.FONT_20CPI),
        Buffer.from(`${numberToPesos(safeAmount)}\n`, "ascii"),

        // PHP AMOUNT
        Buffer.from(PRINTER_CMDS.TITLE(20, 1, 1)),
        Buffer.from(`PHP${safeAmount}\n`, "ascii"),

        // DATE
        Buffer.from(PRINTER_CMDS.ALIGN.LEFT),
        escX(0),
        Buffer.from(PRINTER_CMDS.FONT_16CPI),
        Buffer.from(`${safeValidDate}`, "ascii"),

        // TIME
        Buffer.from(PRINTER_CMDS.ALIGN.RIGHT),
        escX(900),
        Buffer.from(PRINTER_CMDS.FONT_16CPI),
        Buffer.from(`${safeTime}\n`, "ascii"),

        // ASSET ID AND TICKET NO
        Buffer.from(PRINTER_CMDS.ALIGN.LEFT),
        escX(0),
        Buffer.from(PRINTER_CMDS.FONT_20CPI),
        Buffer.from(`ASSET# ${safeAssetId}   Ticket# ${safeTicketNo}`, "ascii"),

        // EXPIRATION DATE
        Buffer.from(PRINTER_CMDS.ALIGN.RIGHT),
        escX(900),
        Buffer.from(PRINTER_CMDS.FONT_20CPI),
        Buffer.from(`Never Expires\n`, "ascii"),

        // CUT
        Buffer.from(PRINTER_CMDS.FF),
      ]);
    case PRINTER_CMDS.TEMPLATE.B:
      return Buffer.concat([
        // TITLE
        Buffer.from(PRINTER_CMDS.RESET_INIT),
        Buffer.from(PRINTER_CMDS.ORIENTATION(1)),
        Buffer.from(PRINTER_CMDS.PRINT_DIRECTION(1)),
        Buffer.from(PRINTER_CMDS.ALIGN.CENTER),
        Buffer.from(PRINTER_CMDS.ALIGN.CENTER),
        Buffer.from(PRINTER_CMDS.LF),
        Buffer.from(PRINTER_CMDS.LF),
        Buffer.from(PRINTER_CMDS.TITLE(20, 1, 1)),
        Buffer.from(`TESTING TEMPLATE B\n`, "ascii"),
      ]);
    default:
      return;
  }
}

// --- Print queue ---
const printQueue = [];
let isPrinting = false;

async function processQueue() {
  if (isPrinting || !printQueue.length || !printerPort?.isOpen) return;

  isPrinting = true;
  const job = printQueue.shift();

  printerPort.write(job.data, async (err) => {
    if (err) {
      addLog(`❌ Failed to print Ticket#${job.ticketNo}: ${err.message}`);
      isPrinting = false;
      return processQueue(); // skip to next
    }

    try {
      await waitForPrinterReady();
      addLog(`✅ Ticket#${job.ticketNo} printed successfully`);

      setTimeout(() => {
        isPrinting = false;
        processQueue();
      }, 10000);
    } catch (statusErr) {
      addLog(`❌ Ticket#${job.ticketNo} failed: ${statusErr.message}`);
      printQueue.unshift(job); // requeue this ticket
      isPrinting = false;
      setTimeout(processQueue, 3000);
    }
  });
}

async function waitForPrinterReady() {
  return new Promise((resolve, reject) => {
    const check = async () => {
      try {
        await sendStatusRequest();
        resolve();
      } catch (err) {
        if (
          err.message.includes("Out of tickets") ||
          err.message.includes("Paper jam")
        ) {
          reject(err);
        } else {
          setTimeout(check, 500);
        }
      }
    };
    check();
  });
}

async function sendStatusRequest() {
  const errors = [];

  await new Promise((resolve) => {
    const cmd = Buffer.from([0x1d, 0x7a]);
    printerPort.write(cmd, (err) => {
      if (err) {
        addLog(`❌ Failed to send GS z: ${err.message}`);
        return resolve();
      }
    });

    printerPort.once("data", (data) => {
      const s = data[0];

      if (s & PRINTER_CMDS.GS_Z_ERRORS.TICKET_IN_PRINTER) {
        addLog("✅ Ticket in printer");
      } else {
        errors.push("❌ No ticket in printer");
      }

      if (s & PRINTER_CMDS.GS_Z_ERRORS.PAPER_JAM) {
        errors.push("❌ Paper jam");
      }

      resolve();
    });
  });

  await new Promise((resolve) => {
    const cmd = Buffer.from([0x1d, 0x53]);
    printerPort.write(cmd, (err) => {
      if (err) {
        addLog(`❌ Failed to send GS S: ${err.message}`);
        return resolve();
      }
    });

    printerPort.once("data", (data) => {
      const s = data[0];

      if (s & PRINTER_CMDS.GS_S_ERRORS.PRINTER_READY) {
        addLog("✅ Printer Ready");
      } else {
        errors.push("⏳ Printer Not Ready");
      }

      if (s & PRINTER_CMDS.GS_S_ERRORS.HEAD_IS_UP) {
        errors.push("⚠️ Head is up");
      }
      if (s & PRINTER_CMDS.GS_S_ERRORS.CHASSIS_OPEN) {
        errors.push("⚠️ Chassis open");
      }
      if (s & PRINTER_CMDS.GS_S_ERRORS.OUT_OF_TICKETS) {
        errors.push("❌ Out of tickets");
      }

      resolve();
    });
  });

  if (errors.length) throw new Error(errors.join(", "));
  addLog("✅ Ticket Status OK");
}

const statusLog = [];
function addLog(message) {
  const entry = { time: new Date().toISOString(), message };
  statusLog.push(entry);

  // Keep only last 100 logs
  if (statusLog.length > 100) statusLog.shift();

  console.log(message); // still log to terminal
}

// --- /print endpoint ---
app.post("/print", async (req, res) => {
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

  try {
    await sendStatusRequest();

    for (const ticket of tickets) {
      const newTicket = { ...ticket, template: "A" };
      const data = buildTicket(newTicket);

      printQueue.push({ data, ticketNo: ticket.ticketNo });
      addLog(`📝 Ticket#${ticket.ticketNo} queued`);
    }

    processQueue();

    return res.json({
      success: true,
      message: `${tickets.length} ticket(s) queued for print`,
    });
  } catch (err) {
    addLog(`❌ Printer error: ${err.message}`);
    return res.status(500).json({
      success: false,
      message: "Printer error",
      details: err.message,
    });
  }
});

// --- /status endpoint ---
app.get("/status", (req, res) => {
  res.json({
    success: true,
    log: statusLog,
  });
});

// Serve UI
app.get("/", (req, res) => {
  res.sendFile(join(__dirname, "public/index.html"));
});

// Start server
app.listen(PORT, () => {
  console.log(`🌐 Open http://localhost:${PORT}`);
});
