const SYSTEM_PROMPT =
  "Puffer Party trivia helper. Output EXACTLY 10 lines, rarest valid real answers first, one per line, format:\n" +
  "Answer|U or D or R|2-4 word hint\n" +
  "Where U=Ultra-Rare, D=Deep Cut, R=Rare. No numbering, bullets, markdown, or extra text. Strictly obey all prompt constraints and exclude listed answers.";

const RARITY_MAP = {
  U: "Ultra-Rare",
  D: "Deep Cut",
  R: "Rare"
};

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "puffer-stream") return;

  let controller = null;
  let disconnected = false;

  const safePost = (msg) => {
    if (!disconnected) {
      try {
        port.postMessage(msg);
      } catch {
        disconnected = true;
      }
    }
  };

  port.onDisconnect.addListener(() => {
    disconnected = true;
    if (controller) controller.abort();
  });

  port.onMessage.addListener(async (msg) => {
    if (msg?.type !== "START_SEARCH") return;
    if (controller) controller.abort();
    controller = new AbortController();

    try {
      await streamSearch(msg.payload, controller.signal, safePost);
      safePost({ type: "done" });
    } catch (err) {
      if (err?.name === "AbortError" || disconnected) return;
      safePost({ type: "error", error: err.message || String(err) });
    }
  });
});

async function streamSearch({ promptText, excludeAnswers = [], isMore = false }, signal, safePost) {
  const settings = await chrome.storage.local.get({
    provider: "openai",
    apiKey: "",
    model: ""
  });

  if (!settings.apiKey?.trim()) {
    throw new Error("Missing API key. Click the extension icon to configure it.");
  }

  const cleanPrompt = (promptText || "").trim();
  if (!cleanPrompt) {
    throw new Error("Prompt text is empty.");
  }

  const excludeSet = new Set(
    excludeAnswers.map((a) => a.trim().toLowerCase()).filter(Boolean)
  );

  const userMessage =
    `Prompt: ${cleanPrompt}\n` +
    (excludeSet.size > 0
      ? `Exclude (DO NOT output any of these): ${Array.from(excludeSet).join(", ")}\n`
      : "") +
    (isMore ? "Give 10 completely different rare answers not listed above." : "");

  let lineBuffer = "";

  const pushChunk = (deltaText) => {
    if (!deltaText) return;
    lineBuffer += deltaText;
    const lines = lineBuffer.split(/\r?\n/);
    lineBuffer = lines.pop() || "";

    for (const rawLine of lines) {
      emitParsedLine(rawLine, excludeSet, safePost);
    }
  };

  if (settings.provider === "gemini") {
    const model = settings.model?.trim() || "gemini-3.8-flash";
    await streamGemini(settings.apiKey.trim(), model, userMessage, signal, pushChunk);
  } else {
    const model = settings.model?.trim() || "gpt-6.1-terra";
    await streamOpenAI(settings.apiKey.trim(), model, userMessage, signal, pushChunk);
  }

  if (lineBuffer.trim()) {
    emitParsedLine(lineBuffer, excludeSet, safePost);
  }
}

function emitParsedLine(rawLine, excludeSet, safePost) {
  let line = rawLine.trim().replace(/^[-*•]\s*/, "").replace(/^\d+[.)]\s*/, "");
  if (!line || /^```/.test(line)) return;

  const parts = line.split("|").map((p) => p.trim());
  const answer = (parts[0] || "").replace(/^["']|["']$/g, "").trim();
  if (!answer) return;

  const key = answer.toLowerCase();
  if (excludeSet.has(key)) return;
  excludeSet.add(key);

  const rCode = (parts[1] || "R").toUpperCase().charAt(0);
  const rarity = RARITY_MAP[rCode] || "Rare";
  const note = parts.slice(2).join(" - ").trim();

  safePost({
    type: "item",
    item: { answer, rarity, note }
  });
}

async function streamOpenAI(apiKey, model, userMessage, signal, onDelta) {
  const body = {
    model,
    instructions: SYSTEM_PROMPT,
    input: userMessage,
    max_output_tokens: 700,
    stream: true
  };

  if (/^gpt-(5|6)/i.test(model)) {
    if (/astra|6\.1-sol/i.test(model)) {
      body.reasoning = { effort: "low" };
    } else {
      body.reasoning = { effort: "none" };
      body.temperature = 0.45;
    }
  } else {
    body.temperature = 0.45;
  }

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI API error (${res.status}): ${text.slice(0, 200)}`);
  }

  await readSSEStream(res, signal, (event) => {
    if (event?.type === "response.output_text.delta" && typeof event.delta === "string") {
      onDelta(event.delta);
    } else if (event?.type === "error") {
      throw new Error(event.error?.message || "OpenAI streaming error");
    }
  });
}

async function streamGemini(apiKey, model, userMessage, signal, onDelta) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;

  const generationConfig = {
    temperature: 0.45,
    maxOutputTokens: 1024
  };

  if (/^gemini-(3|4)/i.test(model)) {
    generationConfig.thinkingConfig = {
      thinkingLevel: /flash-lite/i.test(model) ? "MINIMAL" : "LOW"
    };
  }

  const res = await fetch(url, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: SYSTEM_PROMPT }]
      },
      contents: [
        {
          role: "user",
          parts: [{ text: userMessage }]
        }
      ],
      generationConfig
    })
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gemini API error (${res.status}): ${text.slice(0, 200)}`);
  }

  await readSSEStream(res, signal, (chunk) => {
    const parts = chunk?.candidates?.[0]?.content?.parts || [];
    for (const part of parts) {
      // Skip hidden thinking parts; only stream visible answer text
      if (!part?.thought && typeof part?.text === "string") {
        onDelta(part.text);
      }
    }
  });
}

async function readSSEStream(res, signal, onEventData) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        let parsed;
        try {
          parsed = JSON.parse(payload);
        } catch {
          continue;
        }
        onEventData(parsed);
      }
    }
  } finally {
    if (signal.aborted) {
      reader.cancel().catch(() => {});
    }
  }
}