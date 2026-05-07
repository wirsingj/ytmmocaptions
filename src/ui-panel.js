(function initUiPanel(scope) {
  const app = (scope.DialogueCaptions = scope.DialogueCaptions || {});
  const chunker = app.chunker;
  const platform = app.platform;

  const PANEL_ID = "dc-panel";
  const ACTIVE_PAGE_CLASS = "dc-panel-open";
  const BOTTOM_PROXIMITY_PX = 140;
  const MIN_PANEL_WIDTH = 280;
  const MIN_PANEL_HEIGHT = 220;
  const DEFAULT_PANEL_MAX_WIDTH = 572;
  const DEFAULT_PANEL_MAX_HEIGHT = 408;
  const DEFAULT_PANEL_MARGIN = 12;
  const PANEL_CONTROL_BAR_GAP = 64;
  const LAUNCHER_MARGIN = 14;
  const LAUNCHER_WIDTH = 96;
  const LAUNCHER_HEIGHT = 32;
  const LAUNCHER_CONTROL_BAR_GAP = 54;

  class DialoguePanel {
    constructor(options) {
      this.options = options || {};
      this.settings = this.options.settings || {};
      this.features = this.options.features || {};

      this.root = null;
      this.body = null;
      this.statusEl = null;
      this.listViewport = null;
      this.topSpacer = null;
      this.windowContainer = null;
      this.bottomSpacer = null;

      this.autoScrollButton = null;
      this.keyboardButton = null;
      this.chunkSizeSelect = null;
      this.stepWrap = null;
      this.stepSelect = null;
      this.sizeWrap = null;
      this.opacityWrap = null;
      this.opacityInput = null;
      this.textScaleWrap = null;
      this.textScaleInput = null;
      this.header = null;
      this.closeButton = null;
      this.launcherButton = null;
      this.jumpBottomButton = null;

      this.chunks = [];
      this.activeIndex = -1;
      this.currentWindowStart = -1;
      this.currentWindowEnd = -1;
      this.dragState = null;
      this.resizeState = null;
      this.launcherDragState = null;
      this.launcherSuppressClickUntil = 0;
      this.resizeHandles = [];
      this.pointerInside = false;
      this.stickToBottom = true;
      this.programmaticScrollUntil = 0;

      this.cleanupFns = [];
      this.layoutRefreshTimers = [];
      this.rafRenderId = 0;
      this.statusTimer = 0;
    }

    mount() {
      const previous = document.getElementById(PANEL_ID);
      if (previous) {
        previous.remove();
      }

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
      this.closeButton.textContent = "v";
      this.closeButton.title = "Collapse to pill";

      this.autoScrollButton = document.createElement("button");
      this.autoScrollButton.type = "button";
      this.autoScrollButton.className = "dc-btn";
      this.autoScrollButton.title = "Toggle auto-scroll";

      this.keyboardButton = document.createElement("button");
      this.keyboardButton.type = "button";
      this.keyboardButton.className = "dc-btn dc-btn-keys";
      this.keyboardButton.title = "Keyboard mode: focus-only or global";

      const sizeWrap = document.createElement("label");
      sizeWrap.className = "dc-size-wrap";
      sizeWrap.textContent = "Chunk";
      this.sizeWrap = sizeWrap;

      this.chunkSizeSelect = document.createElement("select");
      this.chunkSizeSelect.className = "dc-size-select";
      const sizeOptions = [
        { value: "short", label: "Short" },
        { value: "medium", label: "Medium" },
        { value: "long", label: "Long" }
      ];
      for (const optionData of sizeOptions) {
        const option = document.createElement("option");
        option.value = optionData.value;
        option.textContent = optionData.label;
        this.chunkSizeSelect.append(option);
      }
      this.chunkSizeSelect.value = this.settings.chunkSize || "medium";
      sizeWrap.append(this.chunkSizeSelect);

      const stepWrap = document.createElement("label");
      stepWrap.className = "dc-step-wrap";
      stepWrap.textContent = "Step";
      this.stepWrap = stepWrap;

      this.stepSelect = document.createElement("select");
      this.stepSelect.className = "dc-size-select";
      const stepOptions = [
        { value: "3", label: "3s" },
        { value: "8", label: "8s" },
        { value: "5", label: "5s" },
        { value: "12", label: "12s" }
      ];
      for (const optionData of stepOptions) {
        const option = document.createElement("option");
        option.value = optionData.value;
        option.textContent = optionData.label;
        this.stepSelect.append(option);
      }
      this.stepSelect.value = String(this.settings.keyboardStepSeconds || 8);
      stepWrap.append(this.stepSelect);

      const opacityWrap = document.createElement("label");
      opacityWrap.className = "dc-opacity-wrap";
      opacityWrap.textContent = "Alpha";
      this.opacityWrap = opacityWrap;

      this.opacityInput = document.createElement("input");
      this.opacityInput.type = "range";
      this.opacityInput.className = "dc-opacity-input";
      this.opacityInput.min = "35";
      this.opacityInput.max = "100";
      this.opacityInput.step = "1";
      this.opacityInput.value = String(this.settings.panelOpacity || 100);
      this.opacityInput.title = "Panel transparency";
      opacityWrap.append(this.opacityInput);

      const textScaleWrap = document.createElement("label");
      textScaleWrap.className = "dc-text-scale-wrap";
      textScaleWrap.textContent = "Text";
      this.textScaleWrap = textScaleWrap;

      this.textScaleInput = document.createElement("input");
      this.textScaleInput.type = "range";
      this.textScaleInput.className = "dc-text-scale-input";
      this.textScaleInput.min = "100";
      this.textScaleInput.max = "160";
      this.textScaleInput.step = "5";
      this.textScaleInput.value = String(this.settings.textScale || 100);
      this.textScaleInput.title = "Text size";
      textScaleWrap.append(this.textScaleInput);

      controls.append(
        opacityWrap,
        textScaleWrap,
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
      if (this.root) {
        this.root.remove();
        this.root = null;
      }
      if (this.launcherButton) {
        this.launcherButton.remove();
        this.launcherButton = null;
      }
      document.documentElement.classList.remove(ACTIVE_PAGE_CLASS);
    }

    addListener(target, type, handler, options) {
      if (!target) {
        return;
      }
      target.addEventListener(type, handler, options);
      this.cleanupFns.push(() => target.removeEventListener(type, handler, options));
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
      const onAuto = () => {
        if (!this.features.autoScrollControl) {
          return;
        }
        this.updateSettings({ autoScroll: !this.settings.autoScroll });
      };
      const onKeyboard = () => {
        if (!this.features.globalKeyboardMode) {
          return;
        }
        this.updateSettings({ globalKeyboardEnabled: !this.settings.globalKeyboardEnabled });
      };

      this.addListener(this.closeButton, "click", onClose);
      this.addListener(this.autoScrollButton, "click", onAuto);
      this.addListener(this.keyboardButton, "click", onKeyboard);

      const onChunkSizeChange = () => {
        if (!this.features.chunkSizeControl) {
          return;
        }
        this.updateSettings({ chunkSize: this.chunkSizeSelect.value });
        if (typeof this.options.onChunkSizeChange === "function") {
          this.options.onChunkSizeChange(this.chunkSizeSelect.value);
        }
      };
      this.addListener(this.chunkSizeSelect, "change", onChunkSizeChange);

      const onStepSecondsChange = () => {
        this.updateSettings({ keyboardStepSeconds: Number(this.stepSelect.value || 8) });
      };
      this.addListener(this.stepSelect, "change", onStepSecondsChange);

      const onOpacityInput = () => {
        this.updateSettings({ panelOpacity: Number(this.opacityInput.value) });
      };
      this.addListener(this.opacityInput, "input", onOpacityInput);

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
        if (!this.settings.autoScroll) {
          this.stickToBottom = this.isNearBottom(1.8);
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
      }
      if (panelClosed) {
        this.pointerInside = false;
      }
      this.root.classList.remove("is-collapsed");
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

      const autoLabel = this.settings.autoScroll ? "Auto On" : "Auto Off";
      this.autoScrollButton.textContent = autoLabel;
      this.autoScrollButton.classList.toggle("is-active", Boolean(this.settings.autoScroll));
      this.autoScrollButton.style.display = this.features.autoScrollControl ? "" : "none";

      const keyLabel = this.settings.globalKeyboardEnabled ? "Keys Global" : "Keys Focus";
      this.keyboardButton.textContent = keyLabel;
      this.keyboardButton.classList.toggle("is-active", Boolean(this.settings.globalKeyboardEnabled));
      this.keyboardButton.style.display = this.features.globalKeyboardMode ? "" : "none";

      const normalizedSize = this.settings.chunkSize || "medium";
      if (this.chunkSizeSelect.value !== normalizedSize) {
        this.chunkSizeSelect.value = normalizedSize;
      }
      if (this.sizeWrap) {
        this.sizeWrap.style.display = "none";
      }
      const normalizedStep = String(Number(this.settings.keyboardStepSeconds || 8));
      if (this.stepSelect && this.stepSelect.value !== normalizedStep) {
        this.stepSelect.value = normalizedStep;
      }
      if (this.stepWrap) {
        this.stepWrap.style.display = "none";
      }

      const panelOpacity = Number(this.settings.panelOpacity || 100);
      const normalizedOpacity = Math.max(35, Math.min(100, panelOpacity));
      this.root.style.opacity = String(normalizedOpacity / 100);
      if (this.opacityInput && this.opacityInput.value !== String(normalizedOpacity)) {
        this.opacityInput.value = String(normalizedOpacity);
      }
      const textScale = Number(this.settings.textScale || 100);
      const normalizedTextScale = Math.max(100, Math.min(160, textScale));
      this.root.style.setProperty("--dc-text-scale", String(normalizedTextScale / 100));
      if (this.textScaleInput && this.textScaleInput.value !== String(normalizedTextScale)) {
        this.textScaleInput.value = String(normalizedTextScale);
      }
      if (this.settings.autoScroll && this.stickToBottom) {
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

      this.applyLauncherPosition();
      this.normalizeSavedPanelPosition();
      this.updateJumpBottomVisibility();
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
        Math.min(DEFAULT_PANEL_MAX_WIDTH, Math.round(frameWidth * 0.374))
      );
      const height = Math.max(
        MIN_PANEL_HEIGHT,
        Math.min(DEFAULT_PANEL_MAX_HEIGHT, Math.round(frameHeight * 0.48))
      );
      const clamped = this.clampPositionToRect(
        frame.left + DEFAULT_PANEL_MARGIN,
        frame.bottom - height - DEFAULT_PANEL_MARGIN,
        width,
        height,
        this.getPanelFrameRect(),
        DEFAULT_PANEL_MARGIN
      );
      return {
        left: clamped.left,
        top: clamped.top,
        width: width,
        height: height
      };
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
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        this.finishDrag();
      };

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
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        this.finishResize();
      };

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
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        this.finishLauncherDrag();
      };
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
      const shouldStick =
        Boolean(this.settings.autoScroll) && (this.stickToBottom || this.isNearBottom(2.6));
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

    setActiveIndex(index, options) {
      if (!Array.isArray(this.chunks) || !this.chunks.length) {
        this.activeIndex = -1;
        return;
      }
      const bounded = Math.max(0, Math.min(this.chunks.length - 1, index));
      const hasChanged = bounded !== this.activeIndex;
      this.activeIndex = bounded;

      if (hasChanged && this.settings.autoScroll && options && options.ensureVisible) {
        if (bounded >= Math.max(0, this.chunks.length - 2)) {
          this.stickToBottom = true;
        }
        this.ensureIndexVisible(bounded);
      }
      this.updateJumpBottomVisibility();
      this.scheduleWindowRender(!hasChanged);
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
      if (!chunkCount) {
        this.topSpacer.style.height = "0px";
        this.bottomSpacer.style.height = "0px";
        this.windowContainer.replaceChildren();
        return;
      }

      const start = 0;
      const end = chunkCount - 1;
      const shouldRebuild = start !== this.currentWindowStart || end !== this.currentWindowEnd;
      this.currentWindowStart = start;
      this.currentWindowEnd = end;
      this.topSpacer.style.height = "0px";
      this.bottomSpacer.style.height = "0px";

      if (!shouldRebuild) {
        this.updateActiveClass();
        return;
      }

      const fragment = document.createDocumentFragment();
      for (let index = start; index <= end; index += 1) {
        const chunk = this.chunks[index];
        const item = document.createElement("button");
        item.type = "button";
        item.className = "dc-chunk";
        item.setAttribute("data-index", String(index));

        const seekIcon = document.createElement("span");
        seekIcon.className = "dc-chunk-seek-icon";
        seekIcon.textContent = "▶";
        seekIcon.setAttribute("aria-hidden", "true");

        const content = document.createElement("span");
        content.className = "dc-chunk-content";

        const time = document.createElement("span");
        time.className = "dc-chunk-time";
        time.textContent = chunker.formatTimestamp(chunk.start);

        const text = document.createElement("span");
        text.className = "dc-chunk-text";
        text.textContent = chunk.text;

        content.append(time, text);
        item.append(seekIcon, content);
        if (index === this.activeIndex) {
          item.classList.add("is-current");
        }
        fragment.append(item);
      }

      this.windowContainer.replaceChildren(fragment);
    }

    updateActiveClass() {
      if (!this.windowContainer) {
        return;
      }
      const current = this.windowContainer.querySelector(".dc-chunk.is-current");
      if (current) {
        current.classList.remove("is-current");
      }
      if (this.activeIndex < this.currentWindowStart || this.activeIndex > this.currentWindowEnd) {
        return;
      }
      const next = this.windowContainer.querySelector("[data-index='" + this.activeIndex + "']");
      if (next) {
        next.classList.add("is-current");
      }
    }
  }

  app.DialoguePanel = DialoguePanel;
})(window);
