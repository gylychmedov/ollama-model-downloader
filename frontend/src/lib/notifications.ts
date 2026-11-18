import { useEffect, useRef, useState } from "react";
import { displayName, type Download } from "./api";
import { useDownloads, useInstalled, useSettings } from "./hooks";

const KEY = "notify.browser";
const EVENT = "notify-browser-change";

export const browserNotificationsSupported = () => "Notification" in window && window.isSecureContext;

function readEnabled() {
  try {
    return localStorage.getItem(KEY) === "1" && browserNotificationsSupported() && Notification.permission === "granted";
  } catch {
    return false;
  }
}

/** Whether this browser should show notifications, and a setter that asks for permission when turning it on. */
export function useBrowserNotifications() {
  const [enabled, setEnabled] = useState(readEnabled);
  useEffect(() => {
    const sync = () => setEnabled(readEnabled());
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const set = async (on: boolean) => {
    if (on) {
      if (!browserNotificationsSupported()) return alert("This browser can only show notifications on https or localhost.");
      const perm = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
      if (perm !== "granted") return alert("Notifications are blocked for this site. Allow them in your browser's site settings.");
    }
    try {
      localStorage.setItem(KEY, on ? "1" : "0");
    } catch {
      /* storage blocked */
    }
    window.dispatchEvent(new Event(EVENT));
  };
  return { enabled, set };
}

function show(title: string, body: string, tag: string) {
  try {
    const n = new Notification(title, { body, tag });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    /* notification constructor unavailable */
  }
}

function message(prev: Download["status"], d: Download, autoInstall: boolean, isUpdate: boolean): [string, string] | null {
  const name = `${displayName(d.model)}:${d.tag}`;
  if (d.status === "error" && prev !== "error") return ["Download failed", `${name}: ${d.error}`];
  if (d.status === "installed" && prev !== "installed") return ["Model installed", `${name} is ready to use in Ollama`];
  if (d.status === "completed" && prev === "installing" && d.error) return ["Install failed", `${name}: ${d.error}`];
  if (d.status === "completed" && prev === "downloading" && !autoInstall && !isUpdate) return ["Download complete", `${name} is ready to install`];
  return null;
}

/** Watches downloads and shows a browser notification when one finishes, fails or gets installed. */
export function useDownloadNotifications() {
  const { enabled } = useBrowserNotifications();
  const { data } = useDownloads();
  const { data: installed } = useInstalled();
  const { data: settings } = useSettings();
  const prev = useRef<Map<number, Download["status"]> | null>(null);

  useEffect(() => {
    if (!data) return;
    const seen = prev.current;
    prev.current = new Map(data.map((d) => [d.id, d.status]));
    if (!seen || !enabled) return;
    for (const d of data) {
      const before = seen.get(d.id);
      if (!before || before === d.status) continue;
      const msg = message(before, d, settings?.autoInstall ?? false, installed?.includes(`${d.model}:${d.tag}`) ?? false);
      if (msg) show(msg[0], msg[1], `download-${d.id}`);
    }
  }, [data, enabled, settings, installed]);
}
