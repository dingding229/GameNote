"use client";

import { useDialogAccessibility } from "../hooks/use-dialog-accessibility";

type ConfirmationDialogProps = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  onCancel: () => void;
  onConfirm: () => void;
};

export function ConfirmationDialog({
  open,
  title,
  description,
  confirmLabel = "确认删除",
  onCancel,
  onConfirm,
}: ConfirmationDialogProps) {
  const dialogRef = useDialogAccessibility(open, onCancel);
  if (!open) return null;

  return (
    <div className="share-dialog-backdrop" role="presentation" onMouseDown={onCancel}>
      <section
        ref={dialogRef}
        className="login-card confirmation-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirmation-dialog-title"
        aria-describedby="confirmation-dialog-description"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="confirmation-dialog-body">
          <div className="confirmation-dialog-icon" aria-hidden="true">
            !
          </div>
          <div>
            <h2 id="confirmation-dialog-title">{title}</h2>
            <p id="confirmation-dialog-description">{description}</p>
          </div>
        </div>
        <div className="confirmation-dialog-actions">
          <button className="ghost-button" type="button" onClick={onCancel}>
            取消
          </button>
          <button className="danger-button" type="button" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
