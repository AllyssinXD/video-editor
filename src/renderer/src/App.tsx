import { useEffect } from "react";
import { useStore } from "zustand";
import { Toolbar } from "./components/Toolbar";
import { MediaPool } from "./components/MediaPool";
import { EnginePreview } from "./components/EnginePreview";
import { CoreTimeline } from "./components/CoreTimeline";
import { useEditor } from "./hooks/useEditor";
import { core } from "./engine/project";

export default function App() {
  const editor = useEditor();
  const isPlaying = useStore(core.store, (s) => s.isPlaying);
  const hasClips = useStore(core.store, (s) => s.settings.duration > 0);

  useEffect(() => {
    const isEditable = (target: EventTarget | null) => {
      const el = target as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable;
    };
    const mod = (e: KeyboardEvent) => e.ctrlKey || e.metaKey;
    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditable(e.target)) return;
      const key = e.key.toLowerCase();

      if (mod(e)) {
        if (key === "z") {
          e.preventDefault();
          if (e.shiftKey) editor.redo();
          else editor.undo();
          return;
        }
        if (key === "y") {
          e.preventDefault();
          editor.redo();
          return;
        }
        if (key === "a") {
          e.preventDefault();
          editor.selectAll();
          return;
        }
        if (key === "c") {
          e.preventDefault();
          editor.copySelection();
          return;
        }
        if (key === "x") {
          e.preventDefault();
          editor.cutSelection();
          return;
        }
        if (key === "v") {
          e.preventDefault();
          editor.paste();
          return;
        }
        if (key === "d") {
          e.preventDefault();
          editor.duplicate();
          return;
        }
        if (key === "k") {
          e.preventDefault();
          editor.cut();
          return;
        }
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          editor.stepFrame(-1);
          return;
        }
        if (e.key === "ArrowRight") {
          e.preventDefault();
          editor.stepFrame(1);
          return;
        }
      }

      if (e.code === "Space") {
        e.preventDefault();
        if (isPlaying) editor.pause();
        else editor.play();
        return;
      }
      if (!mod(e) && !e.altKey && key === "s") {
        e.preventDefault();
        editor.cut();
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        editor.deleteSelected();
        return;
      }
      if (e.key === "Escape") {
        editor.clearSelection();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    isPlaying,
    editor.play,
    editor.pause,
    editor.cut,
    editor.deleteSelected,
    editor.clearSelection,
    editor.redo,
    editor.undo,
    editor.selectAll,
    editor.copySelection,
    editor.cutSelection,
    editor.paste,
    editor.duplicate,
    editor.stepFrame,
  ]);

  return (
    <>
      <Toolbar
        onImport={editor.importMedia}
        loading={editor.loading}
        onExport={editor.exportVideo}
        canExport={hasClips}
        exporting={editor.exporting}
        progress={editor.exportProgress}
        exportError={editor.exportError}
        onCut={editor.cut}
        canCut={editor.canCutAtPlayhead}
        onUndo={editor.undo}
        onRedo={editor.redo}
        canUndo={editor.canUndo}
        canRedo={editor.canRedo}
      />
      <div className="middle">
        <MediaPool media={editor.media} onAdd={editor.addInstance} />
        <EnginePreview
          canvasRef={editor.canvasRef}
          ready={editor.ready}
          onPlay={editor.play}
          onPause={editor.pause}
          onStop={editor.stop}
          previewScale={editor.previewScale}
          onPreviewScaleChange={editor.setPreviewScale}
        />
      </div>
      <CoreTimeline
        onSeek={editor.seek}
        onScrubStart={editor.beginScrub}
        onScrubEnd={editor.endScrub}
        onToggleMute={editor.toggleMute}
        onToggleVisibility={editor.toggleVisibility}
        onAddTrack={editor.addTrack}
        onRemoveTrack={editor.removeTrack}
        onMoveItem={editor.moveItem}
        onTrimItem={editor.trimItem}
        selectedIds={editor.selectedIds}
        onSelectClip={editor.selectClip}
        onClearSelection={editor.clearSelection}
      />
    </>
  );
}
