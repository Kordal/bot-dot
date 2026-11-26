// A job's schedule in Polish words (lib/cron-words.js, ADR 280): an object of the shape of that file's EN, its
// phrases. Polish puts a day or a month in another case after "od", "do" and "w" ("od poniedziałku do piątku", "w
// styczniu"), which the dictionary's one text per English key can't say. The table every app is tested against is
// test/fixtures/cron-words.json.
module.exports = (() => {
  const MONTH_OF = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'];
  const MONTH_IN = ['styczniu', 'lutym', 'marcu', 'kwietniu', 'maju', 'czerwcu', 'lipcu', 'sierpniu', 'wrześniu', 'październiku', 'listopadzie', 'grudniu'];
  const DAY = ['poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota', 'niedziela'];
  const DAY_OF = ['poniedziałku', 'wtorku', 'środy', 'czwartku', 'piątku', 'soboty', 'niedzieli'];
  const DAYS = ['poniedziałki', 'wtorki', 'środy', 'czwartki', 'piątki', 'soboty', 'niedziele'];
  const inDays = (l) => `w ${l(DAYS)}`.replace(/^w w/, 'we w'); // "we wtorki"
  return {
    invalid: 'Nieprawidłowy harmonogram', never: 'Nigdy się nie uruchamia', custom: 'Własny harmonogram', and: 'i', or: 'lub',
    span: (a, b) => `od ${a} do ${b}`,
    months: { span: (a, b) => `od ${MONTH_OF[a]} do ${MONTH_OF[b]}`, list: (l) => `w ${l(MONTH_IN)}` },
    daysAfter: { span: (a, b) => `od ${DAY_OF[a]} do ${DAY_OF[b]}`, list: inDays },
    daysBefore: { span: (a, b) => `Od ${DAY_OF[a]} do ${DAY_OF[b]}`, list: (l) => { const s = inDays(l); return s[0].toUpperCase() + s.slice(1); } },
    daily: 'Codziennie', weekdays: 'W dni robocze', weekends: 'W weekendy', nightly: 'Co noc o 02:00',
    daysOfMonth: (n, text) => `${n === 1 ? 'dnia' : 'dni'} ${text}`,
    onDays: (text) => text,
    onlyIf: (which) => `tylko gdy to ${which}`, weekday: 'dzień roboczy', weekendDay: 'dzień weekendu', aDay: (l) => l(DAY),
    at: (times) => `o ${times}`, around: (times) => `około ${times}`,
    monthly: (days) => `Co miesiąc ${days}`,
    once: (day, month, at) => `${day} ${MONTH_OF[month]} o ${at}`,
    everyMinute: 'Co minutę', everyMin: (n) => `Co ${n} min`, hourly: 'Co godzinę', everyHour: 'Co godzinę', everyHours: (n) => `Co ${n} godz.`,
    between: (a, b) => `od ${a} do ${b}`, atMinute: (m) => `w minucie ${m}`,
    timesADay: (n, a, b) => `${n} razy dziennie, od ${a} do ${b}`,
  };
})();
