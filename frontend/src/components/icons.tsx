import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement>;

const base = (d: React.ReactNode) =>
  function Icon(props: P) {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" width="1em" height="1em" {...props}>
        {d}
      </svg>
    );
  };

export const IconDownload = base(<><path d="M12 4v11" /><path d="m7 10 5 5 5-5" /><path d="M5 20h14" /></>);
export const IconSearch = base(<><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>);
export const IconGrid = base(<><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /></>);
export const IconArrowRight = base(<><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>);
export const IconArrowLeft = base(<><path d="M19 12H5" /><path d="m11 6-6 6 6 6" /></>);
export const IconCheck = base(<path d="m5 12 5 5 9-10" />);
export const IconPause = base(<><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></>);
export const IconPlay = base(<path d="M7 5v14l12-7z" />);
export const IconTrash = base(<><path d="M4 7h16" /><path d="M10 11v6M14 11v6" /><path d="M6 7l1 13h10l1-13" /><path d="M9 7V4h6v3" /></>);
export const IconBox = base(<><path d="M12 3 4 7.5v9L12 21l8-4.5v-9z" /><path d="M4 7.5 12 12l8-4.5" /><path d="M12 12v9" /></>);
export const IconBolt = base(<path d="M13 3 5 14h6l-1 7 8-11h-6z" />);
export const IconEye = base(<><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>);
export const IconWrench = base(<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17l3 3 5.3-5.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.5-2.5z" />);
export const IconBrain = base(<><path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 6 0V5a1 1 0 0 0-1-1z" /><path d="M15 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-6 0" /></>);
export const IconLayers = base(<><path d="m12 3 9 5-9 5-9-5z" /><path d="m3 13 9 5 9-5" /></>);
export const IconCloud = base(<path d="M7 18a4 4 0 0 1-.5-8A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9z" />);
export const IconMic = base(<><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></>);
export const IconTerminal = base(<><path d="m5 8 4 4-4 4" /><path d="M12 17h7" /></>);
export const IconRefresh = base(<><path d="M20 11a8 8 0 0 0-14-5l-2 2" /><path d="M4 4v4h4" /><path d="M4 13a8 8 0 0 0 14 5l2-2" /><path d="M20 20v-4h-4" /></>);
export const IconAlert = base(<><path d="M12 3 2 20h20z" /><path d="M12 10v4M12 17h.01" /></>);
export const IconSort = base(<><path d="M4 7h13M4 12h9M4 17h5" /><path d="m16 15 3 3 3-3M19 18V9" /></>);
export const IconChevronDown = base(<path d="m6 9 6 6 6-6" />);
export const IconClock = base(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>);
export const IconExternal = base(<><path d="M14 4h6v6" /><path d="M20 4 10 14" /><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></>);
export const IconBook = base(<><path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z" /><path d="M5 17a3 3 0 0 1 3-3h11" /></>);
export const IconFolder = base(<path d="M4 6a1 1 0 0 1 1-1h4l2 2h8a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" />);
export const IconCopy = base(<><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" /></>);
export const IconUpload = base(<><path d="M12 15V4" /><path d="m7 9 5-5 5 5" /><path d="M5 20h14" /></>);
export const IconUsb = base(<><rect x="7" y="9" width="10" height="12" rx="2" /><path d="M9 9V3h6v6" /><path d="M11 5h.01M13 5h.01" /></>);
export const IconGauge = base(<><path d="M4 18a8 8 0 1 1 16 0" /><path d="m12 18 4-6" /><path d="M12 18h.01" /></>);
export const IconCpu = base(<><rect x="6" y="6" width="12" height="12" rx="2" /><rect x="9.5" y="9.5" width="5" height="5" rx="1" /><path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3" /></>);
export const IconMemory = base(<><rect x="3" y="7" width="18" height="10" rx="1.5" /><path d="M7 7v10M11 7v10M15 7v10" /><path d="M6 17v3M18 17v3" /></>);
export const IconDisk = base(<><ellipse cx="12" cy="6" rx="8" ry="3" /><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6" /><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" /></>);
export const IconStar = base(<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" />);
export const IconSun = base(<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>);
export const IconMoon = base(<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />);
