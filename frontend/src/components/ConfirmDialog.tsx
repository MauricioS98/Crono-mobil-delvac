import { useEffect } from "react";

export type ConfirmDialogVariant = "danger" | "alert";

export interface ConfirmDialogState {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: ConfirmDialogVariant;
  onConfirm: () => void | Promise<void>;
}

interface ConfirmDialogProps {
  state: ConfirmDialogState | null;
  loading?: boolean;
  onClose: () => void;
}

export function ConfirmDialog({ state, loading = false, onClose }: ConfirmDialogProps) {
  useEffect(() => {
    if (!state) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !loading) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state, loading, onClose]);

  if (!state) return null;

  const isAlert = state.variant === "alert";
  const confirmLabel = state.confirmLabel || (isAlert ? "Entendido" : "Eliminar");
  const cancelLabel = state.cancelLabel || "Cancelar";

  const handleConfirm = async () => {
    await state.onConfirm();
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={loading ? undefined : onClose} role="presentation">
      <div
        className={`modal confirm-dialog ${isAlert ? "confirm-alert" : "confirm-danger"}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="confirm-dialog-icon" aria-hidden>
          {isAlert ? "!" : "×"}
        </div>
        <h2 id="confirm-dialog-title">{state.title}</h2>
        <p className="confirm-dialog-message">{state.message}</p>
        <div className="modal-actions confirm-dialog-actions">
          {!isAlert && (
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={loading}>
              {cancelLabel}
            </button>
          )}
          <button
            type="button"
            className={`btn ${isAlert ? "btn-primary" : "btn-danger"}`}
            onClick={() => void handleConfirm()}
            disabled={loading}
          >
            {loading ? "Procesando…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
