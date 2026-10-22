// In-memory stand-in for the Prisma client, covering only the queries core uses.
// It interprets where clauses, so tests check real filtering, not just call arguments.
// Supported: equality, contains (+ mode insensitive), lt/lte/gt/gte, in/notIn, AND/OR/NOT,
// to-one relation filters with `is`, select/include of relations, orderBy, take,
// and $transaction(fn) with rollback on error.
import type { PrismaClient } from "@/generated/prisma/client";

type Row = Record<string, unknown>;
type Where = Record<string, unknown>;

type ModelName = "merchant" | "product" | "quote" | "agentSession" | "order" | "webhookEvent" | "buyerLink";

// To-one relations: field name -> [model, foreign key].
const RELATIONS: Record<ModelName, Record<string, [ModelName, string]>> = {
  merchant: {},
  product: { merchant: ["merchant", "merchantId"] },
  quote: { merchant: ["merchant", "merchantId"], product: ["product", "productId"] },
  agentSession: {},
  order: { merchant: ["merchant", "merchantId"], quote: ["quote", "quoteId"], buyerLink: ["buyerLink", "buyerLinkId"] },
  buyerLink: { merchant: ["merchant", "merchantId"] },
  webhookEvent: { merchant: ["merchant", "merchantId"], order: ["order", "orderId"] },
};

const DEFAULTS: Record<ModelName, Row> = {
  merchant: {
    dodoWebhookSecretEncrypted: null,
    dodoEnvironment: "test_mode",
    liveModeEnabled: false,
    networkOptIn: false,
  },
  product: { description: null, imageUrl: null, isRecurring: false, agentSellable: false, active: true, providerData: null },
  quote: { agentSessionId: null, quantity: 1, state: null, zip: null, discountCodes: [], discountAmount: 0, recurringBreakup: null, taxRateBps: null, isConverted: false, isBinding: true, status: "open" },
  agentSession: { clientName: null, expiresAt: null },
  order: {
    buyerLinkId: null,
    agentSessionId: null,
    status: "pending_payment",
    chargedCurrency: null,
    chargedTaxAmount: null,
    chargedTotalAmount: null,
    providerCheckoutSessionId: null,
    providerPaymentId: null,
    checkoutUrl: null,
    fulfillment: null,
    paidAt: null,
  },
  webhookEvent: { orderId: null, processedAt: null },
  buyerLink: {
    agentSessionId: null,
    status: "pending_approval",
    approvedAt: null,
    revokedAt: null,
    perOrderCapAmount: null,
    productScope: [],
    providerCustomerId: null,
    providerPaymentMethodId: null,
  },
};

const UNIQUE: Record<ModelName, string[][]> = {
  merchant: [["slug"], ["email"]],
  product: [["merchantId", "providerProductId"]],
  quote: [],
  agentSession: [["tokenHash"]],
  order: [["idempotencyKey"], ["providerCheckoutSessionId"], ["providerPaymentId"]],
  webhookEvent: [["merchantId", "webhookId"]],
  buyerLink: [["approvalTokenHash"]],
};

function uniqueViolation(): Error {
  return Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
}

export class FakeDb {
  readonly tables: Record<ModelName, Row[]> = { merchant: [], product: [], quote: [], agentSession: [], order: [], webhookEvent: [], buyerLink: [] };
  #seq = 0;
  #clock: () => Date;

  constructor(clock: () => Date = () => new Date()) {
    this.#clock = clock;
  }

  readonly merchant = this.#model("merchant");
  readonly product = this.#model("product");
  readonly quote = this.#model("quote");
  readonly agentSession = this.#model("agentSession");
  readonly order = this.#model("order");
  readonly webhookEvent = this.#model("webhookEvent");
  readonly buyerLink = this.#model("buyerLink");

  /** Stand-in for `$queryRaw` (used for `SELECT ... FOR UPDATE` row locks, which the fake does not need). */
  async $queryRaw(): Promise<unknown[]> {
    return [];
  }

  /** Interactive transaction: runs fn against this fake and restores every table if it throws. */
  async $transaction<T>(fn: (tx: this) => Promise<T>): Promise<T> {
    const snapshot = structuredClone(this.tables);
    try {
      return await fn(this);
    } catch (err) {
      for (const name of Object.keys(snapshot) as ModelName[]) {
        this.tables[name].splice(0, this.tables[name].length, ...snapshot[name]);
      }
      throw err;
    }
  }

  asPrisma(): PrismaClient {
    return this as unknown as PrismaClient;
  }

  insert(model: ModelName, row: Row): Row {
    return this.#create(model, row);
  }

  #model(name: ModelName) {
    return {
      findUnique: async (args: { where: Where; select?: Row; include?: Row }) => {
        const row = this.#rows(name, this.#expandUnique(args.where))[0];
        return row ? this.#shape(name, row, args) : null;
      },
      findUniqueOrThrow: async (args: { where: Where; select?: Row; include?: Row }) => {
        const row = this.#rows(name, this.#expandUnique(args.where))[0];
        if (!row) throw Object.assign(new Error("Record not found"), { code: "P2025" });
        return this.#shape(name, row, args);
      },
      findFirst: async (args: { where?: Where; select?: Row; include?: Row }) => {
        const row = this.#rows(name, args.where)[0];
        return row ? this.#shape(name, row, args) : null;
      },
      findMany: async (
        args: { where?: Where; select?: Row; include?: Row; orderBy?: Row | Row[]; take?: number } = {},
      ) => {
        let rows = this.#rows(name, args.where);
        if (args.orderBy) rows = sortRows(rows, args.orderBy);
        if (args.take !== undefined) rows = rows.slice(0, args.take);
        return rows.map((r) => this.#shape(name, r, args));
      },
      create: async (args: { data: Row; select?: Row; include?: Row }) =>
        this.#shape(name, this.#create(name, args.data), args),
      update: async (args: { where: Where; data: Row; select?: Row; include?: Row }) => {
        const row = this.#rows(name, this.#expandUnique(args.where))[0];
        if (!row) throw Object.assign(new Error("Record not found"), { code: "P2025" });
        Object.assign(row, args.data, { updatedAt: this.#clock() });
        return this.#shape(name, row, args);
      },
      updateMany: async (args: { where?: Where; data: Row }) => {
        const rows = this.#rows(name, args.where);
        for (const r of rows) Object.assign(r, args.data, { updatedAt: this.#clock() });
        return { count: rows.length };
      },
      count: async (args: { where?: Where } = {}) => this.#rows(name, args.where).length,
      delete: async (args: { where: Where }) => {
        const row = this.#rows(name, this.#expandUnique(args.where))[0];
        if (!row) throw Object.assign(new Error("Record not found"), { code: "P2025" });
        this.tables[name].splice(this.tables[name].indexOf(row), 1);
        return structuredClone(row);
      },
      deleteMany: async (args: { where?: Where } = {}) => {
        const rows = this.#rows(name, args.where);
        for (const r of rows) this.tables[name].splice(this.tables[name].indexOf(r), 1);
        return { count: rows.length };
      },
      upsert: async (args: { where: Where; create: Row; update: Row; select?: Row }) => {
        const row = this.#rows(name, this.#expandUnique(args.where))[0];
        if (row) {
          Object.assign(row, args.update, { updatedAt: this.#clock() });
          return this.#shape(name, row, args);
        }
        return this.#shape(name, this.#create(name, args.create), args);
      },
    };
  }

  #create(name: ModelName, data: Row): Row {
    const now = this.#clock();
    const row: Row = {
      ...DEFAULTS[name],
      id: `${name}_${++this.#seq}`,
      createdAt: now,
      updatedAt: now,
      ...(name === "product" ? { syncedAt: now } : {}),
      ...stripUndefined(data),
    };
    for (const keys of UNIQUE[name]) {
      // Like Postgres, NULLs never collide in a unique index.
      if (keys.some((k) => row[k] === null || row[k] === undefined)) continue;
      if (this.tables[name].some((r) => keys.every((k) => r[k] === row[k]))) throw uniqueViolation();
    }
    this.tables[name].push(row);
    return row;
  }

  // { merchantId_providerProductId: { a, b } } -> { a, b }
  #expandUnique(where: Where): Where {
    const out: Where = {};
    for (const [k, v] of Object.entries(where)) {
      if (k.includes("_") && v && typeof v === "object" && !Array.isArray(v)) Object.assign(out, v);
      else out[k] = v;
    }
    return out;
  }

  #rows(name: ModelName, where?: Where): Row[] {
    return this.tables[name].filter((r) => this.#matches(name, r, where));
  }

  #matches(name: ModelName, row: Row, where?: Where): boolean {
    if (!where) return true;
    return Object.entries(where).every(([key, cond]) => {
      if (cond === undefined) return true;
      if (key === "AND") return (cond as Where[]).every((w) => this.#matches(name, row, w));
      if (key === "OR") return (cond as Where[]).some((w) => this.#matches(name, row, w));
      if (key === "NOT") {
        const list = Array.isArray(cond) ? (cond as Where[]) : [cond as Where];
        return list.every((w) => !this.#matches(name, row, w));
      }
      const rel = RELATIONS[name][key];
      if (rel) {
        const [model, fk] = rel;
        const target = this.tables[model].find((r) => r.id === row[fk]);
        const inner = (cond as { is?: Where }).is ?? (cond as Where);
        return target !== undefined && this.#matches(model, target, inner);
      }
      return matchValue(row[key], cond);
    });
  }

  #shape(name: ModelName, row: Row, args: { select?: Row; include?: Row }): Row {
    const relationValue = (field: string, nested: unknown) => {
      const [model, fk] = RELATIONS[name][field]!;
      const target = this.tables[model].find((r) => r.id === row[fk]);
      if (!target) return null;
      const opts = typeof nested === "object" && nested !== null ? (nested as Row) : {};
      return this.#shape(model, target, opts);
    };
    if (args.select) {
      const out: Row = {};
      for (const [field, spec] of Object.entries(args.select)) {
        if (!spec) continue;
        out[field] = RELATIONS[name][field] ? relationValue(field, spec) : row[field];
      }
      return structuredClone(out);
    }
    const out: Row = structuredClone(row);
    for (const [field, spec] of Object.entries(args.include ?? {})) {
      if (spec) out[field] = relationValue(field, spec);
    }
    return out;
  }
}

function stripUndefined(data: Row): Row {
  return Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
}

function isOperatorObject(v: unknown): v is Row {
  return typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof Date);
}

function matchValue(value: unknown, cond: unknown): boolean {
  if (!isOperatorObject(cond)) return value === cond || (value instanceof Date && cond instanceof Date && +value === +cond);
  const insensitive = cond.mode === "insensitive";
  const norm = (s: unknown) => (insensitive && typeof s === "string" ? s.toLowerCase() : s);
  return Object.entries(cond).every(([op, arg]) => {
    switch (op) {
      case "mode":
        return true;
      case "equals":
        return norm(value) === norm(arg);
      case "contains":
        return typeof value === "string" && (norm(value) as string).includes(norm(arg) as string);
      case "in":
        return (arg as unknown[]).includes(value);
      case "notIn":
        return !(arg as unknown[]).includes(value);
      case "lt":
        return (value as number) < (arg as number);
      case "lte":
        return (value as number) <= (arg as number);
      case "gt":
        return (value as number) > (arg as number);
      case "gte":
        return (value as number) >= (arg as number);
      case "not":
        return !matchValue(value, arg);
      default:
        throw new Error(`FakeDb: unsupported operator "${op}"`);
    }
  });
}

function sortRows(rows: Row[], orderBy: Row | Row[]): Row[] {
  const keys = (Array.isArray(orderBy) ? orderBy : [orderBy]).flatMap((o) => Object.entries(o));
  return [...rows].sort((a, b) => {
    for (const [field, dir] of keys) {
      const av = a[field] as never;
      const bv = b[field] as never;
      if (av === bv) continue;
      const cmp = av < bv ? -1 : 1;
      return dir === "desc" ? -cmp : cmp;
    }
    return 0;
  });
}
