import { Compositor, type ProjectJSON } from "@openvideo/engine-pixi";

export interface ExportOptions {
  width: number;
  height: number;
  fps: number;
  bitrate?: number;
  format?: string;
  videoCodec?: string;
}

export async function isExportSupported(opts: ExportOptions): Promise<boolean> {
  return Compositor.isSupported({
    width: opts.width,
    height: opts.height,
    bitrate: opts.bitrate,
  });
}

export async function renderProject(
  json: ProjectJSON,
  opts: ExportOptions,
  onProgress?: (progress: number) => void,
): Promise<Uint8Array> {
  const compositor = new Compositor({
    width: opts.width,
    height: opts.height,
    fps: opts.fps,
    bitrate: opts.bitrate ?? 8_000_000,
    format: opts.format ?? "mp4",
    videoCodec: opts.videoCodec ?? "avc1.42E032",
    backgroundColor: json.settings?.backgroundColor ?? "#000000",
  });

  compositor.on("export:progress", (progress: number) => {
    onProgress?.(progress);
  });

  try {
    await compositor.initPixiApp();
    await compositor.loadFromJSON(json);
    const stream = compositor.output();
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        total += value.length;
      }
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  } finally {
    compositor.destroy();
  }
}
