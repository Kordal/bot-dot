// A job's schedule in Italian words (lib/cron-words.js, ADR 280): an object of the shape of that file's EN, its
// phrases. Italian puts the article before a weekday that repeats ("il lunedì", "la domenica"), and a time takes
// "dalle … alle". The table every app is tested against is test/fixtures/cron-words.json.
module.exports = (() => {
  const MONTHS = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
  const WEEK = ['lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato', 'domenica'];
  const EVERY = WEEK.map((d) => (d === 'domenica' ? `la ${d}` : `il ${d}`)); // "il lunedì": every Monday
  const up = (s) => s[0].toUpperCase() + s.slice(1);
  const to = (w) => (/^a/.test(w) ? `ad ${w}` : `a ${w}`); // "da giugno ad agosto"
  return {
    invalid: 'Pianificazione non valida', never: 'Non parte mai', custom: 'Pianificazione personalizzata', and: 'e', or: 'o',
    span: (a, b) => `da ${a} a ${b}`,
    months: { span: (a, b) => `da ${MONTHS[a]} ${to(MONTHS[b])}`, list: (l) => `in ${l(MONTHS)}` },
    daysAfter: { span: (a, b) => `da ${WEEK[a]} a ${WEEK[b]}`, list: (l) => l(EVERY) },
    daysBefore: { span: (a, b) => `Da ${WEEK[a]} a ${WEEK[b]}`, list: (l) => up(l(EVERY)) },
    daily: 'Ogni giorno', weekdays: 'Nei giorni feriali', weekends: 'Nel fine settimana', nightly: 'Ogni notte alle 02:00',
    daysOfMonth: (n, text) => `${n === 1 ? 'il giorno' : 'nei giorni'} ${text}`,
    onDays: (text) => text,
    onlyIf: (which) => `solo se è ${which}`, weekday: 'un giorno feriale', weekendDay: 'un giorno del fine settimana', aDay: (l) => l(WEEK),
    at: (times) => `alle ${times}`, around: (times) => `verso le ${times}`,
    monthly: (days) => `Ogni mese ${days}`,
    once: (day, month, at) => `${day} ${MONTHS[month]} alle ${at}`,
    everyMinute: 'Ogni minuto', everyMin: (n) => `Ogni ${n} min`, hourly: 'Ogni ora', everyHour: 'Ogni ora', everyHours: (n) => `Ogni ${n} ore`,
    between: (a, b) => `dalle ${a} alle ${b}`, atMinute: (m) => `al minuto ${m}`,
    timesADay: (n, a, b) => `${n} volte al giorno, dalle ${a} alle ${b}`,
  };
})();
