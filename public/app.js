"use strict";
// Minimal vanilla GUI for cf-maildrop. No build step.

const $ = (id) => document.getElementById(id);
const els = {
  project: $("project"),
  token: $("token"),
  load: $("load"),
  auto: $("auto"),
  clear: $("clear"),
  list: $("list"),
  view: $("view"),
  hint: $("hint"),
  status: $("status"),
};

let domain = "";
let activeId = null;
let autoTimer = null;

const lsKey = (p) => `maildrop:token:${p}`;

function setStatus(msg) {
  els.status.textContent = msg;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}

function fmtDate(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

async function api(path, opts) {
  const project = els.project.value.trim().toLowerCase();
  const token = els.token.value.trim();
  const url = `/api/v1/${encodeURIComponent(project)}/${path}`;
  const sep = url.includes("?") ? "&" : "?";
  const res = await fetch(`${url}${sep}token=${encodeURIComponent(token)}`, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function updateHint() {
  const project = els.project.value.trim().toLowerCase();
  if (project && domain) {
    els.hint.innerHTML = `Send test mail to <code>${escapeHtml(project)}-anything-dev@${escapeHtml(domain)}</code>`;
  } else {
    els.hint.innerHTML = "";
  }
}

function renderList(messages) {
  if (!messages.length) {
    els.list.innerHTML = '<p class="empty">No messages yet.</p>';
    return;
  }
  els.list.innerHTML = "";
  for (const m of messages) {
    const row = document.createElement("div");
    row.className = "row" + (m.id === activeId ? " active" : "");
    const codes = m.codes && m.codes.length
      ? `<div><span class="badge" data-code="${escapeHtml(m.codes[0])}">code: ${escapeHtml(m.codes[0])} ⧉</span></div>`
      : "";
    row.innerHTML = `
      <div class="subject">${escapeHtml(m.subject || "(no subject)")}</div>
      <div class="meta"><span class="from">${escapeHtml(m.from || "")}</span><span>${escapeHtml(fmtDate(m.receivedAt))}</span></div>
      ${codes}`;
    row.addEventListener("click", (e) => {
      if (e.target.classList.contains("badge")) {
        navigator.clipboard?.writeText(e.target.dataset.code);
        setStatus(`copied ${e.target.dataset.code}`);
        return;
      }
      openMessage(m.id);
    });
    els.list.appendChild(row);
  }
}

async function refresh() {
  const project = els.project.value.trim().toLowerCase();
  if (!project || !els.token.value.trim()) return;
  try {
    const { messages } = await api("list");
    renderList(messages);
    setStatus(`${messages.length} message(s) · ${fmtDate(new Date().toISOString())}`);
  } catch (err) {
    els.list.innerHTML = `<p class="empty">${escapeHtml(err.message)}</p>`;
    setStatus(err.message);
  }
}

async function openMessage(id) {
  activeId = id;
  document.querySelectorAll(".row").forEach((r) => r.classList.remove("active"));
  try {
    const m = await api(`message/${encodeURIComponent(id)}`);
    renderMessage(m);
    await refresh();
  } catch (err) {
    setStatus(err.message);
  }
}

function renderMessage(m) {
  const codes = (m.codes || []).map(
    (c) => `<span class="badge" data-code="${escapeHtml(c)}">${escapeHtml(c)} ⧉</span>`,
  ).join(" ");
  const headers = Object.entries(m.headers || {})
    .map(([k, v]) => `<div><b>${escapeHtml(k)}:</b> ${escapeHtml(v)}</div>`)
    .join("");
  const attachments = (m.attachmentList || []).length
    ? `<div class="attachments">📎 ${m.attachmentList
        .map((a) => `${escapeHtml(a.filename)} (${escapeHtml(a.mimeType)}, ${a.size}B)`)
        .join(", ")}<br><em>attachment bodies are not stored</em></div>`
    : "";

  els.view.innerHTML = `
    <div class="msg-head">
      <h2>${escapeHtml(m.subject || "(no subject)")}</h2>
      <dl>
        <dt>from</dt><dd>${escapeHtml(m.from || "")}</dd>
        <dt>to</dt><dd>${escapeHtml(m.to || "")}</dd>
        <dt>date</dt><dd>${escapeHtml(fmtDate(m.receivedAt))}</dd>
      </dl>
      ${codes ? `<div class="codes">${codes}</div>` : ""}
      <div class="tabs">
        ${m.hasHtml ? '<button data-tab="html">HTML</button>' : ""}
        ${m.hasText ? '<button data-tab="text">Text</button>' : ""}
        <button data-tab="headers">Headers</button>
      </div>
    </div>
    <div class="body-pane" id="bodyPane"></div>
    ${attachments}
    <div class="msg-actions"><button class="danger" id="del">Delete this message</button></div>`;

  const pane = $("bodyPane");
  const showText = () => {
    pane.innerHTML = `<pre class="text"></pre>`;
    pane.querySelector("pre").textContent = m.text || "(no text part)";
  };
  const showHtml = () => {
    pane.innerHTML = `<iframe class="html" sandbox referrerpolicy="no-referrer"></iframe>`;
    pane.querySelector("iframe").srcdoc = m.html || "";
  };
  const showHeaders = () => {
    pane.innerHTML = `<div class="headers">${headers || "(none)"}</div>`;
  };

  els.view.querySelectorAll(".tabs button").forEach((b) => {
    b.addEventListener("click", () => {
      els.view.querySelectorAll(".tabs button").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      const t = b.dataset.tab;
      if (t === "html") showHtml();
      else if (t === "text") showText();
      else showHeaders();
    });
  });
  els.view.querySelector(".badge")?.parentElement
    ?.querySelectorAll(".badge")
    .forEach((b) =>
      b.addEventListener("click", () => {
        navigator.clipboard?.writeText(b.dataset.code);
        setStatus(`copied ${b.dataset.code}`);
      }),
    );
  $("del").addEventListener("click", async () => {
    await api(`message/${encodeURIComponent(m.id)}`, { method: "DELETE" });
    els.view.innerHTML = '<p class="empty">Deleted.</p>';
    activeId = null;
    refresh();
  });

  // Default tab: HTML if present, else text.
  const first = els.view.querySelector(".tabs button");
  first?.click();
}

function setAuto(on) {
  clearInterval(autoTimer);
  autoTimer = on ? setInterval(refresh, 5000) : null;
}

async function boot() {
  try {
    const cfg = await (await fetch("/api/v1/config")).json();
    domain = cfg.domain || "";
  } catch {
    /* ignore */
  }
  updateHint();

  els.project.addEventListener("input", () => {
    const p = els.project.value.trim().toLowerCase();
    const saved = p ? localStorage.getItem(lsKey(p)) : "";
    if (saved) els.token.value = saved;
    updateHint();
  });
  els.token.addEventListener("change", () => {
    const p = els.project.value.trim().toLowerCase();
    if (p && els.token.value) localStorage.setItem(lsKey(p), els.token.value.trim());
  });
  els.load.addEventListener("click", refresh);
  els.auto.addEventListener("change", () => setAuto(els.auto.checked));
  els.clear.addEventListener("click", async () => {
    if (!confirm("Delete ALL messages for this project?")) return;
    try {
      const { removed } = await api("clear", { method: "DELETE" });
      setStatus(`cleared ${removed} message(s)`);
      els.view.innerHTML = '<p class="empty">Select a message.</p>';
      refresh();
    } catch (err) {
      setStatus(err.message);
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.target === els.project || e.target === els.token)) refresh();
  });

  // Restore last project from the URL hash (e.g. #myproject) for shareable links.
  const hashProject = decodeURIComponent(location.hash.replace(/^#/, ""));
  if (hashProject) {
    els.project.value = hashProject;
    const saved = localStorage.getItem(lsKey(hashProject.toLowerCase()));
    if (saved) els.token.value = saved;
    updateHint();
    refresh();
  }
}

boot();
