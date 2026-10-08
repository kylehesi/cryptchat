/** Wires a <dialog> to its open/close buttons. Esc closing is handled natively by <dialog>. */
export function mountDialog({ dialog, openButton, closeButton }) {
  openButton.addEventListener('click', () => dialog.showModal());
  closeButton.addEventListener('click', () => dialog.close());

  // Clicking the dimmed backdrop (outside the dialog box) closes it too.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
}
