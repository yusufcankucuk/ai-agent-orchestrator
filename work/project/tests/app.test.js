import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { JSDOM } from 'jsdom';
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const script = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8').replace("import './style.css';", '');
function app({raw, blocked = false, writeFailure = false, crypto = { randomUUID }} = {}) {
  const dom = new JSDOM(html, {url: 'http://localhost:5173', runScripts: 'outside-only'});
  const w = dom.window;
  w.crypto = crypto;
  if (raw) w.localStorage.setItem('yapilacaklar.v1', raw);
  if (blocked) Object.defineProperty(w, 'localStorage', {get() { throw new Error('Blocked'); }});
  if (writeFailure) w.Storage.prototype.setItem = () => { throw new Error('Quota'); };
  w.eval(script);
  const q = selector => w.document.querySelector(selector);
  const add = text => {
    q('#new-task').value = text;
    q('#new-task').dispatchEvent(new w.Event('input'));
    q('#add-form').dispatchEvent(new w.Event('submit', {cancelable:true}));
  };
  const texts = () => [...w.document.querySelectorAll('.task-text')].map(el => el.textContent);
  return {w, q, add, texts};
}
test('task lifecycle, filters, editing, undo and persistence', () => {
  const {w,q,add,texts} = app();
  assert.equal(q('#empty').hidden, false);
  add('   '); assert.deepEqual(texts(), []);
  add('Kitap oku'); add('Yürüyüş yap');
  q('.task button').click();
  q('.edit-form input').value = 'Kitabı bitir';
  q('.edit-form').dispatchEvent(new w.Event('submit', {cancelable:true}));
  assert.deepEqual(texts(), ['Kitabı bitir', 'Yürüyüş yap']);
  q('.task button').click();
  q('.edit-form input').value = 'İptal edilecek';
  q('.edit-form input').dispatchEvent(new w.KeyboardEvent('keydown', {key:'Escape',bubbles:true}));
  assert.equal(texts()[0], 'Kitabı bitir');
  q('.task input').click();
  q('[data-filter=active]').click(); assert.deepEqual(texts(), ['Yürüyüş yap']);
  q('[data-filter=done]').click(); assert.deepEqual(texts(), ['Kitabı bitir']);
  q('[data-filter=all]').click();
  q('.task button:last-child').click();
  add('Yeni görev'); q('#undo').click();
  assert.deepEqual(texts(), ['Kitabı bitir', 'Yürüyüş yap', 'Yeni görev']);
  const restored = app({raw:w.localStorage.getItem('yapilacaklar.v1')});
  assert.deepEqual(restored.texts(), texts());
  assert.equal(restored.q('.task input').checked, true);
  assert.equal(w.document.activeElement, q('.task input'));
});
test('adding without randomUUID or crypto preserves distinct tasks across reload and undo', () => {
  for (const crypto of [{}, null]) {
    const {w, q, add, texts} = app({crypto});
    add('Birinci'); add('İkinci');
    q('.task button:last-child').click();
    add('Üçüncü'); q('#undo').click();
    assert.deepEqual(texts(), ['Birinci', 'İkinci', 'Üçüncü']);
    const raw = w.localStorage.getItem('yapilacaklar.v1');
    const ids = JSON.parse(raw).map(task => task.id);
    assert.equal(new Set(ids).size, 3);
    assert.ok(ids.every(id => typeof id === 'string' && id.length > 0));
    const restored = app({raw, crypto});
    assert.deepEqual(restored.texts(), texts());
    restored.add('Dördüncü');
    assert.equal(restored.texts().length, 4);
    w.close(); restored.w.close();
  }
});
test('task text is inert, including HTML and attribute payloads', () => {
  const {w,q,add,texts} = app();
  const payload = '<img src=x onerror="window.hacked=true">';
  add(payload);
  assert.equal(texts()[0], payload);
  assert.equal(q('#tasks img'), null);
  assert.equal(w.hacked, undefined);
});
test('invalid stored data is preserved and storage failures are visible', () => {
  for (const raw of ['{broken', '{}', '[{"id":"a","text":2,"completed":false}]', '[{"id":"a","text":"x","completed":false},{"id":"a","text":"y","completed":true}]']) {
    const {w,q,add} = app({raw});
    assert.equal(q('#storage-error').hidden, false);
    add('Geçici görev');
    assert.equal(w.localStorage.getItem('yapilacaklar.v1'), raw);
  }
  for (const options of [{blocked:true}, {writeFailure:true}]) {
    const {q,add,texts} = app(options); add('Geçici görev');
    assert.equal(q('#storage-error').hidden, false);
    assert.deepEqual(texts(), ['Geçici görev']);
  }
});

test('editing drafts survive filters, adding and changes to other tasks', () => {
  const {w,q,add} = app();
  add('Birinci'); add('İkinci');
  q('.task button').click();
  q('.edit-form input').value = 'Henüz kaydedilmedi';
  q('.edit-form input').dispatchEvent(new w.Event('input'));
  q('[data-filter=done]').click();
  q('[data-filter=all]').focus();
  q('[data-filter=all]').click();
  assert.equal(q('.edit-form input').value, 'Henüz kaydedilmedi');
  assert.equal(w.document.activeElement, q('[data-filter=all]'));
  add('Üçüncü');
  assert.equal(q('.edit-form input').value, 'Henüz kaydedilmedi');
  q('.task:nth-child(2) input').click();
  assert.equal(q('.edit-form input').value, 'Henüz kaydedilmedi');
  assert.equal(JSON.parse(w.localStorage.getItem('yapilacaklar.v1'))[0].text, 'Birinci');
  q('.edit-form').dispatchEvent(new w.Event('submit', {cancelable:true}));
  assert.equal(q('.task-text').textContent, 'Henüz kaydedilmedi');
  q('.task button').click();
  q('.edit-form input').value = 'Vazgeç';
  q('.edit-form input').dispatchEvent(new w.Event('input'));
  q('.edit-form button:last-child').click();
  q('.task button').click();
  assert.equal(q('.edit-form input').value, 'Henüz kaydedilmedi');
});

test('filtered completion moves focus to adjacent task, then the add field', () => {
  const {w,q,add} = app();
  add('Birinci'); add('İkinci'); add('Üçüncü');
  q('[data-filter=active]').click();
  q('.task:nth-child(2) input').click();
  assert.equal(w.document.activeElement, q('.task:nth-child(2) input'));
  assert.equal(q('.task:nth-child(2) .task-text').textContent, 'Üçüncü');
  q('.task:nth-child(2) input').click();
  assert.equal(w.document.activeElement, q('.task input'));
  q('.task input').click();
  assert.equal(w.document.activeElement, q('#new-task'));
  assert.equal(q('[data-filter=done] span').textContent, '3');
});
