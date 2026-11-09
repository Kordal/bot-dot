import { days, longDate } from '#lib/changelog.js';

export const load = () => ({ days: days().map((d) => ({ ...d, label: longDate(d.date) })) });
