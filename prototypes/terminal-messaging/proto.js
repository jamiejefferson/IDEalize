// Shared prototype chrome: state toggle (empty / working / done), light-dark
// toggle, and composer focus + send affordance. Prototype-only — not app logic.
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  function setState(s) {
    $$('.v-empty').forEach(el => el.classList.toggle('hidden', s !== 'empty'));
    $$('.v-live').forEach(el => el.classList.toggle('hidden', s === 'empty'));
    $$('.v-working').forEach(el => el.classList.toggle('hidden', s !== 'working'));
    $$('.v-done').forEach(el => el.classList.toggle('hidden', s !== 'done'));
    document.body.dataset.state = s;
    $$('#states button').forEach(b => b.classList.toggle('on', b.dataset.s === s));
  }

  const states = $('#states');
  if (states) states.addEventListener('click', e => {
    const b = e.target.closest('button'); if (b) setState(b.dataset.s);
  });

  const theme = $('#theme');
  if (theme) theme.addEventListener('click', () => document.body.classList.toggle('light'));

  const composer = $('#composer'), input = $('#input'), send = $('#send');
  if (input) {
    const sync = () => { if (send) send.style.display = input.value.trim() ? '' : 'none'; };
    input.addEventListener('focus', () => composer && composer.classList.add('focus'));
    input.addEventListener('blur', () => composer && composer.classList.remove('focus'));
    input.addEventListener('input', sync);
    sync();
  }

  // Default state = whichever toggle is pre-marked .on, else 'working'.
  const initial = ($('#states button.on') || {}).dataset?.s || 'working';
  setState(initial);
})();
