import { z } from "zod";

// Capital One's Nessie sandbox, the way this app uses it. Three clients behind one interface:
//
//   NessieHttp        the real sandbox (https://api.nessieisreal.com), key from NESSIE_KEY sent as ?key=. The key is
//                     never logged, echoed, or put in an error message. Its writes land, but the sandbox never moves
//                     an account's `balance` field (checked live with a real key), so it is not used for balances.
//   NessieWithLedger  what the app runs with a key: the transactions are real Nessie records (withdrawals and
//                     deposits with their ids), and the balance is ours, kept in the room's ledger and moved by the
//                     same writes. The wallet chip and the payment cards read this balance, never the sandbox's.
//   LocalLedger       the same calls against balances kept in the room (see lib/agent/wallets.ts), so everything
//                     runs locally and on production before a key exists. Same shapes, whole dollars, same ids.
//
// Everything we write to the real sandbox is readable by every team: fictional names and addresses only. Dollars
// are whole numbers. The API does not validate for us, so callers act only on account ids this app created, and
// read the balance back after writing instead of computing it.

export const NESSIE_BASE_URL = "https://api.nessieisreal.com";

// The { data, error } result every call returns; nothing here throws.
export type NessieResult<T> = { data: T; error: null } | { data: null; error: string };

export type NessieAccount = { id: string; balance: number; nickname: string };

export type NessieCustomerInput = {
  first_name: string;
  last_name: string;
  address: { street_number: string; street_name: string; city: string; state: string; zip: string };
};

export interface NessieClient {
  // Which ledger this client talks to.
  readonly source: "nessie" | "local";
  createCustomer(input: NessieCustomerInput): Promise<NessieResult<{ id: string }>>;
  createAccount(customerId: string, input: { nickname: string; balance: number }): Promise<NessieResult<NessieAccount>>;
  withdraw(accountId: string, input: { amount: number; description: string }): Promise<NessieResult<{ id: string }>>;
  deposit(accountId: string, input: { amount: number; description: string }): Promise<NessieResult<{ id: string }>>;
  getAccount(accountId: string): Promise<NessieResult<NessieAccount>>;
}

const WholeDollars = z.number().int().min(1).max(10_000);

export function ok<T>(data: T): NessieResult<T> {
  return { data, error: null };
}

export function fail<T = never>(error: string): NessieResult<T> {
  return { data: null, error };
}

export function checkAmount(amount: number): string | null {
  return WholeDollars.safeParse(amount).success ? null : "amount must be a whole number of dollars";
}

// ---------------------------------------------------------------------------
// The real sandbox
// ---------------------------------------------------------------------------

// What a transaction is recorded as. The sandbox stores it either way and does not move the account balance.
export const TRANSACTION_STATUS = "completed";

export type NessieTransaction = { id: string; amount: number; status: string; description: string };

const Created = z.object({ objectCreated: z.object({ _id: z.string().min(1) }) });
const TransactionBody = z.object({ _id: z.string().min(1), amount: z.number(), status: z.string().optional(), description: z.string().optional() });
const AccountBody = z.object({ _id: z.string().min(1), balance: z.number(), nickname: z.string().optional() });
const ErrorBody = z.object({ message: z.string().optional(), error: z.string().optional() }).passthrough();

export type NessieHttpOptions = { key: string; baseUrl?: string; timeoutMs?: number };

export class NessieHttp implements NessieClient {
  readonly source = "nessie" as const;
  private readonly key: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options: NessieHttpOptions) {
    this.key = options.key;
    this.baseUrl = (options.baseUrl ?? process.env.NESSIE_BASE_URL ?? NESSIE_BASE_URL).replace(/\/$/, "");
    this.timeoutMs = options.timeoutMs ?? 8000;
  }

  // One request. The key rides in the query string as Nessie requires, and never leaves this method.
  private async request(method: "GET" | "POST", path: string, body?: unknown): Promise<NessieResult<unknown>> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}?key=${encodeURIComponent(this.key)}`, {
        method,
        headers: body === undefined ? { accept: "application/json" } : { accept: "application/json", "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      return fail(error instanceof Error && error.name === "TimeoutError" ? "the sandbox did not answer in time" : "the sandbox could not be reached");
    }
    const text = await response.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!response.ok) {
      const parsed = ErrorBody.safeParse(json);
      const detail = parsed.success ? (parsed.data.message ?? parsed.data.error) : undefined;
      return fail(`sandbox error ${response.status}${detail ? `: ${detail.slice(0, 120)}` : ""}`);
    }
    return ok(json);
  }

  private async create(path: string, body: unknown): Promise<NessieResult<{ id: string }>> {
    const result = await this.request("POST", path, body);
    if (result.error !== null) return fail(result.error);
    const parsed = Created.safeParse(result.data);
    return parsed.success ? ok({ id: parsed.data.objectCreated._id }) : fail("the sandbox answered in a shape we do not know");
  }

  createCustomer(input: NessieCustomerInput): Promise<NessieResult<{ id: string }>> {
    return this.create("/customers", input);
  }

  // The account record only. Its `balance` is whatever it was created with and never moves.
  createAccountRecord(customerId: string, input: { nickname: string; balance: number }): Promise<NessieResult<{ id: string }>> {
    return this.create(`/customers/${encodeURIComponent(customerId)}/accounts`, { type: "Checking", nickname: input.nickname, rewards: 0, balance: input.balance });
  }

  async createAccount(customerId: string, input: { nickname: string; balance: number }): Promise<NessieResult<NessieAccount>> {
    const created = await this.createAccountRecord(customerId, input);
    if (created.error !== null) return fail(created.error);
    // Read it back: the balance on the account is what the sandbox says it is.
    return this.getAccount(created.data.id);
  }

  // `status` is what the transaction is recorded as; "completed" unless a check is probing another value.
  withdraw(accountId: string, input: { amount: number; description: string; status?: string }): Promise<NessieResult<{ id: string }>> {
    const invalid = checkAmount(input.amount);
    if (invalid) return Promise.resolve(fail(invalid));
    return this.create(`/accounts/${encodeURIComponent(accountId)}/withdrawals`, { medium: "balance", transaction_date: today(), status: input.status ?? TRANSACTION_STATUS, amount: input.amount, description: input.description.slice(0, 120) });
  }

  deposit(accountId: string, input: { amount: number; description: string; status?: string }): Promise<NessieResult<{ id: string }>> {
    const invalid = checkAmount(input.amount);
    if (invalid) return Promise.resolve(fail(invalid));
    return this.create(`/accounts/${encodeURIComponent(accountId)}/deposits`, { medium: "balance", transaction_date: today(), status: input.status ?? TRANSACTION_STATUS, amount: input.amount, description: input.description.slice(0, 120) });
  }

  // The transaction records, read back by id: what the sandbox actually stored.
  getWithdrawal(id: string): Promise<NessieResult<NessieTransaction>> {
    return this.readTransaction(`/withdrawals/${encodeURIComponent(id)}`);
  }

  getDeposit(id: string): Promise<NessieResult<NessieTransaction>> {
    return this.readTransaction(`/deposits/${encodeURIComponent(id)}`);
  }

  private async readTransaction(path: string): Promise<NessieResult<NessieTransaction>> {
    const result = await this.request("GET", path);
    if (result.error !== null) return fail(result.error);
    const parsed = TransactionBody.safeParse(result.data);
    return parsed.success ? ok({ id: parsed.data._id, amount: parsed.data.amount, status: parsed.data.status ?? "", description: parsed.data.description ?? "" }) : fail("the sandbox answered in a shape we do not know");
  }

  async getAccount(accountId: string): Promise<NessieResult<NessieAccount>> {
    const result = await this.request("GET", `/accounts/${encodeURIComponent(accountId)}`);
    if (result.error !== null) return fail(result.error);
    const parsed = AccountBody.safeParse(result.data);
    if (!parsed.success) return fail("the sandbox answered in a shape we do not know");
    return ok({ id: parsed.data._id, balance: Math.round(parsed.data.balance), nickname: parsed.data.nickname ?? "" });
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// The local ledger
// ---------------------------------------------------------------------------

// Where the local ledger keeps its balances. lib/agent/wallets.ts backs it with the room, so every instance of
// the app sees the same numbers; tests back it with a plain object.
export type LedgerStorage = {
  read(): Promise<Record<string, number>>;
  write(next: Record<string, number>): Promise<void>;
  // Serializes read-modify-write so two writes at once cannot lose one.
  exclusive<T>(work: () => Promise<T>): Promise<T>;
};

let counter = 0;
function localId(prefix: string): string {
  counter += 1;
  return `${prefix}_local_${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

export class LocalLedger implements NessieClient {
  readonly source = "local" as const;
  private readonly nicknames = new Map<string, string>();
  private readonly storage: LedgerStorage;

  constructor(storage: LedgerStorage) {
    this.storage = storage;
  }

  async createCustomer(input: NessieCustomerInput): Promise<NessieResult<{ id: string }>> {
    if (!input.first_name || !input.last_name) return fail("a customer needs a first and last name");
    return ok({ id: localId("cust") });
  }

  createAccount(_customerId: string, input: { nickname: string; balance: number }): Promise<NessieResult<NessieAccount>> {
    if (!Number.isInteger(input.balance) || input.balance < 0) return Promise.resolve(fail("balance must be a whole number of dollars"));
    return this.storage.exclusive(async () => {
      const ledger = await this.storage.read();
      const id = localId("acct");
      this.nicknames.set(id, input.nickname);
      await this.storage.write({ ...ledger, [id]: input.balance });
      return ok({ id, balance: input.balance, nickname: input.nickname });
    });
  }

  private move(accountId: string, amount: number, direction: "in" | "out", prefix: string): Promise<NessieResult<{ id: string }>> {
    const invalid = checkAmount(amount);
    if (invalid) return Promise.resolve(fail(invalid));
    return this.storage.exclusive(async () => {
      const ledger = await this.storage.read();
      const balance = ledger[accountId];
      if (balance === undefined) return fail("no such account");
      if (direction === "out" && balance < amount) return fail("insufficient funds");
      await this.storage.write({ ...ledger, [accountId]: direction === "out" ? balance - amount : balance + amount });
      return ok({ id: localId(prefix) });
    });
  }

  withdraw(accountId: string, input: { amount: number; description: string }): Promise<NessieResult<{ id: string }>> {
    return this.move(accountId, input.amount, "out", "wd");
  }

  deposit(accountId: string, input: { amount: number; description: string }): Promise<NessieResult<{ id: string }>> {
    return this.move(accountId, input.amount, "in", "dp");
  }

  async getAccount(accountId: string): Promise<NessieResult<NessieAccount>> {
    const balance = (await this.storage.read())[accountId];
    return balance === undefined ? fail("no such account") : ok({ id: accountId, balance, nickname: this.nicknames.get(accountId) ?? "" });
  }
}

// The client the app runs with a key: real Nessie transactions, balances kept in our own ledger (the sandbox never
// moves its balance field). A write goes to the sandbox first; the ledger moves only when the sandbox took it, so a
// refused write leaves the balance alone. The balance check is ours too, so an overdraft never reaches the sandbox.
export class NessieWithLedger implements NessieClient {
  readonly source = "nessie" as const;
  private readonly http: NessieHttp;
  private readonly storage: LedgerStorage;
  private readonly nicknames = new Map<string, string>();

  constructor(http: NessieHttp, storage: LedgerStorage) {
    this.http = http;
    this.storage = storage;
  }

  createCustomer(input: NessieCustomerInput): Promise<NessieResult<{ id: string }>> {
    return this.http.createCustomer(input);
  }

  async createAccount(customerId: string, input: { nickname: string; balance: number }): Promise<NessieResult<NessieAccount>> {
    if (!Number.isInteger(input.balance) || input.balance < 0) return fail("balance must be a whole number of dollars");
    const created = await this.http.createAccountRecord(customerId, input);
    if (created.error !== null) return fail(created.error);
    this.nicknames.set(created.data.id, input.nickname);
    return this.storage.exclusive(async () => {
      await this.storage.write({ ...(await this.storage.read()), [created.data.id]: input.balance });
      return ok({ id: created.data.id, balance: input.balance, nickname: input.nickname });
    });
  }

  private move(accountId: string, input: { amount: number; description: string }, direction: "in" | "out"): Promise<NessieResult<{ id: string }>> {
    const invalid = checkAmount(input.amount);
    if (invalid) return Promise.resolve(fail(invalid));
    return this.storage.exclusive(async () => {
      const ledger = await this.storage.read();
      const balance = ledger[accountId];
      if (balance === undefined) return fail("no such account");
      if (direction === "out" && balance < input.amount) return fail("insufficient funds");
      const written = direction === "out" ? await this.http.withdraw(accountId, input) : await this.http.deposit(accountId, input);
      if (written.error !== null) return fail(written.error);
      await this.storage.write({ ...ledger, [accountId]: direction === "out" ? balance - input.amount : balance + input.amount });
      return ok({ id: written.data.id });
    });
  }

  withdraw(accountId: string, input: { amount: number; description: string }): Promise<NessieResult<{ id: string }>> {
    return this.move(accountId, input, "out");
  }

  deposit(accountId: string, input: { amount: number; description: string }): Promise<NessieResult<{ id: string }>> {
    return this.move(accountId, input, "in");
  }

  // Our balance. The sandbox is never asked: its balance field is static.
  async getAccount(accountId: string): Promise<NessieResult<NessieAccount>> {
    const balance = (await this.storage.read())[accountId];
    return balance === undefined ? fail("no such account") : ok({ id: accountId, balance, nickname: this.nicknames.get(accountId) ?? "" });
  }
}

// The real client when a key is set, otherwise null: the caller then uses the local ledger.
export function nessieFromEnvironment(): NessieHttp | null {
  const key = process.env.NESSIE_KEY?.trim();
  return key ? new NessieHttp({ key }) : null;
}
