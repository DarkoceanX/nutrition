(() => {
  'use strict';
  const menuButton = document.querySelector('#menu-toggle');
  const navigation = document.querySelector('#site-nav');
  if (menuButton && navigation) {
    const closeMenu = (returnFocus = false) => {
      navigation.classList.remove('is-open');
      menuButton.setAttribute('aria-expanded', 'false');
      if (returnFocus) menuButton.focus();
    };
    menuButton.addEventListener('click', () => {
      const open = menuButton.getAttribute('aria-expanded') !== 'true';
      menuButton.setAttribute('aria-expanded', String(open));
      navigation.classList.toggle('is-open', open);
    });
    navigation.addEventListener('click', event => {
      if (event.target.closest('a')) closeMenu();
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && menuButton.getAttribute('aria-expanded') === 'true') closeMenu(true);
    });
    document.addEventListener('click', event => {
      if (!navigation.contains(event.target) && !menuButton.contains(event.target)) closeMenu();
    });
    window.matchMedia('(max-width: 1100px)').addEventListener('change', () => closeMenu());
    menuButton.hidden = false;
    document.documentElement.classList.add('is-enhanced');
  }

  const form = document.querySelector('#booking-form');
  const dialog = document.querySelector('#email-dialog');
  if (!form || !dialog || typeof dialog.showModal !== 'function') return;

  const recipient = 'mariiapshenychna@gmail.com';
  const subject = 'Заявка на консультацию по питанию';
  const nameInput = form.querySelector('#name');
  const topicInput = form.querySelector('#topic');
  const timeInput = form.querySelector('#time');
  const message = document.querySelector('#email-message');
  const emailLink = document.querySelector('#open-email');
  const status = document.querySelector('#email-status');
  const defaultStatus = 'Письмо ещё не отправлено. Отправьте его в почтовом приложении. Если приложение не откроется, скопируйте текст и отправьте вручную.';
  const updateLink = () => {
    emailLink.href = 'mailto:' + recipient + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(message.value);
  };
  // Перехват устанавливается до включения полей. Без скрипта доступен прямой email.
  form.addEventListener('submit', event => {
    event.preventDefault();
    nameInput.setCustomValidity(nameInput.value.trim() ? '' : 'Укажите имя или псевдоним.');
    if (!form.reportValidity()) return;
    const time = timeInput.value.trim();
    message.value = 'Здравствуйте! Хочу записаться на консультацию по питанию.\n\nМеня зовут ' +
      nameInput.value.trim() + '.\nМой запрос: ' + topicInput.value + '.\n' +
      (time ? 'Удобное время для связи: ' + time + '.\n' : '') +
      '\nПодскажите, пожалуйста, стоимость, условия и доступное время для онлайн-встречи.\n\nСпасибо!';
    updateLink();
    status.textContent = defaultStatus;
    dialog.showModal();
  });
  nameInput.addEventListener('input', () => nameInput.setCustomValidity(''));
  message.addEventListener('input', updateLink);
  document.querySelector('#copy-message').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(message.value);
      status.textContent = 'Текст скопирован. Вставьте его в письмо для ' + recipient + ' и отправьте со своей почты.';
    } catch {
      message.focus();
      message.select();
      status.textContent = 'Автоматическое копирование недоступно. Текст выделен: скопируйте его вручную и вставьте в письмо.';
    }
  });
  dialog.querySelector('.dialog-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  });
  form.querySelector('fieldset').disabled = false;
  form.hidden = false;
  document.querySelector('#booking-fallback').hidden = true;
})();
