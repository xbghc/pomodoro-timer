/* Preview-only IPC fixture. Never reads or writes application data. */
function installActivityPreview({ phase = 'work', theme = 'light', empty = false, reminderDue = false, failure = '' } = {}) {
  const MIN = 60_000, today = '2026-10-19';
  const at = (hours, minutes = 0) => new Date(`${today}T00:00:00`).getTime() + (hours * 60 + minutes) * MIN;
  const listeners = new Set();
  const preferences = { reminderMin: 50, breakMin: 10, soundOn: true, autoStart: false, theme, dayTemplates: {} };
  let records = empty ? [] : [
    { id: 'morning-work', type: 'work', startedAt: at(10), endedAt: at(10, 45) },
    { id: 'morning-break', type: 'break', startedAt: at(10, 45), endedAt: at(11, 5) },
  ];
  let state = { id: phase === 'waiting' ? null : 'active', phase, startedAt: phase === 'waiting' ? null : at(11, 10),
    now: at(11, 30), today, boundaryAt: phase === 'waiting' ? null : at(12),
    reminderAt: phase === 'work' && !reminderDue ? at(12) : null, reminderDue,
    breakEndsAt: phase === 'break' ? at(11, 40) : null, preferences, templateNames: ['workday', 'off'],
    todayTemplate: 'workday', revision: 0, dark: theme === 'dark', version: '2.0.0-preview',
    update: { status: 'dev' }, suspended: !!failure, failure };
  function snapshot() {
    const deadline = state.phase === 'break' ? state.breakEndsAt : state.reminderAt;
    return structuredClone({ ...state, elapsedMs: state.startedAt === null ? 0 : state.now - state.startedAt,
      remainingMs: deadline === null ? 0 : Math.max(0, Math.min(deadline, state.boundaryAt ?? Infinity) - state.now) });
  }
  function emit() { const value = snapshot(); for (const fn of listeners) fn(value); return value; }
  function transition(next) {
    if (next === state.phase) return;
    if (state.startedAt !== null && state.now > state.startedAt) {
      records.push({ id: state.id, type: state.phase, startedAt: state.startedAt, endedAt: state.now });
      state.revision++;
    }
    Object.assign(state, { phase: next, id: next === 'waiting' ? null : `preview-${Math.random()}`,
      startedAt: next === 'waiting' ? null : state.now, reminderDue: false, reminderAt: null, breakEndsAt: null });
  }
  const unavailable = async () => { throw new Error('此操作需要真实 Electron 应用；预览不会访问本地文件或系统设置。'); };
  window.activity = {
    bootstrap: async () => snapshot(),
    onState: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    day: async (key) => {
      const start = new Date(`${key}T00:00:00`), end = new Date(start); end.setDate(end.getDate() + 1);
      const name = state.preferences.dayTemplates[key] || 'workday';
      const hour = (h) => start.getTime() + h * 60 * MIN;
      return { key, startAt: +start, endAt: +end, template: name, revision: state.revision,
        records: structuredClone(records.filter((r) => r.endedAt > +start && r.startedAt < +end)),
        plan: name === 'off' ? [] : [{ startAt: hour(10), endAt: hour(12) }, { startAt: hour(13.5), endAt: hour(18) }, { startAt: hour(19.5), endAt: hour(22.5) }] };
    },
    command: async (name, value) => {
      if (state.suspended) throw new Error('Preview is paused');
      if (name === 'stop') transition('waiting');
      else if (name === 'startBreak') { transition('break'); state.breakEndsAt = state.now + (value ?? preferences.breakMin) * MIN; }
      else if (name === 'startWork') { transition('work'); state.reminderAt = state.now + preferences.reminderMin * MIN; }
      else if (['focus', 'skipReminder'].includes(name) && state.phase === 'work') {
        state.reminderAt = state.now + (name === 'focus' ? value : 60) * MIN; state.reminderDue = false;
      }
      return emit();
    },
    saveRecord: async (payload) => {
      if (!['work', 'break'].includes(payload.type) || !Number.isFinite(payload.startedAt) || !Number.isFinite(payload.endedAt) || payload.endedAt <= payload.startedAt) throw new Error('Invalid interval');
      if (payload.endedAt > state.now) throw new Error('Actual records cannot be in the future');
      if (state.startedAt !== null && payload.endedAt > state.startedAt) throw new Error('Record overlaps ongoing activity');
      if (records.some((r) => r.id !== payload.id && payload.startedAt < r.endedAt && payload.endedAt > r.startedAt)) throw new Error('Activity records cannot overlap');
      const record = { ...payload, id: payload.id || `manual-${Math.random()}` };
      records = [...records.filter((r) => r.id !== record.id), record].sort((a, b) => a.startedAt - b.startedAt);
      state.revision++; emit(); return structuredClone(record);
    },
    deleteRecord: async (id) => { records = records.filter((r) => r.id !== id); state.revision++; emit(); return true; },
    selectTodayTemplate: async (name) => {
      state.todayTemplate = name; state.preferences.dayTemplates[today] = name;
      if (name === 'off') transition('waiting');
      state.revision++; return emit();
    },
    savePreferences: async (patch) => { Object.assign(preferences, patch); return emit(); },
    openSchedule: unavailable, reloadSchedule: unavailable, checkUpdate: unavailable, installUpdate: unavailable,
  };
}
