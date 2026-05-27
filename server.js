import express from "express";
import multer from "multer";
import crypto from "node:crypto";
import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = Number(process.env.PORT || 3000);
const dataDir = process.env.DATA_DIR || path.join(__dirname, "data");
const uploadsDir = path.join(dataDir, "uploads");
const projectsFile = path.join(dataDir, "projects.json");
const accessPassword = process.env.ACCESS_PASSWORD || "";
const accessSecret = process.env.ACCESS_SECRET || accessPassword || "local-dev";
const authCookieName = "manga_preview_auth";

await fs.mkdir(uploadsDir, { recursive: true });
app.set("trust proxy", 1);

const storage = multer.diskStorage({
  destination: async (_req, _file, cb) => {
    try {
      const id = currentUploadId();
      const destination = path.join(uploadsDir, id);
      await fs.mkdir(destination, { recursive: true });
      cb(null, destination);
    } catch (error) {
      cb(error);
    }
  },
  filename: (_req, file, cb) => {
    const cleanBase = path
      .basename(file.originalname)
      .replace(/[^\w.\-()\[\]\s]/g, "_")
      .replace(/\s+/g, "_");
    cb(null, cleanBase);
  }
});

let activeUploadId = "";
function currentUploadId() {
  if (!activeUploadId) {
    activeUploadId = `${Date.now()}`;
  }
  return activeUploadId;
}

const upload = multer({
  storage,
  limits: {
    files: 500,
    fileSize: 40 * 1024 * 1024
  },
  fileFilter: (_req, file, cb) => {
    const isJpeg = file.mimetype === "image/jpeg" || /\.(jpe?g)$/i.test(file.originalname);
    cb(isJpeg ? null : new Error("JPEGファイルだけをアップロードできます。"), isJpeg);
  }
});

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.get("/health", (_req, res) => {
  res.status(200).send("ok");
});
app.get("/login", showLogin);
app.post("/login", handleLogin);
app.post("/logout", (_req, res) => {
  res.setHeader("Set-Cookie", `${authCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  res.redirect("/login");
});
app.use(requirePassword);
app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(uploadsDir));

app.get("/api/projects", async (_req, res) => {
  res.json(await readProjects());
});

app.get("/api/projects/:id", async (req, res) => {
  const projects = await readProjects();
  const project = projects.find((item) => item.id === req.params.id);
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  res.json(project);
});

app.get("/api/network", (req, res) => {
  res.json({ urls: getPublicUrls(req) });
});

app.post("/api/upload", (req, res) => {
  activeUploadId = `${Date.now()}`;
  upload.array("pages")(req, res, async (error) => {
    const id = activeUploadId;
    activeUploadId = "";

    if (error) {
      res.status(400).json({ error: error.message });
      return;
    }

    const files = [...(req.files || [])].sort((a, b) =>
      a.originalname.localeCompare(b.originalname, "ja", { numeric: true, sensitivity: "base" })
    );

    if (files.length === 0) {
      res.status(400).json({ error: "JPEGファイルを選択してください。" });
      return;
    }

    const title = String(req.body.title || "").trim() || `原稿 ${new Date().toLocaleString("ja-JP")}`;
    const project = {
      id,
      title,
      createdAt: new Date().toISOString(),
      pageCount: files.length,
      pages: files.map((file, index) => ({
        index,
        name: file.originalname,
        url: `/uploads/${id}/${encodeURIComponent(file.filename)}`
      }))
    };

    const projects = await readProjects();
    projects.unshift(project);
    await writeProjects(projects);
    res.json(project);
  });
});

async function readProjects() {
  try {
    return JSON.parse(await fs.readFile(projectsFile, "utf8"));
  } catch {
    return [];
  }
}

async function writeProjects(projects) {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(projectsFile, JSON.stringify(projects, null, 2));
}

function getLocalUrls() {
  const urls = [`http://localhost:${port}`];
  const interfaces = os.networkInterfaces();
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries || []) {
      if (entry.family === "IPv4" && !entry.internal) {
        urls.push(`http://${entry.address}:${port}`);
      }
    }
  }
  return urls;
}

function getPublicUrls(req) {
  const host = req.get("host");
  if (host && (process.env.NODE_ENV === "production" || process.env.RENDER)) {
    const protocol = req.get("x-forwarded-proto") || req.protocol || "https";
    return [`${protocol}://${host}`];
  }
  return getLocalUrls();
}

app.listen(port, "0.0.0.0", () => {
  console.log(`Manga Previewer is running:`);
  for (const url of getLocalUrls()) {
    console.log(`  ${url}`);
  }
  console.log(accessPassword ? "Password protection is enabled." : "Password protection is disabled.");
});

function requirePassword(req, res, next) {
  if (!accessPassword || hasValidAuthCookie(req)) {
    next();
    return;
  }

  if (req.path.startsWith("/api/")) {
    res.status(401).json({ error: "Password required" });
    return;
  }

  res.redirect(`/login?next=${encodeURIComponent(req.originalUrl || "/")}`);
}

function handleLogin(req, res) {
  const submittedPassword = String(req.body.password || "");
  const nextPath = safeNextPath(req.body.next);

  if (!accessPassword || timingSafeEqual(submittedPassword, accessPassword)) {
    res.setHeader("Set-Cookie", `${authCookieName}=${authToken()}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secureCookieSuffix()}`);
    res.redirect(nextPath);
    return;
  }

  res.status(401).send(loginHtml(nextPath, true));
}

function showLogin(req, res) {
  res.send(loginHtml(safeNextPath(req.query.next), false));
}

function hasValidAuthCookie(req) {
  const cookies = Object.fromEntries(
    String(req.headers.cookie || "")
      .split(";")
      .map((part) => part.trim().split("="))
      .filter(([key, value]) => key && value)
  );
  return timingSafeEqual(cookies[authCookieName] || "", authToken());
}

function authToken() {
  return crypto.createHmac("sha256", accessSecret).update(accessPassword).digest("hex");
}

function timingSafeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function safeNextPath(value) {
  const nextPath = String(value || "/");
  return nextPath.startsWith("/") && !nextPath.startsWith("//") ? nextPath : "/";
}

function secureCookieSuffix() {
  return process.env.NODE_ENV === "production" ? "; Secure" : "";
}

function loginHtml(nextPath, hasError) {
  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Manga Previewer Login</title>
    <style>
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #111111;
        color: #191816;
        font-family: "Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
      }
      main {
        width: min(420px, calc(100vw - 32px));
        background: #f7f5ef;
        border-radius: 8px;
        padding: 28px;
      }
      h1 { margin: 0 0 8px; font-size: 28px; letter-spacing: 0; }
      p { margin: 0 0 22px; color: #716d66; }
      label { display: block; margin-bottom: 8px; font-weight: 700; }
      input {
        width: 100%;
        min-height: 46px;
        border: 1px solid #ddd7cb;
        border-radius: 8px;
        padding: 10px 12px;
        font: inherit;
      }
      button {
        width: 100%;
        min-height: 48px;
        margin-top: 14px;
        border: 0;
        border-radius: 8px;
        background: #0f8b8d;
        color: #ffffff;
        font: inherit;
        font-weight: 800;
        cursor: pointer;
      }
      .error { color: #a22; font-weight: 700; }
    </style>
  </head>
  <body>
    <main>
      <h1>Manga Previewer</h1>
      <p>共有パスワードを入力してください。</p>
      ${hasError ? '<p class="error">パスワードが違います。</p>' : ""}
      <form method="post" action="/login">
        <input type="hidden" name="next" value="${escapeHtml(nextPath)}" />
        <label for="password">パスワード</label>
        <input id="password" name="password" type="password" autocomplete="current-password" autofocus />
        <button type="submit">開く</button>
      </form>
    </main>
  </body>
</html>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    const replacements = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    };
    return replacements[char];
  });
}
