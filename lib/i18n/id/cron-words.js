// A job's schedule in Indonesian words (lib/cron-words.js, ADR 280): an object of the shape of that file's EN, its
// phrases. Indonesian writes a time with a dot ("pukul 09.00", as id-ID does), puts "Tiap" before a repeating day
// ("Tiap Senin") and "sampai" in a span ("Senin sampai Jumat"). The table every app is tested against is
// test/fixtures/cron-words.json.
module.exports = (() => {
  const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const WEEK = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'];
  const dot = (s) => String(s).replace(/(\d\d):(\d\d)/g, '$1.$2'); // "09:00" → "09.00"
  return {
    invalid: 'Jadwal tidak valid', never: 'Tidak pernah berjalan', custom: 'Jadwal khusus', and: 'dan', or: 'atau',
    span: (a, b) => `${a} sampai ${b}`,
    months: { span: (a, b) => `bulan ${MONTHS[a]} sampai ${MONTHS[b]}`, list: (l) => `bulan ${l(MONTHS)}` },
    daysAfter: { span: (a, b) => `${WEEK[a]} sampai ${WEEK[b]}`, list: (l) => l(WEEK) },
    daysBefore: { span: (a, b) => `${WEEK[a]} sampai ${WEEK[b]}`, list: (l) => `Tiap ${l(WEEK)}` },
    daily: 'Tiap hari', weekdays: 'Hari kerja', weekends: 'Akhir pekan', nightly: 'Tiap malam pukul 02.00',
    daysOfMonth: (n, text) => `tanggal ${text}`,
    onDays: (text) => text,
    onlyIf: (which) => `hanya jika ${which}`, weekday: 'hari kerja', weekendDay: 'akhir pekan', aDay: (l) => `hari ${l(WEEK)}`,
    at: (times) => `pukul ${dot(times)}`, around: (times) => `sekitar pukul ${dot(times)}`,
    monthly: (days) => `Tiap bulan ${days}`,
    once: (day, month, at) => `${day} ${SHORT[month]} pukul ${dot(at)}`,
    everyMinute: 'Tiap menit', everyMin: (n) => `Tiap ${n} mnt`, hourly: 'Tiap jam', everyHour: 'Tiap jam', everyHours: (n) => `Tiap ${n} jam`,
    between: (a, b) => `${dot(a)} sampai ${dot(b)}`, atMinute: (m) => `di menit ke-${m}`,
    timesADay: (n, a, b) => `${n} kali sehari, dari ${dot(a)} sampai ${dot(b)}`,
  };
})();
