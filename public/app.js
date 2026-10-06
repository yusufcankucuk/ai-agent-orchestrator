const app = document.querySelector("#app");
const form = document.querySelector("#project-form");
const goal = document.querySelector("#goal");
const send = document.querySelector("#run-button");
const stop = document.querySelector("#stop-button");
const conversation = document.querySelector("#conversation");
const chatView = document.querySelector("#chat-view");
const modelsView = document.querySelector("#models-view");
const providerList = document.querySelector("#provider-list");
const usageList = document.querySelector("#usage-list");
const usageUpdated = document.querySelector("#usage-updated");
const usageRefresh = document.querySelector("#usage-refresh");
const modeToggle = document.querySelector("#mode-toggle");
const workspaceForm = document.querySelector("#workspace-form");
const workspacePath = document.querySelector("#workspace-path");
const workspaceStatus = document.querySelector("#workspace-status");
const workspacePicker = document.querySelector("#workspace-picker");
const workspaceSave = document.querySelector("#workspace-save");
const chatList = document.querySelector("#chat-list");
const CHAT_STORAGE_KEY = "orchestra-chats-v1";
const ACTIVE_CHAT_KEY = "orchestra-active-chat";
let chats = loadChats();
let activeChat = chats.find((chat) => chat.id === localStorage.getItem(ACTIVE_CHAT_KEY)) || chats[0] || createChat();
if (!chats.includes(activeChat)) chats.push(activeChat);
let chatHistory = activeChat.messages;
let orchestraEnabled = activeChat.orchestraEnabled;
let currentRunAbort;
let cancellationRequested = false;

updateModeControl();
renderStoredConversation();
renderChatList();
void restoreActiveWorkspace();

modeToggle.addEventListener("click", () => {
  orchestraEnabled = !orchestraEnabled;
  localStorage.setItem("orchestra-enabled", String(orchestraEnabled));
  activeChat.orchestraEnabled = orchestraEnabled;
  saveChats();
  updateModeControl();
});

document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", async () => {
  const showModels = tab.dataset.view === "models";
  document.querySelectorAll(".tab").forEach((item) => {
    item.classList.toggle("active", item === tab);
    if (item === tab) item.setAttribute("aria-current", "page");
    else item.removeAttribute("aria-current");
  });
  chatView.hidden = showModels;
  modelsView.hidden = !showModels;
  if (showModels) await Promise.all([loadProviders(), loadWorkspace(), loadUsage()]);
  else goal.focus();
}));

goal.addEventListener("input", resizeComposer);
goal.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});

document.querySelector("#new-chat").addEventListener("click", startNewChat);
document.querySelector("#sidebar-new-chat").addEventListener("click", startNewChat);

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const prompt = goal.value.trim();
  if (!prompt || send.disabled) return;
  const runInOrchestra = orchestraEnabled;
  const priorConversation = chatHistory.slice(-20);
  chatHistory.push({ role: "user", content: prompt });
  touchActiveChat(prompt);
  app.classList.add("has-conversation");
  conversation.append(message(prompt, "user"));
  const answer = message("", "assistant");
  const assistantMessage = { role: "assistant", content: "" };
  chatHistory.push(assistantMessage);
  touchActiveChat();
  const activity = activityPanel(runInOrchestra);
  const resultText = document.createElement("div");
  resultText.className = "result-text";
  answer.append(activity.element, resultText);
  conversation.append(answer);
  goal.value = "";
  resizeComposer();
  send.disabled = true;
  send.hidden = true;
  stop.hidden = false;
  stop.disabled = false;
  modeToggle.disabled = true;
  currentRunAbort = new AbortController();
  cancellationRequested = false;
  scrollToBottom();

  try {
    const response = await fetch(runInOrchestra ? "/project-runs/stream" : "/agent-runs/stream", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ goal: prompt, conversation: priorConversation, limits: { maxWorkers: 3, maxRetries: 1, maxBudgetUsd: 1 } }),
      signal: currentRunAbort.signal,
    });
    if (!response.ok) {
      const body = await response.json();
      throw new Error(body.error || "Çalıştırma başarısız oldu");
    }
    const run = await readRunStream(response, activity);
    const final = run.tasks.find((task) => task.id === (runInOrchestra ? "final" : "agent"));
    const failed = run.tasks.find((task) => task.status === "failed");
    const resultContent = final?.output || failed?.error || final?.error || "Sonuç üretilemedi.";
    resultText.innerHTML = DOMPurify.sanitize(marked.parse(resultContent));
    if (resultContent) {
      assistantMessage.content = resultContent;
      touchActiveChat();
    }
  } catch (error) {
    answer.classList.add("error");
    activity.finish(false);
    const errContent = cancellationRequested
      ? "İşlem durduruldu."
      : error instanceof Error ? error.message : "Beklenmeyen bir hata oluştu.";
    resultText.innerHTML = DOMPurify.sanitize(marked.parse(errContent));
    assistantMessage.content = errContent;
    touchActiveChat();
  } finally {
    send.disabled = false;
    send.hidden = false;
    stop.hidden = true;
    modeToggle.disabled = false;
    currentRunAbort = undefined;
    goal.focus();
    scrollToBottom();
    void loadUsage();
  }
});

stop.addEventListener("click", () => {
  if (!currentRunAbort || cancellationRequested) return;
  cancellationRequested = true;
  stop.disabled = true;
  void fetch("/cancel", { method: "POST" });
  currentRunAbort.abort();
});

async function readRunStream(response, activity) {
  if (!response.body) throw new Error("Canlı sonuç akışı açılamadı.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result;
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line);
      if (event.type === "task_updated") activity.update(event.task);
      if (event.type === "run_finished") activity.finish(event.status === "succeeded");
      if (event.type === "result") result = event.result;
    }
    if (done) break;
  }
  if (!result) throw new Error("Sonuç alınamadı.");
  return result;
}

function message(text, role) {
  const element = document.createElement("article");
  element.className = `message ${role}`;
  
  if (role === 'user') {
    element.textContent = text;
  } else {
    element.innerHTML = text ? DOMPurify.sanitize(marked.parse(text)) : "";
  }
  return element;
}

function activityPanel(orchestra) {
  const labels = orchestra
    ? { plan: "Planlama", research: "Araştırma", build: "Üretim", review: "Kontrol", final: "Sonuç" }
    : { agent: "Agent" };
  const providerLabels = { openai: "GPT", anthropic: "Claude", gemini: "Gemini", mock: "Demo" };
  const panel = document.createElement("section");
  panel.className = "activity";
  panel.setAttribute("aria-label", "İşlem durumu");
  const heading = document.createElement("div");
  heading.className = "activity-heading";
  heading.textContent = orchestra ? "Orkestra çalışıyor" : "Agent çalışıyor";
  const list = document.createElement("div");
  list.className = "activity-list";
  const rows = new Map();
  Object.entries(labels).forEach(([id, label]) => {
    const row = document.createElement("div");
    row.className = "activity-row pending";
    const dot = document.createElement("i");
    const name = document.createElement("span");
    name.textContent = label;
    const detail = document.createElement("small");
    detail.textContent = "Bekliyor";
    row.append(dot, name, detail);
    list.append(row);
    rows.set(id, { row, detail });
  });
  panel.append(heading, list);

  return {
    element: panel,
    update(task) {
      const entry = rows.get(task.id);
      if (!entry) return;
      entry.row.className = `activity-row ${task.status}`;
      const provider = providerLabels[task.provider] || task.provider;
      const states = { pending: "Bekliyor", running: "Çalışıyor", succeeded: "Tamamlandı", failed: "Başarısız", blocked: "Atlandı" };
      const previous = [...(task.routeHistory || [])].reverse().find((route) => route.provider !== task.provider || route.model !== task.model);
      const route = previous ? `${providerLabels[previous.provider] || previous.provider} → ${provider}` : provider;
      const switched = previous && task.status === "running" ? "Model değiştirildi" : "";
      const error = task.status === "failed" && task.error ? task.error : "";
      const difficulties = { easy: "Basit", medium: "Orta", hard: "Zor" };
      const difficulty = task.difficulty ? `Zorluk: ${difficulties[task.difficulty] || task.difficulty}` : "";
      entry.detail.textContent = [route, difficulty, switched, states[task.status], error].filter(Boolean).join(" · ");
    },
    finish(success) {
      heading.textContent = success
        ? orchestra ? "Orkestra tamamlandı" : "Agent tamamladı"
        : orchestra ? "Orkestra durdu" : "Agent durdu";
      if (!success) for (const entry of rows.values()) {
        if (entry.row.classList.contains("running") || entry.row.classList.contains("pending")) {
          entry.row.className = "activity-row blocked";
          entry.detail.textContent = "Durduruldu";
        }
      }
      panel.classList.add(success ? "complete" : "stopped");
    },
  };
}

async function loadWorkspace() {
  workspaceStatus.textContent = "";
  try {
    const response = await fetch("/workspace");
    if (!response.ok) throw new Error("Proje klasörü alınamadı");
    const body = await response.json();
    workspacePath.value = body.path;
    if (!activeChat.workspace) {
      activeChat.workspace = body.path;
      saveChats();
    }
  } catch (error) {
    workspaceStatus.textContent = error instanceof Error ? error.message : "Proje klasörü alınamadı";
  }
}

workspaceForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  workspaceSave.disabled = true;
  workspaceStatus.textContent = "Kontrol ediliyor…";
  try {
    const response = await fetch("/workspace", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: workspacePath.value }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Proje klasörü seçilemedi");
    workspacePath.value = body.path;
    activeChat.workspace = body.path;
    saveChats();
    workspaceStatus.textContent = "Proje klasörü hazır";
  } catch (error) {
    workspaceStatus.textContent = error instanceof Error ? error.message : "Proje klasörü seçilemedi";
  } finally {
    workspaceSave.disabled = false;
  }
});

workspacePicker.addEventListener("click", async () => {
  workspacePicker.disabled = true;
  workspaceStatus.textContent = "Klasör seçici açılıyor…";
  try {
    const response = await fetch("/workspace/pick", { method: "POST" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Proje klasörü seçilemedi");
    workspacePath.value = body.path;
    activeChat.workspace = body.path;
    saveChats();
    workspaceStatus.textContent = "Proje klasörü hazır";
  } catch (error) {
    workspaceStatus.textContent = error instanceof Error ? error.message : "Proje klasörü seçilemedi";
  } finally {
    workspacePicker.disabled = false;
  }
});

function updateModeControl() {
  modeToggle.setAttribute("aria-pressed", String(orchestraEnabled));
  modeToggle.setAttribute("aria-label", orchestraEnabled ? "Orkestra açık, kapat" : "Agent modu açık, orkestrayı aç");
  modeToggle.querySelector("span").textContent = orchestraEnabled ? "Orkestra" : "Agent";
}

function createChat() {
  return {
    id: crypto.randomUUID(),
    title: "Yeni sohbet",
    messages: [],
    orchestraEnabled: localStorage.getItem("orchestra-enabled") !== "false",
    workspace: "",
    updatedAt: Date.now(),
  };
}

function loadChats() {
  try {
    const stored = JSON.parse(localStorage.getItem(CHAT_STORAGE_KEY) || "[]");
    if (!Array.isArray(stored)) return [];
    return stored.slice(0, 30).flatMap((chat) => {
      if (!chat || typeof chat !== "object" || typeof chat.id !== "string") return [];
      const messages = Array.isArray(chat.messages)
        ? chat.messages.slice(-50).filter((item) => item && ["user", "assistant"].includes(item.role) && typeof item.content === "string")
          .map((item) => item.role === "assistant" && !item.content.trim()
            ? { role: "assistant", content: "Yanıt tamamlanmadan sayfa yenilendi." }
            : { role: item.role, content: item.content })
        : [];
      return [{
        id: chat.id,
        title: typeof chat.title === "string" ? chat.title.slice(0, 80) : "Sohbet",
        messages,
        orchestraEnabled: chat.orchestraEnabled !== false,
        workspace: typeof chat.workspace === "string" ? chat.workspace : "",
        updatedAt: Number.isFinite(chat.updatedAt) ? chat.updatedAt : 0,
      }];
    });
  } catch { return []; }
}

function saveChats() {
  activeChat.updatedAt = Date.now();
  chats = chats.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 30);
  localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(chats));
  localStorage.setItem(ACTIVE_CHAT_KEY, activeChat.id);
  renderChatList();
}

function touchActiveChat(firstPrompt) {
  if (firstPrompt && activeChat.title === "Yeni sohbet") {
    activeChat.title = firstPrompt.replace(/\s+/g, " ").trim().slice(0, 42) || "Yeni sohbet";
  }
  saveChats();
}

function startNewChat() {
  if (send.disabled) return;
  const chat = createChat();
  chat.workspace = activeChat.workspace;
  chats.unshift(chat);
  setActiveChat(chat);
}

function setActiveChat(chat) {
  activeChat = chat;
  chatHistory = activeChat.messages;
  orchestraEnabled = activeChat.orchestraEnabled;
  goal.value = "";
  resizeComposer();
  updateModeControl();
  renderStoredConversation();
  saveChats();
  void restoreActiveWorkspace();
  goal.focus();
}

function renderStoredConversation() {
  conversation.replaceChildren(...chatHistory.map((entry) => message(entry.content, entry.role)));
  app.classList.toggle("has-conversation", chatHistory.length > 0);
}

function renderChatList() {
  chatList.replaceChildren(...chats.map((chat) => {
    const row = document.createElement("div");
    row.className = "chat-item-row";
    const button = document.createElement("button");
    button.type = "button";
    button.className = `chat-item${chat.id === activeChat.id ? " active" : ""}`;
    button.textContent = chat.title;
    button.setAttribute("aria-current", chat.id === activeChat.id ? "true" : "false");
    button.addEventListener("click", () => { if (!send.disabled) setActiveChat(chat); });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "chat-remove";
    remove.setAttribute("aria-label", `${chat.title} sohbetini sil`);
    remove.textContent = "×";
    remove.addEventListener("click", () => deleteChat(chat));
    row.append(button, remove);
    return row;
  }));
}

function deleteChat(chat) {
  if (send.disabled) return;
  chats = chats.filter((item) => item.id !== chat.id);
  if (!chats.length) chats.push(createChat());
  if (activeChat.id === chat.id) setActiveChat(chats[0]);
  else saveChats();
}

async function restoreActiveWorkspace() {
  if (!activeChat.workspace) {
    await loadWorkspace();
    return;
  }
  try {
    const response = await fetch("/workspace", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: activeChat.workspace }),
    });
    if (!response.ok) throw new Error();
  } catch {
    activeChat.workspace = "";
    saveChats();
  }
}

async function loadProviders() {
  providerList.replaceChildren(providerRow({ provider: "loading" }));
  try {
    const response = await fetch("/providers");
    if (!response.ok) throw new Error("Model durumu alınamadı");
    const body = await response.json();
    providerList.replaceChildren(...body.providers.map(providerRow));
  } catch (error) {
    const message = document.createElement("p");
    message.className = "provider-error";
    message.textContent = error instanceof Error ? error.message : "Model durumu alınamadı";
    providerList.replaceChildren(message);
  }
}

usageRefresh.addEventListener("click", loadUsage);

async function loadUsage() {
  usageRefresh.disabled = true;
  usageUpdated.textContent = "Limitler güncelleniyor…";
  try {
    const response = await fetch("/usage");
    if (!response.ok) throw new Error("Kullanım bilgisi alınamadı");
    const body = await response.json();
    usageList.replaceChildren(...body.providers.map(usageProvider));
    if (!body.providers.length) {
      const empty = document.createElement("p");
      empty.className = "provider-loading";
      empty.textContent = "Açık model bulunmuyor.";
      usageList.replaceChildren(empty);
    }
    usageUpdated.textContent = `${formatResetTime(body.updatedAt)} güncellendi`;
  } catch (error) {
    const message = document.createElement("p");
    message.className = "provider-error";
    message.textContent = error instanceof Error ? error.message : "Kullanım bilgisi alınamadı";
    usageList.replaceChildren(message);
    usageUpdated.textContent = "Limitler güncellenemedi";
  } finally {
    usageRefresh.disabled = false;
  }
}

function usageProvider(item) {
  const names = { openai: "ChatGPT", anthropic: "Claude", gemini: "Gemini" };
  const card = document.createElement("section");
  card.className = "usage-card";
  const heading = document.createElement("strong");
  heading.textContent = names[item.provider] || item.provider;
  card.append(heading);
  if (item.error || !item.groups.length) {
    const error = document.createElement("p");
    error.textContent = item.error || "Kota bilgisi bulunamadı";
    card.append(error);
    return card;
  }
  item.groups.flatMap((group) => group.windows).forEach((window) => {
    const row = document.createElement("div");
    row.className = "usage-window";
    const labels = document.createElement("div");
    const label = document.createElement("span");
    label.textContent = window.label;
    const percent = document.createElement("b");
    percent.textContent = `%${Math.round(window.remainingPercent)} kaldı`;
    labels.append(label, percent);
    const track = document.createElement("div");
    track.className = "usage-track";
    track.setAttribute("role", "progressbar");
    track.setAttribute("aria-label", `${heading.textContent} ${window.label} kalan kullanım`);
    track.setAttribute("aria-valuemin", "0");
    track.setAttribute("aria-valuemax", "100");
    track.setAttribute("aria-valuenow", String(window.remainingPercent));
    const fill = document.createElement("i");
    fill.style.width = `${Math.min(100, Math.max(0, window.remainingPercent))}%`;
    if (window.remainingPercent <= 20) fill.className = "low";
    track.append(fill);
    const reset = document.createElement("small");
    reset.textContent = `${formatResetTime(window.resetsAt)} sıfırlanır`;
    row.append(labels, track, reset);
    card.append(row);
  });
  return card;
}

function formatResetTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Bilinmeyen zamanda";
  return new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
}

function providerRow(item) {
  if (item.provider === "loading") {
    const loading = document.createElement("p");
    loading.className = "provider-loading";
    loading.textContent = "Modeller kontrol ediliyor…";
    return loading;
  }
  const names = { openai: "ChatGPT", anthropic: "Claude", gemini: "Gemini" };
  const row = document.createElement("div");
  row.className = "provider-row";
  const copy = document.createElement("div");
  const name = document.createElement("strong");
  name.textContent = names[item.provider] || item.provider;
  const detail = document.createElement("span");
  detail.textContent = item.available ? (item.models[0] || "CLI hazır") : "CLI bulunamadı";
  copy.append(name, detail);
  const control = document.createElement("button");
  control.type = "button";
  control.className = "switch";
  control.setAttribute("role", "switch");
  control.setAttribute("aria-label", `${name.textContent} kullanımını değiştir`);
  control.setAttribute("aria-checked", String(item.enabled));
  control.disabled = !item.available;
  control.append(document.createElement("i"));
  const status = document.createElement("span");
  status.textContent = !item.available ? "Kurulu değil" : item.enabled ? "Açık" : "Kapalı";
  control.append(status);
  control.addEventListener("click", async () => {
    control.disabled = true;
    try {
      const response = await fetch(`/providers/${item.provider}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: !item.enabled }),
      });
      if (!response.ok) throw new Error("Model durumu değiştirilemedi");
      const body = await response.json();
      providerList.replaceChildren(...body.providers.map(providerRow));
      await loadUsage();
    } catch (error) {
      detail.textContent = error instanceof Error ? error.message : "Model durumu değiştirilemedi";
      control.disabled = false;
    }
  });
  const actions = document.createElement("div");
  actions.className = "provider-actions";
  
  if (!item.available) {
    const connectBtn = document.createElement("button");
    connectBtn.type = "button";
    connectBtn.className = "connect-btn";
    connectBtn.textContent = "Bağla";
    connectBtn.addEventListener("click", () => {
      let cmd = "";
      if (item.provider === "openai") cmd = "codex login";
      else if (item.provider === "anthropic") cmd = "claude auth login";
      else if (item.provider === "gemini") cmd = "agy login";
      
      alert(`Terminalinizde şu komutu çalıştırarak ${name.textContent} hesabınızı bağlayabilirsiniz:\n\n${cmd}\n\nGiriş yaptıktan sonra sunucuyu yeniden başlatmayı unutmayın!`);
    });
    actions.append(connectBtn);
  } else {
    const disconnectBtn = document.createElement("button");
    disconnectBtn.type = "button";
    disconnectBtn.className = "disconnect-btn";
    disconnectBtn.textContent = "Bağlantıyı Kes";
    disconnectBtn.addEventListener("click", () => {
      let cmd = "";
      if (item.provider === "openai") cmd = "codex logout";
      else if (item.provider === "anthropic") cmd = "claude auth logout";
      else if (item.provider === "gemini") cmd = "agy logout";
      
      alert(`Terminalinizde şu komutu çalıştırarak ${name.textContent} bağlantınızı kesebilirsiniz:\n\n${cmd}\n\nÇıkış yaptıktan sonra sunucuyu yeniden başlatmayı unutmayın!`);
    });
    actions.append(disconnectBtn, control);
  }

  row.append(copy, actions);
  return row;
}

function resizeComposer() {
  goal.style.height = "auto";
  goal.style.height = `${Math.min(goal.scrollHeight, 190)}px`;
}

function scrollToBottom() {
  requestAnimationFrame(() => window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" }));
}
