// A job's schedule in Japanese words (lib/cron-words.js, ADR 280): an object of the shape of that file's EN, its
// phrases. Japanese puts the days before the time ("平日 09:00") and a span between two values with "〜". The commas
// and spaces that join the parts are the code's. The table every app is tested against is test/fixtures/cron-words.json.
module.exports = (() => {
  const MONTHS = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
  const WEEK = ['月曜日', '火曜日', '水曜日', '木曜日', '金曜日', '土曜日', '日曜日'];
  return {
    invalid: '無効なスケジュール', never: '実行されません', custom: 'カスタムスケジュール', and: 'と', or: 'または',
    span: (a, b) => `${a}〜${b}`,
    months: { span: (a, b) => `${MONTHS[a]}〜${MONTHS[b]}のみ`, list: (l) => `${l(MONTHS)}のみ` },
    daysAfter: { span: (a, b) => `${WEEK[a]}〜${WEEK[b]}`, list: (l) => l(WEEK) },
    daysBefore: { span: (a, b) => `${WEEK[a]}〜${WEEK[b]}`, list: (l) => `毎週${l(WEEK)}` },
    daily: '毎日', weekdays: '平日', weekends: '週末', nightly: '毎晩 02:00',
    daysOfMonth: (n, text) => `${text}日`,
    onDays: (text) => `毎月${text}`,
    onlyIf: (which) => `${which}の場合のみ`, weekday: '平日', weekendDay: '週末', aDay: (l) => l(WEEK),
    at: (times) => times, around: (times) => `${times}ごろ`,
    monthly: (days) => `毎月${days}`,
    once: (day, month, at) => `${MONTHS[month]}${day}日 ${at}`,
    everyMinute: '毎分', everyMin: (n) => `${n}分ごと`, hourly: '毎時', everyHour: '1時間ごと', everyHours: (n) => `${n}時間ごと`,
    between: (a, b) => `${a}〜${b}`, atMinute: (m) => `${m}分`,
    timesADay: (n, a, b) => `1日${n}回、${a}〜${b}`,
  };
})();
