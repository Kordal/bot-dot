// A job's schedule in German words (lib/cron-words.js, ADR 280): an object of the shape of that file's EN, its
// phrases. German says a day of the month as an ordinal ("am 5."), and a weekday before a time as an adverb
// ("montags um 10:00"), which the dictionary's one text per English key can't say. The table every app is tested
// against is test/fixtures/cron-words.json.
module.exports = (() => {
  const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
  const MONTH_SHORT = ['Jan.', 'Feb.', 'März', 'Apr.', 'Mai', 'Juni', 'Juli', 'Aug.', 'Sep.', 'Okt.', 'Nov.', 'Dez.'];
  const WEEK = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
  const WEEKLY = ['montags', 'dienstags', 'mittwochs', 'donnerstags', 'freitags', 'samstags', 'sonntags'];
  const first = (s) => s[0].toUpperCase() + s.slice(1);
  const ordinals = (text) => text.replace(/\d+/g, '$&.'); // "1 und 15" → "1. und 15."
  return {
    invalid: 'Ungültiger Zeitplan', never: 'Läuft nie', custom: 'Eigener Zeitplan', and: 'und', or: 'oder',
    span: (a, b) => `${a} bis ${b}`,
    months: { span: (a, b) => `von ${MONTHS[a]} bis ${MONTHS[b]}`, list: (l) => `im ${l(MONTHS)}` },
    daysAfter: { span: (a, b) => `${WEEK[a]} bis ${WEEK[b]}`, list: (l) => l(WEEKLY) },
    daysBefore: { span: (a, b) => `${WEEK[a]} bis ${WEEK[b]}`, list: (l) => first(l(WEEKLY)) },
    daily: 'Täglich', weekdays: 'Werktags', weekends: 'Am Wochenende', nightly: 'Nachts um 02:00',
    daysOfMonth: (n, text) => `am ${ordinals(text)}`,
    onDays: (text) => text,
    onlyIf: (which) => `nur wenn es ${which} ist`, weekday: 'ein Werktag', weekendDay: 'ein Wochenendtag', aDay: (l) => `ein ${l(WEEK)}`,
    at: (times) => `um ${times}`, around: (times) => `gegen ${times}`,
    monthly: (days) => `Monatlich ${days}`,
    once: (day, month, at) => `${day}. ${MONTH_SHORT[month]} um ${at}`,
    everyMinute: 'Jede Minute', everyMin: (n) => `Alle ${n} Min.`, hourly: 'Stündlich', everyHour: 'Jede Stunde', everyHours: (n) => `Alle ${n} Std.`,
    between: (a, b) => `${a} bis ${b}`, atMinute: (m) => `zur Minute ${m}`,
    timesADay: (n, a, b) => `${n}-mal täglich, von ${a} bis ${b}`,
  };
})();
