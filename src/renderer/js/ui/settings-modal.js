/** Wires the settings <dialog>. Esc closing is handled natively by <dialog>. */
export function mountSettingsModal({ dialog, openButton, closeButton }) {
  openButton.addEventListener('click', () => dialog.showModal());
  closeButton.addEventListener('click', () => dialog.close());

  // Clicking the dimmed backdrop (outside the dialog box) closes it too.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
}
