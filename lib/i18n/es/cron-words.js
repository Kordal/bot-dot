// A job's schedule in Spanish words (lib/cron-words.js, ADR 280): an object of the shape of that file's EN, its
// phrases. Spanish names a day after "de" and "a" ("de lunes a viernes"), says "los lunes" for every Monday, and "a la"
// before one o'clock but "a las" before any other hour. The table every app is tested against is
// test/fixtures/cron-words.json.
module.exports = (() => {
  const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'];
  const WEEK = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
  const DAYS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados', 'domingos'];
  const hour = (times) => (/^01:\d\d$/.test(times) ? `a la ${times}` : `a las ${times}`);
  return {
    invalid: 'Horario no válido', never: 'Nunca se ejecuta', custom: 'Horario personalizado', and: 'y', or: 'o',
    span: (a, b) => `del ${a} al ${b}`,
    months: { span: (a, b) => `de ${MONTHS[a]} a ${MONTHS[b]}`, list: (l) => `en ${l(MONTHS)}` },
    daysAfter: { span: (a, b) => `de ${WEEK[a]} a ${WEEK[b]}`, list: (l) => `los ${l(DAYS)}` },
    daysBefore: { span: (a, b) => `De ${WEEK[a]} a ${WEEK[b]}`, list: (l) => `Los ${l(DAYS)}` },
    daily: 'Todos los días', weekdays: 'Entre semana', weekends: 'Los fines de semana', nightly: 'Cada noche a las 02:00',
    daysOfMonth: (n, text) => `${n === 1 ? 'el día' : 'los días'} ${text}`,
    onDays: (text) => text,
    onlyIf: (which) => `solo si es ${which}`, weekday: 'día laborable', weekendDay: 'fin de semana', aDay: (l) => l(WEEK),
    at: hour, around: (times) => `hacia ${hour(times).slice(2).trimStart()}`,
    monthly: (days) => `Cada mes ${days}`,
    once: (day, month, at) => `${day} ${SHORT[month]} ${hour(at)}`,
    everyMinute: 'Cada minuto', everyMin: (n) => `Cada ${n} min`, hourly: 'Cada hora', everyHour: 'Cada hora', everyHours: (n) => `Cada ${n} horas`,
    between: (a, b) => `de ${a} a ${b}`, atMinute: (m) => `en el minuto ${m}`,
    timesADay: (n, a, b) => `${n} veces al día, de ${a} a ${b}`,
  };
})();
