import type { Alinhamento, Bloco, CorAviso } from '../../shared/types/blocos'

/**
 * Gera o HTML do e-mail a partir dos blocos do editor visual.
 *
 * POR QUE GERAR EM VEZ DE DEIXAR EDITAR:
 * cliente de e-mail nao e navegador. O Outlook ignora CSS moderno, entao a
 * marcacao precisa ser tabela aninhada com estilo inline — 4 tabelas e 27
 * estilos so no template padrao. Um editor livre produziria div e span, e o
 * e-mail chegaria quebrado sem ninguem perceber ate o cliente reclamar.
 *
 * O texto do operador e ESCAPADO, mas os marcadores {{variavel}} sobrevivem:
 * a substituicao acontece depois, no envio, por server/utils/render.ts.
 */

const MARCA = '#343881'
const TEXTO = '#334155'
const TEXTO_FORTE = '#0f172a'
const MUTADO = '#64748b'
const BORDA = '#e2e8f0'
const FUNDO = '#f1f5f9'
const FUNDO_SUAVE = '#f8fafc'

function escapar(v: string) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Quebra de linha digitada pelo operador vira <br>. Sem isso, o texto que ele
 * separou em paragrafos chegaria como um bloco unico e ele nao entenderia por
 * que "sumiu" o espacamento.
 */
function comQuebras(v: string) {
  return escapar(v).replace(/\r?\n/g, '<br />')
}

const ALINHAR: Record<Alinhamento, string> = {
  esquerda: 'left',
  centro: 'center',
  direita: 'right'
}

const CORES_AVISO: Record<CorAviso, { fundo: string; borda: string; texto: string }> = {
  neutro: { fundo: FUNDO_SUAVE, borda: BORDA, texto: TEXTO },
  atencao: { fundo: '#fffbeb', borda: '#fcd34d', texto: '#92400e' },
  alerta: { fundo: '#fef2f2', borda: '#fca5a5', texto: '#991b1b' }
}

/** Cada bloco devolve UMA linha da tabela principal. */
function renderizarBloco(b: Bloco): string {
  switch (b.tipo) {
    case 'logo':
      return `
            <tr>
              <td align="${ALINHAR[b.alinhamento]}" style="background-color:#ffffff;border-bottom:3px solid ${MARCA};padding:24px;">
                <img src="{{logo}}" alt="Gaulke Contábil" width="180" style="display:block;border:0;max-width:180px;height:auto;" />
              </td>
            </tr>`

    case 'titulo':
      return `
            <tr>
              <td style="padding:28px 32px 0 32px;">
                <p style="margin:0;font-size:20px;font-weight:bold;line-height:1.4;color:${TEXTO_FORTE};">${comQuebras(b.texto)}</p>
              </td>
            </tr>`

    case 'texto':
      return `
            <tr>
              <td style="padding:16px 32px 0 32px;">
                <p style="margin:0;font-size:15px;line-height:1.7;color:${TEXTO};">${comQuebras(b.texto)}</p>
              </td>
            </tr>`

    case 'botao':
      // o destino e sempre {{link}}: e o que da sentido ao sistema inteiro,
      // e por isso nao e configuravel
      return `
            <tr>
              <td align="center" style="padding:24px 32px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td align="center" bgcolor="${MARCA}" style="border-radius:8px;">
                      <a href="{{link}}" target="_blank" style="display:inline-block;padding:14px 32px;font-size:16px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:8px;">${escapar(b.texto)}</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 8px 32px;">
                <p style="margin:0;font-size:13px;line-height:1.6;color:${MUTADO};">
                  Se o botão não funcionar, copie e cole este endereço no navegador:<br />
                  <a href="{{link}}" style="color:${MARCA};word-break:break-all;">{{link}}</a>
                </p>
              </td>
            </tr>`

    case 'codigo':
      return `
            <tr>
              <td style="padding:16px 32px 0 32px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${FUNDO_SUAVE};border:1px solid ${BORDA};border-radius:8px;">
                  <tr>
                    <td style="padding:16px;text-align:center;">
                      <p style="margin:0 0 4px 0;font-size:12px;color:${MUTADO};text-transform:uppercase;letter-spacing:0.5px;">${escapar(b.rotulo)}</p>
                      <p style="margin:0;font-size:20px;font-weight:bold;letter-spacing:2px;color:${TEXTO_FORTE};font-family:'Courier New',monospace;">{{codigo}}</p>
                      ${b.ajuda ? `<p style="margin:8px 0 0 0;font-size:12px;color:${MUTADO};">${comQuebras(b.ajuda)}</p>` : ''}
                    </td>
                  </tr>
                </table>
              </td>
            </tr>`

    case 'aviso': {
      const c = CORES_AVISO[b.cor] ?? CORES_AVISO.neutro
      return `
            <tr>
              <td style="padding:16px 32px 0 32px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${c.fundo};border:1px solid ${c.borda};border-radius:8px;">
                  <tr>
                    <td style="padding:14px 16px;">
                      <p style="margin:0;font-size:14px;line-height:1.6;color:${c.texto};">${comQuebras(b.texto)}</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>`
    }

    case 'lista': {
      const itens = b.itens
        .filter(i => i.trim())
        .map(
          i =>
            `<li style="margin:0 0 6px 0;font-size:15px;line-height:1.6;color:${TEXTO};">${comQuebras(i)}</li>`
        )
        .join('')
      if (!itens) return ''
      return `
            <tr>
              <td style="padding:16px 32px 0 32px;">
                <ul style="margin:0;padding-left:20px;">${itens}</ul>
              </td>
            </tr>`
    }

    case 'separador':
      return `
            <tr>
              <td style="padding:20px 32px 4px 32px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr><td style="border-top:1px solid ${BORDA};font-size:0;line-height:0;">&nbsp;</td></tr>
                </table>
              </td>
            </tr>`

    case 'imagem':
      if (!b.arquivo) return ''
      return `
            <tr>
              <td align="${ALINHAR[b.alinhamento]}" style="padding:16px 32px 0 32px;">
                <img src="{{base}}/brand/${escapar(b.arquivo)}" alt="${escapar(b.alt)}" width="${Number(b.largura) || 400}" style="display:block;border:0;max-width:100%;height:auto;" />
              </td>
            </tr>`

    case 'rodape':
      return `
            <tr>
              <td style="background-color:${FUNDO_SUAVE};border-top:1px solid ${BORDA};padding:20px 32px;margin-top:24px;">
                <p style="margin:0 0 8px 0;font-size:12px;line-height:1.6;color:${MUTADO};">
                  Este e-mail foi enviado para <strong>{{email}}</strong> e o link de acesso é de uso pessoal.
                </p>
                <p style="margin:0;font-size:11px;line-height:1.6;color:#94a3b8;">${comQuebras(b.texto)}</p>
              </td>
            </tr>`

    default:
      return ''
  }
}

/**
 * Monta o documento completo. O rodape vai SEMPRE por ultimo, mesmo que a
 * ordem dos blocos diga outra coisa: ele fecha o cartao visualmente e nao
 * faria sentido no meio do texto.
 */
export function renderizarBlocos(blocos: Bloco[], preHeader = ''): string {
  const corpo = blocos.filter(b => b.tipo !== 'rodape')
  const rodape = blocos.find(b => b.tipo === 'rodape')

  const linhas = [...corpo, ...(rodape ? [rodape] : [])].map(renderizarBloco).join('')

  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{{empresa}}</title>
  </head>
  <body style="margin:0;padding:0;background-color:${FUNDO};font-family:Arial,Helvetica,sans-serif;color:${TEXTO_FORTE};">
    <!-- pre-header: texto de previa na caixa de entrada -->
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapar(preHeader)}</div>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${FUNDO};padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:#ffffff;border-radius:12px;overflow:hidden;border:1px solid ${BORDA};">${linhas}
            <tr><td style="height:8px;font-size:0;line-height:0;">&nbsp;</td></tr>
          </table>
        </td>
      </tr>
    </table>
    <img src="{{pixel}}" width="1" height="1" alt="" style="display:block;border:0;width:1px;height:1px;" />
  </body>
</html>
`
}

/** Ponto de partida de um template novo: o mesmo conteudo do e-mail padrao. */
export function blocosPadrao(): Bloco[] {
  return [
    { id: 'b-logo', tipo: 'logo', alinhamento: 'centro' },
    { id: 'b-saudacao', tipo: 'titulo', texto: 'Olá, {{nome}}!' },
    {
      id: 'b-intro',
      tipo: 'texto',
      texto:
        'Disponibilizamos um documento importante para a sua análise. O acesso é individual e está vinculado a este e-mail.'
    },
    {
      id: 'b-instrucao',
      tipo: 'texto',
      texto: 'Clique no botão abaixo para visualizar, confirmar a leitura e baixar o arquivo.'
    },
    { id: 'b-botao', tipo: 'botao', texto: 'Acessar documento' },
    {
      id: 'b-codigo',
      tipo: 'codigo',
      rotulo: 'Código de referência',
      ajuda: 'Informe este código caso precise falar com a nossa equipe.'
    },
    {
      id: 'b-rodape',
      tipo: 'rodape',
      texto:
        'Para comprovar a entrega e a ciência deste comunicado, registramos a data, a hora e o endereço IP do acesso à página, da confirmação de leitura e do download do arquivo. O tratamento desses dados segue a Lei 13.709/2018 (LGPD), limita-se a essa finalidade e os registros são mantidos por 24 meses.'
    }
  ]
}
