"use strict";

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildIcs(confirmed, title, startDate, daysCount) {
  const now = new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const uid = "med-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);

  const slotTimes = {
    아침: "0800",
    점심: "1300",
    저녁: "1900",
    "자기 전": "2200"
  };

  let ics = "";
  ics += "BEGIN:VCALENDAR\r\n";
  ics += "VERSION:2.0\r\n";
  ics += "PRODID:-//medicine-schedule-largeprint//KO\r\n";
  ics += "CALSCALE:GREGORIAN\r\n";
  ics += "METHOD:PUBLISH\r\n";
  ics += "BEGIN:VEVENT\r\n";
  ics += "UID:" + uid + "\r\n";
  ics += "DTSTAMP:" + now + "\r\n";
  ics += "DTSTART;VALUE=DATE:" + isoDateOnly(startDate) + "\r\n";
  ics += "DTEND;VALUE=DATE:" + isoDateOnly(addDays(startDate, daysCount)) + "\r\n";
  ics += "SUMMARY:" + escapeHtml(title) + "\r\n";
  ics += "DESCRIPTION:" + escapeHtml(
    confirmed.map((r) => {
      const times = r.timeslots || [];
      return times.map((t) => {
        const time = slotTimes[t] || "0800";
        return t + " " + time + " " + r.name + (r.dose ? " " + r.dose + "알" : "");
      }).join("\\n");
    }).join("\\n") ||
    "보호자가 확인한 약 목록"
  ) + "\r\n";
  ics += "BEGIN:VALARM\r\n";
  ics += "ACTION:DISPLAY\r\n";
  ics += "DESCRIPTION:약 먹을 시간이에요\r\n";
  ics += "TRIGGER:-PT30M\r\n";
  ics += "END:VALARM\r\n";
  ics += "END:VEVENT\r\n";
  ics += "END:VCALENDAR\r\n";
  return ics;
}

function isoDateOnly(date) {
  const d = new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return y + m + day;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
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
      const startDate = json.startDate || new Date().toISOString();
      const daysCount = json.daysCount || 30;

      const ics = buildIcs(confirmed, title, startDate, daysCount);

      res.statusCode = 200;
      res.setHeader("Content-Type", "text/calendar;charset=utf-8");
      res.setHeader("Content-Disposition", "attachment; filename=\"약먹는시간표.ics\"");
      res.end(ics);
    } catch (e) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "입력 오류" }));
    }
  });
};
