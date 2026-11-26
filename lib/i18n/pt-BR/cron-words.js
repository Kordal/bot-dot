// A job's schedule in Brazilian Portuguese words (lib/cron-words.js, ADR 280): an object of the shape of that file's EN,
// its phrases. Portuguese puts an article before a day that depends on the day ("às segundas", "aos sábados"), and
// says a day of the month with "no"/"nos" ("no dia 5", "nos dias 1 e 15"), which the dictionary's one text per English
// key can't say. The table every app is tested against is test/fixtures/cron-words.json.
module.exports = (() => {
  const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const DAY = ['segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo'];
  const DAYS = ['segundas', 'terças', 'quartas', 'quintas', 'sextas', 'sábados', 'domingos'];
  // "às segundas e sextas", "aos sábados": the first day says the article.
  const onDays = (l) => { const s = l(DAYS); return `${/^(sábados|domingos)/.test(s) ? 'aos' : 'às'} ${s}`; };
  const up = (s) => s[0].toUpperCase() + s.slice(1);
  const onDaysOfMonth = (text) => `${text.startsWith('dias') ? 'nos' : 'no'} ${text}`;
  return {
    invalid: 'Agendamento inválido', never: 'Nunca roda', custom: 'Agendamento personalizado', and: 'e', or: 'ou',
    span: (a, b) => `${a} a ${b}`,
    months: { span: (a, b) => `de ${MONTHS[a]} a ${MONTHS[b]}`, list: (l) => `em ${l(MONTHS)}` },
    daysAfter: { span: (a, b) => `de ${DAY[a]} a ${DAY[b]}`, list: onDays },
    daysBefore: { span: (a, b) => `De ${DAY[a]} a ${DAY[b]}`, list: (l) => up(onDays(l)) },
    daily: 'Todo dia', weekdays: 'Em dias úteis', weekends: 'Nos fins de semana', nightly: 'Toda noite às 02:00',
    daysOfMonth: (n, text) => `${n === 1 ? 'dia' : 'dias'} ${text}`,
    onDays: onDaysOfMonth,
    onlyIf: (which) => `só se for ${which}`, weekday: 'dia útil', weekendDay: 'fim de semana', aDay: (l) => l(DAY),
    at: (times) => `às ${times}`, around: (times) => `por volta das ${times}`,
    monthly: (days) => `Todo mês ${onDaysOfMonth(days)}`,
    once: (day, month, at) => `${day} de ${SHORT[month]} às ${at}`,
    everyMinute: 'A cada minuto', everyMin: (n) => `A cada ${n} min`, hourly: 'De hora em hora', everyHour: 'A cada hora', everyHours: (n) => `A cada ${n} horas`,
    between: (a, b) => `das ${a} às ${b}`, atMinute: (m) => `no minuto ${m}`,
    timesADay: (n, a, b) => `${n} vezes por dia, das ${a} às ${b}`,
  };
})();
