import type { RefObject } from "react";
import { useStore } from "zustand";
import { Pause, Play, Square } from "lucide-react";
import { core } from "../engine/project";

interface EnginePreviewProps {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  ready: boolean;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  previewScale: number;
  onPreviewScaleChange: (scale: number) => void;
}

export function EnginePreview({
  canvasRef,
  ready,
  onPlay,
  onPause,
  onStop,
  previewScale,
  onPreviewScaleChange,
}: EnginePreviewProps) {
  const isPlaying = useStore(core.store, (s) => s.isPlaying);
  const hasClips = useStore(core.store, (s) => s.settings.duration > 0);

  return (
    <div className="workspace">
      <div className="preview">
        <canvas ref={canvasRef} className="engine-canvas" />
        {!ready ? <div className="preview-empty">Carregando engine…</div> : null}
        {ready && !hasClips ? (
          <div className="preview-empty">Adicione mídia à timeline</div>
        ) : null}
      </div>
      <div className="transport">
        <button
          className="btn icon primary"
          onClick={isPlaying ? onPause : onPlay}
          disabled={!hasClips}
          title={isPlaying ? "Pausar" : "Reproduzir"}
        >
          {isPlaying ? <Pause size={18} /> : <Play size={18} />}
        </button>
        <button className="btn icon" onClick={onStop} disabled={!hasClips} title="Parar">
          <Square size={18} />
        </button>
        <div className="preview-quality">
          <span>Resolução</span>
          <input
            type="range"
            min={10}
            max={100}
            step={5}
            value={Math.round(previewScale * 100)}
            onChange={(e) => onPreviewScaleChange(Number(e.target.value) / 100)}
            title="Resolução do preview"
          />
          <span className="value">{Math.round(previewScale * 100)}%</span>
        </div>
      </div>
    </div>
  );
}
