import './style.css';

const key = 'yapilacaklar.v1';
const input = document.querySelector('#new-task');
const list = document.querySelector('#tasks');
const error = document.querySelector('#storage-error');
const undo = document.querySelector('#undo');
let tasks = [];
let filter = 'all';
let deleted = null;
const drafts = new Map();
let storageBlocked = false;

function storageError(message) {
  error.textContent = message;
  error.hidden = false;
}
try {
  const raw = localStorage.getItem(key);
  if (raw !== null) {
    const data = JSON.parse(raw);
    if (!Array.isArray(data) || !data.every(t => t && typeof t.id === 'string' && t.id && typeof t.text === 'string' && t.text.trim() && t.text.length <= 500 && typeof t.completed === 'boolean') || new Set(data.map(t => t.id)).size !== data.length) throw new Error('Invalid data');
    tasks = data;
  }
} catch {
  storageBlocked = true;
  storageError('Kayıtlı liste okunamadı. Eski veriler korunuyor. Bu oturumdaki değişiklikler kaydedilmeyecek; tarayıcı depolama ayarlarını kontrol et.');
}
function save() {
  if (storageBlocked) return;
  try {
    localStorage.setItem(key, JSON.stringify(tasks));
    error.hidden = true;
  } catch {
    storageError('Değişiklikler kaydedilemedi. Listen bu sayfada duruyor; sayfayı kapatmadan tarayıcının depolama alanını ve izinlerini kontrol et.');
  }
}
function announce(text) { document.querySelector('#message').textContent = text; }
function button(label, path, action) {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'icon-button'; b.setAttribute('aria-label', label); b.title = label;
  // Only fixed, developer-owned icon paths are inserted as markup.
  b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;
  b.addEventListener('click', action);
  return b;
}
function focusRow(id, selector = 'input') {
  const row = [...list.children].find(el => el.dataset.id === id);
  (row?.querySelector(selector) || input).focus();
}
function render() {
  list.replaceChildren();
  const done = tasks.filter(t => t.completed).length;
  document.querySelectorAll('[data-filter]').forEach(b => {
    b.setAttribute('aria-pressed', String(b.dataset.filter === filter));
    b.querySelector('span').textContent = {all: tasks.length, active: tasks.length - done, done}[b.dataset.filter];
  });
  const visible = tasks.filter(t => filter === 'all' || (filter === 'done' ? t.completed : !t.completed));
  for (const task of visible) {
    const row = document.createElement('li'); row.className = `task${task.completed ? ' completed' : ''}`; row.dataset.id = task.id;
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = task.completed; checkbox.setAttribute('aria-label', `${task.text}: tamamlandı`);
    checkbox.addEventListener('change', () => {
      task.completed = checkbox.checked; save(); render();
      const next = visible[visible.indexOf(task) + 1] || visible[visible.indexOf(task) - 1];
      focusRow(filter === 'all' ? task.id : next?.id); announce(task.completed ? 'Görev tamamlandı.' : 'Görev yapılacaklara taşındı.');
    });
    const text = document.createElement('label'); text.className = 'task-text'; text.textContent = task.text;
    checkbox.id = `task-${tasks.indexOf(task)}`; text.htmlFor = checkbox.id;
    const actions = document.createElement('div'); actions.className = 'actions';
    actions.append(button(`${task.text}: düzenle`, 'm15 4 5 5 M4 20l5-1L20 8a2 2 0 0 0-4-4L5 15z', () => edit(task, row)), button(`${task.text}: sil`, 'M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13 M10 10v7 M14 10v7', () => {
      const index = tasks.indexOf(task);
      deleted = {task, index}; tasks.splice(index, 1); save(); render();
      undo.hidden = false; announce('Görev silindi.');
      const next = visible[visible.indexOf(task) + 1] || visible[visible.indexOf(task) - 1];
      focusRow(next?.id);
    }));
    row.append(checkbox, text, actions); list.append(row);
    if (drafts.has(task.id)) edit(task, row, false);
  }
  const empty = document.querySelector('#empty'); empty.hidden = visible.length > 0;
  empty.querySelector('h2').textContent = tasks.length === 0 ? 'Listen henüz boş.' : filter === 'done' ? 'Henüz tamamlanan görev yok.' : 'Yapılacak görev kalmadı.';
  empty.querySelector('p').textContent = tasks.length === 0 ? 'İlk görevini yukarıya yazıp Enter’a bas.' : filter === 'done' ? 'Bitirdiğin görevleri yanlarındaki kutudan işaretle.' : 'Yeni bir görev ekleyebilir veya tüm listeni görebilirsin.';
}
function edit(task, row, focus = true) {
  if (!drafts.has(task.id)) drafts.set(task.id, task.text);
  const form = document.createElement('form'); form.className = 'edit-form';
  const field = document.createElement('input'); field.value = drafts.get(task.id); field.maxLength = 500; field.required = true; field.setAttribute('aria-label', 'Görev metni');
  const submit = document.createElement('button'); submit.textContent = 'Kaydet'; submit.className = 'text-button'; submit.type = 'submit';
  const cancel = document.createElement('button'); cancel.textContent = 'İptal'; cancel.className = 'text-button'; cancel.type = 'button';
  const close = () => { drafts.delete(task.id); render(); focusRow(task.id, 'button'); };
  cancel.addEventListener('click', close);
  field.addEventListener('input', () => { drafts.set(task.id, field.value); field.setCustomValidity(''); });
  form.addEventListener('submit', e => {
    e.preventDefault();
    if (!field.value.trim()) { field.setCustomValidity('Bir görev yaz.'); field.reportValidity(); return; }
    task.text = field.value.trim(); save(); close(); announce('Görev güncellendi.');
  });
  form.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); close(); } });
  form.append(field, submit, cancel); row.replaceChildren(form);
  if (focus) { field.focus(); field.select(); }
}
document.querySelector('#add-form').addEventListener('submit', e => {
  e.preventDefault();
  if (!input.value.trim()) { input.setCustomValidity('Bir görev yaz.'); input.reportValidity(); return; }
  const id = typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `task-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  tasks.push({id, text: input.value.trim(), completed: false});
  input.value = ''; filter = filter === 'done' ? 'all' : filter;
  save(); render(); input.focus(); announce('Görev eklendi.');
});
input.addEventListener('input', () => input.setCustomValidity(''));
document.querySelectorAll('[data-filter]').forEach(b => b.addEventListener('click', () => { filter = b.dataset.filter; render(); }));
undo.addEventListener('click', () => {
  if (!deleted) return;
  const {task, index} = deleted; tasks.splice(index, 0, task); deleted = null; undo.hidden = true;
  filter = 'all'; save(); render(); focusRow(task.id); announce('Görev geri alındı.');
});
render();
