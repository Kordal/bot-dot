// A job's schedule in Japanese words (lib/cron-words.js, ADR 280): an object of the shape of that file's EN, its
// phrases. Japanese puts the days before the time ("平日 09:00") and a span between two values with "〜". It lists with
// 、 and joins the last two with と (または) without spaces, which lib/cron-words.js's list ("A, B and C") doesn't, so each
// phrase that takes a list puts it right with `jp`; a day of the month is "1日と15日". The commas and spaces that join
// the parts are the code's. The table every app is tested against is test/fixtures/cron-words.json.
module.exports = (() => {
  const MONTHS = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
  const WEEK = ['月曜日', '火曜日', '水曜日', '木曜日', '金曜日', '土曜日', '日曜日'];
  const jp = (s) => String(s).replace(/, /g, '、').replace(/ (と|または) /g, '$1');
  return {
    invalid: '無効なスケジュール', never: '実行されません', custom: 'カスタムスケジュール', and: 'と', or: 'または',
    span: (a, b) => `${a}〜${b}`,
    months: { span: (a, b) => `${MONTHS[a]}〜${MONTHS[b]}のみ`, list: (l) => `${jp(l(MONTHS))}のみ` },
    daysAfter: { span: (a, b) => `${WEEK[a]}〜${WEEK[b]}`, list: (l) => jp(l(WEEK)) },
    daysBefore: { span: (a, b) => `${WEEK[a]}〜${WEEK[b]}`, list: (l) => `毎週${jp(l(WEEK))}` },
    daily: '毎日', weekdays: '平日', weekends: '週末', nightly: '毎晩 02:00',
    daysOfMonth: (n, text) => jp(text).replace(/\d+/g, '$&日'), // "1日と15日", "1日〜5日"
    onDays: (text) => `毎月${text}`,
    onlyIf: (which) => `${which}の場合のみ`, weekday: '平日', weekendDay: '週末', aDay: (l) => jp(l(WEEK)),
    at: (times) => jp(times), around: (times) => `${jp(times)}ごろ`,
    monthly: (days) => `毎月${days}`,
    once: (day, month, at) => `${MONTHS[month]}${day}日 ${at}`,
    everyMinute: '毎分', everyMin: (n) => `${n}分ごと`, hourly: '毎時', everyHour: '1時間ごと', everyHours: (n) => `${n}時間ごと`,
    between: (a, b) => `${a}〜${b}`, atMinute: (m) => `${m}分`,
    timesADay: (n, a, b) => `1日${n}回、${a}〜${b}`,
  };
})();
