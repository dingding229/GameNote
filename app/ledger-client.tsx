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
import { normalizeChineseSearchText } from "@/lib/chinese";

type Region = "日版" | "港版" | "台版" | "美版" | "欧版" | "其他";
type GamePlatform = "Nintendo Switch" | "PlayStation";
type GameFormat = "实体卡带" | "实体光盘" | "数字版";
type Currency = "CNY" | "JPY" | "HKD" | "USD" | "EUR" | "BRL";

type GameRecord = {
  id: string;
  platform: GamePlatform;
  title: string;
  price: number;
  currency: Currency;
  purchaseDate: string;
  region: Region;
  format: GameFormat;
  seller: string;
  coverUrl: string;
  officialUrl: string;
  notes: string;
  soldDate: string;
  soldPrice: number;
  soldCurrency: Currency;
};

type FormState = Omit<GameRecord, "id">;
type AccessStatus = "checking" | "locked" | "unlocked";
type SaveStatus = "idle" | "saving" | "saved" | "error";
type ActiveView = "records" | "form";
type StatsPlatformScope = "all" | "nintendo-switch" | "playstation";

type NintendoCoverResult = {
  id: string;
  title: string;
  displayTitle?: string;
  coverUrl: string;
  officialUrl?: string;
  nintendoUrl?: string;
  platform: string;
  releaseDate: string | null;
  price: number | null;
  currency: string | null;
  source:
    | "mainland"
    | "hong-kong"
    | "algolia"
    | "page"
    | "playstation-hong-kong"
    | "playstation-page";
};

type LedgerDocument = {
  version: 1;
  updatedAt: string;
  records: GameRecord[];
};

type ExchangeRatePayload = {
  base: "CNY";
  date: string;
  rates: Partial<Record<Currency, number>>;
  source: string;
};

type AppConfigPayload = {
  statsPlatforms?: StatsPlatformScope;
  error?: string;
};

const storageKey = "switch-cartridge-ledger";
const exchangeCacheKey = "switch-ledger-exchange-rates-v1";
const currencies = ["CNY", "JPY", "HKD", "USD", "EUR", "BRL"] as const;
const gamePlatforms = ["Nintendo Switch", "PlayStation"] as const;
const regions = ["日版", "港版", "台版", "美版", "欧版", "其他"] as const;
const gameFormats = ["实体卡带", "实体光盘", "数字版"] as const;

const emptyForm: FormState = {
  platform: "Nintendo Switch",
  title: "",
  price: 0,
  currency: "CNY",
  purchaseDate: "",
  region: "日版",
  format: "实体卡带",
  seller: "",
  coverUrl: "",
  officialUrl: "",
  notes: "",
  soldDate: "",
  soldPrice: 0,
  soldCurrency: "CNY",
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
    EUR: "€",
    BRL: "R$",
  }[currency];

  return `${symbol}${currencyFormatter.format(value)}`;
}

function currencyLabel(currency: Currency) {
  return {
    CNY: "CNY 人民币",
    JPY: "JPY 日元",
    HKD: "HKD 港币",
    USD: "USD 美元",
    EUR: "EUR 欧元",
    BRL: "BRL 巴西雷亚尔",
  }[currency];
}

function platformLabel(platform: GamePlatform) {
  return {
    "Nintendo Switch": "Nintendo Switch",
    PlayStation: "PlayStation",
  }[platform];
}

function physicalFormatForPlatform(platform: GamePlatform): GameFormat {
  return platform === "PlayStation" ? "实体光盘" : "实体卡带";
}

function formatOptionsForPlatform(platform: GamePlatform): GameFormat[] {
  return [physicalFormatForPlatform(platform), "数字版"];
}

function normalizeFormatForPlatform(
  format: GameFormat,
  platform: GamePlatform,
): GameFormat {
  if (format === "数字版") {
    return format;
  }

  return physicalFormatForPlatform(platform);
}

function isPhysicalFormat(format: GameFormat) {
  return format !== "数字版";
}

function officialUrlLabel(platform: GamePlatform) {
  return platform === "PlayStation" ? "PlayStation 页面" : "Nintendo 页面";
}

function officialUrlPlaceholder(platform: GamePlatform) {
  return platform === "PlayStation"
    ? "https://store.playstation.com/zh-hant-hk/product/..."
    : "https://www.nintendo.com/...";
}

function convertToCny(
  amount: number,
  currency: Currency,
  exchangeRates: ExchangeRatePayload | null,
) {
  if (currency === "CNY") {
    return amount;
  }

  const rate = exchangeRates?.rates[currency];
  return typeof rate === "number" && Number.isFinite(rate) ? amount * rate : null;
}

function sumRecordsInCny(
  records: GameRecord[],
  exchangeRates: ExchangeRatePayload | null,
  valueForRecord: (record: GameRecord) => { amount: number; currency: Currency } | null,
) {
  return records.reduce(
    (sum, record) => {
      const value = valueForRecord(record);
      if (!value) {
        return sum;
      }

      const cnyValue = convertToCny(value.amount, value.currency, exchangeRates);
      return cnyValue === null
        ? { total: sum.total, missingRates: true }
        : { total: sum.total + cnyValue, missingRates: sum.missingRates };
    },
    { total: 0, missingRates: false },
  );
}

function formatCnyTotal(total: number, missingRates: boolean) {
  return `${missingRates ? "部分 " : ""}${formatMoney(total, "CNY")}`;
}

function formatCnyConversion(
  amount: number,
  currency: Currency,
  exchangeRates: ExchangeRatePayload | null,
) {
  if (currency === "CNY") {
    return "";
  }

  const cnyValue = convertToCny(amount, currency, exchangeRates);
  return cnyValue === null ? "等待汇率" : `≈ ${formatMoney(cnyValue, "CNY")}`;
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
    "playstation-hong-kong": "PS 香港",
    "playstation-page": "PS 页面",
  }[source];
}

function normalizeLookupCurrency(value: string | null): Currency | null {
  return currencies.includes(value as Currency) ? (value as Currency) : null;
}

function lookupPriceLabel(result: NintendoCoverResult) {
  const currency = normalizeLookupCurrency(result.currency);
  return result.price !== null && currency ? formatMoney(result.price, currency) : "";
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

function defaultRegionForPlatform(platform: GamePlatform): Region {
  return platform === "PlayStation" ? "港版" : "日版";
}

function createEmptyForm(platform: GamePlatform = "Nintendo Switch") {
  return {
    ...emptyForm,
    platform,
    region: defaultRegionForPlatform(platform),
    format: physicalFormatForPlatform(platform),
    purchaseDate: todayString(),
  };
}

function platformPath(platform: GamePlatform) {
  return platform === "PlayStation" ? "/playstation" : "/nintendo-switch";
}

function platformFromPath(pathname: string): GamePlatform | null {
  if (pathname.startsWith("/playstation")) {
    return "PlayStation";
  }

  if (pathname === "/" || pathname.startsWith("/nintendo-switch")) {
    return "Nintendo Switch";
  }

  return null;
}

function setPlatformUrl(platform: GamePlatform, mode: "push" | "replace") {
  if (
    typeof window === "undefined" ||
    window.location.pathname === platformPath(platform)
  ) {
    return;
  }

  window.history[mode === "push" ? "pushState" : "replaceState"](
    { platform },
    "",
    platformPath(platform),
  );
}

function isStatsPlatformScope(value: unknown): value is StatsPlatformScope {
  return (
    value === "all" ||
    value === "nintendo-switch" ||
    value === "playstation"
  );
}

function statsScopeLabel(scope: StatsPlatformScope) {
  return {
    all: "NS + PS",
    "nintendo-switch": "仅 NS",
    playstation: "仅 PS",
  }[scope];
}

function recordMatchesStatsScope(
  record: GameRecord,
  scope: StatsPlatformScope,
) {
  if (scope === "nintendo-switch") {
    return record.platform === "Nintendo Switch";
  }

  if (scope === "playstation") {
    return record.platform === "PlayStation";
  }

  return true;
}

function textMatchesQuery(value: string, normalizedQuery: string) {
  const normalizedValue = normalizeChineseSearchText(value);
  const compactValue = normalizedValue.replace(/\s+/g, "");
  const compactQuery = normalizedQuery.replace(/\s+/g, "");

  return (
    normalizedValue.includes(normalizedQuery) ||
    (Boolean(compactQuery) && compactValue.includes(compactQuery))
  );
}

export default function LedgerClient({
  initialPlatform,
}: {
  initialPlatform: GamePlatform;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const saveRequestRef = useRef(0);
  const [records, setRecords] = useState<GameRecord[]>([]);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<ActiveView>("records");
  const [activePlatform, setActivePlatform] =
    useState<GamePlatform>(initialPlatform);
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
  const [exchangeRates, setExchangeRates] = useState<ExchangeRatePayload | null>(
    null,
  );
  const [exchangeError, setExchangeError] = useState("");
  const [statsScope, setStatsScope] = useState<StatsPlatformScope>("all");
  const [configError, setConfigError] = useState("");

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
      setRecordsDirty(shouldMigrateLegacyRecords);
      if (shouldMigrateLegacyRecords) {
        setSaveStatus("saving");
      }
      setForm(createEmptyForm(initialPlatform));
      setActiveView("records");
      setStorageReady(true);
    } catch (error) {
      setRecords([]);
      setRecordsDirty(false);
      setStorageError(
        error instanceof Error ? error.message : "无法读取服务端记录",
      );
      setStorageReady(false);
    }
  }, [initialPlatform]);

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

  const applyPlatformPage = useCallback(
    (
      platform: GamePlatform,
      urlMode: "push" | "replace" | false,
    ) => {
      if (urlMode) {
        setPlatformUrl(platform, urlMode);
      }

      setActivePlatform(platform);
      setQuery("");
      setCoverResults([]);
      setCoverError("");

      if (editingId || activeView === "form") {
        setEditingId(null);
        setForm(createEmptyForm(platform));
        setActiveView("records");
      }
    },
    [activeView, editingId],
  );

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      checkAccess();
    });

    return () => window.cancelAnimationFrame(frame);
  }, [checkAccess]);

  useEffect(() => {
    function handlePopState() {
      const platform = platformFromPath(window.location.pathname);

      if (platform) {
        applyPlatformPage(platform, false);
      }
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [applyPlatformPage]);

  useEffect(() => {
    if (accessStatus !== "unlocked") {
      return;
    }

    let cancelled = false;

    async function loadExchangeRates() {
      setExchangeError("");

      const cached = readCachedExchangeRates();
      if (cached && !cancelled) {
        setExchangeRates(cached);
      }

      try {
        const response = await fetch("/api/exchange-rates", { cache: "no-store" });
        const payload = (await response.json().catch(() => ({}))) as
          | ExchangeRatePayload
          | { error?: string };

        if (!response.ok || !isExchangeRatePayload(payload)) {
          throw new Error(
            "error" in payload && payload.error ? payload.error : "无法更新汇率",
          );
        }

        if (!cancelled) {
          setExchangeRates(payload);
          window.localStorage.setItem(exchangeCacheKey, JSON.stringify(payload));
        }
      } catch (error) {
        if (!cancelled) {
          setExchangeError(
            error instanceof Error ? error.message : "无法更新汇率",
          );
        }
      }
    }

    loadExchangeRates();

    return () => {
      cancelled = true;
    };
  }, [accessStatus]);

  useEffect(() => {
    if (accessStatus !== "unlocked") {
      return;
    }

    let cancelled = false;

    async function loadAppConfig() {
      try {
        const response = await fetch("/api/config", { cache: "no-store" });
        const payload = (await response.json().catch(() => ({}))) as AppConfigPayload;

        if (!response.ok || !isStatsPlatformScope(payload.statsPlatforms)) {
          throw new Error(payload.error || "无法读取统计配置");
        }

        if (!cancelled) {
          setStatsScope(payload.statsPlatforms);
          setConfigError("");
        }
      } catch (error) {
        if (!cancelled) {
          setStatsScope("all");
          setConfigError(
            error instanceof Error ? error.message : "无法读取统计配置",
          );
        }
      }
    }

    loadAppConfig();

    return () => {
      cancelled = true;
    };
  }, [accessStatus]);

  useEffect(() => {
    if (!storageReady || !recordsDirty) {
      return;
    }

    const requestId = saveRequestRef.current + 1;
    saveRequestRef.current = requestId;
    const timeoutId = window.setTimeout(() => {
      saveLedgerToServer(records)
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
  }, [records, recordsDirty, storageReady]);

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
    setRecordsDirty(false);
    setStorageReady(false);
    setStorageError("");
    setSaveStatus("idle");
    setAccessStatus("locked");
    setEditingId(null);
    setActiveView("records");
    setPassword("");
  }

  const platformRecords = useMemo(
    () => records.filter((record) => record.platform === activePlatform),
    [activePlatform, records],
  );

  const statsRecords = useMemo(
    () => records.filter((record) => recordMatchesStatsScope(record, statsScope)),
    [records, statsScope],
  );

  const filteredRecords = useMemo(() => {
    const normalizedQuery = normalizeChineseSearchText(query);
    const source = normalizedQuery
      ? platformRecords.filter((record) =>
          textMatchesQuery(
            [
              record.title,
              record.region,
              record.format,
              record.seller,
              record.notes,
              record.soldDate ? "已卖出" : "持有中",
            ].join(" "),
            normalizedQuery,
          ),
        )
      : platformRecords;

    return [...source].sort((a, b) => {
      if (sortBy === "price") {
        return (
          (convertToCny(b.price, b.currency, exchangeRates) ?? b.price) -
          (convertToCny(a.price, a.currency, exchangeRates) ?? a.price)
        );
      }

      if (sortBy === "title") {
        return a.title.localeCompare(b.title, "zh-Hans-CN");
      }

      return (
        new Date(b.purchaseDate).getTime() -
        new Date(a.purchaseDate).getTime()
      );
    });
  }, [exchangeRates, platformRecords, query, sortBy]);

  const switchCount = records.filter(
    (record) => record.platform === "Nintendo Switch",
  ).length;
  const playStationCount = records.length - switchCount;
  const physicalCount = statsRecords.filter((record) =>
    isPhysicalFormat(record.format),
  ).length;
  const digitalCount = statsRecords.length - physicalCount;
  const soldCount = statsRecords.filter((record) => record.soldDate).length;
  const purchaseCnyStats = useMemo(
    () =>
      sumRecordsInCny(statsRecords, exchangeRates, (record) => ({
        amount: record.price,
        currency: record.currency,
      })),
    [exchangeRates, statsRecords],
  );
  const saleCnyStats = useMemo(
    () =>
      sumRecordsInCny(statsRecords, exchangeRates, (record) =>
        record.soldDate
          ? { amount: record.soldPrice, currency: record.soldCurrency }
          : null,
      ),
    [exchangeRates, statsRecords],
  );

  function updateForm<Key extends keyof FormState>(
    key: Key,
    value: FormState[Key],
  ) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function resetForm() {
    setEditingId(null);
    setForm(createEmptyForm(activePlatform));
    setCoverResults([]);
    setCoverError("");
  }

  function switchPlatformPage(platform: GamePlatform) {
    applyPlatformPage(platform, "push");
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const normalized: FormState = {
      ...form,
      title: form.title.trim(),
      seller: isPhysicalFormat(form.format) ? form.seller.trim() : "",
      coverUrl: form.coverUrl.trim(),
      officialUrl: form.officialUrl.trim(),
      notes: form.notes.trim(),
      price: Number(form.price) || 0,
      format: normalizeFormatForPlatform(form.format, form.platform),
      soldDate: isPhysicalFormat(form.format) ? form.soldDate : "",
      soldPrice:
        isPhysicalFormat(form.format) && form.soldDate
          ? Number(form.soldPrice) || 0
          : 0,
      soldCurrency: form.soldCurrency,
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
    setActiveView("records");

    resetForm();
  }

  function editRecord(record: GameRecord) {
    setEditingId(record.id);
    setPlatformUrl(record.platform, "replace");
    setActivePlatform(record.platform);
    setForm({
      platform: record.platform,
      title: record.title,
      price: record.price,
      currency: record.currency,
      purchaseDate: record.purchaseDate,
      region: record.region,
      format: record.format,
      seller: record.seller,
      coverUrl: record.coverUrl,
      officialUrl: record.officialUrl,
      notes: record.notes,
      soldDate: record.soldDate,
      soldPrice: record.soldPrice,
      soldCurrency: record.soldCurrency,
    });
    setActiveView("form");
  }

  function updateFormat(format: GameFormat) {
    setForm((current) => ({
      ...current,
      format,
      seller: isPhysicalFormat(format) ? current.seller : "",
      soldDate: isPhysicalFormat(format) ? current.soldDate : "",
      soldPrice: isPhysicalFormat(format) ? current.soldPrice : 0,
      soldCurrency: isPhysicalFormat(format)
        ? current.soldCurrency
        : current.currency,
    }));
  }

  function updatePlatform(platform: GamePlatform) {
    setPlatformUrl(platform, "replace");
    setActivePlatform(platform);
    setCoverResults([]);
    setCoverError("");
    setForm((current) => ({
      ...current,
      platform,
      region: platform === "PlayStation" && current.region === "日版"
        ? "港版"
        : current.region,
      format: normalizeFormatForPlatform(current.format, platform),
      soldDate: isPhysicalFormat(
        normalizeFormatForPlatform(current.format, platform),
      )
        ? current.soldDate
        : "",
      soldPrice: isPhysicalFormat(
        normalizeFormatForPlatform(current.format, platform),
      )
        ? current.soldPrice
        : 0,
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
    setActiveView("form");
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

  async function exportRecords() {
    try {
      const response = await fetch("/api/export", { cache: "no-store" });
      const payload = await response.blob();

      if (!response.ok) {
        const error = await payload.text().catch(() => "");
        throw new Error(error || "导出失败");
      }

      const url = URL.createObjectURL(payload);
      const link = document.createElement("a");
      link.href = url;
      link.download = `game-ledger-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "导出失败");
    }
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
      window.alert("JSON 文件不是有效的游戏购买记录");
    } finally {
      event.target.value = "";
    }
  }

  async function lookupOfficialGame(mode: "title" | "url") {
    const params = new URLSearchParams();
    const searchTerm = form.title.trim();
    const officialUrl = form.officialUrl.trim();
    const endpoint =
      form.platform === "PlayStation"
        ? "/api/playstation-game"
        : "/api/nintendo-cover";

    if (mode === "title") {
      if (!searchTerm) {
        setCoverError("先输入游戏名字");
        return;
      }

      params.set("q", searchTerm);
    } else {
      if (!officialUrl) {
        setCoverError(`先填写${officialUrlLabel(form.platform)}`);
        return;
      }

      params.set("url", officialUrl);
    }

    setCoverStatus("searching");
    setCoverError("");

    try {
      const response = await fetch(`${endpoint}?${params.toString()}`);
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
        setCoverError("未找到官方数据");
      }
    } catch (error) {
      setCoverResults([]);
      setCoverError(error instanceof Error ? error.message : "官方数据查询失败");
    } finally {
      setCoverStatus("idle");
    }
  }

  function applyOfficialGame(result: NintendoCoverResult) {
    const currency = normalizeLookupCurrency(result.currency);
    const resultPlatform: GamePlatform = result.source.startsWith("playstation")
      ? "PlayStation"
      : "Nintendo Switch";
    setPlatformUrl(resultPlatform, "replace");
    setActivePlatform(resultPlatform);

    setForm((current) => {
      const format = normalizeFormatForPlatform(current.format, resultPlatform);
      const shouldApplyPrice =
        result.price !== null &&
        (resultPlatform === "PlayStation" || format === "数字版");

      return {
        ...current,
        platform: resultPlatform,
        format,
        title: result.displayTitle || result.title,
        coverUrl: result.coverUrl,
        officialUrl: result.officialUrl || result.nintendoUrl || "",
        price: shouldApplyPrice ? result.price ?? current.price : current.price,
        currency: shouldApplyPrice ? currency ?? current.currency : current.currency,
      };
    });
    setCoverError("");
  }

  if (accessStatus !== "unlocked") {
    return (
      <main className="login-screen flex min-h-screen items-center justify-center px-4 py-8 text-base-content">
        <form
          onSubmit={submitPassword}
          className="login-card grid w-full max-w-md gap-4 p-5 sm:p-6"
        >
          <div>
            <p className="ledger-kicker">Nintendo Switch / PlayStation</p>
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
            <p className="alert alert-warning py-2 text-sm font-semibold">
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
    <main className="ledger-page min-h-screen text-base-content">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-3 py-3 sm:gap-5 sm:px-5 sm:py-5 lg:px-8">
        <header className="ledger-header p-4 pl-5 sm:p-5 sm:pl-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="ledger-kicker">{platformLabel(activePlatform)}</p>
              <h1 className="mt-1 text-2xl font-bold tracking-normal sm:text-4xl">
                {activePlatform === "PlayStation" ? "PlayStation 游戏" : "NS 游戏"}
              </h1>
            </div>
            <div className="flex items-center gap-3 self-start sm:self-center">
              {saveStatusLabel(saveStatus) ? (
                <span
                  className={`text-sm font-semibold ${
                    saveStatus === "error" ? "text-error" : "text-base-content/70"
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
            <p className="alert alert-warning mt-3 py-2 text-sm font-semibold">
              {storageError}
            </p>
          ) : null}
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 xl:grid-cols-5">
            <Stat label="当前页面" value={`${platformRecords.length}`} />
            <Stat
              label="统计范围"
              value={`${statsScopeLabel(statsScope)} ${statsRecords.length}`}
            />
            <Stat label="实体 / 数字" value={`${physicalCount} / ${digitalCount}`} />
            <Stat
              label="总支出 CNY"
              value={formatCnyTotal(
                purchaseCnyStats.total,
                purchaseCnyStats.missingRates,
              )}
            />
            <Stat
              label={`卖出回收 ${soldCount ? `(${soldCount})` : ""}`}
              value={formatCnyTotal(saleCnyStats.total, saleCnyStats.missingRates)}
            />
          </div>
          <div className="mt-4 flex flex-col gap-3 border-t border-base-300 pt-4 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <div className="flex rounded-xl border border-base-300 bg-base-200 p-1">
                {gamePlatforms.map((platform) => (
                  <button
                    key={platform}
                    className={`platform-tab ${
                      activePlatform === platform ? "active" : ""
                    }`}
                    aria-pressed={activePlatform === platform}
                    type="button"
                    onClick={() => switchPlatformPage(platform)}
                  >
                    {platform === "PlayStation"
                      ? `PlayStation ${playStationCount}`
                      : `Nintendo Switch ${switchCount}`}
                  </button>
                ))}
              </div>
              <div className="flex rounded-xl border border-base-300 bg-base-200 p-1">
                <button
                  className={`view-tab ${activeView === "records" ? "active" : ""}`}
                  aria-pressed={activeView === "records"}
                  type="button"
                  onClick={() => setActiveView("records")}
                >
                  记录
                </button>
                <button
                  className={`view-tab ${activeView === "form" ? "active" : ""}`}
                  aria-pressed={activeView === "form"}
                  type="button"
                  onClick={() => {
                    if (!editingId) {
                      resetForm();
                    }
                    setActiveView("form");
                  }}
                >
                  {editingId ? "编辑" : "新增"}
                </button>
              </div>
            </div>
            <p
              className={`text-sm font-semibold ${
                configError || exchangeError ? "text-error" : "text-base-content/70"
              }`}
            >
              {configError ||
                exchangeError ||
                (exchangeRates?.date ? `汇率 ${exchangeRates.date}` : "汇率更新中")}
            </p>
          </div>
        </header>

        {storageReady ? (
          <section className="min-w-0">
          {activeView === "form" ? (
          <form onSubmit={handleSubmit} className="app-surface overflow-hidden">
            <div className="surface-toolbar flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <div>
                <p className="text-xs font-bold uppercase text-primary">
                  {editingId ? "Edit game" : "New game"}
                </p>
                <h2 className="mt-1 text-xl font-bold">
                  {editingId ? "编辑游戏" : "新增游戏"}
                </h2>
              </div>
              <div className="flex flex-wrap gap-2">
                {editingId ? (
                  <button type="button" className="ghost-button" onClick={resetForm}>
                    取消编辑
                  </button>
                ) : null}
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => setActiveView("records")}
                >
                  返回记录
                </button>
              </div>
            </div>

            <div className="grid gap-0 xl:grid-cols-[360px_minmax(0,1fr)]">
              <aside className="border-b border-base-300 bg-base-200 p-4 sm:p-5 xl:border-b-0 xl:border-r xl:border-base-300">
            <div className="cover-frame overflow-hidden">
              {form.coverUrl ? (
                <img
                  src={form.coverUrl}
                  alt={`${form.title || "游戏"}封面`}
                  className="h-48 w-full object-cover sm:h-60"
                />
              ) : (
                <div className="flex h-48 items-center justify-center bg-primary px-8 text-center text-4xl font-black text-primary-content sm:h-60">
                  {coverLabel(form.title) ||
                    (form.platform === "PlayStation" ? "PS" : "SWITCH")}
                </div>
              )}
            </div>

            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                className="secondary-button"
                disabled={coverStatus === "searching" || !form.title.trim()}
                onClick={() => lookupOfficialGame("title")}
              >
                {coverStatus === "searching" ? "查询中" : "按名称找官方数据"}
              </button>
              <button
                type="button"
                className="ghost-button"
                disabled={coverStatus === "searching" || !form.officialUrl.trim()}
                onClick={() => lookupOfficialGame("url")}
              >
                从页面取数据
              </button>
            </div>

            {coverError ? (
              <p className="alert alert-warning mt-2 py-2 text-sm font-semibold">
                {coverError}
              </p>
            ) : null}

            {coverResults.length ? (
              <div className="mt-3 grid gap-2">
                {coverResults.map((result) => {
                  const priceLabel = lookupPriceLabel(result);

                  return (
                    <button
                      key={result.id}
                      type="button"
                      className="cover-result"
                      onClick={() => applyOfficialGame(result)}
                    >
                      <img
                        src={result.coverUrl}
                        alt={`${result.displayTitle || result.title}封面`}
                      />
                      <span>
                        <strong>{result.displayTitle || result.title}</strong>
                        <small>
                          {coverSourceLabel(result.source)} ·{" "}
                          {result.platform}
                          {result.releaseDate
                            ? ` · ${result.releaseDate.slice(0, 10)}`
                            : ""}
                          {priceLabel ? ` · ${priceLabel}` : ""}
                        </small>
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : null}

              </aside>

              <div className="p-4 sm:p-5">
            <div className="grid gap-3 lg:grid-cols-2">
              <label className="field">
                <span>平台</span>
                <select
                  value={form.platform}
                  onChange={(event) =>
                    updatePlatform(event.target.value as GamePlatform)
                  }
                >
                  {gamePlatforms.map((platform) => (
                    <option key={platform} value={platform}>
                      {platformLabel(platform)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>游戏名字</span>
                <input
                  required
                  value={form.title}
                  onChange={(event) => updateForm("title", event.target.value)}
                  placeholder="例如 塞尔达 / Elden Ring / Final Fantasy"
                />
              </label>

              <div className="grid gap-3 sm:grid-cols-[1fr_minmax(12rem,0.55fr)]">
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
                      <option key={currency} value={currency}>
                        {currencyLabel(currency)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {form.price && form.currency !== "CNY" ? (
                <p className="rounded-xl bg-base-200 px-3 py-2 text-sm font-semibold text-base-content/70 lg:col-span-2">
                  {formatCnyConversion(form.price, form.currency, exchangeRates)}
                </p>
              ) : null}

              <label className="field">
                <span>购买日期</span>
                <input
                  required
                  type="date"
                  value={form.purchaseDate}
                  onChange={(event) => updateForm("purchaseDate", event.target.value)}
                />
              </label>

              <div className="grid gap-3 sm:grid-cols-2 lg:col-span-2">
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
                    {formatOptionsForPlatform(form.platform).map((format) => (
                      <option key={format}>{format}</option>
                    ))}
                  </select>
                </label>
              </div>

              {isPhysicalFormat(form.format) ? (
                <div className="sale-panel p-3 lg:col-span-2">
                  <label className="checkbox-field">
                    <input
                      type="checkbox"
                      checked={Boolean(form.soldDate)}
                      onChange={(event) => toggleSold(event.target.checked)}
                    />
                    <span>这份实体游戏已卖出</span>
                  </label>

                  {form.soldDate ? (
                    <>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2 md:grid-cols-[minmax(10rem,1fr)_minmax(10rem,1fr)_minmax(12rem,0.8fr)]">
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
                            <option key={currency} value={currency}>
                              {currencyLabel(currency)}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    {form.soldPrice && form.soldCurrency !== "CNY" ? (
                      <p className="mt-3 rounded-xl bg-base-100 px-3 py-2 text-sm font-semibold text-base-content/70">
                        {formatCnyConversion(
                          form.soldPrice,
                          form.soldCurrency,
                          exchangeRates,
                        )}
                      </p>
                    ) : null}
                    </>
                  ) : null}
                </div>
              ) : null}

              {isPhysicalFormat(form.format) ? (
                <label className="field">
                  <span>购买渠道</span>
                  <input
                    value={form.seller}
                    onChange={(event) => updateForm("seller", event.target.value)}
                    placeholder="淘宝 / 闲鱼 / 线下店"
                  />
                </label>
              ) : null}

              <label className="field">
                <span>封面 URL</span>
                <input
                  value={form.coverUrl}
                  onChange={(event) => updateForm("coverUrl", event.target.value)}
                  placeholder="官方图片地址"
                />
              </label>

              <label className="field">
                <span>{officialUrlLabel(form.platform)}</span>
                <input
                  value={form.officialUrl}
                  onChange={(event) => updateForm("officialUrl", event.target.value)}
                  placeholder={officialUrlPlaceholder(form.platform)}
                />
              </label>

              <label className="field lg:col-span-2">
                <span>备注</span>
                <textarea
                  value={form.notes}
                  onChange={(event) => updateForm("notes", event.target.value)}
                  placeholder="特典、成色、是否盒说齐全"
                />
              </label>
            </div>

              <div className="flex flex-col gap-2 border-t border-base-300 pt-4 sm:flex-row sm:justify-end lg:col-span-2">
                <button
                  className="ghost-button w-full sm:w-auto"
                  type="button"
                  onClick={() => setActiveView("records")}
                >
                  返回记录
                </button>
                <button className="primary-button w-full sm:w-auto" type="submit">
                  {editingId ? "保存修改" : "加入记录"}
                </button>
              </div>
            </div>
              </div>
          </form>
          ) : null}

          {activeView === "records" ? (
          <section className="flex min-w-0 flex-col gap-4">
            <div className="filter-panel grid gap-3 p-3 sm:p-4 lg:grid-cols-[minmax(0,1fr)_160px_120px_122px_122px] lg:items-end">
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
              <button
                className="primary-button w-full"
                type="button"
                onClick={() => {
                  resetForm();
                  setActiveView("form");
                }}
              >
                新增游戏
              </button>
              <button
                className="ghost-button w-full"
                type="button"
                onClick={importRecordsClick}
              >
                导入 JSON
              </button>
              <button
                className="secondary-button w-full"
                type="button"
                onClick={exportRecords}
              >
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
                  className="record-card flex h-full flex-col overflow-hidden"
                >
                  <div className="record-cover relative bg-primary">
                    {record.coverUrl ? (
                      <img
                        src={record.coverUrl}
                        alt={`${record.title}封面`}
                        className="record-cover-image"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center px-8 text-center text-4xl font-black text-primary-content">
                        {coverLabel(record.title) ||
                          (record.platform === "PlayStation" ? "PS" : "NS")}
                      </div>
                    )}
                    <div className="image-badge absolute left-3 top-3">
                      {record.region}
                    </div>
                    <div className="image-badge alt absolute right-3 top-3">
                      {record.soldDate ? "已卖出" : record.format}
                    </div>
                  </div>
                  <div className="flex flex-1 flex-col gap-3 p-3 sm:p-4">
                    <div>
                      <h3 className="line-clamp-2 min-h-12 text-lg font-semibold leading-6">
                        {record.title}
                      </h3>
                      <p className="mt-1 text-sm text-base-content/60">
                        {record.purchaseDate} · {record.format}
                        {record.seller ? ` · ${record.seller}` : ""}
                      </p>
                    </div>
                    <div className="mt-auto grid gap-3 border-t border-base-300 pt-3">
                      <div className="grid min-h-[4.6rem] grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-base-content/60">
                            买入
                          </p>
                          <span className="text-2xl font-bold text-primary">
                            {formatMoney(record.price, record.currency)}
                          </span>
                          {record.currency !== "CNY" ? (
                            <p className="mt-0.5 text-xs font-semibold leading-4 text-base-content/60">
                              {formatCnyConversion(
                                record.price,
                                record.currency,
                                exchangeRates,
                              )}
                            </p>
                          ) : null}
                        </div>
                        {record.soldDate ? (
                          <div className="min-w-0 text-right">
                            <p className="text-xs font-semibold text-success">
                              {record.soldDate} 卖出
                            </p>
                            <span className="text-lg font-bold text-success">
                              {formatMoney(record.soldPrice, record.soldCurrency)}
                            </span>
                            {record.soldCurrency !== "CNY" ? (
                              <p className="mt-0.5 text-xs font-semibold leading-4 text-base-content/60">
                                {formatCnyConversion(
                                  record.soldPrice,
                                  record.soldCurrency,
                                  exchangeRates,
                                )}
                              </p>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                      <div
                        className={`grid gap-2 ${
                          isPhysicalFormat(record.format) && !record.soldDate
                            ? "grid-cols-3"
                            : "grid-cols-2"
                        }`}
                      >
                        {isPhysicalFormat(record.format) && !record.soldDate ? (
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
                      <p className="rounded-xl bg-base-200 px-3 py-2 text-sm text-base-content/70">
                        {record.notes}
                      </p>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>

            {!filteredRecords.length ? (
              <div className="empty-state p-10 text-center">
                这个平台暂无匹配记录
              </div>
            ) : null}
          </section>
          ) : null}
          </section>
        ) : (
          <section className="app-surface p-8 text-center text-sm font-semibold text-base-content/70">
            {storageError || "正在加载记录"}
          </section>
        )}
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat-card min-w-0 px-3 py-2.5">
      <p className="text-xs font-semibold text-base-content/60">{label}</p>
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

  const record = value as Partial<GameRecord> & {
    condition?: unknown;
    nintendoUrl?: unknown;
    playstationUrl?: unknown;
  };
  if (!record.title || typeof record.title !== "string") {
    return null;
  }

  const platform = gamePlatforms.includes(record.platform as GamePlatform)
    ? (record.platform as GamePlatform)
    : typeof record.playstationUrl === "string" && record.playstationUrl
      ? "PlayStation"
      : "Nintendo Switch";
  const currency = currencies.includes(record.currency as Currency)
    ? (record.currency as Currency)
    : "CNY";
  const region = regions.includes(record.region as Region)
    ? (record.region as Region)
    : "其他";
  const rawFormat = gameFormats.includes(record.format as GameFormat)
    ? (record.format as GameFormat)
    : record.condition === "数字版"
      ? "数字版"
      : physicalFormatForPlatform(platform);
  const format = normalizeFormatForPlatform(rawFormat, platform);
  const soldDate =
    isPhysicalFormat(format) &&
    typeof record.soldDate === "string" &&
    record.soldDate
      ? record.soldDate
      : "";
  const soldCurrency = currencies.includes(record.soldCurrency as Currency)
    ? (record.soldCurrency as Currency)
    : currency;
  const officialUrl =
    typeof record.officialUrl === "string"
      ? record.officialUrl
      : typeof record.nintendoUrl === "string"
        ? record.nintendoUrl
        : typeof record.playstationUrl === "string"
          ? record.playstationUrl
          : "";

  return {
    id: typeof record.id === "string" ? record.id : createId(),
    platform,
    title: record.title.trim(),
    price: Number(record.price) || 0,
    currency,
    purchaseDate:
      typeof record.purchaseDate === "string" && record.purchaseDate
        ? record.purchaseDate
        : new Date().toISOString().slice(0, 10),
    region,
    format,
    seller:
      isPhysicalFormat(format) && typeof record.seller === "string"
        ? record.seller
        : "",
    coverUrl: typeof record.coverUrl === "string" ? record.coverUrl : "",
    officialUrl,
    notes: typeof record.notes === "string" ? record.notes : "",
    soldDate,
    soldPrice: soldDate ? Number(record.soldPrice) || 0 : 0,
    soldCurrency,
  };
}

async function fetchLedgerFromServer(): Promise<LedgerDocument> {
  const response = await fetch("/api/records", { cache: "no-store" });
  const payload = (await response.json().catch(() => ({}))) as
    | Partial<LedgerDocument>
    | { error?: string };

  if (!response.ok) {
    throw new Error(
      "error" in payload && payload.error
        ? payload.error
        : `无法读取服务端记录（HTTP ${response.status}）`,
    );
  }

  const records = "records" in payload ? payload.records : null;

  return {
    version: 1,
    updatedAt:
      "updatedAt" in payload && typeof payload.updatedAt === "string"
        ? payload.updatedAt
        : "",
    records: Array.isArray(records)
      ? records
          .map(normalizeImportedRecord)
          .filter((record): record is GameRecord => Boolean(record))
      : [],
  };
}

async function saveLedgerToServer(records: GameRecord[]) {
  const response = await fetch("/api/records", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ records }),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
  };

  if (!response.ok) {
    throw new Error(payload.error || `保存服务端记录失败（HTTP ${response.status}）`);
  }
}

function readCachedExchangeRates() {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(exchangeCacheKey);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as unknown;
    return isExchangeRatePayload(parsed) ? parsed : null;
  } catch {
    window.localStorage.removeItem(exchangeCacheKey);
    return null;
  }
}

function isExchangeRatePayload(value: unknown): value is ExchangeRatePayload {
  if (!value || typeof value !== "object") {
    return false;
  }

  const payload = value as Partial<ExchangeRatePayload>;
  return (
    payload.base === "CNY" &&
    typeof payload.date === "string" &&
    typeof payload.source === "string" &&
    Boolean(payload.rates) &&
    currencies.every((currency) => {
      const rate = payload.rates?.[currency];
      return typeof rate === "number" && Number.isFinite(rate) && rate > 0;
    })
  );
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
