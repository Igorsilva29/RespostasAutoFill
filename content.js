// content.js — Inserção robusta multi-campo + WhatsApp + correção Gestão/Email (com suporte FCKEditor iframe)
const TRIGGER_CTRL = true;
const TRIGGER_KEY = "/";
const INSERT_RETRIES = 6;
const INSERT_RETRY_DELAY = 80;

// safeLog: desative comentando o console.log se não quiser output no console
function safeLog(...args) {
  //console.log("[QuickReplies]", ...args);
}

// --- Ajuste automático de saudação ---
function ajustarSaudacao(texto) {
  const hora = new Date().getHours();
  let saudacaoAtual = "";
  if (hora >= 5 && hora < 12) saudacaoAtual = "Bom dia";
  else if (hora >= 12 && hora < 18) saudacaoAtual = "Boa tarde";
  else saudacaoAtual = "Boa noite";
  if (typeof texto !== "string") return texto;
  return texto.replace(/\b(Bom dia|Boa tarde|Boa noite)\b/gi, saudacaoAtual);
}

// ---------------------- Helpers storage (promisified)
function getQuickRepliesFromBackground() {
  return new Promise(resolve => {
    try {
      chrome.runtime.sendMessage({ action: "getQuickReplies" }, res => resolve(res || []));
    } catch (e) {
      safeLog("getQuickRepliesFromBackground erro:", e);
      resolve([]);
    }
  });
}
function saveQuickRepliesToBackground(data) {
  return new Promise(resolve => {
    try {
      chrome.runtime.sendMessage({ action: "saveQuickReplies", data }, res => resolve(res || {}));
    } catch (e) {
      safeLog("saveQuickRepliesToBackground erro:", e);
      resolve({});
    }
  });
}

// ---------------------- Normalização (compatibilidade)
function normalizeRepliesArray(raw) {
  const out = Array.isArray(raw) ? raw.slice() : [];
  const normalized = out.map(item => {
    if (item && typeof item === "object" && (item.text || item.category)) {
      return {
        category: (item.category || "Sem categoria").toString().trim(),
        text: (item.text || "").toString()
      };
    }
    if (typeof item === "string") {
      const match = item.match(/^\[(.*?)\]\s*(.*)$/);
      if (match) {
        return { category: match[1].trim() || "Sem categoria", text: match[2] || "" };
      }
      return { category: "Sem categoria", text: item };
    }
    return { category: "Sem categoria", text: "" };
  });
  return normalized.filter(r => r && typeof r.text === "string" && r.text.trim() !== "");
}

// ---------------------- Injeção no documento
function injectScript(doc) {
  if (!doc || doc._quickRepliesInjected) return;
  doc._quickRepliesInjected = true;

  doc.addEventListener("keydown", async (event) => {
    const matchKey = event.key === TRIGGER_KEY && (!TRIGGER_CTRL || event.ctrlKey);
    if (!matchKey) return;
    try { event.preventDefault(); } catch (e) {}

    const active = doc.activeElement;
    if (!active) return;

    let replies = await getQuickRepliesFromBackground();
    if (!Array.isArray(replies)) replies = [];

    const needsNormalization = replies.some(item =>
      typeof item === "string" ||
      typeof item !== "object" ||
      item === null ||
      item.category === undefined ||
      item.text === undefined
    );

    const normalized = normalizeRepliesArray(replies);

    if (needsNormalization) {
      try {
        await saveQuickRepliesToBackground(normalized);
        safeLog("quickReplies normalizados e salvos (content.js)");
      } catch (e) {
        safeLog("erro ao salvar normalized replies:", e);
      }
      replies = normalized;
    } else {
      replies = replies.map(item => ({
        category: (item.category || "Sem categoria").toString().trim(),
        text: (item.text || "").toString()
      }));
    }

    if (!replies.length) return;

    const old = doc.getElementById("quick-replies-popup");
    if (old) old.remove();

    const popup = createPopup(doc, active, replies);
    doc.body.appendChild(popup);

    // fechar ao clicar fora (captura)
    const onDocClick = (ev) => {
      if (!popup.contains(ev.target)) {
        try { popup.remove(); } catch (e) {}
        doc.removeEventListener("click", onDocClick, true);
      }
    };
    doc.addEventListener("click", onDocClick, true);

  }, true);
}

// ====================== NOVO: cache de cores e helper para ler do storage ======================
let QUICKREPLIES_COLORS_CACHE = {};

function getCategoryColors() {
  return new Promise((resolve) => {
    try {
      chrome.storage.sync.get(["quickRepliesColors"], (res) => {
        QUICKREPLIES_COLORS_CACHE = (res && res.quickRepliesColors) || {};
        resolve(QUICKREPLIES_COLORS_CACHE);
      });
    } catch (e) {
      QUICKREPLIES_COLORS_CACHE = {};
      resolve(QUICKREPLIES_COLORS_CACHE);
    }
  });
}

// ---------------------- Criação do popup (mantendo comportamento original, mas com tag visual)
function createPopup(doc, active, replies) {
  const popup = doc.createElement("div");
  popup.id = "quick-replies-popup";
  Object.assign(popup.style, {
    position: "absolute",
    zIndex: "2147483647",
    background: "#fff",
    border: "1px solid #ccc",
    padding: "6px",
    borderRadius: "6px",
    boxShadow: "0 2px 10px rgba(0,0,0,0.2)",
    fontFamily: "sans-serif",
    fontSize: "13px",
    maxWidth: "780px",
    maxHeight: "320px",
    overflowY: "auto",
    whiteSpace: "normal"
  });

  const grouped = groupRepliesByCategory(replies);

  // pre-carrega cores e depois popula (assim usamos cores salvas no popup principal)
  getCategoryColors().then(() => {
    Object.keys(grouped).forEach(cat => {
      const catDiv = createCategoryItem(doc, popup, active, grouped, cat);
      popup.appendChild(catDiv);
    });
  }).catch(() => {
    // fallback: popula sem cores
    Object.keys(grouped).forEach(cat => {
      const catDiv = createCategoryItem(doc, popup, active, grouped, cat);
      popup.appendChild(catDiv);
    });
  });

  positionPopup(active, popup);
  return popup;
}

// recria item categoria (usado pelo voltar) — atualizado para mostrar "tag" colorida em vez do emoji
function createCategoryItem(doc, popup, active, grouped, cat) {
  const catDiv = doc.createElement("div");
  // layout semelhante a um título com ícone
  catDiv.style.padding = "6px 8px";
  catDiv.style.cursor = "pointer";
  catDiv.style.fontWeight = "bold";
  catDiv.style.color = "#333";
  catDiv.style.display = "flex";
  catDiv.style.alignItems = "center";
  catDiv.style.gap = "8px";

  // cria o "tag icon" (reproduz o .category-header::before do popup)
  const tag = doc.createElement("span");
  Object.assign(tag.style, {
    display: "inline-block",
    width: "18px",
    height: "12px",
    borderRadius: "2px",
    marginRight: "0px",
    flex: "0 0 auto",
    clipPath: "polygon(0 0, 85% 0, 100% 50%, 85% 100%, 0 100%)"
  });

  // pega cor da cache (se disponível) ou cor padrão
  const color = (QUICKREPLIES_COLORS_CACHE && QUICKREPLIES_COLORS_CACHE[cat]) || "#0078d7";
  tag.style.backgroundColor = color;

  const label = doc.createElement("span");
  label.textContent = cat;
  label.style.flex = "1";

  catDiv.appendChild(tag);
  catDiv.appendChild(label);

  catDiv.addEventListener("mouseenter", () => catDiv.style.background = "#f0f0f0");
  catDiv.addEventListener("mouseleave", () => catDiv.style.background = "transparent");

  catDiv.addEventListener("click", () => {
    popup.innerHTML = "";
    const items = grouped[cat] || [];
    if (!items.length) {
      const none = doc.createElement("div");
      none.textContent = "Nenhuma mensagem nesta categoria.";
      Object.assign(none.style, { padding: "8px", color: "#666" });
      popup.appendChild(none);
    } else {
      items.forEach(item => {
        const texto = (item && item.text) ? item.text : (typeof item === "string" ? item : JSON.stringify(item));
        const textoAjustado = ajustarSaudacao(texto);
        const opt = doc.createElement("div");
        opt.textContent = textoAjustado;
        Object.assign(opt.style, { padding: "6px 8px", cursor: "pointer", whiteSpace: "pre-wrap" });
        opt.addEventListener("mouseenter", () => opt.style.background = "#f0f0f0");
        opt.addEventListener("mouseleave", () => opt.style.background = "transparent");
        opt.addEventListener("click", async () => {
          popup.remove();

          // Se o elemento ativo for BODY (caso Gestão), tentamos identificar iframe do editor
          let target = active;
          if (active && active.tagName === "BODY") {
            const f = findFckIframe(doc);
            if (f) {
              target = f;
            } else {
              // último esforço: iframe com id 'mensagem___Frame'
              const byId = doc.querySelector('#mensagem___Frame');
              if (byId) target = byId;
            }
          }

          await removeTriggerCharacter(target);
          const ok = await tryInsertWithRetries(target, textoAjustado, INSERT_RETRIES, INSERT_RETRY_DELAY);
          if (!ok) {
            await tryInsertWithRetriesFallback(textoAjustado);
          }
        });
        popup.appendChild(opt);
      });
    }

    const backBtn = doc.createElement("div");
    backBtn.textContent = "⬅️ Voltar";
    Object.assign(backBtn.style, {
      padding: "6px 8px",
      cursor: "pointer",
      color: "#007bff",
      borderTop: "1px solid #eee",
      marginTop: "6px"
    });
    backBtn.addEventListener("click", () => {
      popup.innerHTML = "";
      Object.keys(grouped).forEach(c => popup.appendChild(createCategoryItem(doc, popup, active, grouped, c)));
    });
    popup.appendChild(backBtn);
  });
  return catDiv;
}

// ---------------------- Agrupamento compatível
function groupRepliesByCategory(replies) {
  const groups = {};
  (Array.isArray(replies) ? replies : []).forEach(item => {
    let category = "Sem categoria";
    let text = "";
    if (typeof item === "object" && item !== null) {
      category = item.category || "Sem categoria";
      text = item.text || item.message || "";
    } else if (typeof item === "string") {
      const match = item.match(/^\[(.*?)\]\s*(.*)$/);
      if (match) {
        category = match[1].trim() || "Sem categoria";
        text = match[2] || "";
      } else {
        text = item;
      }
    }
    if (!groups[category]) groups[category] = [];
    groups[category].push({ text, original: item });
  });
  return groups;
}

// ---------------------- Position popup (respeita iframe FCK quando active é BODY)
function positionPopup(active, popup) {
  try {
    let rect;
    if (active && active.tagName === "IFRAME") {
      rect = active.getBoundingClientRect();
    } else if (active && active.tagName === "BODY") {
      const f = findFckIframe(document);
      if (f) rect = f.getBoundingClientRect();
      else rect = { top: 10, left: 10, bottom: 100 };
    } else {
      rect = active.getBoundingClientRect();
    }

    const popupHeight = 200;
    const viewportHeight = window.innerHeight;

    let top = (rect.bottom || rect.top + 40) + window.scrollY + 8;
    if ((rect.bottom || 0) + popupHeight + 16 > viewportHeight) {
      top = (rect.top || 0) + window.scrollY - popupHeight - 8;
      if (top < 0) top = 10;
    }

    let left = (rect.left || 10) + window.scrollX;
    const maxLeft = window.scrollX + window.innerWidth - 260;
    if (left > maxLeft) left = maxLeft;
    if (left < 10) left = 10;

    popup.style.top = `${top}px`;
    popup.style.left = `${left}px`;
  } catch (e) {
    popup.style.left = "10px";
    popup.style.top = "10px";
  }
}

// ---------------------- Remove "/" antes da inserção (suporta iframe)
async function removeTriggerCharacter(element) {
  if (!element) return;
  try {
    // elemento é iframe (editor)
    if (element.tagName === "IFRAME" && element.contentDocument) {
      const edDoc = element.contentDocument;
      const sel = edDoc.getSelection && edDoc.getSelection();
      if (sel && sel.rangeCount) {
        const range = sel.getRangeAt(0).cloneRange();
        range.setStart(range.startContainer, Math.max(0, range.startOffset - 1));
        if (range.toString().endsWith("/")) range.deleteContents();
      } else {
        if ((edDoc.body && edDoc.body.innerText || "").endsWith("/")) {
          edDoc.body.innerText = edDoc.body.innerText.slice(0, -1);
        }
      }
      if (edDoc.body) edDoc.body.dispatchEvent(new InputEvent("input", { bubbles: true }));
      return;
    }

    if (element.isContentEditable) {
      const sel = element.ownerDocument.getSelection();
      if (sel && sel.rangeCount) {
        const range = sel.getRangeAt(0).cloneRange();
        range.setStart(range.startContainer, Math.max(0, range.startOffset - 1));
        if (range.toString().endsWith("/")) range.deleteContents();
      } else {
        if ((element.innerText || "").endsWith("/")) element.innerText = element.innerText.slice(0, -1);
      }
      element.dispatchEvent(new InputEvent("input", { bubbles: true }));
    } else if (["INPUT", "TEXTAREA"].includes(element.tagName)) {
      const pos = element.selectionStart || 0;
      if (pos > 0 && element.value[pos - 1] === "/") {
        element.value = element.value.slice(0, pos - 1) + element.value.slice(pos);
        element.setSelectionRange(pos - 1, pos - 1);
        element.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }
  } catch (err) { safeLog("removeTriggerCharacter erro:", err); }
}

// ---------------------- Inserção com retries
async function tryInsertWithRetries(element, text, retries = 5, delay = 80) {
  for (let i = 0; i < retries; i++) {
    const ok = await insertTextOnce(element, text);
    if (ok) return true;
    await sleep(delay);
  }
  return false;
}
function sleep(ms) { return new Promise(res => setTimeout(res, ms)); }

// ---------------------- Inserção de texto (suporte iframe/FCK)
async function insertTextOnce(element, text) {
  if (!element) return false;
  if (typeof text === "string") text = text.replace(/\r?\n/g, "\n");
  text = ajustarSaudacao(text);

  try {
    // caso: element é iframe (editor dentro do iframe)
    if (element && element.tagName === "IFRAME" && element.contentDocument) {
      const edDoc = element.contentDocument;
      const edWin = element.contentWindow;
      const editorBody = edDoc.body || edDoc.querySelector("body");
      if (!editorBody) return false;
      editorBody.focus();

      const sel = edWin.getSelection ? edWin.getSelection() : null;
      let range = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
      if (!range) {
        range = edDoc.createRange();
        range.selectNodeContents(editorBody);
        range.collapse(false);
      }

      const lines = text.split("\n");
      const frag = edDoc.createDocumentFragment();
      lines.forEach((line, idx) => {
        frag.appendChild(edDoc.createTextNode(line));
        if (idx < lines.length - 1) frag.appendChild(edDoc.createElement("br"));
      });
      range.insertNode(frag);
      if (sel) {
        sel.removeAllRanges();
        range.collapse(false);
        sel.addRange(range);
      }
      editorBody.dispatchEvent(new InputEvent("input", { bubbles: true }));
      return true;
    }

    const tag = element.tagName ? element.tagName.toUpperCase() : "";

    // 1) Textarea / Input
    if (tag === "TEXTAREA" || tag === "INPUT") {
      const start = element.selectionStart || element.value.length;
      const end = element.selectionEnd || start;
      element.value = element.value.slice(0, start) + text + element.value.slice(end);
      const pos = start + text.length;
      element.setSelectionRange(pos, pos);
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }

    // 2) contentEditable (WhatsApp/Email/gestão sem iframe)
    if (element.isContentEditable) {
      element.focus();
      const isWhatsApp = element.closest && element.closest('[contenteditable="true"][data-tab]');
      if (isWhatsApp) {
        try {
          const clipboardEvent = new ClipboardEvent("paste", {
            bubbles: true,
            cancelable: true,
            clipboardData: new DataTransfer()
          });
          clipboardEvent.clipboardData.setData("text/plain", text);
          element.dispatchEvent(clipboardEvent);
          return true;
        } catch (e) {
          // fallback segue
        }
      }

      const sel = element.ownerDocument.getSelection();
      let range = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
      if (!range) {
        range = element.ownerDocument.createRange();
        range.selectNodeContents(element);
        range.collapse(false);
      }

      if (
        element.innerHTML.trim() === "<br>" ||
        element.innerHTML.trim() === "" ||
        (element.innerText && element.innerText.trim() === "")
      ) {
        element.innerHTML = "";
      }

      const lines = text.split("\n");
      const frag = element.ownerDocument.createDocumentFragment();
      lines.forEach((line, idx) => {
        frag.appendChild(element.ownerDocument.createTextNode(line));
        if (idx < lines.length - 1) frag.appendChild(element.ownerDocument.createElement("br"));
      });
      range.insertNode(frag);
      sel.removeAllRanges();
      range.collapse(false);
      sel.addRange(range);
      element.dispatchEvent(new InputEvent("input", { bubbles: true }));
      return true;
    }

    // 3) fallback: procurar iframes com fckeditor / ckeditor / mensagem___Frame
    const fckFrame = findFckIframe(document);
    if (fckFrame && fckFrame.contentDocument && fckFrame.contentDocument.body) {
      const ok = await insertTextOnce(fckFrame, text);
      if (ok) return true;
    }

  } catch (err) {
    safeLog("insertTextOnce erro:", err);
  }
  return false;
}

// busca heurística por iframe de editor (id 'mensagem___Frame', src com 'fckeditor' ou nomes conhecidos)
 function findFckIframe(doc) {
  // 1) id específico
  const byId = doc.querySelector('#mensagem___Frame');
  if (byId) return byId;
  // 2) iframe com src contendo fckeditor.html
  let f = doc.querySelector('iframe[src*="fckeditor.html"]');
  if (f) return f;
  // 3) iframe cujo src contenha 'fckeditor' ou 'ckeditor'
  f = doc.querySelector('iframe[src*="fckeditor"], iframe[src*="ckeditor"]');
  if (f) return f;
  // 4) iframe com InstanceName=mensagem na querystring
  const frames = Array.from(doc.querySelectorAll('iframe'));
  for (let fr of frames) {
    try {
      if (fr.src && fr.src.indexOf('InstanceName=mensagem') !== -1) return fr;
    } catch (e) {}
  }
  return null;
} 

// fallback que tenta procurar iframes acessíveis e inserir

async function tryInsertWithRetriesFallback(text) {
  const frames = Array.from(document.querySelectorAll('iframe'));
  for (let f of frames) {
    try {
      if (!f.contentDocument) continue;
      const body = f.contentDocument.body;
      if (!body) continue;
      const ok = await tryInsertWithRetries(f, text, 1, 0);
      if (ok) return true;
    } catch (e) { /* cross origin ou inacessivel */ }
  }
  // último recurso: tentar inserir no elemento contentEditable ativo
  try {
    const el = document.activeElement && (document.activeElement.isContentEditable ? document.activeElement : null);
    if (el) {
      return await tryInsertWithRetries(el, text, 1, 0);
    }
  } catch (e) {}
  return false;
}

// ---------------------- Observa iframes
function watchIframes(root = document) {
  Array.from(root.querySelectorAll("iframe")).forEach(tryInjectIntoIframe);
  const observer = new MutationObserver(mutations => {
    mutations.forEach(m => {
      m.addedNodes && m.addedNodes.forEach(node => {
        if (node.tagName === "IFRAME") tryInjectIntoIframe(node);
      });
    });
  });
  observer.observe(root.body || root, { childList: true, subtree: true });
}

function tryInjectIntoIframe(iframe) {
  if (!iframe || iframe._quickRepliesIframeBound) return;
  iframe._quickRepliesIframeBound = true;
  const doInject = () => {
    try {
      const doc = iframe.contentDocument || iframe.contentWindow.document;
      if (doc) {
        injectScript(doc);
        const mo = new MutationObserver(() => { try { injectScript(doc); } catch(e){} });
        mo.observe(doc.body || doc, { childList: true, subtree: true });
      }
    } catch (e) { /* cross-origin possível */ }
  };
  iframe.addEventListener("load", doInject);
  setTimeout(doInject, 300);
  setTimeout(doInject, 1200);
  setTimeout(doInject, 3000);
}

// ---------------------- Inicialização
(function init() {
  try { injectScript(document); } catch(e){ safeLog("init injectScript fail", e); }
  try { watchIframes(document); } catch(e){ safeLog("watchIframes fail", e); }
  setInterval(() => {
    try { Array.from(document.querySelectorAll("iframe")).forEach(tryInjectIntoIframe); } catch(e){}
  }, 2500);
})();
