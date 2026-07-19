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
