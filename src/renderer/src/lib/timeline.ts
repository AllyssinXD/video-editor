import type { Sequence, Track, TrackItem, TrackKind } from "../types";

export const uid = (): string => Math.random().toString(36).slice(2, 10);

export function newTrack(kind: TrackKind, name: string): Track {
  return { id: uid(), kind, name, items: [], muted: false, hidden: false, locked: false };
}

export function allTracks(sequence: Sequence): Track[] {
  return [...sequence.video, ...sequence.audio];
}

export function trackEnd(track: Track): number {
  return track.items.reduce((max, item) => Math.max(max, item.start + item.duration), 0);
}

export function sequenceEnd(sequence: Sequence): number {
  return allTracks(sequence).reduce((max, track) => Math.max(max, trackEnd(track)), 0);
}

export function itemAt(track: Track, ticks: number): TrackItem | null {
  for (const item of track.items) {
    if (ticks >= item.start && ticks < item.start + item.duration) return item;
  }
  return null;
}

export function videoItemAt(sequence: Sequence, ticks: number): TrackItem | null {
  for (let i = sequence.video.length - 1; i >= 0; i--) {
    const track = sequence.video[i];
    if (track.hidden) continue;
    const item = itemAt(track, ticks);
    if (item) return item;
  }
  return null;
}

export function videoVisibleAt(sequence: Sequence, ticks: number): boolean {
  for (let i = sequence.video.length - 1; i >= 0; i--) {
    const track = sequence.video[i];
    if (track.hidden) continue;
    if (itemAt(track, ticks)) return true;
  }
  return false;
}

export function audioLayerAt(
  sequence: Sequence,
  ticks: number,
): { track: Track; item: TrackItem } | null {
  for (let i = sequence.audio.length - 1; i >= 0; i--) {
    const track = sequence.audio[i];
    const item = itemAt(track, ticks);
    if (item) return { track, item };
  }
  return null;
}

export function hasAnyAudioItems(sequence: Sequence): boolean {
  return sequence.audio.some((track) => track.items.length > 0);
}

export function audioAudibleAt(sequence: Sequence, ticks: number): boolean {
  return sequence.audio.some((track) => !track.muted && itemAt(track, ticks) !== null);
}

export function sequenceShouldMute(sequence: Sequence, ticks: number): boolean {
  if (!hasAnyAudioItems(sequence)) return false;
  return !audioAudibleAt(sequence, ticks);
}

export function nextVideoItem(sequence: Sequence, afterTicks: number): TrackItem | null {
  let next: TrackItem | null = null;
  for (const track of sequence.video) {
    for (const item of track.items) {
      if (item.start > afterTicks && (!next || item.start < next.start)) next = item;
    }
  }
  return next;
}

export function sourceTicksAt(item: TrackItem, timelineTicks: number): number {
  return item.sourceIn + (timelineTicks - item.start) * item.speed;
}
