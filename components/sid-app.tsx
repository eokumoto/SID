"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { User } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase/client";
import {
  saveSettings,
  useReaderSettings,
  validateSettings,
} from "@/lib/settings";
import { sampleHistory, sampleScan, proSampleScan } from "@/lib/sample-scans";
import { useAllowance } from "@/lib/use-allowance";
import { useOneLineLabels } from "@/lib/use-one-line";
import { ProDialog } from "./pro-dialog";
import type { ReaderSettings, Scan } from "@/lib/ui-types";
import { Icon } from "./ui/icon";
import { LoadingDots } from "./ui/loading-dots";
import { ScanImage } from "./ui/scan-image";
import { Dialog } from "./ui/dialog";
import { SettingsPanel } from "./settings-panel";
import { ReaderView } from "./reader-view";
import { HistoryList } from "./history-list";
import { AuthDialog } from "./auth-dialog";
import { authErrorMessage } from "@/lib/auth-errors";
import { scanStatus } from "@/lib/scan-state";
import { scanErrorCode, scanErrorCopy, type ScanErrorCode } from "@/lib/scan-errors";
import { originalText, readTextRegions } from "@/lib/transcription";
import {
  clearPendingScan,
  readPendingScan,
  savePendingScan,
} from "@/lib/pending-scan";

type Screen = "home" | "processing" | "reader" | "history" | "error";
type ReaderReturnScreen = "home" | "history";
const MAX_UPRIGHT_IMAGE_DIMENSION = 2200;
const UPLOAD_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

async function prepareUprightImage(file: File) {
  if (!("createImageBitmap" in window)) return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, MAX_UPRIGHT_IMAGE_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) {
      bitmap.close();
      return file;
    }
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
    if (!blob) return file;
    const baseName = file.name.replace(/\.[^.]+$/, "") || "scan";
    return new File([blob], `${baseName}.jpg`, {
      type: "image/jpeg",
      lastModified: file.lastModified,
    });
  } catch {
    return file;
  }
}
const previewScreens: Record<string, Screen> = {
  pro: "reader",
  "pro-menu": "reader",
  "pro-settings": "reader",
  "pro-home": "home",
  "pro-limit": "home",
  limit: "home",
  upgrade: "home",
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
  const [readerReturnScreen, setReaderReturnScreen] =
    useState<ReaderReturnScreen>("home");
  const [homeReturn, setHomeReturn] = useState(false);
  const [modal, setModal] = useState<"settings" | "login" | "help" | "pro" | null>(
    preview === "settings" || preview === "pro-settings" ? "settings" : preview === "login" ? "login" : preview === "upgrade" ? "pro" : null,
  );
  const [current, setCurrent] = useState<Scan | null>(
    initial === "reader" || initial === "processing" || initial === "error"
      ? preview === "pro-menu" ? sampleHistory[1] : preview.startsWith("pro") ? proSampleScan : sampleScan
      : null,
  );
  const [photo, setPhoto] = useState<string>(
    initial === "processing" ? sampleScan.photoUrl : "",
  );
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const picker = useRef<HTMLInputElement>(null);
  const appRoot = useRef<HTMLDivElement>(null);
  const pendingImport = useRef(false);
  const pendingFailures = useRef(0);
  const importPendingScanRef = useRef<(destination: User) => void>(() => {});
  const localPhoto = useRef<string | null>(null);
  // Guests' photos are deleted on the server after each read, so a guest retry re-uploads this copy.
  const lastGuestFile = useRef<File | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const workRun = useRef(0);
  const [errorCode, setErrorCode] = useState<ScanErrorCode>(
    preview === "offline" ? "network" : "blurry",
  );
  const [notice, setNotice] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const accountId = useRef<string | null>(null);
  const settingsWrites = useRef<Promise<void>>(Promise.resolve());
  const [previewAccount, setPreviewAccount] = useState(
    ["history", "empty", "delete"].includes(preview) || preview.startsWith("pro"),
  );
  const [accountMenu, setAccountMenu] = useState(false);
  const [history, setHistory] = useState<Scan[]>(
    isPreview && preview !== "empty" ? sampleHistory : [],
  );
  const [historyOwner, setHistoryOwner] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const { allowance, status: allowanceStatus } = useAllowance(refresh, isPreview);
  const pro = isPreview ? preview.startsWith("pro") : allowance?.plan === "pro";
  const remaining = isPreview ? (preview === "limit" || preview === "pro-limit" ? 0 : pro ? 142 : 3) : allowance?.remaining;
  const outOfUploads = remaining === 0;
  const openPro = () => { setModal("pro"); setAccountMenu(false); };
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
    workRun.current += 1;
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };
  const home = () => {
    stopWork();
    setScreen("home");
    setModal(null);
    setAccountMenu(false);
    setDragging(false);
  };
  const returnHome = () => {
    home();
    setHomeReturn(false);
    requestAnimationFrame(() => {
      setHomeReturn(true);
      window.setTimeout(() => setHomeReturn(false), 360);
    });
  };
  const returnFromReader = () => {
    setModal(null);
    setAccountMenu(false);
    setScreen(readerReturnScreen === "history" && signedIn ? "history" : "home");
  };
  const recordRemovedOverlay = async (documentId: string) => {
    const supabase = getSupabase();
    const { data } = await supabase?.auth.getSession() ?? { data: { session: null } };
    const token = data.session?.access_token;
    if (!token || isPreview) return;
    await fetch("/api/overlay-flag", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ documentId }),
    }).catch(() => undefined);
  };

  useEffect(
    () => () => {
      workRun.current += 1;
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
        workRun.current += 1;
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
      setUser(next);
      if (next && !next.is_anonymous)
        window.setTimeout(() => importPendingScanRef.current(next), 0);
    }
    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (error) setNotice(authErrorMessage(error));
        receiveUser(
          data.session?.user && !data.session.user.is_anonymous
            ? data.session.user
            : null,
        );
      })
      .catch(() => {
        if (active) setNotice("No connection");
      });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      receiveUser(
        session?.user && !session.user.is_anonymous ? session.user : null,
      );
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
    if (!isPreview) void readPendingScan().catch(() => undefined);
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
          else if (data?.settings) {
            const normalized = validateSettings(data.settings);
            saveSettings(normalized);
            if (
              typeof data.settings === "object" &&
              !Array.isArray(data.settings) &&
              "reduceMotion" in data.settings
            ) {
              void supabase.from("profiles").upsert({
                user_id: user.id,
                settings: normalized,
              });
            }
          }
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
          .select("*")
          .eq("user_id", user!.id)
          .order("created_at", { ascending: false })
          .limit(100);
        if (error) throw error;
        const scans = await Promise.all(
          (data ?? []).map(async (row) => {
            const text = originalText(row);
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
              title: row.title || text.split("\n")[0] || "Scan",
              photoUrl,
              createdAt: row.created_at,
              status: scanStatus(row.status, row.processing_started_at),
              text,
              sections: text ? [{ text }] : [],
              imagePath: row.image_path ?? undefined,
              warnings: row.warnings ?? [],
              textRegions: readTextRegions(row.text_regions, text),
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

  function resultToScan(
    row: { id: string; title?: string | null; created_at?: string; status?: string; plain_text?: string | null; ocr_text?: string | null; gemini_source_text?: string | null; image_path?: string | null; warnings?: string[]; text_regions?: unknown },
    photoUrl: string,
  ): Scan {
    const text = originalText(row);
    return {
      id: row.id,
      title: row.title || text.split("\n")[0] || "Scan",
      photoUrl,
      createdAt: row.created_at ?? new Date().toISOString(),
      status: row.status === "ready" ? "ready" : "failed",
      text,
      sections: text ? [{ text }] : [],
      imagePath: row.image_path ?? undefined,
      warnings: row.warnings ?? [],
      textRegions: readTextRegions(row.text_regions, text),
    };
  }

  async function processDocument(
    documentId: string,
    photoUrl: string,
    run: number,
    sourceFile?: File,
  ) {
    const supabase = getSupabase();
    if (!supabase) throw new Error("network");
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) throw new Error("network");
    const response = await fetch("/api/process", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ documentId }),
    });
    let body: unknown = await response.json().catch(() => null);
    setRefresh(count => count + 1);
    if (run !== workRun.current) return;
    const code = body && typeof body === "object" && "error" in body ? (body as { error?: unknown }).error : "";
    if (response.status === 429 && code === "daily_limit") {
      setProcessingId(null);
      setScreen("home");
      setNotice("Your uploads reset at midnight UTC");
      return;
    }
    // Another tab may own the attempt. Observe it without admitting new work.
    if (response.status === 409 && code === "already_processing") {
      const until = Date.now() + 120_000;
      while (Date.now() < until) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        if (run !== workRun.current) return;
        const { data: row, error } = await supabase.from("documents").select("*").eq("id", documentId).eq("user_id", sessionData.session!.user.id).maybeSingle();
        if (run !== workRun.current) return;
        if (error) throw new Error("network");
        if (!row) throw new Error("server");
        if (row.status === "ready") { body = { document: row }; break; }
        if (scanStatus(row.status, row.processing_started_at) === "failed") throw new Error(row.error === "timeout" || row.status === "processing" ? "timeout" : "server");
      }
    }
    if (!body || typeof body !== "object" || !("document" in body)) {
      const code = body && typeof body === "object" && "error" in body ? (body as { error?: unknown }).error : "";
      throw new Error(scanErrorCode(code));
    }
    const scan = resultToScan((body as { document: Parameters<typeof resultToScan>[0] }).document, photoUrl);
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setProcessingId(null);
    setCurrent(scan);
    if (!user && sourceFile) {
      const storedScan = { ...scan };
      delete (storedScan as Partial<Scan>).photoUrl;
      try {
        await savePendingScan({
          createdAt: Date.now(),
          file: sourceFile,
          fileName: sourceFile.name,
          scan: storedScan as Omit<Scan, "photoUrl">,
        });
      } catch {
        // A scan still works when private browser storage is unavailable.
      }
    }
    if (user) setRefresh((count) => count + 1);
    setScreen("reader");
  }

  async function importPendingScan(destination: User) {
    if (pendingImport.current || isPreview) return;
    pendingImport.current = true;
    try {
      const pending = await readPendingScan();
      if (!pending) return;
      const supabase = getSupabase();
      if (!supabase) return;
      const id = crypto.randomUUID();
      const imagePath = `${destination.id}/${id}.jpg`;
      const { error: uploadError } = await supabase.storage
        .from("scans")
        .upload(imagePath, pending.file, {
          contentType: pending.file.type,
          upsert: false,
        });
      if (uploadError) throw uploadError;
      const fields = {
        id,
        image_path: imagePath,
        title: pending.scan.title,
        status: "ready",
        ocr_text: pending.scan.text,
        plain_text: pending.scan.text,
        flags: [],
        key_terms: [],
        warnings: pending.scan.warnings ?? [],
        text_regions: pending.scan.textRegions ?? [],
      };
      let { error: insertError } = await supabase
        .from("documents")
        .insert(fields);
      if (insertError?.code === "PGRST204" || insertError?.code === "42703") {
        ({ error: insertError } = await supabase.from("documents").insert({
          ...fields,
          text_regions: undefined,
        }));
      }
      if (insertError) {
        await supabase.storage.from("scans").remove([imagePath]);
        throw insertError;
      }
      await clearPendingScan();
      pendingFailures.current = 0;
      const photoUrl = URL.createObjectURL(pending.file);
      localPhoto.current = photoUrl;
      setPhoto(photoUrl);
      setCurrent({ ...pending.scan, id, imagePath, photoUrl });
      setRefresh((count) => count + 1);
    } catch {
      pendingFailures.current += 1;
      if (pendingFailures.current > 1) setNotice("Couldn’t save this scan yet");
    } finally {
      pendingImport.current = false;
    }
  }
  useEffect(() => {
    importPendingScanRef.current = (destination) => {
      void importPendingScan(destination);
    };
  });

  async function showFile(file?: File) {
    if (!file) return;
    if (outOfUploads) { setNotice("No uploads left today"); home(); return; }
    if (isPreview) {
      setNotice("Sample preview only");
      return;
    }
    // Accept anything the browser can decode (HEIC, AVIF, GIF, ...): it is re-encoded to JPEG below.
    // Some browsers leave HEIC's type empty, so fall back to the extension.
    if (!file.type.startsWith("image/") && !/\.(heic|heif|avif)$/i.test(file.name)) {
      setErrorCode("wrong_type");
      setScreen("error");
      return;
    }
    stopWork();
    const run = workRun.current;
    setReaderReturnScreen(screen === "history" ? "history" : "home");
    setModal(null);
    setAccountMenu(false);
    setDragging(false);
    dragDepth.current = 0;
    setScreen("processing");
    const preparedFile = await prepareUprightImage(file);
    lastGuestFile.current = preparedFile;
    if (run !== workRun.current) return;
    // Validate the re-encoded file, which is what is actually uploaded. If the browser
    // couldn't decode the original, it comes back unchanged and must already be a supported type.
    if (!UPLOAD_TYPES.includes(preparedFile.type) || preparedFile.size > MAX_UPLOAD_BYTES) {
      setErrorCode(UPLOAD_TYPES.includes(preparedFile.type) ? "too_big" : "wrong_type");
      setScreen("error");
      return;
    }
    if (localPhoto.current) URL.revokeObjectURL(localPhoto.current);
    const url = URL.createObjectURL(preparedFile);
    localPhoto.current = url;
    setPhoto(url);
    setCurrent(null);
    setProcessingId(null);
    try {
      const supabase = getSupabase();
      if (!supabase) throw new Error("network");
      let { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) {
        const { data, error } = await supabase.auth.signInAnonymously();
        if (error || !data.session) throw new Error("network");
        sessionData = { session: data.session };
      }
      const ownerId = sessionData.session.user.id;
      if (run !== workRun.current) return;
      const documentId = crypto.randomUUID();
      const imagePath = `${ownerId}/${documentId}.jpg`;
      const { error: uploadError } = await supabase.storage.from("scans").upload(imagePath, preparedFile, {
        contentType: preparedFile.type,
        upsert: false,
      });
      if (uploadError) throw new Error("network");
      if (run !== workRun.current) {
        await supabase.storage.from("scans").remove([imagePath]);
        return;
      }
      const { error: insertError } = await supabase.from("documents").insert({
        id: documentId,
        image_path: imagePath,
      });
      if (insertError) {
        await supabase.storage.from("scans").remove([imagePath]);
        throw new Error("server");
      }
      if (run !== workRun.current) return;
      setProcessingId(documentId);
      await processDocument(documentId, url, run, preparedFile);
    } catch (error) {
      if (run !== workRun.current) return;
      setErrorCode(scanErrorCode(error instanceof Error ? error.message : "server"));
      setScreen("error");
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
      timers.current.push(
        setTimeout(() => {
          setErrorCode("blurry");
          setScreen("error");
        }, 1800),
      );
      return;
    }
    if (!user && lastGuestFile.current) {
      void showFile(lastGuestFile.current);
      return;
    }
    const documentId = chosen?.id ?? processingId;
    if (!documentId) {
      picker.current?.click();
      return;
    }
    stopWork();
    const run = workRun.current;
    setProcessingId(documentId);
    setPhoto(chosen?.photoUrl || photo);
    setScreen("processing");
    void processDocument(documentId, chosen?.photoUrl || photo, run).catch((error) => {
      if (run !== workRun.current) return;
      setErrorCode(scanErrorCode(error instanceof Error ? error.message : "server"));
      setScreen("error");
    });
  }
  const background = {
    cream: "#FBF4E4",
    peach: "#F3E3CC",
    dark: "#22232B",
    navy: "#1F2A44",
  }[settings.background];
  useOneLineLabels(appRoot, settings);
  // Match the phone's status/browser bar to the navbar (page color with 8% accent, as in globals.css).
  useEffect(() => {
    const accent = settings.background === "dark" || settings.background === "navy" ? "#F6D88A" : "#2F4B7C";
    const mix = (a: string, b: string, i: number) =>
      Math.round(parseInt(a.slice(1 + i * 2, 3 + i * 2), 16) * 0.92 + parseInt(b.slice(1 + i * 2, 3 + i * 2), 16) * 0.08);
    const navbarColor = `rgb(${[0, 1, 2].map((i) => mix(background, accent, i)).join(" ")})`;
    const root = document.documentElement;
    root.style.backgroundColor = background;
    root.style.colorScheme = settings.background === "dark" || settings.background === "navy" ? "dark" : "light";
    let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "theme-color";
      document.head.appendChild(meta);
    }
    meta.content = navbarColor;
  }, [background, settings.background]);
  const spacing = {
    Tight: { leading: 1.6, tracking: "0em", wordSpacing: "0em" },
    "Slightly tight": {
      leading: 1.65,
      tracking: ".03em",
      wordSpacing: ".06em",
    },
    Normal: { leading: 1.7, tracking: ".065em", wordSpacing: ".15em" },
    "Slightly wide": {
      leading: 1.9,
      tracking: ".10em",
      wordSpacing: ".28em",
    },
    Wide: { leading: 2.1, tracking: ".14em", wordSpacing: ".4em" },
  }[settings.spacing];
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
    "--line-scale": spacing.leading / 1.7,
    "--reader-size": `${settings.size}px`,
    "--reader-leading": spacing.leading,
    "--reader-tracking": spacing.tracking,
    "--reader-word-spacing": spacing.wordSpacing,
  } as CSSProperties;
  return (
    <div
      ref={appRoot}
      className={`sid-app ${settings.background === "dark" ? "theme-dark" : ""} ${settings.background === "navy" ? "theme-navy" : ""} ${settings.background === "peach" ? "theme-peach" : ""}`}
      style={style}
    >
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className={`navbar ${signedIn ? "has-account" : ""} ${screen === "reader" ? "reader-open" : ""}`}>
        <div
          className={`reader-back-slot ${screen === "reader" ? "is-visible" : ""}`}
          aria-hidden={screen !== "reader"}
        >
          <button
            type="button"
            className="reader-back-button"
            aria-label="Back"
            tabIndex={screen === "reader" ? 0 : -1}
            onClick={returnFromReader}
          >
            <Icon name="back" />
          </button>
        </div>
        <button
          type="button"
          className="wordmark"
          aria-label="SID home"
          onClick={returnHome}
        >
          <span className="brand-icon" aria-hidden="true">
            <span className="brand-logo-mark" />
          </span>
          <span className="brand-copy">
            <span className="brand-name">SID</span>
            <span className="brand-subtitle">
              Simplified Information Display
            </span>
          </span>
        </button>
        <nav aria-label="Main navigation">
          <span className={`upload-counter ${outOfUploads ? "exhausted" : ""} ${pro ? "pro-counter" : ""}`} aria-live="polite" aria-atomic="true" title={allowance ? `Resets ${new Date(allowance.resetsAt).toLocaleString()}` : undefined}>
            {outOfUploads ? <Icon name="warning" /> : pro ? <Icon name="star" /> : null}
            <span className="counter-desktop">{outOfUploads ? "No uploads left" : remaining !== undefined ? `${pro ? "Pro · " : ""}${remaining} uploads left` : allowanceStatus === "error" ? "Uploads unavailable" : <>Checking uploads<LoadingDots /></>}</span>
            <span className="counter-mobile">{remaining !== undefined ? `${remaining}${pro ? "" : " left"}` : "—"}</span>
          </span>
          {!pro && <button type="button" className="go-pro" aria-label="Go Pro" onClick={openPro}><Icon name="star" /><span className="pro-desktop-label">Go Pro</span><span className="pro-mobile-label">Pro</span></button>}
          {signedIn && (
            <button
              type="button"
              className={`nav-item ${screen === "history" ? "active" : ""}`}
              aria-label="History"
              title="History"
              aria-current={screen === "history" ? "page" : undefined}
              onClick={() => {
                stopWork();
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
        accept="image/*,.heic,.heif"
        hidden
        aria-label="Upload image"
        onChange={(event) => {
          void showFile(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      <main id="main" tabIndex={-1} className={homeReturn ? "home-return" : ""}>
        {screen === "home" && (
          <section className="center-stage home-screen" aria-label="Upload">
            <button
              type="button"
              className="upload-dropzone"
              disabled={outOfUploads}
              aria-describedby="upload-description"
              onClick={() => picker.current?.click()}
            >
              <Icon name="photo" />
              <span className={`upload-drop-title ${outOfUploads ? "" : "drag-only"}`}>{outOfUploads ? "No uploads left today" : "Drag an image here"}</span>
              {outOfUploads ? <span className="upload-format">{pro ? 150 : 10} more at midnight UTC</span> : <>
              <span className="upload-or drag-only" aria-hidden="true">
                <i />
                <b>or</b>
                <i />
              </span>
              <span className="button upload-select">
                <Icon name="upload" />
                Select image
              </span>
              </>}
            </button>
            {outOfUploads && !pro && <button type="button" className="button" onClick={openPro}><Icon name="star" />Get 150 a day with Pro</button>}
            {isPreview && <span className="sample-label">Sample</span>}
            <p id="upload-description" className="upload-description">
              Upload a photo. We’ll show the words in a clear font with more
              space.
            </p>
            <button
              type="button"
              className="how-to-trigger"
              onClick={() => setModal("help")}
            >
              <Icon name="help" />
              How to use
            </button>
          </section>
        )}
        {screen === "processing" && (
          <section
            className="center-stage processing-screen"
            aria-label="Processing"
          >
            <div className="scanning-photo">
              {photo ? <ScanImage
                src={photo}
                alt="Uploaded photo"
                onError={() => setPhoto("")}
              /> : <Icon name="photo" />}
              <div className="scan-beam" aria-hidden="true" />
            </div>
            <p role="status" aria-live="polite">
              Loading<LoadingDots />
            </p>
            {isPreview && <span className="sample-label">Sample</span>}
          </section>
        )}
        {screen === "reader" && current && (
          <ReaderView
            key={current.id + preview + (pro ? "pro" : "free")}
            scan={current}
            initialView={preview === "photo" ? "photo" : "text"}
            notify={setNotice}
            settings={settings}
            pro={pro}
            onUpgrade={openPro}
            initialSummary={preview === "pro" || preview === "pro-menu"}
            onOverlayRemoved={(documentId) => void recordRemovedOverlay(documentId)}
          />
        )}
        {screen === "history" && signedIn && (
          <HistoryList
            scans={history}
            loading={!isPreview && !!user && historyOwner !== user.id}
            error={historyError}
            onUpload={() => picker.current?.click()}
            onOpen={(scan) => {
              setCurrent(scan);
              setReaderReturnScreen("history");
              if (scan.status === "processing" || scan.status === "queued") {
                retry(scan);
                return;
              }
              if (scan.status === "failed") {
                setErrorCode("server");
                setScreen("error");
              } else setScreen("reader");
            }}
            onDelete={(scan) => {
              setDeleteError("");
              setDeleting(scan);
            }}
            onRetry={(scan) => {
              setReaderReturnScreen("history");
              retry(scan);
            }}
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
                name={errorCode === "network" ? "offline" : "blur"}
              />
            </div>
            <h1>{scanErrorCopy(errorCode).title}</h1>
            {["blurry", "no_text", "wrong_type", "too_big", "rate_limit"].includes(errorCode) && <span className="no-upload-used"><Icon name="check" />No upload used</span>}
            <p className="error-detail">{scanErrorCopy(errorCode).detail}</p>
            {scanErrorCopy(errorCode).canRetry && (
              <button type="button" className="button" onClick={() => retry()}>
                Try again
              </button>
            )}
            <button
              type="button"
              className="button outlined"
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
          pro={pro}
          onUpgrade={openPro}
        />
      )}
      {modal === "pro" && <ProDialog onClose={() => setModal(null)} />}
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
      {modal === "help" && (
        <Dialog
          label="How to use SID"
          className="how-to-dialog"
          animateClose
          onClose={() => setModal(null)}
        >
          <h2>How to use SID</h2>
          <div className="how-to-steps">
            <article>
              <div className="how-to-icon">
                <Icon name="upload" />
              </div>
              <div>
                <h3>1. Add a photo</h3>
                <p>Drag it in or click Select image</p>
              </div>
            </article>
            <i aria-hidden="true">→</i>
            <article>
              <div className="how-to-icon">
                <Icon name="book" />
              </div>
              <div>
                <h3>2. Read</h3>
                <p>The words show in a clear font with more space</p>
              </div>
            </article>
            <i aria-hidden="true">→</i>
            <article>
              <div className="how-to-icon">
                <Icon name="settings" />
              </div>
              <div>
                <h3>3. Adjust</h3>
                <p>Use Settings to change the font, size or color</p>
              </div>
            </article>
          </div>
          <button
            type="button"
            className="button"
            onClick={() => setModal(null)}
          >
            Got it
          </button>
        </Dialog>
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
