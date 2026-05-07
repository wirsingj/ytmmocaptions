(function initPlatform(scope) {
  const app = (scope.DialogueCaptions = scope.DialogueCaptions || {});
  const browserApi = typeof scope.browser !== "undefined" ? scope.browser : null;
  const chromeApi = typeof scope.chrome !== "undefined" ? scope.chrome : null;
  const browserStorageLocal = browserApi && browserApi.storage && browserApi.storage.local;
  const chromeStorageLocal = chromeApi && chromeApi.storage && chromeApi.storage.local;

  function callStorage(methodName, payload, fallbackValue) {
    if (browserStorageLocal && typeof browserStorageLocal[methodName] === "function") {
      return Promise.resolve(browserStorageLocal[methodName](payload)).then((result) =>
        typeof result === "undefined" ? fallbackValue : result
      );
    }

    if (!chromeStorageLocal || typeof chromeStorageLocal[methodName] !== "function") {
      return Promise.resolve(fallbackValue);
    }

    return new Promise((resolve, reject) => {
      chromeStorageLocal[methodName](payload, (result) => {
        const runtimeError = chromeApi && chromeApi.runtime ? chromeApi.runtime.lastError : null;
        if (runtimeError) {
          reject(new Error(runtimeError.message));
          return;
        }
        resolve(typeof result === "undefined" ? fallbackValue : result);
      });
    });
  }

  app.platform = {
    requestFrame(callback) {
      return scope.requestAnimationFrame(callback);
    },
    cancelFrame(id) {
      scope.cancelAnimationFrame(id);
    },
    storageGet(keys) {
      return callStorage("get", keys, {});
    },
    storageSet(values) {
      return callStorage("set", values, undefined);
    },
    runtimeGetURL(path) {
      if (browserApi && browserApi.runtime && typeof browserApi.runtime.getURL === "function") {
        return browserApi.runtime.getURL(path);
      }
      if (chromeApi && chromeApi.runtime && typeof chromeApi.runtime.getURL === "function") {
        return chromeApi.runtime.getURL(path);
      }
      return path;
    }
  };
})(window);
