import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { ProviderNotConfiguredError, ProviderUnreachableError, ValidationError } from '@leadmoor/core';

/**
 * LLMClient port — ARCHITECTURE.md section 10.
 *
 * The model is used for exactly three things (section 2.1): compiling a request into a LeadSpec,
 * proposing queries, and judging supplied evidence. Every call returns *structured* output that is
 * parsed against a Zod schema; free-form prose is never trusted and never becomes a fact.
 *
 * Cost is metered per call so the budget governor can stop a run cleanly.
 */

export type ModelTier = 'compile' | 'judge' | 'normalize';

export interface StructuredRequest<T extends z.ZodTypeAny> {
  tier: ModelTier;
  /** Stable prefix — the rubric and instructions. Cached across leads in a run. */
  systemPrefix: string;
  /** Per-call content. Kept small so the cached prefix does the heavy lifting. */
  user: string;
  schema: T;
  toolName: string;
  toolDescription: string;
  maxTokens?: number;
}

export interface LLMUsage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
}

export interface LLMClient {
  readonly id: string;
  isConfigured(): boolean;
  /** Human-readable reason when not configured. Null when it is. */
  unavailableReason(): string | null;
  structured<T extends z.ZodTypeAny>(request: StructuredRequest<T>): Promise<z.infer<T>>;
  usage(): LLMUsage;
}

const MODELS: Record<ModelTier, string> = {
  // Deep dossiers at low volume, per the M0 scope decision: Opus for compilation and judging.
  compile: 'claude-opus-4-5',
  judge: 'claude-opus-4-5',
  normalize: 'claude-haiku-4-5-20251001',
};

export class AnthropicLLMClient implements LLMClient {
  readonly id = 'anthropic';
  private readonly counters: LLMUsage = { calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
  private client: Anthropic | null = null;

  constructor(
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly onCall?: () => void,
  ) {}

  isConfigured(): boolean {
    return Boolean(this.env.ANTHROPIC_API_KEY);
  }

  unavailableReason(): string | null {
    return this.isConfigured()
      ? null
      : 'ANTHROPIC_API_KEY is not set. Request compilation and evidence judging are unavailable; ' +
          'deterministic criteria still run and unjudged criteria are reported as unknown.';
  }

  private sdk(): Anthropic {
    const apiKey = this.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new ProviderNotConfiguredError('anthropic', 'ANTHROPIC_API_KEY');
    if (!this.client) this.client = new Anthropic({ apiKey });
    return this.client;
  }

  async structured<T extends z.ZodTypeAny>(request: StructuredRequest<T>): Promise<z.infer<T>> {
    const sdk = this.sdk();
    this.onCall?.();

    let response;
    try {
      response = await sdk.messages.create({
        model: MODELS[request.tier],
        max_tokens: request.maxTokens ?? 4096,
        // The stable prefix is cached; per-lead content is not. This is the cost lever from
        // ARCHITECTURE.md section 5 — the rubric is identical across every lead in a run.
        system: [{ type: 'text', text: request.systemPrefix, cache_control: { type: 'ephemeral' } }],
        tools: [
          {
            name: request.toolName,
            description: request.toolDescription,
            input_schema: toJsonSchema(request.schema) as Anthropic.Tool.InputSchema,
          },
        ],
        tool_choice: { type: 'tool', name: request.toolName },
        messages: [{ role: 'user', content: request.user }],
      });
    } catch (error) {
      const err = error as Error;
      throw new ProviderUnreachableError('anthropic', 'api.anthropic.com', { message: err.message });
    }

    this.counters.calls += 1;
    this.counters.inputTokens += response.usage.input_tokens ?? 0;
    this.counters.outputTokens += response.usage.output_tokens ?? 0;
    this.counters.cacheReadTokens += response.usage.cache_read_input_tokens ?? 0;

    const block = response.content.find((c) => c.type === 'tool_use');
    if (!block || block.type !== 'tool_use') {
      throw new ValidationError('model did not return structured output', { stopReason: response.stop_reason });
    }

    const parsed = request.schema.safeParse(block.input);
    if (!parsed.success) {
      // Malformed model output is rejected, never coerced into something usable.
      throw new ValidationError('model output failed schema validation', {
        issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      });
    }
    return parsed.data;
  }

  usage(): LLMUsage {
    return { ...this.counters };
  }
}

/**
 * Used when no key is present. Every call throws ProviderNotConfiguredError, which callers turn
 * into an explicit "provider not configured" state — never into a silent success or an empty result.
 */
export class NotConfiguredLLMClient implements LLMClient {
  readonly id = 'not_configured';

  isConfigured(): boolean {
    return false;
  }

  unavailableReason(): string {
    return 'No language model is configured. Set ANTHROPIC_API_KEY to enable request compilation and evidence judging.';
  }

  async structured(): Promise<never> {
    throw new ProviderNotConfiguredError('anthropic', 'ANTHROPIC_API_KEY');
  }

  usage(): LLMUsage {
    return { calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
  }
}

export function createLLMClient(env: NodeJS.ProcessEnv = process.env, onCall?: () => void): LLMClient {
  return env.ANTHROPIC_API_KEY ? new AnthropicLLMClient(env, onCall) : new NotConfiguredLLMClient();
}

/**
 * Minimal Zod to JSON Schema conversion covering the shapes this codebase actually sends.
 * Deliberately small: an unsupported node throws rather than silently producing a loose schema
 * that would let malformed model output through.
 */
export function toJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const def = schema._def as { typeName?: string; [k: string]: unknown };

  switch (def.typeName) {
    case 'ZodObject': {
      const shape = (schema as z.ZodObject<z.ZodRawShape>).shape;
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const [key, value] of Object.entries(shape)) {
        properties[key] = toJsonSchema(value as z.ZodTypeAny);
        if (!isOptional(value as z.ZodTypeAny)) required.push(key);
      }
      return { type: 'object', properties, required, additionalProperties: false };
    }
    case 'ZodArray':
      return { type: 'array', items: toJsonSchema((def as { type: z.ZodTypeAny }).type) };
    case 'ZodString': {
      const out: Record<string, unknown> = { type: 'string' };
      if (schema.description) out.description = schema.description;
      return out;
    }
    case 'ZodNumber':
      return { type: 'number' };
    case 'ZodBoolean':
      return { type: 'boolean' };
    case 'ZodEnum':
      return { type: 'string', enum: (def as { values: string[] }).values };
    case 'ZodLiteral':
      return { const: (def as { value: unknown }).value };
    case 'ZodNativeEnum':
      return { type: 'string', enum: Object.values((def as { values: Record<string, string> }).values) };
    case 'ZodOptional':
    case 'ZodNullable':
    case 'ZodDefault':
      return toJsonSchema((def as { innerType: z.ZodTypeAny }).innerType);
    case 'ZodUnion':
      return { anyOf: (def as { options: z.ZodTypeAny[] }).options.map(toJsonSchema) };
    case 'ZodDiscriminatedUnion':
      return { anyOf: [...(def as { options: z.ZodTypeAny[] }).options].map(toJsonSchema) };
    case 'ZodRecord':
      return { type: 'object', additionalProperties: true };
    case 'ZodAny':
      return {};
    default:
      throw new Error(`toJsonSchema: unsupported Zod type "${String(def.typeName)}"`);
  }
}

function isOptional(schema: z.ZodTypeAny): boolean {
  const name = (schema._def as { typeName?: string }).typeName;
  return name === 'ZodOptional' || name === 'ZodDefault';
}
