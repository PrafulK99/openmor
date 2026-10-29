// Small inline SVG icons (24×24, stroked with the current text color). No icon font or external file:
// the CSP allows neither. Decorative only, so they are hidden from assistive technology.
/** Icons the page content can name. */
export type IconName =
  | "search"
  | "percent"
  | "bag"
  | "key"
  | "terminal"
  | "page"
  | "markdown"
  | "catalog"
  | "lock"
  | "badge"
  | "repeat"
  | "flask"
  | "gauge"
  | "shield";

const PATHS: Record<IconName | "copy" | "check" | "arrow" | "github" | "info" | "coin" | "external", string[]> = {
  search: ["M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z", "m20 20-4-4"],
  percent: ["M19 5 5 19", "M7 5a2 2 0 1 0 0 4 2 2 0 0 0 0-4z", "M17 15a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"],
  bag: ["M6 8h12l-1 12H7L6 8z", "M9 8V6a3 3 0 0 1 6 0v2"],
  key: ["M8 11a4 4 0 1 0 0 8 4 4 0 0 0 0-8z", "m11 12 8-8", "m16 7 2 2", "m14 9 2 2"],
  terminal: ["m5 8 4 4-4 4", "M12 17h7"],
  page: ["M7 3h7l4 4v14H7z", "M14 3v4h4", "M10 12h5", "M10 16h5"],
  markdown: ["M3 6h18v12H3z", "M6 15V9l2.5 3L11 9v6", "M16 9v6", "m14 13 2 2 2-2"],
  catalog: ["M4 5h16v4H4z", "M4 11h16v4H4z", "M4 17h16v2H4z"],
  lock: ["M6 11h12v9H6z", "M9 11V8a3 3 0 0 1 6 0v3"],
  badge: ["M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z", "m9 12 2 2 4-4"],
  repeat: ["M4 12a8 8 0 0 1 14-5l2 2", "M20 4v5h-5", "M20 12a8 8 0 0 1-14 5l-2-2", "M4 20v-5h5"],
  flask: ["M9 3h6", "M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3", "M8 15h8"],
  gauge: ["M4 16a8 8 0 1 1 16 0", "m12 16 4-5"],
  shield: ["M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z"],
  copy: ["M9 9h11v11H9z", "M5 15H4V4h11v1"],
  check: ["m5 12 5 5 9-10"],
  arrow: ["M5 12h14", "m13 6 6 6-6 6"],
  github: ["M9 19c-4 1-4-2-6-2", "M15 21v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1.1-.3-3.5 1.3a12 12 0 0 0-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21"],
  coin: ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z", "M14.5 9.5c-.5-1-1.400-1.500-2.500-1.500-1.400 0-2.500.700-2.500 1.700 0 2.300 5 1.100 5 3.400 0 1-1.100 1.700-2.500 1.700-1.100 0-2-.500-2.500-1.500", "M12 6.500V8", "M12 16v1.500"],
  external: ["M7 17 17 7", "M8 7h9v9"],
  info: ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z", "M12 11v5", "M12 8h.01"],
};

export type AnyIcon = keyof typeof PATHS;

export function Icon({ name, className }: { name: AnyIcon; className?: string | undefined }) {
  return (
    <svg className={className} width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
