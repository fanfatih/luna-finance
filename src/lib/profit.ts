/**
 * Profit harian dihitung dari selisih saldo semua channel, lalu dikoreksi
 * untuk uang yang bukan hasil usaha:
 *
 *   Profit = ΔS − M + P_baru − P_lunas − U_baru + U_bayar
 *
 *   ΔS      saldo total akhir hari dikurangi saldo total awal hari
 *   M       modal bersih yang disetor (negatif bila ditarik)
 *   P_baru  piutang baru (uang keluar yang akan kembali)
 *   P_lunas piutang yang dibayar kembali hari itu
 *   U_baru  utang baru (uang masuk yang harus dikembalikan)
 *   U_bayar utang yang dibayar hari itu
 *
 * Pindah saldo antar channel tidak mengubah total, jadi tidak memengaruhi profit.
 * Profit tidak disimpan, selalu dihitung ulang saat ditampilkan.
 */
export interface ProfitInput {
  openingTotal: number
  closingTotal: number
  capitalNet: number
  piutangBaru: number
  piutangLunas: number
  utangBaru: number
  utangBayar: number
}

export function computeProfit(i: ProfitInput): number {
  const delta = i.closingTotal - i.openingTotal
  return delta - i.capitalNet + i.piutangBaru - i.piutangLunas - i.utangBaru + i.utangBayar
}

/** Peringatan lembut bila profit negatif atau jauh di bawah rata-rata 7 hari. */
export function profitWarning(profit: number, avg7: number | null): string | null {
  if (profit < 0) {
    return 'Profit hari ini negatif. Ada uang keluar yang belum dicatat sebagai piutang?'
  }
  if (avg7 !== null && avg7 > 0 && profit < avg7 * 0.4) {
    return 'Profit hari ini jauh di bawah rata-rata 7 hari terakhir. Ada uang keluar yang belum dicatat sebagai piutang?'
  }
  return null
}
