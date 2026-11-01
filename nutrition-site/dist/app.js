(() => {
  'use strict';
  const recipient = 'mariiapshenychna@gmail.com';
  const subject = 'Заявка на консультацию по питанию';
  const form = document.querySelector('#booking-form');
  const dialog = document.querySelector('#email-dialog');
  const message = document.querySelector('#email-message');
  const emailLink = document.querySelector('#open-email');
  const status = document.querySelector('#email-status');
  const defaultStatus = 'Письмо ещё не отправлено. Отправьте его в почтовом приложении. Если приложение не откроется, скопируйте текст и отправьте вручную.';
  const updateLink = () => { emailLink.href = `mailto:${recipient}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message.value)}`; };
  form.addEventListener('submit', event => {
    event.preventDefault();
    const nameInput = form.elements.namedItem('name');
    nameInput.setCustomValidity(nameInput.value.trim() ? '' : 'Укажите имя или псевдоним.');
    if (!form.reportValidity()) return;
    const name = nameInput.value.trim();
    const topic = form.elements.namedItem('topic').value;
    const time = form.elements.namedItem('time').value.trim();
    message.value = `Здравствуйте! Хочу записаться на консультацию по питанию.\n\nМеня зовут ${name}.\nМой запрос: ${topic}.\n${time ? `Удобное время для связи: ${time}.\n` : ''}\nПодскажите, пожалуйста, стоимость, условия и доступное время для онлайн-встречи.\n\nСпасибо!`;
    updateLink();
    status.textContent = defaultStatus;
    dialog.showModal();
  });
  form.elements.namedItem('name').addEventListener('input', event => event.target.setCustomValidity(''));
  message.addEventListener('input', updateLink);
  document.querySelector('#copy-message').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(message.value);
      status.textContent = `Текст скопирован. Вставьте его в письмо для ${recipient} и отправьте со своей почты.`;
    } catch {
      message.focus();
      message.select();
      status.textContent = 'Автоматическое копирование недоступно. Текст выделен: скопируйте его вручную и вставьте в письмо.';
    }
  });
  document.querySelectorAll('dialog').forEach(modal => {
    modal.querySelector('.dialog-close').addEventListener('click', () => modal.close());
    modal.addEventListener('click', event => {
      if (event.target !== modal) return;
      const rect = modal.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) modal.close();
    });
  });
  document.querySelector('#privacy-button').addEventListener('click', () => document.querySelector('#privacy-dialog').showModal());
})();
