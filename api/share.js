"use strict";

function buildShareUrl(confirmed, title) {
  const payload = {
    confirmed: confirmed,
    title: title || "오늘 먹을 약 (큰 글씨)"
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return "/share?" + encoded;
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

      const url = buildShareUrl(confirmed, title);

      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ url }));
    } catch (e) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "입력 오류" }));
    }
  });
};
