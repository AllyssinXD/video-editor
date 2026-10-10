import { app, BrowserWindow, dialog, ipcMain, net, protocol } from "electron";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { basename, extname, join } from "node:path";
import { pathToFileURL } from "node:url";

const PROJECT_ROOT = "E:\\video-project";
const ASSETS_DIR = join(PROJECT_ROOT, "assets");
const PROJECT_FILE = join(PROJECT_ROOT, "project.json");

protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true,
      corsEnabled: true,
    },
  },
]);

function handleAppProtocol(): void {
  protocol.handle("app", async (request) => {
    const { host, pathname } = new URL(request.url);
    if (host !== "assets") {
      return new Response("Not found", { status: 404 });
    }
    const rel = decodeURIComponent(pathname).replace(/^\/+/, "");
    const filePath = join(ASSETS_DIR, rel);
    if (filePath !== ASSETS_DIR && !filePath.startsWith(ASSETS_DIR + "\\")) {
      return new Response("Forbidden", { status: 403 });
    }
    if (!existsSync(filePath)) {
      return new Response("Not found", { status: 404 });
    }
    return net.fetch(pathToFileURL(filePath).toString(), {
      method: request.method,
      headers: request.headers,
      bypassCustomProtocolHandlers: true,
    });
  });
}

const AUDIO_EXTENSIONS = new Set(["mp3", "wav", "m4a", "aac", "ogg", "flac", "opus"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "m4v", "webm", "mkv", "avi"]);

function toAppUrl(filePath: string): string {
  return `app://assets/${encodeURIComponent(basename(filePath))}`;
}

interface ImportedFile {
  path: string;
  url: string;
  appUrl: string;
  name: string;
  kind: "video" | "audio";
}

interface StoredMedia {
  id: string;
  name: string;
  path: string;
  duration: number;
  kind: "video" | "audio";
}

interface ProjectPayload {
  media: StoredMedia[];
  sequence: unknown;
}

interface LoadedMedia extends StoredMedia {
  url: string;
  appUrl: string;
  missing: boolean;
}

interface LoadedProject {
  media: LoadedMedia[];
  sequence: unknown;
  scanned: boolean;
}

const MEDIA_EXTENSIONS = new Set([...VIDEO_EXTENSIONS, ...AUDIO_EXTENSIONS]);

async function scanAssets(): Promise<LoadedMedia[]> {
  if (!existsSync(ASSETS_DIR)) return [];
  const entries = await readdir(ASSETS_DIR, { withFileTypes: true });
  const out: LoadedMedia[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = extname(entry.name).slice(1).toLowerCase();
    if (!MEDIA_EXTENSIONS.has(ext)) continue;
    const filePath = join(ASSETS_DIR, entry.name);
    out.push({
      id: randomUUID(),
      name: entry.name,
      path: filePath,
      duration: 0,
      kind: kindOf(filePath),
      url: pathToFileURL(filePath).href,
      appUrl: toAppUrl(filePath),
      missing: false,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

async function ensureProject(): Promise<void> {
  await mkdir(ASSETS_DIR, { recursive: true });
}

async function importIntoAssets(filePath: string): Promise<string> {
  const size = (await stat(filePath)).size;
  const base = basename(filePath);
  const ext = extname(base);
  const stem = base.slice(0, base.length - ext.length);
  let candidate = join(ASSETS_DIR, base);

  for (let i = 1; ; i++) {
    if (existsSync(candidate)) {
      try {
        if ((await stat(candidate)).size === size) return candidate;
      } catch {
        /* ignore and try next */
      }
      candidate = join(ASSETS_DIR, `${stem}-${i}${ext}`);
    } else {
      await copyFile(filePath, candidate);
      return candidate;
    }
  }
}

function kindOf(filePath: string): "video" | "audio" {
  const ext = extname(filePath).slice(1).toLowerCase();
  return AUDIO_EXTENSIONS.has(ext) ? "audio" : "video";
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#0d0f13",
    title: "Video Editor",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

ipcMain.handle("media:import", async (): Promise<ImportedFile[]> => {
  const result = await dialog.showOpenDialog({
    title: "Importar mídia",
    buttonLabel: "Importar",
    properties: ["openFile", "multiSelections"],
    filters: [
      {
        name: "Mídia",
        extensions: ["mp4", "mov", "m4v", "webm", "mp3", "wav", "m4a", "aac", "ogg", "flac"],
      },
    ],
  });

  if (result.canceled) return [];

  await ensureProject();

  const out: ImportedFile[] = [];
  for (const filePath of result.filePaths) {
    const kind = kindOf(filePath);
    try {
      const assetPath = await importIntoAssets(filePath);
      out.push({
        path: assetPath,
        url: pathToFileURL(assetPath).href,
        appUrl: toAppUrl(assetPath),
        name: basename(assetPath),
        kind,
      });
    } catch {
      out.push({
        path: filePath,
        url: pathToFileURL(filePath).href,
        appUrl: toAppUrl(filePath),
        name: basename(filePath),
        kind,
      });
    }
  }
  return out;
});

ipcMain.handle("project:load", async (): Promise<LoadedProject | null> => {
  if (existsSync(PROJECT_FILE)) {
    try {
      const raw = await readFile(PROJECT_FILE, "utf-8");
      const data = JSON.parse(raw) as ProjectPayload;
      const media: LoadedMedia[] = (data.media ?? []).map((m) => ({
        id: m.id,
        name: m.name,
        path: m.path,
        duration: m.duration,
        kind: m.kind,
        url: pathToFileURL(m.path).href,
        appUrl: toAppUrl(m.path),
        missing: !existsSync(m.path),
      }));
      return { media, sequence: data.sequence ?? null, scanned: false };
    } catch {
      /* fall through to scan */
    }
  }
  return { media: await scanAssets(), sequence: null, scanned: true };
});

ipcMain.handle("project:save", async (_event, data: ProjectPayload): Promise<boolean> => {
  await ensureProject();
  const payload = { version: 1, media: data.media, sequence: data.sequence };
  await writeFile(PROJECT_FILE, JSON.stringify(payload, null, 2), "utf-8");
  return true;
});

ipcMain.handle(
  "export:save",
  async (_event, payload: { name: string; data: Uint8Array }): Promise<string | null> => {
    await ensureProject();
    const result = await dialog.showSaveDialog({
      title: "Exportar vídeo",
      defaultPath: join(PROJECT_ROOT, payload.name),
      filters: [{ name: "MP4", extensions: ["mp4"] }],
    });
    if (result.canceled || !result.filePath) return null;
    await writeFile(result.filePath, Buffer.from(payload.data));
    return result.filePath;
  },
);

app.whenReady().then(() => {
  handleAppProtocol();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
