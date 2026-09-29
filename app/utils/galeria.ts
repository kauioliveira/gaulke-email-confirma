import type { Bloco } from '~~/shared/types/blocos'
import { RODAPE_TEXTO_PADRAO, RODAPE_TEXTO_SEM_ARQUIVO } from '~~/shared/types/blocos'
import { blocosPadraoCliente, blocosComunicadoCliente } from './blocos'

/**
 * Galeria de modelos prontos, por setor.
 *
 * É o "ponto de partida" do assistente de templates: começar de um texto bem
 * escrito é mais fácil do que da página em branco. Fica no código (e não no
 * banco) de propósito: são sugestões, não templates — escolher um cria um
 * template NOVO, que a pessoa edita à vontade sem mexer no modelo.
 *
 * Todo texto usa as variáveis de sempre ({{nome}}, {{empresa}}...), e o
 * rodapé segue o tipo: com download para documento, sem para comunicado.
 */

export type ModeloGaleria = {
  id: string
  titulo: string
  setor: 'Geral' | 'Fiscal' | 'DP' | 'Contábil' | 'Societário'
  tipo: TipoTemplate
  descricao: string
  assunto: string
  blocos: () => Bloco[]
}

const id = (s: string) => `b-${s}-${Math.random().toString(36).slice(2, 7)}`

/** Documento: saudação, texto, botão, código e rodapé com download. */
function documento(titulo: string, paragrafos: string[], aviso?: string): Bloco[] {
  return [
    { id: id('logo'), tipo: 'logo', alinhamento: 'centro' },
    { id: id('saud'), tipo: 'titulo', texto: 'Olá, {{nome}}!' },
    ...paragrafos.map(texto => ({ id: id('txt'), tipo: 'texto' as const, texto, alinhamento: 'justificado' as const })),
    ...(aviso ? [{ id: id('aviso'), tipo: 'aviso' as const, texto: aviso, cor: 'atencao' as const, alinhamento: 'justificado' as const }] : []),
    { id: id('botao'), tipo: 'botao', texto: titulo },
    {
      id: id('cod'),
      tipo: 'codigo',
      rotulo: 'Código de referência',
      ajuda: 'Informe este código caso precise falar com a nossa equipe.'
    },
    { id: id('rod'), tipo: 'rodape', texto: RODAPE_TEXTO_PADRAO }
  ]
}

/** Comunicado: aviso sem arquivo; botão "Confirmar recebimento" é a prova. */
function comunicado(paragrafos: string[], aviso?: string, comConfirmacao = true): Bloco[] {
  return [
    { id: id('logo'), tipo: 'logo', alinhamento: 'centro' },
    { id: id('saud'), tipo: 'titulo', texto: 'Olá, {{nome}}!' },
    ...paragrafos.map(texto => ({ id: id('txt'), tipo: 'texto' as const, texto, alinhamento: 'justificado' as const })),
    ...(aviso ? [{ id: id('aviso'), tipo: 'aviso' as const, texto: aviso, cor: 'atencao' as const, alinhamento: 'justificado' as const }] : []),
    ...(comConfirmacao ? [{ id: id('botao'), tipo: 'botao' as const, texto: 'Confirmar recebimento' }] : []),
    { id: id('rod'), tipo: 'rodape', texto: RODAPE_TEXTO_SEM_ARQUIVO }
  ]
}

export const GALERIA: ModeloGaleria[] = [
  {
    id: 'doc-guia',
    titulo: 'Guia de impostos disponível',
    setor: 'Fiscal',
    tipo: 'documento',
    descricao: 'Guia de pagamento (DAS, DARF, GPS…) para o cliente baixar.',
    assunto: 'Guia de pagamento disponível{{#empresa}} — {{empresa}}{{/empresa}}',
    blocos: () =>
      documento(
        'Acessar a guia',
        [
          'Disponibilizamos a guia de pagamento{{#empresa}} referente a {{empresa}}{{/empresa}}. O acesso é individual e está vinculado a este e-mail.',
          'Clique no botão abaixo para visualizar, confirmar o recebimento e baixar o arquivo.'
        ],
        'Atenção ao vencimento: o pagamento após a data indicada na guia gera multa e juros.'
      )
  },
  {
    id: 'doc-folha',
    titulo: 'Folha de pagamento e holerites',
    setor: 'DP',
    tipo: 'documento',
    descricao: 'Documentos da folha do mês (holerites, resumo, encargos).',
    assunto: 'Documentos da folha de pagamento disponíveis{{#empresa}} — {{empresa}}{{/empresa}}',
    blocos: () =>
      documento('Acessar os documentos', [
        'Os documentos da folha de pagamento{{#empresa}} de {{empresa}}{{/empresa}} já estão disponíveis.',
        'Pelo botão abaixo você visualiza, confirma o recebimento e baixa os arquivos. Qualquer divergência, responda este e-mail.'
      ])
  },
  {
    id: 'doc-contabil',
    titulo: 'Balancete e demonstrações',
    setor: 'Contábil',
    tipo: 'documento',
    descricao: 'Balancete, DRE ou demonstrações contábeis do período.',
    assunto: 'Demonstrações contábeis disponíveis{{#empresa}} — {{empresa}}{{/empresa}}',
    blocos: () =>
      documento('Acessar as demonstrações', [
        'Concluímos as demonstrações contábeis do período{{#empresa}} de {{empresa}}{{/empresa}} e elas já estão disponíveis para a sua análise.',
        'Recomendamos a leitura com atenção. Ficamos à disposição para esclarecer qualquer ponto.'
      ])
  },
  {
    id: 'doc-societario',
    titulo: 'Documento societário para análise',
    setor: 'Societário',
    tipo: 'documento',
    descricao: 'Contrato social, alteração contratual ou ata para o cliente revisar.',
    assunto: 'Documento para sua análise{{#empresa}} — {{empresa}}{{/empresa}}',
    blocos: () =>
      documento(
        'Acessar o documento',
        [
          'Encaminhamos o documento societário{{#empresa}} de {{empresa}}{{/empresa}} para a sua análise.',
          'Leia com atenção e, se estiver de acordo, confirme o recebimento pela página. Caso precise de ajustes, responda este e-mail indicando os pontos.'
        ],
        'Após a sua confirmação, damos andamento ao registro nos órgãos competentes.'
      )
  },
  {
    id: 'com-expediente',
    titulo: 'Aviso de expediente ou feriado',
    setor: 'Geral',
    tipo: 'comunicado',
    descricao: 'Horário especial, feriado ou recesso do escritório.',
    assunto: 'Aviso de expediente — Contábil Gaulke',
    blocos: () =>
      comunicado(
        [
          'Informamos que, em razão do feriado, o escritório não terá expediente na data indicada abaixo.',
          'Os atendimentos voltam normalmente no próximo dia útil. Demandas urgentes podem ser enviadas por e-mail.'
        ],
        'Data: preencha aqui a data e o horário de retorno.',
        false
      )
  },
  {
    id: 'com-prazo-docs',
    titulo: 'Lembrete: envio de documentos',
    setor: 'Fiscal',
    tipo: 'comunicado',
    descricao: 'Pede ao cliente o envio de notas, extratos e documentos do mês.',
    assunto: 'Lembrete: envio dos documentos do mês{{#empresa}} — {{empresa}}{{/empresa}}',
    blocos: () =>
      comunicado(
        [
          'Para mantermos em dia as obrigações{{#empresa}} de {{empresa}}{{/empresa}}, precisamos receber os documentos do mês.',
          'Envie as notas fiscais, extratos bancários e demais comprovantes até a data indicada abaixo.'
        ],
        'Prazo: preencha aqui a data limite.'
      )
  },
  {
    id: 'com-folha-prazo',
    titulo: 'Prazo de fechamento da folha',
    setor: 'DP',
    tipo: 'comunicado',
    descricao: 'Lembra o cliente de enviar as variáveis da folha (horas extras, faltas…).',
    assunto: 'Fechamento da folha: envio das informações{{#empresa}} — {{empresa}}{{/empresa}}',
    blocos: () =>
      comunicado(
        [
          'Estamos nos preparando para o fechamento da folha de pagamento{{#empresa}} de {{empresa}}{{/empresa}}.',
          'Envie até a data abaixo as informações do mês: horas extras, faltas, admissões, desligamentos, férias e afastamentos.'
        ],
        'Prazo: preencha aqui a data limite.'
      )
  }
]

/** Ponto de partida "em branco" de cada tipo. */
export function blocosEmBranco(tipo: TipoTemplate): Bloco[] {
  return tipo === 'documento' ? blocosPadraoCliente() : blocosComunicadoComConfirmacao()
}

/**
 * Comunicado em branco JÁ com o botão "Confirmar recebimento".
 *
 * Sem botão, o único sinal de um comunicado é o pixel de abertura — que é
 * estimativa (quem bloqueia imagens lê sem aparecer). O botão dá a prova de
 * que o cliente recebeu; quem não quiser, remove o bloco.
 */
export function blocosComunicadoComConfirmacao(): Bloco[] {
  const base = blocosComunicadoCliente()
  const i = base.findIndex(b => b.tipo === 'rodape')
  base.splice(i, 0, { id: id('botao'), tipo: 'botao', texto: 'Confirmar recebimento' })
  return base
}

export const ASSUNTOS_SUGERIDOS: Record<TipoTemplate, string[]> = {
  documento: [
    'Documento disponível para sua análise — {{codigo}}',
    'Documento disponível{{#empresa}} — {{empresa}}{{/empresa}}',
    'Guia de pagamento disponível{{#empresa}} — {{empresa}}{{/empresa}}'
  ],
  comunicado: [
    'Comunicado — Contábil Gaulke',
    'Aviso importante{{#empresa}} para {{empresa}}{{/empresa}}',
    'Lembrete{{#empresa}} — {{empresa}}{{/empresa}}'
  ]
}

export const SETORES = ['Geral', 'Fiscal', 'DP', 'Contábil', 'Societário'] as const
