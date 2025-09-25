// monitor-lines.js
import { SerialPort } from "serialport";

const SERIAL_PATH = "/dev/tty.usbmodemEpic_Edge1"; // update if needed
const BAUD_RATE = 9600;
const POLL_MS = 500; // check every 500ms

// Map control lines to human labels.
// Default: unknown. After auto-detect you can change these to observed mapping:
// possible keys: 'cts', 'dsr', 'dcd', 'ri'
const SIGNAL_MEANING = {
  cts: null, // e.g. "Paper OK" or "Paper Present"
  dsr: null, // e.g. "Cover closed"
  dcd: null, // e.g. "Cutter ok"
  ri: null, // e.g. "Presenter"
};

const port = new SerialPort({
  path: SERIAL_PATH,
  baudRate: BAUD_RATE,
  autoOpen: true,
});

port.on("open", () => {
  console.log("✅ Port opened:", SERIAL_PATH);

  // Send status request [GS] z (0x1D 0x7A)
  const statusCmd = Buffer.from([0x1d, 0x7a]);
  port.write(statusCmd, (err) => {
    if (err) return console.error("Write error:", err);
    console.log("📥 Response:", statusCmd);
    console.log("➡️ Sent GS z (request printer status)");
  });

  // print header
  console.log("Polling modem control lines every", POLL_MS, "ms");
  pollLoop();
});

port.on("data", (data) => {
  console.log("pumasok dito?");
  const status = data[0];
  console.log("📥 Raw status byte:", data.toString("hex"));

  // Interpret bits
  console.log("🧾 Decoded status:");
  console.log(`  Bit0 (Ticket low): ${status & 0x01 ? "Yes" : "No"}`);
  console.log(`  Bit1 (Ticket in printer): ${status & 0x02 ? "Yes" : "No"}`);
  console.log(`  Bit2 (Top of Form): ${status & 0x04 ? "Yes" : "No"}`);
  console.log(`  Bit3 (Reserved, always 1): ${status & 0x08 ? "1" : "0"}`);
  console.log(`  Bit4 (Barcode completed): ${status & 0x10 ? "Yes" : "No"}`);
  console.log(`  Bit5 (Validation completed): ${status & 0x20 ? "Yes" : "No"}`);
  console.log(`  Bit6 (Ticket in path): ${status & 0x40 ? "Yes" : "No"}`);
  console.log(`  Bit7 (Paper jam): ${status & 0x80 ? "Yes" : "No"}`);
});

port.on("error", (err) => {
  console.error("❌ Serial error:", err.message);
});

let lastStatus = null;

function interpretStatus(status) {
  const parts = [];
  if (typeof status.cts !== "undefined") {
    parts.push(
      `CTS=${status.cts ? 1 : 0}${
        SIGNAL_MEANING.cts ? "(" + SIGNAL_MEANING.cts + ")" : ""
      }`
    );
  }
  if (typeof status.dsr !== "undefined") {
    parts.push(
      `DSR=${status.dsr ? 1 : 0}${
        SIGNAL_MEANING.dsr ? "(" + SIGNAL_MEANING.dsr + ")" : ""
      }`
    );
  }
  if (typeof status.dcd !== "undefined") {
    parts.push(
      `DCD=${status.dcd ? 1 : 0}${
        SIGNAL_MEANING.dcd ? "(" + SIGNAL_MEANING.dcd + ")" : ""
      }`
    );
  }
  if (typeof status.ri !== "undefined") {
    parts.push(
      `RI=${status.ri ? 1 : 0}${
        SIGNAL_MEANING.ri ? "(" + SIGNAL_MEANING.ri + ")" : ""
      }`
    );
  }
  return parts.join(" | ");
}

function pollLoop() {
  port.get((err, status) => {
    if (err) {
      console.error("❌ Failed to read modem lines:", err.message);
      setTimeout(pollLoop, POLL_MS);
      return;
    }

    // show only when changed for less spam
    if (
      !lastStatus ||
      status.cts !== lastStatus.cts ||
      status.dsr !== lastStatus.dsr ||
      status.dcd !== lastStatus.dcd ||
      status.ri !== lastStatus.ri
    ) {
      const time = new Date().toISOString();
      console.log(`${time}  ${interpretStatus(status)}`);
      lastStatus = status;
    }

    setTimeout(pollLoop, POLL_MS);
  });
}
