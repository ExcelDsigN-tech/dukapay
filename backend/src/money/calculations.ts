export function calculateInterest(principal: number, annualRate: number, days: number): number {
  if (principal <= 0 || annualRate < 0 || days < 0) {
    return 0;
  }
  const dailyRate = annualRate / 365;
  const interest = principal * dailyRate * days;
  return roundAmount(interest);
}

export function calculateFee(principal: number, feeRate: number): number {
  if (principal <= 0 || feeRate < 0) {
    return 0;
  }
  const fee = principal * feeRate;
  return roundAmount(fee);
}

export function roundAmount(amount: number): number {
  return Math.round(amount * 100) / 100;
}

export interface AmortizationPayment {
  period: number;
  amount: number;
  principal: number;
  interest: number;
  remainingBalance: number;
}

export function calculateAmortization(
  principal: number,
  annualRate: number,
  months: number,
): AmortizationPayment[] {
  const monthlyRate = annualRate / 12;
  const monthlyPayment =
    (principal * monthlyRate * Math.pow(1 + monthlyRate, months)) /
    (Math.pow(1 + monthlyRate, months) - 1);

  const schedule: AmortizationPayment[] = [];
  let remainingBalance = principal;

  for (let period = 1; period <= months; period++) {
    const interestPayment = remainingBalance * monthlyRate;
    const principalPayment = monthlyPayment - interestPayment;
    remainingBalance -= principalPayment;

    if (period === months) {
      remainingBalance = 0;
    }

    schedule.push({
      period,
      amount: roundAmount(monthlyPayment),
      principal: roundAmount(principalPayment),
      interest: roundAmount(interestPayment),
      remainingBalance: roundAmount(Math.max(0, remainingBalance)),
    });
  }

  return schedule;
}
