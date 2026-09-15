"use strict";

function getMultipartBoundary(contentType) {
  if (!contentType) return null;
  const m = contentType.match(/boundary=([^;]+)/);
  return m ? m[1] : null;
}

function decodeBoundary(boundary) {
  if (boundary.startsWith('"') && boundary.endsWith('"')) {
    return boundary.slice(1, -1);
  }
  return boundary;
}

function parseMultipart(body, boundary) {
  const b = Buffer.from(boundary);
  const prefix = Buffer.concat([b, Buffer.from("\r\n")]);
  const start = body.indexOf(prefix);
  if (start === -1) return null;

  let pos = start + prefix.length;
  const headerEnd = body.indexOf(Buffer.from("\r\n\r\n"), pos);
  if (headerEnd === -1) return null;

  const headerRaw = body.slice(pos, headerEnd).toString("latin1");
  const headers = {};
  headerRaw.split("\r\n").forEach((line) => {
    const idx = line.indexOf(":");
    if (idx !== -1) {
      headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
    }
  });

  pos = headerEnd + 4;
  const footer = Buffer.concat([b, Buffer.from("--")]);
  const end = body.indexOf(footer, pos);
  if (end === -1) return null;

  const fileBuf = body.slice(pos, end);
  return {
    headers,
    data: fileBuf
  };
}

function extractFirstFile(body, contentType) {
  const rawBoundary = getMultipartBoundary(contentType);
  if (!rawBoundary) return null;
  const boundary = decodeBoundary(rawBoundary);
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  return parseMultipart(buf, boundary);
}

module.exports = { extractFirstFile };
