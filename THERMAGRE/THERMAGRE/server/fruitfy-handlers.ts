import { Buffer } from 'node:buffer';

/**
 * Nomes das env vars só via Base64 para bundlers não mapearem
 * `process.env.FRUITFY_*` → valor literal no bundle (secrets scan).
 */
const ENV_KEY = {
  BASE: 'RlJVSVRGWV9BUElfQkFTRQ==',
  TOKEN: 'RlJVSVRGWV9BUElfVE9LRU4=',
  STORE: 'RlJVSVRGWV9TVE9SRV9JRA==',
  PRODUCT: 'RlJVSVRGWV9QUk9EVUNUX0lE',
} as const;

function envKeyName(b64: string): string {
  return Buffer.from(b64, 'base64').toString('utf8');
}

function readEnvRaw(name: string): string | undefined {
  if (typeof process === 'undefined' || !process.env) return undefined;
  return process.env[name];
}

function pick(b64: string): string | undefined {
  return readEnvRaw(envKeyName(b64));
}

function requirePick(b64: string): string {
  const v = pick(b64)?.trim();
  if (!v) {
    throw new Error('Configuração da API de pagamento ausente. Defina FRUITFY_* no ambiente do servidor (proxy).');
  }
  return v;
}

function fruitfyBaseUrl(): string {
  return requirePick(ENV_KEY.BASE).replace(/\/$/, '');
}

const MAX_TRACKING_KEYS = 40;
const MAX_TRACKING_VALUE_LEN = 512;

export type FruitfyApiResult = {
  statusCode: number;
  body: string;
  headers: Record<string, string>;
};

function fruitfyHeaders(): HeadersInit {
  return {
    Authorization: `Bearer ${requirePick(ENV_KEY.TOKEN)}`,
    'Store-Id': requirePick(ENV_KEY.STORE),
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'Accept-Language': 'pt_BR',
  };
}

function sanitizeUrlParams(input: unknown): Record<string, string> | undefined {
  if (input == null || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (typeof k !== 'string' || typeof v !== 'string') continue;
    const key = k.trim().slice(0, 64);
    if (!key || !/^[\w.-]+$/.test(key)) continue;
    const val = v.trim().slice(0, MAX_TRACKING_VALUE_LEN);
    if (!val) continue;
    out[key] = val;
    if (Object.keys(out).length >= MAX_TRACKING_KEYS) break;
  }
  return Object.keys(out).length ? out : undefined;
}

function json(statusCode: number, data: unknown): FruitfyApiResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  };
}

/** Monta texto a partir do objeto `errors` da Fruitfy (422 sem `message`). */
function flattenFruitfyErrors(errors: unknown): string | undefined {
  if (errors == null || typeof errors !== 'object' || Array.isArray(errors)) return undefined;
  const lines: string[] = [];
  for (const [k, v] of Object.entries(errors)) {
    if (Array.isArray(v)) {
      const parts = v.filter((x) => typeof x === 'string');
      if (parts.length) lines.push(`${k}: ${parts.join(' ')}`);
    } else if (typeof v === 'string' && v.trim()) {
      lines.push(`${k}: ${v}`);
    }
  }
  return lines.length ? lines.join(' ') : undefined;
}

function upstreamErrorMessage(
  status: number,
  resJson: { message?: string; errors?: unknown },
): string {
  const fromErrors = flattenFruitfyErrors(resJson.errors);
  if (resJson.message?.trim()) return resJson.message.trim();
  if (fromErrors) return fromErrors;
  return `Fruitfy retornou erro HTTP ${status}. Verifique token, Store-Id e variáveis FRUITFY_* no servidor.`;
}

function asRecord(v: unknown): Record<string, unknown> | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  return v as Record<string, unknown>;
}

function pickPixCodeAny(obj: Record<string, unknown>): string | undefined {
  const direct =
    (typeof obj.pixCode === 'string' && obj.pixCode.trim() ? obj.pixCode.trim() : undefined) ??
    (typeof obj.pix_code === 'string' && obj.pix_code.trim() ? obj.pix_code.trim() : undefined);
  if (direct) return direct;

  const pix = asRecord(obj.pix) ?? asRecord(obj.PIX);
  if (!pix) return undefined;
  const candidates = [
    pix.code,
    pix.copy_paste,
    pix.payload,
    pix.qr_code,
    pix.qrCode,
    pix.emv,
    pix.brcode,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim();
  }
  return undefined;
}

function pickOrderIdAny(obj: Record<string, unknown>): string | undefined {
  const order = asRecord(obj.order);
  const raw =
    obj.orderId ??
    obj.order_id ??
    obj.uuid ??
    obj.id ??
    obj.charge_id ??
    obj.external_id ??
    order?.uuid ??
    order?.id ??
    order?.order_id;
  if (raw == null) return undefined;
  const s = String(raw).trim();
  return s || undefined;
}

function normalizePixResponse(resJson: unknown): {
  orderId: string;
  status: string;
  amountCents: number;
  pixCode: string;
  expiresAt: string | null;
} | undefined {
  let orderId: string | undefined;
  let pixCode: string | undefined;
  let status = '';
  let amountCents = 0;
  let expiresAt: string | null = null;

  const visit = (node: unknown, depth: number, seen: Set<unknown>) => {
    if (node == null || depth > 12) return;
    if (typeof node === 'object') {
      if (seen.has(node)) return;
      seen.add(node);
    }

    const r = asRecord(node);
    if (!r) return;

    const maybeCode = pickPixCodeAny(r);
    if (maybeCode && (!pixCode || maybeCode.length > pixCode.length)) {
      pixCode = maybeCode;
    }
    const maybeId = pickOrderIdAny(r);
    if (maybeId && !orderId) orderId = maybeId;
    if (typeof r.status === 'string' && r.status.trim()) status = r.status.trim();
    if (typeof r.amountCents === 'number' && Number.isFinite(r.amountCents)) amountCents = r.amountCents;
    if (typeof r.amount === 'number' && Number.isFinite(r.amount)) amountCents = r.amount;

    const pix = asRecord(r.pix);
    if (!expiresAt && pix && typeof pix.expires_at === 'string' && pix.expires_at.trim()) {
      expiresAt = pix.expires_at.trim();
    }

    for (const value of Object.values(r)) {
      if (value && typeof value === 'object') visit(value, depth + 1, seen);
    }
  };

  visit(resJson, 0, new Set<unknown>());

  if (!orderId || !pixCode) return undefined;
  return { orderId, status, amountCents, pixCode, expiresAt };
}

export async function processPixCharge(rawBody: unknown): Promise<FruitfyApiResult> {
  try {
    const productId = requirePick(ENV_KEY.PRODUCT);
    const body = rawBody as Record<string, unknown>;
    const { name, email, phone, cpf, amountCents, urlParams } = body;

    if (typeof name !== 'string' || !name.trim()) {
      return json(400, { success: false, message: 'Nome é obrigatório.' });
    }
    if (typeof email !== 'string' || !email.trim()) {
      return json(400, { success: false, message: 'E-mail é obrigatório.' });
    }
    if (typeof phone !== 'string' || !phone.trim()) {
      return json(400, { success: false, message: 'Telefone é obrigatório.' });
    }
    if (typeof cpf !== 'string' || !cpf.trim()) {
      return json(400, { success: false, message: 'CPF é obrigatório.' });
    }
    const cents = Number(amountCents);
    if (!Number.isFinite(cents) || cents < 500) {
      return json(400, {
        success: false,
        message: 'Valor inválido. O total mínimo para PIX é R$ 5,00.',
      });
    }

    const digitsCpf = String(cpf).replace(/\D/g, '');
    if (digitsCpf.length !== 11) {
      return json(400, { success: false, message: 'CPF deve ter 11 dígitos.' });
    }

    let digitsPhone = String(phone).replace(/\D/g, '');
    if (digitsPhone.length < 10) {
      return json(400, { success: false, message: 'Telefone inválido.' });
    }
    if (!digitsPhone.startsWith('55')) {
      digitsPhone = `55${digitsPhone}`;
    }

    const tracking = sanitizeUrlParams(urlParams);

    const payload: Record<string, unknown> = {
      name: name.trim(),
      email: email.trim().toLowerCase(),
      phone: digitsPhone,
      cpf: digitsCpf,
      items: [{ id: productId, value: Math.round(cents), quantity: 1 }],
    };

    if (tracking) {
      payload.utm = tracking;
    }

    const base = fruitfyBaseUrl();
    const upstream = await fetch(`${base}/api/pix/charge`, {
      method: 'POST',
      headers: fruitfyHeaders(),
      body: JSON.stringify(payload),
    });

    let resJson: {
      success?: boolean;
      message?: string;
      errors?: unknown;
      data?: {
        order_id?: string;
        uuid?: string;
        id?: string;
        order?: { uuid?: string; id?: string; order_id?: string };
        status?: string;
        amount?: number;
        pix?: {
          code?: string;
          copy_paste?: string;
          payload?: string;
          qr_code?: string;
          expires_at?: string;
          qr_code_base64?: string;
        };
        pix_code?: string;
      };
    };
    try {
      resJson = (await upstream.json()) as typeof resJson;
    } catch {
      return json(502, {
        success: false,
        message: 'Resposta inválida da Fruitfy (não é JSON).',
      });
    }

    if (!upstream.ok || resJson.success === false) {
      const status = upstream.status === 200 ? 422 : upstream.status;
      const message = upstreamErrorMessage(upstream.status, resJson);
      return json(status, {
        success: false,
        message,
        errors: resJson.errors,
      });
    }

    const normalized = normalizePixResponse(resJson);
    if (!normalized) {
      return json(502, {
        success: false,
        message: 'Resposta da Fruitfy sem código PIX ou identificador do pedido reconhecíveis.',
      });
    }

    // Não enviar qr_code_base64 ao browser: o JSON fica enorme (SVG) e pode quebrar
    // parse no cliente; o front gera o QR a partir de pixCode.
    return json(201, {
      success: true,
      data: {
        orderId: normalized.orderId,
        status: normalized.status,
        amountCents: normalized.amountCents,
        pixCode: normalized.pixCode,
        qrCodeBase64: null,
        expiresAt: normalized.expiresAt,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro interno';
    if (msg.includes('Configuração da API de pagamento')) {
      return json(500, { success: false, message: msg });
    }
    console.error(e);
    return json(500, { success: false, message: 'Erro interno ao criar cobrança.' });
  }
}

export async function processOrderLookup(orderId: string | undefined): Promise<FruitfyApiResult> {
  try {
    if (!orderId || !/^[a-f0-9-]{36}$/i.test(orderId)) {
      return json(400, { success: false, message: 'ID do pedido inválido.' });
    }

    const base = fruitfyBaseUrl();
    const upstream = await fetch(`${base}/api/order/${encodeURIComponent(orderId)}`, {
      method: 'GET',
      headers: fruitfyHeaders(),
    });

    const resJson = (await upstream.json()) as {
      success?: boolean;
      message?: string;
      data?: { status?: string; uuid?: string };
    };

    if (!upstream.ok || resJson.success === false) {
      return json(upstream.status, {
        success: false,
        message: resJson.message || 'Pedido não encontrado.',
      });
    }

    return json(200, {
      success: true,
      data: { status: resJson.data?.status, uuid: resJson.data?.uuid },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    if (msg.includes('Configuração da API de pagamento')) {
      return json(500, { success: false, message: msg });
    }
    console.error(e);
    return json(500, { success: false, message: 'Erro ao consultar pedido.' });
  }
}
