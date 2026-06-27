/* eslint-disable @next/next/no-img-element */
"use client";

import {
  ChangeEvent,
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type Region = "日版" | "港版" | "美版" | "欧版" | "其他";
type GameFormat = "实体卡带" | "数字版";
type Currency = "CNY" | "JPY" | "HKD" | "USD";

type GameRecord = {
  id: string;
  title: string;
  price: number;
  currency: Currency;
  purchaseDate: string;
  region: Region;
  format: GameFormat;
  seller: string;
  coverUrl: string;
  nintendoUrl: string;
  notes: string;
  soldDate: string;
  soldPrice: number;
  soldCurrency: Currency;
  playTimeMinutes: number;
  playTimeUpdatedAt: string;
  firstPlayedDate: string;
  lastPlayedDate: string;
};

type FormState = Omit<GameRecord, "id">;
type AccessStatus = "checking" | "locked" | "unlocked";
type SaveStatus = "idle" | "saving" | "saved" | "error";

type NintendoAccountBinding = {
  displayName: string;
  friendCode: string;
  linkedAt: string;
  playtimeUpdatedAt: string;
};

type AccountFormState = Pick<NintendoAccountBinding, "displayName" | "friendCode">;

type PlaytimeImportEntry = {
  title: string;
  playTimeMinutes: number;
  firstPlayedDate: string;
  lastPlayedDate: string;
};

type NintendoCoverResult = {
  id: string;
  title: string;
  coverUrl: string;
  nintendoUrl: string;
  platform: string;
  releaseDate: string | null;
  price: number | null;
  currency: string | null;
  source: "mainland" | "hong-kong" | "algolia" | "page";
};

type LedgerDocument = {
  version: 1;
  updatedAt: string;
  account: NintendoAccountBinding | null;
  records: GameRecord[];
};

const storageKey = "switch-cartridge-ledger";
const currencies = ["CNY", "JPY", "HKD", "USD"] as const;
const regions = ["日版", "港版", "美版", "欧版", "其他"] as const;
const gameFormats = ["实体卡带", "数字版"] as const;

const emptyForm: FormState = {
  title: "",
  price: 0,
  currency: "CNY",
  purchaseDate: "",
  region: "日版",
  format: "实体卡带",
  seller: "",
  coverUrl: "",
  nintendoUrl: "",
  notes: "",
  soldDate: "",
  soldPrice: 0,
  soldCurrency: "CNY",
  playTimeMinutes: 0,
  playTimeUpdatedAt: "",
  firstPlayedDate: "",
  lastPlayedDate: "",
};

const emptyAccountForm: AccountFormState = {
  displayName: "",
  friendCode: "",
};

const currencyFormatter = new Intl.NumberFormat("zh-CN", {
  maximumFractionDigits: 2,
});

function createId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatMoney(value: number, currency: Currency) {
  const symbol = {
    CNY: "¥",
    JPY: "¥",
    HKD: "HK$",
    USD: "$",
  }[currency];

  return `${symbol}${currencyFormatter.format(value)}`;
}

function formatCurrencyStats(
  stats: Array<{ currency: Currency; total: number; count: number }>,
  mode: "total" | "average",
) {
  if (!stats.length) {
    return formatMoney(0, "CNY");
  }

  return stats
    .map(({ currency, total, count }) =>
      formatMoney(mode === "average" ? total / count : total, currency),
    )
    .join(" / ");
}

function formatPlayTime(minutes: number) {
  const normalized = Math.max(0, Math.round(minutes));
  const hours = Math.floor(normalized / 60);
  const restMinutes = normalized % 60;

  if (!hours) {
    return `${restMinutes}分钟`;
  }

  if (!restMinutes) {
    return `${hours}小时`;
  }

  return `${hours}小时${restMinutes}分钟`;
}

function coverLabel(title: string) {
  return title
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}

function coverSourceLabel(source: NintendoCoverResult["source"]) {
  return {
    mainland: "大陆站",
    "hong-kong": "香港站",
    algolia: "美国站",
    page: "页面",
  }[source];
}

function saveStatusLabel(status: SaveStatus) {
  return {
    idle: "",
    saving: "保存中",
    saved: "已保存",
    error: "保存失败",
  }[status];
}

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

function createEmptyForm() {
  return { ...emptyForm, purchaseDate: todayString() };
}

export default function Home() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const playtimeInputRef = useRef<HTMLInputElement>(null);
  const saveRequestRef = useRef(0);
  const [records, setRecords] = useState<GameRecord[]>([]);
  const [account, setAccount] = useState<NintendoAccountBinding | null>(null);
  const [accountForm, setAccountForm] =
    useState<AccountFormState>(emptyAccountForm);
  const [playtimeImportError, setPlaytimeImportError] = useState("");
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [storageReady, setStorageReady] = useState(false);
  const [recordsDirty, setRecordsDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [storageError, setStorageError] = useState("");
  const [accessStatus, setAccessStatus] = useState<AccessStatus>("checking");
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<"date" | "price" | "title">("date");
  const [coverResults, setCoverResults] = useState<NintendoCoverResult[]>([]);
  const [coverStatus, setCoverStatus] = useState<"idle" | "searching">("idle");
  const [coverError, setCoverError] = useState("");

  const unlockLedger = useCallback(async () => {
    saveRequestRef.current += 1;
    setAccessStatus("unlocked");
    setStorageReady(false);
    setStorageError("");
    setSaveStatus("idle");

    try {
      const serverLedger = await fetchLedgerFromServer();
      const serverRecords = serverLedger.records;
      const legacyRecords = loadLegacyLocalRecords();
      const nextRecords =
        serverRecords.length || !legacyRecords.length
          ? serverRecords
          : legacyRecords;

      const shouldMigrateLegacyRecords =
        !serverRecords.length && legacyRecords.length > 0;

      setRecords(nextRecords);
      setAccount(serverLedger.account);
      setAccountForm(
        serverLedger.account
          ? {
              displayName: serverLedger.account.displayName,
              friendCode: serverLedger.account.friendCode,
            }
          : emptyAccountForm,
      );
      setRecordsDirty(shouldMigrateLegacyRecords);
      if (shouldMigrateLegacyRecords) {
        setSaveStatus("saving");
      }
      setForm(createEmptyForm());
      setStorageReady(true);
    } catch (error) {
      setRecords([]);
      setAccount(null);
      setAccountForm(emptyAccountForm);
      setRecordsDirty(false);
      setStorageError(
        error instanceof Error ? error.message : "无法读取服务端记录",
      );
      setStorageReady(false);
    }
  }, []);

  const checkAccess = useCallback(async () => {
    try {
      const response = await fetch("/api/access", { cache: "no-store" });
      const payload = (await response.json()) as { authenticated?: boolean };

      if (payload.authenticated) {
        await unlockLedger();
      } else {
        setAccessStatus("locked");
      }
    } catch {
      setAccessStatus("locked");
    }
  }, [unlockLedger]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      checkAccess();
    });

    return () => window.cancelAnimationFrame(frame);
  }, [checkAccess]);

  useEffect(() => {
    if (!storageReady || !recordsDirty) {
      return;
    }

    const requestId = saveRequestRef.current + 1;
    saveRequestRef.current = requestId;
    const timeoutId = window.setTimeout(() => {
      saveLedgerToServer(records, account)
        .then(() => {
          if (saveRequestRef.current === requestId) {
            setRecordsDirty(false);
            setSaveStatus("saved");
            setStorageError("");
          }
        })
        .catch((error) => {
          if (saveRequestRef.current === requestId) {
            setSaveStatus("error");
            setStorageError(
              error instanceof Error ? error.message : "保存服务端记录失败",
            );
          }
        });
    }, 350);

    return () => window.clearTimeout(timeoutId);
  }, [account, records, recordsDirty, storageReady]);

  async function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!password.trim()) {
      setPasswordError("请输入访问密码");
      return;
    }

    setPasswordError("");

    try {
      const response = await fetch("/api/access", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });

      if (!response.ok) {
        setPasswordError("密码不正确");
        return;
      }

      setPassword("");
      await unlockLedger();
    } catch {
      setPasswordError("无法验证密码，请稍后重试");
    }
  }

  async function lockLedger() {
    await fetch("/api/access", { method: "DELETE" }).catch(() => undefined);
    saveRequestRef.current += 1;
    setRecords([]);
    setAccount(null);
    setAccountForm(emptyAccountForm);
    setPlaytimeImportError("");
    setRecordsDirty(false);
    setStorageReady(false);
    setStorageError("");
    setSaveStatus("idle");
    setAccessStatus("locked");
    setEditingId(null);
    setPassword("");
  }

  const filteredRecords = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const source = normalizedQuery
      ? records.filter((record) =>
          [
            record.title,
            record.region,
            record.format,
            record.seller,
            record.notes,
            record.playTimeMinutes ? formatPlayTime(record.playTimeMinutes) : "",
            record.soldDate ? "已卖出" : "持有中",
          ]
            .join(" ")
            .toLowerCase()
            .includes(normalizedQuery),
        )
      : records;

    return [...source].sort((a, b) => {
      if (sortBy === "price") {
        return b.price - a.price;
      }

      if (sortBy === "title") {
        return a.title.localeCompare(b.title, "zh-Hans-CN");
      }

      return (
        new Date(b.purchaseDate).getTime() -
        new Date(a.purchaseDate).getTime()
      );
    });
  }, [query, records, sortBy]);

  const currencyStats = useMemo(() => {
    return currencies
      .map((currency) => {
        const matchingRecords = records.filter(
          (record) => record.currency === currency,
        );
        const total = matchingRecords.reduce(
          (sum, record) => sum + record.price,
          0,
        );

        return { currency, total, count: matchingRecords.length };
      })
      .filter((item) => item.count > 0);
  }, [records]);

  const saleStats = useMemo(() => {
    return currencies
      .map((currency) => {
        const matchingRecords = records.filter(
          (record) => record.soldDate && record.soldCurrency === currency,
        );
        const total = matchingRecords.reduce(
          (sum, record) => sum + record.soldPrice,
          0,
        );

        return { currency, total, count: matchingRecords.length };
      })
      .filter((item) => item.count > 0);
  }, [records]);

  const physicalCount = records.filter(
    (record) => record.format === "实体卡带",
  ).length;
  const digitalCount = records.length - physicalCount;
  const soldCount = records.filter((record) => record.soldDate).length;
  const totalPlayTimeMinutes = records.reduce(
    (sum, record) => sum + record.playTimeMinutes,
    0,
  );

  function updateForm<Key extends keyof FormState>(
    key: Key,
    value: FormState[Key],
  ) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function resetForm() {
    setEditingId(null);
    setForm(createEmptyForm());
    setCoverResults([]);
    setCoverError("");
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const normalized: FormState = {
      ...form,
      title: form.title.trim(),
      seller: form.seller.trim(),
      coverUrl: form.coverUrl.trim(),
      nintendoUrl: form.nintendoUrl.trim(),
      notes: form.notes.trim(),
      price: Number(form.price) || 0,
      soldDate: form.format === "实体卡带" ? form.soldDate : "",
      soldPrice:
        form.format === "实体卡带" && form.soldDate
          ? Number(form.soldPrice) || 0
          : 0,
      soldCurrency: form.soldCurrency,
      playTimeMinutes: Math.max(0, Math.round(Number(form.playTimeMinutes) || 0)),
      playTimeUpdatedAt: form.playTimeMinutes
        ? form.playTimeUpdatedAt || new Date().toISOString()
        : "",
      firstPlayedDate: form.firstPlayedDate,
      lastPlayedDate: form.lastPlayedDate,
    };

    if (!normalized.title) {
      return;
    }

    if (editingId) {
      setRecords((current) =>
        current.map((record) =>
          record.id === editingId ? { ...normalized, id: editingId } : record,
        ),
      );
    } else {
      setRecords((current) => [{ ...normalized, id: createId() }, ...current]);
    }
    setRecordsDirty(true);
    setSaveStatus("saving");

    resetForm();
  }

  function editRecord(record: GameRecord) {
    setEditingId(record.id);
    setForm({
      title: record.title,
      price: record.price,
      currency: record.currency,
      purchaseDate: record.purchaseDate,
      region: record.region,
      format: record.format,
      seller: record.seller,
      coverUrl: record.coverUrl,
      nintendoUrl: record.nintendoUrl,
      notes: record.notes,
      soldDate: record.soldDate,
      soldPrice: record.soldPrice,
      soldCurrency: record.soldCurrency,
      playTimeMinutes: record.playTimeMinutes,
      playTimeUpdatedAt: record.playTimeUpdatedAt,
      firstPlayedDate: record.firstPlayedDate,
      lastPlayedDate: record.lastPlayedDate,
    });
  }

  function updateFormat(format: GameFormat) {
    setForm((current) => ({
      ...current,
      format,
      soldDate: format === "实体卡带" ? current.soldDate : "",
      soldPrice: format === "实体卡带" ? current.soldPrice : 0,
      soldCurrency: format === "实体卡带" ? current.soldCurrency : current.currency,
    }));
  }

  function toggleSold(checked: boolean) {
    setForm((current) => ({
      ...current,
      soldDate: checked ? current.soldDate || todayString() : "",
      soldPrice: checked ? current.soldPrice : 0,
      soldCurrency: checked ? current.soldCurrency || current.currency : current.currency,
    }));
  }

  function startSaleRecord(record: GameRecord) {
    editRecord({
      ...record,
      soldDate: record.soldDate || todayString(),
      soldPrice: record.soldPrice || 0,
      soldCurrency: record.soldCurrency || record.currency,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function deleteRecord(recordId: string) {
    setRecords((current) => current.filter((record) => record.id !== recordId));
    setRecordsDirty(true);
    setSaveStatus("saving");
    if (editingId === recordId) {
      resetForm();
    }
  }

  function exportRecords() {
    const payload = JSON.stringify(
      {
        version: 1,
        exportedAt: new Date().toISOString(),
        account,
        records,
      },
      null,
      2,
    );
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `switch-cartridges-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function importRecordsClick() {
    fileInputRef.current?.click();
  }

  async function importRecords(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      const parsedRecords = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === "object" && "records" in parsed
          ? (parsed as { records?: unknown }).records
          : null;

      if (!Array.isArray(parsedRecords)) {
        throw new Error("Expected an array");
      }

      const importedRecords = parsedRecords
        .map(normalizeImportedRecord)
        .filter((record): record is GameRecord => Boolean(record));

      if (!importedRecords.length) {
        throw new Error("No valid records");
      }

      setRecords(importedRecords);
      setRecordsDirty(true);
      setSaveStatus("saving");
      resetForm();
    } catch {
      window.alert("JSON 文件不是有效的 Switch 卡带记录");
    } finally {
      event.target.value = "";
    }
  }

  function saveAccountBinding() {
    const displayName = accountForm.displayName.trim();
    const friendCode = accountForm.friendCode.trim().toUpperCase();

    if (!displayName && !friendCode) {
      setAccount(null);
    } else {
      setAccount((current) => ({
        displayName,
        friendCode,
        linkedAt: current?.linkedAt || new Date().toISOString(),
        playtimeUpdatedAt: current?.playtimeUpdatedAt || "",
      }));
    }

    setRecordsDirty(true);
    setSaveStatus("saving");
  }

  function choosePlaytimeFile() {
    playtimeInputRef.current?.click();
  }

  async function importPlaytime(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      const entries = parsePlaytimeImport(await file.text());
      const now = new Date().toISOString();
      let matched = 0;
      const nextRecords = records.map((record) => {
        const entry = findPlaytimeMatch(record.title, entries);

        if (!entry) {
          return record;
        }

        matched += 1;
        return {
          ...record,
          playTimeMinutes: entry.playTimeMinutes,
          playTimeUpdatedAt: now,
          firstPlayedDate: entry.firstPlayedDate || record.firstPlayedDate,
          lastPlayedDate: entry.lastPlayedDate || record.lastPlayedDate,
        };
      });

      if (!matched) {
        throw new Error("没有匹配到现有游戏");
      }

      setRecords(nextRecords);
      const nextDisplayName =
        accountForm.displayName.trim() || account?.displayName || "";
      const nextFriendCode =
        accountForm.friendCode.trim().toUpperCase() || account?.friendCode || "";

      setAccount(
        nextDisplayName || nextFriendCode
          ? {
              displayName: nextDisplayName,
              friendCode: nextFriendCode,
              linkedAt: account?.linkedAt || now,
              playtimeUpdatedAt: now,
            }
          : null,
      );
      setPlaytimeImportError(`已匹配 ${matched} 个游戏`);
      setRecordsDirty(true);
      setSaveStatus("saving");
    } catch (error) {
      setPlaytimeImportError(
        error instanceof Error ? error.message : "游玩时长文件无法读取",
      );
    } finally {
      event.target.value = "";
    }
  }

  async function lookupNintendoCover(mode: "title" | "url") {
    const params = new URLSearchParams();
    const searchTerm = form.title.trim();
    const nintendoUrl = form.nintendoUrl.trim();

    if (mode === "title") {
      if (!searchTerm) {
        setCoverError("先输入游戏名字");
        return;
      }

      params.set("q", searchTerm);
    } else {
      if (!nintendoUrl) {
        setCoverError("先填写 Nintendo 页面");
        return;
      }

      params.set("url", nintendoUrl);
    }

    setCoverStatus("searching");
    setCoverError("");

    try {
      const response = await fetch(`/api/nintendo-cover?${params.toString()}`);
      const payload = (await response.json()) as {
        results?: NintendoCoverResult[];
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error || "封面查询失败");
      }

      const results = payload.results ?? [];
      setCoverResults(results);

      if (!results.length) {
        setCoverError("未找到 Nintendo 封面");
      }
    } catch (error) {
      setCoverResults([]);
      setCoverError(error instanceof Error ? error.message : "封面查询失败");
    } finally {
      setCoverStatus("idle");
    }
  }

  function applyNintendoCover(result: NintendoCoverResult) {
    setForm((current) => ({
      ...current,
      title: result.title,
      coverUrl: result.coverUrl,
      nintendoUrl: result.nintendoUrl,
    }));
    setCoverError("");
  }

  if (accessStatus !== "unlocked") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#eef3f8] px-4 py-8 text-[#202020]">
        <form
          onSubmit={submitPassword}
          className="grid w-full max-w-md gap-4 rounded-lg border border-[#d7dde6] bg-white p-5 shadow-sm sm:p-6"
        >
          <div>
            <p className="text-sm font-semibold text-[#d1222a]">Nintendo Switch</p>
            <h1 className="mt-1 text-2xl font-bold">游戏购买记录</h1>
          </div>
          <label className="field">
            <span>访问密码</span>
            <input
              autoComplete="current-password"
              disabled={accessStatus === "checking"}
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={
                accessStatus === "checking" ? "正在检查访问状态" : "输入密码"
              }
            />
          </label>
          {passwordError ? (
            <p className="rounded-md bg-[#fff2cf] px-3 py-2 text-sm font-semibold text-[#755900]">
              {passwordError}
            </p>
          ) : null}
          <button
            className="primary-button w-full"
            disabled={accessStatus === "checking"}
            type="submit"
          >
            {accessStatus === "checking" ? "检查中" : "进入账本"}
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#eef3f8] text-[#202020]">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-3 py-3 sm:gap-5 sm:px-5 sm:py-5 lg:px-8">
        <header className="rounded-lg border border-[#d7dde6] bg-white p-4 shadow-sm sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[#d1222a]">
                Nintendo Switch
              </p>
              <h1 className="mt-1 text-2xl font-bold tracking-normal sm:text-4xl">
                游戏购买记录
              </h1>
            </div>
            <div className="flex items-center gap-3 self-start sm:self-center">
              {saveStatusLabel(saveStatus) ? (
                <span
                  className={`text-sm font-semibold ${
                    saveStatus === "error" ? "text-[#b42323]" : "text-[#4e5968]"
                  }`}
                >
                  {saveStatusLabel(saveStatus)}
                </span>
              ) : null}
              <button className="ghost-button" type="button" onClick={lockLedger}>
                锁定
              </button>
            </div>
          </div>
          {storageError ? (
            <p className="mt-3 rounded-md bg-[#fff2cf] px-3 py-2 text-sm font-semibold text-[#755900]">
              {storageError}
            </p>
          ) : null}
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 xl:grid-cols-5">
            <Stat label="游戏数" value={`${records.length}`} />
            <Stat label="实体 / 数字" value={`${physicalCount} / ${digitalCount}`} />
            <Stat label="总时长" value={formatPlayTime(totalPlayTimeMinutes)} />
            <Stat
              label="总支出"
              value={formatCurrencyStats(currencyStats, "total")}
            />
            <Stat
              label={`卖出回收 ${soldCount ? `(${soldCount})` : ""}`}
              value={formatCurrencyStats(saleStats, "total")}
            />
          </div>
        </header>

        {storageReady ? (
          <section className="grid gap-4 xl:grid-cols-[420px_minmax(0,1fr)]">
          <form
            onSubmit={handleSubmit}
            className="h-fit rounded-lg border border-[#d7dde6] bg-white p-3 shadow-sm sm:p-4 xl:sticky xl:top-5"
          >
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">
                {editingId ? "编辑卡带" : "新增卡带"}
              </h2>
              {editingId ? (
                <button type="button" className="ghost-button" onClick={resetForm}>
                  取消
                </button>
              ) : null}
            </div>

            <div className="mt-4 overflow-hidden rounded-md border border-[#d7dde6] bg-[#f8fafc]">
              {form.coverUrl ? (
                <img
                  src={form.coverUrl}
                  alt={`${form.title || "游戏"}封面`}
                  className="h-48 w-full object-cover sm:h-60"
                />
              ) : (
                <div className="flex h-48 items-center justify-center bg-[#e60012] px-8 text-center text-4xl font-black text-white sm:h-60">
                  {coverLabel(form.title) || "SWITCH"}
                </div>
              )}
            </div>

            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                className="secondary-button"
                disabled={coverStatus === "searching" || !form.title.trim()}
                onClick={() => lookupNintendoCover("title")}
              >
                {coverStatus === "searching" ? "查询中" : "按中英文名找封面"}
              </button>
              <button
                type="button"
                className="ghost-button"
                disabled={coverStatus === "searching" || !form.nintendoUrl.trim()}
                onClick={() => lookupNintendoCover("url")}
              >
                从页面取封面
              </button>
            </div>

            {coverError ? (
              <p className="mt-2 rounded-md bg-[#fff2cf] px-3 py-2 text-sm font-semibold text-[#755900]">
                {coverError}
              </p>
            ) : null}

            {coverResults.length ? (
              <div className="mt-3 grid gap-2">
                {coverResults.map((result) => (
                  <button
                    key={result.id}
                    type="button"
                    className="cover-result"
                    onClick={() => applyNintendoCover(result)}
                  >
                    <img src={result.coverUrl} alt={`${result.title}封面`} />
                    <span>
                      <strong>{result.title}</strong>
                      <small>
                        {coverSourceLabel(result.source)} ·{" "}
                        {result.platform}
                        {result.releaseDate
                          ? ` · ${result.releaseDate.slice(0, 10)}`
                          : ""}
                      </small>
                    </span>
                  </button>
                ))}
              </div>
            ) : null}

            <div className="mt-4 grid gap-3">
              <label className="field">
                <span>游戏名字</span>
                <input
                  required
                  value={form.title}
                  onChange={(event) => updateForm("title", event.target.value)}
                  placeholder="例如 塞尔达 / 星之卡比 / Mario Kart"
                />
              </label>

              <div className="grid gap-3 sm:grid-cols-[1fr_110px]">
                <label className="field">
                  <span>价格</span>
                  <input
                    min="0"
                    step="0.01"
                    type="number"
                    value={form.price || ""}
                    onChange={(event) =>
                      updateForm("price", Number(event.target.value))
                    }
                    placeholder="0.00"
                  />
                </label>
                <label className="field">
                  <span>币种</span>
                  <select
                  value={form.currency}
                  onChange={(event) =>
                      updateForm("currency", event.target.value as Currency)
                  }
                >
                    {currencies.map((currency) => (
                      <option key={currency}>{currency}</option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="field">
                <span>购买日期</span>
                <input
                  required
                  type="date"
                  value={form.purchaseDate}
                  onChange={(event) => updateForm("purchaseDate", event.target.value)}
                />
              </label>

              <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr]">
                <label className="field">
                  <span>游玩分钟</span>
                  <input
                    min="0"
                    step="1"
                    type="number"
                    value={form.playTimeMinutes || ""}
                    onChange={(event) =>
                      updateForm("playTimeMinutes", Number(event.target.value))
                    }
                    placeholder="0"
                  />
                </label>
                <label className="field">
                  <span>首次游玩</span>
                  <input
                    type="date"
                    value={form.firstPlayedDate}
                    onChange={(event) =>
                      updateForm("firstPlayedDate", event.target.value)
                    }
                  />
                </label>
                <label className="field">
                  <span>最后游玩</span>
                  <input
                    type="date"
                    value={form.lastPlayedDate}
                    onChange={(event) =>
                      updateForm("lastPlayedDate", event.target.value)
                    }
                  />
                </label>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="field">
                  <span>版本</span>
                  <select
                    value={form.region}
                    onChange={(event) =>
                      updateForm("region", event.target.value as Region)
                    }
                  >
                    {regions.map((region) => (
                      <option key={region}>{region}</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>状态</span>
                  <select
                    value={form.format}
                    onChange={(event) => updateFormat(event.target.value as GameFormat)}
                  >
                    {gameFormats.map((format) => (
                      <option key={format}>{format}</option>
                    ))}
                  </select>
                </label>
              </div>

              {form.format === "实体卡带" ? (
                <div className="rounded-md border border-[#d7dde6] bg-[#f7fbff] p-3">
                  <label className="checkbox-field">
                    <input
                      type="checkbox"
                      checked={Boolean(form.soldDate)}
                      onChange={(event) => toggleSold(event.target.checked)}
                    />
                    <span>这张卡带已卖出</span>
                  </label>

                  {form.soldDate ? (
                    <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_96px]">
                      <label className="field">
                        <span>卖出日期</span>
                        <input
                          required
                          type="date"
                          value={form.soldDate}
                          onChange={(event) =>
                            updateForm("soldDate", event.target.value)
                          }
                        />
                      </label>
                      <label className="field">
                        <span>卖出价格</span>
                        <input
                          min="0"
                          step="0.01"
                          type="number"
                          value={form.soldPrice || ""}
                          onChange={(event) =>
                            updateForm("soldPrice", Number(event.target.value))
                          }
                          placeholder="0.00"
                        />
                      </label>
                      <label className="field">
                        <span>币种</span>
                        <select
                          value={form.soldCurrency}
                          onChange={(event) =>
                            updateForm("soldCurrency", event.target.value as Currency)
                          }
                        >
                          {currencies.map((currency) => (
                            <option key={currency}>{currency}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                  ) : null}
                </div>
              ) : null}

              <label className="field">
                <span>购买渠道</span>
                <input
                  value={form.seller}
                  onChange={(event) => updateForm("seller", event.target.value)}
                  placeholder="淘宝 / 闲鱼 / 线下店"
                />
              </label>

              <label className="field">
                <span>封面 URL</span>
                <input
                  value={form.coverUrl}
                  onChange={(event) => updateForm("coverUrl", event.target.value)}
                  placeholder="Nintendo 官方图片地址"
                />
              </label>

              <label className="field">
                <span>Nintendo 页面</span>
                <input
                  value={form.nintendoUrl}
                  onChange={(event) => updateForm("nintendoUrl", event.target.value)}
                  placeholder="https://www.nintendo.com/..."
                />
              </label>

              <label className="field">
                <span>备注</span>
                <textarea
                  value={form.notes}
                  onChange={(event) => updateForm("notes", event.target.value)}
                  placeholder="特典、成色、是否盒说齐全"
                />
              </label>
            </div>

            <button className="primary-button mt-4 w-full" type="submit">
              {editingId ? "保存修改" : "加入记录"}
            </button>
          </form>

          <section className="flex min-w-0 flex-col gap-4">
            <div className="grid gap-3 rounded-lg border border-[#d7dde6] bg-white p-3 shadow-sm sm:p-4 lg:grid-cols-[minmax(0,1fr)_180px_auto_auto] lg:items-end">
              <label className="field">
                <span>任天堂账号</span>
                <input
                  value={accountForm.displayName}
                  onChange={(event) =>
                    setAccountForm((current) => ({
                      ...current,
                      displayName: event.target.value,
                    }))
                  }
                  placeholder="账号昵称"
                />
              </label>
              <label className="field">
                <span>好友代码</span>
                <input
                  value={accountForm.friendCode}
                  onChange={(event) =>
                    setAccountForm((current) => ({
                      ...current,
                      friendCode: event.target.value,
                    }))
                  }
                  placeholder="SW-0000-0000-0000"
                />
              </label>
              <button
                className="ghost-button w-full lg:w-auto"
                type="button"
                onClick={saveAccountBinding}
              >
                保存绑定
              </button>
              <button
                className="secondary-button w-full lg:w-auto"
                type="button"
                onClick={choosePlaytimeFile}
              >
                导入时长
              </button>
              <input
                ref={playtimeInputRef}
                accept=".json,.csv,text/csv,application/json"
                className="hidden"
                type="file"
                onChange={importPlaytime}
              />
              {account || playtimeImportError ? (
                <p className="text-sm font-semibold text-[#4e5968] lg:col-span-4">
                  {playtimeImportError ||
                    `${account?.displayName || account?.friendCode || "已绑定"}${
                      account?.playtimeUpdatedAt
                        ? ` · ${account.playtimeUpdatedAt.slice(0, 10)}`
                        : ""
                    }`}
                </p>
              ) : null}
            </div>

            <div className="grid gap-3 rounded-lg border border-[#d7dde6] bg-white p-3 shadow-sm sm:p-4 md:grid-cols-[minmax(0,1fr)_160px_auto_auto] md:items-end">
              <label className="field">
                <span>搜索</span>
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="游戏、版本、状态、渠道、备注"
                />
              </label>
              <label className="field">
                <span>排序</span>
                <select
                  value={sortBy}
                  onChange={(event) =>
                    setSortBy(event.target.value as "date" | "price" | "title")
                  }
                >
                  <option value="date">购买日期</option>
                  <option value="price">价格</option>
                  <option value="title">游戏名字</option>
                </select>
              </label>
              <button className="ghost-button w-full md:w-auto" onClick={importRecordsClick}>
                导入 JSON
              </button>
              <button className="secondary-button w-full md:w-auto" onClick={exportRecords}>
                导出 JSON
              </button>
              <input
                ref={fileInputRef}
                accept=".json,application/json"
                className="hidden"
                type="file"
                onChange={importRecords}
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
              {filteredRecords.map((record) => (
                <article
                  key={record.id}
                  className="overflow-hidden rounded-lg border border-[#d7dde6] bg-white shadow-sm"
                >
                  <div className="relative aspect-[16/9] bg-[#e60012]">
                    {record.coverUrl ? (
                      <img
                        src={record.coverUrl}
                        alt={`${record.title}封面`}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center px-8 text-center text-4xl font-black text-white">
                        {coverLabel(record.title)}
                      </div>
                    )}
                    <div className="absolute left-3 top-3 rounded bg-black/75 px-2 py-1 text-xs font-semibold text-white">
                      {record.region}
                    </div>
                    <div className="absolute right-3 top-3 rounded bg-white/90 px-2 py-1 text-xs font-semibold text-[#202020]">
                      {record.soldDate ? "已卖出" : record.format}
                    </div>
                  </div>
                  <div className="grid gap-3 p-3 sm:p-4">
                    <div>
                      <h3 className="line-clamp-2 min-h-12 text-lg font-semibold leading-6">
                        {record.title}
                      </h3>
                      <p className="mt-1 text-sm text-[#675f52]">
                        {record.purchaseDate} · {record.format}
                        {record.seller ? ` · ${record.seller}` : ""}
                      </p>
                      {record.playTimeMinutes ? (
                        <p className="mt-1 text-sm font-semibold text-[#287b58]">
                          游玩 {formatPlayTime(record.playTimeMinutes)}
                          {record.lastPlayedDate
                            ? ` · ${record.lastPlayedDate}`
                            : ""}
                        </p>
                      ) : null}
                    </div>
                    <div className="grid gap-3 border-t border-[#eee8dc] pt-3">
                      <div className="flex flex-wrap items-end justify-between gap-2">
                        <div>
                          <p className="text-xs font-semibold text-[#675f52]">
                            买入
                          </p>
                          <span className="text-2xl font-bold text-[#d1222a]">
                            {formatMoney(record.price, record.currency)}
                          </span>
                        </div>
                        {record.soldDate ? (
                          <div className="text-right">
                            <p className="text-xs font-semibold text-[#287b58]">
                              {record.soldDate} 卖出
                            </p>
                            <span className="text-lg font-bold text-[#287b58]">
                              {formatMoney(record.soldPrice, record.soldCurrency)}
                            </span>
                          </div>
                        ) : null}
                      </div>
                      <div
                        className={`grid gap-2 ${
                          record.format === "实体卡带" && !record.soldDate
                            ? "grid-cols-3"
                            : "grid-cols-2"
                        }`}
                      >
                        {record.format === "实体卡带" && !record.soldDate ? (
                          <button
                            className="secondary-button min-w-0 px-2"
                            type="button"
                            onClick={() => startSaleRecord(record)}
                          >
                            记录卖出
                          </button>
                        ) : null}
                        <button
                          className="ghost-button min-w-0 px-2"
                          type="button"
                          onClick={() => editRecord(record)}
                        >
                          编辑
                        </button>
                        <button
                          className="danger-button min-w-0 px-2"
                          type="button"
                          onClick={() => deleteRecord(record.id)}
                        >
                          删除
                        </button>
                      </div>
                    </div>
                    {record.notes ? (
                      <p className="rounded-md bg-[#f6f4ef] px-3 py-2 text-sm text-[#4d463d]">
                        {record.notes}
                      </p>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>

            {!filteredRecords.length ? (
              <div className="rounded-lg border border-dashed border-[#9aa8b7] bg-white p-10 text-center text-[#4e5968]">
                没有匹配记录
              </div>
            ) : null}
          </section>
          </section>
        ) : (
          <section className="rounded-lg border border-[#d7dde6] bg-white p-8 text-center text-sm font-semibold text-[#4e5968] shadow-sm">
            {storageError || "正在加载记录"}
          </section>
        )}
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md border border-[#d7dde6] bg-[#f8fafc] px-3 py-2.5">
      <p className="text-xs font-semibold text-[#4e5968]">{label}</p>
      <p className="mt-1 truncate text-lg font-bold sm:text-xl" title={value}>
        {value}
      </p>
    </div>
  );
}

function normalizeImportedRecord(value: unknown): GameRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Partial<GameRecord> & { condition?: unknown };
  if (!record.title || typeof record.title !== "string") {
    return null;
  }

  const currency = currencies.includes(record.currency as Currency)
    ? (record.currency as Currency)
    : "CNY";
  const region = regions.includes(record.region as Region)
    ? (record.region as Region)
    : "其他";
  const format = gameFormats.includes(record.format as GameFormat)
    ? (record.format as GameFormat)
    : record.condition === "数字版"
      ? "数字版"
      : "实体卡带";
  const soldDate =
    format === "实体卡带" &&
    typeof record.soldDate === "string" &&
    record.soldDate
      ? record.soldDate
      : "";
  const soldCurrency = currencies.includes(record.soldCurrency as Currency)
    ? (record.soldCurrency as Currency)
    : currency;

  return {
    id: typeof record.id === "string" ? record.id : createId(),
    title: record.title.trim(),
    price: Number(record.price) || 0,
    currency,
    purchaseDate:
      typeof record.purchaseDate === "string" && record.purchaseDate
        ? record.purchaseDate
        : new Date().toISOString().slice(0, 10),
    region,
    format,
    seller: typeof record.seller === "string" ? record.seller : "",
    coverUrl: typeof record.coverUrl === "string" ? record.coverUrl : "",
    nintendoUrl: typeof record.nintendoUrl === "string" ? record.nintendoUrl : "",
    notes: typeof record.notes === "string" ? record.notes : "",
    soldDate,
    soldPrice: soldDate ? Number(record.soldPrice) || 0 : 0,
    soldCurrency,
    playTimeMinutes: Math.max(0, Math.round(Number(record.playTimeMinutes) || 0)),
    playTimeUpdatedAt:
      typeof record.playTimeUpdatedAt === "string" ? record.playTimeUpdatedAt : "",
    firstPlayedDate:
      typeof record.firstPlayedDate === "string" ? record.firstPlayedDate : "",
    lastPlayedDate:
      typeof record.lastPlayedDate === "string" ? record.lastPlayedDate : "",
  };
}

function normalizeAccountBinding(value: unknown): NintendoAccountBinding | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const accountValue = value as Partial<NintendoAccountBinding>;
  const displayName =
    typeof accountValue.displayName === "string"
      ? accountValue.displayName.trim()
      : "";
  const friendCode =
    typeof accountValue.friendCode === "string"
      ? accountValue.friendCode.trim().toUpperCase()
      : "";

  if (!displayName && !friendCode) {
    return null;
  }

  return {
    displayName,
    friendCode,
    linkedAt:
      typeof accountValue.linkedAt === "string" && accountValue.linkedAt
        ? accountValue.linkedAt
        : new Date().toISOString(),
    playtimeUpdatedAt:
      typeof accountValue.playtimeUpdatedAt === "string"
        ? accountValue.playtimeUpdatedAt
        : "",
  };
}

async function fetchLedgerFromServer(): Promise<LedgerDocument> {
  const response = await fetch("/api/records", { cache: "no-store" });
  const payload = (await response.json().catch(() => ({}))) as
    | Partial<LedgerDocument>
    | { error?: string };

  if (!response.ok) {
    throw new Error(
      "error" in payload && payload.error ? payload.error : "无法读取服务端记录",
    );
  }

  const records = "records" in payload ? payload.records : null;

  return {
    version: 1,
    updatedAt:
      "updatedAt" in payload && typeof payload.updatedAt === "string"
        ? payload.updatedAt
        : "",
    account:
      "account" in payload ? normalizeAccountBinding(payload.account) : null,
    records: Array.isArray(records)
      ? records
          .map(normalizeImportedRecord)
          .filter((record): record is GameRecord => Boolean(record))
      : [],
  };
}

async function saveLedgerToServer(
  records: GameRecord[],
  account: NintendoAccountBinding | null,
) {
  const response = await fetch("/api/records", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ account, records }),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
  };

  if (!response.ok) {
    throw new Error(payload.error || "保存服务端记录失败");
  }
}

function parsePlaytimeImport(text: string): PlaytimeImportEntry[] {
  const trimmed = text.trim();
  const entries = trimmed.startsWith("{") || trimmed.startsWith("[")
    ? parsePlaytimeJson(trimmed)
    : parsePlaytimeCsv(trimmed);

  if (!entries.length) {
    throw new Error("没有读取到游玩时长");
  }

  return entries;
}

function parsePlaytimeJson(text: string) {
  const parsed = JSON.parse(text) as unknown;
  const source = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object"
      ? (parsed as {
          records?: unknown;
          games?: unknown;
          activities?: unknown;
          playActivity?: unknown;
        }).records ??
        (parsed as { games?: unknown }).games ??
        (parsed as { activities?: unknown }).activities ??
        (parsed as { playActivity?: unknown }).playActivity
      : null;

  if (!Array.isArray(source)) {
    return [];
  }

  return source
    .map(parsePlaytimeEntry)
    .filter((entry): entry is PlaytimeImportEntry => Boolean(entry));
}

function parsePlaytimeCsv(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const cells = splitCsvLine(line);
      const title = cells[0]?.trim() ?? "";
      const playTimeValue = cells[1]?.trim() ?? "";

      if (
        index === 0 &&
        /title|name|游戏|名稱|名称/i.test(title) &&
        /time|hour|minute|时长|時間|分钟|小時/i.test(playTimeValue)
      ) {
        return null;
      }

      const playTimeMinutes = parsePlayTimeValue(playTimeValue);
      if (!title || !playTimeMinutes) {
        return null;
      }

      return {
        title,
        playTimeMinutes,
        firstPlayedDate: normalizeDate(cells[2]),
        lastPlayedDate: normalizeDate(cells[3]),
      };
    })
    .filter((entry): entry is PlaytimeImportEntry => Boolean(entry));
}

function splitCsvLine(line: string) {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  cells.push(current);
  return cells;
}

function parsePlaytimeEntry(value: unknown): PlaytimeImportEntry | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const title = firstString(
    record.title,
    record.name,
    record.gameTitle,
    record.softwareName,
  );
  const directMinutes = firstNumber(
    record.playTimeMinutes,
    record.totalMinutes,
    record.minutes,
  );
  const directHours = firstNumber(
    record.playTimeHours,
    record.totalHours,
    record.hours,
  );
  const textMinutes = parsePlayTimeValue(
    firstString(record.playTime, record.totalTimePlayed, record.timePlayed),
  );
  const playTimeMinutes =
    directMinutes ?? (directHours ? Math.round(directHours * 60) : textMinutes);

  if (!title || !playTimeMinutes) {
    return null;
  }

  return {
    title,
    playTimeMinutes,
    firstPlayedDate: normalizeDate(
      firstString(record.firstPlayedDate, record.firstPlayedAt),
    ),
    lastPlayedDate: normalizeDate(
      firstString(record.lastPlayedDate, record.lastPlayedAt, record.updatedAt),
    ),
  };
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return "";
}

function firstNumber(...values: unknown[]) {
  for (const value of values) {
    const numberValue =
      typeof value === "number"
        ? value
        : typeof value === "string"
          ? Number(value)
          : NaN;

    if (Number.isFinite(numberValue) && numberValue > 0) {
      return numberValue;
    }
  }

  return null;
}

function parsePlayTimeValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.round(value));
  }

  if (typeof value !== "string") {
    return 0;
  }

  const text = value.trim().toLowerCase();
  const timeParts = text.match(/^(\d{1,5}):(\d{1,2})$/);
  if (timeParts) {
    return Number(timeParts[1]) * 60 + Number(timeParts[2]);
  }

  const hours =
    Number(text.match(/(\d+(?:\.\d+)?)\s*(?:小时|小時|h|hour|hours)/)?.[1]) ||
    0;
  const minutes =
    Number(text.match(/(\d+(?:\.\d+)?)\s*(?:分钟|分鐘|m|min|minute|minutes)/)?.[1]) ||
    0;

  if (hours || minutes) {
    return Math.max(0, Math.round(hours * 60 + minutes));
  }

  const rawNumber = Number(text);
  return Number.isFinite(rawNumber) ? Math.max(0, Math.round(rawNumber)) : 0;
}

function normalizeDate(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    return "";
  }

  const match = value.match(/\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/);
  if (!match) {
    return "";
  }

  const [year, month, day] = match[0].split(/[-/.]/);
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function findPlaytimeMatch(
  title: string,
  entries: PlaytimeImportEntry[],
) {
  const normalizedTitle = normalizeGameTitle(title);

  return entries.find((entry) => {
    const normalizedEntryTitle = normalizeGameTitle(entry.title);
    return (
      normalizedEntryTitle === normalizedTitle ||
      normalizedEntryTitle.includes(normalizedTitle) ||
      normalizedTitle.includes(normalizedEntryTitle)
    );
  });
}

function normalizeGameTitle(title: string) {
  return title
    .normalize("NFKC")
    .replaceAll("萨尔达", "塞尔达")
    .replaceAll("薩爾達", "塞尔达")
    .replaceAll("玛利欧", "马力欧")
    .replaceAll("瑪利歐", "马力欧")
    .replaceAll("马里奥", "马力欧")
    .replace(/[™®©]/g, "")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "")
    .toLowerCase();
}

function loadLegacyLocalRecords() {
  if (typeof window === "undefined") {
    return [];
  }

  const raw = window.localStorage.getItem(storageKey);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    const parsedRecords = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" && "records" in parsed
        ? (parsed as { records?: unknown }).records
        : null;

    if (!Array.isArray(parsedRecords)) {
      return [];
    }

    const records = parsedRecords
      .map(normalizeImportedRecord)
      .filter((record): record is GameRecord => Boolean(record));

    return records;
  } catch {
    window.localStorage.removeItem(storageKey);
    return [];
  }
}
