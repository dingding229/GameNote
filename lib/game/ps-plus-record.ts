type PsPlusRecordLike = {
  platform: string;
  sourceKey?: string;
  notes: string;
};

export function isPsPlusMonthlyRecord(record: PsPlusRecordLike) {
  return (
    record.platform === "PlayStation" &&
    (record.sourceKey?.startsWith("ps-plus:") ||
      /(?:^|\n)PS Plus 会免 \d{4}-\d{2}(?:\n|$)/.test(record.notes))
  );
}

export function isFrozenPsPlusRecord(record: PsPlusRecordLike, psPlusEnabled: boolean) {
  return !psPlusEnabled && isPsPlusMonthlyRecord(record);
}
