import React, { useEffect, useRef } from "react";

interface ModalProps {
  onClose: () => void;
  children: React.ReactNode;
  maxWidth?: string;
  /** When true, clicking the backdrop and pressing Escape will NOT close the modal.
   *  Use for complex forms where accidental dismissal would lose user input. */
  disableBackdropClose?: boolean;
}

const Modal: React.FC<ModalProps> = ({
  onClose,
  children,
  maxWidth = "860px",
  disableBackdropClose = false,
}) => {
  // Track whether the mousedown originated on the backdrop itself.
  // When the browser's native datetime-local picker closes, it fires a click
  // on whatever is under the cursor (often the backdrop), but the mousedown
  // that opened the picker came from inside the modal — so we must NOT close.
  const mouseDownOnBackdrop = useRef(false);

  useEffect(() => {
    if (disableBackdropClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, disableBackdropClose]);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        mouseDownOnBackdrop.current =
          !disableBackdropClose && e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (
          !disableBackdropClose &&
          e.target === e.currentTarget &&
          mouseDownOnBackdrop.current
        ) {
          onClose();
        }
      }}
    >
      <div className="modal" style={{ maxWidth }}>
        {children}
      </div>
    </div>
  );
};

export default Modal;
