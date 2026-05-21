const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT_DIR = path.resolve(__dirname, "..");

function loadUniversalCaptions(options = {}) {
  class FakeVideo {}
  const panelInstances = [];
  const diagnosticsEvents = [];
  const videos = typeof options.makeVideos === "function" ? options.makeVideos(FakeVideo) : (options.videos || []);
  const scope = {
    DialogueCaptions: {
      chunker: {
        chunkCues(cues) {
          return cues.map((cue, index) => ({ ...cue, id: index, seekStart: cue.start }));
        },
        findActiveChunkIndexAtTime(chunks, time) {
          return chunks.findIndex((chunk) => time >= chunk.start && time < chunk.end);
        },
        findChunkIndexAtTime(chunks, time) {
          let result = -1;
          chunks.forEach((chunk, index) => {
            if (time >= chunk.start) {
              result = index;
            }
          });
          return result;
        }
      },
      settingsStore: {
        DEFAULTS: { panelClosed: true },
        normalizeSettings(value) {
          return value || {};
        },
        async load() {
          return { panelClosed: true };
        },
        async save(value) {
          return value;
        }
      },
      diagnostics: { record(name, detail) { diagnosticsEvents.push({ name, detail }); } },
      DialoguePanel: class {
        constructor(panelOptions) {
          this.options = panelOptions;
          this.destroyed = false;
          panelInstances.push(this);
        }
        mount() {}
        setStatus() {}
        setChunks() {}
        setFutureChunks() {}
        setActiveIndex() {}
        setPlaybackTime() {}
        refreshAnchorLayout() {
          this.layoutRefreshed = true;
        }
        destroy() {
          this.destroyed = true;
        }
      }
    },
    HTMLVideoElement: FakeVideo,
    location: { hostname: "example.com" },
    setInterval() {
      return 1;
    },
    clearInterval() {},
    document: {
      documentElement: {},
      addEventListener() {},
      removeEventListener() {},
      querySelectorAll() {
        return videos;
      }
    },
    addEventListener() {},
    removeEventListener() {},
    requestAnimationFrame(callback) {
      callback();
      return 1;
    },
    cancelAnimationFrame() {},
    MutationObserver: class {
      observe() {}
      disconnect() {}
    }
  };
  scope.window = scope;
  const source = fs.readFileSync(path.join(ROOT_DIR, "src", "universal-captions.js"), "utf8");
  vm.runInNewContext(source, scope);
  return { api: scope.DialogueCaptions.universalCaptions, FakeVideo, panelInstances, videos, diagnosticsEvents };
}

function makeEligibleVideo(FakeVideo, text) {
  const video = new FakeVideo();
  video.isConnected = true;
  video.duration = 30;
  video.currentTime = 0;
  video.addEventListener = () => {};
  video.removeEventListener = () => {};
  video.play = () => Promise.resolve();
  video.querySelectorAll = () => [];
  video.getBoundingClientRect = () => ({ width: 640, height: 360, left: 10, top: 20, right: 650, bottom: 380 });
  video.textTracks = [{
    kind: "captions",
    mode: "hidden",
    addEventListener() {},
    removeEventListener() {},
    cues: [{ startTime: 0, endTime: 2, text }]
  }];
  return video;
}

async function flushAsyncWork() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

exports.run = async function runUniversalCaptionsTests(ctx) {
  const { assert, runCase } = ctx;

  await runCase("generic text-track cue normalization keeps V1 timing shape", () => {
    const { api } = loadUniversalCaptions();
    const cue = api.normalizeTextTrackCue(
      { startTime: 1.25, endTime: 3.5, text: " hello   world " },
      2,
      "track-0",
      "generic-1"
    );
    assert.equal(cue.videoId, "generic-1");
    assert.equal(cue.sourceId, "track-0:2");
    assert.equal(cue.startMs, 1250);
    assert.equal(cue.endMs, 3500);
    assert.equal(cue.text, "hello world");
    assert.equal(cue.sourceType, "text-track");
  });

  await runCase("generic eligibility requires visible caption or subtitle tracks", () => {
    const { api, FakeVideo } = loadUniversalCaptions();
    const video = new FakeVideo();
    video.isConnected = true;
    video.textTracks = [{ kind: "captions" }];
    video.querySelectorAll = () => [];
    video.getBoundingClientRect = () => ({ width: 640, height: 360 });
    assert.equal(api.isEligibleVideo(video), true);

    video.textTracks = [];
    video.querySelectorAll = () => [{ kind: "subtitles" }];
    assert.equal(api.isEligibleVideo(video), true);

    video.getBoundingClientRect = () => ({ width: 80, height: 45 });
    assert.equal(api.isEligibleVideo(video), false);
  });

  await runCase("generic adapter exposes full and active-only timeline quality", () => {
    const { api, FakeVideo } = loadUniversalCaptions();
    const video = new FakeVideo();
    video.duration = 10;
    video.textTracks = [{
      kind: "captions",
      mode: "disabled",
      cues: [
        { startTime: 4, endTime: 5, text: "second" },
        { startTime: 1, endTime: 2, text: "first" }
      ]
    }];
    const adapter = new api.GenericTextTrackAdapter(video, "generic-7");
    const timeline = adapter.acquireTimeline();
    assert.equal(timeline.sourceType, "generic-text-track");
    assert.equal(timeline.completeness, "full-or-extended");
    assert.deepEqual(timeline.cues.map((cue) => cue.text), ["first", "second"]);
    assert.equal(video.textTracks[0].mode, "hidden");
    adapter.restoreTracks();
    assert.equal(video.textTracks[0].mode, "disabled");
  });

  await runCase("generic adapter tolerates read-only text track modes", () => {
    const { api, FakeVideo } = loadUniversalCaptions();
    const video = new FakeVideo();
    const track = {
      kind: "captions",
      cues: [{ startTime: 1, endTime: 2, text: "readonly mode cue" }]
    };
    Object.defineProperty(track, "mode", {
      get() {
        return "disabled";
      },
      set() {
        throw new Error("mode is readonly");
      }
    });
    video.duration = 10;
    video.textTracks = [track];
    const adapter = new api.GenericTextTrackAdapter(video, "generic-8");
    const timeline = adapter.acquireTimeline();
    assert.equal(timeline.cues.length, 1);
    assert.equal(timeline.cues[0].text, "readonly mode cue");
  });

  await runCase("universal controller is documented as an adapter seam", () => {
    const source = fs.readFileSync(path.join(ROOT_DIR, "src", "universal-captions.js"), "utf8");
    assert.ok(source.includes("GenericTextTrackAdapter"));
    assert.ok(source.includes("PlayerRegistry"));
    assert.ok(source.includes("sourceType: \"generic-text-track\""));
  });

  await runCase("generic registry attaches one panel per eligible video and cleans removed videos", async () => {
    const { api, panelInstances, videos, diagnosticsEvents } = loadUniversalCaptions({
      makeVideos(FakeVideo) {
        return [
          makeEligibleVideo(FakeVideo, "first video caption"),
          makeEligibleVideo(FakeVideo, "second video caption")
        ];
      }
    });
    const registry = new api.PlayerRegistry();

    registry.scan();
    await flushAsyncWork();
    assert.equal(registry.players.size, 2, JSON.stringify(diagnosticsEvents));
    assert.equal(panelInstances.length, 2);

    registry.scan();
    await flushAsyncWork();
    assert.equal(registry.players.size, 2);
    assert.equal(panelInstances.length, 2);

    videos[0].isConnected = false;
    registry.scan();
    await flushAsyncWork();
    assert.equal(registry.players.size, 1);
    assert.equal(panelInstances[0].destroyed, true);

    registry.destroy();
    assert.equal(panelInstances[1].destroyed, true);
  });
};
