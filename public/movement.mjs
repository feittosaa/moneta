// Bank descriptions sometimes identify the operation more precisely than the provider category.
export function investmentCategory(tx) {
  const text = (tx.description || '').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();
  if (/^(irrf|ir|iof|imposto|taxa|tarifa)\b.*\b(resgate|aplicacao|investimento)/.test(text)) return 'Impostos & Taxas';
  if (/^(juros (?:sobre capital|de aplicacao)|rendimento[s]?|dividendo[s]?)\b/.test(text)) return 'Rendimentos';
  if (/^(same person transfer|transfer between own accounts)$/i.test(tx.providerCategory) ||
      /\btransferencia (recebida da|enviada para a) conta (investimento|digital)\b/.test(text)) return 'Transferência interna';
  if (/^(investments|automatic investment|fixed income|mutual funds)$/i.test(tx.providerCategory) ||
      /\b(resgate|aplicacao) (?:de |do |da )?(investimento|aplicacao|cdb|fundo|tesouro|lci|lca|apl |res aplic)/.test(text)) return 'Movimentação de investimentos';
  return null;
}
