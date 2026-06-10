(function initCaptionSession(scope) {
  const app = (scope.DialogueCaptions = scope.DialogueCaptions || {});

  class CaptionSessionManager {
    constructor(options) {
      const opts = options || {};
      this.AbortControllerClass =
        opts.AbortControllerClass ||
        scope.AbortController ||
        (typeof AbortController !== "undefined" ? AbortController : null);
      this.currentId = 0;
      this.currentReason = "";
      this.active = false;
      this.controllersBySession = new Map();
    }

    begin(reason) {
      this.invalidate(reason || "new-session");
      this.currentId += 1;
      this.currentReason = String(reason || "");
      this.active = true;
      return this.currentId;
    }

    getCurrentId() {
      return this.currentId;
    }

    isActive(sessionId) {
      return this.active && Number(sessionId) === this.currentId && this.currentId > 0;
    }

    createAbortController(sessionId) {
      if (!this.isActive(sessionId)) {
        return null;
      }
      if (!this.AbortControllerClass) {
        return null;
      }
      const controller = new this.AbortControllerClass();
      let controllers = this.controllersBySession.get(sessionId);
      if (!controllers) {
        controllers = new Set();
        this.controllersBySession.set(sessionId, controllers);
      }
      controllers.add(controller);
      return controller;
    }

    releaseAbortController(sessionId, controller) {
      const controllers = this.controllersBySession.get(sessionId);
      if (!controllers || !controller) {
        return;
      }
      controllers.delete(controller);
      if (!controllers.size) {
        this.controllersBySession.delete(sessionId);
      }
    }

    invalidate(reason) {
      this.currentReason = String(reason || "");
      this.controllersBySession.forEach((controllers) => {
        controllers.forEach((controller) => {
          try {
            if (controller && typeof controller.abort === "function") {
              controller.abort();
            }
          } catch {
            // Ignore abort failures from non-standard controller implementations.
          }
        });
      });
      this.controllersBySession.clear();
      this.active = false;
    }
  }

  app.CaptionSessionManager = CaptionSessionManager;
})(window);
