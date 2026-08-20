/** Base for every deliberate refusal in the system. These are not bugs — they are the design working. */
export class LeadMoorError extends Error {
  constructor(message: string, readonly code: string, readonly detail?: unknown) {
    super(message);
    this.name = new.target.name;
  }
}

/** A source tier or access mode outside the permitted set was requested. Never recoverable. */
export class PolicyViolationError extends LeadMoorError {
  constructor(message: string, detail?: unknown) {
    super(message, 'policy_violation', detail);
  }
}

/** A claim, verdict, or citation failed deterministic validation against stored evidence. */
export class ValidationError extends LeadMoorError {
  constructor(message: string, detail?: unknown) {
    super(message, 'validation_failed', detail);
  }
}

/** A run exceeded one of its configured ceilings. The run stops cleanly; work already done is kept. */
export class BudgetExceededError extends LeadMoorError {
  constructor(readonly limit: string, readonly used: number, readonly max: number) {
    super(`Budget exceeded: ${limit} (${used}/${max})`, 'budget_exceeded', { limit, used, max });
  }
}

/** A required provider credential is absent. Reported honestly; never silently substituted. */
export class ProviderNotConfiguredError extends LeadMoorError {
  constructor(readonly provider: string, readonly envVar: string) {
    super(`Provider "${provider}" is not configured (set ${envVar})`, 'provider_not_configured', { provider, envVar });
  }
}

/** The network refused or could not reach a permitted host. Distinct from "not configured". */
export class ProviderUnreachableError extends LeadMoorError {
  constructor(readonly provider: string, readonly host: string, detail?: unknown) {
    super(`Provider "${provider}" unreachable: ${host}`, 'provider_unreachable', detail);
  }
}
