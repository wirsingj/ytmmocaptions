exports.run = async function runPlatformTests(ctx) {
  const { assert, loadModule, runCase } = ctx;

  await runCase("browser storage adapter calls get and set exactly once", async () => {
    const calls = { get: 0, set: 0 };
    const module = loadModule("platform.js", {
      windowProps: {
        browser: {
          storage: {
            local: {
              async get(key) {
                calls.get += 1;
                assert.equal(key, "settings");
                return { settings: { ok: true } };
              },
              async set(value) {
                calls.set += 1;
                assert.deepEqual(value, { settings: { ok: true } });
              }
            }
          }
        }
      }
    });

    const result = await module.platform.storageGet("settings");
    await module.platform.storageSet({ settings: { ok: true } });
    assert.deepEqual(result, { settings: { ok: true } });
    assert.deepEqual(calls, { get: 1, set: 1 });
  });

  await runCase("browser storage adapter works when Firefox exposes browser off-window", async () => {
    const calls = { get: 0, set: 0 };
    const module = loadModule("platform.js", {
      globalProps: {
        browser: {
          storage: {
            local: {
              async get(key) {
                calls.get += 1;
                assert.equal(key, "settings");
                return { settings: { ok: true } };
              },
              async set(value) {
                calls.set += 1;
                assert.deepEqual(value, { settings: { ok: true } });
              }
            }
          }
        }
      }
    });

    const result = await module.platform.storageGet("settings");
    await module.platform.storageSet({ settings: { ok: true } });
    assert.deepEqual(result, { settings: { ok: true } });
    assert.deepEqual(calls, { get: 1, set: 1 });
  });

  await runCase("chrome storage adapter uses callback path exactly once", async () => {
    const calls = { get: 0, set: 0 };
    const module = loadModule("platform.js", {
      windowProps: {
        chrome: {
          runtime: {},
          storage: {
            local: {
              get(key, callback) {
                calls.get += 1;
                assert.equal(key, "settings");
                callback({ settings: { ok: true } });
              },
              set(value, callback) {
                calls.set += 1;
                assert.deepEqual(value, { settings: { ok: true } });
                callback();
              }
            }
          }
        }
      }
    });

    const result = await module.platform.storageGet("settings");
    await module.platform.storageSet({ settings: { ok: true } });
    assert.deepEqual(result, { settings: { ok: true } });
    assert.deepEqual(calls, { get: 1, set: 1 });
  });
};
