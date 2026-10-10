import { Download, Film, Loader2, Redo2, Scissors, Undo2, Upload } from "lucide-react";

interface ToolbarProps {
  onImport: () => void;
  loading: boolean;
  onExport: () => void;
  canExport: boolean;
  exporting: boolean;
  progress: number;
  exportError: string | null;
  onCut: () => void;
  canCut: boolean;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

export function Toolbar({
  onImport,
  loading,
  onExport,
  canExport,
  exporting,
  progress,
  exportError,
  onCut,
  canCut,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
}: ToolbarProps) {
  return (
    <header className="toolbar">
      <span className="brand">
        <Film size={18} />
        Video Editor
      </span>
      <button className="btn" onClick={onImport} disabled={loading || exporting}>
        <Upload size={18} />
        Importar mídia
      </button>
      <button
        className="btn"
        onClick={onCut}
        disabled={!canCut || exporting}
        title="Cortar no cursor (S)"
      >
        <Scissors size={18} />
        Cortar
      </button>
      <button
        className="btn icon"
        onClick={onUndo}
        disabled={!canUndo || exporting}
        title="Desfazer (Ctrl+Z)"
      >
        <Undo2 size={18} />
      </button>
      <button
        className="btn icon"
        onClick={onRedo}
        disabled={!canRedo || exporting}
        title="Refazer (Ctrl+Shift+Z)"
      >
        <Redo2 size={18} />
      </button>
      <button
        className="btn primary"
        onClick={onExport}
        disabled={!canExport || exporting}
        title="Exportar vídeo"
      >
        {exporting ? <Loader2 size={18} className="spin" /> : <Download size={18} />}
        {exporting ? `Exportando ${Math.round(progress * 100)}%` : "Exportar"}
      </button>
      {exportError ? <span className="toolbar-error">{exportError}</span> : null}
    </header>
  );
}
