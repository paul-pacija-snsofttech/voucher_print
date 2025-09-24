const { SerialPort } = require("serialport");

const SERIAL_PATH = "/dev/tty.usbmodemEpic_Edge1"; // adjust if needed
const BAUD_RATE = 9600;

const port = new SerialPort({
  path: SERIAL_PATH,
  baudRate: BAUD_RATE,
  dataBits: 8,
  stopBits: 1,
  autoOpen: true,
});

const commands = [
  { name: "DLE EOT 1", buf: Buffer.from([0x10, 0x04, 0x01]) },
  { name: "DLE EOT 2", buf: Buffer.from([0x10, 0x04, 0x02]) },
  { name: "DLE EOT 3", buf: Buffer.from([0x10, 0x04, 0x03]) },
  { name: "DLE EOT 4", buf: Buffer.from([0x10, 0x04, 0x04]) },
  { name: "GS r 1", buf: Buffer.from([0x1d, 0x72, 0x01]) },
  { name: "GS r 2", buf: Buffer.from([0x1d, 0x72, 0x02]) },
  { name: "ESC v", buf: Buffer.from([0x1b, 0x76]) },
];

port.on("open", async () => {
  console.log(`✅ Port opened: ${SERIAL_PATH}`);

  for (const cmd of commands) {
    console.log(`➡️ Sending ${cmd.name}`);
    await sendAndWait(cmd.buf);
  }

  console.log("✅ Done testing all commands");
  process.exit(0);
});

function sendAndWait(buf) {
  return new Promise((resolve) => {
    let timer;

    const onData = (data) => {
      clearTimeout(timer);
      console.log(`📥 Response: ${data.toString("hex")} | bytes:`, [...data]);
      port.off("data", onData);
      resolve();
    };

    port.on("data", onData);
    port.write(buf, (err) => {
      if (err) {
        console.error("❌ Write error:", err.message);
        port.off("data", onData);
        return resolve();
      }
    });

    timer = setTimeout(() => {
      console.log("⏳ No response (timeout)");
      port.off("data", onData);
      resolve();
    }, 2000);
  });
}
