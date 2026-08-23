import * as OpenCC from "opencc-js";

const toSimplified = OpenCC.Converter({ from: "hk", to: "cn" });
const toTraditional = OpenCC.Converter({ from: "cn", to: "hk" });

export function toSimplifiedChinese(value: string) {
  return toSimplified(value);
}

export function toTraditionalChinese(value: string) {
  return toTraditional(value);
}

export function normalizeChineseGameTitle(value: string) {
  return applyMainlandTitleStyle(toSimplifiedChinese(value));
}

export function stripGameTitleLanguageSuffix(value: string) {
  return value
    .replace(
      /\s*[（(][^（）()]*(?:(?:简体|繁体|簡體|繁體)?中文|韩文|韓文|英文|泰文|日文|马来文|馬來文|(?:日|中|英|韩|韓|泰|繁|简|簡){2,}文版)[^（）()]*[）)]\s*$/u,
      "",
    )
    .trim();
}

export function stripPlayStationStoreTitleMetadata(value: string) {
  return stripGameTitleLanguageSuffix(value)
    .replace(
      /\s*[（(]\s*(?:(?:数位|数字|數位)?(?:豪华|豪華|普通|标准|標準)(?:下载|下載)?版|(?:数位|数字|數位)版)\s*[）)]\s*$/u,
      "",
    )
    .replace(
      /\s+(?:(?:数位|数字|數位)?(?:豪华|豪華|普通|标准|標準)(?:下载|下載)?版|(?:下载|下載)游戏(?:普通|标准|標準)版)\s*$/u,
      "",
    )
    .replace(/\s*[（(]\s*PS[45][™®]?(?:\s*[&/]\s*PS[45][™®]?)?\s*[）)]\s*$/iu, "")
    .replace(/\s+PS[45][™®]?(?:\s*[&/]\s*PS[45][™®]?)?\s*$/iu, "")
    .replace(/^《(.+)》$/u, "$1")
    .trim();
}

export function normalizeStoredGameTitle(value: string) {
  const stripped = stripGameTitleLanguageSuffix(value);
  return /[\u3400-\u9fff]/u.test(stripped) ? normalizeChineseGameTitle(stripped) : stripped;
}

export function normalizeChineseSearchText(value: string) {
  return normalizeChineseGameTitle(value)
    .normalize("NFKC")
    .replace(/[™®©]/g, "")
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim()
    .toLowerCase();
}

export function applyMainlandTitleStyle(value: string) {
  return value
    .replace(/\bZELDA\b/gi, "塞尔达")
    .replaceAll("薩爾達", "塞尔达")
    .replaceAll("萨尔达", "塞尔达")
    .replaceAll("瑪利歐", "马力欧")
    .replaceAll("玛利欧", "马力欧")
    .replaceAll("马里奥", "马力欧")
    .replaceAll("瑪利奧", "马力欧")
    .replaceAll("玛利奥", "马力欧")
    .replaceAll("超級马力欧", "超级马力欧")
    .replaceAll("超級 马力欧", "超级 马力欧")
    .replaceAll("卡比之星", "星之卡比")
    .replaceAll("路易基", "路易吉");
}
