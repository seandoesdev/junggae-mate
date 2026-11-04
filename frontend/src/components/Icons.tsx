/* 화면에서 쓰는 작은 선 아이콘 (예전 화면과 같은 모양). 크기·색은 CSS가 정한다 */
type P = { className?: string };
const base = { viewBox: "0 0 24 24", fill: "none", "aria-hidden": true } as const;

export const SparkIcon = ({ className }: P) => (
  <svg {...base} className={className} strokeWidth={1.8} strokeLinejoin="round"><path d="M12 3.5l1.9 5.2 5.1 1.9-5.1 1.9L12 17.7l-1.9-5.2L5 10.6l5.1-1.9z" /></svg>
);
export const ClipIcon = ({ className }: P) => (
  <svg {...base} className={className} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="m20.5 11.5-8.2 8.2a5 5 0 0 1-7.1-7.1l8.6-8.6a3.4 3.4 0 0 1 4.8 4.8l-8.6 8.6a1.7 1.7 0 0 1-2.4-2.4l7.9-7.9" /></svg>
);
export const SendIcon = ({ className }: P) => (
  <svg {...base} className={className} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M6 11l6-6 6 6" /></svg>
);
export const SearchIcon = ({ className }: P) => (
  <svg {...base} className={className} strokeWidth={2} strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
);
export const ClockIcon = ({ className }: P) => (
  <svg {...base} className={className} strokeWidth={1.8} strokeLinecap="round"><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></svg>
);
export const PlusIcon = ({ className }: P) => (
  <svg {...base} className={className} strokeWidth={2} strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
);
export const ExpandIcon = ({ className }: P) => (
  <svg {...base} className={className} strokeWidth={1.8} strokeLinecap="round"><path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7" /></svg>
);
export const CloseIcon = ({ className }: P) => (
  <svg {...base} className={className} strokeWidth={2} strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
);
export const ChevIcon = ({ className = "chev" }: P) => (
  <svg {...base} className={className} strokeWidth={2} strokeLinecap="round"><path d="m7 10 5 5 5-5" /></svg>
);
export const BrandMark = ({ className = "brand-mark" }: P) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
    <rect width="24" height="24" rx="6" fill="#1b6c80" />
    <path d="M5 8.5 11 5l8 3.2-1.6 8.8L9 19l-4-3.4z" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round" />
    <path d="M11 5l-1 7.2 7.4 4.8M10 12.2 5 16.6" fill="none" stroke="#fff" strokeWidth="1.2" strokeOpacity=".55" />
    <circle cx="10" cy="12.2" r="1.8" fill="#fff" />
  </svg>
);
