import { 
  Brain, 
  Zap, 
  Droplets,
  Flame,
  ShieldCheck, 
  CheckCircle2, 
  Star, 
  ArrowRight, 
  ChevronDown, 
  Clock, 
  Truck, 
  CreditCard, 
  Lock,
  Menu,
  X,
  User,
  MapPin,
  Plus,
  Minus,
  Copy,
  Check,
  ChevronRight,
  Info,
  Loader2,
  Play
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useState, useEffect, useRef, ChangeEvent } from 'react';
import { createPixCharge, getOrderStatus, type PixChargeResult } from './api/fruitfy';
import { useUrlTracking } from './context/UrlTrackingContext';
import { formatCep, formatCpf, formatPhoneBr, onlyDigits, validateCpf } from './lib/brFormat';

/** Ofertas extras no checkout (valor somado ao total do PIX, mesmo fluxo de API). */
const CHECKOUT_ORDER_BUMPS = [
  {
    id: 'pro3-magnesio',
    title: 'PRO3 Magnésio',
    price: 23.9,
    image: 'https://i.ibb.co/LzmB7C4L/image.png',
    description:
      'Auxilia na redução do cansaço e na disposição no dia a dia. Ideal para quem está mudando hábitos e quer manter energia sem exageros.',
  },
  {
    id: 'fits36',
    title: 'FITS36',
    price: 26.9,
    image: 'https://i.ibb.co/3mkqMmxg/image.png',
    description:
      'Apoia o controle do apetite e a aceleração metabólica. Combine com o Thermagre para reforçar constância na rotina de emagrecimento saudável.',
  },
  {
    id: 'omega3',
    title: 'Ômega 3',
    price: 21.9,
    image: 'https://i.ibb.co/rfTxL4F6/image.png',
    description:
      'Contribui para o equilíbrio do organismo e bem-estar geral. Um complemento natural para uma suplementação mais completa.',
  },
] as const;

// --- Components ---

const Checkout = ({ selectedPlan, onBack }: { selectedPlan: any, onBack: () => void }) => {
  const { trackingParams } = useUrlTracking();
  const [step, setStep] = useState<'form' | 'success'>('form');
  const [quantity, setQuantity] = useState(1);
  const [cep, setCep] = useState('');
  const [address, setAddress] = useState({
    street: '',
    number: '',
    complement: '',
    neighborhood: '',
    city: '',
    state: ''
  });
  const [customer, setCustomer] = useState({
    name: '',
    email: '',
    cpf: '',
    phone: ''
  });
  const [shippingMethod, setShippingMethod] = useState<'free' | 'sedex'>('free');
  const [loadingCep, setLoadingCep] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pixLoading, setPixLoading] = useState(false);
  const [pixError, setPixError] = useState<string | null>(null);
  const [pixData, setPixData] = useState<PixChargeResult | null>(null);
  const [orderPaid, setOrderPaid] = useState(false);
  const [cepError, setCepError] = useState<string | null>(null);
  const [cpfError, setCpfError] = useState<string | null>(null);
  const [selectedBumps, setSelectedBumps] = useState<Record<string, boolean>>({});

  const cepDigits = onlyDigits(cep, 8);

  const basePrice = parseFloat(selectedPlan.price.replace(',', '.'));
  const shippingPrice = shippingMethod === 'sedex' ? 18.75 : 0;
  const orderBumpsTotal = CHECKOUT_ORDER_BUMPS.reduce(
    (sum, b) => sum + (selectedBumps[b.id] ? b.price : 0),
    0,
  );
  const total = (basePrice * quantity) + shippingPrice + orderBumpsTotal;

  const toggleOrderBump = (id: string) => {
    setSelectedBumps((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleCepChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const formatted = formatCep(e.target.value);
    setCep(formatted);
    setCepError(null);
    const value = onlyDigits(formatted, 8);
    if (value.length < 8) {
      return;
    }
    setLoadingCep(true);
    try {
      const response = await fetch(`https://viacep.com.br/ws/${value}/json/`);
      const data = await response.json();
      if (data.erro) {
        setCepError('CEP não encontrado. Verifique o número digitado.');
        return;
      }
      setAddress(prev => ({
        ...prev,
        street: data.logradouro ?? '',
        neighborhood: data.bairro ?? '',
        city: data.localidade ?? '',
        state: data.uf ?? '',
      }));
    } catch {
      setCepError('Não foi possível consultar o CEP. Tente novamente.');
    } finally {
      setLoadingCep(false);
    }
  };

  const pixCode = pixData?.pixCode ?? '';
  const qrSrc =
    pixData?.qrCodeBase64?.trim() ||
    (pixCode
      ? `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(pixCode)}`
      : '');

  const handleCopyPix = () => {
    if (!pixCode) return;
    void navigator.clipboard.writeText(pixCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const paidAmountBrl =
    pixData != null
      ? (pixData.amountCents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })
      : total.toLocaleString('pt-BR', { minimumFractionDigits: 2 });

  useEffect(() => {
    if (step !== 'success' || !pixData?.orderId || orderPaid) return;
    let cancelled = false;
    const tick = async () => {
      const status = await getOrderStatus(pixData.orderId);
      if (cancelled) return;
      if (status === 'paid') setOrderPaid(true);
    };
    void tick();
    const id = window.setInterval(() => void tick(), 5000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [step, pixData?.orderId, orderPaid]);

  const handleFinalizePayment = async () => {
    setPixError(null);
    const name = customer.name.trim();
    const email = customer.email.trim();
    const phoneDigits = onlyDigits(customer.phone, 11);

    if (!name) {
      setPixError('Informe seu nome completo.');
      return;
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setPixError('Informe um e-mail válido.');
      return;
    }
    if (!validateCpf(customer.cpf)) {
      const msg = 'CPF inválido. Confira os dígitos ou os verificadores.';
      setCpfError(msg);
      setPixError(msg);
      return;
    }
    setCpfError(null);
    if (phoneDigits.length < 10) {
      setPixError('Informe um telefone com DDD (ex.: 11999999999).');
      return;
    }
    if (cepDigits.length !== 8) {
      const msg = 'Digite o CEP completo (8 dígitos).';
      setCepError(msg);
      setPixError(msg);
      return;
    }
    if (cepError) {
      setPixError(cepError);
      return;
    }
    if (!address.street.trim() || !address.number.trim()) {
      setPixError('Preencha rua e número do endereço.');
      return;
    }

    const amountCents = Math.round(total * 100);
    if (amountCents < 500) {
      setPixError('O valor mínimo para PIX é R$ 5,00.');
      return;
    }

    setPixLoading(true);
    try {
      const data = await createPixCharge({
        name,
        email,
        phone: customer.phone,
        cpf: customer.cpf,
        amountCents,
        urlParams: trackingParams,
      });
      setPixData(data);
      setOrderPaid(false);
      setStep('success');
      window.scrollTo(0, 0);
    } catch (e) {
      setPixError(e instanceof Error ? e.message : 'Erro ao gerar PIX. Tente novamente.');
    } finally {
      setPixLoading(false);
    }
  };

  const handleBackToStore = () => {
    setPixData(null);
    setOrderPaid(false);
    setPixError(null);
    onBack();
  };

  if (step === 'success') {
    return (
      <div className="min-h-screen bg-gray-50 py-12 px-4">
        <div className="max-w-2xl mx-auto bg-white rounded-[40px] shadow-2xl overflow-hidden">
          <div className="bg-primary p-8 text-center text-white">
            <CheckCircle2 size={64} className="mx-auto mb-4" />
            <h2 className="text-3xl font-black mb-2">
              {orderPaid ? 'PAGAMENTO CONFIRMADO!' : 'PEDIDO RESERVADO!'}
            </h2>
            <p className="font-medium opacity-90">
              {orderPaid
                ? 'Obrigado! Seu PIX foi recebido e o pedido seguirá para separação.'
                : 'Finalize o pagamento via PIX para processarmos seu envio.'}
            </p>
          </div>
          
          <div className="p-8 text-center">
            {orderPaid && (
              <div className="mb-6 rounded-2xl border border-primary/30 bg-primary/10 px-4 py-3 text-sm font-bold text-primary">
                Pagamento identificado. Você receberá atualizações por e-mail.
              </div>
            )}
            <div className="mb-8">
              <p className="text-gray-600 mb-4 font-medium">Escaneie o QR Code abaixo:</p>
              <div className="bg-gray-100 p-4 rounded-3xl inline-block mb-4">
                {qrSrc ? (
                  <img src={qrSrc} alt="QR Code PIX" className="w-48 h-48 object-contain" />
                ) : (
                  <div className="w-48 h-48 flex items-center justify-center text-gray-400 text-sm">
                    Carregando QR…
                  </div>
                )}
              </div>
              
              <div className="max-w-md mx-auto">
                <p className="text-sm text-gray-500 mb-2">Ou copie o código abaixo:</p>
                <div className="flex gap-2">
                  <input 
                    readOnly 
                    value={pixCode}
                    className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-xs font-mono truncate"
                  />
                  <button 
                    type="button"
                    onClick={handleCopyPix}
                    disabled={!pixCode}
                    className="bg-primary text-white p-3 rounded-xl hover:bg-primary-dark transition-colors flex items-center gap-2 disabled:opacity-50"
                  >
                    {copied ? <Check size={20} /> : <Copy size={20} />}
                  </button>
                </div>
                {pixData?.expiresAt && (
                  <p className="text-xs text-gray-400 mt-2">
                    Código válido até {pixData.expiresAt}
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-4 text-left bg-primary/10 p-6 rounded-3xl border border-primary/20">
              <h4 className="font-black text-secondary flex items-center gap-2">
                <Info size={20} className="text-primary" />
                INSTRUÇÕES:
              </h4>
              <ul className="text-sm text-gray-600 space-y-2 list-decimal list-inside">
                <li>Abra o app do seu banco e escolha a opção <b>PIX</b>.</li>
                <li>Selecione <b>&quot;Ler QR Code&quot;</b> ou <b>&quot;PIX Copia e Cola&quot;</b>.</li>
                <li>Confira os dados e o valor de <b>R$ {paidAmountBrl}</b>.</li>
                <li>Após o pagamento, seu pedido será aprovado instantaneamente!</li>
              </ul>
            </div>

            <button 
              type="button"
              onClick={handleBackToStore}
              className="mt-8 text-primary font-bold hover:underline"
            >
              Voltar para a loja
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-header shadow-sm py-4 sticky top-0 z-50">
        <div className="container mx-auto px-4 flex justify-between items-center">
          <img 
            src="https://i.ibb.co/S48Y7900/image.png" 
            alt="Thermagre" 
            className="h-8 w-auto object-contain"
            referrerPolicy="no-referrer"
          />
          <div className="flex items-center gap-2 text-primary font-black text-sm">
            <Lock size={16} />
            CHECKOUT SEGURO
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <div className="max-w-6xl mx-auto">
          {/* Stepper */}
          <div className="flex items-center justify-between mb-8 max-w-xl mx-auto relative">
            <div className="absolute top-4 left-0 w-full h-px bg-gray-200 -z-10" />
            
            <div className="flex flex-col items-center gap-1.5 bg-gray-50 px-3">
              <div className="w-8 h-8 bg-primary text-white rounded-full flex items-center justify-center text-sm font-black shadow-lg shadow-primary/20">1</div>
              <span className="text-[9px] font-black text-primary uppercase tracking-widest">Identificação</span>
            </div>

            <div className="flex flex-col items-center gap-1.5 bg-gray-50 px-3">
              <div className="w-8 h-8 bg-gray-300 text-white rounded-full flex items-center justify-center text-sm font-black">2</div>
              <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest">Entrega</span>
            </div>

            <div className="flex flex-col items-center gap-1.5 bg-gray-50 px-3">
              <div className="w-8 h-8 bg-gray-300 text-white rounded-full flex items-center justify-center text-sm font-black">3</div>
              <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest">Pagamento</span>
            </div>
          </div>

          <div className="grid lg:grid-cols-2 gap-8">
            {/* Left Column: Forms */}
            <div className="space-y-6">
              {/* Product Summary - Image Layout */}
              <div className="bg-white rounded-3xl p-5 lg:p-6 shadow-sm border border-gray-100">
                <div className="flex gap-5 items-center">
                  <div className="w-20 h-20 lg:w-32 lg:h-32 bg-gray-50 rounded-2xl p-2 lg:p-3 flex items-center justify-center border border-gray-100 flex-shrink-0">
                    <img 
                      src={selectedPlan.img} 
                      alt={selectedPlan.name} 
                      className="max-h-full object-contain drop-shadow-lg" 
                    />
                  </div>
                  
                  <div className="flex-1">
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-1 mb-3">
                      <div>
                        <h4 className="text-base lg:text-xl font-black text-secondary leading-tight mb-0.5 uppercase">
                          {selectedPlan.bottles} {selectedPlan.bottles === 1 ? 'Unidade' : 'Unidades'}
                        </h4>
                        <p className="text-primary font-black text-[10px] lg:text-xs uppercase italic">
                          Tratamento para{' '}
                          {selectedPlan.bottles * quantity}{' '}
                          {selectedPlan.bottles * quantity === 1 ? 'mês' : 'meses'}{' '}
                          ({selectedPlan.bottles * quantity * 30} dias de Thermagre)
                        </p>
                      </div>
                      
                      <div className="flex flex-row lg:flex-col items-baseline lg:items-end gap-2 lg:gap-0">
                        <span className="text-gray-300 line-through text-[10px] lg:text-xs font-bold">
                          R$ {(parseFloat(selectedPlan.price.replace(',', '.')) * 2.5 * quantity).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                        </span>
                        <span className="text-xl lg:text-3xl font-black text-secondary italic">
                          R$ {(parseFloat(selectedPlan.price.replace(',', '.')) * quantity).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <span className="hidden sm:inline text-[10px] font-black text-secondary uppercase tracking-tighter">Quantidade</span>
                      <div className="flex items-center bg-gray-100 rounded-lg p-0.5 border border-gray-200">
                        <button 
                          onClick={() => setQuantity(Math.max(1, quantity - 1))}
                          className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-primary transition-colors"
                        >
                          <Minus size={14} />
                        </button>
                        <span className="w-8 text-center font-black text-secondary text-sm">{quantity}</span>
                        <button 
                          onClick={() => setQuantity(quantity + 1)}
                          className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-primary transition-colors"
                        >
                          <Plus size={14} />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Customer Data */}
            <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
              <h3 className="text-base font-black text-secondary mb-4 flex items-center gap-2">
                <div className="w-7 h-7 bg-primary/10 text-primary rounded-lg flex items-center justify-center text-xs">2</div>
                DADOS PESSOAIS
              </h3>
              <div className="grid md:grid-cols-2 gap-3">
                <div className="md:col-span-2">
                  <label className="block text-[10px] font-black text-gray-400 mb-1 uppercase tracking-widest">Nome Completo</label>
                  <input 
                    type="text" 
                    placeholder="Seu nome completo"
                    className="w-full bg-gray-50 border border-gray-100 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary/20 outline-none transition-all"
                    value={customer.name}
                    onChange={(e) => setCustomer({...customer, name: e.target.value})}
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-gray-400 mb-1 uppercase tracking-widest">E-mail</label>
                  <input 
                    type="email" 
                    placeholder="exemplo@email.com"
                    className="w-full bg-gray-50 border border-gray-100 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary/20 outline-none transition-all"
                    value={customer.email}
                    onChange={(e) => setCustomer({...customer, email: e.target.value})}
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-gray-400 mb-1 uppercase tracking-widest">CPF</label>
                  <input 
                    type="text" 
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="000.000.000-00"
                    className={`w-full bg-gray-50 border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary/20 outline-none transition-all ${
                      cpfError ? 'border-red-300 ring-1 ring-red-200' : 'border-gray-100'
                    }`}
                    value={customer.cpf}
                    onChange={(e) => {
                      setCpfError(null);
                      setCustomer({ ...customer, cpf: formatCpf(e.target.value) });
                    }}
                    onBlur={() => {
                      const d = onlyDigits(customer.cpf, 11);
                      if (d.length === 0) return;
                      if (d.length < 11 || !validateCpf(customer.cpf)) {
                        setCpfError('CPF inválido. Confira os dígitos ou os verificadores.');
                      }
                    }}
                  />
                  {cpfError && (
                    <p className="text-[11px] font-bold text-red-600 mt-1">{cpfError}</p>
                  )}
                </div>
                <div className="md:col-span-2">
                  <label className="block text-[10px] font-black text-gray-400 mb-1 uppercase tracking-widest">WhatsApp / Celular</label>
                  <input 
                    type="tel" 
                    inputMode="numeric"
                    autoComplete="tel"
                    placeholder="(11) 99999-9999"
                    className="w-full bg-gray-50 border border-gray-100 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary/20 outline-none transition-all"
                    value={customer.phone}
                    onChange={(e) =>
                      setCustomer({ ...customer, phone: formatPhoneBr(e.target.value) })
                    }
                  />
                </div>
              </div>
            </div>

            {/* Delivery Data */}
            <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
              <h3 className="text-base font-black text-secondary mb-4 flex items-center gap-2">
                <div className="w-7 h-7 bg-primary/10 text-primary rounded-lg flex items-center justify-center text-xs">3</div>
                ENDEREÇO DE ENTREGA
              </h3>
              <div className="grid md:grid-cols-3 gap-3">
                <div className="md:col-span-1">
                  <label className="block text-[10px] font-black text-gray-400 mb-1 uppercase tracking-widest">CEP</label>
                  <div className="relative">
                    <input 
                      type="text" 
                      inputMode="numeric"
                      autoComplete="postal-code"
                      placeholder="00000-000"
                      className={`w-full bg-gray-50 border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary/20 outline-none transition-all ${
                        cepError ? 'border-red-300 ring-1 ring-red-200' : 'border-gray-100'
                      }`}
                      value={cep}
                      onChange={handleCepChange}
                    />
                    {loadingCep && <div className="absolute right-2 top-2.5 animate-spin rounded-full h-4 w-4 border-2 border-primary border-t-transparent"></div>}
                  </div>
                  {cepError && (
                    <p className="text-[11px] font-bold text-red-600 mt-1">{cepError}</p>
                  )}
                </div>
                <div className="md:col-span-2">
                  <label className="block text-[10px] font-black text-gray-400 mb-1 uppercase tracking-widest">Rua / Logradouro</label>
                  <input 
                    type="text" 
                    placeholder="Nome da rua"
                    className="w-full bg-gray-50 border border-gray-100 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary/20 outline-none transition-all"
                    value={address.street}
                    onChange={(e) => setAddress({...address, street: e.target.value})}
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-gray-400 mb-1 uppercase tracking-widest">Número</label>
                  <input 
                    type="text" 
                    placeholder="123"
                    className="w-full bg-gray-50 border border-gray-100 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary/20 outline-none transition-all"
                    value={address.number}
                    onChange={(e) => setAddress({...address, number: e.target.value})}
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-[10px] font-black text-gray-400 mb-1 uppercase tracking-widest">Complemento</label>
                  <input 
                    type="text" 
                    placeholder="Apto, Bloco, etc"
                    className="w-full bg-gray-50 border border-gray-100 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary/20 outline-none transition-all"
                    value={address.complement}
                    onChange={(e) => setAddress({...address, complement: e.target.value})}
                  />
                </div>
              </div>

              {cepDigits.length === 8 && !cepError && (
                <div className="mt-8 space-y-3">
                  <label className="block text-xs font-black text-gray-400 mb-1 uppercase tracking-widest">Opções de Frete</label>
                  <button 
                    onClick={() => setShippingMethod('free')}
                    className={`w-full flex items-center justify-between p-4 rounded-2xl border-2 transition-all ${shippingMethod === 'free' ? 'border-primary bg-primary/5' : 'border-gray-100 hover:border-gray-200'}`}
                  >
                    <div className="flex items-center gap-3 text-left">
                      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${shippingMethod === 'free' ? 'border-primary' : 'border-gray-300'}`}>
                        {shippingMethod === 'free' && <div className="w-2.5 h-2.5 bg-primary rounded-full" />}
                      </div>
                      <div>
                        <p className="font-black text-secondary text-sm">FRETE GRÁTIS</p>
                        <p className="text-xs text-gray-500">Entrega em 7 a 10 dias úteis</p>
                      </div>
                    </div>
                    <span className="font-black text-primary text-sm">GRÁTIS</span>
                  </button>

                  <button 
                    onClick={() => setShippingMethod('sedex')}
                    className={`w-full flex items-center justify-between p-4 rounded-2xl border-2 transition-all ${shippingMethod === 'sedex' ? 'border-primary bg-primary/5' : 'border-gray-100 hover:border-gray-200'}`}
                  >
                    <div className="flex items-center gap-3 text-left">
                      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${shippingMethod === 'sedex' ? 'border-primary' : 'border-gray-300'}`}>
                        {shippingMethod === 'sedex' && <div className="w-2.5 h-2.5 bg-primary rounded-full" />}
                      </div>
                      <div>
                        <p className="font-black text-secondary text-sm">FRETE SEDEX</p>
                        <p className="text-xs text-gray-500">Entrega em 2 a 3 dias úteis</p>
                      </div>
                    </div>
                    <span className="font-black text-secondary text-sm">R$ 18,75</span>
                  </button>
                </div>
              )}
            </div>

            {/* Order bumps — antes do pagamento */}
            <div className="bg-gradient-to-br from-primary/5 via-white to-primary/10 rounded-2xl p-5 shadow-sm border border-primary/15">
              <p className="text-[10px] font-black uppercase tracking-widest text-primary mb-1">
                Oferta exclusiva no checkout
              </p>
              <h3 className="text-base font-black text-secondary mb-1 leading-tight">
                Potencialize seus resultados com o Thermagre
              </h3>
              <p className="text-xs text-gray-600 font-medium mb-4">
                Adicione complementos naturais ao seu pedido e pague tudo em um único PIX — o valor é atualizado na hora.
              </p>
              <div className="space-y-3">
                {CHECKOUT_ORDER_BUMPS.map((bump) => {
                  const on = Boolean(selectedBumps[bump.id]);
                  return (
                    <button
                      key={bump.id}
                      type="button"
                      onClick={() => toggleOrderBump(bump.id)}
                      className={`w-full text-left rounded-2xl border-2 transition-all p-3 flex gap-3 items-start ${
                        on ? 'border-primary bg-white shadow-md ring-1 ring-primary/20' : 'border-gray-100 bg-white/80 hover:border-gray-200'
                      }`}
                    >
                      <div
                        className={`mt-0.5 w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 ${
                          on ? 'border-primary bg-primary' : 'border-gray-300 bg-white'
                        }`}
                        aria-hidden
                      >
                        {on && <Check size={12} className="text-white" strokeWidth={3} />}
                      </div>
                      <div className="w-16 h-16 rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-center flex-shrink-0 overflow-hidden">
                        <img src={bump.image} alt={bump.title} className="max-w-full max-h-full object-contain p-1" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 mb-1">
                          <span className="font-black text-secondary text-sm uppercase leading-tight">{bump.title}</span>
                          <span className="font-black text-primary text-sm whitespace-nowrap">
                            R$ {bump.price.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                          </span>
                        </div>
                        <p className="text-[11px] text-gray-600 leading-snug font-medium">{bump.description}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Payment Method */}
            <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
              <div className="flex items-center gap-2.5 mb-5">
                <CreditCard className="text-primary" size={20} />
                <h3 className="text-lg font-black text-secondary italic uppercase tracking-tight">FORMA DE PAGAMENTO</h3>
              </div>
              
              <div className="p-5 rounded-2xl border-2 border-primary bg-white relative overflow-hidden">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-7 h-7 rounded-full border-2 border-primary flex items-center justify-center flex-shrink-0">
                      <div className="w-3.5 h-3.5 rounded-full bg-primary" />
                    </div>
                    <div>
                      <p className="font-black text-secondary text-base">PIX (Aprovação Imediata)</p>
                      <p className="text-primary font-black text-[10px] uppercase tracking-wider">LIBERAÇÃO INSTANTÂNEA DO PEDIDO</p>
                    </div>
                  </div>
                  
                  <div className="hidden sm:flex items-center gap-2 bg-primary/10 border border-primary/20 px-2.5 py-1 rounded-lg">
                    <img src="https://logopng.com.br/logos/pix-106.png" alt="PIX" className="w-3.5 h-3.5 object-contain" />
                    <span className="text-primary font-black text-[10px]">PIX</span>
                  </div>
                </div>
                
                {/* Subtle background icon */}
                <div className="absolute -right-3 -bottom-3 opacity-5 transform -rotate-12">
                  <img src="https://logopng.com.br/logos/pix-106.png" alt="PIX" className="w-20 h-20 object-contain" />
                </div>
              </div>

              <div className="mt-3.5 bg-gray-50 p-3.5 rounded-xl flex items-start gap-2.5 border border-gray-100">
                <Zap size={16} className="text-yellow-500 mt-0.5 flex-shrink-0" />
                <p className="text-[11px] text-gray-500 font-medium leading-relaxed">
                  <span className="font-black text-secondary">DICA:</span> O pagamento via PIX é processado na hora e garante que seu pedido seja enviado ainda hoje.
                </p>
              </div>
            </div>
          </div>

          {/* Right Column: Summary & Button */}
          <div className="space-y-6">
            <div className="bg-white rounded-3xl p-6 lg:p-7 shadow-xl border border-gray-100 lg:sticky lg:top-24">
              <h3 className="text-base font-black text-secondary italic uppercase tracking-tight mb-5 border-b border-gray-100 pb-3">RESUMO DO PEDIDO</h3>
              
              <div className="flex items-center gap-3.5 mb-6">
                <div className="w-16 h-16 bg-gray-50 rounded-xl p-1.5 flex items-center justify-center border border-gray-100 flex-shrink-0">
                  <img src={selectedPlan.img} alt={selectedPlan.name} className="max-h-full object-contain" />
                </div>
                <div>
                  <h4 className="font-black text-secondary text-base uppercase leading-none mb-0.5">{selectedPlan.bottles} {selectedPlan.bottles === 1 ? 'UNIDADE' : 'UNIDADES'}</h4>
                  <p className="text-gray-400 text-xs font-medium">Thermagre — Chá Termogênico Natural</p>
                </div>
              </div>

              <div className="space-y-3 mb-6">
                <div className="flex justify-between text-gray-500 font-medium text-sm">
                  <span>Subtotal ({quantity}x)</span>
                  <span className="text-secondary font-black">R$ {(basePrice * quantity).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                </div>
                <div className="flex justify-between text-gray-500 font-medium text-sm">
                  <span>Frete</span>
                  {shippingMethod === 'free' ? (
                    <span className="text-primary font-black uppercase">GRÁTIS</span>
                  ) : (
                    <span className="text-secondary font-black">R$ {shippingPrice.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                  )}
                </div>
                <div className="flex justify-between text-gray-500 font-medium text-sm">
                  <span>Adicionais</span>
                  <span className="text-secondary font-black">
                    R$ {orderBumpsTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                  </span>
                </div>
                {orderBumpsTotal > 0 && (
                  <ul className="text-[10px] text-gray-500 font-medium space-y-0.5 pl-1 border-l-2 border-primary/30">
                    {CHECKOUT_ORDER_BUMPS.filter((b) => selectedBumps[b.id]).map((b) => (
                      <li key={b.id} className="pl-2">
                        + {b.title}
                      </li>
                    ))}
                  </ul>
                )}
                
                <div className="h-px bg-gray-100 my-5" />
                
                <div className="flex justify-between items-center">
                  <span className="text-lg font-black text-secondary uppercase">TOTAL</span>
                  <span className="text-2xl font-black text-primary italic">R$ {total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                </div>
              </div>

              {pixError && (
                <p className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-center text-xs font-bold text-red-700">
                  {pixError}
                </p>
              )}

              <button 
                type="button"
                onClick={() => void handleFinalizePayment()}
                disabled={pixLoading}
                className="w-full bg-primary text-secondary py-4 rounded-xl font-black text-lg shadow-xl shadow-primary/20 hover:bg-primary-dark active:scale-95 transition-all flex items-center justify-center gap-2 group disabled:opacity-60 disabled:pointer-events-none"
              >
                {pixLoading ? (
                  <>
                    <Loader2 size={22} className="animate-spin" />
                    GERANDO PIX…
                  </>
                ) : (
                  <>
                    FINALIZAR PAGAMENTO
                    <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </main>
    </div>
  );
};

// --- Components ---

const Navbar = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const { hrefWithParams } = useUrlTracking();

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 transition-all duration-300 bg-header shadow-md py-3">
      <div className="container mx-auto px-4 flex justify-between items-center">
        <div className="flex items-center">
          <img 
            src="https://i.ibb.co/S48Y7900/image.png" 
            alt="Thermagre" 
            className="h-8 w-auto object-contain"
            referrerPolicy="no-referrer"
          />
        </div>
        
        <div className="hidden md:flex items-center gap-8">
          <a href={hrefWithParams('#beneficios')} className="font-medium text-sm text-white/80 hover:text-primary transition-colors">Benefícios</a>
          <a href={hrefWithParams('#formula')} className="font-medium text-sm text-white/80 hover:text-primary transition-colors">Fórmula</a>
          <a href={hrefWithParams('#depoimentos')} className="font-medium text-sm text-white/80 hover:text-primary transition-colors">Resultados</a>
          <a href={hrefWithParams('#ofertas')} className="bg-primary text-white px-5 py-1.5 rounded-full font-bold text-sm hover:bg-primary-dark transition-all shadow-lg hover:shadow-primary/30">QUERO ME SENTIR MAIS LEVE</a>
        </div>

        <button className="md:hidden text-primary" onClick={() => setIsMenuOpen(!isMenuOpen)}>
          {isMenuOpen ? <X size={28} /> : <Menu size={28} className="text-primary" />}
        </button>
      </div>

      {/* Mobile Menu */}
      <AnimatePresence>
        {isMenuOpen && (
          <motion.div 
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="md:hidden bg-header border-t border-white/10 overflow-hidden"
          >
            <div className="flex flex-col p-4 gap-4">
              <a href={hrefWithParams('#beneficios')} onClick={() => setIsMenuOpen(false)} className="text-white/80 font-medium text-sm">Benefícios</a>
              <a href={hrefWithParams('#formula')} onClick={() => setIsMenuOpen(false)} className="text-white/80 font-medium text-sm">Fórmula</a>
              <a href={hrefWithParams('#depoimentos')} onClick={() => setIsMenuOpen(false)} className="text-white/80 font-medium text-sm">Resultados</a>
              <a href={hrefWithParams('#ofertas')} onClick={() => setIsMenuOpen(false)} className="bg-primary text-white text-center py-2.5 rounded-lg font-bold text-sm">QUERO ME SENTIR MAIS LEVE</a>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
};

const Hero = () => {
  const { hrefWithParams } = useUrlTracking();

  return (
    <section className="relative min-h-screen flex items-center pt-20 overflow-hidden bg-hero-radial">
      {/* Background elements */}
      <div className="absolute top-0 right-0 w-1/2 h-full bg-primary/10 skew-x-12 transform translate-x-20 z-0 hidden lg:block"></div>
      <div className="absolute -bottom-20 -left-20 w-64 h-64 bg-primary/20 rounded-full blur-3xl"></div>
      
      <div className="container mx-auto px-4 relative z-10">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          <motion.div
            initial={{ opacity: 0, x: -50 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8 }}
            className="text-center lg:text-left"
          >
            <motion.div className="inline-flex items-center gap-2 bg-muted/60 text-primary px-4 py-1 rounded-full text-sm font-bold mb-6 border border-muted">
              <ShieldCheck size={16} />
              CHÁ TERMOGÊNICO NATURAL
            </motion.div>
            <h1 className="text-2xl sm:text-3xl md:text-5xl font-black text-white leading-tight mb-6">
              SUA BARRIGA INCHADA PODE NÃO SER GORDURA — E SIM <span className="text-primary">RETENÇÃO + METABOLISMO LENTO</span>
            </h1>
            <div className="mb-8 flex justify-center lg:justify-start">
              <img 
                src="https://i.ibb.co/spsSmNpD/image.png" 
                alt="Benefícios Thermagre" 
                className="w-full max-w-md rounded-2xl shadow-2xl border border-white/10"
                referrerPolicy="no-referrer"
              />
            </div>
            <p className="text-base sm:text-lg text-gray-300 mb-8 max-w-lg mx-auto lg:mx-0">
              Você não precisa de mais uma dieta radical. O Thermagre é um chá solúvel instantâneo com ativos naturais que auxiliam no desinchaço, combatem a retenção de líquidos e apoiam um metabolismo mais ativo — quente ou frio, em segundos.
            </p>
            
            <div className="flex flex-col sm:flex-row gap-4 justify-center lg:justify-start">
              <a href={hrefWithParams('#ofertas')} className="bg-primary text-white px-8 py-4 rounded-xl font-black text-lg flex items-center justify-center gap-2 whitespace-nowrap shrink-0 hover:bg-primary-dark transition-all shadow-xl shadow-primary/20 group">
                QUERO ME SENTIR MAIS LEVE
                <ArrowRight className="group-hover:translate-x-1 transition-transform" />
              </a>
              <div className="flex items-center gap-3 px-4 py-2">
                <div className="flex -space-x-2">
                  {[
                    'https://randomuser.me/api/portraits/women/44.jpg',
                    'https://randomuser.me/api/portraits/women/68.jpg',
                    'https://randomuser.me/api/portraits/women/32.jpg',
                  ].map((src, i) => (
                    <img
                      key={i}
                      src={src}
                      alt={`Cliente ${i + 1}`}
                      className="h-8 w-8 rounded-full border-2 border-secondary object-cover object-center"
                      referrerPolicy="no-referrer"
                    />
                  ))}
                </div>
                <div className="text-sm">
                  <div className="flex text-yellow-500">
                    {[1,2,3,4,5].map(i => <Star key={i} size={12} fill="currentColor" />)}
                  </div>
                  <span className="text-gray-400">+12.000 pessoas já experimentaram</span>
                </div>
              </div>
            </div>

            <div className="mt-12 grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="flex flex-col items-center sm:items-start gap-1">
                <span className="text-primary font-bold text-xl">100%</span>
                <span className="text-gray-400 text-xs uppercase tracking-wider">Natural</span>
              </div>
              <div className="flex flex-col items-center sm:items-start gap-1">
                <span className="text-primary font-bold text-xl">ANVISA</span>
                <span className="text-gray-400 text-xs uppercase tracking-wider">Aprovado</span>
              </div>
              <div className="flex flex-col items-center sm:items-start gap-1">
                <span className="text-primary font-bold text-xl">FRETE</span>
                <span className="text-gray-400 text-xs uppercase tracking-wider">Grátis*</span>
              </div>
              <div className="flex flex-col items-center sm:items-start gap-1">
                <span className="text-primary font-bold text-xl">30s</span>
                <span className="text-gray-400 text-xs uppercase tracking-wider">Preparo</span>
              </div>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.8, rotate: 5 }}
            animate={{ opacity: 1, scale: 1, rotate: 0 }}
            transition={{ duration: 1, delay: 0.2 }}
            className="relative flex justify-center"
          >
            {/* Floating badges */}
            <motion.div 
              animate={{ y: [0, -10, 0] }}
              transition={{ duration: 3, repeat: Infinity }}
              className="absolute top-10 -left-10 bg-white p-4 rounded-2xl shadow-2xl z-20 hidden md:block"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-primary/20 text-primary rounded-full flex items-center justify-center">
                  <Brain size={20} />
                </div>
                <div>
                  <p className="text-xs text-gray-500 font-bold uppercase">Desinchaço</p>
                  <p className="text-sm font-black text-secondary">Menos Retenção</p>
                </div>
              </div>
            </motion.div>

            <motion.div 
              animate={{ y: [0, 10, 0] }}
              transition={{ duration: 4, repeat: Infinity, delay: 0.5 }}
              className="absolute bottom-20 -right-10 bg-white p-4 rounded-2xl shadow-2xl z-20 hidden md:block"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-primary/20 text-primary rounded-full flex items-center justify-center">
                  <Zap size={20} />
                </div>
                <div>
                  <p className="text-xs text-gray-500 font-bold uppercase">Metabolismo</p>
                  <p className="text-sm font-black text-secondary">Ritmo Ativo</p>
                </div>
              </div>
            </motion.div>

            <div className="relative">
              <div className="absolute inset-0 bg-primary/20 rounded-full blur-3xl transform scale-150"></div>
              <img 
                src="https://i.ibb.co/RkShXTMh/image.png" 
                alt="Thermagre Chá Termogênico" 
                className="relative z-10 w-full max-w-md rounded-3xl shadow-2xl border border-white/10"
                referrerPolicy="no-referrer"
              />
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
};

const Benefits = () => {
  const iconClass = "text-primary";
  const iconProps = { size: 28, strokeWidth: 1.75, className: iconClass };

  const benefits = [
    {
      icon: <Droplets {...iconProps} />,
      title: "REDUZIR O INCHAÇO",
      desc: "Sinta a diferença já nos primeiros dias de uso.",
    },
    {
      icon: <Zap {...iconProps} />,
      title: "COMBATER A RETENÇÃO",
      desc: "Elimine o excesso de líquidos acumulados.",
    },
    {
      icon: <Flame {...iconProps} />,
      title: "ACELERAR O METABOLISMO",
      desc: "Queime calorias de forma mais eficiente.",
    },
    {
      icon: <Star {...iconProps} />,
      title: "DIMINUIR A FOME",
      desc: "Aumente a saciedade e controle o apetite.",
    },
    {
      icon: <Zap {...iconProps} />,
      title: "QUEIMA DE GORDURA",
      desc: "Estimule seu corpo a usar gordura como energia.",
    },
    {
      icon: <ShieldCheck {...iconProps} />,
      title: "EFEITO DETOX",
      desc: "Desintoxique seu organismo de dentro pra fora.",
    },
  ];

  return (
    <section id="beneficios" className="py-24 bg-black">
      <div className="container mx-auto px-4">
        <div className="text-center max-w-4xl mx-auto mb-14">
          <p className="text-primary font-black tracking-[0.2em] text-xs sm:text-sm mb-5 uppercase">
            A SOLUÇÃO
          </p>
          <h2 className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-black text-white uppercase leading-tight mb-6">
            O <span className="text-primary">THERMAGRE</span> FOI CRIADO EXATAMENTE PRA ISSO
          </h2>
          <div className="mx-auto mb-6 h-1 w-16 rounded-full bg-primary" aria-hidden />
          <p className="text-base sm:text-lg text-gray-500 max-w-2xl mx-auto leading-relaxed">
            Um chá instantâneo poderoso com 11 ingredientes naturais que trabalham juntos pra transformar seu corpo.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5 max-w-6xl mx-auto">
          {benefits.map((b, i) => (
            <motion.div
              key={i}
              whileHover={{ y: -4 }}
              className="rounded-2xl bg-[#121212] p-6 sm:p-8 text-left border border-white/5 transition-colors hover:border-primary/20"
            >
              <div className="mb-5">{b.icon}</div>
              <h4 className="text-base sm:text-lg font-black text-white uppercase tracking-wide mb-3">
                {b.title}
              </h4>
              <p className="text-sm sm:text-base text-gray-500 leading-relaxed">{b.desc}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

const Formula = () => {
  const ingredients = [
    { title: 'HIBISCO E GUARANÁ', text: 'Auxiliam nas dietas de restrições calóricas e inibem a fome.' },
    { title: 'CAPIM LIMÃO', text: 'Fonte de vitaminas A, C e complexo B, rico em Magnésio, Zinco e Ferro.' },
    { title: 'PIMENTA E GENGIBRE', text: 'Propriedades termogênicas e diuréticas que aceleram o metabolismo.' },
    { title: 'CARQUEJA E FRAMBOESA', text: 'Melhoram a digestão e combatem radicais livres.' },
    { title: 'CHÁ VERDE', text: 'Auxilia na absorção de gorduras e emagrecimento saudável.' },
    { title: 'ESTÉVIA E CITRUS AURANTIUM', text: 'Reguladora de apetite e auxilia na saciedade.' },
  ];

  return (
    <section id="formula" className="py-24 bg-black">
      <div className="container mx-auto px-4">
        <div className="text-center max-w-4xl mx-auto mb-14">
          <h2 className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-black text-white uppercase leading-tight mb-5">
            A CIÊNCIA POR TRÁS DA <span className="text-primary">FÓRMULA</span>
          </h2>
          <p className="text-xs sm:text-sm font-medium tracking-[0.2em] text-gray-500 uppercase mb-6">
            11 INGREDIENTES NATURAIS SELECIONADOS
          </p>
          <div className="mx-auto h-1 w-16 rounded-full bg-primary" aria-hidden />
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5 max-w-6xl mx-auto">
          {ingredients.map((item, i) => (
            <motion.div
              key={i}
              whileHover={{ y: -4 }}
              className="rounded-2xl bg-[#121212] p-6 sm:p-8 text-left border border-white/5 transition-colors hover:border-primary/20"
            >
              <div className="mb-4 h-1 w-10 rounded-full bg-primary" aria-hidden />
              <h4 className="text-sm sm:text-base font-black text-primary uppercase tracking-wide mb-3">
                {item.title}
              </h4>
              <p className="text-sm sm:text-base text-gray-500 leading-relaxed">{item.text}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

const Pricing = ({ onSelectPlan }: { onSelectPlan: (plan: any) => void }) => {
  const plans = [
    {
      bottles: 1,
      name: "KIT ESSENCIAL",
      price: "39,90",
      installments: "30 dias de uso (1 mês)",
      discount: "0%",
      popular: false,
      shipping: "Frete Pago",
      cta: "EXPERIMENTAR THERMAGRE",
      img: "https://i.ibb.co/n8NgMnZJ/image.png"
    },
    {
      bottles: 2,
      name: "KIT ECONOMIA",
      price: "59,90",
      installments: "60 dias de uso (2 meses)",
      discount: "25% OFF",
      popular: false,
      shipping: "Frete Grátis",
      cta: "QUERO ME SENTIR MAIS LEVE",
      img: "https://i.ibb.co/JWNPFBQR/image.png"
    },
    {
      bottles: 3,
      name: "KIT MAIS VENDIDO",
      price: "69,90",
      installments: "90 dias de uso (3 meses)",
      discount: "40% OFF",
      popular: true,
      shipping: "Frete Grátis",
      cta: "ATIVAR MEU METABOLISMO",
      img: "https://i.ibb.co/WNgwnwLF/image.png"
    }
  ];

  return (
    <section id="ofertas" className="py-24 bg-secondary/5">
      <div className="container mx-auto px-4">
        <div className="flex justify-center mb-12 max-w-4xl mx-auto">
          <img
            src="https://i.ibb.co/Y4Grt88c/image.png"
            alt="Ofertas Thermagre"
            className="w-full h-auto rounded-3xl shadow-xl"
            referrerPolicy="no-referrer"
          />
        </div>

        <div className="text-center max-w-3xl mx-auto mb-16">
          <h2 className="text-primary font-black tracking-widest text-sm mb-4 uppercase">OFERTAS EXCLUSIVAS</h2>
          <h3 className="text-2xl sm:text-3xl md:text-5xl font-black text-secondary mb-6">ESCOLHA O MELHOR KIT PARA VOCÊ</h3>
          <p className="text-gray-600 text-lg">Quanto mais unidades, maior a economia. O kit de 3 unidades é o mais escolhido — <span className="font-bold text-secondary">restam poucas unidades neste lote promocional com frete grátis.</span></p>
        </div>

        <div className="grid md:grid-cols-3 gap-8 max-w-6xl mx-auto">
          {plans.map((p, i) => (
            <motion.div 
              key={i}
              whileHover={{ y: -10 }}
              className={`relative bg-white rounded-[40px] p-8 shadow-xl border-2 transition-all ${p.popular ? 'border-primary scale-105 z-10' : 'border-transparent'}`}
            >
              {p.popular && (
                <div className="absolute -top-5 left-1/2 transform -translate-x-1/2 bg-primary text-white px-6 py-1 rounded-full text-sm font-black shadow-lg">
                  MAIS VENDIDO
                </div>
              )}
              
              <div className="text-center mb-8">
                <span className="inline-block bg-gray-100 text-gray-500 px-4 py-1 rounded-full text-xs font-bold mb-4">{p.name}</span>
                <h4 className="text-2xl font-black text-secondary mb-2">{p.bottles} {p.bottles === 1 ? 'UNIDADE' : 'UNIDADES'}</h4>
                <div className="flex justify-center items-center gap-2 mb-4">
                  <span className="text-primary font-black text-4xl">R$ {p.price}</span>
                  <span className="bg-primary/15 text-primary px-2 py-1 rounded-lg text-xs font-bold">{p.discount}</span>
                </div>
                <p className="text-gray-500 font-medium">{p.installments}</p>
              </div>

              <div className="flex justify-center mb-8">
                <img 
                  src={p.img} 
                  alt={`${p.bottles} unidades Thermagre`} 
                  className={`object-contain transition-transform drop-shadow-2xl ${p.bottles === 3 ? 'h-60 scale-110' : p.bottles === 2 ? 'h-52' : 'h-56 scale-110'}`}
                  referrerPolicy="no-referrer"
                />
              </div>

              <ul className="space-y-4 mb-8">
                <li className="flex items-center gap-3 text-sm font-medium text-gray-600">
                  <CheckCircle2 className="text-primary" size={18} />
                  {p.bottles * 30} dias de Thermagre
                </li>
                <li className="flex items-center gap-3 text-sm font-medium text-gray-600">
                  <CheckCircle2 className="text-primary" size={18} />
                  Preparo quente ou frio em segundos
                </li>
                <li className="flex items-center gap-3 text-sm font-medium text-gray-600">
                  <CheckCircle2 className="text-primary" size={18} />
                  {p.shipping}
                </li>
                <li className="flex items-center gap-3 text-sm font-medium text-gray-600">
                  <CheckCircle2 className="text-primary" size={18} />
                  Garantia de 30 dias
                </li>
              </ul>

              <button 
                onClick={() => onSelectPlan(p)}
                className="w-full py-4 rounded-2xl font-black text-lg shadow-lg transition-all bg-primary text-secondary hover:bg-primary-dark shadow-primary/20"
              >
                {p.cta}
              </button>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

const ProductReviews = () => {
  const [videoPopupSrc, setVideoPopupSrc] = useState<string | null>(null);
  const popupVideoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!videoPopupSrc) return;
    const el = popupVideoRef.current;
    if (el) el.play().catch(() => {});
  }, [videoPopupSrc]);

  const marketplaceReviews = [
    {
      name: 'Juliana Silva',
      date: '2026-04-10 15:42',
      badges: ['Parecido com anúncio: parece ser muito bom', 'Custo-benefício: vale a pena'],
      text: 'Chegou tudo bem embalado e parece ser de ótima qualidade! Já tomo há duas semanas e sinto menos inchaço no fim do dia.',
      media: [
        {
          type: 'video' as const,
          src: 'https://down-ws-br.vod.susercontent.com/api/v4/11110103/mms/br-11110103-6kfko-m09lsf6hq25lf7.16000051726539757.mp4',
        },
        {
          type: 'image' as const,
          src: 'https://down-br.img.susercontent.com/file/br-11134103-7r98o-m09ixgt5mjxj04.webp',
        },
      ],
    },
    {
      name: 'Carla Mendes',
      date: '2026-04-08 09:18',
      badges: ['Entrega rápida', 'Produto original'],
      text: 'Dissolvo gelado de manhã e é super prático. A embalagem veio lacrada e o sabor é leve, não aquele chá amargo de farmácia.',
      media: [
        {
          type: 'image' as const,
          src: 'https://down-br.img.susercontent.com/file/br-11134103-7r98o-lzmkk89g7zmt01.webp',
        },
        {
          type: 'image' as const,
          src: 'https://down-br.img.susercontent.com/file/br-11134103-7r98o-lzmkk89g6l2d05.webp',
        },
      ],
    },
    {
      name: 'Fernanda Alves',
      date: '2026-04-05 20:31',
      badges: ['Custo-benefício: vale a pena'],
      text: 'Comprei o kit de 3 e valeu muito. Em um mês notei a calça fechando melhor. Recomendo para quem sofre com retenção.',
      media: [
        {
          type: 'video' as const,
          src: 'https://down-ws-br.vod.susercontent.com/api/v4/11110103/mms/br-11110103-6kfkp-m26nohkkub1t44.16000051730719788.mp4',
        },
      ],
    },
    {
      name: 'Patrícia Santos',
      date: '2026-04-02 11:07',
      badges: ['Parecido com anúncio', 'Frete grátis'],
      text: 'Chegou rápido e bem embalado. Tomo antes do almoço e sinto mais disposição sem ficar agitada demais.',
      media: [
        {
          type: 'video' as const,
          src: 'https://down-zl-br.vod.susercontent.com/api/v4/11110103/mms/br-11110103-6kfko-m2dw5e1kasiee5.16000051731157772.mp4',
        },
        {
          type: 'image' as const,
          src: 'https://down-br.img.susercontent.com/file/br-11134103-7r98o-m2dw2i3et1dy18.webp',
        },
        {
          type: 'image' as const,
          src: 'https://down-br.img.susercontent.com/file/br-11134103-7r98o-m2dw2i3eufyefe.webp',
        },
      ],
    },
  ];

  return (
    <section id="avaliacoes" className="bg-black py-12 sm:py-16">
      <div className="container mx-auto max-w-3xl px-4">
        <div className="border-b border-white/10 pb-6">
          <h2 className="mb-3 text-base font-bold text-white sm:text-lg">
            Thermagre Chá Instantâneo 140g — Nutrilibrium
          </h2>
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <span className="text-2xl font-bold text-amber-400">4.9</span>
            <div className="flex gap-0.5 text-amber-400">
              {[1, 2, 3, 4, 5].map((s) => (
                <Star key={s} size={18} fill="currentColor" strokeWidth={0} />
              ))}
            </div>
            <span className="hidden h-4 w-px bg-gray-600 sm:block" aria-hidden />
            <span className="text-sm text-gray-400">5,8mil Avaliações</span>
          </div>
        </div>

        <div className="divide-y divide-white/10">
          {marketplaceReviews.map((review, i) => (
            <article key={i} className="py-6">
              <div className="flex gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gray-700/80">
                  <User size={20} className="text-gray-400" strokeWidth={1.75} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-white">{review.name}</p>
                  <div className="mt-0.5 flex gap-0.5 text-amber-400">
                    {[1, 2, 3, 4, 5].map((s) => (
                      <Star key={s} size={12} fill="currentColor" strokeWidth={0} />
                    ))}
                  </div>
                  <p className="mt-1 text-xs text-gray-500">{review.date}</p>

                  {review.badges.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {review.badges.map((badge) => (
                        <span
                          key={badge}
                          className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] text-gray-300"
                        >
                          {badge}
                        </span>
                      ))}
                    </div>
                  )}

                  <p className="mt-3 text-sm leading-relaxed text-gray-200">{review.text}</p>

                  {review.media.length > 0 && (
                    <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                      {review.media.map((item, j) => (
                        <div
                          key={j}
                          className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-gray-800 sm:h-20 sm:w-20"
                        >
                          {item.type === 'video' ? (
                            <button
                              type="button"
                              onClick={() => setVideoPopupSrc(item.src)}
                              className="relative h-full w-full cursor-pointer"
                              aria-label="Reproduzir vídeo da avaliação"
                            >
                              <video
                                src={item.src}
                                className="pointer-events-none h-full w-full object-cover"
                                muted
                                playsInline
                                preload="metadata"
                              />
                              <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/25">
                                <Play size={22} className="text-white" fill="white" />
                              </div>
                            </button>
                          ) : (
                            <img
                              src={item.src}
                              alt=""
                              className="h-full w-full object-cover"
                              referrerPolicy="no-referrer"
                            />
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>

      <AnimatePresence>
        {videoPopupSrc && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-4"
            onClick={() => setVideoPopupSrc(null)}
          >
            <motion.div
              initial={{ scale: 0.92, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.92, opacity: 0 }}
              className="relative w-full max-w-lg"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => setVideoPopupSrc(null)}
                className="absolute -right-2 -top-2 z-10 rounded-full bg-white/15 p-2 text-white hover:bg-white/25 transition-colors"
                aria-label="Fechar vídeo"
              >
                <X size={22} />
              </button>
              <video
                ref={popupVideoRef}
                src={videoPopupSrc}
                controls
                playsInline
                className="w-full max-h-[85vh] rounded-xl bg-black"
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
};

const Testimonials = () => {
  const reviews = [
    {
      name: "ANA PAULA",
      text: "Eu achava que era gordura na barriga, mas era retenção. Em duas semanas com o Thermagre senti a calça fechar melhor e acordei com muito menos inchaço.",
      img: "https://i.ibb.co/BK2njLvv/image.png",
    },
    {
      name: "CARLA MENDES",
      text: "Trabalho em pé o dia inteiro e sempre terminava o turno inchada. Hoje me sinto mais leve e a digestão melhorou muito.",
      img: "https://i.ibb.co/G3MYr4xM/image.png",
    },
    {
      name: "JULIANA COSTA",
      text: "O chá é prático — dissolvo no escritório — e sinto mais disposição e menos fome entre as refeições. Resultado visível no espelho.",
      img: "https://i.ibb.co/XrtbWN52/image.png",
    },
    {
      name: "FERNANDA ALVES",
      text: "Tomo gelado antes do almoço e em menos de um mês notei a barriga mais plana. Não precisei de dieta radical.",
      img: "https://i.ibb.co/DgSy7PZK/image.png",
    },
    {
      name: "MARCOS OLIVEIRA",
      text: "Já tentei de tudo. O que mudou foi entender que meu metabolismo estava lento. O Thermagre virou parte da minha rotina.",
      img: "https://i.ibb.co/dsY31ngY/image.png",
    },
    {
      name: "PATRÍCIA SANTOS",
      text: "Finalmente consigo manter constância sem rotina impossível. Menos inchaço, mais energia e autoestima renovada.",
      img: "https://i.ibb.co/kY5SwnL/image.png",
    },
  ];

  return (
    <section id="depoimentos" className="py-24 bg-secondary">
      <div className="container mx-auto px-4">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <h2 className="text-primary font-black tracking-widest text-sm mb-4 uppercase">RESULTADOS REAIS</h2>
          <h3 className="text-2xl sm:text-3xl md:text-5xl font-black text-white mb-6">QUEM USOU, SENTIU A DIFERENÇA</h3>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8">
          {reviews.map((r, i) => (
            <motion.div
              key={i}
              whileHover={{ y: -6 }}
              className="flex flex-col overflow-hidden rounded-3xl bg-[#121212] border border-white/5 shadow-2xl"
            >
              <div className="relative aspect-[4/3] overflow-hidden">
                <img
                  src={r.img}
                  alt={`Antes e depois — ${r.name}`}
                  className="h-full w-full object-cover object-top"
                  referrerPolicy="no-referrer"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black via-black/50 to-transparent" />
                <div className="absolute bottom-0 left-0 right-0 p-4">
                  <div className="mb-2 flex gap-0.5 text-primary">
                    {[1, 2, 3, 4, 5].map((s) => (
                      <Star key={s} size={14} fill="currentColor" strokeWidth={0} />
                    ))}
                  </div>
                  <p className="text-sm font-black uppercase tracking-wide text-white sm:text-base">{r.name}</p>
                </div>
              </div>

              <p className="flex-1 px-5 pt-5 text-sm italic leading-relaxed text-white/90">
                &ldquo;{r.text}&rdquo;
              </p>

              <div className="flex items-center gap-2 px-5 pb-5 pt-4">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary">
                  <Check size={12} className="text-secondary" strokeWidth={3} />
                </span>
                <span className="text-[10px] font-black uppercase tracking-wider text-primary sm:text-xs">
                  Resultado Verificado
                </span>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

const Guarantee = () => {
  return (
    <section className="py-24 bg-white">
      <div className="container mx-auto px-4">
        <div className="max-w-5xl mx-auto bg-gray-50 rounded-3xl md:rounded-[50px] p-6 md:p-16 flex flex-col items-center gap-8 border border-gray-100 text-center relative overflow-hidden">
          {/* Decorative background element */}
          <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 rounded-full -translate-y-1/2 translate-x-1/2"></div>
          
          <div className="relative z-10 max-w-3xl">
            <div className="inline-flex items-center gap-2 bg-primary/10 text-primary px-4 py-1 rounded-full text-xs font-black mb-4 uppercase tracking-widest">
              Garantia de Satisfação
            </div>
            <h3 className="text-2xl sm:text-3xl md:text-5xl font-black text-secondary mb-6 leading-tight">
              RISCO ZERO: <span className="text-primary">30 DIAS</span> DE GARANTIA TOTAL
            </h3>
            <p className="text-gray-600 text-base md:text-xl mb-8 leading-relaxed">
              Temos tanta confiança no <span className="font-bold text-secondary">Thermagre</span> que o risco é todo nosso. Se em até 30 dias você não sentir mais leveza, menos inchaço ou apoio real na sua rotina, basta nos enviar um e-mail. 
              <span className="block mt-4 font-bold text-secondary">Devolvemos 100% do seu investimento. Sem perguntas, sem letras miúdas.</span>
            </p>
            <div className="flex flex-wrap justify-center md:justify-start gap-6">
              <div className="flex items-center gap-3 text-secondary font-black bg-white px-6 py-3 rounded-2xl shadow-sm border border-gray-100">
                <ShieldCheck className="text-primary" size={24} />
                Compra 100% Segura
              </div>
              <div className="flex items-center gap-3 text-secondary font-black bg-white px-6 py-3 rounded-2xl shadow-sm border border-gray-100">
                <Lock className="text-primary" size={24} />
                Privacidade Protegida
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

const FAQ = () => {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  const questions = [
    {
      q: "Como preparo o Thermagre?",
      a: "Dissolva 1 colher (ou a medida indicada na embalagem) em 200 ml de água quente ou fria. Mexa bem e consuma. Pode tomar pela manhã ou antes das refeições principais."
    },
    {
      q: "Em quanto tempo posso sentir diferença?",
      a: "Muitas pessoas relatam sensação de leveza e menos inchaço nas primeiras 2 a 4 semanas de uso contínuo. Os resultados variam conforme alimentação, hidratação e rotina de cada pessoa."
    },
    {
      q: "O Thermagre substitui dieta e exercícios?",
      a: "Não. É um suplemento natural que auxilia no desinchaço, na retenção e no metabolismo. Funciona melhor aliado a hábitos saudáveis, sem exigir rotinas extremas."
    },
    {
      q: "Gestantes e lactantes podem consumir?",
      a: "Não recomendamos sem orientação médica. Gestantes, lactantes, menores de 18 anos e pessoas com condições de saúde devem consultar um profissional antes de usar."
    },
    {
      q: "O produto é registrado na ANVISA?",
      a: "Sim. O Thermagre é produzido seguindo as normas da ANVISA para suplementos alimentares, com controle de qualidade em todas as etapas."
    }
  ];

  return (
    <section className="py-24 bg-gray-50">
      <div className="container mx-auto px-4 max-w-3xl">
        <div className="text-center mb-16">
          <h3 className="text-2xl sm:text-3xl md:text-5xl font-black text-secondary mb-6">DÚVIDAS FREQUENTES</h3>
        </div>

        <div className="space-y-4">
          {questions.map((item, i) => (
            <div key={i} className="bg-white rounded-2xl overflow-hidden shadow-sm border border-gray-100">
              <button 
                className="w-full p-6 text-left flex justify-between items-center hover:bg-gray-50 transition-colors"
                onClick={() => setOpenIndex(openIndex === i ? null : i)}
              >
                <span className="font-bold text-secondary">{item.q}</span>
                <ChevronDown className={`text-primary transition-transform ${openIndex === i ? 'rotate-180' : ''}`} />
              </button>
              <AnimatePresence>
                {openIndex === i && (
                  <motion.div 
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="p-6 pt-0 text-gray-600 border-t border-gray-50">
                      {item.a}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

const Footer = () => {
  const { hrefWithParams } = useUrlTracking();

  return (
    <footer className="bg-secondary text-white pt-20 pb-10">
      <div className="container mx-auto px-4">
        <div className="grid md:grid-cols-4 gap-12 mb-16">
          <div className="col-span-2">
            <div className="flex items-center mb-6">
              <img 
                src="https://i.ibb.co/S48Y7900/image.png" 
                alt="Thermagre" 
                className="h-14 w-auto object-contain"
                referrerPolicy="no-referrer"
              />
            </div>
            <p className="text-gray-400 max-w-md mb-8">
              O Thermagre é um chá termogênico solúvel instantâneo com ativos natuais selecionados para quem busca desinchar, combater a retenção e apoiar o metabolismo com praticidade no dia a dia.
            </p>
            <div className="flex gap-4">
              <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center hover:bg-primary transition-colors cursor-pointer">
                <Star size={20} />
              </div>
              <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center hover:bg-primary transition-colors cursor-pointer">
                <Star size={20} />
              </div>
              <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center hover:bg-primary transition-colors cursor-pointer">
                <Star size={20} />
              </div>
            </div>
          </div>
          
          <div>
            <h4 className="font-bold mb-6">Links Úteis</h4>
            <ul className="space-y-4 text-gray-400">
              <li><a href={hrefWithParams('#beneficios')} className="hover:text-primary transition-colors">Benefícios</a></li>
              <li><a href={hrefWithParams('#formula')} className="hover:text-primary transition-colors">Fórmula</a></li>
              <li><a href={hrefWithParams('#ofertas')} className="hover:text-primary transition-colors">Ofertas</a></li>
              <li><a href={hrefWithParams('#')} className="hover:text-primary transition-colors">Rastrear Pedido</a></li>
            </ul>
          </div>

          <div>
            <h4 className="font-bold mb-6">Atendimento</h4>
            <ul className="space-y-4 text-gray-400">
              <li className="flex items-center gap-3">
                <Clock size={16} className="text-primary" />
                Seg a Sex: 09h às 18h
              </li>
              <li className="flex items-center gap-3">
                <Truck size={16} className="text-primary" />
                Envio para todo Brasil
              </li>
              <li className="flex items-center gap-3">
                <ShieldCheck size={16} className="text-primary" />
                Compra 100% Segura
              </li>
            </ul>
          </div>
        </div>

        <div className="border-t border-white/10 pt-10 text-center text-xs text-gray-500 space-y-4">
          <p>Copyright © 2026 THERMAGRE - Todos os direitos reservados.</p>
          <p className="max-w-4xl mx-auto">
            AVISO LEGAL: As informações contidas neste site não substituem o aconselhamento médico profissional. Sempre consulte seu médico antes de iniciar qualquer suplementação. Os resultados podem variar de pessoa para pessoa. Este produto não se destina a diagnosticar, tratar, curar ou prevenir qualquer doença.
          </p>
        </div>
      </div>
    </footer>
  );
};

// --- Main App ---

export default function App() {
  const [currentPage, setCurrentPage] = useState<'landing' | 'checkout'>('landing');
  const [selectedPlan, setSelectedPlan] = useState<any>(null);

  const handleSelectPlan = (plan: any) => {
    setSelectedPlan(plan);
    setCurrentPage('checkout');
    window.scrollTo(0, 0);
  };

  if (currentPage === 'checkout') {
    return <Checkout selectedPlan={selectedPlan} onBack={() => setCurrentPage('landing')} />;
  }

  return (
    <div className="min-h-screen selection:bg-primary selection:text-white">
      <Navbar />
      <main>
        <Hero />
        
        {/* Trust Bar */}
        <div className="bg-primary py-6 overflow-hidden">
          <div className="flex whitespace-nowrap animate-marquee">
            {[1,2,3,4,5,6,7,8].map(i => (
              <div key={i} className="flex items-center gap-8 mx-8 text-white font-black text-sm uppercase tracking-widest">
                <Star size={16} fill="white" />
                FRETE GRÁTIS PARA TODO BRASIL
                <Star size={16} fill="white" />
                CHÁ TERMOGÊNICO NATURAL — PREPARO EM 30 SEGUNDOS
                <Star size={16} fill="white" />
                SATISFAÇÃO GARANTIDA OU SEU DINHEIRO DE VOLTA
              </div>
            ))}
          </div>
        </div>

        <Benefits />
        
        {/* Nutritional Table */}
        <section className="py-16 bg-white">
          <div className="container mx-auto px-4 flex justify-center">
            <div className="max-w-4xl w-full">
              <h3 className="text-2xl sm:text-3xl md:text-5xl font-black text-secondary mb-12 text-center uppercase">INFORMAÇÃO NUTRICIONAL</h3>
              <img 
                src="https://i.ibb.co/B27TKs32/image.png" 
                alt="Informação Nutricional Thermagre" 
                className="w-full h-auto rounded-3xl shadow-xl"
                referrerPolicy="no-referrer"
              />
            </div>
          </div>
        </section>

        <Formula />

        <Testimonials />
        <Pricing onSelectPlan={handleSelectPlan} />
        <ProductReviews />
        <Guarantee />
        <FAQ />
      </main>
      <Footer />

      {/* Custom styles for marquee */}
      <style>{`
        @keyframes marquee {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .animate-marquee {
          animation: marquee 30s linear infinite;
        }
      `}</style>
    </div>
  );
}
