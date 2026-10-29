import { log, secret } from '../core/logger.js';
import { appendToLog } from './scroll-log.js';

export const CHAT_MAX_LINES = 500;
const LOCAL_CARD_NAME = 'LOCAL_USR';
const REMOTE_CARD_NAME = 'REMOTE_USR';

const timeFormat = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
  second: '2-digit',
  hour12: true,
});

/** Wires ENCRYPTED_CHAT and the peer card names to a Chat. All peer text goes through textContent. */
export function mountChatPanel({ chat, aliasInput, chatLog, form, messageInput, sendButton, localName, remoteName }) {
  aliasInput.value = chat.alias;
  localName.textContent = chat.alias || LOCAL_CARD_NAME;

  aliasInput.addEventListener('change', () => {
    const alias = chat.setAlias(aliasInput.value);
    aliasInput.value = alias;
    log.info(alias ? `Alias set: ${secret(alias)}` : 'Alias cleared.');
  });
  aliasInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') aliasInput.blur(); // blur fires 'change'
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (chat.send(messageInput.value)) messageInput.value = '';
  });

  chat.addEventListener('message', ({ detail }) => appendMessage(detail));

  chat.addEventListener('ready', ({ detail }) => {
    appendSystem(detail.ready ? '--- SECURE CHANNEL OPEN ---' : '--- CHANNEL CLOSED ---');
    render(detail.ready);
    if (detail.ready) messageInput.focus();
  });

  chat.addEventListener('local-alias', ({ detail }) => {
    localName.textContent = detail.alias || LOCAL_CARD_NAME;
  });

  chat.addEventListener('remote-alias', ({ detail }) => {
    remoteName.textContent = detail.alias ?? REMOTE_CARD_NAME;
  });

  function render(ready) {
    messageInput.disabled = !ready;
    sendButton.disabled = !ready;
    messageInput.placeholder = ready ? '> TYPE MESSAGE...' : '> LINK OFFLINE';
  }

  function appendMessage({ from, alias, text, time }) {
    const line = document.createElement('div');
    line.className = 'chat-line';
    line.title = timeFormat.format(time);

    const name = document.createElement('span');
    name.className = from === 'local' ? 'chat-alias is-local' : 'chat-alias is-remote';
    name.textContent = `[ ${alias} ]`;

    const body = document.createElement('span');
    body.className = 'chat-text';
    body.textContent = text;

    line.append(name, ' > ', body);
    append(line);
  }

  function appendSystem(text) {
    const line = document.createElement('div');
    line.className = 'chat-line chat-system';
    line.textContent = text;
    append(line);
  }

  function append(line) {
    appendToLog(chatLog, line, CHAT_MAX_LINES);
  }

  render(chat.ready);
}
