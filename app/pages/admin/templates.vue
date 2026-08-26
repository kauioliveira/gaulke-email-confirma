<script setup lang="ts">
import { dataHora } from '~/utils/formato'

definePageMeta({ layout: 'admin', middleware: 'admin' })
useHead({ title: 'Templates — Gaulke Envios' })

const toast = useToast()
const { data, refresh } = await useFetch<RespostaTemplates>(api('/api/admin/templates'))

const selecionadoId = ref<number | null>(null)
const form = reactive({ nome: '', assunto: '', html: '' })
const salvando = ref(false)
const emailTeste = ref('')
const enviandoTeste = ref(false)

function carregar(t: any) {
  selecionadoId.value = t.id
  form.nome = t.nome
  form.assunto = t.assunto
  form.html = t.html
}

function novo() {
  selecionadoId.value = null
  form.nome = 'Novo template'
  form.assunto = 'Documento disponível para sua análise — {{codigo}}'
  form.html = data.value?.templates[0]?.html || '<p>Olá {{nome}},</p>\n<p><a href="{{link}}">Acessar documento</a></p>'
}

// abre o primeiro template automaticamente
if (data.value?.templates.length) carregar(data.value.templates[0])
else novo()

async function salvar() {
  if (!form.nome || !form.assunto || !form.html) {
    return toast.add({ title: 'Preencha nome, assunto e HTML', color: 'warning' })
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
      body: { para: emailTeste.value, assunto: form.assunto, html: form.html }
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
        <p class="text-sm text-muted">Edite o HTML e veja exatamente como o destinatário vai receber.</p>
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

          <EditorHtml v-model="form.html" :assunto="form.assunto" />

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
