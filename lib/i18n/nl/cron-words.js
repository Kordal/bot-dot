// A job's schedule in Dutch words (lib/cron-words.js, ADR 280): an object of the shape of that file's EN, its phrases.
// Dutch writes days and months in lowercase, puts a run of days as "maandag t/m vrijdag" and says the days before
// fixed times with the adverb "maandags". The table every app is tested against is test/fixtures/cron-words.json.
module.exports = (() => {
  const MONTHS = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];
  const SHORT = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
  const WEEK = ['maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag', 'zondag'];
  const up = (s) => s[0].toUpperCase() + s.slice(1);
  return {
    invalid: 'Ongeldig schema', never: 'Draait nooit', custom: 'Aangepast schema', and: 'en', or: 'of',
    span: (a, b) => `${a} t/m ${b}`,
    months: { span: (a, b) => `van ${MONTHS[a]} t/m ${MONTHS[b]}`, list: (l) => `in ${l(MONTHS)}` },
    daysAfter: { span: (a, b) => `${WEEK[a]} t/m ${WEEK[b]}`, list: (l) => `op ${l(WEEK)}` },
    daysBefore: { span: (a, b) => `${up(WEEK[a])} t/m ${WEEK[b]}`, list: (l) => up(l(WEEK.map((d) => `${d}s`))) },
    daily: 'Dagelijks', weekdays: 'Op werkdagen', weekends: 'In het weekend', nightly: '\'s Nachts om 02:00',
    daysOfMonth: (n, text) => `${n === 1 ? 'dag' : 'dagen'} ${text}`,
    onDays: (text) => `op ${text}`,
    onlyIf: (which) => `alleen als het ${which} is`, weekday: 'een werkdag', weekendDay: 'een weekenddag', aDay: (l) => `een ${l(WEEK)}`,
    at: (times) => `om ${times}`, around: (times) => `rond ${times}`,
    monthly: (days) => `Maandelijks op ${days}`,
    once: (day, month, at) => `${day} ${SHORT[month]} om ${at}`,
    everyMinute: 'Elke minuut', everyMin: (n) => `Elke ${n} min`, hourly: 'Elk uur', everyHour: 'Elk uur', everyHours: (n) => `Elke ${n} uur`,
    between: (a, b) => `${a} tot ${b}`, atMinute: (m) => `op minuut ${m}`,
    timesADay: (n, a, b) => `${n} keer per dag, van ${a} tot ${b}`,
  };
})();
