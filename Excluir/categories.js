/* // categories.js
function groupRepliesByCategory(replies) {
  const grouped = {};
  replies.forEach(reply => {
    let cat = "Sem categoria";
    let text = reply;

    if (typeof reply === "object" && reply.text) {
      cat = reply.category || "Sem categoria";
      text = reply.text;
    }

    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(text);
  });

  return grouped;
}

// Detecta automaticamente o turno (mantém o recurso anterior)
function adjustGreeting(text) {
  const hour = new Date().getHours();
  let greeting = "Bom dia";
  if (hour >= 12 && hour < 18) greeting = "Boa tarde";
  else if (hour >= 18 || hour < 4) greeting = "Boa noite";
  return text.replace(/\bBom dia\b/gi, greeting);
}

if (typeof window !== "undefined") {
  window.groupRepliesByCategory = groupRepliesByCategory;
  window.adjustGreeting = adjustGreeting;
}
 */