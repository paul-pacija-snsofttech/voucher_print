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

/**
 * Build ticket with landscape + barcode
 */
function buildTicket({
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

  // --- Base setup ---
  const reset = Buffer.from([0x1b, 0x2a]); // Reset
  const landscape = Buffer.from([0x1d, 0x56, 0x01]); // Landscape
  const fontNormal = Buffer.from([0x1b, 0x46, 12, 12, 0]); // 12pt normal
  const fontLarge = Buffer.from([0x1b, 0x46, 18, 12, 1]); // 18pt bold

  // --- Barcode (Code128-B) ---
  const barcode = Buffer.concat([
    Buffer.from([0x1d, 0x68, 80]), // Height
    Buffer.from([0x1d, 0x77, 6]), // Width
    Buffer.from([0x1d, 0x6b, 0x09, validation.length]), // GS k n=9 (Code128-B), m=length
    Buffer.from(validation, "ascii"),
  ]);

  // --- Content ---
  return Buffer.concat([
    reset,
    landscape,

    escX(300),
    escY(0),
    fontLarge,
    Buffer.from(`${voucherType}\n`, "ascii"),

    escX(320),
    escY(10),
    fontNormal,
    Buffer.from(`Valid Date: ${validDate}\n`, "ascii"),

    escX(320),
    escY(15),
    fontNormal,
    Buffer.from(`Amount: ${amount}PHP\n`, "ascii"),

    escX(250),
    escY(25),
    barcode,
    Buffer.from("\n", "ascii"),

    escX(320),
    escY(35),
    Buffer.from(validation, "ascii"),
    Buffer.from("\n", "ascii"),

    escX(280),
    escY(45),
    fontNormal,
    Buffer.from(`Ticket #${ticketNo}  Time: ${time}\n`, "ascii"),

    escX(320),
    escY(50),
    fontNormal,
    Buffer.from("---- THANK YOU ----\n", "ascii"),

    Buffer.from([0x0c]), // Form feed
  ]);
}

// API endpoint to print
app.post("/print", (req, res) => {
  if (!printerPort || !printerPort.isOpen) {
    return res
      .status(500)
      .json({ success: false, message: "Printer not connected" });
  }

  const { voucherType, validDate, amount, validation, ticketNo, time } =
    req.body;

  const data = buildTicket({
    voucherType: voucherType || "CASHOUT TICKET",
    validDate: validDate || "01.01.2025",
    amount: amount || "0.00",
    validation: validation || "010000000000000001",
    ticketNo: ticketNo || "0001",
    time: time || "12:00:00",
  });

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
