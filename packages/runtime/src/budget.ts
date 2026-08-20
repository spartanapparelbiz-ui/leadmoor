import { BudgetExceededError, type Budget, type BudgetUsage } from '@leadmoor/core';

/**
 * Budget governor — ARCHITECTURE.md section 14.
 *
 * Every expensive operation asks permission first. When a ceiling is reached the run stops
 * *cleanly*: work already completed is kept and the run is marked `budget_exhausted`, rather than
 * failing or, worse, continuing to spend. There is no code path that can loop without consuming a
 * counter here.
 */
export class BudgetGovernor {
  private readonly counters: BudgetUsage;

  constructor(
    private readonly budget: Budget,
    startedAtMs: number = Date.now(),
    private readonly now: () => number = Date.now,
  ) {
    this.counters = { companies: 0, documents: 0, modelCalls: 0, fetches: 0, startedAtMs };
  }

  usage(): BudgetUsage {
    return { ...this.counters };
  }

  /** Remaining headroom, for display. */
  remaining(): Record<string, number> {
    return {
      companies: Math.max(0, this.budget.maxCompanies - this.counters.companies),
      documents: Math.max(0, this.budget.maxDocuments - this.counters.documents),
      modelCalls: Math.max(0, this.budget.maxModelCalls - this.counters.modelCalls),
      runtimeMs: Math.max(0, this.budget.maxRuntimeMs - this.elapsed()),
    };
  }

  elapsed(): number {
    return this.now() - this.counters.startedAtMs;
  }

  /** True when any ceiling has been reached. Checked between pipeline stages and inside loops. */
  isExhausted(): boolean {
    return this.exhaustedLimit() !== null;
  }

  exhaustedLimit(): string | null {
    if (this.counters.companies >= this.budget.maxCompanies) return 'maxCompanies';
    if (this.counters.documents >= this.budget.maxDocuments) return 'maxDocuments';
    if (this.counters.modelCalls >= this.budget.maxModelCalls) return 'maxModelCalls';
    if (this.elapsed() >= this.budget.maxRuntimeMs) return 'maxRuntimeMs';
    return null;
  }

  /** Consume one unit. Returns false at the ceiling so callers can stop without an exception. */
  tryConsume(kind: 'companies' | 'documents' | 'modelCalls' | 'fetches', amount = 1): boolean {
    if (this.elapsed() >= this.budget.maxRuntimeMs) return false;

    switch (kind) {
      case 'companies':
        if (this.counters.companies + amount > this.budget.maxCompanies) return false;
        this.counters.companies += amount;
        return true;
      case 'documents':
        if (this.counters.documents + amount > this.budget.maxDocuments) return false;
        this.counters.documents += amount;
        this.counters.fetches += amount;
        return true;
      case 'modelCalls':
        if (this.counters.modelCalls + amount > this.budget.maxModelCalls) return false;
        this.counters.modelCalls += amount;
        return true;
      case 'fetches':
        this.counters.fetches += amount;
        return true;
    }
  }

  /** Throwing variant for call sites that cannot meaningfully continue. */
  consumeOrThrow(kind: 'companies' | 'documents' | 'modelCalls', amount = 1): void {
    if (!this.tryConsume(kind, amount)) {
      const limitName = this.exhaustedLimit() ?? kind;
      const used =
        limitName === 'maxRuntimeMs'
          ? this.elapsed()
          : this.counters[kind as 'companies' | 'documents' | 'modelCalls'];
      const max =
        limitName === 'maxRuntimeMs'
          ? this.budget.maxRuntimeMs
          : this.budget[
              limitName as 'maxCompanies' | 'maxDocuments' | 'maxModelCalls'
            ];
      throw new BudgetExceededError(limitName, used, max);
    }
  }

  /** Per-company document allowance, independent of the global document ceiling. */
  documentsPerCompany(): number {
    return this.budget.maxFetchesPerCompany;
  }

  peoplePerCompany(): number {
    return this.budget.maxPeoplePerCompany;
  }

  /** Restores counters when a run resumes after a crash. */
  restore(usage: Partial<BudgetUsage>): void {
    if (typeof usage.companies === 'number') this.counters.companies = usage.companies;
    if (typeof usage.documents === 'number') this.counters.documents = usage.documents;
    if (typeof usage.modelCalls === 'number') this.counters.modelCalls = usage.modelCalls;
    if (typeof usage.fetches === 'number') this.counters.fetches = usage.fetches;
    if (typeof usage.startedAtMs === 'number') this.counters.startedAtMs = usage.startedAtMs;
  }
}
