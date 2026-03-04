const SUPABASE_URL = "https://jkbghzsonlkwvwdkliet.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_5STMKLUvuOqEce-2ej54Vg_PV0Hc4Ny";

const SESSION_KEY = "diary-app-session-v1";
const STORAGE_KEY_PREFIX = "diary-app-data-user-";

let state = emptyState();
let currentUser = null;

const ui = {
  selectedPage: "daily",
  diaryMode: "write",
  selectedNotebookMonth: "",
  selectedDiaryId: "",
  selectedWeightMonth: currentMonthString(),
};

const authCard = document.getElementById("auth-card");
const appContent = document.getElementById("app-content");
const sessionBar = document.getElementById("session-bar");
const userEmail = document.getElementById("user-email");
const authMsg = document.getElementById("auth-msg");
const registerForm = document.getElementById("register-form");
const loginForm = document.getElementById("login-form");
const logoutBtn = document.getElementById("logout-btn");
const goRegisterBtn = document.getElementById("go-register-btn");
const goLoginBtn = document.getElementById("go-login-btn");
const loginPanel = document.getElementById("auth-login-panel");
const registerPanel = document.getElementById("auth-register-panel");
const aiPolishBtn = document.getElementById("ai-polish-btn");
const aiSummaryBtn = document.getElementById("ai-summary-btn");
const aiApplyBtn = document.getElementById("ai-apply-btn");
const aiOutput = document.getElementById("ai-output");

const dailyForm = document.getElementById("daily-form");
const expenseForm = document.getElementById("expense-form");
const weightForm = document.getElementById("weight-form");

const expenseList = document.getElementById("expense-list");
const stats = document.getElementById("stats");
const emptyTemplate = document.getElementById("empty-template");

const navButtons = document.querySelectorAll(".nav-btn");
const pages = document.querySelectorAll(".page");

const diaryModeButtons = document.querySelectorAll(".sub-btn");
const diaryModes = document.querySelectorAll(".diary-mode");

const notebookList = document.getElementById("notebook-list");
const readerEmpty = document.getElementById("reader-empty");
const readerBody = document.getElementById("reader-body");
const notebookEntryList = document.getElementById("notebook-entry-list");
const diaryReaderContent = document.getElementById("diary-reader-content");

const weightMonthInput = document.getElementById("weight-month");
const weightChart = document.getElementById("weight-chart");
const weightTableBody = document.getElementById("weight-table-body");

init();

async function init() {
  setDefaultDate(dailyForm);
  setDefaultDate(expenseForm);
  setDefaultDate(weightForm);
  weightMonthInput.value = ui.selectedWeightMonth;

  registerForm.addEventListener("submit", onRegisterSubmit);
  loginForm.addEventListener("submit", onLoginSubmit);
  logoutBtn.addEventListener("click", onLogout);
  goRegisterBtn.addEventListener("click", () => switchAuthMode("register"));
  goLoginBtn.addEventListener("click", () => switchAuthMode("login"));
  aiPolishBtn.addEventListener("click", () => runAiTask("polish"));
  aiSummaryBtn.addEventListener("click", () => runAiTask("summary"));
  aiApplyBtn.addEventListener("click", applyAiTextToDiary);

  dailyForm.addEventListener("submit", onDailySubmit);
  expenseForm.addEventListener("submit", onExpenseSubmit);
  weightForm.addEventListener("submit", onWeightSubmit);
  weightMonthInput.addEventListener("change", onWeightMonthChange);

  for (const btn of navButtons) {
    btn.addEventListener("click", () => switchMainPage(btn.dataset.page));
  }

  for (const btn of diaryModeButtons) {
    btn.addEventListener("click", () => switchDiaryMode(btn.dataset.diaryMode));
  }

  await restoreSession();
  switchAuthMode("login");
  renderAppVisibility();
  renderAll();
}

async function runAiTask(task) {
  const titleInput = dailyForm.querySelector('input[name="title"]');
  const contentInput = dailyForm.querySelector('textarea[name="content"]');

  const title = String(titleInput?.value || "").trim();
  const content = String(contentInput?.value || "").trim();

  if (!content) {
    setAiOutput("请先在正文里写点内容，再用 AI。", true);
    return;
  }

  setAiLoading(true);
  aiApplyBtn.classList.add("hidden");
  setAiOutput("AI 正在思考，请稍等...");

  try {
    const response = await fetch("/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task, title, content }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setAiOutput(data?.error || "AI 请求失败，请稍后再试。", true);
      return;
    }

    const text = String(data?.text || "").trim();
    if (!text) {
      setAiOutput("AI 没有返回内容，请重试。", true);
      return;
    }

    setAiOutput(text);
    aiApplyBtn.classList.remove("hidden");
  } catch {
    setAiOutput("网络异常，请检查后再试。", true);
  } finally {
    setAiLoading(false);
  }
}

function applyAiTextToDiary() {
  const contentInput = dailyForm.querySelector('textarea[name="content"]');
  const text = String(aiOutput.textContent || "").trim();
  if (!contentInput || !text || aiOutput.dataset.error === "1") {
    return;
  }
  contentInput.value = text;
  setAiOutput("已把 AI 结果替换到正文。你可以再改一下再保存。");
}

function setAiOutput(message, isError = false) {
  aiOutput.textContent = message;
  aiOutput.dataset.error = isError ? "1" : "0";
  if (isError) {
    aiApplyBtn.classList.add("hidden");
  }
}

function setAiLoading(loading) {
  aiPolishBtn.disabled = loading;
  aiSummaryBtn.disabled = loading;
}

function emptyState() {
  return { daily: [], expenses: [], weights: [] };
}

async function onRegisterSubmit(event) {
  event.preventDefault();
  const formData = new FormData(registerForm);
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "").trim();

  if (!email || password.length < 6) {
    setAuthMessage("请输入正确邮箱，密码至少 6 位。", true);
    return;
  }

  setAuthMessage("正在注册...");

  const res = await authRequest("/auth/v1/signup", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });

  if (!res.ok) {
    setAuthMessage(res.error || "注册失败，请稍后再试。", true);
    return;
  }

  registerForm.reset();

  if (!res.data?.session) {
    setAuthMessage("注册成功，请去邮箱点确认链接后再登录。");
    switchAuthMode("login");
    return;
  }

  saveSession(res.data.session);
  currentUser = res.data.user;
  state = loadStateByUser(currentUser.id);
  setAuthMessage("注册并登录成功。");
  renderAppVisibility();
  renderAll();
}

async function onLoginSubmit(event) {
  event.preventDefault();
  const formData = new FormData(loginForm);
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "").trim();

  if (!email || !password) {
    setAuthMessage("请输入邮箱和密码。", true);
    return;
  }

  setAuthMessage("正在登录...");

  const res = await authRequest("/auth/v1/token?grant_type=password", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });

  if (!res.ok) {
    setAuthMessage(res.error || "登录失败，请检查账号密码。", true);
    return;
  }

  saveSession(res.data);
  currentUser = res.data.user;
  state = loadStateByUser(currentUser.id);

  loginForm.reset();
  setAuthMessage("登录成功。");
  renderAppVisibility();
  renderAll();
}

async function onLogout() {
  const session = readSession();
  if (session?.access_token) {
    await authRequest("/auth/v1/logout", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
    });
  }

  clearSession();
  currentUser = null;
  state = emptyState();
  setAuthMessage("你已退出登录。");
  switchAuthMode("login");
  renderAppVisibility();
  renderAll();
}

async function restoreSession() {
  const session = readSession();
  if (!session?.access_token) {
    return;
  }

  const res = await authRequest("/auth/v1/user", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
    },
  });

  if (!res.ok) {
    clearSession();
    currentUser = null;
    state = emptyState();
    return;
  }

  currentUser = res.data;
  state = loadStateByUser(currentUser.id);
}

function renderAppVisibility() {
  const loggedIn = Boolean(currentUser?.id);
  authCard.classList.toggle("hidden", loggedIn);
  appContent.classList.toggle("hidden", !loggedIn);
  sessionBar.classList.toggle("hidden", !loggedIn);

  if (loggedIn) {
    userEmail.textContent = `当前账号：${currentUser.email || "未知邮箱"}`;
  } else {
    userEmail.textContent = "";
  }
}

function switchAuthMode(mode) {
  const showLogin = mode === "login";
  loginPanel.classList.toggle("active", showLogin);
  registerPanel.classList.toggle("active", !showLogin);
}

function setAuthMessage(message, isError = false) {
  authMsg.textContent = message;
  authMsg.classList.toggle("error", isError);
}

function switchMainPage(pageName) {
  ui.selectedPage = pageName;
  for (const btn of navButtons) {
    btn.classList.toggle("active", btn.dataset.page === pageName);
  }
  for (const page of pages) {
    page.classList.toggle("active", page.dataset.page === pageName);
  }
}

function switchDiaryMode(mode) {
  ui.diaryMode = mode;
  for (const btn of diaryModeButtons) {
    btn.classList.toggle("active", btn.dataset.diaryMode === mode);
  }
  for (const section of diaryModes) {
    section.classList.toggle("active", section.dataset.diaryMode === mode);
  }
}

function onWeightMonthChange() {
  ui.selectedWeightMonth = weightMonthInput.value || currentMonthString();
  renderWeightMonth();
}

function setDefaultDate(form) {
  const input = form.querySelector('input[name="date"]');
  if (!input.value) {
    input.value = new Date().toISOString().slice(0, 10);
  }
}

function onDailySubmit(event) {
  event.preventDefault();
  if (!currentUser?.id) {
    return;
  }

  const formData = new FormData(dailyForm);
  const date = String(formData.get("date") || "").trim();
  const title = String(formData.get("title") || "").trim();
  const content = String(formData.get("content") || "").trim();

  if (!date || !title || !content) {
    return;
  }

  state.daily.unshift({
    id: crypto.randomUUID(),
    date,
    title,
    content,
    createdAt: Date.now(),
  });

  dailyForm.reset();
  setDefaultDate(dailyForm);
  persistAndRender();
  switchDiaryMode("view");
}

function onExpenseSubmit(event) {
  event.preventDefault();
  if (!currentUser?.id) {
    return;
  }

  const formData = new FormData(expenseForm);
  const date = String(formData.get("date") || "").trim();
  const item = String(formData.get("item") || "").trim();
  const amount = Number(formData.get("amount"));

  if (!date || !item || !Number.isFinite(amount) || amount < 0) {
    return;
  }

  state.expenses.unshift({
    id: crypto.randomUUID(),
    date,
    item,
    amount,
    createdAt: Date.now(),
  });

  expenseForm.reset();
  setDefaultDate(expenseForm);
  persistAndRender();
}

function onWeightSubmit(event) {
  event.preventDefault();
  if (!currentUser?.id) {
    return;
  }

  const formData = new FormData(weightForm);
  const date = String(formData.get("date") || "").trim();
  const weight = Number(formData.get("weight"));

  if (!date || !Number.isFinite(weight) || weight <= 0) {
    return;
  }

  state.weights.unshift({
    id: crypto.randomUUID(),
    date,
    weight,
    createdAt: Date.now(),
  });

  ui.selectedWeightMonth = date.slice(0, 7);
  weightMonthInput.value = ui.selectedWeightMonth;

  weightForm.reset();
  setDefaultDate(weightForm);
  persistAndRender();
}

function persistAndRender() {
  persistStateByUser();
  renderAll();
}

function renderAll() {
  renderStats();
  renderExpenseList();
  renderNotebookShelf();
  renderNotebookEntries();
  renderWeightMonth();
}

function renderStats() {
  const totalExpense = state.expenses.reduce((sum, item) => sum + item.amount, 0);
  const latestWeight = sortedByDateDesc(state.weights)[0]?.weight;
  const dailyCount = state.daily.length;

  stats.innerHTML = "";
  stats.append(
    statCard("日记总数", `${dailyCount} 条`),
    statCard("总花费", `¥ ${totalExpense.toFixed(2)}`),
    statCard("最近体重", latestWeight ? `${latestWeight.toFixed(1)} kg` : "暂无")
  );
}

function statCard(label, value) {
  const item = document.createElement("article");
  item.className = "stat";
  item.innerHTML = `<p class="label">${label}</p><p class="value">${value}</p>`;
  return item;
}

function renderNotebookShelf() {
  notebookList.innerHTML = "";

  const grouped = groupDailyByMonth();
  const months = Object.keys(grouped).sort((a, b) => (a > b ? -1 : 1));

  if (months.length === 0) {
    const clone = emptyTemplate.content.cloneNode(true);
    notebookList.append(clone);
    ui.selectedNotebookMonth = "";
    ui.selectedDiaryId = "";
    return;
  }

  if (!ui.selectedNotebookMonth || !grouped[ui.selectedNotebookMonth]) {
    ui.selectedNotebookMonth = months[0];
  }

  for (const month of months) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "notebook-btn";
    btn.classList.toggle("active", month === ui.selectedNotebookMonth);
    btn.textContent = `${formatMonthLabel(month)} (${grouped[month].length} 篇)`;
    btn.addEventListener("click", () => {
      ui.selectedNotebookMonth = month;
      ui.selectedDiaryId = "";
      renderNotebookShelf();
      renderNotebookEntries();
    });
    li.append(btn);
    notebookList.append(li);
  }
}

function renderNotebookEntries() {
  notebookEntryList.innerHTML = "";
  diaryReaderContent.innerHTML = "";

  const grouped = groupDailyByMonth();
  const monthEntries = grouped[ui.selectedNotebookMonth] || [];

  if (monthEntries.length === 0) {
    readerBody.classList.add("hidden");
    readerEmpty.classList.remove("hidden");
    readerEmpty.textContent = "先在左边选一本日记本。";
    return;
  }

  const sortedEntries = sortedByDateDesc(monthEntries);

  if (!ui.selectedDiaryId || !sortedEntries.find((item) => item.id === ui.selectedDiaryId)) {
    ui.selectedDiaryId = sortedEntries[0].id;
  }

  for (const entry of sortedEntries) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "entry-item-btn";
    btn.classList.toggle("active", entry.id === ui.selectedDiaryId);
    btn.textContent = `${formatDate(entry.date)} - ${entry.title || fallbackTitle(entry.content)}`;
    btn.addEventListener("click", () => {
      ui.selectedDiaryId = entry.id;
      renderNotebookEntries();
    });
    li.append(btn);
    notebookEntryList.append(li);
  }

  const activeEntry = sortedEntries.find((item) => item.id === ui.selectedDiaryId);
  if (!activeEntry) {
    readerBody.classList.add("hidden");
    readerEmpty.classList.remove("hidden");
    readerEmpty.textContent = "没有找到这篇日记。";
    return;
  }

  readerEmpty.classList.add("hidden");
  readerBody.classList.remove("hidden");

  diaryReaderContent.innerHTML = `
    <h3 class="paper-title">${escapeHtml(activeEntry.title || fallbackTitle(activeEntry.content))}</h3>
    <p class="paper-date">${formatDate(activeEntry.date)}</p>
    <p class="paper-content">${escapeHtml(activeEntry.content)}</p>
    <button type="button" class="delete-btn" id="delete-diary-btn">删除这篇日记</button>
  `;

  const deleteBtn = document.getElementById("delete-diary-btn");
  deleteBtn.addEventListener("click", () => {
    state.daily = state.daily.filter((entry) => entry.id !== activeEntry.id);
    ui.selectedDiaryId = "";
    persistAndRender();
  });
}

function groupDailyByMonth() {
  const result = {};
  for (const entry of state.daily) {
    const month = String(entry.date || "").slice(0, 7);
    if (!month) {
      continue;
    }
    if (!result[month]) {
      result[month] = [];
    }
    result[month].push(entry);
  }
  return result;
}

function renderExpenseList() {
  renderSimpleList({
    listEl: expenseList,
    items: sortedByDateDesc(state.expenses),
    contentBuilder: (entry) =>
      `<p>${escapeHtml(entry.item)}</p><p><strong>¥ ${entry.amount.toFixed(2)}</strong></p>`,
    removeHandler: (id) => {
      state.expenses = state.expenses.filter((entry) => entry.id !== id);
      persistAndRender();
    },
  });
}

function renderSimpleList({ listEl, items, contentBuilder, removeHandler }) {
  listEl.innerHTML = "";

  if (items.length === 0) {
    const clone = emptyTemplate.content.cloneNode(true);
    listEl.append(clone);
    return;
  }

  for (const entry of items) {
    const li = document.createElement("li");
    li.className = "entry";

    const top = document.createElement("div");
    top.className = "entry-top";

    const date = document.createElement("span");
    date.className = "entry-date";
    date.textContent = formatDate(entry.date);

    const del = document.createElement("button");
    del.type = "button";
    del.className = "delete-btn";
    del.textContent = "删除";
    del.addEventListener("click", () => removeHandler(entry.id));

    top.append(date, del);
    li.append(top);

    const content = document.createElement("div");
    content.innerHTML = contentBuilder(entry);
    li.append(content);

    listEl.append(li);
  }
}

function renderWeightMonth() {
  const month = ui.selectedWeightMonth || currentMonthString();
  const monthEntries = sortedByDateAsc(
    state.weights.filter((item) => String(item.date || "").startsWith(month))
  );

  renderWeightTable(monthEntries);
  renderWeightChart(monthEntries, month);
}

function renderWeightTable(entries) {
  weightTableBody.innerHTML = "";

  if (entries.length === 0) {
    const tr = document.createElement("tr");
    tr.innerHTML = '<td colspan="3" class="empty">这个月还没有体重记录。</td>';
    weightTableBody.append(tr);
    return;
  }

  const displayEntries = [...entries].sort((a, b) => (a.date > b.date ? -1 : 1));

  for (const entry of displayEntries) {
    const tr = document.createElement("tr");

    const dateTd = document.createElement("td");
    dateTd.textContent = formatDate(entry.date);

    const weightTd = document.createElement("td");
    weightTd.textContent = entry.weight.toFixed(1);

    const actionTd = document.createElement("td");
    const del = document.createElement("button");
    del.type = "button";
    del.className = "delete-btn";
    del.textContent = "删除";
    del.addEventListener("click", () => {
      state.weights = state.weights.filter((item) => item.id !== entry.id);
      persistAndRender();
    });
    actionTd.append(del);

    tr.append(dateTd, weightTd, actionTd);
    weightTableBody.append(tr);
  }
}

function renderWeightChart(entries, month) {
  weightChart.innerHTML = "";

  if (entries.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = `${formatMonthLabel(month)} 还没有体重数据。`;
    weightChart.append(empty);
    return;
  }

  const width = 760;
  const height = 260;
  const padding = { top: 20, right: 20, bottom: 34, left: 40 };

  const svg = createSvg("svg", {
    viewBox: `0 0 ${width} ${height}`,
    width: "100%",
    height: String(height),
    role: "img",
    "aria-label": `${formatMonthLabel(month)} 体重曲线图`,
  });

  const monthDays = daysInMonth(month);
  const points = entries.map((item) => ({
    day: Number(item.date.slice(8, 10)),
    weight: item.weight,
  }));

  const minWeight = Math.min(...points.map((p) => p.weight));
  const maxWeight = Math.max(...points.map((p) => p.weight));
  const minY = minWeight - 0.5;
  const maxY = maxWeight + 0.5;
  const yRange = maxY - minY || 1;

  for (let i = 0; i <= 4; i += 1) {
    const y = padding.top + ((height - padding.top - padding.bottom) / 4) * i;
    const value = maxY - (yRange / 4) * i;

    const line = createSvg("line", {
      x1: String(padding.left),
      x2: String(width - padding.right),
      y1: String(y),
      y2: String(y),
      stroke: "#2f3336",
      "stroke-width": "1",
    });

    const label = createSvg("text", {
      x: "6",
      y: String(y + 4),
      fill: "#71767b",
      "font-size": "11",
    });
    label.textContent = value.toFixed(1);

    svg.append(line, label);
  }

  const pointsAttr = points
    .map((p) => {
      const x = mapValue(p.day, 1, monthDays, padding.left, width - padding.right);
      const y = mapValue(p.weight, minY, maxY, height - padding.bottom, padding.top);
      return `${x},${y}`;
    })
    .join(" ");

  const polyline = createSvg("polyline", {
    points: pointsAttr,
    fill: "none",
    stroke: "#1d9bf0",
    "stroke-width": "3",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
  });
  svg.append(polyline);

  for (const p of points) {
    const x = mapValue(p.day, 1, monthDays, padding.left, width - padding.right);
    const y = mapValue(p.weight, minY, maxY, height - padding.bottom, padding.top);

    const dot = createSvg("circle", {
      cx: String(x),
      cy: String(y),
      r: "4",
      fill: "#e7e9ea",
    });
    svg.append(dot);
  }

  const axis = createSvg("line", {
    x1: String(padding.left),
    x2: String(width - padding.right),
    y1: String(height - padding.bottom),
    y2: String(height - padding.bottom),
    stroke: "#2f3336",
    "stroke-width": "1.5",
  });
  svg.append(axis);

  const dayMarks = [1, Math.ceil(monthDays / 2), monthDays];
  for (const day of dayMarks) {
    const x = mapValue(day, 1, monthDays, padding.left, width - padding.right);
    const label = createSvg("text", {
      x: String(x - 6),
      y: String(height - 10),
      fill: "#71767b",
      "font-size": "11",
    });
    label.textContent = `${day}日`;
    svg.append(label);
  }

  weightChart.append(svg);
}

function createSvg(tag, attrs) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const key of Object.keys(attrs)) {
    element.setAttribute(key, attrs[key]);
  }
  return element;
}

function mapValue(value, minValue, maxValue, minTarget, maxTarget) {
  if (maxValue === minValue) {
    return (minTarget + maxTarget) / 2;
  }
  const ratio = (value - minValue) / (maxValue - minValue);
  return minTarget + ratio * (maxTarget - minTarget);
}

function daysInMonth(month) {
  const year = Number(month.slice(0, 4));
  const mon = Number(month.slice(5, 7));
  return new Date(year, mon, 0).getDate();
}

function sortedByDateDesc(arr) {
  return [...arr].sort((a, b) => {
    if (a.date === b.date) {
      return (b.createdAt || 0) - (a.createdAt || 0);
    }
    return a.date > b.date ? -1 : 1;
  });
}

function sortedByDateAsc(arr) {
  return [...arr].sort((a, b) => {
    if (a.date === b.date) {
      return (a.createdAt || 0) - (b.createdAt || 0);
    }
    return a.date > b.date ? 1 : -1;
  });
}

function formatDate(dateString) {
  const date = new Date(`${dateString}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return dateString;
  }
  return date.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function formatMonthLabel(monthString) {
  const [year, month] = monthString.split("-");
  if (!year || !month) {
    return monthString;
  }
  return `${year}年${month}月`;
}

function fallbackTitle(content) {
  return String(content || "无标题").slice(0, 12) || "无标题";
}

function currentMonthString() {
  return new Date().toISOString().slice(0, 7);
}

function escapeHtml(raw) {
  return String(raw)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getUserStorageKey(userId) {
  return `${STORAGE_KEY_PREFIX}${userId}`;
}

function loadStateByUser(userId) {
  if (!userId) {
    return emptyState();
  }

  try {
    const raw = localStorage.getItem(getUserStorageKey(userId));
    if (!raw) {
      return emptyState();
    }

    const parsed = JSON.parse(raw);
    const daily = Array.isArray(parsed.daily)
      ? parsed.daily.map((item) => ({
          ...item,
          title: item.title || fallbackTitle(item.content),
        }))
      : [];

    return {
      daily,
      expenses: Array.isArray(parsed.expenses) ? parsed.expenses : [],
      weights: Array.isArray(parsed.weights) ? parsed.weights : [],
    };
  } catch {
    return emptyState();
  }
}

function persistStateByUser() {
  if (!currentUser?.id) {
    return;
  }
  localStorage.setItem(getUserStorageKey(currentUser.id), JSON.stringify(state));
}

function readSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveSession(session) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

async function authRequest(path, options = {}) {
  try {
    const headers = {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    };

    const response = await fetch(`${SUPABASE_URL}${path}`, {
      ...options,
      headers,
    });

    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }

    if (!response.ok) {
      return {
        ok: false,
        error: data?.msg || data?.error_description || data?.error || "请求失败",
      };
    }

    return { ok: true, data };
  } catch {
    return { ok: false, error: "网络异常，请检查网络后重试。" };
  }
}
