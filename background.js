// background.js — compatível com categorias e legado

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "getQuickReplies") {
    chrome.storage.sync.get(["quickReplies"], (result) => {
      const replies = result.quickReplies || [];

      // Mantém compatibilidade com versões antigas (strings simples)
      const normalized = replies.map(r =>
        typeof r === "string"
          ? { category: "Outros", text: r }
          : r
      );

      sendResponse(normalized);
    });
    return true; // canal assíncrono
  }

  if (message.action === "saveQuickReplies") {
    const newData = message.data.map(r =>
      typeof r === "string"
        ? { category: "Outros", text: r }
        : r
    );
    chrome.storage.sync.set({ quickReplies: newData }, () => {
      sendResponse({ success: true });
    });
    return true;
  }
});
