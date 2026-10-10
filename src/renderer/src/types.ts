export interface ImportedFile {
  path: string;
  url: string;
  appUrl: string;
  name: string;
  kind: "video" | "audio";
}

export interface MediaItem {
  id: string;
  name: string;
  path: string;
  url: string;
  appUrl: string;
  duration: number;
  kind: "video" | "audio";
}

export type TrackKind = "video" | "audio";

export interface TrackItem {
  id: string;
  name: string;
  mediaId: string;
  start: number;
  sourceIn: number;
  duration: number;
  speed: number;
  linkGroup: string | null;
}

export interface Track {
  id: string;
  kind: TrackKind;
  name: string;
  items: TrackItem[];
  muted: boolean;
  hidden: boolean;
  locked: boolean;
}

export interface Sequence {
  video: Track[];
  audio: Track[];
}

export interface Project {
  media: MediaItem[];
  sequence: Sequence;
}

export interface StoredMedia {
  id: string;
  name: string;
  path: string;
  duration: number;
  kind: "video" | "audio";
}

export interface ProjectPayload {
  media: StoredMedia[];
  sequence: unknown;
}

export interface LoadedMedia extends StoredMedia {
  url: string;
  appUrl: string;
  missing: boolean;
}

export interface LoadedProject {
  media: LoadedMedia[];
  sequence: unknown;
  scanned: boolean;
}
