(function initUiPanel(scope) {
  const app = (scope.DialogueCaptions = scope.DialogueCaptions || {});
  const chunker = app.chunker;
  const platform = app.platform;
  const bubbleState = app.bubbleState;
  const settingsStore = app.settingsStore;

  const PANEL_ID = "dc-panel";
  const LAUNCHER_ID = "dc-launcher";
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
      this.themeColorInput = null;
      this.header = null;
      this.resetButton = null;
      this.closeButton = null;
      this.launcherButton = null;
      this.jumpBottomButton = null;

      this.chunks = [];
      this.futureChunks = [];
      this.futureCollapsed = false;
      this.activeIndex = -1;
      this.playbackTime = Number.NaN;
      this.lastGlowIndex = -1;
      this.lastGlowWordStart = -1;
      this.currentWindowStart = -1;
      this.currentWindowEnd = -1;
      this.currentFutureCount = -1;
      this.currentFutureCollapsed = false;
      this.dragState = null;
      this.resizeState = null;
      this.launcherDragState = null;
      this.launcherSuppressClickUntil = 0;
      this.resizeHandles = [];
      this.pointerInside = false;
      this.stickToBottom = true;
      this.programmaticScrollUntil = 0;

      this.cleanupFns = [];
      this.activePointerCleanupFns = [];
      this.layoutRefreshTimers = [];
      this.rafRenderId = 0;
      this.statusTimer = 0;
    }

    mount() {
      this.removeExistingUiNodes();

      this.root = document.createElement("section");
      this.root.id = PANEL_ID;
      this.root.className = "dc-panel";
      this.root.tabIndex = 0;
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
      const title = document.createElement("h2");
      title.className = "dc-title";
      title.textContent = "MMOCC";
      titleWrap.append(title);

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
      this.resetButton.title = "Reset panel size, position, transparency, and text size";

      this.themeSelect = document.createElement("select");
      this.themeSelect.className = "dc-theme-select";
      this.themeSelect.title = "Panel theme";
      const themeOptions = [
        ["stone", "Stone"],
        ["ember", "Ember"],
        ["forest", "Forest"],
        ["ocean", "Ocean"],
        ["violet", "Violet"],
        ["custom", "Custom"]
      ];
      for (let index = 0; index < themeOptions.length; index += 1) {
        const option = document.createElement("option");
        option.value = themeOptions[index][0];
        option.textContent = themeOptions[index][1];
        this.themeSelect.append(option);
      }

      this.themeColorInput = document.createElement("input");
      this.themeColorInput.type = "color";
      this.themeColorInput.className = "dc-theme-color";
      this.themeColorInput.title = "Custom theme color";
      this.themeColorInput.value = this.settings.customThemeColor || "#ded6c3";

      const opacityWrap = document.createElement("label");
      opacityWrap.className = "dc-opacity-wrap";
      opacityWrap.textContent = "Blend";
      this.opacityWrap = opacityWrap;

      this.opacityInput = document.createElement("input");
      this.opacityInput.type = "range";
      this.opacityInput.className = "dc-opacity-input";
      this.opacityInput.min = "10";
      this.opacityInput.max = "100";
      this.opacityInput.step = "1";
      this.opacityInput.value = String(this.settings.panelOpacity || 100);
      this.opacityInput.title = "Panel background blend";
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

      controls.append(
        this.themeSelect,
        this.themeColorInput,
        opacityWrap,
        textScaleWrap,
        this.resetButton,
        this.closeButton
      );
      header.append(titleWrap, controls);

      this.body = document.createElement("div");
      this.body.className = "dc-body";

      this.statusEl = document.createElement("div");
      this.statusEl.className = "dc-status";

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
      this.jumpBottomButton.textContent = "Jump to Latest";
      this.jumpBottomButton.title = "Scroll to newest dialogue";
      footer.append(this.jumpBottomButton);

      this.body.append(this.statusEl, this.listViewport, footer);
      this.root.append(header, this.body);
      for (let index = 0; index < this.resizeHandles.length; index += 1) {
        this.root.append(this.resizeHandles[index]);
      }
      document.body.append(this.root);

      this.launcherButton = document.createElement("button");
      this.launcherButton.type = "button";
      this.launcherButton.id = LAUNCHER_ID;
      this.launcherButton.className = "dc-launcher";
      this.launcherButton.textContent = "Captions";
      this.launcherButton.title = "Open panel (drag to move)";
      document.body.append(this.launcherButton);

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
      if (this.root) {
        this.root.remove();
        this.root = null;
      }
      if (this.launcherButton) {
        this.launcherButton.remove();
        this.launcherButton = null;
      }
      this.removeExistingUiNodes();
      document.documentElement.classList.remove(ACTIVE_PAGE_CLASS);
    }

    removeExistingUiNodes() {
      const knownNodes = document.querySelectorAll("#" + PANEL_ID + ", #" + LAUNCHER_ID + ", .dc-launcher");
      knownNodes.forEach((node) => {
        if (node instanceof Element) {
          node.remove();
        }
      });
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
      this.launcherDragState = null;
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

      const onOpacityInput = () => {
        this.updateSettings({ panelOpacity: Number(this.opacityInput.value) });
      };
      this.addListener(this.opacityInput, "input", onOpacityInput);

      const onThemeChange = () => {
        this.updateSettings({ themeName: this.themeSelect.value || "stone" });
      };
      this.addListener(this.themeSelect, "change", onThemeChange);

      const onThemeColorInput = () => {
        this.updateSettings({ themeName: "custom", customThemeColor: this.themeColorInput.value || "#ded6c3" });
      };
      this.addListener(this.themeColorInput, "input", onThemeColorInput);

      const onTextScaleInput = () => {
        this.updateSettings({ textScale: Number(this.textScaleInput.value) });
      };
      this.addListener(this.textScaleInput, "input", onTextScaleInput);

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

      const onJumpBottom = () => {
        if (this.chunks.length > 0) {
          const latestIndex = this.chunks.length - 1;
          this.activeIndex = latestIndex;
        }
        this.scrollToBottom();
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
      };
      this.addListener(window, "resize", onResize);

      const onWindowScroll = () => {
        if (this.launcherButton && this.launcherButton.style.display !== "none") {
          this.applyLauncherPosition();
        }
      };
      this.addListener(window, "scroll", onWindowScroll, { passive: true });
    }

    updateSettings(patch) {
      this.settings = { ...this.settings, ...patch };
      this.applySettings();
      if (typeof this.options.onSettingsChange === "function") {
        this.options.onSettingsChange(this.settings, patch);
      }
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
      this.body.style.display = "flex";

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
          Math.min(window.innerWidth - 8, Number(this.settings.panelSize.width))
        );
        const boundedHeight = Math.max(
          MIN_PANEL_HEIGHT,
          Math.min(maxPanelHeight, window.innerHeight - 8, Number(this.settings.panelSize.height))
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

      const panelOpacity = Number(this.settings.panelOpacity || 100);
      const normalizedOpacity = Math.max(10, Math.min(100, panelOpacity));
      this.applyTheme();
      this.applyPanelBlend(normalizedOpacity);
      if (this.opacityInput && this.opacityInput.value !== String(normalizedOpacity)) {
        this.opacityInput.value = String(normalizedOpacity);
      }
      const textScale = Number(this.settings.textScale || 100);
      const normalizedTextScale = Math.max(100, Math.min(200, textScale));
      this.root.style.setProperty("--dc-text-scale", String(normalizedTextScale / 100));
      if (this.textScaleInput && this.textScaleInput.value !== String(normalizedTextScale)) {
        this.textScaleInput.value = String(normalizedTextScale);
      }
      if (this.themeSelect) {
        const themeName = this.getThemeName();
        if (this.themeSelect.value !== themeName) {
          this.themeSelect.value = themeName;
        }
      }
      if (this.themeColorInput) {
        const color = this.getCustomThemeColor();
        if (this.themeColorInput.value.toLowerCase() !== color) {
          this.themeColorInput.value = color;
        }
        this.themeColorInput.disabled = this.getThemeName() !== "custom";
      }
      if (this.stickToBottom) {
        this.scrollToBottom();
      }

      if (this.settings.panelPosition && Number.isFinite(this.settings.panelPosition.left) && Number.isFinite(this.settings.panelPosition.top)) {
        this.root.style.left = this.settings.panelPosition.left + "px";
        this.root.style.top = this.settings.panelPosition.top + "px";
        this.root.style.right = "auto";
        this.root.style.bottom = "auto";
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
      this.updateJumpBottomVisibility();
    }

    applyPanelBlend(opacityPercent) {
      if (!this.root) {
        return;
      }
      const normalizedPercent = Math.max(10, Math.min(100, Number(opacityPercent)));
      const blend = (normalizedPercent - 10) / 90;
      const setAlpha = (name, value) => {
        this.root.style.setProperty(name, Math.max(0, Math.min(1, value)).toFixed(3));
      };
      setAlpha("--dc-panel-alpha-inner", 0 + blend * 0.172);
      setAlpha("--dc-panel-alpha-mid", 0.004 + blend * 0.354);
      setAlpha("--dc-panel-alpha-outer", 0.14 + blend * 0.74);
      setAlpha("--dc-panel-alpha-base", 0.004 + blend * 0.336);
      setAlpha("--dc-panel-fade-light", 0.001 + blend * 0.019);
      setAlpha("--dc-panel-fade-shadow", 0.012 + blend * 0.253);
      setAlpha("--dc-panel-fade-shadow-soft", (0.012 + blend * 0.253) * 0.62);
      setAlpha("--dc-card-alpha", 0.16 + blend * 0.48);
      setAlpha("--dc-card-current-alpha", 0.22 + blend * 0.52);
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
        panelOpacity: Number.isFinite(defaults.panelOpacity) ? defaults.panelOpacity : 88,
        textScale: Number.isFinite(defaults.textScale) ? defaults.textScale : 120,
        themeName: defaults.themeName || "stone",
        customThemeColor: defaults.customThemeColor || "#ded6c3",
        panelPosition: null,
        panelSize: null,
        launcherPosition: null,
        panelClosed: false
      });
    }

    getYouTubeFrameRect() {
      const selectors = ["#movie_player", ".html5-video-player", "ytd-player"];
      for (let index = 0; index < selectors.length; index += 1) {
        const element = document.querySelector(selectors[index]);
        if (!(element instanceof Element)) {
          continue;
        }
        const rect = element.getBoundingClientRect();
        if (rect.width >= 160 && rect.height >= 90) {
          return {
            left: Math.max(0, rect.left),
            top: Math.max(0, rect.top),
            right: Math.min(window.innerWidth, rect.right),
            bottom: Math.min(window.innerHeight, rect.bottom)
          };
        }
      }
      return {
        left: 0,
        top: 0,
        right: window.innerWidth,
        bottom: window.innerHeight
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
      const frame = this.getYouTubeFrameRect();
      return {
        ...frame,
        bottom: Math.max(frame.top + LAUNCHER_HEIGHT + LAUNCHER_MARGIN * 2, frame.bottom - LAUNCHER_CONTROL_BAR_GAP)
      };
    }

    getPanelFrameRect() {
      return this.getYouTubeFrameRect();
    }

    getDefaultPanelFrameRect() {
      const frame = this.getYouTubeFrameRect();
      return {
        ...frame,
        bottom: Math.max(frame.top + MIN_PANEL_HEIGHT + DEFAULT_PANEL_MARGIN * 2, frame.bottom - PANEL_CONTROL_BAR_GAP)
      };
    }

    clampPanelPosition(left, top, width, height) {
      return this.clampPositionToRect(left, top, width, height, this.getPanelFrameRect(), DEFAULT_PANEL_MARGIN);
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
      const source = this.settings.launcherPosition || {
        left: frame.left + LAUNCHER_MARGIN,
        top: frame.bottom - height - LAUNCHER_MARGIN
      };
      const clamped = this.clampLauncherPosition(source.left, source.top, width, height);
      this.launcherButton.style.left = clamped.left + "px";
      this.launcherButton.style.top = clamped.top + "px";
      this.launcherButton.style.right = "auto";
      this.launcherButton.style.bottom = "auto";

      if (
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

    closeToNearestCorner() {
      if (!this.root) {
        this.updateSettings({ panelClosed: true });
        return;
      }

      const rect = this.root.getBoundingClientRect();
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
      if (!this.settings.panelPosition) {
        return;
      }
      const rect = this.root.getBoundingClientRect();
      const clamped = this.clampPanelPosition(
        this.settings.panelPosition.left,
        this.settings.panelPosition.top,
        rect.width,
        rect.height
      );
      this.root.style.left = clamped.left + "px";
      this.root.style.top = clamped.top + "px";
      this.root.style.right = "auto";
      this.root.style.bottom = "auto";

      const changed =
        clamped.left !== Number(this.settings.panelPosition.left) ||
        clamped.top !== Number(this.settings.panelPosition.top);
      if (changed) {
        this.settings = {
          ...this.settings,
          panelPosition: { left: clamped.left, top: clamped.top }
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

      const rect = this.root.getBoundingClientRect();
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
      this.dragState = null;
      this.updateSettings({
        panelPosition: {
          left: Number.isFinite(left) ? left : 0,
          top: Number.isFinite(top) ? top : 0
        }
      });
    }

    handleResizePointerDown(event, corner) {
      if (!this.root) {
        return;
      }
      if (!corner || corner.indexOf("-") < 0) {
        return;
      }

      const rect = this.root.getBoundingClientRect();
      this.root.style.left = rect.left + "px";
      this.root.style.top = rect.top + "px";
      this.root.style.right = "auto";
      this.root.style.bottom = "auto";

      this.resizeState = {
        corner: corner,
        startX: event.clientX,
        startY: event.clientY,
        startLeft: rect.left,
        startTop: rect.top,
        startWidth: rect.width,
        startHeight: rect.height
      };

      const onMove = (moveEvent) => this.handleResizeMove(moveEvent);
      let cleanupPointerListeners = null;
      const onUp = () => {
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
      const state = this.resizeState;
      const deltaX = event.clientX - state.startX;
      const deltaY = event.clientY - state.startY;
      const rightEdge = state.startLeft + state.startWidth;
      const bottomEdge = state.startTop + state.startHeight;
      const resizesLeft = state.corner.indexOf("left") >= 0;
      const resizesTop = state.corner.indexOf("top") >= 0;

      let nextWidth = resizesLeft ? state.startWidth - deltaX : state.startWidth + deltaX;
      let nextHeight = resizesTop ? state.startHeight - deltaY : state.startHeight + deltaY;

      const panelFrame = this.getPanelFrameRect();
      const maxWidth = Math.max(MIN_PANEL_WIDTH, panelFrame.right - panelFrame.left - DEFAULT_PANEL_MARGIN * 2);
      const maxHeight = Math.max(MIN_PANEL_HEIGHT, panelFrame.bottom - panelFrame.top - DEFAULT_PANEL_MARGIN * 2);
      nextWidth = Math.max(MIN_PANEL_WIDTH, Math.min(maxWidth, nextWidth));
      nextHeight = Math.max(MIN_PANEL_HEIGHT, Math.min(maxHeight, nextHeight));

      let nextLeft = resizesLeft ? rightEdge - nextWidth : state.startLeft;
      let nextTop = resizesTop ? bottomEdge - nextHeight : state.startTop;
      const clamped = this.clampPanelPosition(nextLeft, nextTop, nextWidth, nextHeight);
      nextLeft = clamped.left;
      nextTop = clamped.top;

      this.root.style.left = Math.round(nextLeft) + "px";
      this.root.style.top = Math.round(nextTop) + "px";
      this.root.style.width = Math.round(nextWidth) + "px";
      this.root.style.height = Math.round(nextHeight) + "px";
      this.updatePanelFade();
      this.scheduleWindowRender();
    }

    finishResize() {
      if (!this.root || !this.resizeState) {
        this.resizeState = null;
        return;
      }
      const left = Number.parseInt(this.root.style.left || "0", 10);
      const top = Number.parseInt(this.root.style.top || "0", 10);
      const width = Number.parseInt(this.root.style.width || "0", 10);
      const height = Number.parseInt(this.root.style.height || "0", 10);
      this.resizeState = null;
      this.updateSettings({
        panelPosition: {
          left: Number.isFinite(left) ? left : 0,
          top: Number.isFinite(top) ? top : 0
        },
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
      const rect = this.launcherButton.getBoundingClientRect();
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
      this.currentWindowStart = -1;
      this.currentWindowEnd = -1;
      this.scheduleWindowRender(true);
      this.updateJumpBottomVisibility();
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
      }
      this.playbackTime = time;
      this.updateActiveReadingGlow();
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
      const shouldShow =
        !isClosed && this.chunks.length > 0 && !this.isNearBottom(1.4);
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
        return;
      }

      const start = 0;
      const end = chunkCount - 1;
      const shouldRebuild =
        start !== this.currentWindowStart ||
        end !== this.currentWindowEnd ||
        futureCount !== this.currentFutureCount ||
        this.futureCollapsed !== this.currentFutureCollapsed;
      this.currentWindowStart = start;
      this.currentWindowEnd = end;
      this.currentFutureCount = futureCount;
      this.currentFutureCollapsed = this.futureCollapsed;
      this.topSpacer.style.height = "0px";
      this.bottomSpacer.style.height = "0px";

      if (!shouldRebuild) {
        this.updateActiveClass();
        this.updateActiveReadingGlow();
        return;
      }

      const fragment = document.createDocumentFragment();
      for (let index = start; index <= end; index += 1) {
        const chunk = this.chunks[index];
        fragment.append(this.createChunkButton(chunk, index, false));
      }

      if (futureCount) {
        const divider = document.createElement("button");
        divider.type = "button";
        divider.className = "dc-future-divider";
        divider.setAttribute("aria-expanded", this.futureCollapsed ? "false" : "true");
        divider.textContent = this.futureCollapsed ? "Next up +" : "Next up -";
        divider.addEventListener("click", () => {
          this.futureCollapsed = !this.futureCollapsed;
          this.currentWindowStart = -1;
          this.currentWindowEnd = -1;
          this.scheduleWindowRender();
        });
        fragment.append(divider);

        if (!this.futureCollapsed) {
          for (let index = 0; index < futureCount; index += 1) {
            const preview = this.futureChunks[index];
            const actualIndex = Number.isInteger(preview && preview.actualIndex) ? preview.actualIndex : chunkCount + index;
            fragment.append(this.createChunkButton(preview, actualIndex, true));
          }
        }
      }

      this.windowContainer.replaceChildren(fragment);
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

      const seekIcon = document.createElement("span");
      seekIcon.className = "dc-chunk-seek-icon";
      seekIcon.textContent = "\u25b6";
      seekIcon.setAttribute("aria-hidden", "true");

      const content = document.createElement("span");
      content.className = "dc-chunk-content";

      const time = document.createElement("span");
      time.className = "dc-chunk-time";
      time.textContent = chunker.formatTimestamp(chunk && chunk.start);

      const text = document.createElement("span");
      text.className = "dc-chunk-text";

      content.append(time, text);
      item.append(seekIcon, content);
      if (!isFuture && index === this.activeIndex) {
        item.classList.add("is-current");
      }
      this.renderChunkText(text, chunk, !isFuture && index === this.activeIndex);
      return item;
    }

    renderChunkText(textElement, chunk, isActive) {
      if (!textElement) {
        return;
      }
      const text = chunk && typeof chunk.text === "string" ? chunk.text : "";
      if (!isActive || !bubbleState || typeof bubbleState.getReadingGlowRange !== "function") {
        textElement.textContent = text;
        return;
      }

      const range = bubbleState.getReadingGlowRange(chunk, this.playbackTime);
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
      if (this.lastGlowIndex === this.activeIndex && this.lastGlowWordStart === nextGlowWordStart) {
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
        this.renderChunkText(textElement, chunk, true);
        this.lastGlowIndex = this.activeIndex;
        this.lastGlowWordStart = nextGlowWordStart;
      }
    }
  }

  app.DialoguePanel = DialoguePanel;
})(window);
