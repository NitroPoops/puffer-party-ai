const providerEl = document.getElementById("provider");
const apiKeyEl = document.getElementById("apiKey");
const modelEl = document.getElementById("model");
const saveBtn = document.getElementById("saveBtn");
const savedMsg = document.getElementById("savedMsg");

chrome.storage.local.get(
  { provider: "openai", apiKey: "", model: "" },
  (data) => {
    providerEl.value = data.provider;
    apiKeyEl.value = data.apiKey;
    modelEl.value = data.model;
  }
);

saveBtn.addEventListener("click", () => {
  chrome.storage.local.set(
    {
      provider: providerEl.value,
      apiKey: apiKeyEl.value.trim(),
      model: modelEl.value.trim()
    },
    () => {
      savedMsg.textContent = "Settings saved!";
      setTimeout(() => (savedMsg.textContent = ""), 2000);
    }
  );
});