import { BrowserMetadataProvider, Core, CoreConfig } from "@openvideo/core";
import type { ITrackConfig } from "@openvideo/core";
import type { ProjectJSON } from "@openvideo/engine-pixi";
import type { MediaItem } from "../types";

CoreConfig.setMetadataProvider(new BrowserMetadataProvider());

export const MICROS = 1_000_000;
export const CANVAS_WIDTH = 1280;
export const CANVAS_HEIGHT = 720;
export const FPS = 30;

export function uid(): string {
  return Math.random().toString(36).slice(2, 11) + Date.now().toString(36).slice(-4);
}

export const core = new Core({
  settings: { width: CANVAS_WIDTH, height: CANVAS_HEIGHT, fps: FPS, duration: 0 },
});

export type ClipTypeName = "Video" | "Audio";

export function mediaDurationTicks(media: MediaItem): number {
  return Math.max(1, Math.round(media.duration * MICROS));
}

export interface ClipPayload {
  type: ClipTypeName;
  src: string;
  name: string;
  width: number;
  height: number;
  muted: boolean;
  metadata: { mediaId: string; linkGroup: string };
  timing: {
    display: { from: number; to: number };
    trim: { from: number; to: number };
    duration: number;
    playbackRate?: number;
  };
}

export function buildClipPayload(
  media: MediaItem,
  start: number,
  linkGroup: string,
  type: ClipTypeName,
): ClipPayload {
  const duration = mediaDurationTicks(media);
  return {
    type,
    src: media.appUrl,
    name: media.name,
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
    muted: type === "Video",
    metadata: { mediaId: media.id, linkGroup },
    timing: {
      display: { from: start, to: start + duration },
      trim: { from: 0, to: duration },
      duration,
    },
  };
}

function findTrack(type: string, name: string) {
  const state = core.store.getState();
  return (
    state.tracks.find((t) => t.type.toLowerCase() === type && t.name === name) ??
    state.tracks.find((t) => t.type.toLowerCase() === type)
  );
}

export function ensureDefaultTracks(): { videoTrackId: string; audioTrackId: string } {
  let video = findTrack("video", "V1");
  let audio = findTrack("audio", "A1");
  if (!video) {
    core.track.add({ type: "video", name: "V1" });
    video = findTrack("video", "V1");
  }
  if (!audio) {
    core.track.add({ type: "audio", name: "A1" });
    audio = findTrack("audio", "A1");
  }
  return { videoTrackId: video?.id ?? "", audioTrackId: audio?.id ?? "" };
}

export function recalcDuration(): void {
  core.store.getState().recalculateDuration();
}

export function coreProjectJson(): ProjectJSON {
  const project = core.project.export();
  return {
    settings: {
      width: project.settings.width,
      height: project.settings.height,
      fps: project.settings.fps,
      duration: project.settings.duration,
      backgroundColor: project.settings.backgroundColor,
    },
    tracks: project.tracks.map((track) => ({
      id: track.id,
      name: track.name,
      type: track.type,
      clipIds: track.clipIds,
      muted: track.muted,
      config: track.config as Record<string, unknown> | undefined,
      accepts: track.accepts,
    })),
    clips: project.clips as unknown as ProjectJSON["clips"],
  };
}

export interface LegacyItem {
  id?: string;
  name: string;
  mediaId: string;
  start: number;
  sourceIn: number;
  duration: number;
  speed: number;
  linkGroup?: string | null;
}

export interface LegacyTrack {
  id?: string;
  kind: string;
  name: string;
  items: LegacyItem[];
  muted?: boolean;
  hidden?: boolean;
}

export interface LegacySequence {
  video?: LegacyTrack[];
  audio?: LegacyTrack[];
}

export function isLegacySequence(value: unknown): value is LegacySequence {
  if (!value || typeof value !== "object") return false;
  const v = value as LegacySequence;
  return Array.isArray(v.video) || Array.isArray(v.audio);
}

function legacyItemPayload(
  item: LegacyItem,
  media: MediaItem | undefined,
  kind: "video" | "audio",
): ClipPayload {
  const type: ClipTypeName = kind === "video" ? "Video" : "Audio";
  const duration = Math.max(1, Math.round(item.duration));
  const sourceIn = Math.max(0, Math.round(item.sourceIn ?? 0));
  return {
    type,
    src: media?.appUrl ?? "",
    name: item.name ?? media?.name ?? "clip",
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
    muted: type === "Video",
    metadata: { mediaId: item.mediaId, linkGroup: item.linkGroup ?? uid() },
    timing: {
      display: { from: Math.max(0, Math.round(item.start)), to: Math.max(0, Math.round(item.start)) + duration },
      trim: { from: sourceIn, to: sourceIn + duration },
      duration,
      playbackRate: item.speed ?? 1,
    },
  };
}

export async function applyLegacySequence(
  sequence: LegacySequence,
  mediaById: Map<string, MediaItem>,
): Promise<void> {
  const desired = [
    ...(sequence.video ?? []).map((track) => ({ kind: "video" as const, track })),
    ...(sequence.audio ?? []).map((track) => ({ kind: "audio" as const, track })),
  ];
  for (let i = desired.length - 1; i >= 0; i -= 1) {
    const entry = desired[i];
    core.track.add({
      type: entry.kind,
      name: entry.track.name,
      muted: Boolean(entry.track.muted),
      config: { hidden: Boolean(entry.track.hidden) } as unknown as ITrackConfig,
    });
  }
  const newTracks = core.store.getState().tracks;
  for (let i = 0; i < desired.length; i += 1) {
    const entry = desired[i];
    const trackId = newTracks[i]?.id;
    if (!trackId) continue;
    for (const item of entry.track.items ?? []) {
      const media = mediaById.get(item.mediaId);
      await core.clip.add(legacyItemPayload(item, media, entry.kind), {
        trackId,
        objectFit: "contain",
      });
    }
  }
  recalcDuration();
}
