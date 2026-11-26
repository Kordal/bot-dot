// A job's schedule in Simplified Chinese words (lib/cron-words.js, ADR 280): an object of the shape of that file's EN,
// its phrases. Chinese lists with 、 and joins the last two with 和 (或) without spaces, and joins the parts of a schedule
// with ， (lib/cron-words.js: listSep, lastSep, partSep). A day of the month is "5日" ("1、15日"),
// a one-time day "9月28日". The table every app is tested against is test/fixtures/cron-words.json.
module.exports = (() => {
  const MONTHS = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
  const WEEK = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  return {
    invalid: '无效的时间安排', never: '永不运行', custom: '自定义时间', and: '和', or: '或',
    listSep: '、', lastSep: (word) => word, partSep: '，',
    span: (a, b) => `${a}至${b}`,
    months: { span: (a, b) => `${MONTHS[a]}至${MONTHS[b]}`, list: (l) => l(MONTHS) },
    daysAfter: { span: (a, b) => `${WEEK[a]}至${WEEK[b]}`, list: (l) => l(WEEK) },
    daysBefore: { span: (a, b) => `${WEEK[a]}至${WEEK[b]}`, list: (l) => `每${l(WEEK)}` },
    daily: '每天', weekdays: '工作日', weekends: '周末', nightly: '每晚 02:00',
    daysOfMonth: (n, text) => `${text.replace(/和/g, '、')}日`,
    onDays: (text) => `每月${text}`,
    onlyIf: (which) => `仅限${which}`, weekday: '工作日', weekendDay: '周末', aDay: (l) => l(WEEK),
    at: (times) => times, around: (times) => `${times} 左右`,
    monthly: (days) => `每月${days}`,
    once: (day, month, at) => `${MONTHS[month]}${day}日 ${at}`,
    everyMinute: '每分钟', everyMin: (n) => `每 ${n} 分钟`, hourly: '每小时', everyHour: '每小时', everyHours: (n) => `每 ${n} 小时`,
    between: (a, b) => `${a}–${b}`, atMinute: (m) => `第 ${m} 分钟`,
    timesADay: (n, a, b) => `每天 ${n} 次，${a}–${b}`,
  };
})();
