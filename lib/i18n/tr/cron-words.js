// A job's schedule in Turkish words (lib/cron-words.js, ADR 280): an object of the shape of that file's EN, its
// phrases. Turkish puts a suffix on a day after "from" and "to" ("Pazartesiden Cumaya"), and the suffix follows the
// day's last vowel, which the dictionary's one text per English key can't say; the forms are written out here. A
// month is said with "ayları" ("Ocak ve Temmuz aylarında"), so it takes no suffix. The table every app is tested
// against is test/fixtures/cron-words.json.
module.exports = (() => {
  const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
  const DAY = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'];
  const DAY_FROM = ['Pazartesiden', 'Salıdan', 'Çarşambadan', 'Perşembeden', 'Cumadan', 'Cumartesiden', 'Pazardan'];
  const DAY_TO = ['Pazartesiye', 'Salıya', 'Çarşambaya', 'Perşembeye', 'Cumaya', 'Cumartesiye', 'Pazara'];
  const DAYS = ['Pazartesileri', 'Salıları', 'Çarşambaları', 'Perşembeleri', 'Cumaları', 'Cumartesileri', 'Pazarları'];
  const days = { span: (a, b) => `${DAY_FROM[a]} ${DAY_TO[b]}` };
  return {
    invalid: 'Geçersiz zamanlama', never: 'Hiç çalışmaz', custom: 'Özel zamanlama', and: 've', or: 'veya',
    span: (a, b) => `${a}–${b}`,
    months: { span: (a, b) => `${MONTHS[a]}–${MONTHS[b]} aylarında`, list: (l) => `${l(MONTHS)} aylarında` },
    daysAfter: { ...days, list: (l) => `${l(DAY)} günleri` },
    daysBefore: { ...days, list: (l) => l(DAYS) },
    daily: 'Her gün', weekdays: 'Hafta içi', weekends: 'Hafta sonları', nightly: 'Her gece saat 02:00',
    daysOfMonth: (n, text) => `${text.replace(/\d+/g, '$&.')} ${n === 1 ? 'günü' : 'günleri'}`, // "1. ve 15. günleri"
    onDays: (text) => `ayın ${text}`,
    onlyIf: (which) => `yalnızca ${which} ise`, weekday: 'hafta içi bir gün', weekendDay: 'hafta sonu bir gün', aDay: (l) => l(DAY),
    at: (times) => `saat ${times}`, around: (times) => `saat ${times} civarında`,
    monthly: (days) => `Her ayın ${days}`,
    once: (day, month, at) => `${day} ${MONTHS[month]} saat ${at}`,
    everyMinute: 'Her dakika', everyMin: (n) => `${n} dakikada bir`, hourly: 'Saatte bir', everyHour: 'Her saat', everyHours: (n) => `${n} saatte bir`,
    between: (a, b) => `${a}–${b}`, atMinute: (m) => `${m}. dakikada`,
    timesADay: (n, a, b) => `Günde ${n} kez, ${a} ile ${b} arası`,
  };
})();
