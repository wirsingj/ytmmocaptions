(function initNativeCaptions(scope) {
  const app = (scope.DialogueCaptions = scope.DialogueCaptions || {});

  class NativeCaptionController {
    constructor(owner, options) {
      const opts = options || {};
      this.owner = owner;
      this.pageContext = opts.pageContext || app.pageContext || null;
      this.captionsWereOnBeforeExtension = null;
      this.captionsEnabledByExtension = false;
      this.captionsEnsured = false;
      this.captionEnsureStarted = false;
    }

    captureInitialState() {
      if (this.captionsWereOnBeforeExtension !== null) {
        return;
      }
      this.captionsWereOnBeforeExtension = this.owner.isSubtitlesEnabled();
    }

    resetEnsureState() {
      this.captionsEnsured = false;
      this.captionEnsureStarted = false;
    }

    isEnsured() {
      return Boolean(this.captionsEnsured);
    }

    isEnsureStarted() {
      return Boolean(this.captionEnsureStarted);
    }

    markEnsureStarted() {
      this.captionEnsureStarted = true;
    }

    markEnabledByExtensionIfInitiallyOff() {
      if (this.captionsWereOnBeforeExtension === false) {
        this.captionsEnabledByExtension = true;
      }
    }

    restoreIfExtensionEnabled() {
      const subtitlesWereOff = this.captionsWereOnBeforeExtension === false;
      if (this.captionsEnabledByExtension && subtitlesWereOff && this.owner.isSubtitlesEnabled()) {
        this.owner.setSubtitlesEnabled(false);
      }
      this.captionsEnabledByExtension = false;
      this.captionsWereOnBeforeExtension = null;
      this.resetEnsureState();
    }

    ensureOnce() {
      const owner = this.owner;
      if (owner.destroyed || owner.settings.panelClosed) {
        return;
      }
      this.captureInitialState();
      if (owner.isSubtitlesEnabled()) {
        this.captionsEnsured = true;
        return;
      }

      if (this.pageContext && typeof this.pageContext.triggerCaptionProbe === "function") {
        this.pageContext.triggerCaptionProbe();
      }
      owner.probeCaptionsNow();

      if (!owner.isSubtitlesEnabled() && owner.clickSubtitlesButtonFallback()) {
        this.markEnabledByExtensionIfInitiallyOff();
      }

      if (owner.isSubtitlesEnabled()) {
        this.captionsEnsured = true;
        this.captionsEnabledByExtension = this.captionsWereOnBeforeExtension === false;
      }
    }
  }

  app.NativeCaptionController = NativeCaptionController;
})(window);
