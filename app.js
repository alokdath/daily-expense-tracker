// Personal Expense Tracker - client logic
// Tracking began on this date; nothing earlier is shown or navigable.
const TRACKING_START = "2026-09-21";
const TRACKING_START_MONTH = TRACKING_START.slice(0, 7);

let state = { categories: [], recurring: [], transactions: [] };
let currentMonth = new Date();
currentMonth.setDate(1);
let editingId = null;
let chart = null;
let ytdChart = null;
let overallChart = null;

const $ = (id) => document.getElementById(id);
const fmtMoney = (n) => "₹" + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
const safeColor = (c) => (/^#[0-9a-f]{3,8}$/i.test(c || "") ? c : "#ccc");

async function api(path, method = "GET", body) {
  const opts = { method };
  if (body !== undefined) {
    opts.headers = { "Content-Type": "application/json" };
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(path, opts);
  return res.json();
}

const trackedTransactions = () => state.transactions.filter((t) => t.date >= TRACKING_START);

async function loadData() {
  state = await api("/api/data");
  applyRecurringForCurrentMonthIfNeeded();
  renderAll();
}

// Auto-generate this month's transactions for recurring items (EMI/SIP/Rent) if not already present.
function applyRecurringForCurrentMonthIfNeeded() {
  const key = monthKey(currentMonth);
  let changed = false;
  for (const r of state.recurring) {
    const exists = state.transactions.some((t) => t.recurringId === r.id && t.date.slice(0, 7) === key);
    if (!exists) {
      const day = Math.min(r.day || 1, 28);
      const date = `${key}-${String(day).padStart(2, "0")}`;
      // Only auto-add for months up to the current real month (not future months being browsed ahead)
      const today = new Date();
      const realKey = monthKey(new Date(today.getFullYear(), today.getMonth(), 1));
      if (key <= realKey) {
        state.transactions.push({
          id: Date.now().toString() + Math.random().toString(36).slice(2, 6),
          kind: "expense",
          category: r.category,
          amount: r.amount,
          date,
          note: r.note || "(auto) " + r.category,
          recurringId: r.id,
        });
        changed = true;
      }
    }
  }
  if (changed) api("/api/data", "POST", state);
}

function categoryByName(name) {
  return state.categories.find((c) => c.name === name);
}

function populateCategorySelect() {
  const sel = $("txCategory");
  sel.innerHTML = "";
  for (const c of state.categories) {
    const opt = document.createElement("option");
    opt.value = c.name;
    opt.textContent = c.name;
    sel.appendChild(opt);
  }
}

function txForMonth() {
  const key = monthKey(currentMonth);
  return trackedTransactions().filter((t) => t.date.slice(0, 7) === key);
}

function renderSummary(list) {
  let income = 0, expense = 0, emi = 0, sip = 0;
  for (const t of list) {
    const cat = categoryByName(t.category);
    const type = cat ? cat.type : "expense";
    if (t.kind === "income") income += Number(t.amount);
    else if (type === "emi") emi += Number(t.amount);
    else if (type === "sip") sip += Number(t.amount);
    else expense += Number(t.amount);
  }
  $("totalIncome").textContent = fmtMoney(income);
  $("totalExpense").textContent = fmtMoney(expense);
  $("totalEmi").textContent = fmtMoney(emi);
  $("totalSip").textContent = fmtMoney(sip);
  $("netBalance").textContent = fmtMoney(income - expense - emi - sip);
}

function categoryTotals(list) {
  const totals = {};
  for (const t of list) {
    if (t.kind === "income") continue;
    totals[t.category] = (totals[t.category] || 0) + Number(t.amount);
  }
  return totals;
}

// Renders a pie chart into canvasId, destroying any previous instance held in the
// module-level variable referenced by chartRef ({ current }).
function drawPieChart(canvasId, hintId, list, chartRef) {
  const totals = categoryTotals(list);
  const labels = Object.keys(totals);
  const data = Object.values(totals);
  const colors = labels.map((l) => (categoryByName(l) || {}).color || "#b2bec3");

  $(hintId).style.display = labels.length ? "none" : "block";
  const canvas = $(canvasId);
  canvas.style.display = labels.length ? "block" : "none";

  if (chartRef.current) chartRef.current.destroy();
  chartRef.current = null;
  if (!labels.length) return;
  chartRef.current = new Chart(canvas.getContext("2d"), {
    type: "pie",
    data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 1 }] },
    options: {
      plugins: {
        legend: { position: "bottom" },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.label}: ${fmtMoney(ctx.parsed)}`,
          },
        },
      },
    },
  });
}

function renderChart(list) {
  const ref = { current: chart };
  drawPieChart("pieChart", "chartEmptyHint", list, ref);
  chart = ref.current;
}

// Year-to-date: Jan 1 of the real current year through today (independent of month browsing).
function txYearToDate() {
  const today = new Date();
  const year = today.getFullYear();
  const todayStr = today.toISOString().slice(0, 10);
  return trackedTransactions().filter((t) => t.date.slice(0, 4) === String(year) && t.date <= todayStr);
}

function renderYtdChartIfOpen() {
  if (!$("ytdDetails").open) return;
  const ref = { current: ytdChart };
  drawPieChart("pieChartYTD", "chartYTDEmptyHint", txYearToDate(), ref);
  ytdChart = ref.current;
}

function renderOverallChartIfOpen() {
  if (!$("overallDetails").open) return;
  const ref = { current: overallChart };
  drawPieChart("pieChartOverall", "chartOverallEmptyHint", trackedTransactions(), ref);
  overallChart = ref.current;
}

function renderTable(list) {
  const body = $("txTableBody");
  body.innerHTML = "";
  const sorted = [...list].sort((a, b) => b.date.localeCompare(a.date));
  $("txEmptyHint").style.display = sorted.length ? "none" : "block";
  for (const t of sorted) {
    const cat = categoryByName(t.category);
    const tr = document.createElement("tr");
    const sign = t.kind === "income" ? "pos" : "neg";
    tr.innerHTML = `
      <td>${esc(t.date)}</td>
      <td><span class="swatch" style="background:${safeColor(cat && cat.color)}"></span>${esc(t.category)}${t.recurringId ? ' <span class="recur-badge">(recurring)</span>' : ""}</td>
      <td>${esc(t.note)}</td>
      <td class="amount-cell ${sign}">${t.kind === "income" ? "+" : "-"}${esc(fmtMoney(t.amount))}</td>
      <td>
        <button class="del-btn" data-edit="${esc(t.id)}" title="Edit">✏️</button>
        <button class="del-btn" data-del="${esc(t.id)}" title="Delete">🗑️</button>
      </td>`;
    body.appendChild(tr);
  }
  body.querySelectorAll("[data-del]").forEach((btn) => {
    btn.addEventListener("click", () => deleteTx(btn.dataset.del));
  });
  body.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () => startEdit(btn.dataset.edit));
  });
}

function renderCategoryList() {
  const ul = $("categoryList");
  ul.innerHTML = "";
  for (const c of state.categories) {
    const li = document.createElement("li");
    li.innerHTML = `<span class="cat-name"><span class="swatch" style="background:${safeColor(c.color)}"></span>${esc(c.name)}<span class="tag">${esc(c.type)}</span></span>
      <button class="remove-btn" data-cat="${esc(c.name)}">remove</button>`;
    ul.appendChild(li);
  }
  ul.querySelectorAll("[data-cat]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.categories = state.categories.filter((c) => c.name !== btn.dataset.cat);
      api("/api/data", "POST", state);
      renderAll();
    });
  });
}

function renderRecurringList() {
  const ul = $("recurringList");
  ul.innerHTML = "";
  $("recurringEmptyHint").style.display = state.recurring.length ? "none" : "block";
  for (const r of state.recurring) {
    const li = document.createElement("li");
    li.innerHTML = `<span>${esc(r.category)} — ${esc(fmtMoney(r.amount))} / month (day ${esc(r.day)})</span>
      <button class="remove-btn" data-rec="${esc(r.id)}">remove</button>`;
    ul.appendChild(li);
  }
  ul.querySelectorAll("[data-rec]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await api("/api/recurring/" + btn.dataset.rec, "DELETE");
      state.recurring = state.recurring.filter((r) => r.id !== btn.dataset.rec);
      renderAll();
    });
  });
}

function renderAll() {
  $("monthLabel").textContent = currentMonth.toLocaleString("en-IN", { month: "long", year: "numeric" });
  $("prevMonth").disabled = monthKey(currentMonth) <= TRACKING_START_MONTH;
  populateCategorySelect();
  const list = txForMonth();
  renderSummary(list);
  renderChart(list);
  renderYtdChartIfOpen();
  renderOverallChartIfOpen();
  renderTable(list);
  renderCategoryList();
  renderRecurringList();
}

async function deleteTx(id) {
  await api("/api/transaction/" + id, "DELETE");
  state.transactions = state.transactions.filter((t) => t.id !== id);
  renderAll();
}

function startEdit(id) {
  const t = state.transactions.find((x) => x.id === id);
  if (!t) return;
  editingId = id;
  $("txId").value = id;
  $("txKind").value = t.kind;
  $("txCategory").value = t.category;
  $("txAmount").value = t.amount;
  $("txDate").value = t.date;
  $("txNote").value = t.note || "";
  $("txRecurring").checked = !!t.recurringId;
  $("txRecurring").disabled = !!t.recurringId;
  $("formTitle").textContent = "Edit Transaction";
  $("txSubmitBtn").textContent = "Save";
  $("txCancelBtn").style.display = "inline-block";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function resetForm() {
  editingId = null;
  $("txForm").reset();
  $("txDate").value = new Date().toISOString().slice(0, 10);
  $("txRecurring").disabled = false;
  $("formTitle").textContent = "Add Transaction";
  $("txSubmitBtn").textContent = "Add";
  $("txCancelBtn").style.display = "none";
}

async function handleSubmit(e) {
  e.preventDefault();
  const kind = $("txKind").value;
  const category = $("txCategory").value;
  const amount = parseFloat($("txAmount").value);
  const date = $("txDate").value;
  const note = $("txNote").value;
  const makeRecurring = $("txRecurring").checked;

  if (editingId) {
    const existing = state.transactions.find((t) => t.id === editingId);
    const payload = { ...existing, kind, category, amount, date, note };
    await api("/api/transaction/" + editingId, "PUT", payload);
    const idx = state.transactions.findIndex((t) => t.id === editingId);
    state.transactions[idx] = payload;
  } else {
    const payload = { kind, category, amount, date, note };
    const res = await api("/api/transaction", "POST", payload);
    payload.id = res.id;
    if (makeRecurring && kind === "expense") {
      const rec = { id: "r" + res.id, category, amount, day: Number(date.slice(8, 10)), note };
      state.recurring.push(rec);
      payload.recurringId = rec.id;
      await api("/api/data", "POST", state);
      await api("/api/transaction/" + res.id, "PUT", payload);
    }
    state.transactions.push(payload);
  }
  resetForm();
  renderAll();
}

function addCategory() {
  const name = $("newCatName").value.trim();
  if (!name) return;
  const type = $("newCatType").value;
  const color = $("newCatColor").value;
  if (state.categories.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
    alert("Category already exists.");
    return;
  }
  state.categories.push({ name, type, color });
  api("/api/data", "POST", state);
  $("newCatName").value = "";
  renderAll();
}

function changeMonth(delta) {
  const next = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + delta, 1);
  if (monthKey(next) < TRACKING_START_MONTH) return;
  currentMonth = next;
  applyRecurringForCurrentMonthIfNeeded();
  renderAll();
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js").catch(() => {});
  });
}

window.addEventListener("DOMContentLoaded", () => {
  $("txDate").value = new Date().toISOString().slice(0, 10);
  $("txDate").min = TRACKING_START;
  $("txForm").addEventListener("submit", handleSubmit);
  $("txCancelBtn").addEventListener("click", resetForm);
  $("addCatBtn").addEventListener("click", addCategory);
  $("prevMonth").addEventListener("click", () => changeMonth(-1));
  $("nextMonth").addEventListener("click", () => changeMonth(1));
  $("ytdDetails").addEventListener("toggle", () => renderYtdChartIfOpen());
  $("overallDetails").addEventListener("toggle", () => renderOverallChartIfOpen());
  loadData();
});
