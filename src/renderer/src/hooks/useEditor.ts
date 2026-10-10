import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { ProjectPayload, MediaItem } from "../types";
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  FPS,
  MICROS,
  applyLegacySequence,
  buildClipPayload,
  core,
  coreProjectJson,
  ensureDefaultTracks,
  isLegacySequence,
  mediaDurationTicks,
  recalcDuration,
} from "../engine/project";
import { createEngine, type EngineHandle } from "../engine/studio";
import { isExportSupported, renderProject } from "../engine/export";
import {
  nanoid,
  type AddClipPayload,
  type AnyClip,
  type Command,
  type ITrackConfig,
} from "@openvideo/core";

function sameStringArray(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

interface ClipboardEntry {
  clip: AnyClip;
  trackId: string;
}

export type TrackKind = "video" | "audio";

function uid(): string {
  return Math.random().toString(36).slice(2, 11) + Date.now().toString(36).slice(-4);
}

function readDuration(url: string): Promise<number> {
  return new Promise((resolve) => {
    const probe = document.createElement("video");
    probe.preload = "metadata";
    probe.onloadedmetadata = () => resolve(probe.duration);
    probe.onerror = () => resolve(0);
    probe.src = url;
  });
}

function serialize(media: MediaItem[], sequence: unknown): ProjectPayload {
  return {
    media: media.map((m) => ({
      id: m.id,
      name: m.name,
      path: m.path,
      duration: m.duration,
      kind: m.kind,
    })),
    sequence,
  };
}

function looksLikeCoreProject(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const v = value as { tracks?: unknown; clips?: unknown };
  return Array.isArray(v.tracks) && !!v.clips && typeof v.clips === "object";
}

export interface Editor {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  ready: boolean;
  loading: boolean;
  media: MediaItem[];
  importMedia: () => Promise<void>;
  addInstance: (mediaId: string) => void;
  play: () => void;
  pause: () => void;
  stop: () => void;
  seek: (ticks: number) => void;
  beginScrub: () => void;
  endScrub: () => void;
  toggleMute: (trackId: string) => void;
  toggleVisibility: (trackId: string) => void;
  addTrack: (kind: TrackKind) => void;
  removeTrack: (trackId: string) => void;
  moveItem: (clipId: string, targetTrackId: string, newStart: number) => void;
  cut: () => void;
  cutClip: (clipId: string, time: number) => void;
  canCutAtPlayhead: boolean;
  trimItem: (clipId: string, edge: "start" | "end", ticks: number) => void;
  selectedIds: string[];
  selectClip: (clipId: string, additive?: boolean) => void;
  clearSelection: () => void;
  deleteSelected: () => void;
  selectAll: () => void;
  copySelection: () => void;
  cutSelection: () => void;
  paste: () => void;
  duplicate: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  stepFrame: (dir: -1 | 1) => void;
  previewScale: number;
  setPreviewScale: (scale: number) => void;
  exporting: boolean;
  exportProgress: number;
  exportError: string | null;
  exportVideo: () => Promise<string | null>;
}

export function useEditor(): Editor {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<EngineHandle | null>(null);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportError, setExportError] = useState<string | null>(null);
  const [canCutAtPlayhead, setCanCutAtPlayhead] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const clipboardRef = useRef<ClipboardEntry[]>([]);
  const [previewScale, setPreviewScaleState] = useState(0.75);
  const previewScaleRef = useRef(previewScale);
  previewScaleRef.current = previewScale;

  const mediaRef = useRef<MediaItem[]>(media);
  mediaRef.current = media;
  const hydratedRef = useRef(false);
  const lastSavedRef = useRef("");
  const resumeRef = useRef(false);
  const saveTimerRef = useRef<number | undefined>(undefined);

  const scheduleSave = useCallback(() => {
    if (!hydratedRef.current) return;
    if (saveTimerRef.current !== undefined) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = undefined;
      const payload = serialize(mediaRef.current, core.project.export());
      const json = JSON.stringify(payload);
      if (json === lastSavedRef.current) return;
      lastSavedRef.current = json;
      void window.api.saveProject(payload).catch(() => undefined);
    }, 500);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    let ro: ResizeObserver | undefined;
    void (async () => {
      const engine = await createEngine(canvas, {
        width: CANVAS_WIDTH,
        height: CANVAS_HEIGHT,
        fps: FPS,
        previewScale: previewScaleRef.current,
      });
      if (cancelled) {
        engine.studio.destroy();
        return;
      }
      engineRef.current = engine;
      setReady(true);
      const parent = canvas.parentElement;
      if (parent && typeof ResizeObserver !== "undefined") {
        ro = new ResizeObserver(() => {
          window.dispatchEvent(new Event("resize"));
        });
        ro.observe(parent);
      }
    })();
    return () => {
      cancelled = true;
      ro?.disconnect();
      engineRef.current?.studio.destroy();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const loaded = await window.api.loadProject();
      if (cancelled) return;
      if (!loaded) {
        ensureDefaultTracks();
        hydratedRef.current = true;
        lastSavedRef.current = JSON.stringify(serialize(mediaRef.current, core.project.export()));
        return;
      }
      const list: MediaItem[] = [];
      for (const m of loaded.media) {
        let duration = m.duration;
        if (!Number.isFinite(duration) || duration <= 0) {
          duration = await readDuration(m.appUrl || m.url).catch(() => 0);
          if (!Number.isFinite(duration) || duration <= 0) duration = 1;
        }
        list.push({
          id: m.id,
          name: m.name,
          path: m.path,
          url: m.url,
          appUrl: m.appUrl,
          duration,
          kind: m.kind,
        });
      }
      if (cancelled) return;
      let migrated = false;
      if (looksLikeCoreProject(loaded.sequence)) {
        core.project.import(loaded.sequence as Parameters<typeof core.project.import>[0]);
      } else if (isLegacySequence(loaded.sequence)) {
        const byId = new Map(list.map((m) => [m.id, m]));
        await applyLegacySequence(loaded.sequence, byId);
        migrated = true;
      } else {
        ensureDefaultTracks();
      }
      recalcDuration();
      setMedia(list);
      hydratedRef.current = true;
      lastSavedRef.current = migrated
        ? ""
        : JSON.stringify(serialize(list, core.project.export()));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const unsubscribe = core.store.subscribe(() => scheduleSave());
    return () => {
      unsubscribe();
      if (saveTimerRef.current !== undefined) window.clearTimeout(saveTimerRef.current);
    };
  }, [scheduleSave]);

  useEffect(() => {
    scheduleSave();
  }, [media, scheduleSave]);

  useEffect(() => {
    const compute = (state: ReturnType<typeof core.store.getState>) => {
      const nextSel = state.selectedIds ?? [];
      setSelectedIds((prev) => (sameStringArray(prev, nextSel) ? prev : nextSel));
      const time = state.currentTime;
      const scoped: AnyClip[] = nextSel.length
        ? nextSel
            .map((id) => state.clips[id])
            .filter((c): c is AnyClip => Boolean(c))
        : Object.values(state.clips);
      const next = scoped.some((c) => {
        const display = c.timing?.display;
        return !!display && time > display.from && (display.to <= 0 || time < display.to);
      });
      setCanCutAtPlayhead((prev) => (prev === next ? prev : next));
      const nextUndo = (state.history?.length ?? 0) > 0;
      setCanUndo((prev) => (prev === nextUndo ? prev : nextUndo));
      const nextRedo = (state.future?.length ?? 0) > 0;
      setCanRedo((prev) => (prev === nextRedo ? prev : nextRedo));
    };
    compute(core.store.getState());
    return core.store.subscribe(compute);
  }, []);

  const addClipsForMedia = useCallback(async (items: MediaItem[], startAt: number) => {
    let cursor = startAt;
    for (const item of items) {
      const { videoTrackId, audioTrackId } = ensureDefaultTracks();
      const linkGroup = uid();
      if (item.kind === "video") {
        await core.clip.add(buildClipPayload(item, cursor, linkGroup, "Video"), {
          trackId: videoTrackId,
          objectFit: "contain",
        });
      }
      await core.clip.add(buildClipPayload(item, cursor, linkGroup, "Audio"), {
        trackId: audioTrackId,
        objectFit: "contain",
      });
      cursor += mediaDurationTicks(item);
    }
    recalcDuration();
  }, []);

  const importMedia = useCallback(async () => {
    setLoading(true);
    try {
      const files = await window.api.importMedia();
      if (!files.length) return;
      const byPath = new Map(mediaRef.current.map((m) => [m.path, m]));
      const added: MediaItem[] = [];
      for (const f of files) {
        if (byPath.has(f.path)) continue;
        let duration = await readDuration(f.appUrl || f.url).catch(() => 0);
        if (!Number.isFinite(duration) || duration <= 0) duration = 1;
        const item: MediaItem = {
          id: uid(),
          name: f.name,
          path: f.path,
          url: f.url,
          appUrl: f.appUrl,
          duration,
          kind: f.kind,
        };
        added.push(item);
        byPath.set(f.path, item);
      }
      if (added.length) setMedia((prev) => [...prev, ...added]);
      const items = files.map((f) => byPath.get(f.path)).filter((m): m is MediaItem => !!m);
      const startAt = core.store.getState().settings.duration;
      await addClipsForMedia(items, startAt);
    } finally {
      setLoading(false);
    }
  }, [addClipsForMedia]);

  const addInstance = useCallback(
    (mediaId: string) => {
      const item = mediaRef.current.find((m) => m.id === mediaId);
      if (!item) return;
      const startAt = core.store.getState().settings.duration;
      void addClipsForMedia([item], startAt);
    },
    [addClipsForMedia],
  );

  const play = useCallback(() => {
    const state = core.store.getState();
    if (state.settings.duration <= 0) return;
    if (state.currentTime >= state.settings.duration) core.seek(0);
    core.play();
  }, []);

  const pause = useCallback(() => core.pause(), []);
  const stop = useCallback(() => {
    core.pause();
    core.seek(0);
  }, []);
  const seek = useCallback((ticks: number) => core.seek(Math.max(0, Math.round(ticks))), []);

  const beginScrub = useCallback(() => {
    resumeRef.current = core.store.getState().isPlaying;
    core.pause();
  }, []);
  const endScrub = useCallback(() => {
    if (resumeRef.current) core.play();
  }, []);

  const toggleMute = useCallback((trackId: string) => {
    const track = core.store.getState().tracks.find((t) => t.id === trackId);
    if (track) core.track.update(trackId, { muted: !track.muted });
  }, []);

  const toggleVisibility = useCallback((trackId: string) => {
    const track = core.store.getState().tracks.find((t) => t.id === trackId);
    if (track) {
      const config = (track.config ?? {}) as Record<string, unknown>;
      core.track.update(trackId, {
        config: { ...config, hidden: !config.hidden } as unknown as ITrackConfig,
      });
    }
  }, []);

  const addTrack = useCallback((kind: TrackKind) => {
    const tracks = core.store.getState().tracks;
    const count = tracks.filter((t) => t.type.toLowerCase() === kind).length;
    core.track.add({ type: kind, name: `${kind === "video" ? "V" : "A"}${count + 1}` });
  }, []);

  const removeTrack = useCallback((trackId: string) => {
    const tracks = core.store.getState().tracks;
    const track = tracks.find((t) => t.id === trackId);
    if (!track) return;
    const sameKind = tracks.filter((t) => t.type.toLowerCase() === track.type.toLowerCase());
    if (sameKind.length <= 1) return;
    core.track.remove(trackId);
    recalcDuration();
  }, []);

  const moveItem = useCallback((clipId: string, targetTrackId: string, newStart: number) => {
    const state = core.store.getState();
    const clip = state.clips[clipId];
    if (!clip) return;
    const delta = Math.round(newStart) - clip.timing.display.from;
    const group = clip.metadata?.linkGroup as string | undefined;
    const ids = group
      ? Object.values(state.clips)
          .filter((c) => c.metadata?.linkGroup === group)
          .map((c) => c.id)
      : [clipId];
    for (const id of ids) {
      const c = core.store.getState().clips[id];
      if (!c) continue;
      const from = Math.max(0, c.timing.display.from + delta);
      core.clip.update(id, {
        timing: { ...c.timing, display: { from, to: from + c.timing.duration } },
      });
    }
    const srcTrack = state.tracks.find((t) => (t.clipIds ?? []).includes(clipId));
    if (srcTrack && srcTrack.id !== targetTrackId) {
      core.track.update(srcTrack.id, {
        clipIds: (srcTrack.clipIds ?? []).filter((id) => id !== clipId),
      });
      const target = core.store.getState().tracks.find((t) => t.id === targetTrackId);
      if (target) {
        core.track.update(targetTrackId, { clipIds: [...(target.clipIds ?? []), clipId] });
      }
    }
    recalcDuration();
  }, []);

  const sourceDurationTicks = useCallback((mediaId: string | undefined, fallback: number): number => {
    if (!mediaId) return fallback;
    const item = mediaRef.current.find((m) => m.id === mediaId);
    return item ? mediaDurationTicks(item) : fallback;
  }, []);

  const trimItem = useCallback(
    (clipId: string, edge: "start" | "end", ticks: number) => {
      const state = core.store.getState();
      const clip = state.clips[clipId];
      if (!clip) return;
      const group = clip.metadata?.linkGroup as string | undefined;
      const members = group
        ? Object.values(state.clips).filter((c) => c.metadata?.linkGroup === group)
        : [clip];
      const minDur = Math.max(1, Math.round(MICROS / FPS));
      const rate = clip.timing.playbackRate ?? 1;

      let delta: number;
      if (edge === "start") {
        const minStart = clip.timing.display.from - (clip.timing.trim?.from ?? 0) / rate;
        const maxStart = clip.timing.display.to - minDur;
        const newFrom = Math.min(Math.max(ticks, minStart), maxStart);
        delta = newFrom - clip.timing.display.from;
      } else {
        const fallback = clip.timing.display.to + (clip.timing.trim?.to ?? clip.timing.duration) -
          (clip.timing.trim?.from ?? 0);
        const source = sourceDurationTicks(clip.metadata?.mediaId as string | undefined, fallback);
        const maxEnd =
          clip.timing.display.to +
          (source - (clip.timing.trim?.to ?? clip.timing.duration)) / rate;
        const minEnd = clip.timing.display.from + minDur;
        const newTo = Math.min(Math.max(ticks, minEnd), maxEnd);
        delta = newTo - clip.timing.display.to;
      }
      if (Math.abs(delta) < 1) return;

      for (const m of members) {
        const rateM = m.timing.playbackRate ?? 1;
        const dSource = Math.round(delta * rateM);
        const trimFrom = m.timing.trim?.from ?? 0;
        const trimTo = m.timing.trim?.to ?? m.timing.duration;
        if (edge === "start") {
          const from = Math.round(m.timing.display.from + delta);
          const nextTrimFrom = Math.max(0, trimFrom + dSource);
          core.clip.update(m.id, {
            timing: {
              ...m.timing,
              display: { from, to: m.timing.display.to },
              trim: { from: nextTrimFrom, to: trimTo },
              duration: m.timing.display.to - from,
            },
          });
        } else {
          const to = Math.round(m.timing.display.to + delta);
          core.clip.update(m.id, {
            timing: {
              ...m.timing,
              display: { from: m.timing.display.from, to },
              trim: { from: trimFrom, to: trimTo + dSource },
              duration: to - m.timing.display.from,
            },
          });
        }
      }
      recalcDuration();
    },
    [sourceDurationTicks],
  );

  const cutClip = useCallback((clipId: string, time: number) => {
    const state = core.store.getState();
    const clip = state.clips[clipId];
    if (!clip) return;
    const display = clip.timing?.display;
    if (!display || time <= display.from || (display.to > 0 && time >= display.to)) return;
    core.clip.split(time, clipId);
    recalcDuration();
  }, []);

  const cut = useCallback(() => {
    const state = core.store.getState();
    const time = state.currentTime;
    if (state.settings.duration <= 0) return;
    const scoped: AnyClip[] = state.selectedIds.length
      ? state.selectedIds
          .map((id) => state.clips[id])
          .filter((c): c is AnyClip => Boolean(c))
      : Object.values(state.clips);
    const ids = scoped
      .filter((c) => {
        const display = c.timing?.display;
        return !!display && time > display.from && (display.to <= 0 || time < display.to);
      })
      .map((c) => c.id);
    if (!ids.length) return;
    for (const id of ids) core.clip.split(time, id);
    recalcDuration();
  }, []);

  const selectClip = useCallback((clipId: string, additive = false) => {
    const store = core.store.getState();
    if (additive) {
      if (store.selectedIds.includes(clipId)) store.deselect(clipId);
      else store.select(clipId, true);
    } else {
      store.select(clipId);
    }
  }, []);

  const clearSelection = useCallback(() => {
    const store = core.store.getState();
    if (store.selectedIds.length) store.deselect();
  }, []);

  const deleteSelected = useCallback(() => {
    const store = core.store.getState();
    const ids = store.selectedIds;
    if (!ids.length) return;
    core.clip.remove(ids);
    recalcDuration();
  }, []);

  const selectAll = useCallback(() => {
    const store = core.store.getState();
    const ids = Object.keys(store.clips);
    if (ids.length) store.select(ids);
  }, []);

  const storeSelection = useCallback((remove: boolean) => {
    const state = core.store.getState();
    const ids = state.selectedIds;
    if (!ids.length) return;
    clipboardRef.current = ids
      .map((id) => state.clips[id])
      .filter((c): c is AnyClip => Boolean(c))
      .map((clip) => ({
        clip: JSON.parse(JSON.stringify(clip)) as AnyClip,
        trackId: state.tracks.find((t) => (t.clipIds ?? []).includes(clip.id))?.id ?? "",
      }));
    if (remove) {
      core.clip.remove(ids);
      recalcDuration();
    }
  }, []);

  const copySelection = useCallback(() => storeSelection(false), [storeSelection]);
  const cutSelection = useCallback(() => storeSelection(true), [storeSelection]);

  const paste = useCallback(() => {
    const entries = clipboardRef.current;
    if (!entries.length) return;
    const state = core.store.getState();
    const at = state.currentTime;
    const earliest = Math.min(...entries.map((e) => e.clip.timing?.display?.from ?? 0));
    const groupMap = new Map<string, string>();
    void (async () => {
      const commands: Command[] = [];
      const addedIds: string[] = [];
      for (const entry of entries) {
        const oldGroup = entry.clip.metadata?.linkGroup as string | undefined;
        let linkGroup: string | undefined = oldGroup;
        if (oldGroup) {
          if (!groupMap.has(oldGroup)) groupMap.set(oldGroup, uid());
          linkGroup = groupMap.get(oldGroup);
        }
        const display = entry.clip.timing?.display;
        const offset = (display?.from ?? 0) - earliest;
        const duration = entry.clip.timing?.duration ?? (display ? display.to - display.from : 0);
        const from = at + offset;
        const payload = {
          ...entry.clip,
          id: nanoid(),
          metadata: { ...entry.clip.metadata, linkGroup },
          timing: {
            ...entry.clip.timing,
            display: { from, to: from + duration },
            duration,
          },
        } as unknown as AddClipPayload;
        const clip = await core.clip.prepare(payload, { objectFit: "contain" });
        addedIds.push(clip.id);
        commands.push({
          id: nanoid(),
          type: "clip.add",
          payload: { clip, trackId: entry.trackId || undefined },
        });
      }
      if (!commands.length) return;
      core.batch(commands);
      recalcDuration();
      core.store.getState().select(addedIds);
    })();
  }, []);

  const duplicate = useCallback(() => {
    const state = core.store.getState();
    if (!state.selectedIds.length) return;
    core.clip.duplicate(state.selectedIds);
    recalcDuration();
  }, []);

  const undo = useCallback(() => core.undo(), []);
  const redo = useCallback(() => core.redo(), []);

  const stepFrame = useCallback((dir: -1 | 1) => {
    const frame = Math.round(MICROS / FPS);
    const t = core.store.getState().currentTime + dir * frame;
    core.seek(Math.max(0, t));
  }, []);

  const setPreviewScale = useCallback((scale: number) => {
    const next = Math.max(0.1, Math.min(1, scale));
    setPreviewScaleState(next);
    engineRef.current?.studio.setPreviewScale(next);
  }, []);

  const exportVideo = useCallback(async (): Promise<string | null> => {
    if (!engineRef.current?.studio) return null;
    const state = core.store.getState();
    if (state.settings.duration <= 0) return null;
    const restoredTime = state.currentTime;
    setExporting(true);
    setExportProgress(0);
    setExportError(null);
    core.pause();
    try {
      const opts = {
        width: state.settings.width,
        height: state.settings.height,
        fps: state.settings.fps,
      };
      if (!(await isExportSupported(opts))) {
        setExportError("WebCodecs/MP4 não suportado neste ambiente.");
        return null;
      }
      const json = coreProjectJson();
      const data = await renderProject(json, opts, (p) => setExportProgress(p));
      const saved = await window.api.saveExport(`export-${Date.now()}.mp4`, data);
      return saved;
    } catch (err) {
      setExportError(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setExporting(false);
      core.seek(restoredTime);
    }
  }, []);

  return {
    canvasRef,
    ready,
    loading,
    media,
    importMedia,
    addInstance,
    play,
    pause,
    stop,
    seek,
    beginScrub,
    endScrub,
    toggleMute,
    toggleVisibility,
    addTrack,
    removeTrack,
    moveItem,
    cut,
    cutClip,
    canCutAtPlayhead,
    trimItem,
    selectedIds,
    selectClip,
    clearSelection,
    deleteSelected,
    selectAll,
    copySelection,
    cutSelection,
    paste,
    duplicate,
    undo,
    redo,
    canUndo,
    canRedo,
    stepFrame,
    previewScale,
    setPreviewScale,
    exporting,
    exportProgress,
    exportError,
    exportVideo,
  };
}
