// monitor-lines.js
const { SerialPort } = require("serialport");

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
  // print header
  console.log("Polling modem control lines every", POLL_MS, "ms");
  pollLoop();
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
    console.log("status", status);
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
