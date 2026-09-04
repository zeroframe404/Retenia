/**
 * The lazy boundary for recharts.
 *
 * `@retenia/ui/charts` is a subpath export precisely so this one module can pull it, and
 * `stats-screen.tsx` reaches it only through `lazy()`. Everything recharts drags in — a
 * slice of d3 — therefore lands in the statistics chunk and never in the app's first paint,
 * which matters for a screen most sessions never open.
 */
export { HistogramChart, SeriesChart } from '@retenia/ui/charts'
