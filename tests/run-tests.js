const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT_DIR = path.resolve(__dirname, "..");
const FIXTURES_DIR = path.join(__dirname, "fixtures");

function createDocumentMock() {
  return {
    createElement(tagName) {
      if (tagName !== "textarea") {
        return {};
      }
      return {
        value: "",
        set innerHTML(input) {
          this.value = String(input)
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">");
        },
        get innerHTML() {
          return this.value;
        }
      };
    },
    querySelectorAll() {
      return [];
    }
  };
}

function loadModule(fileName, options = {}) {
  const scriptPath = path.join(ROOT_DIR, "src", fileName);
  const source = fs.readFileSync(scriptPath, "utf8");

  const windowObject = Object.assign({}, options.windowProps || {});
  const sandbox = {
    window: windowObject,
    console,
    URL,
    AbortController,
    setTimeout,
    clearTimeout,
    fetch:
      options.fetch ||
      (async () => {
        throw new Error("fetch mock missing in test");
      }),
    document: options.document || createDocumentMock(),
    DOMParser:
      options.DOMParser ||
      class {
        parseFromString(input) {
          const source = String(input || "");
          return {
            body: {
              textContent: source
                .replace(/^<body>/i, "")
                .replace(/<\/body>$/i, "")
                .replace(/&amp;/g, "&")
                .replace(/&lt;/g, "<")
                .replace(/&gt;/g, ">")
            },
            querySelectorAll() {
              return [];
            }
          };
        }
      }
  };

  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox, { filename: scriptPath });
  return sandbox.window.DialogueCaptions;
}

function readFixture(fileName) {
  const fixturePath = path.join(FIXTURES_DIR, fileName);
  return JSON.parse(fs.readFileSync(fixturePath, "utf8"));
}

async function runCase(state, name, fn) {
  state.total += 1;
  try {
    await fn();
    console.log("[PASS] " + name);
  } catch (error) {
    state.failed += 1;
    console.log("[FAIL] " + name);
    console.log("       " + (error && error.message ? error.message : error));
  }
}

async function main() {
  const state = { total: 0, failed: 0 };
  const shared = { assert, loadModule, readFixture };
  const modules = [
    "compliance.test.js",
    "chunker.test.js",
    "chunker-regression.test.js",
    "bubble-state.test.js",
    "platform.test.js",
    "page-bridge.test.js",
    "transcript.test.js",
    "live-bubbles.test.js",
    "navigation.test.js",
    "settings-store.test.js"
  ];

  for (const fileName of modules) {
    console.log("");
    console.log("== " + fileName + " ==");
    const testModule = require(path.join(__dirname, fileName));
    await testModule.run({
      ...shared,
      runCase: (name, fn) => runCase(state, name, fn)
    });
  }

  console.log("");
  if (state.failed === 0) {
    console.log("All tests passed (" + state.total + "/" + state.total + ").");
    return;
  }

  console.log("Tests failed: " + state.failed + " of " + state.total + ".");
  process.exitCode = 1;
}

main().catch((error) => {
  console.log("[FAIL] test runner crashed");
  console.log("       " + (error && error.message ? error.message : error));
  process.exitCode = 1;
});
