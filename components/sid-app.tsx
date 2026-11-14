"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { createClient, type User } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase/client";
import {
  saveSettings,
  useReaderSettings,
  validateSettings,
} from "@/lib/settings";
import { sampleHistory, sampleScan } from "@/lib/sample-scans";
import type { ReaderSettings, Scan } from "@/lib/ui-types";
import { Icon } from "./ui/icon";
import { ScanImage } from "./ui/scan-image";
import { Dialog } from "./ui/dialog";
import { SettingsPanel } from "./settings-panel";
import { ReaderView } from "./reader-view";
import { HistoryList } from "./history-list";
import { AuthDialog } from "./auth-dialog";
import { authErrorMessage } from "@/lib/auth-errors";
import {
  PROCESS_BUCKET,
  MAX_PHOTO_BYTES,
  PHOTO_ACCEPT,
  detectPhotoType,
  photoExtension,
  photoMimeType,
} from "@/lib/scan-upload";

type Screen = "home" | "processing" | "reader" | "history" | "error";
const previewScreens: Record<string, Screen> = {
  reader: "reader",
  photo: "reader",
  processing: "processing",
  history: "history",
  empty: "history",
  delete: "history",
  error: "error",
  offline: "error",
  settings: "reader",
  login: "reader",
};

export function SidApp({ preview = "" }: { preview?: string }) {
  const initial = Object.hasOwn(previewScreens, preview)
    ? previewScreens[preview]
    : "home";
  const isPreview = Object.hasOwn(previewScreens, preview);
  const [screen, setScreen] = useState<Screen>(initial);
  const [modal, setModal] = useState<"settings" | "login" | null>(
    preview === "settings" ? "settings" : preview === "login" ? "login" : null,
  );
  const [current, setCurrent] = useState<Scan | null>(
    initial === "reader" || initial === "processing" || initial === "error"
      ? sampleScan
      : null,
  );
  const [photo, setPhoto] = useState<string>(
    initial === "processing" ? sampleScan.photoUrl : "",
  );
  const [stage, setStage] = useState("Reading");
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const picker = useRef<HTMLInputElement>(null);
  const localPhoto = useRef<string | null>(null);
  const sourceFile = useRef<File | null>(null);
  const processing = useRef<AbortController | null>(null);
  const [photoPreviewFailed, setPhotoPreviewFailed] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const [errorReason, setErrorReason] = useState(
    preview === "offline" ? "No connection" : "Too blurry",
  );
  const [notice, setNotice] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const accountId = useRef<string | null>(null);
  const settingsWrites = useRef<Promise<void>>(Promise.resolve());
  const [previewAccount, setPreviewAccount] = useState(
    ["history", "empty", "delete"].includes(preview),
  );
  const [accountMenu, setAccountMenu] = useState(false);
  const [history, setHistory] = useState<Scan[]>(
    isPreview && preview !== "empty" ? sampleHistory : [],
  );
  const [historyOwner, setHistoryOwner] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [deleting, setDeleting] = useState<Scan | null>(
    preview === "delete" ? sampleHistory[0] : null,
  );
  const [deletingBusy, setDeletingBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [passwordRecovery, setPasswordRecovery] = useState(false);
  const settings = useReaderSettings();
  const metadataName =
    user?.user_metadata?.name ?? user?.user_metadata?.full_name;
  const displayName =
    typeof metadataName === "string" ? metadataName.trim() : "";
  const signedIn = !!user || previewAccount;
  const stopWork = () => {
    processing.current?.abort();
    processing.current = null;
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };
  const home = () => {
    stopWork();
    sourceFile.current = null;
    setScreen("home");
    setModal(null);
    setAccountMenu(false);
    setDragging(false);
  };

  useEffect(
    () => () => {
      processing.current?.abort();
      timers.current.forEach(clearTimeout);
      if (localPhoto.current) URL.revokeObjectURL(localPhoto.current);
    },
    [],
  );
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4500);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (isPreview) return;
    const supabase = getSupabase();
    if (!supabase) return;
    let active = true;
    function receiveUser(next: User | null) {
      if (!active) return;
      if (accountId.current && accountId.current !== next?.id) {
        processing.current?.abort();
        processing.current = null;
        sourceFile.current = null;
        timers.current.forEach(clearTimeout);
        timers.current = [];
        setHistory([]);
        setHistoryOwner(null);
        setCurrent(null);
        setPhoto("");
        setScreen("home");
        setModal(null);
        setAccountMenu(false);
        setDeleting(null);
        window.speechSynthesis?.cancel();
      }
      accountId.current = next?.id ?? null;
      setUser(next && !next.is_anonymous ? next : null);
    }
    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (error) setNotice(authErrorMessage(error));
        receiveUser(data.session?.user ?? null);
      })
      .catch(() => {
        if (active) setNotice("No connection");
      });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      receiveUser(session?.user ?? null);
      if (event === "PASSWORD_RECOVERY") {
        setPasswordRecovery(true);
        setModal("login");
      }
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [isPreview]);
  useEffect(() => {
    if (!user || isPreview) return;
    const supabase = getSupabase();
    if (!supabase) return;
    let active = true;
    supabase
      .from("profiles")
      .select("settings")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (active) {
          if (error) setNotice("Settings not synced");
          else if (data?.settings)
            saveSettings(validateSettings(data.settings));
        }
      });
    return () => {
      active = false;
    };
  }, [user, isPreview]);
  useEffect(() => {
    if (!user || isPreview) return;
    const supabase = getSupabase();
    if (!supabase) return;
    let active = true;
    async function loadHistory() {
      try {
        const { data, error } = await supabase!
          .from("documents")
          .select("id,title,image_path,created_at,status,plain_text")
          .eq("user_id", user!.id)
          .order("created_at", { ascending: false })
          .limit(100);
        if (error) throw error;
        const scans = await Promise.all(
          (data ?? []).map(async (row) => {
            let photoUrl = "";
            const expected = `${user!.id}/${row.id}.jpg`;
            if (row.image_path === expected) {
              const { data: signed } = await supabase!.storage
                .from("scans")
                .createSignedUrl(expected, 300);
              photoUrl = signed?.signedUrl ?? "";
            }
            return {
              id: row.id,
              title: row.title || row.plain_text?.split("\n")[0] || "Scan",
              photoUrl,
              createdAt: row.created_at,
              status: row.status === "ready" ? "ready" : "failed",
              text: row.plain_text ?? "",
              sections: (row.plain_text ?? "")
                .split(/\n\s*\n/)
                .filter(Boolean)
                .map((text: string) => ({ text })),
              imagePath: row.image_path ?? undefined,
            } satisfies Scan;
          }),
        );
        if (active) {
          setHistory(scans);
          setHistoryError(false);
          setHistoryOwner(user!.id);
        }
      } catch {
        if (active) {
          setHistoryError(true);
          setHistoryOwner(user!.id);
        }
      }
    }
    void loadHistory();
    return () => {
      active = false;
    };
  }, [user, isPreview, refresh]);

  async function showFile(file?: File) {
    if (!file) return;
    if (isPreview) {
      setNotice("Open Home to upload a photo");
      return;
    }
    const extension = photoExtension(file);
    if (!extension) {
      setNotice("Use a JPEG, PNG, WebP, or HEIC photo");
      return;
    }
    if (!file.size || file.size > MAX_PHOTO_BYTES) {
      setNotice(
        file.size ? "Photo must be 10 MB or smaller" : "Photo is empty",
      );
      return;
    }
    stopWork();
    const controller = new AbortController();
    processing.current = controller;
    sourceFile.current = file;
    const active = () =>
      processing.current === controller && !controller.signal.aborted;
    setModal(null);
    setAccountMenu(false);
    setDragging(false);
    dragDepth.current = 0;
    if (localPhoto.current) URL.revokeObjectURL(localPhoto.current);
    const url = URL.createObjectURL(file);
    localPhoto.current = url;
    setPhoto(url);
    setPhotoPreviewFailed(false);
    setCurrent(null);
    setScreen("processing");
    setStage("Reading");
    let uploadedPath: string | null = null;
    let cleanup: (() => Promise<boolean>) | null = null;
    try {
      const mime = photoMimeType(extension)!;
      const header = new Uint8Array(await file.slice(0, 64).arrayBuffer());
      if (!active()) return;
      if (detectPhotoType(header) !== mime) {
        setNotice("This file is not a supported photo");
        setErrorReason("Image unreadable");
        setScreen("error");
        return;
      }
      const supabase = getSupabase();
      if (!supabase) throw Error("not_connected");
      const { data: existing, error: sessionError } =
        await supabase.auth.getSession();
      if (sessionError) throw Error("session_failed");
      if (!active()) return;
      let session = existing.session;
      if (!session) {
        const { data, error } = await supabase.auth.signInAnonymously();
        if (error) {
          if (error.code === "anonymous_provider_disabled" && active()) {
            setNotice("Guest scanning unavailable");
          }
          throw Error("session_failed");
        }
        session = data.session;
      }
      if (!active()) return;
      if (!session) throw Error("session_failed");
      const accessToken = session.access_token;
      const owner = session.user.id;
      const id = crypto.randomUUID();
      const path = `${owner}/${id}.${extension}`;
      // Bind uploads and fallback deletion to this session, even if the user
      // changes accounts while the work is in flight.
      const clientFor = (signal: AbortSignal) =>
        createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
          {
            auth: {
              persistSession: false,
              autoRefreshToken: false,
              detectSessionInUrl: false,
            },
            global: {
              headers: { Authorization: `Bearer ${accessToken}` },
              fetch: (input, init) => fetch(input, { ...init, signal }),
            },
          },
        );
      cleanup = async () => {
        try {
          const { error } = await clientFor(AbortSignal.timeout(4000))
            .storage.from(PROCESS_BUCKET)
            .remove([path]);
          return !error;
        } catch {
          return false;
        }
      };
      // Include an upload whose response is lost: its object may still exist.
      uploadedPath = path;
      const { error: uploadError } = await clientFor(
        AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]),
      )
        .storage.from(PROCESS_BUCKET)
        .upload(path, file, { contentType: mime, upsert: false });
      if (uploadError) throw Error("upload_failed");
      if (!active()) return;
      const result = await fetch("/api/process", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ path }),
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(40_000),
        ]),
      });
      const body = await result.json();
      if (!active()) return;
      if (!result.ok || typeof body.text !== "string" || !body.text.trim()) {
        setErrorReason(
          body.error === "blurry"
            ? "Too blurry"
            : body.error === "no_text"
              ? "No text found"
              : body.error === "timeout"
                ? "Taking too long"
                : body.error === "rate_limit"
                  ? "Try again later"
                  : "Try again",
        );
        if (body.error === "rate_limit")
          setNotice("You can scan 10 photos every 10 minutes");
        setScreen("error");
        return;
      }
      const text = body.text.trim();
      setCurrent({
        id,
        title: text.split("\n")[0].slice(0, 120),
        photoUrl: url,
        createdAt: new Date().toISOString(),
        status: "ready",
        text,
        sections: text
          .split(/\n\s*\n/)
          .filter(Boolean)
          .map((text: string) => ({ text })),
      });
      setScreen("reader");
    } catch {
      if (active()) {
        setErrorReason(navigator.onLine ? "Try again" : "No connection");
        setScreen("error");
      }
    } finally {
      // The route also deletes in finally. This covers a failed request to the
      // route, navigation away, or cancellation after Storage accepted a file.
      if (uploadedPath && cleanup && !(await cleanup()) && active()) {
        setNotice("Couldn’t confirm photo cleanup. Try again");
      }
      if (processing.current === controller) processing.current = null;
    }
  }
  const showFileRef = useRef(showFile);
  useEffect(() => {
    showFileRef.current = showFile;
  });
  useEffect(() => {
    function enter(event: DragEvent) {
      if (!event.dataTransfer?.types.includes("Files")) return;
      event.preventDefault();
      dragDepth.current += 1;
      setDragging(true);
    }
    function over(event: DragEvent) {
      if (event.dataTransfer?.types.includes("Files")) {
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }
    }
    function leave(event: DragEvent) {
      if (!event.dataTransfer?.types.includes("Files")) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (!dragDepth.current) setDragging(false);
    }
    function drop(event: DragEvent) {
      event.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      if (document.querySelector("dialog[open]")) return;
      showFileRef.current(event.dataTransfer?.files[0]);
    }
    function paste(event: ClipboardEvent) {
      if (
        document.querySelector("dialog[open]") ||
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement
      )
        return;
      const file = Array.from(event.clipboardData?.items ?? [])
        .find((item) => item.type.startsWith("image/"))
        ?.getAsFile();
      if (file) {
        event.preventDefault();
        showFileRef.current(file);
      }
    }
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    window.addEventListener("paste", paste);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
      window.removeEventListener("paste", paste);
    };
  }, []);
  useEffect(() => {
    if (preview !== "processing") return;
    const timer = setTimeout(() => setStage("Rewriting"), 1500);
    return () => clearTimeout(timer);
  }, [preview]);

  function changeSettings(next: ReaderSettings) {
    if (!saveSettings(next)) setNotice("Settings not saved");
    const supabase = getSupabase();
    if (user && supabase && !isPreview) {
      const owner = user.id;
      settingsWrites.current = settingsWrites.current
        .then(async () => {
          if (accountId.current !== owner) return;
          const { error } = await supabase
            .from("profiles")
            .upsert({ user_id: owner, settings: next });
          if (error) setNotice("Settings not synced");
        })
        .catch(() => setNotice("Settings not synced"));
    }
  }
  async function signOut() {
    if (user) {
      const { error } = await getSupabase()!.auth.signOut();
      if (error) {
        setNotice("Try again");
        return;
      }
    }
    setUser(null);
    setPreviewAccount(false);
    setHistory([]);
    setHistoryOwner(null);
    setCurrent(null);
    setPhoto("");
    home();
    window.speechSynthesis?.cancel();
  }
  async function deleteScan() {
    if (!deleting) return;
    setDeletingBusy(true);
    setDeleteError("");
    try {
      if (!deleting.sample) {
        const supabase = getSupabase();
        if (!supabase || !user) throw Error("unauthorized");
        if (deleting.imagePath) {
          const expected = `${user.id}/${deleting.id}.jpg`;
          if (deleting.imagePath !== expected) throw Error("invalid_path");
          const { error } = await supabase.storage
            .from("scans")
            .remove([expected]);
          if (error) throw error;
        }
        const { error } = await supabase
          .from("documents")
          .delete()
          .eq("id", deleting.id)
          .eq("user_id", user.id);
        if (error) throw error;
      }
      setHistory((items) => items.filter((item) => item.id !== deleting.id));
      if (current?.id === deleting.id) setCurrent(null);
      setDeleting(null);
    } catch {
      setDeleteError("Couldn’t delete");
    } finally {
      setDeletingBusy(false);
    }
  }
  function retry(scan?: Scan) {
    const chosen = scan ?? current;
    if (chosen?.sample) {
      stopWork();
      setPhoto(chosen.photoUrl);
      setCurrent(chosen);
      setScreen("processing");
      setStage("Reading");
      timers.current.push(
        setTimeout(() => setStage("Rewriting"), 700),
        setTimeout(() => {
          setErrorReason("Too blurry");
          setScreen("error");
        }, 1800),
      );
      return;
    }
    if (scan || !sourceFile.current) {
      picker.current?.click();
      return;
    }
    void showFile(sourceFile.current);
  }
  const background = {
    cream: "#FBF4E4",
    peach: "#F3E3CC",
    yellow: "#F6E9A8",
    dark: "#22232B",
  }[settings.background];
  const style = {
    fontFamily:
      settings.font === "OpenDyslexic"
        ? '"OpenDyslexic", "Lexend", system-ui'
        : settings.font === "Lexend"
          ? '"Lexend", system-ui'
          : "Arial, sans-serif",
    "--page-color": background,
    "--panel-color": settings.background === "cream" ? "#F3E3CC" : background,
    "--text-scale": settings.size / 22,
    "--line-scale":
      settings.spacing === "Wide"
        ? 2.1 / 1.7
        : settings.spacing === "Tight"
          ? 1.6 / 1.7
          : 1,
    "--reader-size": `${settings.size}px`,
    "--reader-leading":
      settings.spacing === "Wide"
        ? 2.1
        : settings.spacing === "Tight"
          ? 1.6
          : 1.7,
    "--reader-tracking":
      settings.spacing === "Wide"
        ? ".14em"
        : settings.spacing === "Tight"
          ? "0em"
          : ".065em",
    "--reader-word-spacing":
      settings.spacing === "Wide"
        ? ".4em"
        : settings.spacing === "Tight"
          ? "0em"
          : ".15em",
  } as CSSProperties;
  return (
    <div
      className={`sid-app ${settings.background === "dark" ? "theme-dark" : ""}`}
      style={style}
    >
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className={`navbar ${signedIn ? "has-account" : ""}`}>
        <button
          type="button"
          className="wordmark"
          aria-label="SID home"
          onClick={home}
        >
          <span className="brand-icon" aria-hidden="true">
            <Icon name="document" />
          </span>
          <span className="brand-copy">
            <span className="brand-name">SID</span>
            <span className="brand-subtitle">
              Simplified Information Display
            </span>
          </span>
        </button>
        <nav aria-label="Main navigation">
          {signedIn && (
            <button
              type="button"
              className={`nav-item ${screen === "history" ? "active" : ""}`}
              aria-current={screen === "history" ? "page" : undefined}
              onClick={() => {
                stopWork();
                sourceFile.current = null;
                setScreen("history");
                setAccountMenu(false);
              }}
            >
              <Icon name="history" />
              <span>History</span>
            </button>
          )}
          <button
            type="button"
            className={`nav-item settings-trigger ${modal === "settings" ? "active" : ""}`}
            title="Settings"
            aria-label="Settings"
            aria-haspopup="dialog"
            aria-expanded={modal === "settings"}
            onClick={() => {
              setModal("settings");
              setAccountMenu(false);
            }}
          >
            <Icon name="settings" />
            <span>Settings</span>
          </button>
          {signedIn ? (
            <div className="account-area">
              <button
                type="button"
                className="avatar"
                aria-label={previewAccount ? "Sample account" : "Account"}
                title={
                  previewAccount ? "Sample account" : (user?.email ?? "Account")
                }
                aria-expanded={accountMenu}
                onClick={() => setAccountMenu(!accountMenu)}
              >
                {(displayName[0] ?? user?.email?.[0] ?? "S").toUpperCase()}
              </button>
              {accountMenu && (
                <div className="account-menu">
                  {previewAccount && (
                    <span className="sample-label">Sample</span>
                  )}
                  <button type="button" onClick={() => void signOut()}>
                    <Icon name="logout" />
                    Log out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button
              type="button"
              className="button login-trigger"
              onClick={() => {
                setModal("login");
                setPasswordRecovery(false);
              }}
            >
              Log in
            </button>
          )}
        </nav>
      </header>
      <input
        ref={picker}
        type="file"
        accept={PHOTO_ACCEPT}
        hidden
        aria-label="Upload image"
        onChange={(event) => {
          showFile(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      <main id="main" tabIndex={-1}>
        {screen === "home" && (
          <section className="center-stage home-screen" aria-label="Upload">
            <button
              type="button"
              className="button upload-button"
              aria-describedby="upload-description"
              onClick={() => picker.current?.click()}
            >
              <Icon name="upload" />
              Upload
            </button>
            <p id="upload-description" className="upload-description">
              Upload a photo. We’ll show the words in a clear font with more
              space.
            </p>
          </section>
        )}
        {screen === "processing" && (
          <section
            className="center-stage processing-screen"
            aria-label="Processing"
          >
            <div className="scanning-photo">
              {photoPreviewFailed ? (
                <span className="missing-photo">
                  <Icon name="photo" />
                  Photo preview unavailable
                </span>
              ) : (
                <ScanImage
                  src={photo}
                  alt="Uploaded photo"
                  onError={() => {
                    setPhotoPreviewFailed(true);
                  }}
                />
              )}
              <div className="scan-beam" aria-hidden="true" />
            </div>
            <p role="status" aria-live="polite">
              {stage}
            </p>
            {isPreview && <span className="sample-label">Sample</span>}
          </section>
        )}
        {screen === "reader" && current && (
          <ReaderView
            key={current.id + preview}
            scan={current}
            initialView={preview === "photo" ? "photo" : "text"}
            notify={setNotice}
          />
        )}
        {screen === "history" && signedIn && (
          <HistoryList
            scans={history}
            loading={!isPreview && !!user && historyOwner !== user.id}
            error={historyError}
            onUpload={home}
            onOpen={(scan) => {
              setCurrent(scan);
              if (scan.status === "failed") {
                setErrorReason("Too blurry");
                setScreen("error");
              } else setScreen("reader");
            }}
            onDelete={(scan) => {
              setDeleteError("");
              setDeleting(scan);
            }}
            onRetry={retry}
            onRefresh={() => {
              setHistoryOwner(null);
              setRefresh((n) => n + 1);
            }}
          />
        )}
        {screen === "error" && (
          <section
            className="center-stage error-screen"
            aria-label="Scan error"
          >
            <div className="error-icon">
              <Icon
                name={errorReason === "No connection" ? "offline" : "blur"}
              />
            </div>
            <h1>{errorReason}</h1>
            <button type="button" className="button" onClick={() => retry()}>
              Try again
            </button>
            <button
              type="button"
              className="text-button"
              onClick={() => picker.current?.click()}
            >
              New photo
            </button>
          </section>
        )}
      </main>
      {dragging && (
        <div className="drop-overlay" aria-live="polite">
          <Icon name="upload" />
          <span>Drop</span>
        </div>
      )}
      {notice && (
        <div className="toast" role="status">
          <Icon name="blur" />
          {notice}
        </div>
      )}
      {modal === "settings" && (
        <SettingsPanel
          settings={settings}
          onChange={changeSettings}
          onClose={() => setModal(null)}
        />
      )}
      {modal === "login" && (
        <AuthDialog
          key={passwordRecovery ? "recovery" : "login"}
          preview={isPreview}
          recovery={passwordRecovery}
          onClose={() => {
            setModal(null);
            setPasswordRecovery(false);
          }}
          onSuccess={(message) => {
            setModal(null);
            setPasswordRecovery(false);
            if (message) setNotice(message);
          }}
        />
      )}
      {deleting && (
        <Dialog
          label="Delete scan"
          className="delete-dialog"
          onClose={() => {
            if (!deletingBusy) setDeleting(null);
          }}
        >
          <div className="delete-thumbnail">
            {deleting.photoUrl && (
              <>
                <ScanImage src={deleting.photoUrl} alt="Scan to delete" />
              </>
            )}
          </div>
          <h2>Delete?</h2>
          <div className="delete-actions">
            <button
              type="button"
              className="button outlined"
              disabled={deletingBusy}
              onClick={() => setDeleting(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="button destructive"
              disabled={deletingBusy}
              onClick={() => void deleteScan()}
            >
              <Icon name="trash" />
              {deletingBusy ? "Deleting" : "Delete"}
            </button>
          </div>
          {deleteError && (
            <p className="error-message" role="alert">
              <Icon name="blur" />
              {deleteError}
            </p>
          )}
        </Dialog>
      )}
    </div>
  );
}
