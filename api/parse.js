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

// 환자 이름, 주소 개인정보 패턴 (PRD 완전 준수 보강)
const PATIENT_HONOR_RE = /(?:환자|귀하|고객|회원|보호자|어르신)\s*[가-힣]{2,4}/g;
const PATIENT_PAREN_RE = /\([가-힣]{2,4}\)(?:\s*님)?/g;
const ADDRESS_ROAD_RE = /[가-힣]+로\s+[0-9]+(?:길\s+[0-9]+)?/g;
const ADDRESS_JIBEON_RE = /[가-힣]+동\s+[0-9]+(?:-[0-9]+)?\s*번지/g;
const ADDRESS_DETAIL_RE = /[가-힣]+로\s+[0-9]+(?:-[0-9]+)?/g;

function sanitizeForDraft(text) {
  if (!text) return text;
  let s = text
    .replace(PHONE_RE, "(전화번호 생략)")
    .replace(COMPANY_RE, "(개인정보 생략)")
    .replace(COMPANY_FULL_RE, "(개인정보 생략)")
    .replace(PATIENT_HONOR_RE, "(환자명 생략)")
    .replace(PATIENT_PAREN_RE, "(환자명 생략)")
    .replace(ADDRESS_ROAD_RE, "(주소 생략)")
    .replace(ADDRESS_JIBEON_RE, "(주소 생략)")
    .replace(ADDRESS_DETAIL_RE, "(주소 생략)");
  return s;
}

function extractMedDraft(text) {
  if (!text) return [];

  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const out = [];
  const seen = new Set();

  const PHONE_IN_PAREN_RE = /\(\d{2,3}-\d{3,4}-\d{4}\)/;
  const PHONE_LINE_RE = /^\(?\d{2,3}-\d{3,4}-\d{4}\)?$/;
  const PHONE_START_RE = /^\(\d{2,3}-\d{3,4}-\d{4}\)\s*$/;

  const INGREDIENT_ONLY_RE = /^[A-Za-z가-힣]+(\s+\d+(\.\d+)?\s*(mg|g|mL|mcg|μg|mg\/kg)?)\s*$/i;

  // 라벨/머리말 키워드 (라인 일부에 포함되면 제외)
  const LABEL_RE = /(투약량|횟수|일수|먹는약|치료제|용법|용량|투여|안내|복약|복용|부작용|피해구제|무면허|약품이미지|복약안내|복약만료일|비급여|본|취급|제조|판매|가격|아침|점심|저녁|자기 전|며칠분|일분|회분)/i;

  const FORM_RE = /\b(정|캡슐|주사|시럽|산|과립|현탁|액|크림|연고|패취|트로키|츄어블|서방|속방|장용|필름|코팅|마그네슘|칼슘|나트륨|수화물|베실산염|염산염|황산염|아세트산|푸마르산|말레산|구연산|젖산)\b/i;

  for (const raw of lines) {
    const clean = sanitizeForDraft(raw);
    if (!clean) continue;

    let work = clean.replace(/^\*/, "").trim();
    if (!work) continue;

    // 1) 라인 전체가 전화번호면 제외
    if (PHONE_LINE_RE.test(work)) continue;
    // 2) 라인 앞이 전화번호 괄호면 제외
    if (PHONE_START_RE.test(work)) continue;
    // 3) (전화번호 생략) 단독 라인 제외
    if (/^\(전화번호 생략\)\s*$/.test(work)) continue;
    // 4) (개인정보 생략)로 시작하는 라인 제외
    if (/^\(개인정보 생략\)/.test(work)) continue;

    // 6) 대괄호 시작 라인은 제외 (약 이름 아님)
    if (/^\[.*\]/.test(work)) continue;

    let name = null;

    // (가) 약 이름 후보: 이름(성분)_(규격) — 제일 강한 패턴
    const strongParenRe = /^([^\s(]+)\s*\(([^)]+)\)\s*_\s*\(([^)]+)\)\s*(.*)$/i;
    const sm = strongParenRe.exec(work);
    if (sm) {
      name = sm[1].trim();
      if (name && name.length >= 2 && !LABEL_RE.test(name) && !/제약$/.test(name) && PHONE_IN_PAREN_RE.test("(" + sm[2] + ")") === false) {
        out.push({ name, raw: clean });
        continue;
      }
    }

    // (나) 일반 괄호 패턴: 이름(성분) — 단, 전화번호/설명문 제외
    const weakParenRe = /^([^\s(]+)\s*\(([^)]+)\)\s*(.*)$/;
    const wp = weakParenRe.exec(work);
    if (wp) {
      const before = wp[1].trim();
      const parenContent = wp[2];
      const after = wp[3].trim();
      if (PHONE_IN_PAREN_RE.test("(" + parenContent + ")")) continue;
      if (parenContent.length > 12 && !FORM_RE.test(parenContent) && !/\d/.test(parenContent)) continue;
      if (/^\[.*\]/.test(after)) continue;
      name = before;
      if (name && name.length >= 2 && !LABEL_RE.test(name) && !/제약$/.test(name)) {
        out.push({ name, raw: clean });
        continue;
      }
    }

    // (라) 약 이름 후보: 제형명 + 숫자/단위 포함, 길이 제한
    if (FORM_RE.test(work) && /\d/.test(work) && !LABEL_RE.test(work) && work.length >= 3 && work.length <= 30) {
      name = work;
      out.push({ name, raw: clean });
      continue;
    }

    // (마) 일반 라인 필터
    if (work.length < 3) continue;
    if (/^\d/.test(work)) continue;
    if (INGREDIENT_ONLY_RE.test(work)) continue;
    // 설명문이 너무 긴 라인(>50자)은 약 이름 후보에서 제외
    if (work.length > 50 && !FORM_RE.test(work)) continue;

    // (바) 남은 라인 중 약 이름 후보 (길이 제한)
    if (work.length <= 30 && FORM_RE.test(work) && /\d/.test(work) && !LABEL_RE.test(work)) {
      name = work;
      out.push({ name, raw: clean });
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
  return dedup.slice(0, 20);
}

function callUpstage(body, filename) {
  return new Promise((resolve, reject) => {
    const https = require("https");

    const boundary = "----WebKitFormBoundary7MA4YWxkTrZu0gW";
    const fileBuf = body;
    const fileName = filename || "photo.jpg";

    const lines = [
      "--" + boundary,
      'Content-Disposition: form-data; name="document"; filename="' + fileName + '"',
      "Content-Type: image/jpeg",
      "",
      "",
      "--" + boundary,
      'Content-Disposition: form-data; name="model"',
      "",
      OCR_MODEL,
      "--" + boundary + "--",
      ""
    ];

    const fileLineIndex = 4;
    const bodyBuf = Buffer.concat(
      lines.map((line, index) => {
        if (index === fileLineIndex) {
          return Buffer.concat([Buffer.from(line + "\r\n"), fileBuf, Buffer.from("\r\n")]);
        }
        return Buffer.from(line + "\r\n");
      })
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
        version: 2,
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
