// Deploy out/ to here.now
import { readFileSync, statSync } from "fs";
import { readdir } from "fs/promises";
import { join, relative } from "path";

const OUT_DIR = new URL("./out", import.meta.url).pathname;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".js":   "text/javascript; charset=utf-8",
  ".mjs":  "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".ico":  "image/x-icon",
  ".svg":  "image/svg+xml",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".txt":  "text/plain; charset=utf-8",
  ".map":  "application/json",
};

function mime(file) {
  const ext = file.slice(file.lastIndexOf(".")).toLowerCase();
  return MIME[ext] ?? "application/octet-stream";
}

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) files.push(...(await walk(full)));
    else files.push(full);
  }
  return files;
}

async function main() {
  // Collect files
  const allFiles = await walk(OUT_DIR);
  const files = allFiles.map((abs) => {
    const path = relative(OUT_DIR, abs);
    const size = statSync(abs).size;
    const contentType = mime(path);
    return { abs, path, size, contentType };
  });

  console.log(`Found ${files.length} files`);

  // Step 1: Create publish
  console.log("Creating publish...");
  const token = process.env.HERE_NOW_TOKEN;
  const authHeaders = token ? { "Authorization": `Bearer ${token}` } : {};

  const SLUG = "lunar-monsoon-4r2z";
  const createRes = await fetch(`https://here.now/api/v1/publish/${SLUG}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({
      files: files.map(({ path, size, contentType }) => ({ path, size, contentType })),
      viewer: { title: "ARAM: 大亂鬥 Helper", description: "ARAM augment advisor" },
    }),
  });

  if (!createRes.ok) {
    const text = await createRes.text();
    throw new Error(`Create failed ${createRes.status}: ${text}`);
  }

  const { slug, siteUrl, upload } = await createRes.json();
  console.log(`Slug: ${slug}`);
  console.log(`URL:  ${siteUrl}`);

  // Step 2: Upload files sequentially
  console.log("Uploading files...");
  for (const { path, method, url, headers } of upload.uploads) {
    const abs = files.find((f) => f.path === path)?.abs;
    if (!abs) throw new Error(`No local file for path: ${path}`);
    const body = readFileSync(abs);
    const res = await fetch(url, { method, headers, body });
    if (!res.ok) throw new Error(`Upload failed for ${path}: ${res.status}`);
    process.stdout.write(".");
  }
  console.log("\nAll files uploaded");

  // Step 3: Finalize
  console.log("Finalizing...");
  const finalRes = await fetch(upload.finalizeUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({ versionId: upload.versionId }),
  });

  if (!finalRes.ok) {
    const text = await finalRes.text();
    throw new Error(`Finalize failed ${finalRes.status}: ${text}`);
  }

  const result = await finalRes.json();
  console.log("\n✅ Deployed!");
  console.log(`🌐 ${result.siteUrl}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
