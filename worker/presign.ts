/**
 * AWS Signature V4 query-string presigning (S3 API), used to hand a platform a short-lived public
 * link to one R2 object — e.g. Instagram's cover_url, which only accepts an image by URL.
 */

const enc = new TextEncoder();
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const sha256 = async (s: string) => hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));
async function hmac(key: ArrayBuffer | Uint8Array, data: string) {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", k, enc.encode(data));
}
/** RFC 3986 encoding as S3 expects (slashes kept in paths). */
const uriEncode = (s: string, keepSlash = false) =>
  encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`).replace(keepSlash ? /%2F/g : /^$/, "/");

export async function presignGet(opts: {
  host: string;
  path: string;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
  expiresSec?: number;
  now?: Date;
}) {
  const region = opts.region ?? "auto";
  const now = opts.now ?? new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const date = amzDate.slice(0, 8);
  const scope = `${date}/${region}/s3/aws4_request`;
  const query: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${opts.accessKeyId}/${scope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(opts.expiresSec ?? 3600),
    "X-Amz-SignedHeaders": "host",
  };
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((k) => `${uriEncode(k)}=${uriEncode(query[k])}`)
    .join("&");
  const canonicalPath = uriEncode(opts.path, true);
  const canonical = ["GET", canonicalPath, canonicalQuery, `host:${opts.host}`, "", "host", "UNSIGNED-PAYLOAD"].join("\n");
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, await sha256(canonical)].join("\n");
  let key: ArrayBuffer = await hmac(enc.encode(`AWS4${opts.secretAccessKey}`), date);
  for (const part of [region, "s3", "aws4_request"]) key = await hmac(key, part);
  const signature = hex(await hmac(key, toSign));
  return `https://${opts.host}${canonicalPath}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}
