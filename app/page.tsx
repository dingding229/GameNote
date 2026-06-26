/* eslint-disable @next/next/no-img-element */
"use client";

import {
  ChangeEvent,
  FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type Region = "日版" | "港版" | "美版" | "欧版" | "国行" | "其他";
type Condition = "全新" | "二手" | "限定版";
type Currency = "CNY" | "JPY" | "HKD" | "USD";

type GameRecord = {
  id: string;
  title: string;
  price: number;
  currency: Currency;
  purchaseDate: string;
  region: Region;
  condition: Condition;
  seller: string;
  coverUrl: string;
  nintendoUrl: string;
  notes: string;
};

type FormState = Omit<GameRecord, "id">;

type NintendoCoverResult = {
  id: string;
  title: string;
  coverUrl: string;
  nintendoUrl: string;
  platform: string;
  releaseDate: string | null;
  price: number | null;
  currency: string | null;
  source: "algolia" | "page";
};

const storageKey = "switch-cartridge-ledger";
const currencies = ["CNY", "JPY", "HKD", "USD"] as const;
const regions = ["日版", "港版", "美版", "欧版", "国行", "其他"] as const;
const conditions = ["全新", "二手", "限定版"] as const;

const starterRecords: GameRecord[] = [
  {
    id: "sample-zelda-botw",
    title: "The Legend of Zelda: Breath of the Wild",
    price: 278,
    currency: "CNY",
    purchaseDate: "2024-10-02",
    region: "美版",
    condition: "二手",
    seller: "闲鱼",
    coverUrl:
      "https://assets.nintendo.com/image/upload/c_fill,w_1200/q_auto:best/f_auto/dpr_2.0/store/software/switch/70010000000025/7137262b5a64d921e193653f8aa0b722925abc5680380ca0e18a5cfd91697f58",
    nintendoUrl:
      "https://www.nintendo.com/us/store/products/the-legend-of-zelda-breath-of-the-wild-switch/",
    notes: "盒说齐全",
  },
  {
    id: "sample-mario-kart",
    title: "Mario Kart 8 Deluxe",
    price: 249,
    currency: "CNY",
    purchaseDate: "2025-01-18",
    region: "港版",
    condition: "全新",
    seller: "淘宝",
    coverUrl:
      "https://assets.nintendo.com/image/upload/c_fill,w_1200/q_auto:best/f_auto/dpr_2.0/store/software/switch/70010000000153/de697f487a36d802dd9a5ff0341f717c8486221f2f1219b675af37aca63bc453",
    nintendoUrl:
      "https://www.nintendo.com/us/store/products/mario-kart-8-deluxe-switch/",
    notes: "和手柄一起入手",
  },
];

const emptyForm: FormState = {
  title: "",
  price: 0,
  currency: "CNY",
  purchaseDate: new Date().toISOString().slice(0, 10),
  region: "日版",
  condition: "二手",
  seller: "",
  coverUrl: "",
  nintendoUrl: "",
  notes: "",
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

function coverLabel(title: string) {
  return title
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}

export default function Home() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [records, setRecords] = useState<GameRecord[]>(loadInitialRecords);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<"date" | "price" | "title">("date");
  const [coverResults, setCoverResults] = useState<NintendoCoverResult[]>([]);
  const [coverStatus, setCoverStatus] = useState<"idle" | "searching">("idle");
  const [coverError, setCoverError] = useState("");

  useEffect(() => {
    window.localStorage.setItem(storageKey, JSON.stringify(records));
  }, [records]);

  const filteredRecords = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const source = normalizedQuery
      ? records.filter((record) =>
          [
            record.title,
            record.region,
            record.condition,
            record.seller,
            record.notes,
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

  const latestRecord = filteredRecords[0];

  function updateForm<Key extends keyof FormState>(
    key: Key,
    value: FormState[Key],
  ) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function resetForm() {
    setEditingId(null);
    setForm({ ...emptyForm, purchaseDate: new Date().toISOString().slice(0, 10) });
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
      condition: record.condition,
      seller: record.seller,
      coverUrl: record.coverUrl,
      nintendoUrl: record.nintendoUrl,
      notes: record.notes,
    });
  }

  function deleteRecord(recordId: string) {
    setRecords((current) => current.filter((record) => record.id !== recordId));
    if (editingId === recordId) {
      resetForm();
    }
  }

  function exportRecords() {
    const payload = JSON.stringify(records, null, 2);
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
      if (!Array.isArray(parsed)) {
        throw new Error("Expected an array");
      }

      const importedRecords = parsed
        .map(normalizeImportedRecord)
        .filter((record): record is GameRecord => Boolean(record));

      if (!importedRecords.length) {
        throw new Error("No valid records");
      }

      setRecords(importedRecords);
      resetForm();
    } catch {
      window.alert("JSON 文件不是有效的 Switch 卡带记录");
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

  return (
    <main className="min-h-screen bg-[#f6f4ef] text-[#202020]">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 border-b border-[#d8d2c5] pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-semibold text-[#d1222a]">Nintendo Switch</p>
            <h1 className="mt-1 text-3xl font-bold tracking-normal sm:text-4xl">
              卡带购买记录
            </h1>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:min-w-[560px]">
            <Stat label="卡带数" value={`${records.length}`} />
            <Stat
              label="总支出"
              value={formatCurrencyStats(currencyStats, "total")}
            />
            <Stat
              label="入手均价"
              value={formatCurrencyStats(currencyStats, "average")}
            />
            <Stat label="最近购买" value={latestRecord?.purchaseDate ?? "-"} />
          </div>
        </header>

        <section className="grid gap-5 xl:grid-cols-[400px_1fr]">
          <form
            onSubmit={handleSubmit}
            className="h-fit rounded-lg border border-[#d8d2c5] bg-white p-4 shadow-sm"
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

            <div className="mt-4 overflow-hidden rounded-md border border-[#d8d2c5] bg-[#faf9f5]">
              {form.coverUrl ? (
                <img
                  src={form.coverUrl}
                  alt={`${form.title || "游戏"}封面`}
                  className="h-56 w-full object-cover"
                />
              ) : (
                <div className="flex h-56 items-center justify-center bg-[#e60012] px-8 text-center text-4xl font-black text-white">
                  {coverLabel(form.title) || "SWITCH"}
                </div>
              )}
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                className="secondary-button"
                disabled={coverStatus === "searching" || !form.title.trim()}
                onClick={() => lookupNintendoCover("title")}
              >
                {coverStatus === "searching" ? "查询中" : "按名字找封面"}
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
                  placeholder="例如 Zelda / Mario Kart"
                />
              </label>

              <div className="grid grid-cols-[1fr_110px] gap-3">
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

              <div className="grid grid-cols-2 gap-3">
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
                    value={form.condition}
                    onChange={(event) =>
                      updateForm("condition", event.target.value as Condition)
                    }
                  >
                    {conditions.map((condition) => (
                      <option key={condition}>{condition}</option>
                    ))}
                  </select>
                </label>
              </div>

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
            <div className="grid gap-3 rounded-lg border border-[#d8d2c5] bg-white p-4 shadow-sm md:grid-cols-[1fr_170px_120px_120px]">
              <label className="field">
                <span>搜索</span>
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="游戏、版本、渠道、备注"
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
              <button className="ghost-button self-end" onClick={importRecordsClick}>
                导入 JSON
              </button>
              <button className="secondary-button self-end" onClick={exportRecords}>
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
                  className="overflow-hidden rounded-lg border border-[#d8d2c5] bg-white shadow-sm"
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
                  </div>
                  <div className="grid gap-3 p-4">
                    <div>
                      <h3 className="line-clamp-2 min-h-12 text-lg font-semibold leading-6">
                        {record.title}
                      </h3>
                      <p className="mt-1 text-sm text-[#675f52]">
                        {record.purchaseDate} · {record.condition}
                        {record.seller ? ` · ${record.seller}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center justify-between gap-3 border-t border-[#eee8dc] pt-3">
                      <span className="text-2xl font-bold text-[#d1222a]">
                        {formatMoney(record.price, record.currency)}
                      </span>
                      <div className="flex gap-2">
                        <button
                          className="ghost-button"
                          type="button"
                          onClick={() => editRecord(record)}
                        >
                          编辑
                        </button>
                        <button
                          className="danger-button"
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
              <div className="rounded-lg border border-dashed border-[#c8c0b1] bg-white p-10 text-center text-[#675f52]">
                没有匹配记录
              </div>
            ) : null}
          </section>
        </section>
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[#d8d2c5] bg-white px-4 py-3 shadow-sm">
      <p className="text-xs font-semibold text-[#675f52]">{label}</p>
      <p className="mt-1 truncate text-xl font-bold" title={value}>
        {value}
      </p>
    </div>
  );
}

function normalizeImportedRecord(value: unknown): GameRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Partial<GameRecord>;
  if (!record.title || typeof record.title !== "string") {
    return null;
  }

  const currency = currencies.includes(record.currency as Currency)
    ? (record.currency as Currency)
    : "CNY";
  const region = regions.includes(record.region as Region)
    ? (record.region as Region)
    : "其他";
  const condition = conditions.includes(record.condition as Condition)
    ? (record.condition as Condition)
    : "二手";

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
    condition,
    seller: typeof record.seller === "string" ? record.seller : "",
    coverUrl: typeof record.coverUrl === "string" ? record.coverUrl : "",
    nintendoUrl: typeof record.nintendoUrl === "string" ? record.nintendoUrl : "",
    notes: typeof record.notes === "string" ? record.notes : "",
  };
}

function loadInitialRecords() {
  if (typeof window === "undefined") {
    return starterRecords;
  }

  const raw = window.localStorage.getItem(storageKey);
  if (!raw) {
    return starterRecords;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return starterRecords;
    }

    const records = parsed
      .map(normalizeImportedRecord)
      .filter((record): record is GameRecord => Boolean(record));

    return records.length ? records : starterRecords;
  } catch {
    window.localStorage.removeItem(storageKey);
    return starterRecords;
  }
}
