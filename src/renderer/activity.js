'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  const api = window.activity, view = window.ActivityView;
  const role = new URLSearchParams(location.search).get('role') || 'main';
  const isMain = role === 'main';
  document.body.dataset.role = role;
  let state, day, selectedDate, requestId = 0, editId, initialized = false, dayRevision = -1, loading = false;
  const time = (at) => new Date(at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  const label = (type) => type === 'work' ? '工作' : '休息';
  function error(message) { $('error').textContent = message || ''; $('error').hidden = !message; }
  async function run(fn) {
    try { const result = await fn(); error(state?.failure || ''); return result; }
    catch (err) { error(err.message || String(err)); return undefined; }
  }
  function command(name, value) { return run(() => api.command(name, value)); }
  document.querySelectorAll('[data-command]').forEach((button) => button.addEventListener('click', () => command(button.dataset.command)));
  function render(next) {
    state = next;
    document.documentElement.dataset.theme = next.preferences.theme === 'system' ? (next.dark ? 'dark' : 'light') : next.preferences.theme;
    if (next.failure) error(next.failure);
    $('main').hidden = !isMain; $('due').hidden = role !== 'due'; $('rest').hidden = role !== 'break';
    if (role === 'due') { $('due-status').textContent = `已连续工作 ${view.duration(next.elapsedMs)}，记录仍在继续。`; return; }
    if (role === 'break') { $('rest-clock').textContent = view.clock(next.remainingMs); return; }
    $('phase').textContent = next.suspended ? '已暂停' : { work: '工作中 · 已连续', break: '休息中 · 剩余', waiting: '等待' }[next.phase];
    $('clock').textContent = view.clock(next.phase === 'break' ? next.remainingMs : next.elapsedMs);
    let status = '等待时间不计入统计。准备好后开始工作。';
    if (next.phase === 'work') status = next.reminderDue ? '该休息了。忽略提醒不会结束当前工作记录。' : `下次提醒 ${time(Math.min(next.reminderAt ?? Infinity, next.boundaryAt ?? Infinity))}。`;
    if (next.phase === 'break') status = '休息结束后进入等待，不会自动开始计时。';
    if (next.phase !== 'waiting' && next.boundaryAt) status += ` 固定截止 ${time(next.boundaryAt)}。`;
    $('status').textContent = status;
    for (const id of ['focus', 'focus-hour']) $(id).disabled = next.phase !== 'work' || next.suspended;
    document.querySelectorAll('#main [data-command="stop"]').forEach((button) => { button.disabled = next.phase === 'waiting'; });
    $('add-record').disabled = selectedDate > next.today;
    const template = $('template');
    if (JSON.stringify([...template.options].map((option) => option.value)) !== JSON.stringify(next.templateNames)) {
      template.replaceChildren(...next.templateNames.map((name) => new Option(name, name)));
    }
    template.value = next.todayTemplate;
    $('version').textContent = `v${next.version || '2'}`;
    $('install-update').hidden = next.update?.status !== 'ready';
    $('update-status').textContent = { dev: '开发模式', idle: '', checking: '正在检查', downloading: '正在下载', none: '已是最新', ready: '更新已就绪', error: '更新检查失败' }[next.update?.status] || '';
    if (!initialized) {
      initialized = true; selectedDate = next.today; $('date').value = selectedDate;
      const form = $('preferences').elements;
      for (const key of ['reminderMin', 'breakMin', 'theme']) form[key].value = next.preferences[key];
      for (const key of ['autoStart', 'soundOn']) form[key].checked = next.preferences[key];
      loadDay();
    } else if (dayRevision !== next.revision && !loading) loadDay();
    renderLive();
  }
  function position(node, start, end) {
    const total = day.endAt - day.startAt;
    node.style.top = `${Math.max(0, (start - day.startAt) / total * 100)}%`;
    node.style.height = `${Math.max(0.25, (end - start) / total * 100)}%`;
  }
  function block(record, planned = false) {
    const node = document.createElement(planned || record.ongoing ? 'div' : 'button');
    node.className = `activity-block ${planned ? 'planned' : record.type}${record.ongoing ? ' ongoing' : ''}`;
    const start = planned ? record.startAt : record.startedAt, end = planned ? record.endAt : record.endedAt;
    node.textContent = `${planned ? '计划工作' : label(record.type)} ${time(start)}–${time(end)}${record.ongoing ? ' · 进行中' : ''}`;
    node.title = node.textContent;
    if (!planned && !record.ongoing) node.addEventListener('click', () => openRecord(record));
    position(node, Math.max(start, day.startAt), Math.min(end, day.endAt));
    return node;
  }
  function renderLive() {
    if (!day || !state || !isMain) return;
    const totals = view.totals(day, state);
    $('work-total').textContent = view.duration(totals.work); $('break-total').textContent = view.duration(totals.break);
    const active = view.activeRecord(state, day);
    let node = $('active-record');
    if (!active) { node?.remove(); }
    else {
      if (!node) { node = block(active); node.id = 'active-record'; $('actual-lane').append(node); }
      node.className = `activity-block ${active.type} ongoing`;
      node.textContent = `${label(active.type)} ${time(active.startedAt)}–${time(active.endedAt)} · 进行中`;
      position(node, active.startedAt, active.endedAt);
    }
    $('empty').hidden = day.records.length > 0 || !!active;
  }
  async function loadDay() {
    const id = ++requestId, key = selectedDate; loading = true;
    const result = await run(() => api.day(key));
    if (id === requestId) loading = false;
    if (!result || id !== requestId || key !== selectedDate) return;
    const changedDay = day?.key !== key;
    day = result; dayRevision = result.revision;
    $('calendar').style.height = `${(day.endAt - day.startAt) / 60_000}px`;
    $('plan-label').textContent = `${day.template} · 计划 ${day.plan.length} 段`;
    const hours = [];
    for (let at = day.startAt; at < day.endAt; at += 3600_000) {
      const node = document.createElement('span'); node.textContent = time(at);
      node.style.top = `${(at - day.startAt) / (day.endAt - day.startAt) * 100}%`; hours.push(node);
    }
    $('hours').replaceChildren(...hours);
    $('plan-lane').replaceChildren(...day.plan.map((item) => block(item, true)));
    $('actual-lane').replaceChildren(...day.records.map((record) => block(record)));
    $('records').replaceChildren(...day.records.map((record) => {
      const row = document.createElement('tr');
      const dateTime = (at) => new Date(at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
      for (const value of [label(record.type), dateTime(record.startedAt), dateTime(record.endedAt), view.duration(record.endedAt - record.startedAt)]) {
        const cell = document.createElement('td'); cell.textContent = value; row.append(cell);
      }
      const cell = document.createElement('td'), edit = document.createElement('button');
      edit.textContent = '编辑'; edit.addEventListener('click', () => openRecord(record)); cell.append(edit); row.append(cell); return row;
    }));
    renderLive();
    if (changedDay) {
      const first = Math.min(...day.plan.map((item) => item.startAt), ...day.records.map((item) => item.startedAt), state.today === key ? state.now : Infinity);
      $('calendar-scroll').scrollTop = Number.isFinite(first) ? Math.max(0, (first - day.startAt) / 60_000 - 40) : 480;
    }
  }
  function selectDate(value) { selectedDate = value; $('date').value = value; $('add-record').disabled = value > state.today; loadDay(); }
  $('date').addEventListener('change', () => { if ($('date').value) selectDate($('date').value); });
  for (const [id, step] of [['previous', -1], ['next', 1]]) $(id).addEventListener('click', () => {
    const date = new Date(`${selectedDate}T12:00:00`); date.setDate(date.getDate() + step); selectDate(view.localInput(date.getTime()).slice(0, 10));
  });
  $('today').addEventListener('click', () => selectDate(state.today));
  $('focus').addEventListener('click', () => { if ($('duration').reportValidity()) command('focus', Number($('duration').value)); });
  $('break').addEventListener('click', () => { if ($('duration').reportValidity()) command('startBreak', Number($('duration').value)); });
  $('focus-hour').addEventListener('click', () => command('focus', 60));
  $('break-twenty').addEventListener('click', () => command('startBreak', 20));
  $('template').addEventListener('change', () => run(() => api.selectTodayTemplate($('template').value)));
  $('open-schedule').addEventListener('click', () => run(() => api.openSchedule()));
  $('reload-schedule').addEventListener('click', () => run(() => api.reloadSchedule()));
  $('preferences').addEventListener('submit', (event) => {
    event.preventDefault(); const form = event.currentTarget.elements;
    run(() => api.savePreferences({ reminderMin: Number(form.reminderMin.value), breakMin: Number(form.breakMin.value), theme: form.theme.value, autoStart: form.autoStart.checked, soundOn: form.soundOn.checked }));
  });
  $('check-update').addEventListener('click', () => run(() => api.checkUpdate()));
  $('install-update').addEventListener('click', () => run(() => api.installUpdate()));
  function openRecord(record) {
    editId = record?.id; const form = $('record-form').elements;
    const end = Math.min(state.now, day.endAt, state.startedAt !== null && state.startedAt >= day.startAt ? state.startedAt : Infinity);
    form.type.value = record?.type || 'work';
    form.startedAt.value = view.localInput(record?.startedAt ?? Math.max(day.startAt, end - 30 * 60_000));
    form.endedAt.value = view.localInput(record?.endedAt ?? end);
    $('record-title').textContent = editId ? '编辑活动' : '补录活动';
    $('delete-record').hidden = !editId; $('record-error').hidden = true;
    $('record-dialog').showModal();
  }
  $('add-record').addEventListener('click', () => openRecord());
  $('cancel-record').addEventListener('click', () => $('record-dialog').close());
  async function saveEdit(fn) {
    const buttons = [...$('record-form').querySelectorAll('button')]; buttons.forEach((button) => { button.disabled = true; });
    try { await fn(); $('record-dialog').close(); await loadDay(); }
    catch (err) { $('record-error').textContent = err.message || String(err); $('record-error').hidden = false; }
    finally { buttons.forEach((button) => { button.disabled = false; }); }
  }
  $('record-form').addEventListener('submit', (event) => {
    event.preventDefault(); const form = event.currentTarget.elements;
    saveEdit(() => api.saveRecord({ ...(editId ? { id: editId } : {}), type: form.type.value, startedAt: new Date(form.startedAt.value).getTime(), endedAt: new Date(form.endedAt.value).getTime() }));
  });
  $('delete-record').addEventListener('click', () => { if (confirm('删除这条实际活动记录？')) saveEdit(() => api.deleteRecord(editId)); });
  if (!api) { error('此界面需要通过 Electron 应用启动。'); return; }
  api.onState(render);
  run(async () => render(await api.bootstrap()));
})();
