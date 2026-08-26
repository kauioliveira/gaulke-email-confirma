<script setup lang="ts">
import { dataHora } from '~/utils/formato'

definePageMeta({ layout: 'admin', middleware: 'admin' })
useHead({ title: 'Templates — Gaulke Envios' })

const toast = useToast()
const { data, refresh } = await useFetch<RespostaTemplates>(api('/api/admin/templates'))

// imagens de public/brand, para o bloco de imagem do editor visual
const { data: brand } = await useFetch<{ arquivos: { nome: string }[] }>(api('/api/admin/brand'), {
  lazy: true,
  server: false
})
const arquivosBrand = computed(() => brand.value?.arquivos || [])

const selecionadoId = ref<number | null>(null)
const form = reactive({
  nome: '',
  assunto: '',
  html: '',
  formato: 'blocos' as FormatoTemplate,
  blocos: [] as Bloco[]
})
const salvando = ref(false)
const emailTeste = ref('')
const enviandoTeste = ref(false)

function carregar(t: any) {
  selecionadoId.value = t.id
  form.nome = t.nome
  form.assunto = t.assunto
  form.html = t.html
  // templates antigos (escritos a mao) continuam em HTML; so os novos nascem
  // em blocos, entao nada precisa ser migrado
  form.formato = t.formato === 'blocos' ? 'blocos' : 'html'
  form.blocos = Array.isArray(t.blocos) && t.blocos.length ? t.blocos : blocosPadraoCliente()
}

function novo() {
  selecionadoId.value = null
  form.nome = 'Novo template'
  form.assunto = 'Documento disponível para sua análise — {{codigo}}'
  // template novo nasce VISUAL: e o caminho para quem nao sabe HTML
  form.formato = 'blocos'
  form.blocos = blocosPadraoCliente()
  form.html = ''
}

// abre o primeiro template automaticamente
if (data.value?.templates.length) carregar(data.value.templates[0])
else novo()

async function salvar() {
  const temConteudo = form.formato === 'blocos' ? form.blocos.length > 0 : !!form.html
  if (!form.nome || !form.assunto || !temConteudo) {
    return toast.add({ title: 'Preencha nome, assunto e o conteúdo do e-mail', color: 'warning' })
  }
  salvando.value = true
  try {
    if (selecionadoId.value) {
      await $fetch(api(`/api/admin/templates/${selecionadoId.value}`), { method: 'PUT', body: { ...form } })
    } else {
      const r = await $fetch<{ template: any }>(api('/api/admin/templates'), { method: 'POST', body: { ...form } })
      selecionadoId.value = r.template.id
    }
    await refresh()
    toast.add({ title: 'Template salvo', icon: 'i-lucide-check', color: 'success' })
  } catch (e: any) {
    toast.add({ title: 'Erro ao salvar', description: e?.statusMessage, color: 'error' })
  } finally {
    salvando.value = false
  }
}

async function excluir(t: any) {
  if (!confirm(`Excluir o template "${t.nome}"? Lotes já criados não são afetados.`)) return
  await $fetch(api(`/api/admin/templates/${t.id}`), { method: 'DELETE' })
  await refresh()
  if (selecionadoId.value === t.id) novo()
  toast.add({ title: 'Template excluído', color: 'success' })
}

async function enviarTeste() {
  if (!emailTeste.value) return
  enviandoTeste.value = true
  try {
    await $fetch(api('/api/admin/teste'), {
      method: 'POST',
      body: {
        para: emailTeste.value,
        assunto: form.assunto,
        // em modo visual o servidor gera o HTML pelos blocos, igual ao envio real
        ...(form.formato === 'blocos' ? { blocos: form.blocos } : { html: form.html })
      }
    })
    toast.add({
      title: 'E-mail de teste enviado',
      description: `Confira a caixa de ${emailTeste.value} (e o spam).`,
      color: 'success'
    })
  } catch (e: any) {
    toast.add({ title: 'Falha no envio de teste', description: e?.statusMessage, color: 'error' })
  } finally {
    enviandoTeste.value = false
  }
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-2xl font-semibold">Templates de e-mail</h1>
        <p class="text-sm text-muted">Monte o e-mail com blocos e veja exatamente como o destinatário vai receber.</p>
      </div>
      <UButton icon="i-lucide-plus" label="Novo template" color="neutral" variant="outline" @click="novo" />
    </div>

    <div class="grid gap-6 lg:grid-cols-[260px_1fr]">
      <!-- Lista lateral -->
      <div class="space-y-2">
        <UCard
          v-for="t in data?.templates"
          :key="t.id"
          class="cursor-pointer transition"
          :class="selecionadoId === t.id ? 'border-primary ring-1 ring-primary' : 'hover:border-primary/40'"
          @click="carregar(t)"
        >
          <div class="flex items-start gap-2">
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-medium">{{ t.nome }}</p>
              <p class="truncate text-xs text-muted">{{ t.assunto }}</p>
              <p class="mt-1 text-xs text-muted">{{ dataHora(t.updatedAt) }}</p>
            </div>
            <UButton icon="i-lucide-trash-2" color="error" variant="ghost" size="xs" @click.stop="excluir(t)" />
          </div>
        </UCard>
      </div>

      <!-- Editor -->
      <UCard>
        <div class="space-y-4">
          <div class="grid gap-4 sm:grid-cols-2">
            <UFormField label="Nome do template">
              <UInput v-model="form.nome" class="w-full" />
            </UFormField>
            <UFormField label="Assunto do e-mail" help="Aceita variáveis, ex: {{codigo}}">
              <UInput v-model="form.assunto" class="w-full" />
            </UFormField>
          </div>

          <EditorEmail
            v-model:formato="form.formato"
            v-model:blocos="form.blocos"
            v-model:html="form.html"
            :assunto="form.assunto"
            :arquivos="arquivosBrand"
          />

          <USeparator />

          <div class="flex flex-wrap items-end gap-3">
            <UFormField label="Enviar teste para" class="flex-1 min-w-[240px]" help="Antes de disparar centenas de e-mails, valide o layout.">
              <UInput v-model="emailTeste" type="email" placeholder="voce@contabilgaulke.com.br" class="w-full" />
            </UFormField>
            <UButton
              label="Enviar teste"
              icon="i-lucide-send-horizontal"
              color="neutral"
              variant="outline"
              :loading="enviandoTeste"
              :disabled="!emailTeste"
              @click="enviarTeste"
            />
            <UButton label="Salvar template" icon="i-lucide-save" :loading="salvando" @click="salvar" />
          </div>
        </div>
      </UCard>
    </div>
  </div>
</template>
