import type { QuoteItemInput } from "../quote/totals.ts";

export const QUOTE_STATUSES = ["draft", "for_approval", "approved", "declined"] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export const MIN_ITEMS = 1;
export const MAX_ITEMS = 500;
export const MAX_QUOTE_NAME_LENGTH = 200;
export const MAX_PRODUCT_NAME_LENGTH = 500;
export const MAX_PRODUCT_NUMBER_LENGTH = 100;
export const MAX_DESCRIPTION_LENGTH = 2000;
/** Largest value of `quote_items.quantity`, a `numeric(10,2)` column. */
export const MAX_QUANTITY = 99_999_999.99;
/** Largest value of `quote_items.unit_price`, a `numeric(12,2)` column. */
export const MAX_UNIT_PRICE = 9_999_999_999.99;

export type QuoteCreateInput = {
  project_id: string;
  quote_name: string;
  status: QuoteStatus;
  expiration_date: string | null;
  items: QuoteItemInput[];
};

export type QuoteUpdateInput = {
  quote_name?: string;
  status?: QuoteStatus;
  expiration_date?: string;
  items?: QuoteItemInput[];
};

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const CREATE_FIELDS = ["project_id", "quote_name", "status", "expiration_date", "items"];
const UPDATE_FIELDS = ["quote_name", "status", "expiration_date", "items"];
const ITEM_FIELDS = [
  "product_name",
  "product_number",
  "description",
  "quantity",
  "unit_price",
  "discount_percent",
];

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Reports whether a value is a UUID string.
 */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

// Raised inside the parsers and turned into a 400 message at the top
class InputError extends Error {}

function fail(message: string): never {
  throw new InputError(message);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rejectUnknownFields(obj: Record<string, unknown>, allowed: string[], path: string) {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) fail(`Unknown field: ${path}${key}`);
  }
}

// A two-decimal JSON number parses to the nearest double to k / 100, and dividing
// the rounded cents by 100 lands on that same double at any magnitude.
function hasAtMostTwoDecimals(n: number): boolean {
  return Math.round(n * 100) / 100 === n;
}

function requiredText(value: unknown, path: string, max: number): string {
  if (typeof value !== "string" || value.trim() === "") fail(`${path} is required`);
  const trimmed = value.trim();
  if (trimmed.length > max) fail(`${path} must be at most ${max} characters`);
  return trimmed;
}

function optionalText(value: unknown, path: string, max: number): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") fail(`${path} must be a string`);
  const trimmed = value.trim();
  if (trimmed.length > max) fail(`${path} must be at most ${max} characters`);
  return trimmed;
}

function money(
  value: unknown,
  path: string,
  { min, minInclusive, max }: { min: number; minInclusive: boolean; max: number }
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(`${path} must be a number`);
  if (minInclusive ? value < min : value <= min) {
    fail(`${path} must be ${minInclusive ? "at least" : "greater than"} ${min}`);
  }
  if (value > max) fail(`${path} must be at most ${max}`);
  if (!hasAtMostTwoDecimals(value)) fail(`${path} must have at most 2 decimal places`);
  return value;
}

function parseStatus(value: unknown): QuoteStatus {
  if (!(QUOTE_STATUSES as readonly unknown[]).includes(value)) {
    fail(`status must be one of ${QUOTE_STATUSES.join(", ")}`);
  }
  return value as QuoteStatus;
}

function parseDate(value: unknown): string {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) {
    fail("expiration_date must be a date in YYYY-MM-DD form");
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    fail("expiration_date is not a real date");
  }
  return value;
}

function parseItem(value: unknown, index: number): QuoteItemInput {
  const path = `items[${index}]`;
  if (!isPlainObject(value)) fail(`${path} must be an object`);
  rejectUnknownFields(value, ITEM_FIELDS, `${path}.`);

  const item: QuoteItemInput = {
    product_name: requiredText(value.product_name, `${path}.product_name`, MAX_PRODUCT_NAME_LENGTH),
    quantity: money(value.quantity, `${path}.quantity`, {
      min: 0,
      minInclusive: false,
      max: MAX_QUANTITY,
    }),
    unit_price: money(value.unit_price, `${path}.unit_price`, {
      min: 0,
      minInclusive: true,
      max: MAX_UNIT_PRICE,
    }),
  };

  const productNumber = optionalText(
    value.product_number,
    `${path}.product_number`,
    MAX_PRODUCT_NUMBER_LENGTH
  );
  if (productNumber !== undefined) item.product_number = productNumber;

  const description = optionalText(value.description, `${path}.description`, MAX_DESCRIPTION_LENGTH);
  if (description !== undefined) item.description = description;

  if (value.discount_percent !== undefined) {
    item.discount_percent = money(value.discount_percent, `${path}.discount_percent`, {
      min: 0,
      minInclusive: true,
      max: 1,
    });
  }

  return item;
}

function parseItems(value: unknown): QuoteItemInput[] {
  if (!Array.isArray(value)) fail("items must be an array");
  if (value.length < MIN_ITEMS || value.length > MAX_ITEMS) {
    fail(`items must hold from ${MIN_ITEMS} to ${MAX_ITEMS} entries`);
  }
  return value.map(parseItem);
}

function parsed<T>(build: () => T): Parsed<T> {
  try {
    return { ok: true, value: build() };
  } catch (error) {
    if (error instanceof InputError) return { ok: false, error: error.message };
    throw error;
  }
}

/**
 * Validates a create-quote request body.
 *
 * Only the documented fields are accepted, at the quote level and inside each
 * item. Text is trimmed, numbers must fit their columns with at most 2 decimal
 * places, and a missing status defaults to draft.
 */
export function parseQuoteCreate(body: unknown): Parsed<QuoteCreateInput> {
  return parsed(() => {
    if (!isPlainObject(body)) fail("Request body must be a JSON object");
    rejectUnknownFields(body, CREATE_FIELDS, "");

    if (!isUuid(body.project_id)) fail("project_id must be a UUID");

    return {
      project_id: body.project_id,
      quote_name: requiredText(body.quote_name, "quote_name", MAX_QUOTE_NAME_LENGTH),
      status: body.status === undefined ? "draft" : parseStatus(body.status),
      expiration_date: body.expiration_date === undefined ? null : parseDate(body.expiration_date),
      items: parseItems(body.items),
    };
  });
}

/**
 * Validates an update-quote request body.
 *
 * Every field is optional, but at least one must be sent. Fields are checked
 * as on create; sent items replace all of the quote's items.
 */
export function parseQuoteUpdate(body: unknown): Parsed<QuoteUpdateInput> {
  return parsed(() => {
    if (!isPlainObject(body)) fail("Request body must be a JSON object");
    rejectUnknownFields(body, UPDATE_FIELDS, "");
    if (!UPDATE_FIELDS.some((field) => body[field] !== undefined)) {
      fail(`Request body must include at least one of ${UPDATE_FIELDS.join(", ")}`);
    }

    const input: QuoteUpdateInput = {};
    if (body.quote_name !== undefined) {
      input.quote_name = requiredText(body.quote_name, "quote_name", MAX_QUOTE_NAME_LENGTH);
    }
    if (body.status !== undefined) input.status = parseStatus(body.status);
    if (body.expiration_date !== undefined) input.expiration_date = parseDate(body.expiration_date);
    if (body.items !== undefined) input.items = parseItems(body.items);
    return input;
  });
}
