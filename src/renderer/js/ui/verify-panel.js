/** VERIFY_CODE box (replaces the remote-payload section while linked) and the chat header tag. */
export function mountVerifyPanel({ verification, els }) {
  const { remoteSection, verifySection, code, okButton, badButton, tag } = els;

  okButton.addEventListener('click', () => verification.markVerified());
  badButton.addEventListener('click', () => verification.reportMismatch());

  verification.addEventListener('change', ({ detail }) => render(detail));

  function render(state) {
    remoteSection.hidden = Boolean(state);
    verifySection.hidden = !state;
    tag.hidden = !state;
    if (!state) return;

    const verified = state.status === 'verified';
    code.textContent = state.code;
    code.classList.toggle('is-verified', verified);
    okButton.disabled = verified;
    okButton.textContent = verified ? 'VERIFIED' : 'MATCH';

    tag.textContent = verified ? '[ VERIFIED ]' : '[ UNVERIFIED ]';
    tag.classList.toggle('is-verified', verified);
    tag.classList.toggle('is-pending', !verified);
  }

  render(verification.state);
}
