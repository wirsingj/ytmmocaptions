(function initUiPanel(scope) {
  const app = (scope.DialogueCaptions = scope.DialogueCaptions || {});
  const chunker = app.chunker;
  const platform = app.platform;
  const bubbleState = app.bubbleState;
  const settingsStore = app.settingsStore;
  const timelineScrub = app.timelineScrub;

  const PANEL_ID = "dc-panel";
  const LAUNCHER_ID = "dc-launcher";
  const COLOR_PICKER_ID = "dc-color-picker";
  const ACTIVE_PAGE_CLASS = "dc-panel-open";
  const BOTTOM_PROXIMITY_PX = 140;
  const MIN_PANEL_WIDTH = 280;
  const MIN_PANEL_HEIGHT = 220;
  const DEFAULT_PANEL_MAX_WIDTH = 680;
  const DEFAULT_PANEL_MAX_HEIGHT = 500;
  const DEFAULT_PANEL_MARGIN = 12;
  const PANEL_CONTROL_BAR_GAP = 64;
  const LAUNCHER_MARGIN = 14;
  const LAUNCHER_WIDTH = 96;
  const LAUNCHER_HEIGHT = 32;
  const LAUNCHER_CONTROL_BAR_GAP = 54;
  const DEFAULT_FUTURE_PREVIEW_HEIGHT = 96;
  const MIN_FUTURE_PREVIEW_HEIGHT = 52;
  const MAX_FUTURE_PREVIEW_HEIGHT = 360;
  // Timeline mode is intentionally shipped dormant until it gets a focused UX pass.
  const TIMELINE_MODE_EXPERIMENT_ENABLED = false;
  const THEME_PRESETS = Object.freeze({
    stone: {
      label: "Stone",
      accent: "#ded6c3",
      text: "#eceff1",
      muted: "#a9adb3",
      bg: [12, 12, 13],
      panel: [28, 28, 30],
      card: [22, 23, 25],
      current: [48, 47, 44]
    },
    ember: {
      label: "Ember",
      accent: "#e2b07f",
      text: "#fff1e5",
      muted: "#c9aa94",
      bg: [18, 11, 8],
      panel: [48, 28, 20],
      card: [34, 21, 16],
      current: [68, 43, 30]
    },
    forest: {
      label: "Forest",
      accent: "#b8d6ad",
      text: "#eef7eb",
      muted: "#a9bca4",
      bg: [9, 14, 11],
      panel: [21, 39, 28],
      card: [15, 29, 21],
      current: [36, 61, 43]
    },
    ocean: {
      label: "Ocean",
      accent: "#a7cde3",
      text: "#edf7fb",
      muted: "#a7bac4",
      bg: [8, 13, 17],
      panel: [18, 38, 50],
      card: [13, 29, 39],
      current: [31, 59, 75]
    },
    violet: {
      label: "Violet",
      accent: "#cbb9ee",
      text: "#f5efff",
      muted: "#bab0c8",
      bg: [13, 10, 18],
      panel: [35, 26, 52],
      card: [25, 20, 38],
      current: [54, 43, 78]
    }
  });

  class DialoguePanel {
    constructor(options) {
      this.options = options || {};
      this.settings = this.options.settings || {};
      this.instanceId = String(this.options.instanceId || "").replace(/[^a-z0-9_-]/gi, "");
      this.panelId = this.instanceId ? PANEL_ID + "-" + this.instanceId : PANEL_ID;
      this.launcherId = this.instanceId ? LAUNCHER_ID + "-" + this.instanceId : LAUNCHER_ID;
      this.colorPickerId = this.instanceId ? COLOR_PICKER_ID + "-" + this.instanceId : COLOR_PICKER_ID;
      this.timelineId = this.instanceId ? "dc-timeline-" + this.instanceId : "dc-timeline";
      this.anchorElement = this.options.anchorElement instanceof Element ? this.options.anchorElement : null;
      this.persistLayout = this.options.persistLayout !== false;
      this.mountElement = null;

      this.root = null;
      this.body = null;
      this.statusEl = null;
      this.listViewport = null;
      this.topSpacer = null;
      this.windowContainer = null;
      this.bottomSpacer = null;

      this.opacityWrap = null;
      this.opacityInput = null;
      this.textScaleWrap = null;
      this.textScaleInput = null;
      this.themeSelect = null;
      this.themeColorButton = null;
      this.themeColorSwatch = null;
      this.colorPickerPopover = null;
      this.colorWheel = null;
      this.colorPickerIndicator = null;
      this.centerFadeInput = null;
      this.futurePreviewInput = null;
      this.timelineModeButton = null;
      this.timelineFeatureEnabled = TIMELINE_MODE_EXPERIMENT_ENABLED;
      this.layoutLockButton = null;
      this.timelineLayer = null;
      this.timelineTrack = null;
      this.timelineTooltip = null;
      this.header = null;
      this.resetButton = null;
      this.closeButton = null;
      this.launcherButton = null;
      this.jumpBottomButton = null;

      this.chunks = [];
      this.futureChunks = [];
      this.timelineChunks = [];
      this.timelineDuration = Number.NaN;
      this.timelineDataKey = "";
      this.timelineHoverIndex = -1;
      this.timelineHoverTime = Number.NaN;
      this.futureCollapsed = false;
      this.activeIndex = -1;
      this.playbackTime = Number.NaN;
      this.lastGlowIndex = -1;
      this.lastGlowWordStart = -1;
      this.lastGlowWordEnd = -1;
      this.currentWindowStart = -1;
      this.currentWindowEnd = -1;
      this.currentFutureCount = -1;
      this.currentFutureCollapsed = false;
      this.currentFutureKey = "";
      this.dragState = null;
      this.resizeState = null;
      this.futureDividerDragState = null;
      this.launcherDragState = null;
      this.launcherSuppressClickUntil = 0;
      this.suppressPageClickUntil = 0;
      this.resizeHandles = [];
      this.pointerInside = false;
      this.stickToBottom = true;
      this.programmaticScrollUntil = 0;

      this.cleanupFns = [];
      this.activePointerCleanupFns = [];
      this.layoutRefreshTimers = [];
      this.rafRenderId = 0;
      this.resizeMoveRafId = 0;
      this.statusTimer = 0;
      this.timelineLayerVisible = false;
    }

    mount() {
      this.removeExistingUiNodes();
      this.mountElement = this.resolveMountElement();
      if (this.mountElement) {
        this.mountElement.classList.add("dc-player-host");
      }

      this.root = document.createElement("section");
      this.root.id = this.panelId;
      this.root.className = "dc-panel";
      this.root.dataset.dcInstanceId = this.instanceId || "youtube";
      this.root.tabIndex = 0;
      this.root.setAttribute("aria-label", "MMO dialogue captions panel");
      this.resizeHandles = [];
      const resizeCorners = ["top-left", "top-right", "bottom-left", "bottom-right"];
      for (let index = 0; index < resizeCorners.length; index += 1) {
        const corner = resizeCorners[index];
        const handle = document.createElement("div");
        handle.className = "dc-resize-handle dc-resize-" + corner;
        handle.setAttribute("data-corner", corner);
        handle.title = "Resize panel";
        this.resizeHandles.push(handle);
      }

      const header = document.createElement("header");
      header.className = "dc-header";
      this.header = header;

      const titleWrap = document.createElement("div");
      titleWrap.className = "dc-title-wrap";
      const brandMark = document.createElement("span");
      brandMark.className = "dc-brand-mark";
      brandMark.setAttribute("aria-hidden", "true");
      const brandPlay = document.createElement("span");
      brandPlay.className = "dc-brand-play";
      const brandBubble = document.createElement("span");
      brandBubble.className = "dc-brand-bubble";
      brandMark.append(brandPlay, brandBubble);
      const title = document.createElement("h2");
      title.className = "dc-title";
      title.textContent = "YTMMOCC";
      titleWrap.append(brandMark, title);

      const controls = document.createElement("div");
      controls.className = "dc-controls";

      this.closeButton = document.createElement("button");
      this.closeButton.type = "button";
      this.closeButton.className = "dc-btn dc-btn-close";
      this.closeButton.textContent = "Close";
      this.closeButton.title = "Collapse to pill";

      this.resetButton = document.createElement("button");
      this.resetButton.type = "button";
      this.resetButton.className = "dc-btn dc-btn-reset";
      this.resetButton.textContent = "Reset";
      this.resetButton.title = "Reset panel layout for this video";

      this.layoutLockButton = document.createElement("button");
      this.layoutLockButton.type = "button";
      this.layoutLockButton.className = "dc-btn dc-btn-lock";
      this.layoutLockButton.textContent = "Lock";
      this.layoutLockButton.title = "Save panel layout across videos";
      this.layoutLockButton.setAttribute("aria-pressed", this.settings.layoutLocked ? "true" : "false");

      this.themeSelect = document.createElement("select");
      this.themeSelect.className = "dc-theme-select";
      this.themeSelect.title = "Panel theme";
      this.themeSelect.setAttribute("aria-label", "Panel theme");
      const themeOptions = [
        ["custom", "Custom", true],
        ["stone", "Stone"],
        ["ember", "Ember"],
        ["forest", "Forest"],
        ["ocean", "Ocean"],
        ["violet", "Violet"]
      ];
      for (let index = 0; index < themeOptions.length; index += 1) {
        const option = document.createElement("option");
        option.value = themeOptions[index][0];
        option.textContent = themeOptions[index][1];
        if (themeOptions[index][2]) {
          option.hidden = true;
        }
        this.themeSelect.append(option);
      }

      this.themeColorButton = document.createElement("button");
      this.themeColorButton.type = "button";
      this.themeColorButton.className = "dc-theme-color";
      this.themeColorButton.title = "Pick custom theme color";
      this.themeColorButton.setAttribute("aria-label", "Custom theme color");
      this.themeColorButton.setAttribute("aria-expanded", "false");
      this.themeColorSwatch = document.createElement("span");
      this.themeColorSwatch.className = "dc-theme-color-swatch";
      this.themeColorButton.append(this.themeColorSwatch);

      this.colorPickerPopover = document.createElement("div");
      this.colorPickerPopover.id = this.colorPickerId;
      this.colorPickerPopover.className = "dc-color-popover";
      this.colorPickerPopover.dataset.dcInstanceId = this.instanceId || "youtube";
      this.colorPickerPopover.hidden = true;
      this.colorPickerPopover.setAttribute("role", "dialog");
      this.colorPickerPopover.setAttribute("aria-label", "Pick custom theme color");
      this.colorWheel = document.createElement("button");
      this.colorWheel.type = "button";
      this.colorWheel.className = "dc-color-wheel";
      this.colorWheel.setAttribute("aria-label", "Color wheel");
      this.colorPickerIndicator = document.createElement("span");
      this.colorPickerIndicator.className = "dc-color-indicator";
      this.colorWheel.append(this.colorPickerIndicator);
      this.colorPickerPopover.append(this.colorWheel);

      const opacityWrap = document.createElement("label");
      opacityWrap.className = "dc-opacity-wrap";
      opacityWrap.textContent = "Opacity";
      this.opacityWrap = opacityWrap;

      this.opacityInput = document.createElement("input");
      this.opacityInput.type = "range";
      this.opacityInput.className = "dc-opacity-input";
      this.opacityInput.min = "10";
      this.opacityInput.max = "100";
      this.opacityInput.step = "1";
      this.opacityInput.value = String(this.settings.panelOpacity || 55);
      this.opacityInput.title = "Panel opacity";
      opacityWrap.append(this.opacityInput);

      const textScaleWrap = document.createElement("label");
      textScaleWrap.className = "dc-text-scale-wrap";
      textScaleWrap.textContent = "Text";
      this.textScaleWrap = textScaleWrap;

      this.textScaleInput = document.createElement("input");
      this.textScaleInput.type = "range";
      this.textScaleInput.className = "dc-text-scale-input";
      this.textScaleInput.min = "100";
      this.textScaleInput.max = "200";
      this.textScaleInput.step = "5";
      this.textScaleInput.value = String(this.settings.textScale || 100);
      this.textScaleInput.title = "Text size";
      textScaleWrap.append(this.textScaleInput);

      const centerFadeWrap = document.createElement("label");
      centerFadeWrap.className = "dc-center-fade-wrap";
      centerFadeWrap.title = "Fade toward the center of this video";
      centerFadeWrap.textContent = "Fade";
      this.centerFadeInput = document.createElement("input");
      this.centerFadeInput.type = "checkbox";
      this.centerFadeInput.className = "dc-center-fade-input";
      this.centerFadeInput.checked = this.settings.fadeTowardVideoCenter !== false;
      centerFadeWrap.append(this.centerFadeInput);

      const futurePreviewWrap = document.createElement("label");
      futurePreviewWrap.className = "dc-future-toggle-wrap";
      futurePreviewWrap.title = "Show Next Up preview captions";
      futurePreviewWrap.textContent = "Next";
      this.futurePreviewInput = document.createElement("input");
      this.futurePreviewInput.type = "checkbox";
      this.futurePreviewInput.className = "dc-future-toggle-input";
      this.futurePreviewInput.checked = this.settings.futurePreviewEnabled !== false;
      futurePreviewWrap.append(this.futurePreviewInput);

      this.timelineModeButton = document.createElement("button");
      this.timelineModeButton.type = "button";
      this.timelineModeButton.className = "dc-btn dc-btn-timeline";
      this.timelineModeButton.textContent = "Timeline";
      this.timelineModeButton.title = "Open transcript scrub mode";
      this.timelineModeButton.setAttribute("aria-pressed", this.settings.timelineModeEnabled ? "true" : "false");
      this.timelineModeButton.hidden = !this.timelineFeatureEnabled;

      controls.append(
        this.themeSelect,
        this.themeColorButton,
        opacityWrap,
        textScaleWrap,
        centerFadeWrap
      );
      if (this.timelineFeatureEnabled) {
        controls.append(this.timelineModeButton);
      }
      const actionControls = document.createElement("div");
      actionControls.className = "dc-control-actions";
      actionControls.append(this.layoutLockButton, this.resetButton, this.closeButton);
      controls.append(actionControls);
      header.append(titleWrap, controls);

      this.body = document.createElement("div");
      this.body.className = "dc-body";

      this.statusEl = document.createElement("div");
      this.statusEl.className = "dc-status";
      this.statusEl.setAttribute("aria-live", "polite");

      this.listViewport = document.createElement("div");
      this.listViewport.className = "dc-list-viewport";

      const content = document.createElement("div");
      content.className = "dc-list-content";

      this.topSpacer = document.createElement("div");
      this.topSpacer.className = "dc-spacer";

      this.windowContainer = document.createElement("div");
      this.windowContainer.className = "dc-window";

      this.bottomSpacer = document.createElement("div");
      this.bottomSpacer.className = "dc-spacer";

      content.append(this.topSpacer, this.windowContainer, this.bottomSpacer);
      this.listViewport.append(content);

      const footer = document.createElement("div");
      footer.className = "dc-footer";
      this.jumpBottomButton = document.createElement("button");
      this.jumpBottomButton.type = "button";
      this.jumpBottomButton.className = "dc-jump-bottom is-hidden";
      this.jumpBottomButton.textContent = "Jump to Current";
      this.jumpBottomButton.title = "Scroll to the current caption";
      footer.append(futurePreviewWrap, this.jumpBottomButton);

      this.body.append(this.statusEl, this.listViewport, footer);
      this.root.append(header, this.body);
      for (let index = 0; index < this.resizeHandles.length; index += 1) {
        this.root.append(this.resizeHandles[index]);
      }
      (this.mountElement || document.body).append(this.root);
      document.body.append(this.colorPickerPopover);

      this.timelineLayer = document.createElement("div");
      this.timelineLayer.id = this.timelineId;
      this.timelineLayer.className = "dc-timeline-layer";
      this.timelineLayer.dataset.dcInstanceId = this.instanceId || "youtube";
      this.timelineTrack = document.createElement("div");
      this.timelineTrack.className = "dc-timeline-track";
      this.timelineTooltip = document.createElement("div");
      this.timelineTooltip.className = "dc-timeline-lens";
      this.timelineTooltip.setAttribute("role", "tooltip");
      this.timelineLayer.append(this.timelineTrack, this.timelineTooltip);
      (this.mountElement || document.body).append(this.timelineLayer);

      this.launcherButton = document.createElement("button");
      this.launcherButton.type = "button";
      this.launcherButton.id = this.launcherId;
      this.launcherButton.className = "dc-launcher";
      this.launcherButton.dataset.dcInstanceId = this.instanceId || "youtube";
      this.launcherButton.textContent = "Captions";
      this.launcherButton.title = "Open panel (drag to move)";
      (this.mountElement || document.body).append(this.launcherButton);

      this.bindEvents();
      this.applySettings();
      this.scheduleSettledLayoutRefresh();
    }

    destroy() {
      if (this.rafRenderId) {
        platform.cancelFrame(this.rafRenderId);
        this.rafRenderId = 0;
      }
      if (this.statusTimer) {
        window.clearTimeout(this.statusTimer);
        this.statusTimer = 0;
      }
      for (let index = 0; index < this.layoutRefreshTimers.length; index += 1) {
        window.clearTimeout(this.layoutRefreshTimers[index]);
      }
      this.layoutRefreshTimers = [];
      for (let index = 0; index < this.cleanupFns.length; index += 1) {
        this.cleanupFns[index]();
      }
      this.cleanupFns.length = 0;
      this.cleanupActivePointerListeners();
      this.cancelResizeFrames();
      if (this.root) {
        this.root.remove();
        this.root = null;
      }
      if (this.launcherButton) {
        this.launcherButton.remove();
        this.launcherButton = null;
      }
      if (this.timelineLayer) {
        this.timelineLayer.remove();
        this.timelineLayer = null;
        this.timelineTrack = null;
        this.timelineTooltip = null;
      }
      if (this.colorPickerPopover) {
        this.colorPickerPopover.remove();
        this.colorPickerPopover = null;
        this.colorWheel = null;
        this.colorPickerIndicator = null;
      }
      this.removeExistingUiNodes();
      if (this.mountElement) {
        this.mountElement.classList.remove("dc-player-host");
        this.mountElement = null;
      }
      document.documentElement.classList.remove(ACTIVE_PAGE_CLASS);
    }

    removeExistingUiNodes() {
      const knownNodes = document.querySelectorAll(
        "#" + this.panelId + ", #" + this.launcherId + ", #" + this.timelineId + ", #" + this.colorPickerId
      );
      knownNodes.forEach((node) => {
        if (node instanceof Element) {
          node.remove();
        }
      });
    }

    resolveMountElement() {
      if (this.anchorElement instanceof HTMLElement && document.documentElement.contains(this.anchorElement)) {
        if (this.anchorElement.tagName !== "VIDEO") {
          return this.anchorElement;
        }
        if (this.anchorElement.parentElement instanceof HTMLElement) {
          return this.anchorElement.parentElement;
        }
      }
      const selectors = ["#movie_player", ".html5-video-player", "ytd-player"];
      for (let index = 0; index < selectors.length; index += 1) {
        const element = document.querySelector(selectors[index]);
        if (element instanceof HTMLElement) {
          return element;
        }
      }
      return document.body;
    }

    addListener(target, type, handler, options) {
      if (!target) {
        return;
      }
      target.addEventListener(type, handler, options);
      this.cleanupFns.push(() => target.removeEventListener(type, handler, options));
    }

    trackActivePointerListeners(cleanup) {
      if (typeof cleanup !== "function") {
        return cleanup;
      }
      this.activePointerCleanupFns.push(cleanup);
      return () => {
        cleanup();
        this.activePointerCleanupFns = this.activePointerCleanupFns.filter((item) => item !== cleanup);
      };
    }

    cleanupActivePointerListeners() {
      const cleanups = this.activePointerCleanupFns.slice();
      this.activePointerCleanupFns.length = 0;
      for (let index = 0; index < cleanups.length; index += 1) {
        cleanups[index]();
      }
      this.dragState = null;
      this.resizeState = null;
      this.futureDividerDragState = null;
      this.launcherDragState = null;
      this.cancelResizeFrames();
    }

    cancelResizeFrames() {
      if (this.resizeMoveRafId) {
        platform.cancelFrame(this.resizeMoveRafId);
        this.resizeMoveRafId = 0;
      }
    }

    bindEvents() {
      if (!this.root) {
        return;
      }

      const onPanelPointerDown = () => {
        if (this.root) {
          this.root.focus();
        }
      };
      this.addListener(this.root, "pointerdown", onPanelPointerDown);

      const onPageClick = (event) => {
        if (Date.now() >= this.suppressPageClickUntil) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === "function") {
          event.stopImmediatePropagation();
        }
      };
      this.addListener(window, "click", onPageClick, { capture: true });

      const onPointerEnter = () => {
        this.pointerInside = true;
      };
      const onPointerLeave = () => {
        this.pointerInside = false;
      };
      this.addListener(this.root, "pointerenter", onPointerEnter);
      this.addListener(this.root, "pointerleave", onPointerLeave);

      const onHeaderPointerDown = (event) => this.handleHeaderPointerDown(event);
      this.addListener(this.header, "pointerdown", onHeaderPointerDown);
      for (let index = 0; index < this.resizeHandles.length; index += 1) {
        const handle = this.resizeHandles[index];
        const corner = handle.getAttribute("data-corner") || "";
        const onResizeDown = (event) => this.handleResizePointerDown(event, corner);
        this.addListener(handle, "pointerdown", onResizeDown);
      }

      const onClose = () => this.closeToNearestCorner();
      const onReset = () => this.resetPanelDefaults();
      this.addListener(this.closeButton, "click", onClose);
      this.addListener(this.resetButton, "click", onReset);

      const onLayoutLockToggle = () => {
        this.updateSettings({ layoutLocked: !this.settings.layoutLocked });
      };
      this.addListener(this.layoutLockButton, "click", onLayoutLockToggle);

      const onOpacityInput = () => {
        this.updateSettings({ panelOpacity: Number(this.opacityInput.value) });
      };
      this.addListener(this.opacityInput, "input", onOpacityInput);
      this.addListener(this.opacityInput, "change", onOpacityInput);

      const onThemeChange = () => {
        this.updateSettings({ themeName: this.themeSelect.value || "stone" });
        this.closeColorPicker();
      };
      this.addListener(this.themeSelect, "change", onThemeChange);

      const onThemeColorClick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.toggleColorPicker();
      };
      this.addListener(this.themeColorButton, "click", onThemeColorClick);

      const onColorPickerPointerDown = (event) => {
        event.stopPropagation();
      };
      this.addListener(this.colorPickerPopover, "pointerdown", onColorPickerPointerDown);
      this.addListener(this.colorPickerPopover, "click", onColorPickerPointerDown);

      const onColorWheelPointer = (event) => {
        this.pickColorFromWheel(event);
      };
      this.addListener(this.colorWheel, "pointerdown", onColorWheelPointer);
      this.addListener(this.colorWheel, "pointermove", (event) => {
        if (event.buttons === 1) {
          this.pickColorFromWheel(event);
        }
      });

      const onColorPickerEscape = (event) => {
        if (event.key === "Escape") {
          this.closeColorPicker();
        }
      };
      this.addListener(this.root, "keydown", onColorPickerEscape);

      const onColorPickerOutside = (event) => {
        if (!this.colorPickerPopover || this.colorPickerPopover.hidden) {
          return;
        }
        const path = typeof event.composedPath === "function" ? event.composedPath() : [];
        if (path.includes(this.colorPickerPopover) || path.includes(this.themeColorButton)) {
          return;
        }
        const target = event.target;
        if (target instanceof Element && (target.closest(".dc-color-popover") || target.closest(".dc-theme-color"))) {
          return;
        }
        this.closeColorPicker();
      };
      this.addListener(document, "pointerdown", onColorPickerOutside);

      const onTextScaleInput = () => {
        this.updateSettings({ textScale: Number(this.textScaleInput.value) });
      };
      this.addListener(this.textScaleInput, "input", onTextScaleInput);
      this.addListener(this.textScaleInput, "change", onTextScaleInput);

      const onCenterFadeChange = () => {
        this.updateSettings({ fadeTowardVideoCenter: Boolean(this.centerFadeInput.checked) });
      };
      this.addListener(this.centerFadeInput, "change", onCenterFadeChange);

      const onFuturePreviewChange = () => {
        this.updateSettings({ futurePreviewEnabled: Boolean(this.futurePreviewInput.checked) });
      };
      this.addListener(this.futurePreviewInput, "change", onFuturePreviewChange);

      const onListPointerDown = (event) => {
        const target = event.target;
        if (target instanceof Element && target.closest(".dc-future-divider")) {
          this.handleFutureDividerPointerDown(event);
        }
      };
      this.addListener(this.listViewport, "pointerdown", onListPointerDown);

      const onTimelineToggle = () => {
        if (!this.timelineFeatureEnabled) {
          return;
        }
        this.updateSettings({ timelineModeEnabled: !this.settings.timelineModeEnabled });
      };
      this.addListener(this.timelineModeButton, "click", onTimelineToggle);

      const onLauncherClick = () => {
        if (Date.now() < this.launcherSuppressClickUntil) {
          return;
        }
        this.updateSettings({ panelClosed: false });
      };
      const onLauncherPointerDown = (event) => this.handleLauncherPointerDown(event);
      this.addListener(this.launcherButton, "click", onLauncherClick);
      this.addListener(this.launcherButton, "pointerdown", onLauncherPointerDown);

      const onListClick = (event) => {
        const target = event.target;
        if (!(target instanceof Element)) {
          return;
        }
        const chunkButton = target.closest(".dc-chunk");
        if (!chunkButton) {
          return;
        }
        const index = Number(chunkButton.getAttribute("data-index"));
        if (!Number.isInteger(index)) {
          return;
        }
        if (typeof this.options.onSeek === "function") {
          if (chunkButton.classList.contains("dc-chunk-future")) {
            this.options.onSeek({
              future: true,
              index: index,
              seekStart: Number(chunkButton.getAttribute("data-seek-start")),
              start: Number(chunkButton.getAttribute("data-start")),
              end: Number(chunkButton.getAttribute("data-end"))
            });
            return;
          }
          this.options.onSeek(index);
        }
      };
      this.addListener(this.listViewport, "click", onListClick);

      const onTimelineClick = (event) => this.handleTimelineClick(event);
      const onTimelineMove = (event) => this.handleTimelinePointerMove(event);
      const onTimelineLeave = () => this.hideTimelineTooltip();
      this.addListener(this.timelineLayer, "click", onTimelineClick);
      this.addListener(this.timelineLayer, "pointermove", onTimelineMove);
      this.addListener(this.timelineLayer, "pointerleave", onTimelineLeave);
      this.addListener(this.timelineTrack, "pointerleave", onTimelineLeave);

      const onJumpBottom = () => {
        this.scrollToCurrentCaption();
        this.scheduleWindowRender();
        this.updateJumpBottomVisibility();
      };
      this.addListener(this.jumpBottomButton, "click", onJumpBottom);

      const onScroll = () => {
        if (Date.now() < this.programmaticScrollUntil) {
          this.updateJumpBottomVisibility();
          this.scheduleWindowRender();
          return;
        }
        if (this.isNearBottom(2.6)) {
          this.stickToBottom = true;
        } else if (this.getBottomDistance() > BOTTOM_PROXIMITY_PX * 2) {
          this.stickToBottom = false;
        }
        this.updateJumpBottomVisibility();
        this.scheduleWindowRender();
      };
      this.addListener(this.listViewport, "scroll", onScroll, { passive: true });

      const onResize = () => {
        this.applySettings();
        this.updateColorPickerPosition();
      };
      this.addListener(window, "resize", onResize);

      const onWindowScroll = () => {
        this.refreshAnchorLayout();
        this.updateColorPickerPosition();
      };
      this.addListener(window, "scroll", onWindowScroll, { passive: true });

      const onFullscreenChange = () => this.refreshAnchorLayout();
      this.addListener(document, "fullscreenchange", onFullscreenChange);
    }

    updateSettings(patch) {
      this.settings = { ...this.settings, ...patch };
      this.applySettings();
      if (typeof this.options.onSettingsChange === "function") {
        this.options.onSettingsChange(this.settings, patch);
      }
    }

    getPersistenceSnapshot() {
      const snapshot = {
        panelClosed: !this.root || this.root.style.display === "none"
      };
      if (!this.root || snapshot.panelClosed || !this.settings.layoutLocked) {
        return snapshot;
      }
      const rect = this.getElementLocalRect(this.root);
      snapshot.panelPosition = this.localToPlayerPanelPosition(rect.left, rect.top, rect.width, rect.height);
      snapshot.panelSize = {
        width: Math.max(MIN_PANEL_WIDTH, Math.round(rect.width)),
        height: Math.max(MIN_PANEL_HEIGHT, Math.round(rect.height))
      };
      return snapshot;
    }

    scheduleSettledLayoutRefresh() {
      const delays = [350, 1200];
      for (let index = 0; index < delays.length; index += 1) {
        const timerId = window.setTimeout(() => {
          if (this.root) {
            this.applySettings();
          }
        }, delays[index]);
        this.layoutRefreshTimers.push(timerId);
      }
    }

    applySettings() {
      if (!this.root || !this.body) {
        return;
      }

      const panelClosed = Boolean(this.settings.panelClosed);
      this.root.style.display = panelClosed ? "none" : "flex";
      document.documentElement.classList.toggle(ACTIVE_PAGE_CLASS, !panelClosed);
      if (this.launcherButton) {
        this.launcherButton.style.display = panelClosed ? "inline-flex" : "none";
        this.launcherButton.hidden = !panelClosed;
        this.launcherButton.setAttribute("aria-hidden", panelClosed ? "false" : "true");
      }
      if (panelClosed) {
        this.pointerInside = false;
      }
      const timelineActive = this.timelineFeatureEnabled && Boolean(this.settings.timelineModeEnabled);
      this.body.style.display = timelineActive ? "none" : "flex";
      this.body.hidden = timelineActive;

      const isNarrowViewport = window.matchMedia("(max-width: 980px)").matches;
      const defaultPanelRect = isNarrowViewport ? null : this.getDefaultPanelRect();
      if (isNarrowViewport) {
        this.root.style.width = "";
        this.root.style.height = "";
      } else if (
        this.settings.panelSize &&
        Number.isFinite(this.settings.panelSize.width) &&
        Number.isFinite(this.settings.panelSize.height)
      ) {
        const panelFrame = this.getPanelFrameRect();
        const maxPanelHeight = Math.max(
          MIN_PANEL_HEIGHT,
          panelFrame.bottom - panelFrame.top - DEFAULT_PANEL_MARGIN * 2
        );
        const boundedWidth = Math.max(
          MIN_PANEL_WIDTH,
          Math.min(panelFrame.right - panelFrame.left - DEFAULT_PANEL_MARGIN * 2, Number(this.settings.panelSize.width))
        );
        const boundedHeight = Math.max(
          MIN_PANEL_HEIGHT,
          Math.min(maxPanelHeight, Number(this.settings.panelSize.height))
        );
        this.root.style.width = Math.round(boundedWidth) + "px";
        this.root.style.height = Math.round(boundedHeight) + "px";
      } else if (defaultPanelRect) {
        this.root.style.width = defaultPanelRect.width + "px";
        this.root.style.height = defaultPanelRect.height + "px";
      } else {
        this.root.style.width = "";
        this.root.style.height = "";
      }

      const panelOpacity = Number(this.settings.panelOpacity || 55);
      const normalizedOpacity = Math.max(10, Math.min(100, panelOpacity));
      this.applyTheme();
      this.applyPanelBlend(normalizedOpacity);
      if (this.opacityInput && this.opacityInput.value !== String(normalizedOpacity)) {
        this.opacityInput.value = String(normalizedOpacity);
      }
      const textScale = Number(this.settings.textScale || 100);
      const normalizedTextScale = Math.max(100, Math.min(200, textScale));
      this.root.style.setProperty("--dc-text-scale", String(normalizedTextScale / 100));
      if (this.timelineLayer) {
        this.timelineLayer.style.setProperty("--dc-text-scale", String(normalizedTextScale / 100));
      }
      if (this.textScaleInput && this.textScaleInput.value !== String(normalizedTextScale)) {
        this.textScaleInput.value = String(normalizedTextScale);
      }
      if (this.centerFadeInput) {
        this.centerFadeInput.checked = this.settings.fadeTowardVideoCenter !== false;
      }
      if (this.futurePreviewInput) {
        this.futurePreviewInput.checked = this.settings.futurePreviewEnabled !== false;
      }
      if (this.layoutLockButton) {
        const locked = Boolean(this.settings.layoutLocked);
        this.layoutLockButton.classList.toggle("is-active", locked);
        this.layoutLockButton.textContent = locked ? "Locked" : "Lock";
        this.layoutLockButton.title = locked
          ? "Panel layout is saved across videos"
          : "Save panel size, position, text size, and Next layout across videos";
        this.layoutLockButton.setAttribute("aria-pressed", locked ? "true" : "false");
      }
      if (this.timelineModeButton) {
        this.timelineModeButton.classList.toggle("is-active", timelineActive);
        this.timelineModeButton.textContent = timelineActive ? "Panel" : "Timeline";
        this.timelineModeButton.title = timelineActive ? "Return to full caption panel" : "Open transcript scrub mode";
        this.timelineModeButton.hidden = !this.timelineFeatureEnabled;
        this.timelineModeButton.setAttribute("aria-pressed", timelineActive ? "true" : "false");
      }
      if (this.root) {
        this.root.classList.toggle("is-timeline-scrub", timelineActive);
      }
      if (this.themeSelect) {
        const themeName = this.getThemeName();
        if (this.themeSelect.value !== themeName) {
          this.themeSelect.value = themeName;
        }
      }
      if (this.themeColorSwatch) {
        this.themeColorSwatch.style.background = this.getThemeName() === "custom"
          ? this.getCustomThemeColor()
          : this.getActiveTheme().accent;
      }
      if (this.themeColorButton) {
        this.themeColorButton.classList.toggle("is-active", this.getThemeName() === "custom");
      }
      this.updateColorPickerIndicator();
      this.updateColorPickerPosition();
      this.applyFuturePreviewHeight();
      if (this.stickToBottom) {
        this.scrollToBottom();
      }

      if (this.persistLayout && this.settings.panelPosition && Number.isFinite(this.settings.panelPosition.left) && Number.isFinite(this.settings.panelPosition.top)) {
        this.applySavedPanelPosition();
      } else if (defaultPanelRect) {
        this.root.style.left = defaultPanelRect.left + "px";
        this.root.style.top = defaultPanelRect.top + "px";
        this.root.style.right = "auto";
        this.root.style.bottom = "auto";
      } else {
        this.root.style.left = "";
        this.root.style.top = "";
        this.root.style.right = "";
        this.root.style.bottom = "";
      }

      this.updatePanelFade();
      this.applyLauncherPosition();
      this.normalizeSavedPanelPosition();
      this.updatePanelFade();
      this.updateTimelineLayer();
      this.updateJumpBottomVisibility();
    }

    applyPanelBlend(opacityPercent) {
      if (!this.root) {
        return;
      }
      const normalizedPercent = Math.max(10, Math.min(100, Number(opacityPercent)));
      const blend = (normalizedPercent - 10) / 90;
      const setAlpha = (name, value) => {
        const alpha = Math.max(0, Math.min(1, value)).toFixed(3);
        this.root.style.setProperty(name, alpha);
        if (this.timelineLayer) {
          this.timelineLayer.style.setProperty(name, alpha);
        }
      };
      const eased = Math.pow(blend, 0.72);
      setAlpha("--dc-panel-alpha-inner", 0.02 + eased * 0.98);
      setAlpha("--dc-panel-alpha-mid", 0.02 + eased * 0.98);
      setAlpha("--dc-panel-alpha-outer", 0.16 + eased * 0.84);
      setAlpha("--dc-panel-alpha-base", 0.02 + eased * 0.98);
      setAlpha("--dc-panel-fade-light", 0);
      setAlpha("--dc-panel-fade-shadow", 0);
      setAlpha("--dc-panel-fade-shadow-soft", 0);
      setAlpha("--dc-card-alpha", 0.2 + eased * 0.8);
      setAlpha("--dc-card-current-alpha", 0.26 + eased * 0.74);
      this.root.style.opacity = "1";
    }

    getThemeName() {
      const name = String(this.settings.themeName || "stone").toLowerCase();
      return name === "custom" || Object.prototype.hasOwnProperty.call(THEME_PRESETS, name) ? name : "stone";
    }

    getCustomThemeColor() {
      const color = String(this.settings.customThemeColor || "#ded6c3").trim();
      return /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : "#ded6c3";
    }

    toggleColorPicker() {
      if (!this.colorPickerPopover) {
        return;
      }
      const nextOpen = Boolean(this.colorPickerPopover.hidden);
      this.colorPickerPopover.hidden = !nextOpen;
      this.themeColorButton.setAttribute("aria-expanded", nextOpen ? "true" : "false");
      if (nextOpen) {
        this.updateColorPickerPosition();
        this.updateColorPickerIndicator();
      }
    }

    closeColorPicker() {
      if (!this.colorPickerPopover) {
        return;
      }
      this.colorPickerPopover.hidden = true;
      if (this.themeColorButton) {
        this.themeColorButton.setAttribute("aria-expanded", "false");
      }
    }

    pickColorFromWheel(event) {
      if (!this.colorWheel) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const rect = this.colorWheel.getBoundingClientRect();
      const radius = Math.max(1, Math.min(rect.width, rect.height) / 2);
      const dx = event.clientX - rect.left - rect.width / 2;
      const dy = event.clientY - rect.top - rect.height / 2;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const saturation = Math.max(0, Math.min(1, distance / radius));
      const hue = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
      const color = this.hsvToHex(hue, saturation, 0.92);
      this.updateSettings({ themeName: "custom", customThemeColor: color });
      if (this.colorPickerPopover) {
        this.colorPickerPopover.hidden = false;
        this.updateColorPickerPosition();
      }
      if (this.themeColorButton) {
        this.themeColorButton.setAttribute("aria-expanded", "true");
      }
    }

    updateColorPickerIndicator() {
      if (!this.colorPickerIndicator || !this.colorWheel) {
        return;
      }
      const hsv = this.hexToHsv(this.getCustomThemeColor());
      const radiusPercent = Math.max(0, Math.min(1, hsv.s)) * 50;
      const radians = hsv.h * Math.PI / 180;
      const left = 50 + Math.cos(radians) * radiusPercent;
      const top = 50 + Math.sin(radians) * radiusPercent;
      this.colorPickerIndicator.style.left = left.toFixed(1) + "%";
      this.colorPickerIndicator.style.top = top.toFixed(1) + "%";
      this.colorPickerIndicator.style.background = this.getCustomThemeColor();
    }

    updateColorPickerPosition() {
      if (!this.colorPickerPopover || !this.themeColorButton || this.colorPickerPopover.hidden) {
        return;
      }
      const rect = this.themeColorButton.getBoundingClientRect();
      const popoverWidth = this.colorPickerPopover.offsetWidth || 132;
      const popoverHeight = this.colorPickerPopover.offsetHeight || 132;
      const margin = 8;
      const left = Math.max(
        margin,
        Math.min(window.innerWidth - popoverWidth - margin, rect.left)
      );
      const top = Math.max(
        margin,
        Math.min(window.innerHeight - popoverHeight - margin, rect.bottom + 6)
      );
      this.colorPickerPopover.style.left = Math.round(left) + "px";
      this.colorPickerPopover.style.top = Math.round(top) + "px";
    }

    hexToRgb(hex) {
      const value = String(hex || "").replace("#", "");
      if (!/^[0-9a-f]{6}$/i.test(value)) {
        return [222, 214, 195];
      }
      return [
        parseInt(value.slice(0, 2), 16),
        parseInt(value.slice(2, 4), 16),
        parseInt(value.slice(4, 6), 16)
      ];
    }

    hsvToHex(hue, saturation, value) {
      const h = ((Number(hue) % 360) + 360) % 360;
      const s = Math.max(0, Math.min(1, Number(saturation)));
      const v = Math.max(0, Math.min(1, Number(value)));
      const chroma = v * s;
      const x = chroma * (1 - Math.abs(((h / 60) % 2) - 1));
      const match = v - chroma;
      let rgb = [0, 0, 0];
      if (h < 60) {
        rgb = [chroma, x, 0];
      } else if (h < 120) {
        rgb = [x, chroma, 0];
      } else if (h < 180) {
        rgb = [0, chroma, x];
      } else if (h < 240) {
        rgb = [0, x, chroma];
      } else if (h < 300) {
        rgb = [x, 0, chroma];
      } else {
        rgb = [chroma, 0, x];
      }
      return this.rgbToHex(rgb.map((channel) => Math.round((channel + match) * 255)));
    }

    hexToHsv(hex) {
      const rgb = this.hexToRgb(hex).map((value) => Math.max(0, Math.min(255, value)) / 255);
      const max = Math.max(rgb[0], rgb[1], rgb[2]);
      const min = Math.min(rgb[0], rgb[1], rgb[2]);
      const delta = max - min;
      let hue = 0;
      if (delta !== 0) {
        if (max === rgb[0]) {
          hue = 60 * (((rgb[1] - rgb[2]) / delta) % 6);
        } else if (max === rgb[1]) {
          hue = 60 * ((rgb[2] - rgb[0]) / delta + 2);
        } else {
          hue = 60 * ((rgb[0] - rgb[1]) / delta + 4);
        }
      }
      return {
        h: (hue + 360) % 360,
        s: max === 0 ? 0 : delta / max,
        v: max
      };
    }

    mixColor(left, right, amount) {
      const ratio = Math.max(0, Math.min(1, Number(amount)));
      return [
        Math.round(left[0] * (1 - ratio) + right[0] * ratio),
        Math.round(left[1] * (1 - ratio) + right[1] * ratio),
        Math.round(left[2] * (1 - ratio) + right[2] * ratio)
      ];
    }

    rotateHue(rgb, degrees) {
      const normalized = rgb.map((value) => Math.max(0, Math.min(255, value)) / 255);
      const max = Math.max(normalized[0], normalized[1], normalized[2]);
      const min = Math.min(normalized[0], normalized[1], normalized[2]);
      const lightness = (max + min) / 2;
      const delta = max - min;
      if (delta === 0) {
        return rgb.slice();
      }
      const saturation = delta / (1 - Math.abs(2 * lightness - 1));
      let hue = 0;
      if (max === normalized[0]) {
        hue = 60 * (((normalized[1] - normalized[2]) / delta) % 6);
      } else if (max === normalized[1]) {
        hue = 60 * ((normalized[2] - normalized[0]) / delta + 2);
      } else {
        hue = 60 * ((normalized[0] - normalized[1]) / delta + 4);
      }
      hue = (hue + degrees + 360) % 360;
      const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
      const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
      const match = lightness - chroma / 2;
      let next = [0, 0, 0];
      if (hue < 60) {
        next = [chroma, x, 0];
      } else if (hue < 120) {
        next = [x, chroma, 0];
      } else if (hue < 180) {
        next = [0, chroma, x];
      } else if (hue < 240) {
        next = [0, x, chroma];
      } else if (hue < 300) {
        next = [x, 0, chroma];
      } else {
        next = [chroma, 0, x];
      }
      return next.map((value) => Math.round((value + match) * 255));
    }

    rgbToHex(rgb) {
      return "#" + rgb
        .map((value) => Math.max(0, Math.min(255, Number(value) || 0)).toString(16).padStart(2, "0"))
        .join("");
    }

    rgbString(rgb) {
      return rgb.join(", ");
    }

    getActiveTheme() {
      const name = this.getThemeName();
      if (name !== "custom") {
        return THEME_PRESETS[name] || THEME_PRESETS.stone;
      }
      const accent = this.hexToRgb(this.getCustomThemeColor());
      const analogous = this.rotateHue(accent, -24);
      const complement = this.rotateHue(accent, 170);
      const baseDark = [10, 10, 12];
      return {
        label: "Custom",
        accent: this.rgbToHex(accent),
        text: this.rgbToHex(this.mixColor(this.mixColor(accent, analogous, 0.18), [255, 255, 255], 0.82)),
        muted: this.rgbToHex(this.mixColor(this.mixColor(accent, complement, 0.22), [165, 165, 165], 0.62)),
        bg: this.mixColor(this.mixColor(accent, complement, 0.36), baseDark, 0.88),
        panel: this.mixColor(this.mixColor(accent, analogous, 0.42), [24, 24, 27], 0.72),
        card: this.mixColor(this.mixColor(accent, complement, 0.3), [18, 18, 21], 0.8),
        current: this.mixColor(this.mixColor(accent, analogous, 0.24), [46, 45, 43], 0.58)
      };
    }

    applyTheme() {
      if (!this.root) {
        return;
      }
      const theme = this.getActiveTheme();
      const accentRgb = this.hexToRgb(theme.accent);
      const textRgb = this.hexToRgb(theme.text);
      const mutedRgb = this.hexToRgb(theme.muted);
      this.root.style.setProperty("--dc-accent", theme.accent);
      this.root.style.setProperty("--dc-text", theme.text);
      this.root.style.setProperty("--dc-muted", theme.muted);
      this.root.style.setProperty("--dc-accent-rgb", this.rgbString(accentRgb));
      this.root.style.setProperty("--dc-text-rgb", this.rgbString(textRgb));
      this.root.style.setProperty("--dc-muted-rgb", this.rgbString(mutedRgb));
      this.root.style.setProperty("--dc-bg-rgb", this.rgbString(theme.bg));
      this.root.style.setProperty("--dc-panel-rgb", this.rgbString(theme.panel));
      this.root.style.setProperty("--dc-card-rgb", this.rgbString(theme.card));
      this.root.style.setProperty("--dc-current-rgb", this.rgbString(theme.current));
      if (this.timelineLayer) {
        this.timelineLayer.style.setProperty("--dc-accent", theme.accent);
        this.timelineLayer.style.setProperty("--dc-text", theme.text);
        this.timelineLayer.style.setProperty("--dc-muted", theme.muted);
        this.timelineLayer.style.setProperty("--dc-accent-rgb", this.rgbString(accentRgb));
        this.timelineLayer.style.setProperty("--dc-text-rgb", this.rgbString(textRgb));
        this.timelineLayer.style.setProperty("--dc-muted-rgb", this.rgbString(mutedRgb));
        this.timelineLayer.style.setProperty("--dc-bg-rgb", this.rgbString(theme.bg));
        this.timelineLayer.style.setProperty("--dc-panel-rgb", this.rgbString(theme.panel));
        this.timelineLayer.style.setProperty("--dc-card-rgb", this.rgbString(theme.card));
        this.timelineLayer.style.setProperty("--dc-current-rgb", this.rgbString(theme.current));
      }
    }

    updatePanelFade() {
      if (!this.root || this.root.style.display === "none") {
        return;
      }
      const rect = this.root.getBoundingClientRect();
      if (!rect.width || !rect.height) {
        return;
      }
      const frame = this.getYouTubeFrameRect();
      const centerX = frame.left + (frame.right - frame.left) / 2;
      const centerY = frame.top + (frame.bottom - frame.top) / 2;
      const fadeX = Math.max(0, Math.min(100, ((centerX - rect.left) / rect.width) * 100));
      const fadeY = Math.max(0, Math.min(100, ((centerY - rect.top) / rect.height) * 100));
      this.root.style.setProperty("--dc-fade-x", fadeX.toFixed(1) + "%");
      this.root.style.setProperty("--dc-fade-y", fadeY.toFixed(1) + "%");
      const enabled = this.settings.fadeTowardVideoCenter !== false;
      const strength = Math.max(0, Math.min(90, Number(this.settings.videoCenterFadeStrength || 84))) / 100;
      const opacityPercent = Math.max(10, Math.min(100, Number(this.settings.panelOpacity || 55)));
      const opacityBlend = (opacityPercent - 10) / 90;
      const centerAlpha = enabled ? Math.min(0.86, 0.36 + opacityBlend * 0.38 + (1 - strength) * 0.08) : 1;
      const midAlpha = enabled ? centerAlpha + (1 - centerAlpha) * 0.46 : 1;
      this.root.style.setProperty("--dc-center-mask-alpha", centerAlpha.toFixed(3));
      this.root.style.setProperty("--dc-center-mask-mid-alpha", midAlpha.toFixed(3));
      this.root.style.setProperty("--dc-edge-mask-alpha", "1");
      this.root.style.setProperty("--dc-center-mask-midpoint", "50%");
    }

    getDefaultPanelRect() {
      const frame = this.getYouTubeFrameRect();
      const frameWidth = Math.max(0, frame.right - frame.left);
      const frameHeight = Math.max(0, frame.bottom - frame.top);
      if (frameWidth < 160 || frameHeight < 90) {
        return null;
      }
      const width = Math.max(
        MIN_PANEL_WIDTH,
        Math.min(DEFAULT_PANEL_MAX_WIDTH, Math.round(frameWidth * 0.42))
      );
      const height = Math.max(
        MIN_PANEL_HEIGHT,
        Math.min(DEFAULT_PANEL_MAX_HEIGHT, Math.round(frameHeight * 0.56))
      );
      const clamped = this.clampPositionToRect(
        frame.left + DEFAULT_PANEL_MARGIN,
        frame.bottom - height - DEFAULT_PANEL_MARGIN,
        width,
        height,
        this.getDefaultPanelFrameRect(),
        DEFAULT_PANEL_MARGIN
      );
      return {
        left: clamped.left,
        top: clamped.top,
        width: width,
        height: height
      };
    }

    resetPanelDefaults() {
      const defaults = settingsStore && settingsStore.DEFAULTS ? settingsStore.DEFAULTS : {};
      this.updateSettings({
        textScale: Number.isFinite(defaults.textScale) ? defaults.textScale : 120,
        panelPosition: null,
        panelSize: null,
        futurePreviewHeight: Number.isFinite(defaults.futurePreviewHeight) ? defaults.futurePreviewHeight : DEFAULT_FUTURE_PREVIEW_HEIGHT,
        futurePreviewEnabled: defaults.futurePreviewEnabled !== false,
        videoCenterFadeStrength: Number.isFinite(defaults.videoCenterFadeStrength) ? defaults.videoCenterFadeStrength : 84,
        videoCenterFadeMidpoint: Number.isFinite(defaults.videoCenterFadeMidpoint) ? defaults.videoCenterFadeMidpoint : 50,
        videoCenterFadeMinOpacity: Number.isFinite(defaults.videoCenterFadeMinOpacity) ? defaults.videoCenterFadeMinOpacity : 12,
        timelineModeEnabled: Boolean(defaults.timelineModeEnabled),
        launcherPosition: null,
        panelClosed: false
      });
    }

    applyFuturePreviewHeight() {
      if (!this.root) {
        return;
      }
      const savedHeight = Number(this.settings.futurePreviewHeight);
      const defaultHeight = settingsStore && settingsStore.DEFAULTS
        ? Number(settingsStore.DEFAULTS.futurePreviewHeight)
        : DEFAULT_FUTURE_PREVIEW_HEIGHT;
      const maxByPanel = this.getMaxFuturePreviewHeight();
      const nextHeight = Math.max(
        MIN_FUTURE_PREVIEW_HEIGHT,
        Math.min(maxByPanel, Number.isFinite(savedHeight) ? savedHeight : defaultHeight || DEFAULT_FUTURE_PREVIEW_HEIGHT)
      );
      this.root.style.setProperty("--dc-future-preview-height", Math.round(nextHeight) + "px");
    }

    getMaxFuturePreviewHeight() {
      if (!this.root) {
        return MAX_FUTURE_PREVIEW_HEIGHT;
      }
      const panelHeight = this.root.getBoundingClientRect().height || 0;
      return panelHeight
        ? Math.max(MIN_FUTURE_PREVIEW_HEIGHT, Math.min(MAX_FUTURE_PREVIEW_HEIGHT, Math.round(panelHeight * 0.46)))
        : MAX_FUTURE_PREVIEW_HEIGHT;
    }

    getYouTubeFrameRect() {
      if (this.anchorElement instanceof Element && document.documentElement.contains(this.anchorElement)) {
        const anchorRect = this.anchorElement.getBoundingClientRect();
        if (anchorRect.width >= 160 && anchorRect.height >= 90) {
          return {
            left: anchorRect.left,
            top: anchorRect.top,
            right: anchorRect.right,
            bottom: anchorRect.bottom
          };
        }
      }
      const selectors = ["#movie_player", ".html5-video-player", "ytd-player"];
      for (let index = 0; index < selectors.length; index += 1) {
        const element = document.querySelector(selectors[index]);
        if (!(element instanceof Element)) {
          continue;
        }
        const rect = element.getBoundingClientRect();
        if (rect.width >= 160 && rect.height >= 90) {
          return {
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom
          };
        }
      }
      return {
        left: 0,
        top: 0,
        right: 0,
        bottom: 0
      };
    }

    isAnchorUsablyVisible() {
      const frame = this.getVisibleYouTubeFrameRect();
      const width = frame.right - frame.left;
      const height = frame.bottom - frame.top;
      return width >= 80 && height >= 56;
    }

    getVisibleYouTubeFrameRect() {
      const frame = this.getYouTubeFrameRect();
      return {
        left: Math.max(0, frame.left),
        top: Math.max(0, frame.top),
        right: Math.min(window.innerWidth, frame.right),
        bottom: Math.min(window.innerHeight, frame.bottom)
      };
    }

    getMountViewportRect() {
      if (this.mountElement instanceof Element && document.documentElement.contains(this.mountElement)) {
        return this.mountElement.getBoundingClientRect();
      }
      return { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
    }

    getElementLocalRect(element) {
      const rect = element.getBoundingClientRect();
      const mountRect = this.getMountViewportRect();
      return {
        left: rect.left - mountRect.left,
        top: rect.top - mountRect.top,
        right: rect.right - mountRect.left,
        bottom: rect.bottom - mountRect.top,
        width: rect.width,
        height: rect.height
      };
    }

    clampPositionToRect(left, top, width, height, bounds, margin) {
      const safeWidth = Math.max(1, Number(width) || 1);
      const safeHeight = Math.max(1, Number(height) || 1);
      const safeMargin = Math.max(0, Number(margin) || 0);
      const minLeft = Math.round(bounds.left + safeMargin);
      const minTop = Math.round(bounds.top + safeMargin);
      const maxLeft = Math.round(Math.max(minLeft, bounds.right - safeWidth - safeMargin));
      const maxTop = Math.round(Math.max(minTop, bounds.bottom - safeHeight - safeMargin));
      return {
        left: Math.max(minLeft, Math.min(maxLeft, Math.round(Number(left) || minLeft))),
        top: Math.max(minTop, Math.min(maxTop, Math.round(Number(top) || minTop)))
      };
    }

    getLauncherFrameRect() {
      const frame = this.getPanelFrameRect();
      return {
        ...frame,
        bottom: Math.max(frame.top + LAUNCHER_HEIGHT + LAUNCHER_MARGIN * 2, frame.bottom - LAUNCHER_CONTROL_BAR_GAP)
      };
    }

    getPanelFrameRect() {
      const mountRect = this.getMountViewportRect();
      const width = Math.max(0, mountRect.right - mountRect.left);
      const height = Math.max(0, mountRect.bottom - mountRect.top);
      return {
        left: 0,
        top: 0,
        right: width,
        bottom: height
      };
    }

    refreshAnchorLayout() {
      let anchorVisible = this.isAnchorUsablyVisible();
      if (this.root) {
        this.root.classList.toggle("is-anchor-offscreen", !anchorVisible);
      }
      if (this.launcherButton) {
        this.launcherButton.classList.toggle("is-anchor-offscreen", !anchorVisible);
      }
      if (!this.root || this.root.style.display === "none") {
        this.applyLauncherPosition();
        this.updateTimelineLayer();
        return;
      }
      if (!this.persistLayout) {
        const rect = this.getDefaultPanelRect();
        if (rect) {
          this.root.style.left = rect.left + "px";
          this.root.style.top = rect.top + "px";
          if (!this.settings.panelSize) {
            this.root.style.width = rect.width + "px";
            this.root.style.height = rect.height + "px";
          }
        }
      } else {
        this.normalizeSavedPanelPosition();
      }
      this.root.classList.toggle("is-anchor-offscreen", !anchorVisible);
      this.applyLauncherPosition();
      this.updatePanelFade();
      this.updateTimelineLayer();
    }

    getDefaultPanelFrameRect() {
      const frame = this.getPanelFrameRect();
      return {
        ...frame,
        bottom: Math.max(frame.top + MIN_PANEL_HEIGHT + DEFAULT_PANEL_MARGIN * 2, frame.bottom - PANEL_CONTROL_BAR_GAP)
      };
    }

    clampPanelPosition(left, top, width, height) {
      return this.clampPositionToRect(left, top, width, height, this.getPanelFrameRect(), DEFAULT_PANEL_MARGIN);
    }

    panelPositionToLocal(width, height) {
      if (!this.settings.panelPosition) {
        return null;
      }
      const position = this.settings.panelPosition;
      const mountRect = this.getMountViewportRect();
      const sourceLeft = position.anchor === "player" ? Number(position.left) : Number(position.left) - mountRect.left;
      const sourceTop = position.anchor === "player" ? Number(position.top) : Number(position.top) - mountRect.top;
      return this.clampPanelPosition(sourceLeft, sourceTop, width, height);
    }

    localToPlayerPanelPosition(left, top, width, height) {
      const clamped = this.clampPanelPosition(left, top, width, height);
      return {
        anchor: "player",
        left: Math.max(0, Math.round(clamped.left)),
        top: Math.max(0, Math.round(clamped.top))
      };
    }

    applySavedPanelPosition() {
      if (!this.root || !this.settings.panelPosition) {
        return;
      }
      const rect = this.getElementLocalRect(this.root);
      const positioned = this.panelPositionToLocal(rect.width, rect.height);
      if (!positioned) {
        return;
      }
      this.root.style.left = positioned.left + "px";
      this.root.style.top = positioned.top + "px";
      this.root.style.right = "auto";
      this.root.style.bottom = "auto";
    }

    clampLauncherPosition(left, top, width, height) {
      return this.clampPositionToRect(left, top, width, height, this.getLauncherFrameRect(), LAUNCHER_MARGIN);
    }

    applyLauncherPosition() {
      if (!this.launcherButton) {
        return;
      }
      if (this.launcherButton.style.display === "none") {
        return;
      }
      const width = this.launcherButton.offsetWidth || LAUNCHER_WIDTH;
      const height = this.launcherButton.offsetHeight || LAUNCHER_HEIGHT;
      const frame = this.getLauncherFrameRect();
      const source = this.persistLayout && this.settings.launcherPosition ? this.settings.launcherPosition : {
        left: frame.left + LAUNCHER_MARGIN,
        top: frame.bottom - height - LAUNCHER_MARGIN
      };
      const clamped = this.clampLauncherPosition(source.left, source.top, width, height);
      this.launcherButton.style.left = clamped.left + "px";
      this.launcherButton.style.top = clamped.top + "px";
      this.launcherButton.style.right = "auto";
      this.launcherButton.style.bottom = "auto";

      if (
        this.persistLayout &&
        this.settings.launcherPosition &&
        (clamped.left !== Number(this.settings.launcherPosition.left) ||
          clamped.top !== Number(this.settings.launcherPosition.top))
      ) {
        this.settings = {
          ...this.settings,
          launcherPosition: { left: clamped.left, top: clamped.top }
        };
        if (typeof this.options.onSettingsChange === "function") {
          this.options.onSettingsChange(this.settings, { launcherPosition: this.settings.launcherPosition });
        }
      }
    }

    updateTimelineLayer() {
      if (!this.timelineLayer || !this.timelineTrack || !this.timelineTooltip) {
        return;
      }
      const enabled = this.timelineFeatureEnabled && Boolean(this.settings.timelineModeEnabled);
      const duration = Number(this.timelineDuration);
      const chunks = Array.isArray(this.timelineChunks) ? this.timelineChunks : [];
      const anchorVisible = this.isAnchorUsablyVisible();
      if (!enabled || !anchorVisible || !Number.isFinite(duration) || duration <= 0 || !chunks.length) {
        this.timelineLayer.classList.remove("is-visible");
        this.timelineLayer.classList.remove("is-scrub-mode");
        this.timelineLayerVisible = false;
        this.hideTimelineTooltip();
        this.timelineTrack.replaceChildren();
        return;
      }

      const frame = this.getPanelFrameRect();
      const width = Math.max(120, frame.right - frame.left);
      const top = Math.max(frame.top + 8, Math.min(frame.bottom - 210, frame.bottom - 190));
      this.timelineLayer.style.left = Math.round(frame.left + 8) + "px";
      this.timelineLayer.style.top = Math.round(top) + "px";
      this.timelineLayer.style.width = Math.round(Math.max(80, width - 16)) + "px";
      this.timelineLayer.classList.add("is-visible");
      this.timelineLayer.classList.add("is-scrub-mode");
      this.timelineLayerVisible = true;

      // The full-width track is an invisible hit target only. The visible progress
      // affordance lives on the MMOCC lens bubble so Timeline mode does not look
      // like a separate random marker bar.
      this.timelineTrack.replaceChildren();
      this.renderTimelineScrub();
    }

    handleTimelineClick(event) {
      if (!this.timelineLayerVisible || typeof this.options.onSeek !== "function") {
        return;
      }
      const chunk = this.getTimelineChunkFromPointerEvent(event);
      if (!chunk) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const index = Number(chunk.timelineIndex);
      const start = timelineScrub && timelineScrub.getChunkStart ? timelineScrub.getChunkStart(chunk) : Number(chunk.seekStart || chunk.start);
      if (!Number.isFinite(start)) {
        return;
      }
      this.options.onSeek({
        future: true,
        index: Number.isInteger(index) ? index : -1,
        seekStart: start,
        start,
        end: start + 0.25,
        timelineMarker: true
      });
    }

    handleTimelinePointerMove(event) {
      if (!this.timelineLayerVisible || !this.timelineTooltip) {
        return;
      }
      const chunk = this.getTimelineChunkFromPointerEvent(event);
      if (!chunk) {
        this.hideTimelineTooltip();
        return;
      }
      this.timelineHoverIndex = Number(chunk.timelineIndex);
      this.timelineHoverTime = this.getTimelineTimeFromPointerEvent(event);
      this.renderTimelineScrub();
    }

    hideTimelineTooltip() {
      if (this.timelineTooltip) {
        this.timelineTooltip.classList.remove("is-visible");
        this.timelineTooltip.classList.remove("is-hover");
      }
      this.timelineHoverIndex = -1;
      this.timelineHoverTime = Number.NaN;
      this.renderTimelineScrub();
    }

    getTimelineTimeFromPointerEvent(event) {
      if (!this.timelineLayer || !timelineScrub || typeof timelineScrub.hoverXToTime !== "function") {
        return Number.NaN;
      }
      const rect = this.timelineLayer.getBoundingClientRect();
      return timelineScrub.hoverXToTime(event.clientX - rect.left, rect.width, this.timelineDuration);
    }

    getTimelineChunkFromPointerEvent(event) {
      if (!timelineScrub || !Array.isArray(this.timelineChunks) || !this.timelineChunks.length) {
        return null;
      }
      const target = event.target;
      if (target instanceof Element) {
        const explicit = target.closest(".dc-timeline-lens[data-index]");
        if (explicit) {
          const explicitIndex = Number(explicit.getAttribute("data-index"));
          if (Number.isInteger(explicitIndex) && explicitIndex >= 0 && explicitIndex < this.timelineChunks.length) {
            return this.timelineChunks[explicitIndex];
          }
        }
      }
      const time = this.getTimelineTimeFromPointerEvent(event);
      const index = timelineScrub.findChunkIndexAtTime(this.timelineChunks, time, 0.35);
      return index >= 0 ? this.timelineChunks[index] : null;
    }

    renderTimelineScrub() {
      if (!this.timelineLayerVisible || !this.timelineLayer || !timelineScrub) {
        return;
      }
      const chunks = Array.isArray(this.timelineChunks) ? this.timelineChunks : [];
      const duration = Number(this.timelineDuration);
      if (!chunks.length || !Number.isFinite(duration) || duration <= 0) {
        return;
      }
      let focusIndex = this.timelineHoverIndex >= 0
        ? this.timelineHoverIndex
        : timelineScrub.findChunkIndexAtTime(chunks, this.playbackTime, 0.35);
      if (focusIndex < 0) {
        focusIndex = 0;
      }
      if (focusIndex < 0 || focusIndex >= chunks.length) {
        return;
      }
      const layerRect = this.timelineLayer.getBoundingClientRect();
      const layerWidth = Math.max(120, layerRect.width || 120);
      if (this.timelineTooltip) {
        const focusChunk = chunks[focusIndex];
        const focusStart = timelineScrub.getChunkStart(focusChunk);
        const lensTime = Number.isFinite(this.timelineHoverTime)
          ? this.timelineHoverTime
          : (Number.isFinite(this.playbackTime) ? this.playbackTime : focusStart);
        const clampedLensTime = Number.isFinite(lensTime)
          ? Math.max(0, Math.min(duration, lensTime))
          : 0;
        const lensWidth = Math.min(820, Math.max(460, layerWidth * 0.6));
        const lensCenter = (clampedLensTime / duration) * layerWidth;
        const lensLeft = timelineScrub.clampBubbleLeft(lensCenter, lensWidth, layerWidth, 8);
        this.timelineTooltip.style.left = Math.round(lensLeft) + "px";
        this.timelineTooltip.style.width = Math.round(lensWidth) + "px";
        this.timelineTooltip.dataset.index = String(focusIndex);
        this.timelineTooltip.replaceChildren();
        const timestamp = document.createElement("span");
        timestamp.className = "dc-timeline-lens-time";
        timestamp.textContent = Number.isFinite(focusStart) ? chunker.formatTimestamp(focusStart) : "";
        const text = document.createElement("span");
        text.className = "dc-timeline-lens-text dc-chunk-text";
        this.renderChunkText(text, focusChunk, true, clampedLensTime);
        this.timelineTooltip.append(timestamp, text);
        this.timelineTooltip.classList.add("is-visible");
        this.timelineTooltip.classList.toggle("is-hover", this.timelineHoverIndex >= 0);
      }
    }

    closeToNearestCorner() {
      if (!this.root) {
        this.updateSettings({ panelClosed: true });
        return;
      }

      const rect = this.getElementLocalRect(this.root);
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const frame = this.getLauncherFrameRect();
      const corners = [
        { x: frame.left, y: frame.top, name: "top-left" },
        { x: frame.right, y: frame.top, name: "top-right" },
        { x: frame.left, y: frame.bottom, name: "bottom-left" },
        { x: frame.right, y: frame.bottom, name: "bottom-right" }
      ];
      let nearest = corners[0];
      let nearestDistance = Number.POSITIVE_INFINITY;
      for (let index = 0; index < corners.length; index += 1) {
        const corner = corners[index];
        const distance = Math.hypot(centerX - corner.x, centerY - corner.y);
        if (distance < nearestDistance) {
          nearest = corner;
          nearestDistance = distance;
        }
      }

      const left = nearest.name.indexOf("right") >= 0
        ? frame.right - LAUNCHER_WIDTH - LAUNCHER_MARGIN
        : frame.left + LAUNCHER_MARGIN;
      const top = nearest.name.indexOf("bottom") >= 0
        ? frame.bottom - LAUNCHER_HEIGHT - LAUNCHER_MARGIN
        : frame.top + LAUNCHER_MARGIN;

      this.updateSettings({
        panelClosed: true,
        launcherPosition: this.clampLauncherPosition(left, top, LAUNCHER_WIDTH, LAUNCHER_HEIGHT)
      });
    }

    normalizeSavedPanelPosition() {
      if (!this.root || this.root.style.display === "none") {
        return;
      }
      if (!this.persistLayout || !this.settings.panelPosition) {
        return;
      }
      const rect = this.getElementLocalRect(this.root);
      const clamped = this.panelPositionToLocal(rect.width, rect.height);
      if (!clamped) {
        return;
      }
      this.root.style.left = clamped.left + "px";
      this.root.style.top = clamped.top + "px";
      this.root.style.right = "auto";
      this.root.style.bottom = "auto";
      const nextPosition = this.localToPlayerPanelPosition(clamped.left, clamped.top, rect.width, rect.height);

      const changed =
        this.settings.panelPosition.anchor !== "player" ||
        nextPosition.left !== Number(this.settings.panelPosition.left) ||
        nextPosition.top !== Number(this.settings.panelPosition.top);
      if (changed) {
        this.settings = {
          ...this.settings,
          panelPosition: nextPosition
        };
        if (typeof this.options.onSettingsChange === "function") {
          this.options.onSettingsChange(this.settings, { panelPosition: this.settings.panelPosition });
        }
      }
    }

    handleHeaderPointerDown(event) {
      if (!this.root || !this.header) {
        return;
      }
      if (!(event.target instanceof Element)) {
        return;
      }
      if (event.target.closest("button, input, select, label, option")) {
        return;
      }

      const rect = this.getElementLocalRect(this.root);
      this.root.style.left = rect.left + "px";
      this.root.style.top = rect.top + "px";
      this.root.style.right = "auto";
      this.root.style.bottom = "auto";

      this.dragState = {
        startX: event.clientX,
        startY: event.clientY,
        startLeft: rect.left,
        startTop: rect.top
      };

      const onMove = (moveEvent) => this.handleDragMove(moveEvent);
      let cleanupPointerListeners = null;
      const onUp = () => {
        if (cleanupPointerListeners) {
          cleanupPointerListeners();
        }
        this.finishDrag();
      };
      cleanupPointerListeners = this.trackActivePointerListeners(() => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      });

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      event.preventDefault();
    }

    handleDragMove(event) {
      if (!this.root || !this.dragState) {
        return;
      }
      const deltaX = event.clientX - this.dragState.startX;
      const deltaY = event.clientY - this.dragState.startY;
      const width = this.root.offsetWidth || 360;
      const height = this.root.offsetHeight || 320;

      const next = this.clampPanelPosition(this.dragState.startLeft + deltaX, this.dragState.startTop + deltaY, width, height);
      const nextLeft = next.left;
      const nextTop = next.top;
      this.root.style.left = Math.round(nextLeft) + "px";
      this.root.style.top = Math.round(nextTop) + "px";
      this.updatePanelFade();
    }

    finishDrag() {
      if (!this.root || !this.dragState) {
        this.dragState = null;
        return;
      }
      const left = Number.parseInt(this.root.style.left || "0", 10);
      const top = Number.parseInt(this.root.style.top || "0", 10);
      const width = this.root.offsetWidth || 360;
      const height = this.root.offsetHeight || 320;
      this.dragState = null;
      this.updateSettings({
        panelPosition: this.localToPlayerPanelPosition(
          Number.isFinite(left) ? left : 0,
          Number.isFinite(top) ? top : 0,
          width,
          height
        )
      });
    }

    handleFutureDividerPointerDown(event) {
      if (!this.root) {
        return;
      }
      const target = event.target instanceof Element ? event.target : null;
      const section = target ? target.closest(".dc-future-section") : null;
      if (!(section instanceof Element)) {
        return;
      }
      const currentHeight =
        section.getBoundingClientRect().height ||
        Number(this.settings.futurePreviewHeight) ||
        DEFAULT_FUTURE_PREVIEW_HEIGHT;
      this.futureDividerDragState = {
        startY: event.clientY,
        startHeight: currentHeight,
        latestHeight: currentHeight
      };

      const onMove = (moveEvent) => this.handleFutureDividerMove(moveEvent);
      let cleanupPointerListeners = null;
      const onUp = () => {
        if (cleanupPointerListeners) {
          cleanupPointerListeners();
        }
        this.finishFutureDividerDrag();
      };
      cleanupPointerListeners = this.trackActivePointerListeners(() => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      });

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      event.preventDefault();
      event.stopPropagation();
    }

    handleFutureDividerMove(event) {
      if (!this.root || !this.futureDividerDragState) {
        return;
      }
      const deltaY = event.clientY - this.futureDividerDragState.startY;
      const maxHeight = this.getMaxFuturePreviewHeight();
      const nextHeight = Math.max(
        MIN_FUTURE_PREVIEW_HEIGHT,
        Math.min(maxHeight, this.futureDividerDragState.startHeight - deltaY)
      );
      this.futureDividerDragState.latestHeight = nextHeight;
      this.root.style.setProperty("--dc-future-preview-height", Math.round(nextHeight) + "px");
    }

    finishFutureDividerDrag() {
      if (!this.futureDividerDragState) {
        return;
      }
      const nextHeight = Math.round(this.futureDividerDragState.latestHeight);
      this.futureDividerDragState = null;
      this.updateSettings({ futurePreviewHeight: nextHeight });
    }

    handleResizePointerDown(event, corner) {
      if (!this.root) {
        return;
      }
      if (!corner || corner.indexOf("-") < 0) {
        return;
      }

      const rect = this.getElementLocalRect(this.root);
      this.root.style.left = rect.left + "px";
      this.root.style.top = rect.top + "px";
      this.root.style.right = "auto";
      this.root.style.bottom = "auto";
      const captureTarget = event.currentTarget instanceof Element ? event.currentTarget : null;
      if (captureTarget && typeof captureTarget.setPointerCapture === "function") {
        try {
          captureTarget.setPointerCapture(event.pointerId);
        } catch {
          // Pointer capture is a best-effort guard against resize releases clicking the video.
        }
      }

      this.resizeState = {
        corner: corner,
        captureTarget: captureTarget,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        latestX: event.clientX,
        latestY: event.clientY,
        startLeft: rect.left,
        startTop: rect.top,
        startWidth: rect.width,
        startHeight: rect.height,
        frameBounds: this.getPanelFrameRect()
      };

      const onMove = (moveEvent) => this.handleResizeMove(moveEvent);
      let cleanupPointerListeners = null;
      const onUp = (upEvent) => {
        this.suppressPageClickUntil = Date.now() + 350;
        if (upEvent) {
          upEvent.preventDefault();
          upEvent.stopPropagation();
        }
        if (cleanupPointerListeners) {
          cleanupPointerListeners();
        }
        this.finishResize();
      };
      cleanupPointerListeners = this.trackActivePointerListeners(() => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      });

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      event.preventDefault();
      event.stopPropagation();
    }

    handleResizeMove(event) {
      if (!this.root || !this.resizeState) {
        return;
      }
      this.resizeState.latestX = event.clientX;
      this.resizeState.latestY = event.clientY;
      if (this.resizeMoveRafId) {
        return;
      }
      this.resizeMoveRafId = platform.requestFrame(() => {
        this.resizeMoveRafId = 0;
        this.applyResizeMoveFrame();
      });
    }

    applyResizeMoveFrame() {
      if (!this.root || !this.resizeState) {
        return;
      }
      const state = this.resizeState;
      const deltaX = state.latestX - state.startX;
      const deltaY = state.latestY - state.startY;
      const rightEdge = state.startLeft + state.startWidth;
      const bottomEdge = state.startTop + state.startHeight;
      const resizesLeft = state.corner.indexOf("left") >= 0;
      const resizesTop = state.corner.indexOf("top") >= 0;

      let nextWidth = resizesLeft ? state.startWidth - deltaX : state.startWidth + deltaX;
      let nextHeight = resizesTop ? state.startHeight - deltaY : state.startHeight + deltaY;

      const panelFrame = state.frameBounds || this.getPanelFrameRect();
      const maxWidth = Math.max(MIN_PANEL_WIDTH, panelFrame.right - panelFrame.left - DEFAULT_PANEL_MARGIN * 2);
      const maxHeight = Math.max(MIN_PANEL_HEIGHT, panelFrame.bottom - panelFrame.top - DEFAULT_PANEL_MARGIN * 2);
      nextWidth = Math.max(MIN_PANEL_WIDTH, Math.min(maxWidth, nextWidth));
      nextHeight = Math.max(MIN_PANEL_HEIGHT, Math.min(maxHeight, nextHeight));

      let nextLeft = resizesLeft ? rightEdge - nextWidth : state.startLeft;
      let nextTop = resizesTop ? bottomEdge - nextHeight : state.startTop;
      const clamped = this.clampPositionToRect(nextLeft, nextTop, nextWidth, nextHeight, panelFrame, DEFAULT_PANEL_MARGIN);
      nextLeft = clamped.left;
      nextTop = clamped.top;

      this.root.style.left = Math.round(nextLeft) + "px";
      this.root.style.top = Math.round(nextTop) + "px";
      this.root.style.width = Math.round(nextWidth) + "px";
      this.root.style.height = Math.round(nextHeight) + "px";
      this.applyFuturePreviewHeight();
      this.updatePanelFade();
    }

    finishResize() {
      if (!this.root || !this.resizeState) {
        this.resizeState = null;
        return;
      }
      if (this.resizeMoveRafId) {
        platform.cancelFrame(this.resizeMoveRafId);
        this.resizeMoveRafId = 0;
        this.applyResizeMoveFrame();
      }
      const left = Number.parseInt(this.root.style.left || "0", 10);
      const top = Number.parseInt(this.root.style.top || "0", 10);
      const width = Number.parseInt(this.root.style.width || "0", 10);
      const height = Number.parseInt(this.root.style.height || "0", 10);
      const captureTarget = this.resizeState.captureTarget;
      const pointerId = this.resizeState.pointerId;
      if (captureTarget && typeof captureTarget.releasePointerCapture === "function") {
        try {
          captureTarget.releasePointerCapture(pointerId);
        } catch {
          // Capture may already be released by the browser.
        }
      }
      this.resizeState = null;
      this.updateSettings({
        panelPosition: this.localToPlayerPanelPosition(
          Number.isFinite(left) ? left : 0,
          Number.isFinite(top) ? top : 0,
          Number.isFinite(width) ? width : MIN_PANEL_WIDTH,
          Number.isFinite(height) ? height : MIN_PANEL_HEIGHT
        ),
        panelSize: {
          width: Number.isFinite(width) ? width : MIN_PANEL_WIDTH,
          height: Number.isFinite(height) ? height : MIN_PANEL_HEIGHT
        }
      });
    }

    handleLauncherPointerDown(event) {
      if (!this.launcherButton || this.launcherButton.style.display === "none") {
        return;
      }
      const rect = this.getElementLocalRect(this.launcherButton);
      this.launcherButton.style.left = rect.left + "px";
      this.launcherButton.style.top = rect.top + "px";
      this.launcherButton.style.right = "auto";
      this.launcherButton.style.bottom = "auto";

      this.launcherDragState = {
        startX: event.clientX,
        startY: event.clientY,
        startLeft: rect.left,
        startTop: rect.top,
        width: rect.width || 120,
        height: rect.height || 36,
        moved: false
      };

      const onMove = (moveEvent) => this.handleLauncherDragMove(moveEvent);
      let cleanupPointerListeners = null;
      const onUp = () => {
        if (cleanupPointerListeners) {
          cleanupPointerListeners();
        }
        this.finishLauncherDrag();
      };
      cleanupPointerListeners = this.trackActivePointerListeners(() => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      });
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    }

    handleLauncherDragMove(event) {
      if (!this.launcherButton || !this.launcherDragState) {
        return;
      }
      const state = this.launcherDragState;
      const deltaX = event.clientX - state.startX;
      const deltaY = event.clientY - state.startY;
      if (!state.moved && Math.hypot(deltaX, deltaY) >= 4) {
        state.moved = true;
      }
      if (!state.moved) {
        return;
      }
      const next = this.clampLauncherPosition(state.startLeft + deltaX, state.startTop + deltaY, state.width, state.height);
      this.launcherButton.style.left = next.left + "px";
      this.launcherButton.style.top = next.top + "px";
    }

    finishLauncherDrag() {
      if (!this.launcherButton || !this.launcherDragState) {
        this.launcherDragState = null;
        return;
      }
      const moved = Boolean(this.launcherDragState.moved);
      this.launcherDragState = null;
      if (!moved) {
        return;
      }
      const left = Number.parseInt(this.launcherButton.style.left || "0", 10);
      const top = Number.parseInt(this.launcherButton.style.top || "0", 10);
      this.launcherSuppressClickUntil = Date.now() + 250;
      this.updateSettings({
        launcherPosition: {
          left: Number.isFinite(left) ? left : 0,
          top: Number.isFinite(top) ? top : 0
        }
      });
    }

    setStatus(message, temporary) {
      if (!this.statusEl) {
        return;
      }
      this.statusEl.textContent = message || "";
      this.statusEl.classList.add("is-visible");

      if (this.statusTimer) {
        window.clearTimeout(this.statusTimer);
        this.statusTimer = 0;
      }
      if (temporary) {
        this.statusTimer = window.setTimeout(() => {
          if (this.statusEl) {
            this.statusEl.classList.remove("is-visible");
          }
          this.statusTimer = 0;
        }, 2600);
      }
    }

    setChunks(chunks) {
      const shouldStick = this.stickToBottom || this.isNearBottom(2.6);
      this.chunks = Array.isArray(chunks) ? chunks : [];
      if (this.activeIndex >= this.chunks.length) {
        this.activeIndex = this.chunks.length - 1;
      }
      this.currentWindowStart = -1;
      this.currentWindowEnd = -1;
      this.scheduleWindowRender(true);
      if (shouldStick) {
        this.scrollToBottom();
      }
      this.updateJumpBottomVisibility();
    }

    setFutureChunks(chunks) {
      const normalized = Array.isArray(chunks) ? chunks : [];
      const key = normalized
        .map((chunk) => [chunk.actualIndex, chunk.start, chunk.end, chunk.text].join(":"))
        .join("|");
      if (key === this.futureChunksKey && this.futureChunks.length === normalized.length) {
        return;
      }
      this.futureChunks = normalized;
      this.futureChunksKey = key;
      this.scheduleWindowRender(true);
      this.updateJumpBottomVisibility();
    }

    setTimelineData(chunks, durationSeconds) {
      if (!this.timelineFeatureEnabled) {
        return;
      }
      const normalized = timelineScrub && typeof timelineScrub.sortChunks === "function"
        ? timelineScrub.sortChunks(chunks)
        : Array.isArray(chunks) ? chunks : [];
      const duration = Number(durationSeconds);
      this.timelineDuration = Number.isFinite(duration) && duration > 0 ? duration : Number.NaN;
      const nextKey = [
        Number.isFinite(this.timelineDuration) ? this.timelineDuration.toFixed(3) : "none",
        normalized.length,
        normalized[0] ? [normalized[0].start, normalized[0].end, normalized[0].text].join(":") : "",
        normalized[normalized.length - 1]
          ? [normalized[normalized.length - 1].start, normalized[normalized.length - 1].end, normalized[normalized.length - 1].text].join(":")
          : ""
      ].join("|");
      if (nextKey !== this.timelineDataKey) {
        this.timelineHoverIndex = -1;
        this.timelineHoverTime = Number.NaN;
        if (this.timelineTooltip) {
          this.timelineTooltip.classList.remove("is-hover");
        }
      }
      this.timelineDataKey = nextKey;
      this.timelineChunks = normalized;
      this.updateTimelineLayer();
    }

    isTimelineFeatureAvailable() {
      return Boolean(this.timelineFeatureEnabled);
    }

    setActiveIndex(index, options) {
      if (!Array.isArray(this.chunks) || !this.chunks.length) {
        this.activeIndex = -1;
        return;
      }
      if (!Number.isInteger(index) || index < 0) {
        const hadActive = this.activeIndex !== -1;
        this.activeIndex = -1;
        this.clearReadingGlowExcept(-1);
        this.lastGlowIndex = -1;
        this.lastGlowWordStart = -1;
        this.lastGlowWordEnd = -1;
        this.updateJumpBottomVisibility();
        this.scheduleWindowRender(!hadActive);
        return;
      }
      const bounded = Math.max(0, Math.min(this.chunks.length - 1, index));
      const hasChanged = bounded !== this.activeIndex;
      this.activeIndex = bounded;

      if (hasChanged) {
        this.clearReadingGlowExcept(bounded);
        this.lastGlowIndex = -1;
        this.lastGlowWordStart = -1;
        this.lastGlowWordEnd = -1;
      }
      if (hasChanged && options && options.ensureVisible) {
        if (bounded >= Math.max(0, this.chunks.length - 2)) {
          this.stickToBottom = true;
        }
        this.ensureIndexVisible(bounded);
      }
      this.updateJumpBottomVisibility();
      this.scheduleWindowRender(!hasChanged);
    }

    setPlaybackTime(currentTime, options) {
      const time = Number(currentTime);
      if (!Number.isFinite(time)) {
        return;
      }
      if (options && options.forceGlowReset) {
        this.clearReadingGlowExcept(this.activeIndex);
        this.lastGlowIndex = -1;
        this.lastGlowWordStart = -1;
        this.lastGlowWordEnd = -1;
      }
      this.playbackTime = time;
      this.updateActiveReadingGlow();
      this.renderTimelineScrub();
    }

    flashChunk(index) {
      if (!this.windowContainer || index < this.currentWindowStart || index > this.currentWindowEnd) {
        return;
      }
      const item = this.windowContainer.querySelector("[data-index='" + index + "']");
      if (!item) {
        return;
      }
      item.classList.remove("is-start-flash");
      void item.offsetWidth;
      item.classList.add("is-start-flash");
      window.setTimeout(() => {
        if (item.isConnected) {
          item.classList.remove("is-start-flash");
        }
      }, 720);
    }

    ensureIndexVisible(index) {
      if (!this.listViewport) {
        return;
      }
      if (index >= Math.max(0, this.chunks.length - 2)) {
        this.stickToBottom = true;
        this.scrollToBottom();
        return;
      }
      const viewportHeight = this.listViewport.clientHeight || 1;
      const item = this.windowContainer
        ? this.windowContainer.querySelector("[data-index='" + index + "']")
        : null;
      if (!item) {
        return;
      }
      const rowTop = item.offsetTop;
      const rowBottom = rowTop + item.offsetHeight;
      const viewTop = this.listViewport.scrollTop;
      const viewBottom = viewTop + viewportHeight;
      if (rowTop < viewTop || rowBottom > viewBottom) {
        this.programmaticScrollUntil = Date.now() + 120;
        this.listViewport.scrollTop = Math.max(0, rowTop - Math.round(viewportHeight * 0.35));
      }
    }

    getBottomDistance() {
      if (!this.listViewport) {
        return 0;
      }
      return this.listViewport.scrollHeight - (this.listViewport.scrollTop + this.listViewport.clientHeight);
    }

    isNearBottom(multiplier) {
      if (!this.listViewport) {
        return true;
      }
      const distance = this.getBottomDistance();
      const factor = Number.isFinite(multiplier) ? Number(multiplier) : 1.2;
      return distance <= BOTTOM_PROXIMITY_PX * factor;
    }

    getCurrentCaptionIndex() {
      if (!Array.isArray(this.chunks) || !this.chunks.length) {
        return -1;
      }
      if (Number.isInteger(this.activeIndex) && this.activeIndex >= 0 && this.activeIndex < this.chunks.length) {
        return this.activeIndex;
      }
      const time = Number(this.playbackTime);
      if (!Number.isFinite(time)) {
        return -1;
      }
      let nearestPrevious = -1;
      for (let index = 0; index < this.chunks.length; index += 1) {
        const chunk = this.chunks[index];
        const start = Number(chunk && chunk.start);
        const end = Number(chunk && chunk.end);
        if (!Number.isFinite(start)) {
          continue;
        }
        if (start <= time) {
          nearestPrevious = index;
        }
        if (start <= time && (!Number.isFinite(end) || time <= end + 0.35)) {
          return index;
        }
        if (start > time) {
          break;
        }
      }
      return nearestPrevious;
    }

    scrollToCurrentCaption() {
      const index = this.getCurrentCaptionIndex();
      if (index < 0) {
        return;
      }
      this.ensureIndexVisible(index);
    }

    isIndexVisible(index) {
      if (!this.listViewport || !this.windowContainer || index < 0) {
        return false;
      }
      const item = this.windowContainer.querySelector("[data-index='" + index + "']");
      if (!item) {
        return false;
      }
      const rowTop = item.offsetTop;
      const rowBottom = rowTop + item.offsetHeight;
      const viewTop = this.listViewport.scrollTop;
      const viewBottom = viewTop + (this.listViewport.clientHeight || 1);
      return rowTop >= viewTop && rowBottom <= viewBottom;
    }

    scrollToBottom() {
      if (!this.listViewport) {
        return;
      }
      this.stickToBottom = true;
      this.programmaticScrollUntil = Date.now() + 220;
      const target = Math.max(0, this.listViewport.scrollHeight - this.listViewport.clientHeight);
      this.listViewport.scrollTop = target;
      platform.requestFrame(() => {
        if (!this.listViewport) {
          return;
        }
        const nextTarget = Math.max(0, this.listViewport.scrollHeight - this.listViewport.clientHeight);
        this.listViewport.scrollTop = nextTarget;
        platform.requestFrame(() => {
          if (!this.listViewport) {
            return;
          }
          const finalTarget = Math.max(0, this.listViewport.scrollHeight - this.listViewport.clientHeight);
          this.listViewport.scrollTop = finalTarget;
        });
      });
    }

    isPointerInside() {
      if (!this.root || this.root.style.display === "none") {
        return false;
      }
      if (this.pointerInside) {
        return true;
      }
      try {
        if (typeof this.root.matches === "function" && this.root.matches(":hover")) {
          return true;
        }
      } catch {
        // Ignore selector/matches errors.
      }
      return false;
    }

    updateJumpBottomVisibility() {
      if (!this.jumpBottomButton || !this.listViewport || !this.root) {
        return;
      }
      const isClosed = this.root.style.display === "none";
      const currentIndex = this.getCurrentCaptionIndex();
      const hasChunks = this.chunks.length > 0;
      const currentVisible = currentIndex >= 0 ? this.isIndexVisible(currentIndex) : this.isNearBottom(1.4);
      const shouldShow = !isClosed;
      this.jumpBottomButton.disabled = !hasChunks || currentVisible;
      this.jumpBottomButton.title = currentVisible ? "Current caption is visible" : "Scroll to the current caption";
      this.jumpBottomButton.classList.toggle("is-hidden", !shouldShow);
    }

    scheduleWindowRender(skipIfQueued) {
      if (skipIfQueued && this.rafRenderId) {
        return;
      }
      if (this.rafRenderId) {
        platform.cancelFrame(this.rafRenderId);
      }
      this.rafRenderId = platform.requestFrame(() => {
        this.rafRenderId = 0;
        this.renderWindow();
      });
    }

    renderWindow() {
      if (!this.listViewport || !this.windowContainer || !this.topSpacer || !this.bottomSpacer) {
        return;
      }

      const chunkCount = this.chunks.length;
      const futureCount = this.futureChunks.length;
      if (!chunkCount && !futureCount) {
        this.topSpacer.style.height = "0px";
        this.bottomSpacer.style.height = "0px";
        this.windowContainer.replaceChildren();
        this.replaceFutureSection(0, 0);
        return;
      }

      const start = 0;
      const end = chunkCount - 1;
      const futureKey = this.getFutureRenderKey();
      const canAppendSingleChunk =
        chunkCount > 0 &&
        this.currentWindowStart === start &&
        end === this.currentWindowEnd + 1 &&
        this.currentWindowEnd >= start - 1 &&
        this.windowContainer.childElementCount > 0;
      const shouldRebuild =
        start !== this.currentWindowStart ||
        end !== this.currentWindowEnd ||
        futureCount !== this.currentFutureCount ||
        this.futureCollapsed !== this.currentFutureCollapsed;
      this.topSpacer.style.height = "0px";
      this.bottomSpacer.style.height = "0px";

      if (canAppendSingleChunk) {
        const chunk = this.chunks[end];
        const nextButton = this.createChunkButton(chunk, end, false);
        this.windowContainer.append(nextButton);
        this.currentWindowEnd = end;
        this.replaceFutureSection(futureCount, chunkCount);
        this.updateActiveClass();
        this.updateActiveReadingGlow();
        return;
      }

      if (!shouldRebuild) {
        if (futureKey !== this.currentFutureKey) {
          this.replaceFutureSection(futureCount, chunkCount);
        }
        this.updateActiveClass();
        this.updateActiveReadingGlow();
        return;
      }

      this.currentWindowStart = start;
      this.currentWindowEnd = end;
      this.currentFutureCount = futureCount;
      this.currentFutureCollapsed = this.futureCollapsed;
      this.currentFutureKey = futureKey;

      const fragment = document.createDocumentFragment();
      for (let index = start; index <= end; index += 1) {
        const chunk = this.chunks[index];
        fragment.append(this.createChunkButton(chunk, index, false));
      }

      this.windowContainer.replaceChildren(fragment);
      this.replaceFutureSection(futureCount, chunkCount);
    }

    getFutureRenderKey() {
      const source = Array.isArray(this.futureChunks) ? this.futureChunks : [];
      return source
        .map((chunk) => [chunk && chunk.actualIndex, chunk && chunk.start, chunk && chunk.end, chunk && chunk.text].join(":"))
        .join("|");
    }

    createFutureSection(futureCount, chunkCount) {
      const section = document.createElement("div");
      section.className = "dc-future-section";

      const divider = document.createElement("div");
      divider.className = "dc-future-divider";
      divider.setAttribute("role", "separator");
      divider.setAttribute("aria-label", "Upcoming caption previews");
      divider.setAttribute("aria-orientation", "horizontal");
      divider.setAttribute("title", "Upcoming caption preview");

      const futureList = document.createElement("div");
      futureList.className = "dc-future-list";

      for (let index = 0; index < futureCount; index += 1) {
        const preview = this.futureChunks[index];
        const actualIndex = Number.isInteger(preview && preview.actualIndex) ? preview.actualIndex : chunkCount + index;
        futureList.append(this.createChunkButton(preview, actualIndex, true));
      }

      section.append(divider, futureList);
      return section;
    }

    replaceFutureSection(futureCount, chunkCount) {
      if (!this.windowContainer) {
        return;
      }
      const parent = this.windowContainer.parentElement || this.windowContainer;
      const existing = parent.querySelector(".dc-future-section");
      if (existing) {
        existing.remove();
      }
      if (futureCount) {
        const nextSection = this.createFutureSection(futureCount, chunkCount);
        if (this.bottomSpacer && this.bottomSpacer.parentElement === parent) {
          parent.insertBefore(nextSection, this.bottomSpacer);
        } else {
          parent.append(nextSection);
        }
      }
      this.currentFutureCount = futureCount;
      this.currentFutureCollapsed = this.futureCollapsed;
      this.currentFutureKey = this.getFutureRenderKey();
    }

    createChunkButton(chunk, index, isFuture) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = isFuture ? "dc-chunk dc-chunk-future" : "dc-chunk";
      item.setAttribute("data-index", String(index));
      if (isFuture) {
        item.setAttribute("data-seek-start", String(Number(chunk && chunk.seekStart)));
        item.setAttribute("data-start", String(Number(chunk && chunk.start)));
        item.setAttribute("data-end", String(Number(chunk && chunk.end)));
      }

      const content = document.createElement("span");
      content.className = "dc-chunk-content";

      const time = document.createElement("span");
      time.className = "dc-chunk-time";
      time.textContent = chunker.formatTimestamp(chunk && chunk.start);

      const text = document.createElement("span");
      text.className = "dc-chunk-text";

      content.append(time, text);
      item.append(content);
      if (!isFuture && index === this.activeIndex) {
        item.classList.add("is-current");
      }
      this.renderChunkText(text, chunk, !isFuture && index === this.activeIndex);
      return item;
    }

    renderChunkText(textElement, chunk, isActive, playbackTimeOverride) {
      if (!textElement) {
        return;
      }
      const text = chunk && typeof chunk.text === "string" ? chunk.text : "";
      if (!isActive || !bubbleState || typeof bubbleState.getReadingGlowRange !== "function") {
        textElement.textContent = text;
        return;
      }

      const glowTime = Number.isFinite(Number(playbackTimeOverride))
        ? Number(playbackTimeOverride)
        : this.playbackTime;
      const range = bubbleState.getReadingGlowRange(chunk, glowTime);
      if (!range || typeof bubbleState.splitTextByRange !== "function") {
        textElement.textContent = text;
        return;
      }

      const parts = bubbleState.splitTextByRange(text, range);
      const fragment = document.createDocumentFragment();
      for (let index = 0; index < parts.length; index += 1) {
        const part = parts[index];
        const span = document.createElement("span");
        span.textContent = part.text;
        if (part.active) {
          span.className = "dc-reading-glow";
        }
        fragment.append(span);
      }
      textElement.replaceChildren(fragment);
    }

    updateActiveClass() {
      if (!this.windowContainer) {
        return;
      }
      const currentItems = this.windowContainer.querySelectorAll(".dc-chunk.is-current");
      currentItems.forEach((item) => item.classList.remove("is-current"));
      if (this.activeIndex < this.currentWindowStart || this.activeIndex > this.currentWindowEnd) {
        return;
      }
      const next = this.windowContainer.querySelector("[data-index='" + this.activeIndex + "']");
      if (next) {
        next.classList.add("is-current");
      }
    }

    clearReadingGlowExcept(activeIndex) {
      if (!this.windowContainer) {
        return;
      }
      const highlighted = this.windowContainer.querySelectorAll(".dc-reading-glow");
      const chunkIndexes = new Set();
      highlighted.forEach((node) => {
        const chunkNode = node instanceof Element ? node.closest(".dc-chunk") : null;
        if (!chunkNode) {
          return;
        }
        const index = Number(chunkNode.getAttribute("data-index"));
        if (Number.isInteger(index) && index !== activeIndex) {
          chunkIndexes.add(index);
        }
      });

      chunkIndexes.forEach((index) => {
        const textElement = this.windowContainer.querySelector("[data-index='" + index + "'] .dc-chunk-text");
        const chunk = this.chunks[index];
        if (textElement && chunk) {
          this.renderChunkText(textElement, chunk, false);
        }
      });
    }

    updateActiveReadingGlow() {
      if (!this.windowContainer || this.activeIndex < this.currentWindowStart || this.activeIndex > this.currentWindowEnd) {
        return;
      }
      const chunk = this.chunks[this.activeIndex];
      if (!chunk || !bubbleState || typeof bubbleState.getReadingGlowRange !== "function") {
        return;
      }
      const range = bubbleState.getReadingGlowRange(chunk, this.playbackTime);
      const nextGlowWordStart = range ? range.firstWord : -1;
      const nextGlowWordEnd = range ? range.lastWord : -1;
      if (
        this.lastGlowIndex === this.activeIndex &&
        this.lastGlowWordStart === nextGlowWordStart &&
        this.lastGlowWordEnd === nextGlowWordEnd
      ) {
        return;
      }

      if (this.lastGlowIndex >= 0 && this.lastGlowIndex !== this.activeIndex) {
        const previousText = this.windowContainer.querySelector("[data-index='" + this.lastGlowIndex + "'] .dc-chunk-text");
        const previousChunk = this.chunks[this.lastGlowIndex];
        if (previousText && previousChunk) {
          this.renderChunkText(previousText, previousChunk, false);
        }
      }

      const textElement = this.windowContainer.querySelector("[data-index='" + this.activeIndex + "'] .dc-chunk-text");
      if (textElement) {
        this.renderChunkText(textElement, chunk, Boolean(range));
        this.lastGlowIndex = this.activeIndex;
        this.lastGlowWordStart = nextGlowWordStart;
        this.lastGlowWordEnd = nextGlowWordEnd;
      }
    }
  }

  app.DialoguePanel = DialoguePanel;
})(window);
