"use strict";

const { extractFirstFile } = require("./multipart-read");

const UPSTAGE_BASE = "https://api.upstage.ai";
const OCR_MODEL = "ocr";

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const PHONE_RE = /\b0\d{1,2}-\d{3,4}-\d{4}\b/g;
const COMPANY_RE = /\((?:주|사|의료재단|병원|약국|의원)\)/g;
const COMPANY_FULL_RE = /\b(?:주식회사|재단법인|사단법인)\b/gi;

function sanitizeForDraft(text) {
  if (!text) return text;
  let s = text
    .replace(PHONE_RE, "(전화번호 생략)")
    .replace(COMPANY_RE, "(개인정보 생략)")
    .replace(COMPANY_FULL_RE, "(개인정보 생략)");
  return s;
}

function extractMedDraft(text) {
  if (!text) return [];

  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const out = [];
  const seen = new Set();

  const SKIP_RE = /^(투약량|횟수|일수|먹는약|치료제|용법|용량|투여|주의|안내|복약|복용|횟수|일수|약|의약품|부작용|피해구제|무면허|아침|점심|저녁|자기 전|며칠분|일|일분|회분|알|캡슐|정|mg|g|mL|포|매|회)$/i;

  for (const raw of lines) {
    const clean = sanitizeForDraft(raw);
    if (!clean) continue;

    let name = null;

    const parenMatch = clean.match(/^([^*\s][^*]*?)\s*\(([^)]+)\)\s*_?\s*\(?:([^)]*)\)?$/);
    if (parenMatch) {
      name = parenMatch[1].trim();
      if (name && name.length >= 2 && !SKIP_RE.test(name)) {
        out.push({ name, raw: clean });
        continue;
      }
    }

    const bracketMatch = clean.match(/^\[([^\]]+)\]\s*(.+)$/);
    if (bracketMatch) {
      const rest = bracketMatch[2].trim();
      if (rest && rest.length >= 2 && !SKIP_RE.test(rest)) {
        out.push({ name: rest, raw: clean });
        continue;
      }
    }

    const stripped = clean.replace(/^[\*]+/, "").trim();
    if (stripped && stripped.length >= 2 && !SKIP_RE.test(stripped)) {
      if (!/^\d+(\s+\d+)*$/.test(stripped) && !/^\d+/.test(stripped)) {
        out.push({ name: stripped, raw: clean });
        continue;
      }
    }
  }

  const dedup = [];
  const used = new Set();
  for (const item of out) {
    const key = item.name.trim().toLowerCase();
    if (!used.has(key)) {
      used.add(key);
      dedup.push(item);
    }
  }
  return dedup.slice(0, 50);
}

function callUpstage(body, filename) {
  return new Promise((resolve, reject) => {
    const https = require("https");

    const boundary = "----WebKitFormBoundary7MA4YWxkTrZu0gW";
    const fileBuf = body;
    const fileName = filename || "photo.jpg";

    const bodyParts = [];
    bodyParts.push("--" + boundary);
    bodyParts.push(
      'Content-Disposition: form-data; name="document"; filename="' + fileName + '"'
    );
    bodyParts.push('Content-Type: image/jpeg');
    bodyParts.push("");
    bodyParts.push(fileBuf);
    bodyParts.push("--" + boundary);
    bodyParts.push('Content-Disposition: form-data; name="model"');
    bodyParts.push("");
    bodyParts.push(OCR_MODEL);
    bodyParts.push("--" + boundary + "--");
    bodyParts.push("");

    const bodyBuf = Buffer.concat(
      bodyParts.map((p) => (Buffer.isBuffer(p) ? p : Buffer.from(p || "")))
    );

    const options = {
      hostname: "api.upstage.ai",
      path: "/v1/document-digitization",
      method: "POST",
      headers: {
        "Authorization": "Bearer " + process.env.UPSTAGE_API_KEY,
        "Content-Type": "multipart/form-data; boundary=" + boundary,
        "Content-Length": bodyBuf.length
      }
    };

    const req = https.request(options, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        try {
          const parsed = JSON.parse(raw);
          resolve(parsed);
        } catch (e) {
          reject(new Error("JSON 파싱 실패: " + raw.slice(0, 300)));
        }
      });
    });

    req.on("error", (e) => reject(e));
    req.write(bodyBuf);
    req.end();
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "POST만 지원" }));
    return;
  }

  const contentType = req.headers["content-type"] || "";
  let body = [];
  req.on("data", (chunk) => {
    body.push(chunk);
  });
  req.on("end", async () => {
    try {
      const buf = Buffer.concat(body);
      const file = extractFirstFile(buf, contentType);
      if (!file) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "이미지가 없어요" }));
        return;
      }

      const apiRes = await callUpstage(file.data, "photo.jpg");
      if (!apiRes || apiRes.error) {
        res.statusCode = 502;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({
          error: apiRes?.error?.message || "Upstage OCR 호출 실패"
        }));
        return;
      }

      const pages = apiRes.pages || [];
      const text = (pages[0] && pages[0].text) || "";

      const meds = extractMedDraft(text);

      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({
        text: sanitizeForDraft(text),
        meds: meds.map((m) => ({ name: escapeHtml(m.name), raw: m.raw }))
      }));
    } catch (e) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "서버 오류" }));
    }
  });
};
