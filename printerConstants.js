export const PRINTER_CMDS = {
  // ───────── General Control ─────────
  NUL: [0x00], // Null
  BEL: [0x07], // Audio alert
  HT: [0x09], // Horizontal tab
  LF: [0x0a], // Line feed
  FF: [0x0c], // Form feed
  CR: [0x0d], // Carriage return
  SO: [0x0e], // Double-wide on
  DC4: [0x14], // Cancel double-wide
  ESC: 0x1b, // Escape prefix
  GS: 0x1d, // Group separator prefix
  DLE: 0x10, // Data link escape
  // ───────── Reset ─────────
  RESET_DEFAULTS: [0x1b, 0x2a], // ESC * – Reset to defaults
  RESET_INIT: [0x1b, 0x40], // ESC @ – Reset to power-up condition
  // ───────── Status Requests ─────────
  STATUS: {
    COMBINED: [0x05], // ENQ – Request combined status
    DLE_EOT_1: [0x10, 0x04, 0x01], // Printer status
    DLE_EOT_2: [0x10, 0x04, 0x02], // Offline status
    DLE_EOT_3: [0x10, 0x04, 0x03], // Error status
    DLE_EOT_4: [0x10, 0x04, 0x04], // Paper sensor status
    GS_y: [0x1d, 0x79], // Request combined printer status
    GS_z: [0x1d, 0x7a], // Request printer status
    GS_SS: [0x1d, 0x7e, 0x53, 0x53], // Printer send status
  },
  // ───────── Text Formatting ─────────
  CHAR_SPACING: (n) => [0x1b, 0x20, n], // ESC SP – set right-side spacing
  PRINT_MODE: (n) => [0x1b, 0x21, n], // ESC ! – select print modes
  DOUBLE_WIDE_ON: [0x0e], // SO – set font double-wide
  DOUBLE_WIDE_OFF: [0x14], // DC4 – cancel double-wide
  DOUBLE_HIGH_ON: [0x1d, 0x12], // GS DC2 – double-high
  DOUBLE_HIGH_OFF: [0x1d, 0x13], // GS DC3 – cancel double-high
  INVERSE_ON: [0x1d, 0x16], // GS RS – inverse
  INVERSE_OFF: [0x1d, 0x15], // GS US – cancel inverse
  CHAR_SIZE: (n) => [0x1d, 0x21, n], // GS ! – character size
  FONT_12CPI: [0x1b, 0x4d], // ESC M
  FONT_16CPI: [0x1b, 0x50], // ESC P
  FONT_20CPI: [0x1b, 0x53], // ESC S
  FONT_7CPI: [0x1b, 0x54], // ESC T
  FONT_10CPI: [0x1b, 0x55], // ESC U
  // ───────── Positioning ─────────
  ABS_HORIZ: (n1, n2) => [0x1b, 0x24, n1, n2], // ESC $ – absolute horizontal
  ABS_VERT: (n1, n2) => [0x1d, 0x24, n1, n2], // GS $ – absolute vertical
  SET_HORIZ: (n) => [0x1b, 0x58, n], // ESC X – horizontal start
  SET_VERT: (n) => [0x1b, 0x59, n], // ESC Y – vertical start
  PRINT_DIRECTION: (n) => [0x1b, 0x74, n], // ESC t – print direction
  // ───────── Paper Feed ─────────
  FEED_N_SUBLINES: (n) => [0x1b, 0x4a, n], // ESC J n
  FEED_N_LINES: (n) => [0x1d, 0x64, n], // GS d n
  SET_FEED_LENGTH: (n) => [0x1d, 0x4c, n], // GS L – feed length
  // ───────── Graphics ─────────
  PRINT_BMP: (data) => [0x1b, 0x42, ...data], // ESC B – print BMP image
  DOWNLOAD_IMAGE: [0x1d, 0x31], // GS 1 – enter download mode
  PRINT_USER_IMAGE: [0x1d, 0x30], // GS 0 – print user image
  IMAGE_STATUS: [0x1d, 0x33], // GS 3 – image status
  LANDSCAPE_GRAPHICS: (data) => [0x1d, 0x2a, ...data], // GS * – landscape graphics
  CUSTOM_GRAPHIC: (data) => [0x1d, 0x47, ...data], // GS G – print custom graphic
  DRAW_LINE: (data) => [0x1d, 0x6c, ...data], // GS l – draw line
  // ───────── Barcodes ─────────
  BARCODE: (type, data) => [0x1d, 0x6b, type, ...data], // GS k
  BARCODE_HEIGHT: (n) => [0x1d, 0x68, n], // GS h
  BARCODE_WIDTH: (n) => [0x1d, 0x77, n], // GS w
  BARCODE_ELEMENT_WIDTH: (n) => [0x1d, 0x57, n], // GS W
  BARCODE_POSITION: (n) => [0x1d, 0x41, n], // GS A – barcode position
  // ───────── Info / Firmware ─────────
  VERSION_INFO: [0x1b, 0x05, 0x31], // ESC ENQ 1 – return version
  FW_REVISION: [0x1b, 0x56], // ESC V – return firmware revision
  CRC_VERIFY: [0x1d, 0x3f], // GS ? – CRC verification
  // ───────── Wrapping / Modes ─────────
  WRAP_MODE: (n) => [0x1b, 0x57, n], // ESC W – wrap data
  LINE_WRAP_MODE: (n) => [0x1d, 0x54, n], // GS T – wrap/truncate
  ORIENTATION: (n) => [0x1d, 0x56, n], // GS V – print orientation
  CHARS_PER_LINE_PORTRAIT: (n) => [0x1d, 0x75, n], // GS u
  CHARS_PER_LINE_LANDSCAPE: (n) => [0x1d, 0x74, n], // GS t
  // ───────── Validation / Fields ─────────
  SET_VALIDATION_FIELD: (n) => [0x1d, 0x45, n], // GS E
  SET_PAGE_FIELD: (n) => [0x1d, 0x46, n], // GS F
  // ───────── Misc ─────────
  AUDIO_ALERT: (n) => [0x1b, 0x07, n], // ESC BEL – configure audio alert
  INCREMENTAL_FEED: (n) => [0x1b, 0x4a, n], // ESC J n – feed n sublines
  TEMPLATE_BARCODE_EXTRACT: [0x1d, 0x42], // GS B – extract barcode data
  ALIGN: {
    LEFT: [0x1b, 0x61, 0],
    CENTER: [0x1b, 0x61, 1],
    RIGHT: [0x1b, 0x61, 2],
  },

  TITLE: (n1, n2, n3) => [0x1b, 0x46, n1, n2, n3],

  TEMPLATE: {
    A: "A" || "a",
  },
};
