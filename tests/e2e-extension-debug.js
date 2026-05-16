const path = require("node:path");
const fs = require("node:fs");
const { chromium } = require("playwright");

function parseArgs(argv) {
  const options = {
    url: "",
    headless: true,
    timeoutMs: 45000,
    keepOpen: false
  };
  for (const raw of argv) {
    if (raw === "--headed") {
      options.headless = false;
    } else if (raw === "--keep-open") {
      options.keepOpen = true;
    } else if (raw.startsWith("--url=")) {
      options.url = raw.slice("--url=".length);
    } else if (raw.startsWith("--timeout=")) {
      const value = Number(raw.slice("--timeout=".length));
      if (Number.isFinite(value) && value > 0) {
        options.timeoutMs = value;
      }
    }
  }
  return options;
}

async function readConsoleValues(msg) {
  const values = [];
  const args = msg.args();
  for (let index = 0; index < args.length; index += 1) {
    try {
      values.push(await args[index].jsonValue());
    } catch {
      values.push(args[index].toString());
    }
  }
  return values;
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.url) {
    throw new Error("Pass a YouTube watch URL with --url=https://www.youtube.com/watch?v=...");
  }
  const projectRoot = path.resolve(__dirname, "..");
  const extensionPath = path.join(projectRoot, "build", "chrome");
  const manifestPath = path.join(extensionPath, "manifest.json");

  if (!fs.existsSync(manifestPath)) {
    throw new Error("Missing build/chrome/manifest.json. Run `npm run build` first.");
  }

  const userDataDir = path.join(projectRoot, ".playwright-user-data");
  let context = null;
  let keepOpen = false;
  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: options.headless,
      viewport: { width: 1440, height: 900 },
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        "--autoplay-policy=no-user-gesture-required"
      ]
    });

    const page = context.pages()[0] || (await context.newPage());
    const transcriptLogs = [];
    const generalLogs = [];

    page.on("console", async (msg) => {
      const values = await readConsoleValues(msg);
      const entry = {
        type: msg.type(),
        text: msg.text(),
        values: values
      };
      generalLogs.push(entry);
      if (entry.text.includes("[Dialogue Captions]")) {
        transcriptLogs.push(entry);
        console.log("[ext-log]", entry.text);
      }
    });

    await page.goto(options.url, {
      waitUntil: "domcontentloaded",
      timeout: options.timeoutMs
    });
    await page.evaluate(() => {
      const video = document.querySelector("video");
      if (video) {
        video.muted = true;
        video.volume = 0;
      }
      const player = document.getElementById("movie_player");
      try {
        if (player && typeof player.mute === "function") {
          player.mute();
        }
      } catch {
        // Ignore player mute failures in test diagnostics.
      }
    });

    let launcherFound = false;
    try {
      await page.waitForSelector("#dc-launcher", { timeout: 30000 });
      launcherFound = true;
      await page.click("#dc-launcher");
    } catch {
      launcherFound = false;
    }

    let panelFound = true;
    try {
      await page.waitForSelector("#dc-panel", { timeout: launcherFound ? 12000 : 30000 });
    } catch {
      panelFound = false;
    }
    await page.waitForTimeout(7000);

    if (panelFound) {
      const startedAt = Date.now();
      while (Date.now() - startedAt < options.timeoutMs) {
        const chunkCount = await page.evaluate(() =>
          document.querySelectorAll("#dc-panel .dc-chunk").length
        );
        if (chunkCount > 0) {
          break;
        }
        await page.waitForTimeout(1000);
      }
    }

    const state = await page.evaluate((flags) => {
      const panel = document.querySelector("#dc-panel");
      const launcher = document.querySelector("#dc-launcher");
      const status = panel ? panel.querySelector(".dc-status") : null;
      const chunks = Array.from(document.querySelectorAll("#dc-panel .dc-chunk")).slice(0, 8);
      return {
        href: location.href,
        launcherFoundByWait: Boolean(flags.launcherFound),
        panelFoundByWait: Boolean(flags.panelFound),
        hasPanel: Boolean(panel),
        hasLauncher: Boolean(launcher),
        statusText: status ? status.textContent || "" : "",
        chunkCount: document.querySelectorAll("#dc-panel .dc-chunk").length,
        sampleChunks: chunks.map((node) => {
          const time = node.querySelector(".dc-chunk-time");
          const text = node.querySelector(".dc-chunk-text");
          const value = text ? text.textContent || "" : "";
          return {
            time: time ? time.textContent || "" : "",
            textLength: value.length
          };
        })
      };
    }, { launcherFound, panelFound });

    const report = {
      options: options,
      state: state,
      transcriptLogCount: transcriptLogs.length,
      transcriptLogs: transcriptLogs.slice(-60),
      generalLogCount: generalLogs.length
    };

    const reportPath = path.join(projectRoot, "tests", "artifacts", "playwright-debug-report.json");
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
    console.log("Playwright debug report:", reportPath);
    console.log(JSON.stringify(state, null, 2));

    if (options.keepOpen) {
      console.log("Keep-open mode enabled. Close browser manually when done.");
      keepOpen = true;
      return;
    }
  } finally {
    if (context && !keepOpen) {
      await context.close();
    }
  }
}

run().catch((error) => {
  console.error("Playwright debug run failed:", error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
