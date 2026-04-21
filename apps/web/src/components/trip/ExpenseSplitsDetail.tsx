import type { ExpenseSplit } from '@/types/expense';

interface Props {
  splits: ExpenseSplit[];
  /** participantId → 顯示名稱 */
  nameByParticipantId: Record<string, string>;
  /** 主檔幣別；owedAmount 一律以新台幣儲存與顯示 */
  expenseCurrency: string;
  className?: string;
}

/** 分攤明細列表（展開區內共用）；金額單位為 TWD */
export function ExpenseSplitsDetail({ splits, nameByParticipantId, expenseCurrency, className }: Props) {
  if (!splits.length) {
    return (
      <p className={`text-xs text-muted-foreground ${className ?? ''}`}>此筆花費尚無分攤明細。</p>
    );
  }

  return (
    <div className={className}>
      {expenseCurrency !== 'TWD' && (
        <p className="text-xs text-muted-foreground mb-2">分攤為新台幣（TWD），主檔為 {expenseCurrency}</p>
      )}
      <ul className="space-y-1.5">
      {splits.map((s) => (
        <li
          key={s.id}
          className="flex items-center justify-between gap-3 text-sm border-b border-border/40 last:border-0 pb-1.5 last:pb-0"
        >
          <span className="text-foreground truncate">
            {nameByParticipantId[s.participantId] ?? `成員 (${s.participantId.slice(0, 8)}…)`}
          </span>
          <span className="shrink-0 tabular-nums text-muted-foreground">
            {s.owedAmount.toLocaleString(undefined, {
              minimumFractionDigits: 0,
              maximumFractionDigits: 2,
            })}{' '}
            <span className="text-xs">TWD</span>
          </span>
        </li>
      ))}
      </ul>
    </div>
  );
}
