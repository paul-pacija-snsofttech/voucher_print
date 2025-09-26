import express from "express";
import { join } from "path";
import { SerialPort } from "serialport";
import { PRINTER_CMDS } from "./printerConstants.js";

const app = express();
const PORT = 3000;

// Update this with your actual Epic Edge device path
// const SERIAL_PATH = "/dev/tty.usbmodemEpic_Edge1"; // use tty.*
const BAUD_RATE = 9600;

let printerPort;

// Epic Edge Vendor & Product IDs
const VENDOR_ID = "0613"; // hex but as string
const PRODUCT_ID = "0960";

async function findEpicEdgePath() {
  const ports = await SerialPort.list();

  const epicEdge = ports.find(
    (printer) =>
      printer.vendorId?.toLowerCase() === VENDOR_ID &&
      printer.productId?.toLowerCase() === PRODUCT_ID
  );

  if (!epicEdge) {
    throw new Error("❌ Epic Edge printer not found");
  }

  console.log(`✅ Found Epic Edge at ${epicEdge.path}`);
  return epicEdge.path;
}

// Example: open the port dynamically
async function connectEpicEdge() {
  try {
    const path = await findEpicEdgePath();

    printerPort = new SerialPort({
      path,
      baudRate: BAUD_RATE,
      dataBits: 8,
      stopBits: 1,
      autoOpen: true,
    });

    printerPort.on("open", () =>
      console.log(`🔌 Connected to Epic Edge on ${path}`)
    );

    // Run both GS z and GS S checks on connect
    await sendStatusRequest();

    printerPort.on("error", (err) =>
      console.error("Printer error:", err.message)
    );

    return printerPort;
  } catch (err) {
    console.error(err.message);
  }
}

connectEpicEdge();

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

  try {
    // ✅ Check printer status BEFORE sending data
    const status = await sendStatusRequest();
    if (!status.printerReady || status.errors.length > 0) {
      throw new Error(`Printer not ready: ${status.errors.join(", ")}`);
    }

    // ✅ Only send data if printer is ready
    printerPort.write(job.data, async (err) => {
      if (err) {
        addLog(`❌ Failed to print Ticket#${job.ticketNo}: ${err.message}`);
        printQueue.unshift(job); // put job back at front of queue
        isPrinting = false;
        setTimeout(processQueue, 3000); // retry later
        return;
      }

      try {
        const { ready } = await waitUntilPrinterDone(); // wait for completion
        if (ready) {
          isPrinting = false;
          addLog(`✅ Ticket#${job.ticketNo} printed successfully`);
          if (printQueue.length > 0) {
            processQueue(); // move on immediately
          }
        }
      } catch (statusErr) {
        addLog(
          `❌ Ticket#${job.ticketNo} failed during printing: ${statusErr.message}`
        );
        printQueue.unshift(job); // put job back at front of queue
        isPrinting = false;
        setTimeout(processQueue, 5000); // retry later with longer delay
      }
    });
  } catch (preCheckErr) {
    // ✅ Printer not ready - requeue without sending data
    addLog(`⚠️ Ticket#${job.ticketNo} delayed: ${preCheckErr.message}`);
    printQueue.unshift(job); // put job back at front of queue
    isPrinting = false;
    setTimeout(processQueue, 5000); // retry later
  }
}

async function waitUntilPrinterDone(maxAttempts = 60, interval = 1000) {
  let sawTicket = false;

  for (let i = 0; i < maxAttempts; i++) {
    const status = await sendStatusRequest();

    // Step 1: wait until ticket enters path
    if (status.barcodeCompleted) {
      sawTicket = true;
    }

    // Step 2: once ticket entered → wait until it leaves
    if (sawTicket && status.printerReady) {
      sawTicket = false;
      return { ready: true };
    }

    // If fatal error
    if (status.errors.length) {
      throw new Error(status.errors.join(", "));
    }

    await new Promise((r) => setTimeout(r, interval));
  }

  throw new Error("Timeout waiting for printer to finish");
}

async function sendStatusRequest() {
  const status = {
    barcodeCompleted: false,
    printerReady: false,
    errors: [],
  };

  // --- GS z ---
  await new Promise((resolve) => {
    printerPort.write(Buffer.from([0x1d, 0x7a]));
    printerPort.once("data", (data) => {
      const s = data[0];

      if (s & PRINTER_CMDS.GS_Z_ERRORS.TICKET_IN_PRINTER) {
        addLog("✅ Ticket in printer");
      } else {
        status.errors.push("❌ No ticket in printer");
      }

      if (s & PRINTER_CMDS.GS_Z_ERRORS.TICKET_IN_PATH) {
        status.errors.push("❌ Ticket in path");
      }

      if (s & PRINTER_CMDS.GS_Z_ERRORS.BARCODE_COMPLETED) {
        status.barcodeCompleted = true;
      }

      if (s & PRINTER_CMDS.GS_Z_ERRORS.PAPER_JAM) {
        status.errors.push("❌ Paper jam");
      }

      resolve();
    });
  });

  // --- GS S ---
  await new Promise((resolve) => {
    printerPort.write(Buffer.from([0x1d, 0x53]));
    printerPort.once("data", (data) => {
      const s = data[0];

      if (s & PRINTER_CMDS.GS_S_ERRORS.PRINTER_READY) {
        status.printerReady = true;
        addLog("✅ Printer Ready");
      } else {
        status.errors.push("⏳ Printer Not Ready");
      }

      if (s & PRINTER_CMDS.GS_S_ERRORS.HEAD_IS_UP) {
        status.errors.push("⚠️ Head is up");
      }
      if (s & PRINTER_CMDS.GS_S_ERRORS.CHASSIS_OPEN) {
        status.errors.push("⚠️ Chassis open");
      }
      if (s & PRINTER_CMDS.GS_S_ERRORS.OUT_OF_TICKETS) {
        status.errors.push("❌ Out of tickets");
      }

      resolve();
    });
  });

  if (status.errors.length && !status.printerReady) {
    throw new Error(status.errors.join(", "));
  }
  return status;
}

const statusLog = [];
function addLog(message) {
  const entry = { time: new Date().toISOString(), message };
  statusLog.push(entry);

  // Keep logs
  statusLog.shift();

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
