const bridge = window.AstrBotPluginView;

const summaryEl = document.getElementById("summary");
const listEl = document.getElementById("list");
const emptyEl = document.getElementById("empty");
const msgEl = document.getElementById("msg");
const enableBtn = document.getElementById("enable");
const resetBtn = document.getElementById("reset");
const closeBtn = document.getElementById("close");

let groups = [];
let closeArmed = false;
let closeArmTimer = null;
let resetArmed = false;
let resetArmTimer = null;

function applyTheme(ctx) {
  if (ctx && ctx.isDark) document.body.classList.add("dark");
}

function byId(id) {
  return groups.find((g) => g.id === id);
}

function checkedIds() {
  return Array.from(
    listEl.querySelectorAll("input[type=checkbox]:checked")
  ).map((el) => el.value);
}

function checkedSplit() {
  const ids = checkedIds();
  return {
    missing: ids.filter((id) => byId(id) && !byId(id).has_conversation),
    open: ids.filter((id) => byId(id) && byId(id).has_conversation),
  };
}

function disarmClose() {
  closeArmed = false;
  if (closeArmTimer) {
    clearTimeout(closeArmTimer);
    closeArmTimer = null;
  }
  closeBtn.classList.remove("armed");
}

function disarmReset() {
  resetArmed = false;
  if (resetArmTimer) {
    clearTimeout(resetArmTimer);
    resetArmTimer = null;
  }
  resetBtn.classList.remove("armed");
}

function disarmAll() {
  disarmClose();
  disarmReset();
}

function updateButtons() {
  const { missing, open } = checkedSplit();
  enableBtn.disabled = missing.length === 0;
  enableBtn.textContent =
    missing.length === 0
      ? "为勾选的群开启会话"
      : `为勾选的 ${missing.length} 个群开启会话`;
  resetBtn.disabled = open.length === 0;
  resetBtn.textContent = resetArmed
    ? `再点一次，确认重置这 ${open.length} 个群的会话`
    : open.length === 0
      ? "重置勾选群的会话"
      : `重置勾选的 ${open.length} 个群会话`;
  closeBtn.disabled = open.length === 0;
  closeBtn.textContent = closeArmed
    ? `再点一次，确认关闭这 ${open.length} 个群的会话`
    : open.length === 0
      ? "关闭勾选群的会话"
      : `关闭勾选的 ${open.length} 个群会话`;
}

function render() {
  disarmAll();
  listEl.replaceChildren();
  const missing = groups.filter((g) => !g.has_conversation).length;
  summaryEl.textContent = `共 ${groups.length} 个群 · 已开启会话 ${groups.length - missing} 个 · 未开启 ${missing} 个`;
  emptyEl.hidden = groups.length !== 0;

  for (const g of groups) {
    const li = document.createElement("li");
    li.className = "row" + (g.has_conversation ? " done" : "");

    const label = document.createElement("label");
    label.className = "row-main";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = g.id;
    cb.addEventListener("change", () => {
      disarmAll();
      updateButtons();
    });
    label.appendChild(cb);

    const texts = document.createElement("span");
    texts.className = "texts";
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = g.name;
    const meta = document.createElement("span");
    meta.className = "meta";
    meta.textContent =
      `群号 ${g.id}` +
      (g.member_count != null ? ` · ${g.member_count} 名成员` : "");
    texts.append(name, meta);
    label.appendChild(texts);
    li.appendChild(label);

    const badge = document.createElement("span");
    badge.className = "badge " + (g.has_conversation ? "on" : "off");
    badge.textContent = g.has_conversation ? "已开启" : "未开启";
    li.appendChild(badge);

    listEl.appendChild(li);
  }
  updateButtons();
}

async function load() {
  msgEl.textContent = "";
  summaryEl.textContent = "正在读取群列表…";
  try {
    const data = await bridge.apiGet("groups");
    groups = data.groups || [];
    render();
  } catch (e) {
    summaryEl.textContent = "读取失败";
    msgEl.textContent = e.message || String(e);
  }
}

function selectBy(pred) {
  for (const el of listEl.querySelectorAll("input[type=checkbox]")) {
    const g = byId(el.value);
    el.checked = g ? pred(g) : el.checked;
  }
  disarmAll();
  updateButtons();
}

document
  .getElementById("select-missing")
  .addEventListener("click", () => selectBy((g) => !g.has_conversation));
document
  .getElementById("select-open")
  .addEventListener("click", () => selectBy((g) => g.has_conversation));

enableBtn.addEventListener("click", async () => {
  const { missing } = checkedSplit();
  if (!missing.length) return;
  enableBtn.disabled = true;
  msgEl.textContent = "正在开启…";
  try {
    const res = await bridge.apiPost("enable", { group_ids: missing });
    const created = (res.created || []).length;
    const skipped = (res.skipped || []).length;
    const failed = (res.failed || []).length;
    msgEl.textContent =
      `已开启 ${created} 个` +
      (skipped ? `，跳过 ${skipped} 个` : "") +
      (failed ? `，失败 ${failed} 个` : "");
    await load();
  } catch (e) {
    msgEl.textContent = e.message || String(e);
    updateButtons();
  }
});

closeBtn.addEventListener("click", async () => {
  const { open } = checkedSplit();
  if (!open.length) return;
  if (!closeArmed) {
    disarmReset();
    closeArmed = true;
    closeBtn.classList.add("armed");
    updateButtons();
    closeArmTimer = setTimeout(() => {
      disarmClose();
      updateButtons();
    }, 5000);
    return;
  }
  disarmClose();
  closeBtn.disabled = true;
  msgEl.textContent = "正在关闭…";
  try {
    const res = await bridge.apiPost("disable", { group_ids: open });
    const closed = (res.closed || []).length;
    const skipped = (res.skipped || []).length;
    const failed = (res.failed || []).length;
    msgEl.textContent =
      `已关闭 ${closed} 个` +
      (skipped ? `，跳过 ${skipped} 个` : "") +
      (failed ? `，失败 ${failed} 个` : "");
    await load();
  } catch (e) {
    msgEl.textContent = e.message || String(e);
    updateButtons();
  }
});

resetBtn.addEventListener("click", async () => {
  const { open } = checkedSplit();
  if (!open.length) return;
  if (!resetArmed) {
    disarmClose();
    resetArmed = true;
    resetBtn.classList.add("armed");
    updateButtons();
    resetArmTimer = setTimeout(() => {
      disarmReset();
      updateButtons();
    }, 5000);
    return;
  }
  disarmReset();
  resetBtn.disabled = true;
  msgEl.textContent = "正在重置…";
  try {
    const res = await bridge.apiPost("reset", { group_ids: open });
    const created = (res.created || []).length;
    const skipped = (res.skipped || []).length;
    const failed = (res.failed || []).length;
    msgEl.textContent =
      `已重置 ${created} 个` +
      (skipped ? `，跳过 ${skipped} 个` : "") +
      (failed ? `，失败 ${failed} 个` : "");
    await load();
  } catch (e) {
    msgEl.textContent = e.message || String(e);
    updateButtons();
  }
});

document.getElementById("refresh").addEventListener("click", load);

const ctx = await bridge.ready();
applyTheme(ctx);
bridge.onContext(applyTheme);
await load();
