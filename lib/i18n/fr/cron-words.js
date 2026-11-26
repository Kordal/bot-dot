// A job's schedule in French words (lib/cron-words.js, ADR 280): an object of the shape of that file's EN, its
// phrases. French puts "le" before a weekday that repeats ("le lundi", "le lundi et le vendredi"), elides "de" before
// a vowel ("d'avril à juin") and says a span of days as "du 1 au 5", which the dictionary's one text per English key
// can't say. The table every app is tested against is test/fixtures/cron-words.json.
module.exports = (() => {
  const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  const DAY = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
  const THE_DAY = DAY.map((d) => `le ${d}`);
  const from = (w) => (/^[aeiouéèêh]/i.test(w) ? `d'${w}` : `de ${w}`); // "d'avril", "de juin"
  const upper = (s) => s[0].toUpperCase() + s.slice(1);
  const nth = (d) => `${d}`.replace(/^1(?![0-9])/, '1er'); // "le 1er", "les 1er et 15"
  return {
    invalid: 'Planning non valide', never: "Ne s'exécute jamais", custom: 'Planning personnalisé', and: 'et', or: 'ou',
    span: (a, b) => `du ${nth(a)} au ${b}`,
    months: { span: (a, b) => `${from(MONTHS[a])} à ${MONTHS[b]}`, list: (l) => `en ${l(MONTHS)}` },
    daysAfter: { span: (a, b) => `du ${DAY[a]} au ${DAY[b]}`, list: (l) => l(THE_DAY) },
    daysBefore: { span: (a, b) => `Du ${DAY[a]} au ${DAY[b]}`, list: (l) => upper(l(THE_DAY)) },
    daily: 'Tous les jours', weekdays: 'En semaine', weekends: 'Le week-end', nightly: 'Chaque nuit à 02:00',
    daysOfMonth: (n, text) => (text.startsWith('du ') ? text : n === 1 ? `le ${nth(text)}` : `les ${nth(text)}`),
    onDays: (text) => text,
    onlyIf: (which) => `seulement si c'est ${which}`, weekday: 'un jour de semaine', weekendDay: 'un jour de week-end', aDay: (l) => `un ${l(DAY)}`,
    at: (times) => `à ${times}`, around: (times) => `vers ${times}`,
    monthly: (days) => `${upper(days)} de chaque mois`,
    once: (day, month, at) => `Le ${nth(day)} ${MONTHS[month]} à ${at}`,
    everyMinute: 'Toutes les minutes', everyMin: (n) => `Toutes les ${n} min`, hourly: 'Toutes les heures', everyHour: 'Toutes les heures', everyHours: (n) => `Toutes les ${n} heures`,
    between: (a, b) => `de ${a} à ${b}`, atMinute: (m) => `à la minute ${m}`,
    timesADay: (n, a, b) => `${n} fois par jour, de ${a} à ${b}`,
  };
})();
