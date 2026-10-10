import { contextBridge, ipcRenderer } from "electron";

interface StoredMedia {
  id: string;
  name: string;
  path: string;
  duration: number;
  kind: "video" | "audio";
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

contextBridge.exposeInMainWorld("api", {
  importMedia: (): Promise<
    { path: string; url: string; appUrl: string; name: string; kind: "video" | "audio" }[]
  > => ipcRenderer.invoke("media:import"),
  loadProject: (): Promise<LoadedProject | null> => ipcRenderer.invoke("project:load"),
  saveProject: (data: { media: StoredMedia[]; sequence: unknown }): Promise<boolean> =>
    ipcRenderer.invoke("project:save", data),
  saveExport: (name: string, data: Uint8Array): Promise<string | null> =>
    ipcRenderer.invoke("export:save", { name, data }),
});
