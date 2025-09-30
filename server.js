import express from "express";
import { join } from "path";
import { SerialPort } from "serialport";
import { PRINTER_CMDS } from "./printerConstants.js";
import Redis from "ioredis";
import {
  enqueueJob,
  dequeueJob,
  queueLength,
  requeueJob,
  clearQueue,
} from "./redis.js";

const app = express();
const PORT = 3000;
const BAUD_RATE = 9600;
const DATA_BITS = 8;
const STOP_BITS = 1;
const AUTO_OPEN = true;

let printerPort;

// Epic Edge Vendor & Product IDs
const VENDOR_ID = "0613"; // hex but as string
const PRODUCT_ID = "0960";
const redis = new Redis();

/**
 * Finds the path to the Epic Edge printer
 * @returns {Promise<string>} The path to the Epic Edge printer
 */
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

/**
 * Connects to the Epic Edge printer
 * Example: open the port dynamically
 * @returns {Promise<SerialPort>} The SerialPort instance
 */
async function connectEpicEdge() {
  try {
    const path = await findEpicEdgePath();

    printerPort = new SerialPort({
      path,
      baudRate: BAUD_RATE,
      dataBits: DATA_BITS,
      stopBits: STOP_BITS,
      autoOpen: AUTO_OPEN,
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
    return;
  }
}

connectEpicEdge();

// Middleware
app.use(express.json());
app.use(express.static(join(import.meta.dirname, "public")));

/**
 * Converts a number to a string of pesos and centavos
 * @param {number} num
 * @returns {string} The string of pesos and centavos
 */
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

/**
 * Builds a ticket
 * @param {string} template
 * @param {string} location
 * @param {string} assetId
 * @param {string} floorLocation
 * @param {string} voucherType
 * @param {string} validDate
 * @param {number} amount
 * @param {string} validation
 * @param {string} ticketNo
 * @param {string} time
 * @returns {Buffer} The ticket data
 */
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
    Buffer.from([0x1d, 0x6b, 0x07, cleanValidation.length]),
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
        // Buffer.from(PRINTER_CMDS.ORIENTATION(0)),
        // Buffer.from(PRINTER_CMDS.PRINT_DIRECTION(1)),
        // Buffer.from(PRINTER_CMDS.ALIGN.CENTER),
        barcode,

        // VALIDATION
        // Buffer.from(PRINTER_CMDS.ORIENTATION(1)),
        // Buffer.from(PRINTER_CMDS.PRINT_DIRECTION(1)),
        // Buffer.from(PRINTER_CMDS.ALIGN.CENTER),
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

/**
 * Print queue
 * @returns {Promise<void>}
 */
let isPrinting = false;

async function processQueue() {
  if (isPrinting || !printerPort?.isOpen) return;

  const job = await dequeueJob();
  if (!job) return; // nothing to do

  isPrinting = true;

  try {
    // ✅ Check printer status BEFORE building/sending ticket
    const status = await sendStatusRequest();
    if (!status.printerReady || status.errors.length > 0) {
      throw new Error(`Printer not ready: ${status.errors.join(", ")}`);
    }

    // ✅ Build ticket data from job object
    const ticketData = buildTicket(job);
    if (!ticketData) {
      throw new Error("Failed to build ticket data");
    }

    // ✅ Send ticket data to printer (single write operation)
    printerPort.write(ticketData, async (writeErr) => {
      if (writeErr) {
        addLog(`❌ Failed to send Ticket#${job.ticketNo}: ${writeErr.message}`);
        const requeued = await requeueJob(job);
        if (requeued) {
          addLog(`🔄 Ticket#${job.ticketNo} requeued for retry`);
        }
        isPrinting = false;
        return setTimeout(processQueue, 3000);
      }

      // ✅ Wait for printer to complete the job - MUST wait for barcode completion
      addLog(`⏳ Waiting for Ticket#${job.ticketNo} to complete processing...`);
      const { ready } = await waitUntilPrinterDone();
      if (ready) {
        addLog(`✅ Ticket#${job.ticketNo} printed successfully`);
        isPrinting = false;
        // Only process next queue item after current job is 100% complete
        setTimeout(() => processQueue(), 1000); // Small delay before next job
      }
    });
  } catch (preCheckErr) {
    if (preCheckErr.message.includes("Paper jam")) {
      addLog(`⚠️ Ticket#${job.ticketNo - 1} delayed: ${preCheckErr.message}`);
    } else {
      addLog(`⚠️ Ticket#${job.ticketNo} delayed: ${preCheckErr.message}`);
    }
    // ✅ Printer not ready - requeue without sending data
    const requeued = await redis.lpush("printQueue", JSON.stringify(job));
    if (requeued) {
      addLog(`🔄 Ticket#${job.ticketNo} requeued - printer not ready`);
    }
    isPrinting = false;
    return;
  }
}

/**
 * Waits until the printer is done (waiting for 7 seconds between checks)
 * @param {number} maxAttempts
 * @param {number} interval
 * @returns {Promise<{ready: boolean}>} The status of the printer
 */
async function waitUntilPrinterDone(maxAttempts = 6, interval = 7000) {
  let sawTicket = false;

  for (let i = 0; i < maxAttempts; i++) {
    const status = await sendStatusRequest();

    // Log current status for troubleshooting
    if (i === 0 || i % 5 === 0) {
      // Log every 5th attempt to avoid spam
      addLog(
        `⏳ Waiting for completion... (attempt ${
          i + 1
        }/${maxAttempts}) - BarcodeComplete: ${
          status.barcodeCompleted
        }, PrinterReady: ${status.printerReady}`
      );
    }

    // Step 1: MUST wait for barcode completion before proceeding
    if (status.barcodeCompleted) {
      sawTicket = true;
      addLog("🎯 Barcode processing completed");
    }

    // Step 2: Once barcode is completed, job is DONE regardless of temporary printer status
    if (sawTicket) {
      addLog("✅ Print job fully completed - barcode processed successfully");
      return { ready: true };
    }

    // Only check for fatal errors if we haven't seen barcode completion yet
    if (status.errors.length) {
      // Only throw error for truly blocking hardware issues
      const blockingErrors = status.errors.filter(
        (error) =>
          error.includes("Paper jam") ||
          error.includes("Chassis open") ||
          error.includes("Head is up")
      );

      if (blockingErrors.length > 0) {
        throw new Error(blockingErrors.join(", "));
      }

      // Ignore "No ticket" and "Not Ready" errors while waiting - these are normal
    }

    await new Promise((r) => setTimeout(r, interval));
  }

  throw new Error(
    `Timeout: Barcode never completed after ${
      (maxAttempts * interval) / 1000
    } seconds`
  );
}

async function resumeQueue() {
  if (!isPrinting && (await queueLength()) > 0) {
    processQueue();
  }
}

/**
 * Sends a status request to the printer
 * @returns {Promise<{barcodeCompleted: boolean, printerReady: boolean, errors: string[]}>} The status of the printer
 */
async function sendStatusRequest() {
  const status = {
    barcodeCompleted: false,
    printerReady: false,
    errors: [],
    hasTicket: false,
  };

  // --- GS z ---
  await new Promise((resolve) => {
    printerPort.write(Buffer.from([0x1d, 0x7a]));
    printerPort.once("data", (data) => {
      const s = data[0];

      if (s & PRINTER_CMDS.GS_Z_ERRORS.TICKET_IN_PRINTER) {
        status.hasTicket = true;
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

  // ✅ Only log once when both printer is ready AND has ticket
  if (status.printerReady && status.hasTicket && status.errors.length === 0) {
    addLog("✅ Printer ready with ticket loaded");
  }

  return status;
}

/**
 * Adds a log to the status log
 * @param {string} message
 * @returns {void}
 */
const statusLog = [];
export function addLog(message) {
  const entry = { time: new Date().toISOString(), message };
  statusLog.push(entry);

  // Keep only last 100 logs
  if (statusLog.length > 100) {
    statusLog.shift();
  }

  console.log(message); // still log to terminal
}

/**
 * Prints tickets
 * @param {Request} req
 * @param {Response} res
 * @returns {Promise<Response>} The response
 */
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
      await enqueueJob(newTicket);
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

app.post("/resume", async (req, res) => {
  try {
    await resumeQueue();
    const length = await queueLength();
    return res.json({
      success: true,
      message: `Queue resumed - ${length} jobs pending`,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to resume queue",
      details: error.message,
    });
  }
});

app.post("/clear-queue", async (req, res) => {
  try {
    await clearQueue();
    addLog("🗑️ Print queue cleared by user");
    return res.json({
      success: true,
      message: "Print queue cleared successfully",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to clear queue",
      details: error.message,
    });
  }
});

/**
 * Gets the status log
 * @param {Request} req
 * @param {Response} res
 * @returns {Promise<Response>} The response
 */
app.get("/status", async (req, res) => {
  try {
    const length = await queueLength();
    res.json({
      success: true,
      log: statusLog,
      queueLength: length,
      isPrinting: isPrinting,
    });
  } catch (error) {
    res.json({
      success: true,
      log: statusLog,
      queueLength: 0,
      isPrinting: isPrinting,
    });
  }
});

/**
 * Serves the UI
 * @param {Request} req
 * @param {Response} res
 * @returns {Promise<Response>} The response
 */
app.get("/", (req, res) => {
  res.sendFile(join(import.meta.dirname, "public/index.html"));
});

/**
 * Starts the server
 * @returns {void}
 */
app.listen(PORT, () => {
  console.log(`🌐 Open http://localhost:${PORT}`);
});
