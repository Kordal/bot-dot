// A job's schedule in Russian words (lib/cron-words.js, ADR 280): an object of the shape of that file's EN, its
// phrases. Russian puts a day or a month in another case after "с", "по" and "в" ("с понедельника по пятницу",
// "по понедельникам", "в январе"), which the dictionary's one text per English key can't say. The table every app is
// tested against is test/fixtures/cron-words.json.
module.exports = (() => {
  const MONTH = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
  const MONTH_OF = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  const MONTH_IN = ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре'];
  const DAY = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'];
  const DAY_OF = ['понедельника', 'вторника', 'среды', 'четверга', 'пятницы', 'субботы', 'воскресенья'];
  const DAY_TO = ['понедельник', 'вторник', 'среду', 'четверг', 'пятницу', 'субботу', 'воскресенье'];
  const DAYS = ['понедельникам', 'вторникам', 'средам', 'четвергам', 'пятницам', 'субботам', 'воскресеньям'];
  const up = (s) => s[0].toUpperCase() + s.slice(1);
  return {
    invalid: 'Неверное расписание', never: 'Никогда не запускается', custom: 'Своё расписание', and: 'и', or: 'или',
    span: (a, b) => `с ${a} по ${b}`,
    months: { span: (a, b) => `с ${MONTH_OF[a]} по ${MONTH[b]}`, list: (l) => `в ${l(MONTH_IN)}` },
    daysAfter: { span: (a, b) => `с ${DAY_OF[a]} по ${DAY_TO[b]}`, list: (l) => `по ${l(DAYS)}` },
    daysBefore: { span: (a, b) => `С ${DAY_OF[a]} по ${DAY_TO[b]}`, list: (l) => up(`по ${l(DAYS)}`) },
    daily: 'Ежедневно', weekdays: 'По будням', weekends: 'По выходным', nightly: 'Каждую ночь в 02:00',
    daysOfMonth: (n, text) => (n === 1 ? `${text}-го числа` : `${text} числа`),
    onDays: (text) => text,
    onlyIf: (which) => `только если это ${which}`, weekday: 'будний день', weekendDay: 'выходной', aDay: (l) => l(DAY),
    at: (times) => `в ${times}`, around: (times) => `около ${times}`,
    monthly: (days) => `Ежемесячно ${days}`,
    once: (day, month, at) => `${day} ${MONTH_OF[month]} в ${at}`,
    everyMinute: 'Каждую минуту', everyMin: (n) => `Каждые ${n} мин`, hourly: 'Каждый час', everyHour: 'Каждый час', everyHours: (n) => `Каждые ${n} ч`,
    between: (a, b) => `с ${a} до ${b}`, atMinute: (m) => `на ${m}-й минуте`,
    timesADay: (n, a, b) => `${n} ${[2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'раза' : 'раз'} в день, с ${a} до ${b}`, // "7 раз", "22 раза"
  };
})();
