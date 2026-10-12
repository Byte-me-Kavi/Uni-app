// Dates as students read them, in the phone's language. Each formatter is made once and reused:
// toLocaleDateString builds a new one on every call, which is slow on Android and adds up in lists
// (a date on every file row, three on every kuppi card).

const formatter = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(undefined, options);

const DAY_MONTH = formatter({ day: 'numeric', month: 'short' });
const WEEKDAY_DAY = formatter({ weekday: 'short', day: 'numeric' });
const WEEKDAY_DAY_MONTH = formatter({ weekday: 'short', day: 'numeric', month: 'short' });
const MONTH = formatter({ month: 'short' });
const TIME = formatter({ hour: 'numeric', minute: '2-digit' });
const WHEN = formatter({ weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

const at = (d: Date | string) => (typeof d === 'string' ? new Date(d) : d);

/** "14 Oct" */
export const dayMonth = (d: Date | string) => DAY_MONTH.format(at(d));
/** "Mon 14" */
export const weekdayDay = (d: Date | string) => WEEKDAY_DAY.format(at(d));
/** "Mon 14 Oct" */
export const weekdayDayMonth = (d: Date | string) => WEEKDAY_DAY_MONTH.format(at(d));
/** "Oct" */
export const monthShort = (d: Date | string) => MONTH.format(at(d));
/** "7:00 pm" */
export const timeOfDay = (d: Date | string) => TIME.format(at(d));
/** "Mon 14 Oct, 7:00 pm" */
export const dayAndTime = (d: Date | string) => WHEN.format(at(d));
