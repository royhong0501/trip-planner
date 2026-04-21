import type { ExpenseWithSplits, TripParticipant } from '@/types/expense';

export interface SettlementTransaction {
  debtorId: string;
  creditorId: string;
  /** 新台幣，小數點後最多兩位 */
  amount: number;
  debtorName: string;
  creditorName: string;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function participantName(participants: TripParticipant[], id: string): string {
  const p = participants.find((x) => x.id === id);
  if (p?.displayName) return p.displayName;
  return `成員 (${id.slice(0, 8)}…)`;
}

/** 付款金額換算為新台幣（與分攤 owedAmount 幣別一致） */
function expensePaidTwd(e: ExpenseWithSplits): number {
  const rate = e.exchangeRate > 0 ? e.exchangeRate : 1;
  return round2(e.amountTotal * rate);
}

/**
 * 債務簡化：付款人依每筆花費實付（TWD 等值）增加餘額，各分攤人依 owedAmount（TWD）減少餘額，
 * 再以貪婪配對產生最少筆轉帳指示。
 */
export function calculateSettlements(
  participants: TripParticipant[],
  expenses: ExpenseWithSplits[],
): SettlementTransaction[] {
  const balanceCents = new Map<string, number>();

  const addCents = (id: string, deltaCents: number) => {
    balanceCents.set(id, (balanceCents.get(id) ?? 0) + deltaCents);
  };

  for (const e of expenses) {
    const paid = expensePaidTwd(e);
    const paidCents = Math.round(paid * 100);
    addCents(e.payerId, paidCents);

    for (const s of e.splits) {
      const owedCents = Math.round(round2(s.owedAmount) * 100);
      addCents(s.participantId, -owedCents);
    }
  }

  type Side = { id: string; cents: number };
  const debtors: Side[] = [];
  const creditors: Side[] = [];

  for (const [id, cents] of balanceCents) {
    if (cents < 0) debtors.push({ id, cents });
    else if (cents > 0) creditors.push({ id, cents });
  }

  debtors.sort((a, b) => a.cents - b.cents);
  creditors.sort((a, b) => b.cents - a.cents);

  const transactions: SettlementTransaction[] = [];
  let i = 0;
  let j = 0;

  while (i < debtors.length && j < creditors.length) {
    const d = debtors[i];
    const c = creditors[j];
    const payCents = Math.min(-d.cents, c.cents);
    if (payCents <= 0) break;

    const amount = round2(payCents / 100);
    transactions.push({
      debtorId: d.id,
      creditorId: c.id,
      amount,
      debtorName: participantName(participants, d.id),
      creditorName: participantName(participants, c.id),
    });

    d.cents += payCents;
    c.cents -= payCents;

    if (d.cents >= 0) i += 1;
    if (c.cents <= 0) j += 1;
  }

  return transactions;
}
