const SUPABASE_URL = "https://jkbghzsonlkwvwdkliet.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_5STMKLUvuOqEce-2ej54Vg_PV0Hc4Ny";

const SESSION_KEY = "diary-app-session-v1";
const STORAGE_KEY_PREFIX = "diary-app-data-user-";

let state = emptyState();
let currentUser = null;

const ui = {
  selectedMonth: currentMonthString(),
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

const diaryForm = document.getElementById("diary-form");
const saveDiaryBtn = document.getElementById("save-diary-btn");
const extractResult = document.getElementById("extract-result");
const dashboardMonth = document.getElementById("dashboard-month");
const stats = document.getElementById("stats");
const expenseTableBody = document.getElementById("expense-table-body");
const weightTableBody = document.getElementById("weight-table-body");
const weightChart = document.getElementById("weight-chart");
const diaryList = document.getElementById("diary-list");
const emptyTemplate = document.getElementById("empty-template");

init();

async function init() {
  setDefaultDate();
  dashboardMonth.value = ui.selectedMonth;

  registerForm.addEventListener("submit", onRegisterSubmit);
  loginForm.addEventListener("submit", onLoginSubmit);
  logoutBtn.addEventListener("click", onLogout);
  goRegisterBtn.addEventListener("click", () => switchAuthMode("register"));
  goLoginBtn.addEventListener("click", () => switchAuthMode("login"));

  diaryForm.addEventListener("submit", onDiarySubmit);
  dashboardMonth.addEventListener("change", () => {
    ui.selectedMonth = dashboardMonth.value || currentMonthString();
    renderDashboard();
  });

  await restoreSession();
  switchAuthMode("login");
  renderAppVisibility();
  renderAll();
}

function emptyState() {
  return { daily: [], expenses: [], weights: [] };
}

function setDefaultDate() {
  const dateInput = diaryForm.querySelector('input[name="date"]');
  if (!dateInput.value) {
    dateInput.value = new Date().toISOString().slice(0, 10);
  }
}

async function onDiarySubmit(event) {
  event.preventDefault();
  if (!currentUser?.id) {
    return;
  }

  const formData = new FormData(diaryForm);
  const date = String(formData.get("date") || "").trim();
  const title = String(formData.get("title") || "").trim();
  const content = String(formData.get("content") || "").trim();

  if (!date || !content) {
    setExtractMessage("请先填写日期和正文。", true);
    return;
  }

  saveDiaryBtn.disabled = true;
  setExtractMessage("正在分析你的日记，提取花费和体重...");

  let extract = null;
  try {
    extract = await extractFromDiary(title, content);
  } finally {
    saveDiaryBtn.disabled = false;
  }

  if (!extract) {
    setExtractMessage("提取失败，请稍后重试。", true);
    return;
  }

  const diaryId = crypto.randomUUID();
  const normalized = normalizeExtract(extract);

  state.daily.unshift({
    id: diaryId,
    date,
    title: title || fallbackTitle(content),
    content,
    summary: normalized.summary,
    extracted: normalized,
    createdAt: Date.now(),
  });

  for (const item of normalized.expenses) {
    state.expenses.unshift({
      id: crypto.randomUUID(),
      date,
      item: item.item,
      amount: item.amount,
      fromDiaryId: diaryId,
      createdAt: Date.now(),
    });
  }

  if (typeof normalized.weight_kg === "number" && normalized.weight_kg > 0) {
    state.weights.unshift({
      id: crypto.randomUUID(),
      date,
      weight: normalized.weight_kg,
      fromDiaryId: diaryId,
      createdAt: Date.now(),
    });
  }

  ui.selectedMonth = date.slice(0, 7);
  dashboardMonth.value = ui.selectedMonth;

  diaryForm.reset();
  setDefaultDate();

  setExtractMessage(buildExtractMessage(normalized));
  persistAndRender();
}

async function extractFromDiary(title, content) {
  try {
    const response = await fetch("/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task: "extract", title, content }),
    });

    const data = await response.json().catch(() => ({}));
    if (response.ok && data?.extracted) {
      return data.extracted;
    }
  } catch {
    // fall through to regex fallback
  }

  return extractByRegex(content);
}

function extractByRegex(content) {
  const expenses = [];
  const seen = new Set();
  const expenseRegex = /([^\n，。,；;:：]{0,12}?)(\d+(?:\.\d+)?)\s*(元|块|RMB|rmb)/g;

  for (const match of content.matchAll(expenseRegex)) {
    const rawItem = String(match[1] || "").replace(/[花费花了用了消费是：:\s]/g, "").trim();
    const item = rawItem || "日记提取花费";
    const amount = Number(match[2]);
    const key = `${item}-${amount}`;

    if (Number.isFinite(amount) && amount >= 0 && !seen.has(key)) {
      expenses.push({ item, amount: Number(amount.toFixed(2)) });
      seen.add(key);
    }
  }

  let weightKg = null;
  const weightMatch = content.match(/(\d{2,3}(?:\.\d+)?)\s*(kg|KG|公斤|斤)/);
  if (weightMatch) {
    let value = Number(weightMatch[1]);
    const unit = weightMatch[2];
    if (unit === "斤") {
      value = value / 2;
    }
    if (value > 20 && value < 300) {
      weightKg = Number(value.toFixed(1));
    }
  }

  return {
    summary: "本条使用本地规则提取。",
    expenses,
    weight_kg: weightKg,
  };
}

function normalizeExtract(raw) {
  const expenses = Array.isArray(raw?.expenses)
    ? raw.expenses
        .map((item) => ({
          item: String(item?.item || "日记提取花费").trim() || "日记提取花费",
          amount: Number(item?.amount),
        }))
        .filter((item) => Number.isFinite(item.amount) && item.amount >= 0)
        .map((item) => ({ ...item, amount: Number(item.amount.toFixed(2)) }))
    : [];

  let weightKg = null;
  const candidate = Number(raw?.weight_kg);
  if (Number.isFinite(candidate) && candidate > 20 && candidate < 300) {
    weightKg = Number(candidate.toFixed(1));
  }

  return {
    summary: String(raw?.summary || "已自动提取。"),
    expenses,
    weight_kg: weightKg,
  };
}

function buildExtractMessage(extract) {
  const lines = [];
  lines.push(`总结：${extract.summary || "无"}`);

  if (extract.expenses.length > 0) {
    const expenseText = extract.expenses.map((item) => `${item.item} ${item.amount.toFixed(2)}元`).join("，");
    lines.push(`识别到花费：${expenseText}`);
  } else {
    lines.push("识别到花费：无");
  }

  if (typeof extract.weight_kg === "number") {
    lines.push(`识别到体重：${extract.weight_kg.toFixed(1)}kg`);
  } else {
    lines.push("识别到体重：无");
  }

  return lines.join("\n");
}

function setExtractMessage(message, isError = false) {
  extractResult.textContent = message;
  extractResult.style.color = isError ? "#ff6b6b" : "#e7e9ea";
}

function persistAndRender() {
  persistStateByUser();
  renderAll();
}

function renderAll() {
  renderStats();
  renderDashboard();
  renderDiaryList();
}

function renderStats() {
  const totalExpense = state.expenses.reduce((sum, item) => sum + item.amount, 0);
  const latestWeight = sortedByDateDesc(state.weights)[0]?.weight;

  stats.innerHTML = "";
  stats.append(
    statCard("日记总数", `${state.daily.length} 条`),
    statCard("累计花费", `¥ ${totalExpense.toFixed(2)}`),
    statCard("最近体重", latestWeight ? `${latestWeight.toFixed(1)} kg` : "暂无")
  );
}

function statCard(label, value) {
  const item = document.createElement("article");
  item.className = "stat";
  item.innerHTML = `<p class="label">${label}</p><p class="value">${value}</p>`;
  return item;
}

function renderDashboard() {
  const month = ui.selectedMonth || currentMonthString();
  const expenses = sortedByDateDesc(state.expenses.filter((item) => item.date.startsWith(month)));
  const weights = sortedByDateAsc(state.weights.filter((item) => item.date.startsWith(month)));

  renderExpenseTable(expenses);
  renderWeightTable(weights);
  renderWeightChart(weights, month);
}

function renderExpenseTable(items) {
  expenseTableBody.innerHTML = "";

  if (items.length === 0) {
    const tr = document.createElement("tr");
    tr.innerHTML = '<td colspan="3" class="empty">本月没有花费记录。</td>';
    expenseTableBody.append(tr);
    return;
  }

  for (const item of items) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${formatDate(item.date)}</td><td>${escapeHtml(item.item)}</td><td>${item.amount.toFixed(2)}</td>`;
    expenseTableBody.append(tr);
  }
}

function renderWeightTable(items) {
  weightTableBody.innerHTML = "";

  if (items.length === 0) {
    const tr = document.createElement("tr");
    tr.innerHTML = '<td colspan="2" class="empty">本月没有体重记录。</td>';
    weightTableBody.append(tr);
    return;
  }

  const list = [...items].sort((a, b) => (a.date > b.date ? -1 : 1));
  for (const item of list) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${formatDate(item.date)}</td><td>${item.weight.toFixed(1)}</td>`;
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
  const height = 250;
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

    svg.append(
      createSvg("line", {
        x1: String(padding.left),
        x2: String(width - padding.right),
        y1: String(y),
        y2: String(y),
        stroke: "#2f3336",
        "stroke-width": "1",
      })
    );

    const label = createSvg("text", {
      x: "6",
      y: String(y + 4),
      fill: "#71767b",
      "font-size": "11",
    });
    label.textContent = value.toFixed(1);
    svg.append(label);
  }

  const pointsAttr = points
    .map((p) => {
      const x = mapValue(p.day, 1, monthDays, padding.left, width - padding.right);
      const y = mapValue(p.weight, minY, maxY, height - padding.bottom, padding.top);
      return `${x},${y}`;
    })
    .join(" ");

  svg.append(
    createSvg("polyline", {
      points: pointsAttr,
      fill: "none",
      stroke: "#1d9bf0",
      "stroke-width": "3",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
    })
  );

  for (const p of points) {
    const x = mapValue(p.day, 1, monthDays, padding.left, width - padding.right);
    const y = mapValue(p.weight, minY, maxY, height - padding.bottom, padding.top);

    svg.append(
      createSvg("circle", {
        cx: String(x),
        cy: String(y),
        r: "4",
        fill: "#e7e9ea",
      })
    );
  }

  svg.append(
    createSvg("line", {
      x1: String(padding.left),
      x2: String(width - padding.right),
      y1: String(height - padding.bottom),
      y2: String(height - padding.bottom),
      stroke: "#2f3336",
      "stroke-width": "1.5",
    })
  );

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

function renderDiaryList() {
  diaryList.innerHTML = "";
  const list = sortedByDateDesc(state.daily);

  if (list.length === 0) {
    const clone = emptyTemplate.content.cloneNode(true);
    diaryList.append(clone);
    return;
  }

  for (const item of list) {
    const li = document.createElement("li");
    li.className = "entry";

    const summary = item.summary ? `<p class="entry-summary">${escapeHtml(item.summary)}</p>` : "";

    const expenseChips = Array.isArray(item.extracted?.expenses)
      ? item.extracted.expenses.map((e) => `<span class="chip">${escapeHtml(e.item)} ${Number(e.amount).toFixed(2)}元</span>`).join("")
      : "";
    const weightChip = typeof item.extracted?.weight_kg === "number"
      ? `<span class="chip">体重 ${item.extracted.weight_kg.toFixed(1)}kg</span>`
      : "";

    li.innerHTML = `
      <div class="entry-top">
        <div>
          <strong>${escapeHtml(item.title || "无标题")}</strong>
          <div class="entry-date">${formatDate(item.date)}</div>
        </div>
        <button type="button" class="delete-btn" data-delete-diary-id="${item.id}">删除</button>
      </div>
      <p>${escapeHtml(item.content.slice(0, 120))}${item.content.length > 120 ? "..." : ""}</p>
      ${summary}
      <div class="chip-row">${expenseChips}${weightChip}</div>
    `;

    diaryList.append(li);
  }

  for (const btn of diaryList.querySelectorAll("[data-delete-diary-id]")) {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-delete-diary-id");
      deleteDiary(id);
    });
  }
}

function deleteDiary(diaryId) {
  state.daily = state.daily.filter((item) => item.id !== diaryId);
  state.expenses = state.expenses.filter((item) => item.fromDiaryId !== diaryId);
  state.weights = state.weights.filter((item) => item.fromDiaryId !== diaryId);
  persistAndRender();
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
    return {
      daily: Array.isArray(parsed.daily) ? parsed.daily : [],
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
