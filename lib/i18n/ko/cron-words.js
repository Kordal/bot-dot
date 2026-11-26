// A job's schedule in Korean words (lib/cron-words.js, ADR 280): an object of the shape of that file's EN, its
// phrases. Korean puts the month before the day ("9월 28일") and the days before the time ("매주 월요일 10:00"), and a
// range is written with a tilde ("월요일~금요일", "1~5일"). The table every app is tested against is
// test/fixtures/cron-words.json.
module.exports = (() => {
  const MONTHS = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'];
  const WEEK = ['월요일', '화요일', '수요일', '목요일', '금요일', '토요일', '일요일'];
  return {
    invalid: '잘못된 일정', never: '실행되지 않음', custom: '직접 정한 일정', and: '및', or: '또는',
    span: (a, b) => `${a}~${b}`,
    months: { span: (a, b) => `${MONTHS[a]}~${MONTHS[b]}`, list: (l) => l(MONTHS) },
    daysAfter: { span: (a, b) => `${WEEK[a]}~${WEEK[b]}`, list: (l) => `매주 ${l(WEEK)}` },
    daysBefore: { span: (a, b) => `${WEEK[a]}~${WEEK[b]}`, list: (l) => `매주 ${l(WEEK)}` },
    daily: '매일', weekdays: '평일', weekends: '주말', nightly: '매일 밤 02:00',
    daysOfMonth: (n, text) => text.replace(/\d+/g, '$&일').replace(/일~/g, '~'), // "1일 및 15일", "1~5일"
    onDays: (text) => `매월 ${text}`,
    onlyIf: (which) => `${which}인 경우만`, weekday: '평일', weekendDay: '주말', aDay: (l) => l(WEEK),
    at: (times) => times, around: (times) => `${times}쯤`,
    monthly: (days) => `매월 ${days}`,
    once: (day, month, at) => `${MONTHS[month]} ${day}일 ${at}`,
    everyMinute: '1분마다', everyMin: (n) => `${n}분마다`, hourly: '매시간', everyHour: '매시간', everyHours: (n) => `${n}시간마다`,
    between: (a, b) => `${a}~${b}`, atMinute: (m) => `${m}분에`,
    timesADay: (n, a, b) => `하루 ${n}회, ${a}~${b}`,
  };
})();
