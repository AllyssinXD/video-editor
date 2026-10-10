import { Film, Music, Plus } from "lucide-react";
import type { MediaItem } from "../types";
import { formatTime, secondsToTicks } from "../lib/time";

interface MediaPoolProps {
  media: MediaItem[];
  onAdd: (mediaId: string) => void;
}

export function MediaPool({ media, onAdd }: MediaPoolProps) {
  return (
    <aside className="media-pool">
      <div className="media-pool-head">Projeto · E:\video-project</div>
      {media.length === 0 ? (
        <div className="media-empty">Nenhuma mídia importada</div>
      ) : (
        <ul className="media-list">
          {media.map((item) => (
            <li key={item.id} className="media-item" title={item.path}>
              <span className="media-icon">
                {item.kind === "audio" ? <Music size={14} /> : <Film size={14} />}
              </span>
              <span className="media-name">{item.name}</span>
              <span className="media-duration">{formatTime(secondsToTicks(item.duration))}</span>
              <button
                className="media-add"
                onClick={() => onAdd(item.id)}
                title="Adicionar à timeline"
                aria-label="Adicionar à timeline"
              >
                <Plus size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
