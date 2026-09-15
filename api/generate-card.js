"use strict";

function buildCardHtml(confirmed, title) {
  const slots = { 아침: [], 점심: [], 저녁: [], "자기 전": [] };
  const others = [];

  confirmed.forEach((r) => {
    const times = r.timeslots || [];
    if (!times.length) {
      if (r.note) others.push({ name: r.name, note: r.note, dose: r.dose, when: r.when });
      return;
    }
    times.forEach((t) => {
      if (slots[t]) slots[t].push(r);
    });
  });

  let html = "";
  html +=
    '<div style="font-family: Helvetica, Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 16px; color: #111;">';
  html +=
    '<h1 style="font-size: 26px; margin: 0 0 12px; border-bottom: 3px solid #111; padding-bottom: 8px;">' +
    escapeHtml(title) +
    "</h1>";

  html +=
    '<div style="margin-top: 16px;"><h2 style="font-size: 22px; margin: 0 0 8px;">아침</h2>';
  slots["아침"].forEach((r) => {
    html +=
      '<div style="font-size: 22px; padding: 8px 0; border-bottom: 1px solid #cfcfcf; margin-top: 6px;">' +
      escapeHtml(r.name) +
      (r.dose ? " / " + escapeHtml(r.dose) + "알" : "") +
      (r.when ? " / " + escapeHtml(r.when) : "") +
      "</div>";
  });
  if (!slots["아침"].length) html +=
    '<div style="font-size: 20px; color: #777; margin-top: 8px;">없음</div>';
  html += "</div>";

  html +=
    '<div style="margin-top: 16px;"><h2 style="font-size: 22px; margin: 0 0 8px;">점심</h2>';
  slots["점심"].forEach((r) => {
    html +=
      '<div style="font-size: 22px; padding: 8px 0; border-bottom: 1px solid #cfcfcf; margin-top: 6px;">' +
      escapeHtml(r.name) +
      (r.dose ? " / " + escapeHtml(r.dose) + "알" : "") +
      (r.when ? " / " + escapeHtml(r.when) : "") +
      "</div>";
  });
  if (!slots["점심"].length) html +=
    '<div style="font-size: 20px; color: #777; margin-top: 8px;">없음</div>';
  html += "</div>";

  html +=
    '<div style="margin-top: 16px;"><h2 style="font-size: 22px; margin: 0 0 8px;">저녁</h2>';
  slots["저녁"].forEach((r) => {
    html +=
      '<div style="font-size: 22px; padding: 8px 0; border-bottom: 1px solid #cfcfcf; margin-top: 6px;">' +
      escapeHtml(r.name) +
      (r.dose ? " / " + escapeHtml(r.dose) + "알" : "") +
      (r.when ? " / " + escapeHtml(r.when) : "") +
      "</div>";
  });
  if (!slots["저녁"].length) html +=
    '<div style="font-size: 20px; color: #777; margin-top: 8px;">없음</div>';
  html += "</div>";

  html +=
    '<div style="margin-top: 16px;"><h2 style="font-size: 22px; margin: 0 0 8px;">자기 전</h2>';
  slots["자기 전"].forEach((r) => {
    html +=
      '<div style="font-size: 22px; padding: 8px 0; border-bottom: 1px solid #cfcfcf; margin-top: 6px;">' +
      escapeHtml(r.name) +
      (r.dose ? " / " + escapeHtml(r.dose) + "알" : "") +
      (r.when ? " / " + escapeHtml(r.when) : "") +
      "</div>";
  });
  if (!slots["자기 전"].length) html +=
    '<div style="font-size: 20px; color: #777; margin-top: 8px;">없음</div>';
  html += "</div>";

  html +=
    '<div style="margin-top: 16px;"><h2 style="font-size: 22px; margin: 0 0 8px;">확인 메모 / 약사님께 확인할 것</h2>';
  others.forEach((o) => {
    html +=
      '<div style="font-size: 20px; padding: 8px 0; border-bottom: 1px solid #cfcfcf; margin-top: 6px;">' +
      escapeHtml(o.name) +
      (o.dose ? " / " + escapeHtml(o.dose) + "알" : "") +
      (o.when ? " / " + escapeHtml(o.when) : "") +
      (o.note ? " / " + escapeHtml(o.note) : "") +
      "</div>";
  });
  if (!others.length) html +=
    '<div style="font-size: 20px; color: #777; margin-top: 8px;">없음</div>';
  html += "</div>";

  html +=
    '<div style="margin-top: 16px;"><h2 style="font-size: 22px; margin: 0 0 8px;">며칠분</h2>';
  const daysSet = new Set();
  confirmed.forEach((r) => {
    if (r.days) daysSet.add(r.name + " / " + r.days);
  });
  if (daysSet.size) {
    daysSet.forEach((d) => {
      html +=
        '<div style="font-size: 20px; padding: 8px 0; border-bottom: 1px solid #cfcfcf; margin-top: 6px;">' +
        escapeHtml(d.split(" / ")[0]) +
        " / " +
        escapeHtml(d.split(" / ").slice(1).join(" / ")) +
        "</div>";
    });
  } else {
    html +=
      '<div style="font-size: 20px; color: #777; margin-top: 8px;">없음</div>';
  }
  html += "</div>";

  html += "</div>";
  return html;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "POST만 지원" }));
    return;
  }

  let body = [];
  req.on("data", (chunk) => body.push(chunk));
  req.on("end", () => {
    try {
      const json = JSON.parse(Buffer.concat(body).toString("utf8"));
      const confirmed = json.confirmed || [];
      const title = json.title || "오늘 먹을 약 (큰 글씨)";
      const html = buildCardHtml(confirmed, title);

      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ html }));
    } catch (e) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "입력 오류" }));
    }
  });
};
