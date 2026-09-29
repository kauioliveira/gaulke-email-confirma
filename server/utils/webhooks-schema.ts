import { z } from 'zod'
import { EVENTOS_WEBHOOK } from './webhooks'

const NOMES = Object.keys(EVENTOS_WEBHOOK)

export const webhookSchema = z.object({
  nome: z.string().trim().min(2).max(120),
  url: z
    .string()
    .trim()
    .max(2000)
    .url('URL inválida')
    .regex(/^https?:\/\//i, 'Use http:// ou https://'),
  // '*' = todos, inclusive os que vierem a existir
  eventos: z
    .array(z.string())
    .min(1, 'Escolha ao menos um evento')
    .refine(xs => xs.every(x => x === '*' || NOMES.includes(x)), 'Evento desconhecido'),
  ativo: z.boolean().default(true)
})
