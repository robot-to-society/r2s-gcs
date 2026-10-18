import { IconClose } from "../../shared/ui/icons";
import { useEffect, useState } from "react";
import type { MissionSummaryRow } from "../../shared/api/types";
import type { Dict } from "../../shared/i18n";
import { listMissions } from "./api";

interface Props {
  readonly dict: Dict;
  readonly title: string;
  readonly onPick: (row: MissionSummaryRow) => void;
  readonly onClose: () => void;
  readonly load?: () => Promise<MissionSummaryRow[]>;
}

/** Saved missions as a sheet; used by 開く in the editor and 書込 in the ops panel. */
export function MissionPicker({
  dict,
  title,
  onPick,
  onClose,
  load = listMissions,
}: Props) {
  const [rows, setRows] = useState<MissionSummaryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    load()
      .then((r) => alive && setRows(r))
      .catch(
        (e: unknown) =>
          alive && setError(e instanceof Error ? e.message : String(e)),
      );
    return () => {
      alive = false;
    };
  }, [load]);
  return (
    <aside className="g-strong sheet" aria-label={title} role="dialog">
      <div className="panel-h">
        <span className="h1">{title}</span>
        <span className="grow" />
        <button
          type="button"
          className="btn-icon"
          aria-label={dict.close}
          onClick={onClose}
        >
          <IconClose />
        </button>
      </div>
      {error && <div className="multi-note danger">{error}</div>}
      {rows && rows.length === 0 && (
        <div className="multi-note">{dict.mNoSaved}</div>
      )}
      {rows && rows.length > 0 && (
        <ul className="mission-picker">
          {rows.map((r) => (
            <li key={r.id} onClick={() => onPick(r)} role="button">
              <span>{r.name}</span>
              <span className="meta num">
                {r.item_count} {dict.mItems} ·{" "}
                {new Date(r.updated_at).toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
