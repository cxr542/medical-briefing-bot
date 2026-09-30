export const COLLECTION_RUNTIME_SCHEDULE_KST = Object.freeze([
  '08:30',
  '12:07',
  '15:07',
  '17:07',
]);

export const COLLECTION_DISPLAY_SCHEDULE_KST = Object.freeze([
  '08:30',
  '12:00',
  '15:00',
  '17:00',
]);

const kstDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const kstTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Seoul',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const partsOf = (formatter, value) => {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new RangeError('Invalid date');
  return Object.fromEntries(formatter.formatToParts(date).map(part => [part.type, part.value]));
};

const minutesOf = time => {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) throw new RangeError('Invalid KST schedule time');
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) throw new RangeError('Invalid KST schedule time');
  return hours * 60 + minutes;
};

const dateFromKey = dateKey => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) throw new RangeError('Invalid KST date key');
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  if (date.toISOString().slice(0, 10) !== dateKey) throw new RangeError('Invalid KST date key');
  return date;
};

export function getKstDateKey(value = new Date()) {
  const parts = partsOf(kstDateFormatter, value);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function shiftKstDate(dateKey, offsetDays) {
  if (!Number.isInteger(offsetDays)) throw new RangeError('Date offset must be an integer');
  const date = dateFromKey(dateKey);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

export function getLatestCollectionRuntimeTime(value = new Date()) {
  const parts = partsOf(kstTimeFormatter, value);
  const currentMinutes = Number(parts.hour) * 60 + Number(parts.minute);
  const index = COLLECTION_RUNTIME_SCHEDULE_KST.reduce((latest, time, candidate) => (
    minutesOf(time) <= currentMinutes ? candidate : latest
  ), -1);
  return COLLECTION_RUNTIME_SCHEDULE_KST[index < 0 ? 0 : index];
}

export function getLatestCollectionDisplayTime(value = new Date()) {
  const runtimeTime = getLatestCollectionRuntimeTime(value);
  const index = COLLECTION_RUNTIME_SCHEDULE_KST.indexOf(runtimeTime);
  return COLLECTION_DISPLAY_SCHEDULE_KST[index];
}

export function getNextCollectionRuntimeTime(value = new Date()) {
  const parts = partsOf(kstTimeFormatter, value);
  const currentMinutes = Number(parts.hour) * 60 + Number(parts.minute);
  return COLLECTION_RUNTIME_SCHEDULE_KST.find(time => minutesOf(time) > currentMinutes)
    || COLLECTION_RUNTIME_SCHEDULE_KST[0];
}

export function getCollectionCutoffIso(dateKey, runtimeTime) {
  dateFromKey(dateKey);
  minutesOf(runtimeTime);
  const cutoff = new Date(`${dateKey}T${runtimeTime}:59+09:00`);
  if (!Number.isFinite(cutoff.getTime())) throw new RangeError('Invalid collection cutoff');
  return cutoff.toISOString();
}
