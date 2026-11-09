import { computeBreakdown, formatMoney, formatPercent, parsePrice, type Bill, type Breakdown } from './bill'
import { computeSettlement, formatTransfer } from './settle'

export function buildSummary(bill: Bill, b: Breakdown = computeBreakdown(bill)): string {
  const m = (c: number) => formatMoney(c, bill.currency)
  const name = (id: string) => bill.people.find((p) => p.id === id)?.name
  const lines: string[] = ['Bill summary', '']
  if (bill.items.length) {
    lines.push('Items:')
    for (const it of bill.items) {
      lines.push(`- ${it.name}: ${m(it.priceCents)} (${it.sharedBy.map(name).filter(Boolean).join(', ')})`)
    }
    lines.push('')
  }
  lines.push(`Subtotal: ${m(b.subtotal)}`)
  lines.push(`Tax (${formatPercent(b.taxPctScaled)}): ${m(b.tax)}`)
  lines.push(`Tip (${formatPercent(b.tipPctScaled)}): ${m(b.tip)}`)
  lines.push(`Total: ${m(b.total)}`)
  lines.push('')
  lines.push('Per person:')
  for (const s of b.shares) {
    lines.push(`- ${s.name}: ${m(s.total)} (items ${m(s.subtotal)}, tax ${m(s.tax)}, tip ${m(s.tip)})`)
  }

  const settlement = computeSettlement(bill, b)
  if (settlement.status !== 'no-payers') {
    lines.push('')
    lines.push('Paid by:')
    for (const p of bill.payments) {
      const r = parsePrice(p.amount)
      lines.push(`- ${name(p.personId) ?? '?'}: ${r.ok ? m(r.value) : `"${p.amount}" (invalid)`}`)
    }
    lines.push('')
    lines.push('Settle up:')
    if (settlement.status === 'invalid') {
      lines.push(`- Not available: ${settlement.check.sumError ?? 'some payment amounts are invalid.'}`)
    } else if (settlement.transfers.length === 0) {
      lines.push('- Everyone is even. No transfers needed.')
    } else {
      for (const t of settlement.transfers) lines.push(`- ${formatTransfer(t, bill)}`)
    }
  }
  return lines.join('\n')
}
