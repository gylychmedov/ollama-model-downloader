import { useEffect, useRef, useState } from "react";
import { NavLink, Route, Routes } from "react-router-dom";
import LibraryPage from "./pages/LibraryPage";
import ModelPage from "./pages/ModelPage";
import DownloadsPage from "./pages/DownloadsPage";
import { useDownloads, useInstalled } from "./lib/hooks";
import { formatBytes } from "./lib/format";
import { IconBox, IconDownload, IconGrid } from "./components/icons";

function Header() {
  const { data } = useDownloads();
  const { data: installed } = useInstalled();
  const active = data?.filter((d) => d.status === "downloading") ?? [];
  const ready = data?.filter((d) => d.status === "completed").length ?? 0;
  const speed = active.reduce((s, d) => s + (d.live?.speed ?? 0), 0);

  const tab = ({ isActive }: { isActive: boolean }) =>
    `relative flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium transition ${
      isActive ? "bg-white text-zinc-900 shadow" : "text-zinc-400 hover:text-white"
    }`;

  const [scrolled, setScrolled] = useState(false);
  const progressRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 24);
      const max = document.documentElement.scrollHeight - window.innerHeight;
      if (progressRef.current) progressRef.current.style.transform = `scaleX(${max > 0 ? Math.min(1, window.scrollY / max) : 0})`;
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  const ease = "transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]";

  return (
    <header className={`sticky top-0 z-20 px-3 ${ease} ${scrolled ? "pt-3" : "pt-0"}`}>
      <div
        className={`relative mx-auto flex items-center justify-between gap-4 overflow-hidden border backdrop-blur-xl ${ease} ${
          scrolled
            ? "h-14 max-w-4xl rounded-full border-white/10 bg-zinc-900/75 px-3 shadow-2xl shadow-black/50"
            : "h-16 max-w-7xl rounded-none border-transparent bg-transparent px-1 sm:px-3"
        }`}
      >
        <NavLink to="/" className="flex items-center gap-3">
          <div
            className={`grid place-items-center bg-gradient-to-br from-emerald-400 to-teal-600 text-white shadow-lg shadow-emerald-500/30 ring-1 ring-white/20 ${ease} ${
              scrolled ? "size-8 rounded-full text-base" : "size-9 rounded-xl text-lg"
            }`}
          >
            <IconDownload />
          </div>
          <div className="hidden leading-tight sm:block">
            <div className="font-semibold tracking-tight">Model Downloader</div>
            <div className={`overflow-hidden text-[11px] text-zinc-500 ${ease} ${scrolled ? "max-h-0 opacity-0" : "max-h-4 opacity-100"}`}>
              resumable pulls for Ollama
            </div>
          </div>
        </NavLink>

        <nav className={`flex items-center gap-1 rounded-full border p-1 ${ease} ${scrolled ? "border-transparent bg-transparent" : "border-white/[0.08] bg-white/[0.03]"}`}>
          <NavLink to="/" end className={tab}>
            <IconGrid /> Library
          </NavLink>
          <NavLink to="/downloads" className={tab}>
            <IconDownload /> Downloads
            {active.length + ready > 0 && (
              <span className="grid min-w-5 place-items-center rounded-full bg-emerald-500 px-1.5 text-[11px] font-semibold text-zinc-950">
                {active.length + ready}
              </span>
            )}
          </NavLink>
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          {active.length > 0 && (
            <div className="flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300">
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex size-2 rounded-full bg-emerald-400" />
              </span>
              {formatBytes(speed)}/s
            </div>
          )}
          <div className="flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-xs text-zinc-400">
            <IconBox /> {installed?.length ?? 0} installed
          </div>
        </div>

        <div
          ref={progressRef}
          className={`absolute inset-x-0 bottom-0 h-0.5 origin-left bg-gradient-to-r from-emerald-400 via-teal-400 to-indigo-400 transition-opacity duration-300 ${scrolled ? "opacity-100" : "opacity-0"}`}
          style={{ transform: "scaleX(0)" }}
        />
      </div>
    </header>
  );
}

export default function App() {
  return (
    <div className="relative min-h-screen overflow-x-clip">
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute -top-40 left-1/2 h-[500px] w-[900px] -translate-x-1/2 rounded-full bg-emerald-500/10 blur-3xl" />
        <div className="absolute top-1/3 -right-40 h-[400px] w-[500px] rounded-full bg-indigo-500/10 blur-3xl" />
        <div className="absolute inset-0 bg-[radial-gradient(rgba(255,255,255,0.04)_1px,transparent_1px)] [background-size:24px_24px]" />
      </div>
      <Header />
      <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
        <Routes>
          <Route path="/" element={<LibraryPage />} />
          <Route path="/m/:ns/:name" element={<ModelPage />} />
          <Route path="/downloads" element={<DownloadsPage />} />
        </Routes>
      </main>
    </div>
  );
}
