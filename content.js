(() => {
  if (window.__pufferAiInjected) return;
  window.__pufferAiInjected = true;

  let state = {
    promptSelector: "",
    usedSelector: "",
    autoSearch: true,
    lastPrompt: "",
    shownAnswers: [],
    requestId: 0,
    pickingMode: null
  };

  let activePort = null;
  const promptCache = new Map();

  const IGNORED_PATTERNS = [
    /^[\d\s.:\/,%+-]+(s|sec|secs|ms|pt|pts)?$/i,
    /^round\s+\d+(\s*(\/|of)\s*\d+)?$/i,
    /[∞⟲→←↻★🏆]/,
    /\blast\s+one\s+floating\b/i,
    /\bkeep\s+diving\b/i,
    /\bthemed\s+packs\b/i,
    /\bwins?\s+(the\s+)?round\b/i,
    /\bwon\s+(the\s+)?round\b/i,
    /\b(new|next)\s+category\b/i,
    /\b(next|final)\s+round\b/i,
    /\bround\s+(over|ended|complete|starting)\b/i,
    /\btime'?s\s+up\b/i,
    /\bout\s+of\s+time\b/i,
    /\bwaiting\s+for\b/i,
    /\bget\s+ready\b/i,
    /\bstarting\s+in\b/i,
    /\bgame\s+over\b/i,
    /\bno\s+winner\b/i,
    /\beveryone\s+(passed|eliminated)\b/i,
    /\b(play\s+again|back\s+to\s+lobby|join\s+room|create\s+room)\b/i,
    /^(loading|ready|pass|passed|tie|draw|boom|exploded)\W*$/i,
    /\bpass\s+the\s+puffer\b/i,
    /\bdon'?t\s+let\s+it\s+pop\b/i
  ];

  function isLikelyCategoryPrompt(el, rawText, cleanText) {
    if (!cleanText || cleanText.length < 6 || cleanText.length > 140) return false;
    if (el.querySelectorAll("a, button").length > 1) return false;
    const lineCount = rawText.split(/\n+/).filter((l) => l.trim()).length;
    if (lineCount > 3) return false;

    const words = cleanText.split(/\s+/).filter(Boolean);
    if (words.length < 2 || !/[a-zA-Z]{2,}/.test(cleanText)) return false;

    return !IGNORED_PATTERNS.some((rx) => rx.test(cleanText));
  }

  const host = document.createElement("div");
  host.id = "puffer-ai-host";
  document.documentElement.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });

  shadow.innerHTML = `
    <style>
      :host {
        all: initial;
        position: fixed;
        top: 16px;
        right: 16px;
        z-index: 2147483647;
        font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      }
      .panel {
        width: 325px;
        background: rgba(15, 23, 42, 0.95);
        color: #f8fafc;
        border: 1px solid rgba(148, 163, 184, 0.25);
        border-radius: 12px;
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
        backdrop-filter: blur(8px);
        overflow: hidden;
        font-size: 13px;
      }
      .panel.hidden { display: none; }
      .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 9px 12px;
        background: rgba(30, 41, 59, 0.95);
        cursor: move;
        user-select: none;
        border-bottom: 1px solid rgba(148, 163, 184, 0.18);
      }
      .title { font-weight: 700; font-size: 13px; color: #38bdf8; }
      .header-btns { display: flex; gap: 6px; }
      button {
        background: #1e293b;
        color: #e2e8f0;
        border: 1px solid rgba(148, 163, 184, 0.3);
        border-radius: 6px;
        padding: 4px 8px;
        font-size: 11px;
        cursor: pointer;
      }
      button:hover { background: #334155; }
      button.primary {
        background: #0284c7;
        border-color: #38bdf8;
        color: #fff;
        font-weight: 600;
      }
      button.primary:hover { background: #0369a1; }
      button.more {
        background: #4f46e5;
        border-color: #818cf8;
        color: #fff;
        font-weight: 600;
      }
      button.more:hover { background: #4338ca; }
      button:disabled { opacity: 0.45; cursor: not-allowed; }
      button.active {
        background: #ca8a04;
        border-color: #facc15;
        color: #fff;
      }
      .body { padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
      .setup-row {
        display: none;
        gap: 6px;
        flex-wrap: wrap;
        padding-bottom: 4px;
        border-bottom: 1px solid rgba(148, 163, 184, 0.15);
      }
      .setup-row.open { display: flex; }
      .prompt-row { display: flex; gap: 5px; }
      input[type="text"] {
        flex: 1;
        min-width: 0;
        background: #0f172a;
        color: #f8fafc;
        border: 1px solid rgba(148, 163, 184, 0.3);
        border-radius: 6px;
        padding: 6px 8px;
        font-size: 12px;
      }
      .status { font-size: 11px; color: #94a3b8; min-height: 15px; }
      .status.error { color: #f87171; }
      .results {
        display: flex;
        flex-direction: column;
        gap: 5px;
        max-height: 320px;
        overflow-y: auto;
      }
      .batch {
        display: flex;
        flex-direction: column;
        gap: 5px;
      }
      .divider {
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: #64748b;
        border-top: 1px dashed rgba(148, 163, 184, 0.25);
        padding-top: 5px;
        margin-top: 2px;
      }
      .item {
        display: flex;
        flex-direction: column;
        gap: 2px;
        background: rgba(30, 41, 59, 0.75);
        border: 1px solid rgba(148, 163, 184, 0.16);
        border-radius: 8px;
        padding: 6px 8px;
        cursor: pointer;
        transition: border-color 0.15s ease;
      }
      .item:hover { border-color: #38bdf8; }
      .item-top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      .answer-text { font-weight: 600; color: #f1f5f9; }
      .badge {
        font-size: 10px;
        padding: 1px 6px;
        border-radius: 999px;
        font-weight: 600;
        flex-shrink: 0;
      }
      .badge.Ultra-Rare { background: rgba(168, 85, 247, 0.25); color: #d8b4fe; }
      .badge.Deep { background: rgba(14, 165, 233, 0.25); color: #7dd3fc; }
      .badge.Rare { background: rgba(16, 185, 129, 0.25); color: #6ee7b7; }
      .note { font-size: 11px; color: #94a3b8; }
      .footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-size: 11px;
        color: #94a3b8;
      }
      label { display: flex; align-items: center; gap: 4px; cursor: pointer; }
    </style>

    <div class="panel" id="panel">
      <div class="header" id="dragHandle">
        <span class="title">Puffer AI Finder</span>
        <div class="header-btns">
          <button id="setupToggleBtn" title="Show/hide element picker tools">Setup</button>
          <button id="toggleMin" title="Minimize">–</button>
        </div>
      </div>
      <div class="body" id="panelBody">
        <div class="setup-row" id="setupRow">
          <button id="pickPromptBtn">Pick Prompt</button>
          <button id="pickUsedBtn">Pick Used List</button>
          <button id="clearSelectorsBtn" title="Clear saved prompt & used-list element selectors">Reset</button>
        </div>
        <div class="prompt-row">
          <input type="text" id="manualPrompt" placeholder="Detected or typed prompt..." />
          <button class="primary" id="searchBtn">Go</button>
          <button class="more" id="moreBtn" title="Fetch 10 more unique answers" disabled>+ More</button>
        </div>
        <div class="footer">
          <label><input type="checkbox" id="autoToggle" checked /> Auto-search</label>
          <span>Alt+Q toggle</span>
        </div>
        <div class="status" id="status">Ready.</div>
        <div class="results" id="results"></div>
      </div>
    </div>
  `;

  const panel = shadow.getElementById("panel");
  const panelBody = shadow.getElementById("panelBody");
  const dragHandle = shadow.getElementById("dragHandle");
  const setupToggleBtn = shadow.getElementById("setupToggleBtn");
  const setupRow = shadow.getElementById("setupRow");
  const toggleMin = shadow.getElementById("toggleMin");
  const pickPromptBtn = shadow.getElementById("pickPromptBtn");
  const pickUsedBtn = shadow.getElementById("pickUsedBtn");
  const clearSelectorsBtn = shadow.getElementById("clearSelectorsBtn");
  const manualPrompt = shadow.getElementById("manualPrompt");
  const searchBtn = shadow.getElementById("searchBtn");
  const moreBtn = shadow.getElementById("moreBtn");
  const autoToggle = shadow.getElementById("autoToggle");
  const statusEl = shadow.getElementById("status");
  const resultsEl = shadow.getElementById("results");

  chrome.storage.local.get(
    { promptSelector: "", usedSelector: "", autoSearch: true },
    (saved) => {
      state.promptSelector = saved.promptSelector;
      state.usedSelector = saved.usedSelector;
      state.autoSearch = saved.autoSearch;
      autoToggle.checked = saved.autoSearch;
      if (state.promptSelector) {
        setStatus("Watching prompt element.");
        checkPromptChange(false);
      } else {
        setupRow.classList.add("open");
        setStatus('Click "Pick Prompt" directly on the question text.');
      }
    }
  );

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.autoSearch) {
      state.autoSearch = changes.autoSearch.newValue;
      autoToggle.checked = state.autoSearch;
    }
  });

  setupToggleBtn.addEventListener("click", () => {
    setupRow.classList.toggle("open");
  });

  toggleMin.addEventListener("click", () => {
    const collapsed = panelBody.style.display === "none";
    panelBody.style.display = collapsed ? "flex" : "none";
    toggleMin.textContent = collapsed ? "–" : "+";
  });

  document.addEventListener("keydown", (e) => {
    if (e.altKey && e.key.toLowerCase() === "q") {
      panel.classList.toggle("hidden");
    }
  });

  let dragging = false, startX = 0, startY = 0, origRight = 16, origTop = 16;
  dragHandle.addEventListener("mousedown", (e) => {
    if (e.target.tagName === "BUTTON") return;
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    const rect = host.getBoundingClientRect();
    origRight = window.innerWidth - rect.right;
    origTop = rect.top;
  });
  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    host.style.right = `${Math.max(0, origRight - (e.clientX - startX))}px`;
    host.style.top = `${Math.max(0, origTop + (e.clientY - startY))}px`;
  });
  window.addEventListener("mouseup", () => { dragging = false; });

  autoToggle.addEventListener("change", () => {
    state.autoSearch = autoToggle.checked;
    chrome.storage.local.set({ autoSearch: state.autoSearch });
  });

  searchBtn.addEventListener("click", () => {
    const text = manualPrompt.value.trim();
    if (text) runSearch(text, { bypassCache: true, isMore: false });
  });

  moreBtn.addEventListener("click", () => {
    const text = (manualPrompt.value.trim() || state.lastPrompt).trim();
    if (text) runSearch(text, { bypassCache: true, isMore: true });
  });

  manualPrompt.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const text = manualPrompt.value.trim();
      if (text) runSearch(text, { bypassCache: true, isMore: false });
    }
  });

  clearSelectorsBtn.addEventListener("click", () => {
    state.promptSelector = "";
    state.usedSelector = "";
    state.lastPrompt = "";
    chrome.storage.local.set({ promptSelector: "", usedSelector: "" });
    setStatus("Saved selectors cleared.");
  });

  let hoveredEl = null;
  let prevOutline = "";

  function startPicking(mode) {
    if (state.pickingMode === mode) {
      stopPicking();
      return;
    }
    state.pickingMode = mode;
    pickPromptBtn.classList.toggle("active", mode === "prompt");
    pickUsedBtn.classList.toggle("active", mode === "used");
    setStatus(
      mode === "prompt"
        ? "Click directly on the prompt text..."
        : "Click the container listing already-used answers..."
    );
  }

  function stopPicking() {
    state.pickingMode = null;
    pickPromptBtn.classList.remove("active");
    pickUsedBtn.classList.remove("active");
    if (hoveredEl) {
      hoveredEl.style.outline = prevOutline;
      hoveredEl = null;
    }
  }

  pickPromptBtn.addEventListener("click", () => startPicking("prompt"));
  pickUsedBtn.addEventListener("click", () => startPicking("used"));

  document.addEventListener(
    "mouseover",
    (e) => {
      if (!state.pickingMode || e.target === host || host.contains(e.target)) return;
      if (hoveredEl) hoveredEl.style.outline = prevOutline;
      hoveredEl = e.target;
      prevOutline = hoveredEl.style.outline;
      hoveredEl.style.outline = "2px solid #38bdf8";
    },
    true
  );

  document.addEventListener(
    "click",
    (e) => {
      if (!state.pickingMode) return;
      if (e.target === host || host.contains(e.target)) return;
      e.preventDefault();
      e.stopPropagation();

      const selector = buildUniqueSelector(e.target);
      if (state.pickingMode === "prompt") {
        const raw = e.target.innerText || e.target.textContent || "";
        const clean = raw.replace(/\s+/g, " ").trim();
        state.promptSelector = selector;
        chrome.storage.local.set({ promptSelector: selector });
        stopPicking();

        if (clean.length > 140) {
          setStatus("Warning: picked a large container. Click the text itself.", true);
        } else {
          setupRow.classList.remove("open");
          setStatus("Prompt element locked!");
          checkPromptChange(true);
        }
      } else if (state.pickingMode === "used") {
        state.usedSelector = selector;
        chrome.storage.local.set({ usedSelector: selector });
        stopPicking();
        setStatus("Used-answers container locked.");
      }
    },
    true
  );

  function buildUniqueSelector(el) {
    if (el.id && !/\d{4,}/.test(el.id)) {
      return `#${CSS.escape(el.id)}`;
    }
    const parts = [];
    let current = el;
    while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body) {
      let selector = current.tagName.toLowerCase();
      if (current.id && !/\d{4,}/.test(current.id)) {
        parts.unshift(`#${CSS.escape(current.id)}`);
        break;
      }
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(
          (child) => child.tagName === current.tagName
        );
        if (siblings.length > 1) {
          selector += `:nth-of-type(${siblings.indexOf(current) + 1})`;
        }
      }
      parts.unshift(selector);
      current = parent;
    }
    return parts.join(" > ");
  }

  let debounceTimer = null;
  const observer = new MutationObserver(() => {
    if (!state.promptSelector) return;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => checkPromptChange(false), 60);
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true
  });

  function checkPromptChange(force = false) {
    if (!state.promptSelector) return;
    const el = document.querySelector(state.promptSelector);
    if (!el) return;

    const rawText = el.innerText || el.textContent || "";
    const cleanText = rawText.replace(/\s+/g, " ").trim();

    if (!isLikelyCategoryPrompt(el, rawText, cleanText)) return;
    if (!force && cleanText === state.lastPrompt) return;

    state.lastPrompt = cleanText;
    manualPrompt.value = cleanText;

    if (state.autoSearch || force) {
      runSearch(cleanText, { bypassCache: false, isMore: false });
    }
  }

  function getUsedAnswers() {
    if (!state.usedSelector) return [];
    const container = document.querySelector(state.usedSelector);
    if (!container) return [];
    const rawLines = (container.innerText || "")
      .split(/\n|,|•/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && s.length < 60);
    return Array.from(new Set(rawLines));
  }

  function createCard(item) {
    const card = document.createElement("div");
    card.className = "item";

    const top = document.createElement("div");
    top.className = "item-top";

    const name = document.createElement("span");
    name.className = "answer-text";
    name.textContent = item.answer;

    const badge = document.createElement("span");
    const tier = item.rarity || "Rare";
    badge.className = `badge ${tier.split(" ")[0]}`;
    badge.textContent = tier;

    top.appendChild(name);
    top.appendChild(badge);
    card.appendChild(top);

    if (item.note) {
      const note = document.createElement("div");
      note.className = "note";
      note.textContent = item.note;
      card.appendChild(note);
    }

    card.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(item.answer);
        setStatus(`Copied "${item.answer}"!`);
      } catch {
        setStatus("Clipboard copy blocked.");
      }
    });

    return card;
  }

  function runSearch(promptText, { bypassCache = false, isMore = false } = {}) {
    if (activePort) {
      try { activePort.disconnect(); } catch {}
      activePort = null;
    }

    const usedAnswers = getUsedAnswers();
    const cacheKey = promptText.toLowerCase();

    if (!isMore) {
      state.shownAnswers = [];
      resultsEl.textContent = "";
    }

    if (!isMore && !bypassCache && usedAnswers.length === 0 && promptCache.has(cacheKey)) {
      const cached = promptCache.get(cacheKey);
      const batch = document.createElement("div");
      batch.className = "batch";
      for (const item of cached) {
        batch.appendChild(createCard(item));
        state.shownAnswers.push(item.answer);
      }
      resultsEl.appendChild(batch);
      moreBtn.disabled = false;
      setStatus(`Loaded ${cached.length} cached answers.`);
      return;
    }

    const excludeAnswers = isMore
      ? Array.from(new Set([...usedAnswers, ...state.shownAnswers]))
      : usedAnswers;

    const currentId = ++state.requestId;
    const batchItems = [];
    const batchContainer = document.createElement("div");
    batchContainer.className = "batch";

    if (isMore && resultsEl.firstChild) {
      const divider = document.createElement("div");
      divider.className = "divider";
      divider.textContent = "Previous answers";
      resultsEl.prepend(divider);
      resultsEl.prepend(batchContainer);
      resultsEl.scrollTop = 0;
    } else {
      resultsEl.appendChild(batchContainer);
    }

    moreBtn.disabled = true;
    setStatus(isMore ? "Streaming more unique answers..." : "Streaming rarest answers...");

    const port = chrome.runtime.connect({ name: "puffer-stream" });
    activePort = port;

    port.onMessage.addListener((msg) => {
      if (currentId !== state.requestId) return;

      if (msg.type === "item" && msg.item) {
        batchItems.push(msg.item);
        state.shownAnswers.push(msg.item.answer);
        batchContainer.appendChild(createCard(msg.item));
        moreBtn.disabled = false;
        setStatus(`Streaming... (${state.shownAnswers.length} total, click to copy)`);
      } else if (msg.type === "done") {
        if (!isMore && batchItems.length && usedAnswers.length === 0) {
          if (promptCache.size > 50) {
            promptCache.delete(promptCache.keys().next().value);
          }
          promptCache.set(cacheKey, batchItems);
        }
        moreBtn.disabled = state.shownAnswers.length === 0;
        setStatus(
          batchItems.length
            ? `Ready (${state.shownAnswers.length} answers, click to copy).`
            : "No new answers found."
        );
        try { port.disconnect(); } catch {}
        if (activePort === port) activePort = null;
      } else if (msg.type === "error") {
        moreBtn.disabled = state.shownAnswers.length === 0;
        setStatus(msg.error || "Search failed.", true);
        try { port.disconnect(); } catch {}
        if (activePort === port) activePort = null;
      }
    });

    port.postMessage({
      type: "START_SEARCH",
      payload: { promptText, excludeAnswers, isMore }
    });
  }

  function setStatus(msg, isError = false) {
    statusEl.textContent = msg;
    statusEl.classList.toggle("error", isError);
  }
})();