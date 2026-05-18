export type PixChargeResult = {
  orderId: string;
  status: string;
  amountCents: number;
  pixCode: string;
  qrCodeBase64: string | null;
  expiresAt: string | null;
};

const apiBase = import.meta.env.VITE_PUBLIC_API_URL ?? '';

function messageFromApiPayload(data: {
  message?: string;
  errors?: unknown;
}): string {
  if (data.message?.trim()) return data.message.trim();
  const err = data.errors;
  if (err && typeof err === 'object' && !Array.isArray(err)) {
    const parts: string[] = [];
    for (const [k, v] of Object.entries(err)) {
      if (Array.isArray(v)) {
        const s = v.filter((x) => typeof x === 'string').join(' ');
        if (s) parts.push(`${k}: ${s}`);
      } else if (typeof v === 'string' && v.trim()) parts.push(`${k}: ${v}`);
    }
    if (parts.length) return parts.join(' ');
  }
  return '';
}

function isPixPayload(x: unknown): x is PixChargeResult {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return false;
  const o = x as Record<string, unknown>;
  return typeof o.pixCode === 'string' && typeof o.orderId === 'string';
}

function asRecord(x: unknown): Record<string, unknown> | undefined {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return undefined;
  return x as Record<string, unknown>;
}

/** Lê chave ignorando maiúsculas (ex.: API com `Data` / `PIX`). */
function getKeyLoose(o: Record<string, unknown>, want: string): unknown {
  const lower = want.toLowerCase();
  for (const [k, v] of Object.entries(o)) {
    if (k.toLowerCase() === lower) return v;
  }
  return undefined;
}

const PIX_FLAT_KEYS = [
  'pixcode',
  'pix_code',
  'copy_paste',
  'copypaste',
  'payload',
  'emv',
  'brcode',
  'br_code',
  'qr_code',
  'qrcode',
  'pix_copy_paste',
  'pixcopiaecola',
  'copia_cola',
  'payment_code',
  'digitable_line',
] as const;

/** Padrão comum de PIX copia-e-cola (EMV). */
function looksLikePixCopyPaste(s: string): boolean {
  const t = s.trim();
  return t.length >= 50 && /^00020[12][\dA-Za-z]{20,}/.test(t);
}

function pickPixCodeFromObject(o: Record<string, unknown>): string | undefined {
  const direct =
    typeof o.pixCode === 'string'
      ? o.pixCode
      : typeof o.pix_code === 'string'
        ? o.pix_code
        : undefined;
  if (direct?.trim()) return direct.trim();

  for (const k of PIX_FLAT_KEYS) {
    const v = getKeyLoose(o, k);
    if (typeof v === 'string' && v.trim()) return v.trim();
  }

  const pix = o.pix ?? getKeyLoose(o, 'pix');
  if (typeof pix === 'string' && pix.trim()) return pix.trim();
  if (!pix || typeof pix !== 'object' || Array.isArray(pix)) return undefined;
  const p = pix as Record<string, unknown>;
  const keys = [
    'code',
    'copy_paste',
    'copyPaste',
    'payload',
    'qr_code',
    'qrCode',
    'emv',
    'brcode',
  ] as const;
  for (const k of keys) {
    const v = p[k] ?? getKeyLoose(p, k);
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function pickOrderIdFromObject(o: Record<string, unknown>): string | undefined {
  const order = o.order ?? getKeyLoose(o, 'order');
  let fromNested: string | undefined;
  if (order && typeof order === 'object' && !Array.isArray(order)) {
    const or = order as Record<string, unknown>;
    const nestedRaw =
      or.uuid ?? or.id ?? or.order_id ?? or.orderId ?? getKeyLoose(or, 'uuid') ?? getKeyLoose(or, 'id');
    if (nestedRaw != null) {
      const s = String(nestedRaw).trim();
      if (s) fromNested = s;
    }
  }
  const idRaw =
    o.orderId ??
    o.order_id ??
    o.uuid ??
    getKeyLoose(o, 'orderId') ??
    getKeyLoose(o, 'order_id') ??
    getKeyLoose(o, 'uuid') ??
    getKeyLoose(o, 'charge_id') ??
    getKeyLoose(o, 'external_id') ??
    o.id ??
    getKeyLoose(o, 'id') ??
    fromNested;
  if (idRaw == null) return undefined;
  if (typeof idRaw === 'number' && Number.isFinite(idRaw)) return String(idRaw);
  const s = String(idRaw).trim();
  return s || undefined;
}

/**
 * Quando `orderId` e `pixCode` vêm em ramos diferentes da árvore JSON,
 * percorre objetos e vai guardando o melhor candidato a cada um.
 */
function mergePixFromDeepTree(node: unknown): PixChargeResult | undefined {
  let pixCode: string | undefined;
  let orderId: string | undefined;
  let status = '';
  let amountCents = 0;
  let expiresAt: string | null = null;

  const visit = (n: unknown, depth: number, seen: Set<unknown>) => {
    if (n == null || depth > 16) return;
    if (typeof n === 'object') {
      if (seen.has(n)) return;
      seen.add(n);
    }

    const r = asRecord(n);
    if (r) {
      const pc = pickPixCodeFromObject(r);
      if (pc) {
        const better =
          !pixCode ||
          (looksLikePixCopyPaste(pc) && !looksLikePixCopyPaste(pixCode)) ||
          (pc.length > pixCode.length && pc.length >= 50);
        if (better) pixCode = pc;
      }

      const oid = pickOrderIdFromObject(r);
      if (oid && (!orderId || (UUID_RE.test(oid) && !UUID_RE.test(orderId)))) {
        orderId = oid;
      }

      if (typeof r.status === 'string' && r.status) status = r.status;
      if (typeof r.amountCents === 'number' && Number.isFinite(r.amountCents)) {
        amountCents = r.amountCents;
      } else if (typeof r.amount === 'number' && Number.isFinite(r.amount)) {
        amountCents = r.amount;
      }
      const pix = r.pix;
      if (expiresAt == null && pix && typeof pix === 'object' && !Array.isArray(pix)) {
        const ex = (pix as Record<string, unknown>).expires_at;
        if (typeof ex === 'string') expiresAt = ex;
      }

      for (const v of Object.values(r)) {
        if (v != null && typeof v === 'object') visit(v, depth + 1, seen);
      }
    } else if (Array.isArray(n)) {
      for (const item of n) visit(item, depth + 1, seen);
    }
  };

  const seen = new Set<unknown>();
  visit(node, 0, seen);

  if (pixCode && orderId) {
    return {
      orderId,
      status,
      amountCents,
      pixCode,
      qrCodeBase64: null,
      expiresAt,
    };
  }
  return undefined;
}

/** Aceita formato da nossa API, da Fruitfy e variações snake_case / aninhadas. */
function tryNormalizePixData(o: Record<string, unknown>): PixChargeResult | undefined {
  const pixCode = pickPixCodeFromObject(o);
  if (!pixCode) return undefined;

  const orderId = pickOrderIdFromObject(o);
  if (!orderId) return undefined;

  const pix = o.pix;
  const amountCents =
    typeof o.amountCents === 'number' && Number.isFinite(o.amountCents)
      ? o.amountCents
      : typeof o.amount === 'number' && Number.isFinite(o.amount)
        ? o.amount
        : 0;

  let expiresAt: string | null = typeof o.expiresAt === 'string' ? o.expiresAt : null;
  if (expiresAt == null && pix && typeof pix === 'object' && !Array.isArray(pix)) {
    const ex = (pix as Record<string, unknown>).expires_at;
    if (typeof ex === 'string') expiresAt = ex;
  }

  return {
    orderId,
    status: typeof o.status === 'string' ? o.status : '',
    amountCents,
    pixCode,
    qrCodeBase64: typeof o.qrCodeBase64 === 'string' ? o.qrCodeBase64 : null,
    expiresAt,
  };
}

function extractPixResult(parsed: unknown): PixChargeResult | undefined {
  if (parsed == null) return undefined;

  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      const p = extractPixResult(item);
      if (p) return p;
    }
    return undefined;
  }

  if (typeof parsed !== 'object') return undefined;
  const root = parsed as Record<string, unknown>;

  if (typeof root.body === 'string' && root.body.trim().startsWith('{')) {
    try {
      return extractPixResult(JSON.parse(root.body.trim()));
    } catch {
      /* ignore */
    }
  }

  const payloadRoot = root.data ?? root.Data ?? root.result ?? root.Result ?? root.response;
  if (payloadRoot !== undefined && payloadRoot !== parsed) {
    const mergedRoot = mergePixFromDeepTree(payloadRoot);
    if (mergedRoot) return mergedRoot;
  }

  const tryNode = (node: unknown): PixChargeResult | undefined => {
    if (typeof node === 'string' && node.trim().startsWith('{')) {
      try {
        return extractPixResult(JSON.parse(node.trim()));
      } catch {
        /* ignore */
      }
    }
    const r = asRecord(node);
    if (!r) return undefined;
    const n = tryNormalizePixData(r);
    if (n) return n;
    if (isPixPayload(r)) return r;
    const inner = r.data ?? r.Data ?? r.result ?? r.Result ?? r.response;
    if (inner !== undefined && inner !== node) {
      return tryNode(inner);
    }
    return undefined;
  };

  const first = tryNode(parsed);
  if (first) return first;
  if (root.data !== undefined || root.Data !== undefined) {
    const second = tryNode(root.data ?? root.Data);
    if (second) return second;
  }
  if (root.result !== undefined || root.Result !== undefined) {
    const third = tryNode(root.result ?? root.Result);
    if (third) return third;
  }

  const mergedFull = mergePixFromDeepTree(parsed);
  if (mergedFull) return mergedFull;

  return undefined;
}

export async function createPixCharge(body: {
  name: string;
  email: string;
  phone: string;
  cpf: string;
  amountCents: number;
  /** Parâmetros da URL (UTM, gclid, etc.) repassados à Fruitfy */
  urlParams?: Record<string, string>;
}): Promise<PixChargeResult> {
  const res = await fetch(`${apiBase}/api/pix/charge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });

  const raw = (await res.text()).trim().replace(/^\uFEFF/, '');
  let parsed: unknown;
  try {
    parsed = raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(
      `Resposta inválida do servidor (${res.status}). Confira se o backend em /api/pix/charge está ativo e se VITE_PUBLIC_API_URL aponta para o host correto.`,
    );
  }

  const root = parsed as {
    success?: boolean;
    message?: string;
    errors?: unknown;
  };

  const payload = extractPixResult(parsed);
  const okHttp = res.status >= 200 && res.status < 300;

  /** 2xx + payload utilizável: segue mesmo se `success` vier inconsistente (alguns proxies/APIs fazem isso). */
  if (okHttp && payload) {
    return payload;
  }

  const detail = messageFromApiPayload(root);
  throw new Error(
    detail ||
      (okHttp && !payload
        ? 'Resposta OK do servidor, mas sem código PIX ou ID do pedido reconhecíveis. Atualize o front ou verifique o JSON retornado pelo servidor em /api/pix/charge.'
        : '') ||
      `Não foi possível gerar o PIX (HTTP ${res.status}). Confira as variáveis FRUITFY_* no servidor do proxy e os logs da API.`,
  );
}

export async function getOrderStatus(orderId: string): Promise<string | undefined> {
  const res = await fetch(`${apiBase}/api/order/${encodeURIComponent(orderId)}`, {
    headers: { Accept: 'application/json' },
  });
  try {
    const data = JSON.parse((await res.text()).trim()) as { success?: boolean; data?: { status?: string } };
    if (!res.ok || data.success === false) {
      return undefined;
    }
    return data.data?.status;
  } catch {
    return undefined;
  }
}
