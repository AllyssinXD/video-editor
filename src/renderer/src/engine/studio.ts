import { Studio } from "@openvideo/engine-pixi";
import type { Core } from "@openvideo/core";
import { CANVAS_HEIGHT, CANVAS_WIDTH, FPS, core } from "./project";

export interface EngineHandle {
  core: Core;
  studio: Studio;
}

export interface CreateEngineOptions {
  width?: number;
  height?: number;
  fps?: number;
  previewScale?: number;
}

export async function createEngine(
  canvas: HTMLCanvasElement,
  opts: CreateEngineOptions = {},
): Promise<EngineHandle> {
  const width = opts.width ?? CANVAS_WIDTH;
  const height = opts.height ?? CANVAS_HEIGHT;
  const fps = opts.fps ?? FPS;

  const studio = new Studio({
    width,
    height,
    fps,
    canvas,
    core,
    backgroundColor: "#000000",
    artboardColor: "#000000",
    interactivity: true,
    previewScale: opts.previewScale ?? 0.75,
  });

  await studio.ready;
  return { core, studio };
}
