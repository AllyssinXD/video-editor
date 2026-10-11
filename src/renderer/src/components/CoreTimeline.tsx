import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useStore } from "zustand";
import { Eye, EyeOff, Magnet, Plus, Trash2, Volume2, VolumeX } from "lucide-react";
import type { AnyClip, ITrack } from "@openvideo/core";
import { core } from "../engine/project";
import type { TrackKind } from "../hooks/useEditor";
import {
  clamp,
  formatTick,
  formatTime,
  niceStep,
  secondsToTicks,
  ticksToSeconds,
} from "../lib/time";

export interface CoreTimelineProps {
  onSeek: (ticks: number) => void;
  onScrubStart: () => void;
  onScrubEnd: () => void;
  onMoveItem: (clipId: string, targetTrackId: string, newStart: number) => void;
  onTrimItem: (clipId: string, edge: "start" | "end", ticks: number) => void;
  selectedIds: string[];
  onSelectClip: (clipId: string, additive: boolean) => void;
  onClearSelection: () => void;
  onToggleMute: (trackId: string) => void;
  onToggleVisibility: (trackId: string) => void;
  onAddTrack: (kind: TrackKind) => void;
  onRemoveTrack: (trackId: string) => void;
}

function trackKind(track: ITrack): TrackKind {
  return track.type.toLowerCase() === "audio" ? "audio" : "video";
}

const SNAP_PX = 8;

function nearestSnap(candidate: number, points: number[], threshold: number): number | null {
  let best: number | null = null;
  let bestDist = threshold;
  for (const p of points) {
    const dist = Math.abs(p - candidate);
    if (dist <= bestDist) {
      bestDist = dist;
      best = p;
    }
  }
  return best;
}

function isHidden(track: ITrack): boolean {
  return Boolean((track.config as Record<string, unknown> | undefined)?.hidden);
}

function TimeReadout() {
  const time = useStore(core.store, (s) => s.currentTime);
  const duration = useStore(core.store, (s) => s.settings.duration);
  return (
    <div className="time">
      <span className="current">{formatTime(time)}</span>
      <span className="sep">/</span>
      <span>{formatTime(duration)}</span>
    </div>
  );
}

function Playhead({ pps }: { pps: number }) {
  const time = useStore(core.store, (s) => s.currentTime);
  return (
    <div className="playhead" style={{ transform: `translateX(${ticksToSeconds(time) * pps}px)` }}>
      <div className="playhead-handle" />
    </div>
  );
}

export function CoreTimeline({
  onSeek,
  onScrubStart,
  onScrubEnd,
  onMoveItem,
  onTrimItem,
  selectedIds,
  onSelectClip,
  onClearSelection,
  onToggleMute,
  onToggleVisibility,
  onAddTrack,
  onRemoveTrack,
}: CoreTimelineProps) {
  const tracks = useStore(core.store, (s) => s.tracks);
  const clips = useStore(core.store, (s) => s.clips);
  const duration = useStore(core.store, (s) => s.settings.duration);
  const [pps, setPps] = useState(60);
  const [headerWidth, setHeaderWidth] = useState(132);
  const [timelineHeight, setTimelineHeight] = useState(300);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [snapGuide, setSnapGuide] = useState<number | null>(null);
  const dragRef = useRef<{
    clipId: string;
    startX: number;
    startTicks: number;
    duration: number;
    exclude: Set<string>;
  } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTrack, setDropTrack] = useState<string | null>(null);
  const [dragGhost, setDragGhost] = useState<{ trackId: string; start: number } | null>(null);

  const excludedIds = useCallback((clipId: string): Set<string> => {
    const state = core.store.getState();
    const clip = state.clips[clipId];
    const group = clip?.metadata?.linkGroup as string | undefined;
    const set = new Set<string>([clipId]);
    if (group) {
      for (const c of Object.values(state.clips)) {
        if (c.metadata?.linkGroup === group) set.add(c.id);
      }
    }
    return set;
  }, []);

  const snapPoints = useCallback((exclude: Set<string>): number[] => {
    const state = core.store.getState();
    const pts: number[] = [0, state.currentTime];
    for (const c of Object.values(state.clips)) {
      if (exclude.has(c.id)) continue;
      const d = c.timing?.display;
      if (!d) continue;
      pts.push(d.from, d.to);
    }
    return pts;
  }, []);

  const videoTracks = tracks.filter((t) => trackKind(t) === "video");
  const audioTracks = tracks.filter((t) => trackKind(t) === "audio");
  const ordered = [...videoTracks, ...audioTracks];

  const totalSeconds = Math.max(ticksToSeconds(duration), 8);
  const step = niceStep(pps);
  const marks: number[] = [];
  for (let s = 0; s <= totalSeconds + step; s += step) marks.push(Number(s.toFixed(4)));

  const handleRulerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    onScrubStart();
    const move = (clientX: number) => {
      const ticks = secondsToTicks(clamp((clientX - rect.left) / pps, 0, totalSeconds));
      onSeek(ticks);
    };
    const onMove = (ev: PointerEvent) => move(ev.clientX);
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      onScrubEnd();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    move(e.clientX);
  };

  const handleClipDown = (
    e: ReactPointerEvent<HTMLDivElement>,
    clipId: string,
    trackId: string,
  ) => {
    e.stopPropagation();
    const clip = clips[clipId] as AnyClip | undefined;
    if (!clip) return;
    onSelectClip(clipId, e.shiftKey || e.ctrlKey || e.metaKey);
    try {
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    } catch {
      /* no active pointer (e.g. synthetic events) */
    }
    dragRef.current = {
      clipId,
      startX: e.clientX,
      startTicks: clip.timing.display.from,
      duration: clip.timing.duration,
      exclude: excludedIds(clipId),
    };
    setDragId(clipId);
    setDragGhost({ trackId, start: clip.timing.display.from });
    const resolve = (clientX: number, alt: boolean) => {
      const state = dragRef.current;
      if (!state) return null;
      const deltaTicks = secondsToTicks((clientX - state.startX) / pps);
      const rawStart = Math.max(0, state.startTicks + deltaTicks);
      let newStart = rawStart;
      let guide: number | null = null;
      if (snapEnabled && !alt) {
        const pts = snapPoints(state.exclude);
        const threshold = secondsToTicks(SNAP_PX / pps);
        const startSnap = nearestSnap(rawStart, pts, threshold);
        const endSnap = nearestSnap(rawStart + state.duration, pts, threshold);
        const startDist = startSnap === null ? Infinity : Math.abs(startSnap - rawStart);
        const endDist = endSnap === null ? Infinity : Math.abs(endSnap - (rawStart + state.duration));
        if (startSnap !== null && startDist <= endDist) {
          newStart = startSnap;
          guide = startSnap;
        } else if (endSnap !== null) {
          newStart = endSnap - state.duration;
          guide = endSnap;
        }
      }
      return { newStart: Math.max(0, Math.round(newStart)), guide };
    };
    const onMove = (ev: PointerEvent) => {
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      const row = el?.closest("[data-track-id]") as HTMLElement | null;
      const target = row?.dataset.trackId ?? trackId;
      setDropTrack(row?.dataset.trackId ?? null);
      const res = resolve(ev.clientX, ev.altKey);
      setSnapGuide(res?.guide ?? null);
      if (res) setDragGhost({ trackId: target, start: res.newStart });
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      const state = dragRef.current;
      if (!state) {
        dragRef.current = null;
        setDragId(null);
        setDropTrack(null);
        setDragGhost(null);
        setSnapGuide(null);
        return;
      }
      const res = resolve(ev.clientX, ev.altKey);
      dragRef.current = null;
      setDragId(null);
      setDropTrack(null);
      setDragGhost(null);
      setSnapGuide(null);
      const newStart =
        res?.newStart ??
        Math.max(0, state.startTicks + secondsToTicks((ev.clientX - state.startX) / pps));
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      const row = el?.closest("[data-track-id]") as HTMLElement | null;
      const target = row?.dataset.trackId ?? trackId;
      onMoveItem(state.clipId, target, newStart);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const handleTrimDown = (
    e: ReactPointerEvent<HTMLDivElement>,
    clipId: string,
    edge: "start" | "end",
  ) => {
    e.stopPropagation();
    e.preventDefault();
    const content = (e.currentTarget as HTMLElement).closest(
      ".timeline-content",
    ) as HTMLElement | null;
    if (!content) return;
    const rect = content.getBoundingClientRect();
    try {
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    } catch {
      /* no active pointer (e.g. synthetic events) */
    }
    const exclude = excludedIds(clipId);
    const move = (clientX: number, alt: boolean) => {
      let ticks = secondsToTicks(Math.max(0, (clientX - rect.left) / pps));

      if (snapEnabled && !alt) {
        const pts = snapPoints(exclude);
        const threshold = secondsToTicks(SNAP_PX / pps);
        const snapped = nearestSnap(ticks, pts, threshold);
        if (snapped !== null) {
          ticks = snapped;
          setSnapGuide(snapped);
        } else {
          setSnapGuide(null);
        }
      } else {
        setSnapGuide(null);
      }
      onTrimItem(clipId, edge, ticks);
    };
    const onMove = (ev: PointerEvent) => move(ev.clientX, ev.altKey);
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setSnapGuide(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    move(e.clientX, e.altKey);
  };

  const handleResizeDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = headerWidth;
    try {
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    } catch {
      /* no active pointer (e.g. synthetic events) */
    }
    const el = e.currentTarget as HTMLElement;
    el.classList.add("active");
    const onMove = (ev: PointerEvent) => {
      setHeaderWidth(Math.min(420, Math.max(88, startW + (ev.clientX - startX))));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      el.classList.remove("active");
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const handleHeightResize = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;
    const startH = timelineHeight;
    const el = e.currentTarget as HTMLElement;
    try {
      el.setPointerCapture?.(e.pointerId);
    } catch {
      /* no active pointer (e.g. synthetic events) */
    }
    el.classList.add("active");
    const onMove = (ev: PointerEvent) => {
      const h = Math.min(window.innerHeight - 160, Math.max(140, startH + (startY - ev.clientY)));
      setTimelineHeight(h);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      el.classList.remove("active");
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <div className="timeline" style={{ height: timelineHeight }}>
      <div
        className="timeline-resizer"
        onPointerDown={handleHeightResize}
        title="Arrastar para redimensionar"
      />
      <div className="timeline-head">
        <TimeReadout />
        <div className="layer-actions">
          <button className="btn small" onClick={() => onAddTrack("video")}>
            <Plus size={14} /> Vídeo
          </button>
          <button className="btn small" onClick={() => onAddTrack("audio")}>
            <Plus size={14} /> Áudio
          </button>
          <button
            className={`btn small${snapEnabled ? " active" : ""}`}
            onClick={() => setSnapEnabled((v) => !v)}
            title="Encaixar bordas (segure Alt para desativar)"
          >
            <Magnet size={14} /> Encaixe
          </button>
        </div>
        <div className="zoom">
          <span>Zoom</span>
          <input
            type="range"
            min={20}
            max={300}
            value={pps}
            onChange={(e) => setPps(Number(e.target.value))}
          />
        </div>
      </div>
      <div className="timeline-body">
        <div className="track-headers" style={{ width: headerWidth, flexBasis: headerWidth }}>
          <div className="ruler-spacer" />
          {ordered.map((track) => {
            const kind = trackKind(track);
            const hidden = isHidden(track);
            const sameKind = (kind === "video" ? videoTracks : audioTracks).length;
            return (
              <div className="track-header" key={track.id}>
                <span className="track-name">{track.name}</span>
                <div className="track-actions">
                  {kind === "audio" ? (
                    <button
                      className="track-toggle"
                      onClick={() => onToggleMute(track.id)}
                      title={track.muted ? "Ativar som" : "Silenciar"}
                    >
                      {track.muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
                    </button>
                  ) : (
                    <button
                      className="track-toggle"
                      onClick={() => onToggleVisibility(track.id)}
                      title={hidden ? "Mostrar" : "Ocultar"}
                    >
                      {hidden ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  )}
                  <button
                    className="track-toggle"
                    onClick={() => onRemoveTrack(track.id)}
                    disabled={sameKind <= 1}
                    title="Remover trilha"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            );
          })}
          <div className="col-resizer" onPointerDown={handleResizeDown} title="Arrastar para redimensionar" />
        </div>
        <div className="timeline-scroll">
          <div
            className="timeline-content"
            style={{ width: Math.round(totalSeconds * pps) }}
            onPointerDown={handleRulerDown}
          >
            <div className="ruler">
              {marks.map((s) => (
                <div
                  key={s}
                  className={`tick${Number.isInteger(s) ? " major" : ""}`}
                  style={{ left: s * pps }}
                >
                  {Number.isInteger(s) ? (
                    <span className="tick-label">{formatTick(secondsToTicks(s))}</span>
                  ) : null}
                </div>
              ))}
            </div>
            {ordered.map((track) => {
              const kind = trackKind(track);
              return (
                <div
                  key={track.id}
                  className={`track ${kind}${dropTrack === track.id ? " drop-target" : ""}`}
                  data-track-id={track.id}
                  onPointerDown={(e) => {
                    if (e.target === e.currentTarget) onClearSelection();
                  }}
                >
                  {(track.clipIds ?? []).map((clipId) => {
                    const clip = clips[clipId] as AnyClip | undefined;
                    if (!clip) return null;
                    const startS = ticksToSeconds(clip.timing.display.from);
                    const durS = ticksToSeconds(clip.timing.duration);
                    return (
                      <div
                        key={clipId}
                        className={`clip ${kind}${dragId === clipId ? " dragging" : ""}${
                          selectedIds.includes(clipId) ? " selected" : ""
                        }`}
                        style={{ left: startS * pps, width: Math.max(6, durS * pps) }}
                        onPointerDown={(e) => handleClipDown(e, clipId, track.id)}
                      >
                        <div
                          className="clip-handle start"
                          onPointerDown={(e) => handleTrimDown(e, clipId, "start")}
                          title="Aparar início"
                        />
                        <div className="clip-label">
                          <span className="clip-name">{clip.name}</span>
                        </div>
                        {kind === "video" ? (
                          <div className="clip-meta">{formatTime(clip.timing.duration)}</div>
                        ) : (
                          <div className="waveform" />
                        )}
                        <div
                          className="clip-handle end"
                          onPointerDown={(e) => handleTrimDown(e, clipId, "end")}
                          title="Aparar fim"
                        />
                      </div>
                    );
                  })}
                  {dragGhost && dragGhost.trackId === track.id && dragId
                    ? (() => {
                        const ghost = clips[dragId] as AnyClip | undefined;
                        if (!ghost) return null;
                        const startS = ticksToSeconds(dragGhost.start);
                        const durS = ticksToSeconds(ghost.timing.duration);
                        return (
                          <div
                            className={`clip ${kind} ghost`}
                            style={{ left: startS * pps, width: Math.max(6, durS * pps) }}
                          >
                            <div className="clip-label">
                              <span className="clip-name">{ghost.name}</span>
                            </div>
                          </div>
                        );
                      })()
                    : null}
                </div>
              );
            })}
            {snapGuide !== null ? (
              <div
                className="snap-guide"
                style={{ transform: `translateX(${ticksToSeconds(snapGuide) * pps}px)` }}
              />
            ) : null}
            <Playhead pps={pps} />
          </div>
        </div>
      </div>
    </div>
  );
}
