"use strict";

function escapeText(s) {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "")
    .replace(/"/g, '\\"')
    .replace(/'/g, "\\'");
}

function isoDateOnly(date) {
  const d = new Date(date);
  if (isNaN(d.getTime())) return new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return y + m + day;
}

function addDays(date, days) {
  const d = new Date(date);
  if (isNaN(d.getTime())) return d;
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
      const confirmed = Array.isArray(json.confirmed) ? json.confirmed : [];
      const title = json.title || "오늘 먹을 약 (큰 글씨)";

      // 기준일자: 오늘 (사용자 요청)
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const startDate = isoDateOnly(today);

      // 각 약별 days 수집 (사용자 요청: 각 약별로 며칠분 정보)
      const daysByMed = new Map();
      confirmed.forEach((r) => {
        if (r.days) {
          const key = r.name || "이름없음";
          daysByMed.set(key, r.days);
        }
      });

      // 대표 days: 약들의 days 중 가장 큰 숫자값, 없으면 30
      let representativeDays = 30;
      let maxNum = 0;
      daysByMed.forEach((v) => {
        const num = parseInt(String(v).replace(/[^0-9]/g, ""), 10);
        if (!isNaN(num) && num > maxNum) {
          maxNum = num;
          representativeDays = num;
        }
      });

      // TRIGGERS: 10분 전 알람 (사용자 요청), 달력 복잡 방지를 위해 1개 이벤트
      const slotTimes = {
        아침: "0800",
        점심: "1300",
        저녁: "1900",
        "자기 전": "2200"
      };

      const uid = "med-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
      const now = new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";

      // DESCRIPTION 구성: 각 약별 이름 + 시간대 + days 정보 포함
      const descLines = [];
      confirmed.forEach((r) => {
        const times = Array.isArray(r.timeslots) ? r.timeslots : [];
        const timeEntries = times.map((t) => {
          const time = slotTimes[t] || "0800";
          return t + " " + time + " " + (r.name || "약") + (r.dose ? " " + r.dose + "알" : "");
        });
        if (timeEntries.length === 0 && r.note) {
          descLines.push(escapeText(r.note));
          return;
        }
        const line = timeEntries.join(" / ") + " (" + (r.days || "") + ")";
        descLines.push(line);
      });

      const description = descLines.length
        ? descLines.join("\\n")
        : "보호자가 확인한 약 목록";

      const ics = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//medicine-schedule-largeprint//KO",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "BEGIN:VEVENT",
        "UID:" + uid,
        "DTSTAMP:" + now,
        "DTSTART;VALUE=DATE:" + startDate,
        "DTEND;VALUE=DATE:" + isoDateOnly(addDays(today, representativeDays)),
        "SUMMARY:" + escapeText(title),
        "DESCRIPTION:" + description,
        "BEGIN:VALARM",
        "ACTION:DISPLAY",
        "DESCRIPTION:약 먹을 시간이에요",
        "TRIGGER:-PT10M",
        "END:VALARM",
        "END:VEVENT",
        "END:VCALENDAR"
      ].join("\r\n") + "\r\n";

      res.statusCode = 200;
      res.setHeader("Content-Type", "text/calendar;charset=utf-8");
      res.setHeader("Content-Disposition", "attachment; filename=\"약먹는시간표.ics\"");
      res.end(ics);
    } catch (e) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      // 디버깅용: 예외 타입과 메시지 일부를 안전하게 전달
      let debugMsg = "입력 오류";
      if (e && typeof e === "object" && e.message) {
        debugMsg = e.message.substring(0, 200);
      }
      res.end(JSON.stringify({ error: debugMsg }));
    }
  });
};
