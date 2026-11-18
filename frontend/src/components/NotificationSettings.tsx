import type { ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useSaveSettings, useSettings } from "../lib/hooks";
import { browserNotificationsSupported, useBrowserNotifications } from "../lib/notifications";
import { Card } from "./ui";

function Toggle({ on, disabled, onChange, label }: { on: boolean; disabled?: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative h-6 w-10 shrink-0 rounded-full ring-1 ring-inset transition disabled:opacity-40 ${on ? "bg-emerald-500 ring-emerald-400/50" : "bg-white/10 ring-white/10"}`}
    >
      <span className={`absolute top-1 left-1 size-4 rounded-full bg-[#fff] shadow transition-transform ${on ? "translate-x-4" : ""}`} />
    </button>
  );
}

function Row({ title, sub, children }: { title: string; sub: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center gap-4 px-5 py-3.5">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{title}</div>
        <div className="text-xs text-zinc-500">{sub}</div>
      </div>
      {children}
    </div>
  );
}

export default function NotificationSettings() {
  const { data } = useSettings();
  const save = useSaveSettings();
  const browser = useBrowserNotifications();
  const test = useMutation({ mutationFn: api.testNotification, onError: (e: Error) => alert(e.message) });
  const supported = browserNotificationsSupported();

  return (
    <Card className="overflow-hidden">
      <div className="divide-y divide-white/[0.05]">
        <Row
          title="Browser notifications"
          sub={supported ? "While this tab is open, in this browser only" : "Needs https or localhost — open the app at http://localhost to use this"}
        >
          <Toggle label="Browser notifications" on={browser.enabled} disabled={!supported} onChange={browser.set} />
        </Row>
        <Row
          title="macOS notifications"
          sub={
            <>
              Sent by the backend, even with the browser closed ·{" "}
              <button disabled={test.isPending} onClick={() => test.mutate()} className="text-emerald-400 hover:underline disabled:opacity-50">
                {test.isPending ? "Sending…" : test.isSuccess ? "Sent — check your screen" : "Send a test"}
              </button>
            </>
          }
        >
          <Toggle label="macOS notifications" on={data?.notifyDesktop ?? false} disabled={!data} onChange={(v) => data && save.mutate({ ...data, notifyDesktop: v })} />
        </Row>
        <Row title="Install automatically" sub="Install into Ollama as soon as a download finishes">
          <Toggle label="Install automatically" on={data?.autoInstall ?? false} disabled={!data} onChange={(v) => data && save.mutate({ ...data, autoInstall: v })} />
        </Row>
      </div>
    </Card>
  );
}
