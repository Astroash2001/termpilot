// Self-check for the output colouring in app.js. Run: node web/colour_test.js
// Loads only the colouring section, then checks that text is never changed (only colour
// codes are added), that program colours are respected, and that split escapes survive.
const fs = require("fs");
const src = fs.readFileSync(__dirname + "/app.js", "utf8");
const start = src.indexOf('const ESC = "\\x1b";');
const end = src.indexOf("function connect() {");
const colourise = new Function(src.slice(start, end) + "; return colourise;")();

const strip = (s) => s.replace(/\x1b(?:\[[0-?]*[ -\/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[()*+#%][ -~]|[^\[\]()*+#%])/g, "");
let failed = 0;
const check = (name, ok) => { if (!ok) { failed++; console.log("FAIL", name); } };

// 1. Text is preserved exactly, even when chunks split escapes
const samples = [
  "PS C:\\Users\\avina\\termpilot> npm test\r\n",
  "error: cannot open src/app.js:12\r\n12 passed, 1 warning\r\nsee https://example.com/docs\r\n",
  "\x1b[32mpassed\x1b[0m then error\r\n",
  "\x1b7saved\x1b8 restored \x1b(B charset\r\n",
  "\x1b]0;window title\x07title set ok\r\n",
];
for (const s of samples) {
  const one = colourise(s);
  check("preserved: " + JSON.stringify(s), strip(one) === strip(s));
  for (let cut = 1; cut < s.length; cut++) {
    const two = colourise(s.slice(0, cut)) + colourise(s.slice(cut));
    if (strip(two) !== strip(s)) { check("split at " + cut + ": " + JSON.stringify(s), false); break; }
  }
}

// 2. Only problems and warnings get colour; the rest stays default
const plain = colourise("error: cannot open src/app.js\r\n");
check("error is red", plain.includes("\x1b[31merror\x1b[39m"));
check("path keeps default colour", plain.includes(" src/app.js\r\n"));
check("passed keeps default colour", colourise("12 passed\r\n") === "12 passed\r\n");
check("exception names are red", colourise("ModuleNotFoundError: x\r\n").includes("\x1b[31mModuleNotFoundError\x1b[39m"));

// 3. Text the program coloured itself is left alone, until it resets
const own = colourise("\x1b[33mwarning: error inside yellow\x1b[0m error\r\n");
check("program colour respected", own.startsWith("\x1b[33mwarning: error inside yellow\x1b[0m"));
check("highlight resumes after reset", own.endsWith("\x1b[31merror\x1b[39m\r\n"));

// 4. The PowerShell prompt is dimmed so the command stands out
check("prompt dimmed", colourise("PS C:\\code> ls\r\n").startsWith("\x1b[90mPS C:\\code>\x1b[39m ls"));

console.log(failed ? failed + " checks failed" : "all colouring checks pass");
process.exit(failed ? 1 : 0);
